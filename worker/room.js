// RoomDO：一個房間一個 Durable Object。
// 職責：WebSocket 房間管理、對時（ping/pong）、遙測收集（記憶體）、匯出 JSON。
// POC 注意：遙測只存在記憶體，房間閒置被回收就沒了 → 測完立刻按 host 頁的「匯出 JSON」。

const MAX_EVENTS = 50000;
const MAX_MSG_BYTES = 16 * 1024;

export class RoomDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.roomId = null;
    this.hosts = new Set(); // Set<WebSocket>
    this.clients = new Map(); // clientId -> {ws, name, device, sync, spam, joinedAt, connected}
    this.stage = 'lobby';
    this.events = [];
    this.createdAt = Date.now();
  }

  log(evt) {
    if (this.events.length >= MAX_EVENTS) return;
    this.events.push({ tLog: Date.now(), ...evt });
  }

  async fetch(req) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/(ws|export|whereami)\/([A-Za-z0-9]{4,8})$/);
    if (!m) return new Response('Bad request', { status: 400 });
    this.roomId = m[2].toUpperCase();

    if (m[1] === 'export') return this.export();
    if (m[1] === 'whereami') return this.whereami(req.headers.get('x-edge-colo'));

    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }
    const role = url.searchParams.get('role') === 'host' ? 'host' : 'client';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.setup(server, role);
    return new Response(null, { status: 101, webSocket: client });
  }

  setup(ws, role) {
    ws._role = role;
    ws._clientId = null;
    if (role === 'host') {
      this.hosts.add(ws);
      this.send(ws, { type: 'hello', role, roomId: this.roomId, stage: this.stage });
      this.sendRoster(ws);
    } else {
      this.send(ws, { type: 'hello', role, roomId: this.roomId, stage: this.stage });
    }
    ws.addEventListener('message', (e) => {
      try {
        if (typeof e.data !== 'string' || e.data.length > MAX_MSG_BYTES) return;
        this.onMessage(ws, JSON.parse(e.data));
      } catch (err) {
        // 壞訊息直接忽略，POC 不需要更多
      }
    });
    const drop = () => this.onClose(ws);
    ws.addEventListener('close', drop);
    ws.addEventListener('error', drop);
  }

  onClose(ws) {
    if (ws._role === 'host') {
      this.hosts.delete(ws);
      return;
    }
    const c = ws._clientId && this.clients.get(ws._clientId);
    if (c && c.ws === ws) {
      c.connected = false;
      this.log({ type: 'leave', clientId: ws._clientId });
      this.broadcastRoster();
    }
  }

  onMessage(ws, msg) {
    const now = Date.now(); // tServerRecv：Workers 的時間在每次事件送達時更新
    switch (msg.type) {
      // ---- 對時：收到立刻回，不做任何多餘工作 ----
      case 'ping':
        this.send(ws, { type: 'pong', seq: msg.seq, t0: msg.t0, t1: now });
        return;

      case 'join': {
        const clientId = String(msg.clientId || crypto.randomUUID()).slice(0, 64);
        ws._clientId = clientId;
        const prev = this.clients.get(clientId);
        const c = {
          ws,
          name: String(msg.name || '?').slice(0, 8),
          device: msg.device || null,
          sync: prev?.sync || null,
          spam: { expected: 0, received: 0, seqs: new Set() },
          joinedAt: prev?.joinedAt || now,
          connected: true,
        };
        this.clients.set(clientId, c);
        this.log({ type: 'join', clientId, name: c.name, device: c.device, rejoin: !!prev });
        this.send(ws, { type: 'joined', roomId: this.roomId, clientId, stage: this.stage });
        this.broadcastRoster();
        return;
      }

      case 'deviceUpdate': {
        const c = this.clients.get(ws._clientId);
        if (!c) return;
        c.device = { ...(c.device || {}), ...(msg.device || {}) };
        this.log({ type: 'deviceUpdate', clientId: ws._clientId, device: msg.device });
        this.broadcastRoster();
        return;
      }

      case 'syncResult': {
        // client 對時完成／每 10 秒重測後回報：offset、RTT 統計、漂移
        const c = this.clients.get(ws._clientId);
        if (!c) return;
        c.sync = { offset: msg.offset, rtt: msg.rtt, drift: msg.drift, at: now };
        this.log({ type: 'syncResult', clientId: ws._clientId, offset: msg.offset, rtt: msg.rtt, drift: msg.drift, elapsedMs: msg.elapsedMs });
        this.toHosts({ type: 'syncUpdate', clientId: ws._clientId, offset: msg.offset, rtt: msg.rtt, drift: msg.drift });
        return;
      }

      case 'tap': {
        const c = this.clients.get(ws._clientId);
        if (!c) return;
        const uplinkMs = typeof msg.tClientSend === 'number' ? now - msg.tClientSend : null;
        this.log({ type: 'tap', clientId: ws._clientId, seq: msg.seq, mode: msg.mode, tClientSend: msg.tClientSend, tServerRecv: now, uplinkMs });
        if (msg.mode === 'spam') {
          c.spam.received++;
          if (typeof msg.seq === 'number') c.spam.seqs.add(msg.seq);
        }
        const tServerSend = Date.now();
        // ack 回 client → client 可算下行延遲（四時間戳補齊）
        this.send(ws, { type: 'tapAck', seq: msg.seq, mode: msg.mode, tClientSend: msg.tClientSend, tServerRecv: now, tServerSend });
        this.toHosts({ type: 'tapEvent', clientId: ws._clientId, name: c.name, seq: msg.seq, mode: msg.mode, uplinkMs });
        return;
      }

      case 'spamStart': {
        const c = this.clients.get(ws._clientId);
        if (!c) return;
        c.spam = { expected: 0, received: 0, seqs: new Set() };
        this.log({ type: 'spamStart', clientId: ws._clientId });
        return;
      }

      case 'spamDone': {
        const c = this.clients.get(ws._clientId);
        if (!c) return;
        const sent = msg.sent | 0;
        const received = c.spam.received;
        // seq 斷號：1..sent 中沒收到的
        let gaps = 0;
        for (let i = 1; i <= sent; i++) if (!c.spam.seqs.has(i)) gaps++;
        const lossPct = sent > 0 ? Math.round((gaps / sent) * 1000) / 10 : 0;
        this.log({ type: 'spamSummary', clientId: ws._clientId, sent, received, gaps, lossPct });
        this.toHosts({ type: 'spamSummary', clientId: ws._clientId, name: c.name, sent, received, gaps, lossPct });
        this.send(ws, { type: 'spamSummary', sent, received, gaps, lossPct });
        return;
      }

      case 'shake': {
        const c = this.clients.get(ws._clientId);
        if (!c) return;
        const uplinkMs = typeof msg.tClientSend === 'number' ? now - msg.tClientSend : null;
        this.log({ type: 'shake', clientId: ws._clientId, count: msg.count, params: msg.params, tClientSend: msg.tClientSend, tServerRecv: now, uplinkMs });
        this.toHosts({ type: 'shakeEvent', clientId: ws._clientId, name: c.name, count: msg.count, uplinkMs, params: msg.params });
        return;
      }

      case 'batch': {
        // client 端累積的遙測（下行延遲等），整批收進 log
        if (!Array.isArray(msg.records)) return;
        for (const r of msg.records.slice(0, 200)) {
          this.log({ type: 'clientRecord', clientId: ws._clientId, ...r });
        }
        return;
      }

      // ---- host 控制 ----
      case 'stage': {
        if (ws._role !== 'host') return;
        this.stage = String(msg.stage || 'lobby').slice(0, 20);
        this.log({ type: 'stage', stage: this.stage });
        this.broadcastAll({ type: 'stage', stage: this.stage });
        return;
      }
    }
  }

  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* 已斷線 */ }
  }

  toHosts(obj) {
    const s = JSON.stringify(obj);
    for (const ws of this.hosts) { try { ws.send(s); } catch (e) {} }
  }

  broadcastAll(obj) {
    const s = JSON.stringify(obj);
    for (const ws of this.hosts) { try { ws.send(s); } catch (e) {} }
    for (const c of this.clients.values()) {
      if (c.connected) { try { c.ws.send(s); } catch (e) {} }
    }
  }

  rosterPayload() {
    return {
      type: 'roster',
      stage: this.stage,
      clients: [...this.clients.entries()].map(([id, c]) => ({
        clientId: id,
        name: c.name,
        device: c.device,
        sync: c.sync,
        connected: c.connected,
      })),
    };
  }

  sendRoster(ws) { this.send(ws, this.rosterPayload()); }
  broadcastRoster() { this.toHosts(this.rosterPayload()); }

  // DO 到底住在哪個機房？從 DO 內打一個 trace，回的 colo 就是 DO 所在地。
  // 台灣的 client 若量到 100ms+ 的 RTT 地板，先看這裡是不是 DO 落到美洲去了。
  async whereami(edgeColo) {
    if (!this._colo) {
      try {
        const txt = await (await fetch('https://1.1.1.1/cdn-cgi/trace')).text();
        this._colo = /colo=([A-Z]+)/.exec(txt)?.[1] || '?';
      } catch (e) { this._colo = '?'; }
    }
    return new Response(JSON.stringify({ doColo: this._colo, edgeColo: edgeColo || '?' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  export() {
    const body = JSON.stringify({
      roomId: this.roomId,
      createdAt: this.createdAt,
      exportedAt: Date.now(),
      stage: this.stage,
      clients: [...this.clients.entries()].map(([id, c]) => ({
        clientId: id, name: c.name, device: c.device, sync: c.sync, joinedAt: c.joinedAt, connected: c.connected,
      })),
      eventCount: this.events.length,
      events: this.events,
    });
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="mahou-${this.roomId}-${Date.now()}.json"`,
      },
    });
  }
}
