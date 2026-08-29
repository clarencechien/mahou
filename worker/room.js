// RoomDO：一個房間一個 Durable Object。
// 職責：WebSocket 房間管理、對時（ping/pong）、遙測收集（記憶體）、匯出 JSON。
// POC 注意：遙測只存在記憶體，房間閒置被回收就沒了 → 測完立刻按 host 頁的「匯出 JSON」。

const MAX_EVENTS = 50000;
const MAX_MSG_BYTES = 16 * 1024;

// 計費防呆：非 hibernation 的 WS 會把 DO 釘在記憶體裡持續計費。
// 忘記關的分頁（含自動重連＋背景對時）會讓 DO 永遠睡不著，所以：
// - 30 分鐘沒有「有意義的」訊息（ping/對時不算）→ 自動關房
// - 房間開了 6 小時 → 無條件關房
// 關房 = 踢掉所有 WS（code 4000/4001，client 看到就不再重連）→ DO 閒置後被回收，停止計費。
const IDLE_LIMIT_MS = 30 * 60 * 1000;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const FREEZE_GRACE_MS = 250;   // 轉身後給人類的煞車時間，超過才算犯規
const MEANINGFUL = new Set(['join', 'deviceUpdate', 'tap', 'spamStart', 'spamDone', 'shake', 'batch', 'stage',
  'colorRound', 'colorPick', 'colorEnd', 'skiStart', 'skiRun', 'skiDone',
  'freezeStart', 'freezeRound', 'freezeTurn', 'freezeAct', 'freezeEnd', 'skiEnd', 'ready']);

