import { RoomDO } from './room.js';
export { RoomDO };

const ROOM_RE = /^\/(ws|export|whereami)\/([A-Za-z0-9]{4,8})$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/') {
      return Response.redirect(url.origin + '/host', 302);
    }
    const m = url.pathname.match(ROOM_RE);
    if (m) {
      const roomId = m[2].toUpperCase();
      const id = env.ROOM.idFromName(roomId);
      // locationHint 只在 DO 第一次被建立時生效。家宴場景在台灣：
      // 沒有 hint 時 DO 可能落在美西，光是 DO 距離就吃掉 130ms+ RTT。
      const stub = env.ROOM.get(id, { locationHint: 'apac' });
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
