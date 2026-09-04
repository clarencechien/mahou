/* 房間憑證。index.js(簽發／守門)與 room.js(推導角色)共用,所以獨立成一支
   —— 讓 room.js 去 import index.js 會變成循環相依。

   ⚠️ 為什麼要分角色(2026-09-04):原本只有一種 token,而它是印在 QR 上、
   每個玩家都拿得到的。WebSocket 的 host/client 又只看 `?role=host` 這個查詢參數,
   等於任何掃過 QR 的人都能以主控身分連進來:結束房間、改計分、提前結算、
   在木頭人那局偷看答案。所以主控要拿的是**另一張**簽在不同訊息上的憑證。 */

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}

/** 簽章的訊息。client 維持舊格式,所以既有的 QR 連結不會失效 */
const payload = (room, exp, role) => (role === 'host' ? `${room}.${exp}.host` : `${room}.${exp}`);

export async function mintToken(secret, room, exp, role = 'client') {
  return `${exp.toString(36)}.${(await hmac(secret, payload(room, exp, role))).slice(0, 32)}`;
}

/** 常數時間比對:長度先比,再逐字元 XOR 累加,不要用 === 提早結束 */
function sameSig(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function tokenOk(secret, room, token, role = 'client') {
  if (!token) return false;
  const [expPart, sig] = String(token).split('.');
  const exp = parseInt(expPart, 36);
  if (!exp || Date.now() > exp) return false;
  if (typeof sig !== 'string') return false;
  return sameSig(sig, (await hmac(secret, payload(room, exp, role))).slice(0, 32));
}

/**
 * token 對應的角色:'host' | 'client' | null(不是有效憑證)。
 * 角色只能從**簽章**推導,不能從查詢參數 —— 那是玩家可以自己寫的。
 */
export async function tokenRole(secret, room, token) {
  if (await tokenOk(secret, room, token, 'host')) return 'host';
  if (await tokenOk(secret, room, token, 'client')) return 'client';
  return null;
}