export class RoomDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.roomId = null;
    this.hosts = new Set(); // Set<WebSocket>
    this.clients = new Map(); // clientId -> {ws, name, device, sync, spam, joinedAt, connected}
    this.stage = 'lobby';
    this.colorRound = null; // {round, deltaE, targetIdx, tShow, picks:Set, correctN}
    this.freeze = null;     // {round, cmd, tGreen, tTurn, players:Map<id,{progress,violations,done}>}
    this.ski = null;        // {startAt, duration, seed, results:Map}
    this.events = [];
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.ended = false;
    this._reaper = null;
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
    if (this.ended) { ws.close(4000, 'room ended'); return; }
    // 有連線才需要看門狗；全空時要清掉，否則 timer 本身會擋住 DO 回收
    if (!this._reaper) this._reaper = setInterval(() => this.checkIdle(), 60 * 1000);
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
    } else {
      const c = ws._clientId && this.clients.get(ws._clientId);
      if (c && c.ws === ws) {
        c.connected = false;
        this.log({ type: 'leave', clientId: ws._clientId });
        this.broadcastRoster();
      }
    }
    if (this.hosts.size === 0 && ![...this.clients.values()].some((c) => c.connected)) {
      clearInterval(this._reaper);
      this._reaper = null;
    }
  }

  checkIdle() {
    const now = Date.now();
    if (now - this.lastActivity > IDLE_LIMIT_MS) this.endRoom('idle', 4001);
    else if (now - this.createdAt > MAX_AGE_MS) this.endRoom('max-age', 4001);
  }

  endRoom(reason, code = 4000) {
    if (this.ended) return;
    this.ended = true;
    this.log({ type: 'roomEnded', reason });
    this.broadcastAll({ type: 'roomEnded', reason });
    for (const ws of this.hosts) { try { ws.close(code, reason); } catch (e) {} }
    for (const c of this.clients.values()) { try { c.ws.close(code, reason); } catch (e) {} }
    this.hosts.clear();
    for (const c of this.clients.values()) c.connected = false;
    clearInterval(this._reaper);
    this._reaper = null;
    // events 留著：DO 被回收前 host 還來得及打 /export 撈最後一次
  }

  onMessage(ws, msg) {
    const now = Date.now(); // tServerRecv：Workers 的時間在每次事件送達時更新
    // ping / syncResult 不算活動——忘記關的分頁會自動發這兩種，不能讓它們養住房間
    if (MEANINGFUL.has(msg.type)) this.lastActivity = now;
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
          name: String(msg.name || '?').slice(0, 10),
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

      // ---- 遊戲一：顏色反應 ----
      case 'colorRound': {
        // host 出題：DO 記下正解與 tShow（伺服器時鐘），廣播給 client 時「不含」正解
        if (ws._role !== 'host') return;
        this.colorRound = { round: msg.round | 0, deltaE: msg.deltaE, targetIdx: msg.targetIdx | 0, tShow: now, picks: new Set(), correctN: 0 };
        this.log({ type: 'colorRound', round: this.colorRound.round, deltaE: msg.deltaE, targetIdx: this.colorRound.targetIdx, colors: msg.colors, tShow: now });
        const s = JSON.stringify({ type: 'colorRound', round: this.colorRound.round, deltaE: msg.deltaE, colors: msg.colors });
        for (const c of this.clients.values()) if (c.connected) { try { c.ws.send(s); } catch (e) {} }
        return;
      }

      case 'colorPick': {
        const c = this.clients.get(ws._clientId);
        const g = this.colorRound;
        if (!c || !g || (msg.round | 0) !== g.round) return;
        if (g.picks.has(ws._clientId)) return; // 一人一答
        g.picks.add(ws._clientId);
        const correct = (msg.idx | 0) === g.targetIdx;
        const rank = correct ? ++g.correctN : null;
        // reactionMs 用 client 的點擊時間戳（已換算伺服器時間軸）→ 不含上行；沒對時就退回收到時間
        const reactionMs = typeof msg.tTap === 'number' ? msg.tTap - g.tShow : now - g.tShow;
        const uplinkMs = typeof msg.tClientSend === 'number' ? now - msg.tClientSend : null;
        this.log({ type: 'colorPick', clientId: ws._clientId, round: g.round, deltaE: g.deltaE, idx: msg.idx | 0, correct, rank, tShow: g.tShow, tTap: msg.tTap, reactionMs, uplinkMs });
        // 答完才揭曉正解位置，client 拿來高亮「其實是這塊」
        this.send(ws, { type: 'colorResult', round: g.round, correct, reactionMs, rank, targetIdx: g.targetIdx });
        this.toHosts({ type: 'colorPick', clientId: ws._clientId, name: c.name, round: g.round, correct, reactionMs, rank, answered: g.picks.size });
        return;
      }

      case 'colorEnd': {
        if (ws._role !== 'host') return;
        this.colorRound = null;
        this.log({ type: 'colorEnd', scores: msg.scores });
        this.broadcastAll({ type: 'colorEnd', scores: msg.scores });
        return;
      }

      // ---- 遊戲一之外：木頭人・混合指令 ----
      // 判定全部用 client 時間戳（已對時到伺服器時間軸），DO 只負責蓋章、比對、廣播。
      // 因此 150ms 的傳輸延遲不影響任何公平性判定。
      case 'freezeStart': {
        if (ws._role !== 'host') return;
        this.freeze = { round: 0, cmd: null, tGreen: 0, tTurn: 0, players: new Map() };
        this.log({ type: 'freezeStart' });
        this.broadcastAll({ type: 'freezeStart' });
        this.sendFreezeState();
        return;
      }

      case 'freezeRound': {
        if (ws._role !== 'host' || !this.freeze) return;
        const f = this.freeze;
        f.round++; f.cmd = msg.cmd; f.tGreen = now; f.tTurn = 0;
        // params 分兩份：answer 只留在 DO（正解），pub 才廣播出去
        f.answer = (msg.params && msg.params.answer !== undefined) ? msg.params.answer : null;
        f.need = (msg.params && msg.params.need) || 0;
        const pub = { ...(msg.params || {}) };
        delete pub.answer;
        f.pub = pub;
        for (const p of f.players.values()) { p.done = false; p.violated = false; p.overed = false; }
        this.log({ type: 'freezeRound', round: f.round, cmd: f.cmd, params: msg.params, tGreen: now });
        this.broadcastAll({ type: 'freezeRound', round: f.round, cmd: f.cmd, params: pub, tGreen: now });
        return;
      }

      case 'freezeTurn': {
        if (ws._role !== 'host' || !this.freeze) return;
        this.freeze.tTurn = now;
        this.log({ type: 'freezeTurn', round: this.freeze.round, tTurn: now });
        this.broadcastAll({ type: 'freezeTurn', round: this.freeze.round, tTurn: now });
        return;
      }

      case 'freezeAct': {
        const c = this.clients.get(ws._clientId);
        const f = this.freeze;
        if (!c || !f || (msg.round | 0) !== f.round) return;
        let p = f.players.get(ws._clientId);
        if (!p) { p = { progress: 0, violations: 0, done: false }; f.players.set(ws._clientId, p); }
        // tClient 已是伺服器時間軸；沒對時的退回收到時間（會偏保守，記進遙測）
        const tc = typeof msg.tClient === 'number' ? msg.tClient : now;
        const uplinkMs = now - tc;
        let verdict = 'ignored';
        if (msg.kind === 'cmd') {
          // 綠燈期間完成指令：必須在轉身之前（用 client 時間戳比，不是收到時間）
          const inWindow = !p.done && (f.tTurn === 0 || tc < f.tTurn);
          if (inWindow) {
            // 有正解的指令（算術／指定顏色）要答對才算；數量型指令看 need
            const correct = f.answer === null ? true : (msg.value === f.answer);
            p.done = true;
            if (correct) { p.progress++; verdict = 'ok'; }
            else { verdict = 'wrong'; }
          }
        } else if (msg.kind === 'over') {
          // 連點超過上限：這回合作廢並退一格
          if (!p.overed && (f.tTurn === 0 || tc < f.tTurn)) {
            p.overed = true; p.done = true;
            p.progress = Math.max(0, p.progress - 1);
            verdict = 'over';
          }
        } else if (msg.kind === 'move') {
          // 轉身後還在動：GRACE 給人類的煞車時間，超過才算犯規
          if (f.tTurn && tc > f.tTurn + FREEZE_GRACE_MS && !p.violated) {
            p.violations++; p.progress = Math.max(0, p.progress - 1); p.violated = true; verdict = 'violation';
          }
        }
        this.log({ type: 'freezeAct', clientId: ws._clientId, round: f.round, kind: msg.kind, tClient: tc, tServerRecv: now, uplinkMs, verdict, value: msg.value });
        this.send(ws, { type: 'freezeVerdict', round: f.round, kind: msg.kind, verdict });
        if (verdict !== 'ignored') this.sendFreezeState();
        return;
      }

      case 'freezeEnd': {
        if (ws._role !== 'host' || !this.freeze) return;
        const rank = [...this.freeze.players.entries()]
          .map(([id, p]) => ({ clientId: id, name: this.clients.get(id)?.name || '?', ...p }))
          .sort((a, b) => b.progress - a.progress || a.violations - b.violations);
        this.log({ type: 'freezeEnd', rank });
        this.broadcastAll({ type: 'freezeEnd', rank });
        this.freeze = null;
        return;
      }

      // ---- 遊戲二：滑雪下坡 ----
      // client 權威：手機跑完整物理，DO 只發種子（保證兩端世界一致）、轉發、記遙測。
      // host 收到狀態後用回報的速度外推 ~RTT，所以大螢幕上的位置幾乎即時。
      case 'skiStart': {
        if (ws._role !== 'host') return;
        const startAt = now + 4200;                        // 倒數 ＋ 校準時間
        const duration = Math.min(msg.duration | 0 || 30000, 120000);
        const seed = (Math.random() * 0x7fffffff) | 0;
        this.ski = { startAt, duration, seed, results: new Map() };
        this.log({ type: 'skiStart', startAt, duration, seed });
        this.broadcastAll({ type: 'skiStart', startAt, duration, seed });
        return;
      }

      // 手機在說明畫面完成感應器設定就回報一次，主持人才知道可以開打了
      case 'ready': {
        const c = this.clients.get(ws._clientId);
        if (!c) return;
        c.ready = msg.game || true;
        this.log({ type: 'ready', clientId: ws._clientId, game: msg.game });
        this.toHosts({ type: 'ready', clientId: ws._clientId, name: c.name, game: msg.game });
        return;
      }

      case 'skiRun': {
        const c = this.clients.get(ws._clientId);
        if (!c) return;
        const uplinkMs = typeof msg.tClient === 'number' ? now - msg.tClient : null;
        this.log({ type: 'skiRun', clientId: ws._clientId, x: msg.x, wy: msg.wy, speed: msg.speed,
                   vx: msg.vx, air: msg.air, jumps: msg.jumps, hits: msg.hits,
                   tClient: msg.tClient, tServerRecv: now, uplinkMs });
        this.toHosts({ type: 'skiRun', clientId: ws._clientId, name: c.name, x: msg.x, wy: msg.wy,
                       speed: msg.speed, vx: msg.vx, air: msg.air, airMax: msg.airMax, rot: msg.rot,
                       jumps: msg.jumps, hits: msg.hits, tClient: msg.tClient, uplinkMs });
        return;
      }

      case 'skiDone': {
        const c = this.clients.get(ws._clientId);
        if (!c || !this.ski) return;
        this.ski.results.set(ws._clientId, { dist: msg.dist, jumps: msg.jumps, hits: msg.hits });
        this.log({ type: 'skiDone', clientId: ws._clientId, dist: msg.dist, jumps: msg.jumps, hits: msg.hits });
        this.toHosts({ type: 'skiDone', clientId: ws._clientId, name: c.name, dist: msg.dist, jumps: msg.jumps, hits: msg.hits });
        return;
      }

      case 'skiEnd': {
        if (ws._role !== 'host' || !this.ski) return;
        const rank = [...this.ski.results.entries()]
          .map(([id, r]) => ({ clientId: id, name: this.clients.get(id)?.name || '?', ...r }))
          .sort((a, b) => b.dist - a.dist);
        this.log({ type: 'skiEnd', rank });
        this.broadcastAll({ type: 'skiEnd', rank });
        this.ski = null;
        return;
      }

      // ---- host 控制 ----
      case 'endRoom': {
        if (ws._role !== 'host') return;
        this.endRoom('host');
        return;
      }

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

  sendFreezeState() {
    if (!this.freeze) return;
    const players = [...this.freeze.players.entries()].map(([id, p]) => ({
      clientId: id, name: this.clients.get(id)?.name || '?',
      progress: p.progress, violations: p.violations, done: p.done,
    }));
    this.broadcastAll({ type: 'freezeState', round: this.freeze.round, players });
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
