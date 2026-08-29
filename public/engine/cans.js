// cans.js — 砸罐子：pixel 2.5D 材質渲染（移植自 can_knockdown mockup）＋輕量物理
// 全員齊砸同一座塔：host 是唯一的模擬者與渲染者，丟球是離散事件所以延遲無感。
// 物理刻意簡化：拋物線投射＋AABB＋「支撐被打掉就倒」，不用物理引擎。
(function () {
  const C = (window.CANS = {});

  const P = {
    sky: '#749fab', sky2: '#a9c6bd', ridge: '#566a56',
    dirt: '#96684a', dirt2: '#744b3a', dirt3: '#b88359', dirt4: '#5b3e33',
    dark: '#26262d', black: '#17171b', white: '#f4ecdc',
    strawF: '#d1ad49', strawT: '#eed06a', strawS: '#99702e', strawD: '#6f4f29',
    woodF: '#965b38', woodT: '#c47c49', woodS: '#643b2b', woodD: '#492d25',
    brickF: '#9f483b', brickT: '#c86650', brickS: '#6d342f', mortar: '#d0ae93',
    ironF: '#747d85', ironT: '#aeb5b9', ironS: '#4a5058', ironD: '#30343a', ironHi: '#d8dee2', rust: '#98563a',
    stoneF: '#807d72', stoneT: '#aaa69b', stoneS: '#5b5953', stoneD: '#46443f',
    bombF: '#313139', bombT: '#555660', bombS: '#1e1f24', fuse: '#d2bd89',
    fire: '#f5d45d', orange: '#e98336', red: '#ca4c37',
  };
  C.PAL = P;

  // HP／重量表：跟 mockup 一致，是難度曲線的地基
  const M = C.M = {
    straw: { w: 128, h: 64, hp: 1, mass: 1 },
    barrel: { w: 72, h: 132, hp: 2, mass: 2 },
    beam: { w: 136, h: 62, hp: 2, mass: 2 },
    brick: { w: 132, h: 132, hp: 3, mass: 3 },
    iron: { w: 72, h: 132, hp: 5, mass: 5 },
    stone: { w: 132, h: 68, hp: 4, mass: 4 },
    bomb: { w: 64, h: 64, hp: 1, mass: 1 },
  };

  // 五關佈局（mockup 原樣）：關 1 草捆木桶 → 關 5 鐵桶石塊雙炸彈連鎖
  C.LEVELS = {
    1: [{ t: 'straw', x: 420, y: 438 }, { t: 'barrel', x: 452, y: 306 }],
    2: [{ t: 'barrel', x: 350, y: 306 }, { t: 'barrel', x: 570, y: 306 }, { t: 'beam', x: 390, y: 390 }, { t: 'straw', x: 412, y: 326 }],
    3: [{ t: 'brick', x: 300, y: 340 }, { t: 'brick', x: 540, y: 340 }, { t: 'beam', x: 420, y: 306 }, { t: 'bomb', x: 455, y: 410 }],
    4: [{ t: 'iron', x: 300, y: 304 }, { t: 'iron', x: 620, y: 304 }, { t: 'brick', x: 390, y: 340 }, { t: 'stone', x: 460, y: 286 }, { t: 'bomb', x: 500, y: 414 }],
    5: [{ t: 'iron', x: 250, y: 304 }, { t: 'brick', x: 330, y: 340 }, { t: 'brick', x: 462, y: 340 }, { t: 'iron', x: 660, y: 304 },
        { t: 'beam', x: 345, y: 306 }, { t: 'beam', x: 520, y: 306 }, { t: 'stone', x: 420, y: 244 }, { t: 'bomb', x: 465, y: 414 },
        { t: 'barrel', x: 405, y: 112 }, { t: 'barrel', x: 535, y: 112 }, { t: 'beam', x: 438, y: 188 }],
  };

  C.W = 960; C.H = 600;
  const GROUND_Y = 544;        // 平台頂（mockup 的 base 在 530+14）
  const PLAT_L = 230, PLAT_R = 750;
  const GRAV = 1500;

  // ---- 世界 ----
  // mockup 的座標是「視覺擺位」不是物理位置（物件浮在平台上方 60-100px），
  // 所以建關時先沉降：由低往高，每個物件坐到地面或下方有重疊的物件頂上。
  function settle(ents) {
    const sorted = [...ents].sort((a, b) => (b.y + b.h) - (a.y + a.h));
    const placed = [];
    for (const e of sorted) {
      let floor = GROUND_Y;
      for (const p of placed) {
        const overlap = Math.min(e.x + e.w, p.x + p.w) - Math.max(e.x, p.x);
        if (overlap > Math.min(e.w, p.w) * 0.3) floor = Math.min(floor, p.y);
      }
      e.y = floor - e.h;
      placed.push(e);
    }
  }
  C.build = function (level) {
    const ents = C.LEVELS[level].map((o, i) => ({
      id: i, t: o.t, x: o.x, y: o.y, w: M[o.t].w, h: M[o.t].h,
      hp: M[o.t].hp, maxHp: M[o.t].hp, mass: M[o.t].mass,
      vx: 0, vy: 0, rot: 0, vr: 0, loose: false, dead: false, lastHitBy: null, hitAt: 0,
    }));
    settle(ents);
    return { level, ents, balls: [], debris: [], events: [], totalHp: ents.reduce((s, e) => s + e.hp, 0) };
  };

  // 丟球：angle 度（0=水平往右，正=往上）、power 0-1、owner=玩家 index
  C.throwBall = function (world, angle, power, owner, ownerId) {
    const a = (Math.max(12, Math.min(80, angle)) * Math.PI) / 180;
    const v = 640 + power * 760;
    world.balls.push({
      x: 150, y: 452, vx: Math.cos(a) * v, vy: -Math.sin(a) * v,
      r: 13, owner, ownerId, alive: true, trail: [],
    });
  };

  function award(world, ball, kind, pts, x, y) {
    world.events.push({ kind, pts, owner: ball ? ball.owner : null, ownerId: ball ? ball.ownerId : null, x, y });
  }

  function explode(world, ent) {
    ent.dead = true;
    const cx = ent.x + ent.w / 2, cy = ent.y + ent.h / 2;
    world.boomFx = { x: cx, y: cy, t: 0.5 };
    const src = ent._killerBall || null;
    award(world, src, 'boom', 3, cx, cy);
    for (const o of world.ents) {
      if (o.dead || o === ent) continue;
      const ox = o.x + o.w / 2, oy = o.y + o.h / 2;
      const d = Math.hypot(ox - cx, oy - cy);
      if (d > 230) continue;
      const k = (230 - d) / 230;
      o.hp -= 2;
      o.loose = true;
      o.vx += ((ox - cx) / (d || 1)) * 480 * k / o.mass;
      o.vy += (((oy - cy) / (d || 1)) * 300 - 260) * k / o.mass;
      o.vr += (ox > cx ? 1 : -1) * 2.2 * k;
      o.lastHitBy = src; o.hitAt = 0;
      if (src) award(world, src, 'chain', 1, ox, oy);
      if (o.hp <= 0 && o.t === 'bomb') { o._killerBall = src; queueBoom(world, o); }
      else if (o.hp <= 0) breakEnt(world, o, src);
    }
  }
  const boomQ = [];
  function queueBoom(world, ent) { boomQ.push([world, ent]); }

  function breakEnt(world, ent, ball) {
    ent.dead = true;
    award(world, ball, 'break', 2, ent.x + ent.w / 2, ent.y + ent.h / 2);
    const n = 6 + ent.mass * 2;
    for (let i = 0; i < n; i++) {
      world.debris.push({
        x: ent.x + Math.random() * ent.w, y: ent.y + Math.random() * ent.h,
        vx: (Math.random() - .5) * 420, vy: -Math.random() * 380 - 60,
        s: 5 + Math.random() * 9, t: ent.t, life: 1.4,
      });
    }
  }

  function supported(world, e) {
    const bottom = e.y + e.h;
    if (bottom >= GROUND_Y - 8 && e.x + e.w > PLAT_L && e.x < PLAT_R) return true;
    for (const o of world.ents) {
      if (o === e || o.dead || o.loose) continue;
      const overlap = Math.min(e.x + e.w, o.x + o.w) - Math.max(e.x, o.x);
      if (overlap > e.w * 0.3 && Math.abs(o.y - bottom) < 12) return true;
    }
    return false;
  }

  C.step = function (world, dt) {
    world.events.length = 0;
    // 球
    for (const b of world.balls) {
      if (!b.alive) continue;
      b.trail.push([b.x, b.y]); if (b.trail.length > 9) b.trail.shift();
      b.vy += GRAV * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.y > C.H + 40 || b.x > C.W + 60 || b.x < -60) { b.alive = false; continue; }
      for (const e of world.ents) {
        if (e.dead) continue;
        const nx = Math.max(e.x, Math.min(e.x + e.w, b.x));
        const ny = Math.max(e.y, Math.min(e.y + e.h, b.y));
        if (Math.hypot(b.x - nx, b.y - ny) > b.r) continue;
        const speed = Math.hypot(b.vx, b.vy);
        if (speed > 160) {
          const dmg = speed > 780 ? 2 : 1;
          e.hp -= dmg;
          e.lastHitBy = b; e.hitAt = 0;
          award(world, b, 'chip', dmg, b.x, b.y);
          e.loose = true;
          e.vx += b.vx * 0.16 / e.mass;
          e.vy += (b.vy * 0.10 - 90) / e.mass;
          e.vr += (b.vx > 0 ? 1 : -1) * (1.4 / e.mass);
          if (e.hp <= 0) {
            if (e.t === 'bomb') { e._killerBall = b; queueBoom(world, e); }
            else breakEnt(world, e, b);
          }
        }
        // 反彈後繼續飛，一顆球可以掃到多個物件
        const dx = b.x - (e.x + e.w / 2), dy = b.y - (e.y + e.h / 2);
        if (Math.abs(dx / (e.w / 2)) > Math.abs(dy / (e.h / 2))) b.vx = Math.abs(b.vx) * .42 * Math.sign(dx);
        else b.vy = Math.abs(b.vy) * .42 * Math.sign(dy);
      }
    }
    while (boomQ.length) { const [w2, e2] = boomQ.shift(); if (!e2._boomed) { e2._boomed = true; explode(w2, e2); } }
    world.balls = world.balls.filter((b) => b.alive);

    // 物件：支撐檢查 → 掉落／滑動
    for (const e of world.ents) {
      if (e.dead) continue;
      e.hitAt += dt;
      if (!e.loose && !supported(world, e)) { e.loose = true; e.vr = (Math.random() - .5) * 1.6; }
      if (e.loose) {
        e.vy += GRAV * dt;
        e.x += e.vx * dt; e.y += e.vy * dt; e.rot += e.vr * dt;
        e.vx *= 0.995;
        const bottom = e.y + e.h;
        if (bottom > GROUND_Y && e.x + e.w > PLAT_L && e.x < PLAT_R && Math.abs(e.rot) < 0.9) {
          e.y = GROUND_Y - e.h;
          if (Math.abs(e.vy) < 130) { e.vy = 0; e.vx *= .5; e.vr *= .5; if (Math.abs(e.vx) < 12) { e.loose = false; e.rot *= .6; } }
          else e.vy = -e.vy * .22;
        }
        if (e.y > C.H + 60 || e.x + e.w < PLAT_L - 160 || e.x > PLAT_R + 160) {
          e.dead = true;
          award(world, e.lastHitBy && e.hitAt < 3 ? e.lastHitBy : null, 'knock', 2, e.x + e.w / 2, Math.min(e.y, C.H - 30));
        }
      }
    }
    // 碎片
    for (const d of world.debris) { d.vy += GRAV * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt; }
    world.debris = world.debris.filter((d) => d.life > 0 && d.y < C.H + 40);
    if (world.boomFx) { world.boomFx.t -= dt; if (world.boomFx.t <= 0) world.boomFx = null; }
    return world.events;
  };

  C.destroyedRatio = function (world) {
    let left = 0;
    for (const e of world.ents) if (!e.dead) left += Math.max(0, e.hp);
    return 1 - left / world.totalHp;
  };

  // ---- 渲染（mockup 材質原樣移植）----
  function R(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  function L(g, x1, y1, x2, y2, c, w = 2) {
    g.strokeStyle = c; g.lineWidth = w; g.beginPath();
    g.moveTo(Math.round(x1) + .5, Math.round(y1) + .5); g.lineTo(Math.round(x2) + .5, Math.round(y2) + .5); g.stroke();
  }
  function poly(g, pts, c) {
    g.fillStyle = c; g.beginPath(); g.moveTo(Math.round(pts[0][0]), Math.round(pts[0][1]));
    for (let i = 1; i < pts.length; i++) g.lineTo(Math.round(pts[i][0]), Math.round(pts[i][1]));
    g.closePath(); g.fill();
  }
  function shadow(g, x, y, w, depth, alpha = .26) {
    g.save(); g.globalAlpha = alpha;
    poly(g, [[x + 10, y], [x + w + 12, y - 2], [x + w + depth + 36, y + 18], [x + depth + 30, y + 22]], P.black);
    g.restore();
  }
  function box3d(g, x, y, w, h, d, front, top, side) {
    const dx = Math.round(d * .72), dy = Math.round(d * .38);
    poly(g, [[x, y], [x + dx, y - dy], [x + w + dx, y - dy], [x + w, y]], top);
    poly(g, [[x + w, y], [x + w + dx, y - dy], [x + w + dx, y + h - dy], [x + w, y + h]], side);
    R(g, x, y, w, h, front);
    return { dx, dy };
  }
  function straw(g, x, y, damage) {
    const d = 34, { dx, dy } = box3d(g, x, y, 128, 64, d, P.strawF, P.strawT, P.strawS);
    shadow(g, x, y + 67, 128, d);
    for (let row = 0; row < 4; row++) for (let i = 0; i < 9; i++) {
      const xx = x + 7 + i * 13 + (row % 2) * 4, yy = y + 8 + row * 13;
      R(g, xx, yy, 12, 4, P.strawT); L(g, xx - 3, yy + 8, xx + 8, yy + 1, P.strawS, 2);
    }
    for (let i = 0; i < 8; i++) L(g, x + 9 + i * 15, y - 2, x + dx + 4 + i * 13, y - dy + 7, P.strawS, 2);
    R(g, x + 59, y - 2, 8, 68, P.strawD);
    poly(g, [[x + 59, y - 2], [x + 59 + dx, y - dy - 2], [x + 67 + dx, y - dy - 2], [x + 67, y - 2]], P.strawD);
    if (damage) { R(g, x + 43, y + 18, 14, 11, P.strawS); L(g, x + 18, y + 3, x + 3, y - 11, P.strawT, 3); L(g, x + 105, y + 48, x + 135, y + 60, P.strawT, 3); }
  }
  function beam(g, x, y, damage) {
    const d = 38, { dx, dy } = box3d(g, x, y, 136, 62, d, P.woodF, P.woodT, P.woodS);
    shadow(g, x, y + 65, 136, d);
    R(g, x + 7, y + 8, 120, 8, P.woodT);
    for (let i = 0; i < 4; i++) L(g, x + 17 + i * 29, y + 25 + (i % 2) * 5, x + 33 + i * 27, y + 29 + (i % 2) * 5, P.woodD, 3);
    for (let i = 0; i < 4; i++) L(g, x + 18 + i * 29 + dx * .2, y - dy * .2 - 3, x + 29 + i * 28 + dx * .65, y - dy * .7 - 5, P.woodS, 2);
    R(g, x + 6, y + 53, 124, 6, P.woodD);
    if (damage) { L(g, x + 66, y + 4, x + 59, y + 31, P.dark, 4); L(g, x + 59, y + 31, x + 74, y + 54, P.dark, 4); }
  }
  function brick(g, x, y, damage) {
    const d = 44, { dx, dy } = box3d(g, x, y, 132, 132, d, P.brickF, P.brickT, P.brickS);
    shadow(g, x, y + 135, 132, d);
    for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) {
      const off = (yy % 2) * 16, bx = x + xx * 32 - off, by = y + yy * 32;
      if (bx < x || bx + 28 > x + 132) continue;
      R(g, bx + 3, by + 4, 26, 23, P.brickF); R(g, bx + 5, by + 6, 20, 5, P.brickT);
    }
    for (let yy = 31; yy < 132; yy += 32) R(g, x, y + yy, 132, 5, P.mortar);
    for (let row = 0; row < 4; row++) {
      const off = (row % 2) * 16;
      for (let xx = 32 - off; xx < 132; xx += 32) R(g, x + xx - 2, y + row * 32, 5, 31, P.mortar);
    }
    for (let i = 0; i < 4; i++) poly(g, [
      [x + i * 32 + 4, y - 1], [x + i * 32 + 4 + dx, y - dy - 1],
      [x + i * 32 + 28 + dx, y - dy - 1], [x + i * 32 + 28, y - 1],
    ], i % 2 ? P.brickT : '#b65747');
    if (damage) {
      L(g, x + 72, y + 6, x + 58, y + 36, P.dark, 5); L(g, x + 58, y + 36, x + 81, y + 63, P.dark, 5);
      L(g, x + 81, y + 63, x + 61, y + 95, P.dark, 5); R(g, x + 92, y + 52, 18, 15, P.brickS);
    }
  }
  function stone(g, x, y, damage) {
    const d = 46, { dx, dy } = box3d(g, x, y + 7, 132, 61, d, P.stoneF, P.stoneT, P.stoneS);
    shadow(g, x, y + 73, 132, d);
    R(g, x + 8, y + 12, 114, 51, P.stoneF); R(g, x + 15, y + 17, 80, 8, P.stoneT);
    L(g, x + 32, y + 20, x + 21, y + 50, P.stoneS, 3); L(g, x + 86, y + 18, x + 102, y + 50, P.stoneS, 3);
    poly(g, [[x + 6, y + 7], [x + dx + 9, y + 7 - dy], [x + dx + 28, y + 7 - dy], [x + 18, y + 7]], P.stoneT);
    if (damage) { L(g, x + 63, y + 12, x + 73, y + 31, P.dark, 4); L(g, x + 73, y + 31, x + 60, y + 62, P.dark, 4); }
  }
  function barrel(g, x, y, damage, metal) {
    const f = metal ? P.ironF : P.woodF, t = metal ? P.ironT : P.woodT, s = metal ? P.ironS : P.woodS;
    shadow(g, x, y + 136, 72, 32, .3);
    R(g, x + 16, y, 40, 5, s); R(g, x + 10, y + 5, 52, 7, s); R(g, x + 7, y + 12, 58, 10, f);
    R(g, x + 13, y + 7, 46, 6, t); R(g, x + 18, y + 5, 35, 4, metal ? P.ironHi : P.woodT);
    R(g, x + 6, y + 18, 60, 95, s); R(g, x + 10, y + 19, 52, 94, f); R(g, x + 17, y + 22, 10, 88, t);
    R(g, x + 7, y + 112, 58, 10, s); R(g, x + 12, y + 122, 48, 6, s);
    poly(g, [[x + 62, y + 20], [x + 72, y + 14], [x + 72, y + 105], [x + 62, y + 113]], s);
    for (const yy of [22, 58, 100]) { R(g, x + 5, y + yy, 62, 8, metal ? P.ironD : '#3e4147'); R(g, x + 10, y + yy + 1, 52, 2, metal ? P.ironT : '#686b72'); }
    if (!metal) { L(g, x + 34, y + 34, x + 34, y + 95, P.woodD, 4); L(g, x + 49, y + 37, x + 46, y + 92, P.woodT, 3); }
    else { R(g, x + 45, y + 37, 8, 18, P.rust); R(g, x + 15, y + 86, 7, 15, P.rust); R(g, x + 50, y + 91, 5, 9, P.rust); }
    if (damage) {
      if (metal) { R(g, x + 37, y + 62, 16, 20, P.ironS); R(g, x + 41, y + 66, 9, 12, P.dark); }
      else { L(g, x + 21, y + 43, x + 48, y + 68, P.dark, 4); L(g, x + 48, y + 68, x + 27, y + 94, P.dark, 4); }
    }
  }
  function bomb(g, x, y, lit) {
    shadow(g, x, y + 68, 64, 34, .3);
    R(g, x + 19, y + 7, 27, 5, P.bombS); R(g, x + 12, y + 12, 41, 8, P.bombF); R(g, x + 8, y + 20, 49, 27, P.bombF);
    R(g, x + 12, y + 47, 41, 9, P.bombS); R(g, x + 19, y + 56, 27, 5, P.bombS);
    R(g, x + 17, y + 17, 14, 9, P.bombT);
    R(g, x + 27, y + 3, 17, 9, P.bombT); R(g, x + 42, y - 8, 7, 14, P.fuse);
    if (lit) { R(g, x + 49, y - 14, 10, 10, P.orange); R(g, x + 55, y - 19, 8, 8, P.fire); R(g, x + 61, y - 12, 5, 5, P.red); }
    else R(g, x + 50, y - 12, 5, 5, P.orange);
  }
  function drawEnt(g, e) {
    const damage = e.hp < e.maxHp ? 1 : 0;
    if (e.rot) { g.save(); g.translate(e.x + e.w / 2, e.y + e.h / 2); g.rotate(e.rot); g.translate(-(e.x + e.w / 2), -(e.y + e.h / 2)); }
    if (e.t === 'straw') straw(g, e.x, e.y, damage);
    else if (e.t === 'barrel') barrel(g, e.x, e.y, damage, false);
    else if (e.t === 'beam') beam(g, e.x, e.y, damage);
    else if (e.t === 'brick') brick(g, e.x, e.y, damage);
    else if (e.t === 'iron') barrel(g, e.x, e.y, damage, true);
    else if (e.t === 'stone') stone(g, e.x, e.y, damage);
    else if (e.t === 'bomb') bomb(g, e.x, e.y, damage ? 1 : 0);
    if (e.rot) g.restore();
  }
  function ground(g) {
    const w = C.W, h = C.H;
    R(g, 0, 0, w, h, P.sky); R(g, 0, 135, w, 105, P.sky2);
    g.fillStyle = P.ridge; g.beginPath(); g.moveTo(0, 245);
    for (let x = 0; x <= w; x += 60) g.lineTo(x, 215 - ((x / 60) % 4) * 10);
    g.lineTo(w, 260); g.lineTo(0, 260); g.fill();
    R(g, 0, 235, w, h - 235, P.dirt);
    for (let y = 248; y < h; y += 24) {
      const t = (y - 235) / (h - 235);
      if (Math.floor((y - 235) / 24) % 2 === 0) R(g, 0, y, w, 7, P.dirt2);
      for (let x = ((y * 11) % 71); x < w; x += 79 - Math.floor(t * 14)) R(g, x, y + 12, 6 + Math.floor(t * 3), 3, P.dirt3);
    }
    poly(g, [[65, h], [260, 260], [278, 260], [145, h]], P.dirt2);
    poly(g, [[210, h], [330, 260], [340, 260], [290, h]], P.dirt3);
    // 發射台與底座
    R(g, 68, 477, 120, 11, P.dirt4); R(g, 88, 493, 92, 6, P.dirt3);
    R(g, 132, 436, 42, 42, P.black); R(g, 143, 445, 13, 11, P.ironT);
    R(g, PLAT_L, 530, PLAT_R - PLAT_L, 14, P.dirt4); R(g, PLAT_L + 20, 522, PLAT_R - PLAT_L - 40, 8, P.dirt3);
  }
  const DEBRIS_COL = { straw: P.strawT, barrel: P.woodT, beam: P.woodF, brick: P.brickT, iron: P.ironT, stone: P.stoneT, bomb: P.bombT };

  // aims: [{idx, angle, active}] 各玩家的瞄準箭頭；colors: 玩家色
  C.render = function (g, world, colors, aims) {
    g.imageSmoothingEnabled = false;
    ground(g);
    const ents = [...world.ents].filter((e) => !e.dead).sort((a, b) => (a.y + a.h) - (b.y + b.h));
    for (const e of ents) drawEnt(g, e);
    for (const d of world.debris) { g.globalAlpha = Math.min(1, d.life); R(g, d.x, d.y, d.s, d.s, DEBRIS_COL[d.t] || P.white); g.globalAlpha = 1; }
    for (const b of world.balls) {
      const col = colors[b.owner % colors.length];
      for (let i = 0; i < b.trail.length; i++) {
        g.globalAlpha = (i / b.trail.length) * .5;
        R(g, b.trail[i][0] - 4, b.trail[i][1] - 4, 8, 8, col);
      }
      g.globalAlpha = 1;
      R(g, b.x - b.r, b.y - b.r * .6, b.r * 2, b.r * 1.2, '#20222a');
      R(g, b.x - b.r * .6, b.y - b.r, b.r * 1.2, b.r * 2, '#20222a');
      R(g, b.x - b.r * .55, b.y - b.r * .55, b.r * 1.1, b.r * 1.1, col);
    }
    if (world.boomFx) {
      const f = world.boomFx, k = 1 - f.t / 0.5;
      for (let r = 30; r <= 150; r += 30) {
        const rr = r * (0.5 + k);
        g.strokeStyle = r < 65 ? P.fire : (r < 120 ? P.orange : P.red); g.lineWidth = 7;
        g.globalAlpha = 1 - k * .8;
        g.strokeRect(f.x - rr, f.y - rr, rr * 2, rr * 2);
      }
      g.globalAlpha = 1;
    }
    // 各玩家的瞄準箭頭（球在手上才顯示），沿發射台扇形排
    for (const a of aims || []) {
      if (!a.active) continue;
      const rad = (a.angle * Math.PI) / 180;
      const col = colors[a.idx % colors.length];
      const x0 = 150, y0 = 452, len = 64 + (a.idx % 4) * 10;
      const x1 = x0 + Math.cos(rad) * len, y1 = y0 - Math.sin(rad) * len;
      g.strokeStyle = col; g.lineWidth = 5; g.globalAlpha = .85;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.beginPath(); g.moveTo(x1, y1);
      g.lineTo(x1 - Math.cos(rad - .45) * 13, y1 + Math.sin(rad - .45) * 13);
      g.lineTo(x1 - Math.cos(rad + .45) * 13, y1 + Math.sin(rad + .45) * 13);
      g.closePath(); g.fillStyle = col; g.fill();
      g.globalAlpha = 1;
    }
  };
})();
