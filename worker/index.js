import { RoomDO } from './room.js';
import { mintToken, tokenOk, tokenRole } from './token.js';
export { RoomDO };

// close 是「逃生鈕」：不用開著那個房間的分頁也能把它關掉。
const ROOM_RE = /^\/(ws|export|whereami|close)\/([A-Za-z0-9]{4,8})$/;

// ============ 房間憑證：真正在管 DO 費用的地方 ============
//
// ⚠️ 把 /host 放到 Cloudflare Access 後面**擋不住 DO**。
// DO 不是 /host 開出來的，是 `/ws/<房號>` 開出來的——路人不用打開任何頁面，
// 直接連 wss://…/ws/ABCD 就生得出一個 DO，然後掛在那裡按秒計費。
// 保護頁面沒有保護到花錢的那條路徑。
//
// 所以鎖在這裡：**沒有有效的房間憑證，Worker 連 env.ROOM.get() 都不會呼叫。**
//   1. 主控（過 Access）打 POST /api/room 換一張憑證，憑證是 HMAC 簽的
//   2. QR 網址帶著它：/client#<房號>.<憑證>
//   3. 掃 QR 的人**不需要任何登入**，帶著憑證來就好
//   4. 背景模式 /ambient 與 /audio 完全不經過這裡，本來就不碰 DO
//
// 沒設 ROOM_SECRET 就維持現在的開放行為（本機開發、還沒設定的部署照樣能玩），
// 但 /api/room 會回報 locked:false，主控台會把「沒上鎖」四個字顯示出來——
// 寧可醜也不要讓人以為鎖上了。
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;          // 一場家宴綽綽有餘

// ---- Cloudflare Access 的 JWT ----
// 只看 Cf-Access-Jwt-Assertion 這個 header 存不存在是不夠的：Access 沒有蓋到的路徑，
// Cloudflare 不會幫你把使用者自己送的同名 header 拿掉。所以要真的驗簽章。
let certsCache = { at: 0, keys: null };
async function accessKeys(team) {
  if (certsCache.keys && Date.now() - certsCache.at < 60 * 60 * 1000) return certsCache.keys;
  const r = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('certs ' + r.status);
  const { keys } = await r.json();
  certsCache = { at: Date.now(), keys };
  return keys;
}
async function accessOk(req, env) {
  // 兩個變數都沒設＝這個部署沒有接 Access，交給 ROOM_SECRET 那層判斷
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD) return { on: false, ok: true, who: null };
  const jwt = req.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) return { on: true, ok: false, who: null };
  try {
    const [h, p, s] = jwt.split('.');
    const head = JSON.parse(atob(h.replace(/-/g, '+').replace(/_/g, '/')));
    const body = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
    if (body.exp && Date.now() / 1000 > body.exp) return { on: true, ok: false, who: null };
    const aud = Array.isArray(body.aud) ? body.aud : [body.aud];
    if (!aud.includes(env.ACCESS_AUD)) return { on: true, ok: false, who: null };
    if (body.iss !== `https://${env.ACCESS_TEAM}.cloudflareaccess.com`) return { on: true, ok: false, who: null };
    const jwk = (await accessKeys(env.ACCESS_TEAM)).find((k) => k.kid === head.kid);
    if (!jwk) return { on: true, ok: false, who: null };
    const key = await crypto.subtle.importKey('jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig,
      new TextEncoder().encode(`${h}.${p}`));
    return { on: true, ok, who: ok ? (body.email || 'ok') : null };
  } catch (e) { return { on: true, ok: false, who: null }; }
}

