import { RoomDO } from './room.js';
export { RoomDO };

// close 是「逃生鈕」：不用開著那個房間的分頁也能把它關掉。
// 房號本來就是進得去的憑證（掃 QR 就能加入），所以這裡不另外設密碼——
// 能關掉一個自己知道房號的房間，比忘記關讓它繼續計費好。
const ROOM_RE = /^\/(ws|export|whereami|close)\/([A-Za-z0-9]{4,8})$/;

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
    const m = url.pathname.match(ROOM_RE);
    if (m) {
      const roomId = m[2].toUpperCase();
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
