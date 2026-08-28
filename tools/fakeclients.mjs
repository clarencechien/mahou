// 探針 D：假 client 壓力測試（handoff §11-D）
// 用法：node tools/fakeclients.mjs wss://<你的網域>/ws ROOM [假client數=8] [秒數=30]
// 需 Node 22+（用內建 WebSocket，不用裝任何套件）。
// 做的事：N 個假 client 加入房間，各自以 300ms 上報 shake + 100ms 上報 tap，
// 同時用第 0 號 client 每 150ms ping 一次，量「負載下的 RTT」。
// 兩台實機同場開著，就能看實機延遲在 N 人負載下變差多少。

const [, , base, room, nArg, secArg] = process.argv;
if (!base || !room) {
  console.error('用法: node tools/fakeclients.mjs wss://mahou.example.workers.dev/ws ROOM [N=8] [秒=30]');
  process.exit(1);
}
const N = parseInt(nArg || '8', 10);
const SECONDS = parseInt(secArg || '30', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  return +s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))].toFixed(1);
};

const open = (i) =>
  new Promise((res, rej) => {
    const ws = new WebSocket(`${base}/${room}?role=client`);
    ws._pending = new Map();
    ws._seq = 0;
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'pong') {
        const p = ws._pending.get(m.seq);
        if (p) { ws._pending.delete(m.seq); p(performance.now()); }
      }
    });
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'join', clientId: 'fake-' + i, name: '機' + i, device: { platform: 'fake-client' } }));
      res(ws);
    });
    ws.addEventListener('error', () => rej(new Error('連不上 ' + base)));
  });

const ping = (ws) =>
  new Promise((res) => {
    const seq = ++ws._seq;
    const t0 = performance.now();
    ws._pending.set(seq, (t2) => res(t2 - t0));
    ws.send(JSON.stringify({ type: 'ping', seq, t0 }));
    setTimeout(() => { if (ws._pending.delete(seq)) res(null); }, 5000);
  });

console.log(`連線 ${N} 個假 client 到 ${base}/${room} …`);
const clients = [];
for (let i = 0; i < N; i++) clients.push(await open(i));
console.log('全部加入，開始壓 ' + SECONDS + ' 秒');

const timers = [];
for (const ws of clients) {
  let c = 0, s = 0;
  timers.push(setInterval(() => ws.send(JSON.stringify({ type: 'shake', count: ++c, params: { hi: 3.5, lo: 1.5, ref: 120 }, tClientSend: Date.now() })), 300));
  timers.push(setInterval(() => ws.send(JSON.stringify({ type: 'tap', seq: ++s, mode: 'single', tClientSend: Date.now() })), 100));
}

const rtts = [];
let lost = 0;
const tEnd = performance.now() + SECONDS * 1000;
while (performance.now() < tEnd) {
  const r = await ping(clients[0]);
  if (r == null) lost++; else rtts.push(r);
  await sleep(150);
}
timers.forEach(clearInterval);
clients.forEach((ws) => ws.close());

console.log(`\n負載下 RTT（假client#0 視角）: n=${rtts.length} 掉包=${lost}`);
console.log(`min=${pct(rtts, 0)} p50=${pct(rtts, 50)} p95=${pct(rtts, 95)} max=${pct(rtts, 100)} ms`);
console.log('→ 對照兩台實機畫面上的 RTT，看有沒有跟著變差。');
process.exit(0);