// POST /api/room[?room=ABCD] → 給主控一張房間憑證
async function serveMint(req, env, url) {
  const acc = await accessOk(req, env);
  if (acc.on && !acc.ok) return new Response(JSON.stringify({ error: 'access required' }),
    { status: 403, headers: { 'content-type': 'application/json' } });
  const want = (url.searchParams.get('room') || '').toUpperCase();
  const room = /^[A-Z0-9]{4,8}$/.test(want) ? want : randomRoom();
  const secret = env.ROOM_SECRET;
  const exp = Date.now() + TOKEN_TTL_MS;
  return new Response(JSON.stringify({
    room,
    // token 是給 QR 的(每個玩家都會拿到);hostToken 只給主控自己,簽在不同訊息上。
    // 主控的 WS 與 /export /close /whereami 都要用 hostToken —— 角色是簽出來的,不是宣告的。
    token: secret ? await mintToken(secret, room, exp, 'client') : null,
    hostToken: secret ? await mintToken(secret, room, exp, 'host') : null,
    locked: !!secret,
    access: acc.on ? (acc.who || true) : false,
    exp,
  }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

// 房號要好念好抄：去掉 0/O/1/I 這種現場會唸錯的
function randomRoom() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const n = crypto.getRandomValues(new Uint8Array(5));
  return [...n].map((x) => A[x % A.length]).join('');
}

// 背景模式的音檔要走這裡，不能直接讓靜態資源服務。
// Cloudflare 的 assets handler 不理 Range，而瀏覽器拿到不支援 Range 的音檔會
// 把它當成「這次載入不可跳轉」——點進度條完全沒反應，歌詞當然也跟不上。
// 同樣的坑 family-feast 也踩過，解法一樣：自己讀出來、自己回 206。
const AUDIO_PREFIX = '/audio/';
async function serveAudio(req, env, url) {
  const name = decodeURIComponent(url.pathname.slice(AUDIO_PREFIX.length));
  // 只放行 public/ambient/music/ 底下的檔名，別讓路徑跑出去
  if (!/^[\w .,'()\u4e00-\u9fff-]+\.mp3$/.test(name)) return new Response('bad name', { status: 400 });
  const asset = new URL('/ambient/music/' + encodeURIComponent(name), url.origin);
  const res = await env.ASSETS.fetch(new Request(asset.toString(), { headers: { 'accept-encoding': 'identity' } }));
  if (!res.ok) return new Response('not found', { status: 404 });
  const buf = await res.arrayBuffer();
  const len = buf.byteLength;
  const head = {
    'content-type': 'audio/mpeg',
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=31536000, immutable',
  };
  const range = req.headers.get('range');
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m) return new Response(buf, { headers: { ...head, 'content-length': String(len) } });
  let start = m[1] === '' ? len - Number(m[2]) : Number(m[1]);
  let end = m[1] === '' || m[2] === '' ? len - 1 : Number(m[2]);
  start = Math.max(0, Math.min(start, len - 1));
  end = Math.max(start, Math.min(end, len - 1));
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: { ...head, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${len}` },
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/') {
      return Response.redirect(url.origin + '/host', 302);
    }
    if (url.pathname.startsWith(AUDIO_PREFIX)) return serveAudio(req, env, url);
    if (url.pathname === '/api/room') return serveMint(req, env, url);
    const m = url.pathname.match(ROOM_RE);
    if (m) {
      const roomId = m[2].toUpperCase();
      // ⚠️ 這一段一定要在 env.ROOM.get() **之前**。拿到 stub 就等於生出 DO 了，
      // 之後才拒絕已經來不及——費用是從那一刻開始算的。
      // 只有 /ws 是玩家也要進來的;/export /close /whereami 都只有主控台在用
      //(client.html 完全不碰),所以要求 host 憑證。/export 會吐出整場遙測,
      // 含其他玩家的裝置指紋 —— 那不該是「掃過 QR 就看得到」的東西。
      const hostOnly = m[1] !== 'ws';
      if (env.ROOM_SECRET) {
        const role = await tokenRole(env.ROOM_SECRET, roomId, url.searchParams.get('t'));
        if (!role) return new Response('room token required', { status: 403 });
        if (hostOnly && role !== 'host') return new Response('host token required', { status: 403 });
      }
      const id = env.ROOM.idFromName(roomId);
      // locationHint 只在 DO 第一次被建立時生效（同房號之後怎麼帶都不會搬家）。
      // 實測：台灣 HiNet 家用寬頻對這個 zone 在 SJC（美西）入網，DO 放 apac
      // 反而要從美西繞回亞洲（RTT ~360ms）；跟著入網點放 wnam 只要 ~150ms。
      // 入網點因 ISP／方案而異，所以做成可用 ?hint= 切換，開新房 A/B 實測。
      const HINTS = new Set(['wnam', 'enam', 'sam', 'weur', 'eeur', 'apac', 'oc', 'afr', 'me']);
      const hintParam = url.searchParams.get('hint');
      const stub = env.ROOM.get(id, { locationHint: HINTS.has(hintParam) ? hintParam : 'wnam' });
      if (m[1] === 'whereami') {
        const fwd = new Request(req);
        fwd.headers.set('x-edge-colo', req.cf?.colo || '?');
        return stub.fetch(fwd);
      }
      return stub.fetch(req);
    }
    return new Response('Not found', { status: 404 });
  },
};
