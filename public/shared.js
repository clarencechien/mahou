// shared.js — 對時、WS 封裝、遙測記錄、裝置指紋（host / client 共用）
// 全部掛在 window.Mahou 底下，無 build step。
(function () {
  const Mahou = (window.Mahou = {});

  Mahou.$ = (sel) => document.querySelector(sel);

  // ---------- WS 封裝：自動重連 + JSON + 訊息分發 ----------
  Mahou.Sock = class {
    constructor(roomId, role, extraQuery = '') {
      this.roomId = roomId;
      this.role = role;
      this.extraQuery = extraQuery;
      this.handlers = {}; // type -> fn(msg)
      this.openHandlers = [];
      this.endedHandlers = [];
      this.closed = false;
      this.retry = 0;
      this.connect();
    }
    url() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      return `${proto}://${location.host}/ws/${this.roomId}?role=${this.role}${this.extraQuery}`;
    }
    connect() {
      this.ws = new WebSocket(this.url());
      this.ws.onopen = () => {
        this.retry = 0;
        this.openHandlers.forEach((fn) => fn());
      };
      this.ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        const fn = this.handlers[msg.type];
        if (fn) fn(msg);
      };
      this.ws.onclose = (e) => {
        if (this.closed) return;
        // 4000/4001 = 伺服器主動關房（host 結束或閒置逾時）：不再重連，
        // 否則忘記關的分頁會自動重連＋重新加入，把房間永遠養著（計費防呆）
        if (e.code >= 4000) {
          this.closed = true;
          this.endedHandlers.forEach((fn) => fn(e.reason || 'ended'));
          return;
        }
        const delay = Math.min(500 * 2 ** this.retry++, 8000);
        setTimeout(() => this.connect(), delay);
      };
    }
    on(type, fn) { this.handlers[type] = fn; return this; }
    onEnded(fn) { this.endedHandlers.push(fn); return this; }
    onOpen(fn) { this.openHandlers.push(fn); if (this.ws.readyState === 1) fn(); return this; }
    send(obj) {
      if (this.ws.readyState === 1) { this.ws.send(JSON.stringify(obj)); return true; }
      return false;
    }
    close() { this.closed = true; this.ws.close(); }
  };

  // ---------- 對時 ----------
  // offset = t1 - (t0+t2)/2，取 RTT 最小的樣本。serverNow() = performance.now() + offset
  // 一律用 performance.now()（單調），不要用 Date.now()。
  Mahou.ClockSync = class {
    constructor(sock) {
      this.sock = sock;
      this.offset = null;
      this.firstOffset = null;
      this.firstAt = null;
      this.rtt = null; // {min,p50,p95,max}
      this.history = []; // {elapsedMs, offset, rttMin, drift}
      this._pending = new Map(); // seq -> {resolve, t0}
      this._seq = 0;
      sock.on('pong', (m) => {
        const p = this._pending.get(m.seq);
        if (!p) return;
        this._pending.delete(m.seq);
        const t2 = performance.now();
        const rtt = t2 - p.t0;
        p.resolve({ rtt, offset: m.t1 - (p.t0 + t2) / 2 });
      });
    }
    pingOnce(timeoutMs = 3000) {
      return new Promise((resolve) => {
        const seq = ++this._seq;
        const t0 = performance.now();
        this._pending.set(seq, { resolve, t0 });
        if (!this.sock.send({ type: 'ping', seq, t0 })) {
          this._pending.delete(seq);
          resolve(null);
          return;
        }
        setTimeout(() => {
          if (this._pending.delete(seq)) resolve(null); // 超時＝掉包
        }, timeoutMs);
      });
    }
    async sync(n = 10, gapMs = 60) {
      const samples = [];
      for (let i = 0; i < n; i++) {
        const s = await this.pingOnce();
        if (s) samples.push(s);
        if (i < n - 1) await new Promise((r) => setTimeout(r, gapMs));
      }
      if (!samples.length) return null;
      const rtts = samples.map((s) => s.rtt).sort((a, b) => a - b);
      const best = samples.reduce((a, b) => (a.rtt <= b.rtt ? a : b));
      this.offset = best.offset;
      this.rtt = {
        min: rtts[0],
        p50: Mahou.pct(rtts, 50),
        p95: Mahou.pct(rtts, 95),
        max: rtts[rtts.length - 1],
        samples: samples.length,
        lost: n - samples.length,
      };
      if (this.firstOffset === null) {
        this.firstOffset = this.offset;
        this.firstAt = performance.now();
      }
      const drift = this.offset - this.firstOffset;
      const elapsedMs = Math.round(performance.now() - this.firstAt);
      this.history.push({ elapsedMs, offset: this.offset, rttMin: rtts[0], drift });
      this.sock.send({ type: 'syncResult', offset: this.offset, rtt: this.rtt, drift, elapsedMs });
      return { offset: this.offset, rtt: this.rtt, drift };
    }
    // 背景每 10 秒重測，記錄漂移（§3.2）
    startBackground(intervalMs = 10000) {
      if (this._bg) return;
      this._bg = setInterval(() => this.sync(10, 40), intervalMs);
    }
    stopBackground() { clearInterval(this._bg); this._bg = null; }
    serverNow() {
      return this.offset === null ? null : performance.now() + this.offset;
    }
  };

  Mahou.pct = (sortedArr, p) => {
    if (!sortedArr.length) return null;
    const i = Math.min(sortedArr.length - 1, Math.ceil((p / 100) * sortedArr.length) - 1);
    return Math.round(sortedArr[Math.max(0, i)] * 10) / 10;
  };

  // ---------- 遙測批次上傳（client 端算出的下行延遲等） ----------
  Mahou.Telemetry = class {
    constructor(sock, flushMs = 2000) {
      this.sock = sock;
      this.buf = [];
      setInterval(() => this.flush(), flushMs);
    }
    add(record) { this.buf.push(record); }
    flush() {
      if (!this.buf.length) return;
      this.sock.send({ type: 'batch', records: this.buf.splice(0, 200) });
    }
  };

  // ---------- 裝置指紋（§3.4） ----------
  Mahou.deviceFingerprint = () => ({
    ua: navigator.userAgent,
    platform: navigator.platform,
    screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio },
    deviceMemory: navigator.deviceMemory ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    motionSupported: typeof DeviceMotionEvent !== 'undefined',
    motionPermission: typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function' ? 'ask' : 'auto',
    orientationSupported: typeof DeviceOrientationEvent !== 'undefined',
    motionEventRateHz: null, // 拿到權限後由 measureMotionRate 補
    connection: navigator.connection?.effectiveType ?? null,
  });

  // 實測 3 秒內收到幾個 devicemotion 事件 → Hz
  Mahou.measureMotionRate = (ms = 3000) =>
    new Promise((resolve) => {
      let n = 0;
      const h = () => n++;
      window.addEventListener('devicemotion', h);
      setTimeout(() => {
        window.removeEventListener('devicemotion', h);
        resolve(Math.round((n / (ms / 1000)) * 10) / 10);
      }, ms);
    });

  // iOS 需要使用者手勢觸發；Android 直接回 granted
  Mahou.requestMotionPermission = async () => {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try { return (await DeviceMotionEvent.requestPermission()) === 'granted' ? 'granted' : 'denied'; }
      catch { return 'denied'; }
    }
    return 'granted';
  };

  // ---------- Wake Lock（§9：visibilitychange 要重新申請） ----------
  Mahou.keepAwake = () => {
    let lock = null;
    const acquire = async () => {
      try { lock = await navigator.wakeLock?.request('screen'); } catch {}
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') acquire();
    });
    acquire();
  };

  // ---------- in-app browser 偵測（§9 LINE/FB 地雷） ----------
  Mahou.inAppBrowser = () => {
    const ua = navigator.userAgent;
    if (/Line\//i.test(ua)) return 'LINE';
    if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
    if (/Instagram/i.test(ua)) return 'Instagram';
    if (/MicroMessenger/i.test(ua)) return 'WeChat';
    return null;
  };

  Mahou.rttClass = (ms) => (ms == null ? '' : ms < 40 ? 'good' : ms <= 120 ? 'warn' : 'bad');

  Mahou.randomRoom = () => {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉 0/O/1/I/L
    let s = '';
    for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return s;
  };
})();
