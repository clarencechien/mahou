import { RoomDO } from './room.js';
export { RoomDO };

const ROOM_RE = /^\/(ws|export)\/([A-Za-z0-9]{4,8})$/;

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
      return env.ROOM.get(id).fetch(req);
    }
    return new Response('Not found', { status: 404 });
  },
};
