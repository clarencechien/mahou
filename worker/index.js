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
