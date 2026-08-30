// cans.js — 砸罐子：第一人稱假 3D。鏡頭不動，飛走的是物件。
//
// 投影跟 Mode 7 地面共用同一組世界座標，所以物件永遠踩在地上：
//   renderInto 裡 z = f/dy、wy = z*165、wx = (lx-W/2)*z/f*112
//   → 深度 D（= M7 的 wy）處，每一世界單位佔 k = f*165/(112*D) 像素
//   → sx = W/2 + X*k、sy = horizon + (112 - Y)*k   （鏡頭高度剛好是 112）
// 深度 90-200 是塔的甜蜜點：132 寬的磚牆在畫面上是 194→88px。
//
// 材質沿用原本的 2.5D 畫法，但每種只畫一次進離屏 canvas（風格聖經：畫一次快取），
// 之後靠 drawImage 縮放＋旋轉，所以砸飛時可以翻滾、可以衝到鏡頭前放大。
(function () {
  const C = (window.CANS = {});

  const P = {
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

  // 世界尺寸就是精靈的像素尺寸；HP／重量沿用 mockup，是難度曲線的地基
  const M = C.M = {
    straw: { w: 128, h: 64, d: 34, hp: 1, mass: 1, label: '草捆' },
    barrel: { w: 72, h: 132, d: 32, hp: 2, mass: 2, label: '木桶' },
    beam: { w: 136, h: 62, d: 38, hp: 2, mass: 2, label: '橫樑' },
    brick: { w: 132, h: 132, d: 44, hp: 3, mass: 3, label: '磚牆' },
    iron: { w: 72, h: 132, d: 32, hp: 5, mass: 5, label: '鐵桶' },
    stone: { w: 132, h: 68, d: 46, hp: 4, mass: 4, label: '石塊' },
    bomb: { w: 64, h: 64, d: 34, hp: 1, mass: 1, label: '炸彈' },
  };

  C.W = 960; C.H = 600;
  C.F = 90; C.HORIZON = 200;
  const CAM_H = 112;                       // 由 M7 的 112 常數決定，不能亂改
  const U = C.F * 165 / CAM_H;             // k=1 的深度（132.6）
  const GRAV = 900;
  const LAUNCH = { x: 0, y: 54, z: 26 };   // 出手點：畫面下緣稍前方

  C.kAt = (z) => U / Math.max(1, z);
  C.project = function (x, y, z) {
    if (z < 6) return null;                // 已經衝過鏡頭
    const k = U / z;
    return { sx: C.W / 2 + x * k, sy: C.HORIZON + (CAM_H - y) * k, k };
  };
  // 螢幕（正規化 0-1）→ 從鏡頭射出的方向向量
  C.ray = function (nx, ny) {
    return { x: nx * C.W - C.W / 2, y: -(ny * C.H - C.HORIZON), z: U };
  };

  // ---- 關卡：x 橫向、y 底部高度（0=地面）、z 深度 ----
  // 版面規則（有 tools 的驗證器把關，見 docs/games.md）：
  //   深度 z 處的高度上限 ≈ 112 + 1.40z（再高就頂出畫面）
  //   橫向上限 ≈ 3.57z（再寬就出左右邊）
  //   要疊上去的物件，x 重疊必須 > 下方物件寬度的 1/4，否則會判定沒支撐而垮掉
  //   炸彈要放在「彈道清得掉」的位置——被前排擦到就永遠引爆不了
  C.LEVELS = {
    1: [{ t: 'straw', x: -85, y: 0, z: 120 }, { t: 'straw', x: 85, y: 0, z: 120 },
        { t: 'straw', x: -85, y: 64, z: 120 }, { t: 'straw', x: 85, y: 64, z: 120 },
        { t: 'barrel', x: -85, y: 128, z: 120 }, { t: 'barrel', x: 85, y: 128, z: 120 },
        { t: 'straw', x: 0, y: 0, z: 175 }, { t: 'barrel', x: 0, y: 64, z: 175 }],
    2: [{ t: 'barrel', x: -68, y: 0, z: 125 }, { t: 'barrel', x: 68, y: 0, z: 125 },
        { t: 'beam', x: 0, y: 132, z: 125 }, { t: 'straw', x: 0, y: 194, z: 125 },
        { t: 'brick', x: -190, y: 0, z: 175 }, { t: 'brick', x: 190, y: 0, z: 175 },
        { t: 'barrel', x: -190, y: 132, z: 175 }, { t: 'barrel', x: 190, y: 132, z: 175 },
        { t: 'straw', x: 0, y: 0, z: 125 }],
    3: [{ t: 'brick', x: -95, y: 0, z: 130 }, { t: 'brick', x: 95, y: 0, z: 130 },
        { t: 'beam', x: 0, y: 132, z: 130 }, { t: 'straw', x: 0, y: 194, z: 130 },
        { t: 'bomb', x: 0, y: 0, z: 92 },
        { t: 'stone', x: -155, y: 0, z: 185 }, { t: 'stone', x: 155, y: 0, z: 185 },
        { t: 'iron', x: 0, y: 0, z: 195 }],
    4: [{ t: 'iron', x: -150, y: 0, z: 135 }, { t: 'iron', x: 150, y: 0, z: 135 },
        { t: 'brick', x: 0, y: 0, z: 135 }, { t: 'stone', x: 0, y: 132, z: 135 },
        { t: 'beam', x: 0, y: 200, z: 135 },
        { t: 'bomb', x: -235, y: 0, z: 80 }, { t: 'bomb', x: 235, y: 0, z: 80 },
        { t: 'brick', x: -175, y: 0, z: 190 }, { t: 'brick', x: 175, y: 0, z: 190 },
        { t: 'barrel', x: 0, y: 0, z: 200 }],
    5: [{ t: 'iron', x: -195, y: 0, z: 170 }, { t: 'iron', x: 195, y: 0, z: 170 },
        { t: 'brick', x: -70, y: 0, z: 170 }, { t: 'brick', x: 70, y: 0, z: 170 },
        { t: 'beam', x: -70, y: 132, z: 170 }, { t: 'beam', x: 70, y: 132, z: 170 },
        { t: 'stone', x: 0, y: 194, z: 170 }, { t: 'bomb', x: 0, y: 262, z: 170 },
        { t: 'bomb', x: -235, y: 0, z: 85 }, { t: 'bomb', x: 235, y: 0, z: 85 },
        { t: 'straw', x: -160, y: 0, z: 100 }, { t: 'straw', x: 160, y: 0, z: 100 },
        { t: 'iron', x: -90, y: 0, z: 225 }, { t: 'iron', x: 90, y: 0, z: 225 },
        { t: 'stone', x: 0, y: 0, z: 235 }],
  };

  C.build = function (level) {
    const ents = (C.LEVELS[level] || C.LEVELS[1]).map((o, i) => {
      const m = M[o.t];
      return {
        id: i, t: o.t, x: o.x, y: o.y, z: o.z, w: m.w, h: m.h, d: m.d,
        hp: m.hp, maxHp: m.hp, mass: m.mass,
        vx: 0, vy: 0, vz: 0, rot: 0, vr: 0,
        loose: false, dead: false, lastHitBy: null, hitAt: 99, spin: 0,
      };
    });
    return {
      level, ents, balls: [], debris: [], events: [], fx: [],
      shake: 0, hitstop: 0, totalHp: ents.reduce((s, e) => s + e.hp, 0),
    };
  };

  // ---- 投擲：瞄哪就打哪（派對場合，命中不該靠運氣），力量決定破壞力與速度 ----
  // ⚠️ 射線一定要從「投影用的鏡頭」出發，不是從出手點——那是兩個不同的點。
  // 從出手點射出去的話，算出來的目標跟畫面上看到的位置對不起來。
  const CAM = { x: 0, y: CAM_H, z: 0 };
  C.aimPoint = function (world, nx, ny) {
    const r = C.ray(nx, ny);
    let best = null, bestT = Infinity;
    for (const e of world.ents) {
      if (e.dead) continue;
      const t = rayBox(CAM, r, e);
      if (t !== null && t < bestT) { bestT = t; best = e; }
    }
    if (best) {
      return { x: CAM.x + r.x * bestT, y: CAM.y + r.y * bestT, z: CAM.z + r.z * bestT, ent: best };
    }
    // 沒瞄到東西就落在地面（y=0）；瞄天空就丟遠一點
    const t = r.y < 0 ? -CAM.y / r.y : 2.6;
    const tt = Math.max(0.5, Math.min(3.4, t));
    return { x: CAM.x + r.x * tt, y: Math.max(0, CAM.y + r.y * tt), z: CAM.z + r.z * tt, ent: null };
  };
  function rayBox(o, r, e) {
    const bx0 = e.x - e.w / 2, bx1 = e.x + e.w / 2;
    const by0 = e.y, by1 = e.y + e.h;
    const bz0 = e.z - e.d / 2, bz1 = e.z + e.d / 2;
    let t0 = 0, t1 = 1e9;
    for (const [oo, dd, a, b] of [[o.x, r.x, bx0, bx1], [o.y, r.y, by0, by1], [o.z, r.z, bz0, bz1]]) {
      if (Math.abs(dd) < 1e-6) { if (oo < a || oo > b) return null; continue; }
      let ta = (a - oo) / dd, tb = (b - oo) / dd;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return null;
    }
    return t0 > 0 ? t0 : null;
  }
  C.throwBall = function (world, nx, ny, power, owner, ownerId) {
    const T = C.aimPoint(world, nx, ny);
    const pw = Math.max(0.15, Math.min(1, power));
    const dist = Math.hypot(T.x - LAUNCH.x, T.y - LAUNCH.y, T.z - LAUNCH.z);
    const t = Math.max(0.22, Math.min(1.1, dist / (620 + pw * 900)));
    world.balls.push({
      x: LAUNCH.x, y: LAUNCH.y, z: LAUNCH.z,
      vx: (T.x - LAUNCH.x) / t,
      vy: (T.y - LAUNCH.y) / t + 0.5 * GRAV * t,     // 補掉重力，瞄哪就打哪
      vz: (T.z - LAUNCH.z) / t,
      r: 14, power: pw, owner, ownerId, alive: true, trail: [],
    });
    return T;
  };

  // 歡樂度：一個旋鈕同時放大「打飛力道／朝鏡頭飛／碎片／震動／定格／連鎖半徑」。
  // 0.5 = 原本的物理，往上是大亂鬥（每個人都像有超能力），往下是安靜的保齡球。
  // 用分段線性而不是單一 lerp，就是為了讓 0.5 剛好等於調校前的手感，不會一開旋鈕就變樣。
  const F = { kick: 1, cam: 1, debris: 1, debrisV: 1, shake: 1, stop: 1, blast: 1 };
  C.setFun = function (v) {
    const f = Math.max(0, Math.min(1, +v));
    const m = (lo, hi) => (f < .5 ? lo + (1 - lo) * (f / .5) : 1 + (hi - 1) * ((f - .5) / .5));
    F.kick = m(0.45, 3.0);       // 被打中飛多遠
    F.cam = m(0.30, 2.6);        // 朝鏡頭飛的比例——「不會吧」就是這一項
    F.debris = m(0.45, 2.6);     // 碎片數量
    F.debrisV = m(0.60, 2.2);    // 碎片速度
    F.shake = m(0.30, 2.0);
    F.stop = m(0.60, 1.7);       // 定格越久越有重量
    F.blast = m(0.60, 1.9);      // 爆炸連鎖半徑
  };
  C.setFun(0.5);
  C.fun = () => ({ ...F });

  function award(world, ball, kind, pts, x, y, z) {
    world.events.push({ kind, pts, owner: ball ? ball.owner : null, ownerId: ball ? ball.ownerId : null, x, y, z });
  }
  function kick(world, e, dx, dy, dz, force, src) {
    e.loose = true;
    const inv = 1 / e.mass;
    force *= F.kick;
    e.vx += dx * force * inv;
    e.vy += (dy * force + 140 * force / 400) * inv;
    e.vz += dz * force * inv * (dz < 0 ? F.cam : 1);   // 只放大「朝鏡頭飛」那一側
    e.vr += (dx > 0 ? 1 : -1) * force * inv * 0.02;
    e.spin = 1;
    if (src) { e.lastHitBy = src; e.hitAt = 0; }
  }
  function breakEnt(world, e, ball) {
    e.dead = true;
    award(world, ball, 'break', 2, e.x, e.y + e.h / 2, e.z);
    world.hitstop = Math.max(world.hitstop, 0.07 * F.stop);   // 定格一下，砸碎才有重量
    world.shake = Math.max(world.shake, (0.5 + e.mass * 0.12) * F.shake);
    const n = Math.min(90, Math.round((8 + e.mass * 3) * F.debris));   // 上限 90：再多就開始掉幀
    const V = F.debrisV;
    for (let i = 0; i < n; i++) {
      world.debris.push({
        x: e.x + (Math.random() - .5) * e.w, y: e.y + Math.random() * e.h, z: e.z + (Math.random() - .5) * e.d,
        vx: (Math.random() - .5) * 480 * V, vy: (Math.random() * 420 + 60) * V,
        vz: ((Math.random() - .5) * 300 - 80) * V * F.cam,
        s: 6 + Math.random() * 12, t: e.t, life: 1.5,
      });
    }
  }
  const boomQ = [];
  function explode(world, ent) {
    ent.dead = true;
    const src = ent._killer || null;
    world.fx.push({ kind: 'boom', x: ent.x, y: ent.y + ent.h / 2, z: ent.z, t: 0, life: 0.55 });
    world.shake = Math.max(world.shake, 1.6 * F.shake);
    world.hitstop = Math.max(world.hitstop, 0.11 * F.stop);
    award(world, src, 'boom', 3, ent.x, ent.y + ent.h / 2, ent.z);
    const R = 200 * F.blast;
    for (const o of world.ents) {
      if (o.dead || o === ent) continue;
      const dx = o.x - ent.x, dy = (o.y + o.h / 2) - (ent.y + ent.h / 2), dz = o.z - ent.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > R) continue;
      const kk = (R - dist) / R, inv = 1 / (dist || 1);
      o.hp -= 2;
      kick(world, o, dx * inv, dy * inv + 0.8, dz * inv - 0.5, 900 * kk, src);
      if (src) award(world, src, 'chain', 1, o.x, o.y + o.h / 2, o.z);
      if (o.hp <= 0) { if (o.t === 'bomb') { o._killer = src; boomQ.push([world, o]); } else breakEnt(world, o, src); }
    }
  }

  function supported(world, e) {
    if (e.y <= 2) return true;
    for (const o of world.ents) {
      if (o === e || o.dead || o.loose) continue;
      const ox = Math.min(e.x + e.w / 2, o.x + o.w / 2) - Math.max(e.x - e.w / 2, o.x - o.w / 2);
      const oz = Math.min(e.z + e.d / 2, o.z + o.d / 2) - Math.max(e.z - e.d / 2, o.z - o.d / 2);
      if (ox > e.w * 0.25 && oz > 0 && Math.abs((o.y + o.h) - e.y) < 14) return true;
    }
    return false;
  }

  C.step = function (world, dt) {
    world.events.length = 0;
    if (world.hitstop > 0) { world.hitstop -= dt; return world.events; }   // 定格中：全世界暫停
    if (world.shake > 0) world.shake = Math.max(0, world.shake - dt * 3.2);

    for (const b of world.balls) {
      if (!b.alive) continue;
      b.trail.push([b.x, b.y, b.z]); if (b.trail.length > 10) b.trail.shift();
      b.vy -= GRAV * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.y < -60 || b.z > 900 || b.z < 4 || Math.abs(b.x) > 1400) { b.alive = false; continue; }
      for (const e of world.ents) {
        if (e.dead) continue;
        if (Math.abs(b.x - e.x) > e.w / 2 + b.r) continue;
        if (b.y < e.y - b.r || b.y > e.y + e.h + b.r) continue;
        if (Math.abs(b.z - e.z) > e.d / 2 + b.r) continue;
        const dmg = b.power > 0.72 ? 2 : 1;
        e.hp -= dmg;
        award(world, b, 'chip', dmg, b.x, b.y, b.z);
        world.shake = Math.max(world.shake, (0.25 + b.power * 0.4) * F.shake);
        const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
        kick(world, e, b.vx / sp, b.vy / sp * 0.4 + 0.5, b.vz / sp * 0.5 - 0.35, 260 + b.power * 620, b);
        if (e.hp <= 0) { if (e.t === 'bomb') { e._killer = b; boomQ.push([world, e]); } else breakEnt(world, e, b); }
        b.vx *= .3; b.vy = Math.abs(b.vy) * .25 + 60; b.vz *= -.25;   // 球彈開，不會穿透整座塔
        break;
      }
    }
    while (boomQ.length) { const [w2, e2] = boomQ.shift(); if (!e2._boomed) { e2._boomed = true; explode(w2, e2); } }
    world.balls = world.balls.filter((b) => b.alive);

    for (const e of world.ents) {
      if (e.dead) continue;
      e.hitAt += dt;
      if (!e.loose && !supported(world, e)) { e.loose = true; e.vr = (Math.random() - .5) * 1.2; e.spin = 1; }
      if (!e.loose) continue;
      e.vy -= GRAV * dt;
      e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
      e.rot += e.vr * dt;
      if (e.y <= 0) {
        e.y = 0;
        if (Math.abs(e.vy) < 90) {                       // 落定
          e.vy = 0; e.vx *= .55; e.vz *= .55; e.vr *= .4;
          if (Math.hypot(e.vx, e.vz) < 18) { e.loose = false; e.vx = e.vz = e.vr = 0; }
        } else { e.vy = -e.vy * .28; e.vr *= .7; world.shake = Math.max(world.shake, 0.18 * F.shake); }
      }
      // 衝出場外／衝過鏡頭 → 算擊落
      if (e.z < 12 || e.z > 900 || Math.abs(e.x) > 900 || e.y < -200) {
        e.dead = true;
        award(world, e.hitAt < 3.5 ? e.lastHitBy : null, 'knock', 2, e.x, e.y, Math.max(14, e.z));
      }
    }
    for (const d of world.debris) {
      d.vy -= GRAV * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.life -= dt;
      if (d.y < 0) { d.y = 0; d.vy = -d.vy * .3; d.vx *= .6; d.vz *= .6; }
    }
    world.debris = world.debris.filter((d) => d.life > 0 && d.z > 8);
    for (const f of world.fx) f.t += dt;
    world.fx = world.fx.filter((f) => f.t < f.life);
    return world.events;
  };

  C.destroyedRatio = function (world) {
    let left = 0;
    for (const e of world.ents) if (!e.dead) left += Math.max(0, e.hp);
    return 1 - left / world.totalHp;
  };

  // ================= 材質：每種畫一次快取，之後只做縮放與旋轉 =================
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
  function box3d(g, x, y, w, h, d, front, top, side) {
    const dx = Math.round(d * .72), dy = Math.round(d * .38);
    poly(g, [[x, y], [x + dx, y - dy], [x + w + dx, y - dy], [x + w, y]], top);
    poly(g, [[x + w, y], [x + w + dx, y - dy], [x + w + dx, y + h - dy], [x + w, y + h]], side);
    R(g, x, y, w, h, front);
    return { dx, dy };
  }
  const DRAW = {
    straw(g, x, y, dmg) {
      const d = 34, { dx, dy } = box3d(g, x, y, 128, 64, d, P.strawF, P.strawT, P.strawS);
      for (let row = 0; row < 4; row++) for (let i = 0; i < 9; i++) {
        const xx = x + 7 + i * 13 + (row % 2) * 4, yy = y + 8 + row * 13;
        R(g, xx, yy, 12, 4, P.strawT); L(g, xx - 3, yy + 8, xx + 8, yy + 1, P.strawS, 2);
      }
      for (let i = 0; i < 8; i++) L(g, x + 9 + i * 15, y - 2, x + dx + 4 + i * 13, y - dy + 7, P.strawS, 2);
      R(g, x + 59, y - 2, 8, 68, P.strawD);
      if (dmg) { R(g, x + 43, y + 18, 14, 11, P.strawS); L(g, x + 18, y + 3, x + 3, y - 11, P.strawT, 3); }
    },
    beam(g, x, y, dmg) {
      const d = 38, { dx, dy } = box3d(g, x, y, 136, 62, d, P.woodF, P.woodT, P.woodS);
      R(g, x + 7, y + 8, 120, 8, P.woodT);
      for (let i = 0; i < 4; i++) L(g, x + 17 + i * 29, y + 25 + (i % 2) * 5, x + 33 + i * 27, y + 29 + (i % 2) * 5, P.woodD, 3);
      R(g, x + 6, y + 53, 124, 6, P.woodD);
      if (dmg) { L(g, x + 66, y + 4, x + 59, y + 31, P.dark, 4); L(g, x + 59, y + 31, x + 74, y + 54, P.dark, 4); }
    },
    brick(g, x, y, dmg) {
      const d = 44, { dx, dy } = box3d(g, x, y, 132, 132, d, P.brickF, P.brickT, P.brickS);
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
      for (let i = 0; i < 4; i++) poly(g, [[x + i * 32 + 4, y - 1], [x + i * 32 + 4 + dx, y - dy - 1],
        [x + i * 32 + 28 + dx, y - dy - 1], [x + i * 32 + 28, y - 1]], i % 2 ? P.brickT : '#b65747');
      if (dmg) {
        L(g, x + 72, y + 6, x + 58, y + 36, P.dark, 5); L(g, x + 58, y + 36, x + 81, y + 63, P.dark, 5);
        L(g, x + 81, y + 63, x + 61, y + 95, P.dark, 5); R(g, x + 92, y + 52, 18, 15, P.brickS);
      }
    },
    stone(g, x, y, dmg) {
      const d = 46, { dx, dy } = box3d(g, x, y + 7, 132, 61, d, P.stoneF, P.stoneT, P.stoneS);
      R(g, x + 8, y + 12, 114, 51, P.stoneF); R(g, x + 15, y + 17, 80, 8, P.stoneT);
      L(g, x + 32, y + 20, x + 21, y + 50, P.stoneS, 3); L(g, x + 86, y + 18, x + 102, y + 50, P.stoneS, 3);
      if (dmg) { L(g, x + 63, y + 12, x + 73, y + 31, P.dark, 4); L(g, x + 73, y + 31, x + 60, y + 62, P.dark, 4); }
    },
    barrel(g, x, y, dmg) { drum(g, x, y, dmg, false); },
    iron(g, x, y, dmg) { drum(g, x, y, dmg, true); },
    bomb(g, x, y, dmg) {
      R(g, x + 19, y + 7, 27, 5, P.bombS); R(g, x + 12, y + 12, 41, 8, P.bombF); R(g, x + 8, y + 20, 49, 27, P.bombF);
      R(g, x + 12, y + 47, 41, 9, P.bombS); R(g, x + 19, y + 56, 27, 5, P.bombS);
      R(g, x + 17, y + 17, 14, 9, P.bombT);
      R(g, x + 27, y + 3, 17, 9, P.bombT); R(g, x + 42, y - 8, 7, 14, P.fuse);
      R(g, x + 49, y - 14, 10, 10, P.orange); R(g, x + 55, y - 19, 8, 8, P.fire);
    },
  };
  function drum(g, x, y, dmg, metal) {
    const f = metal ? P.ironF : P.woodF, t = metal ? P.ironT : P.woodT, s = metal ? P.ironS : P.woodS;
    R(g, x + 16, y, 40, 5, s); R(g, x + 10, y + 5, 52, 7, s); R(g, x + 7, y + 12, 58, 10, f);
    R(g, x + 13, y + 7, 46, 6, t); R(g, x + 18, y + 5, 35, 4, metal ? P.ironHi : P.woodT);
    R(g, x + 6, y + 18, 60, 95, s); R(g, x + 10, y + 19, 52, 94, f); R(g, x + 17, y + 22, 10, 88, t);
    R(g, x + 7, y + 112, 58, 10, s); R(g, x + 12, y + 122, 48, 6, s);
    poly(g, [[x + 62, y + 20], [x + 72, y + 14], [x + 72, y + 105], [x + 62, y + 113]], s);
    for (const yy of [22, 58, 100]) { R(g, x + 5, y + yy, 62, 8, metal ? P.ironD : '#3e4147'); R(g, x + 10, y + yy + 1, 52, 2, metal ? P.ironT : '#686b72'); }
    if (!metal) { L(g, x + 34, y + 34, x + 34, y + 95, P.woodD, 4); L(g, x + 49, y + 37, x + 46, y + 92, P.woodT, 3); }
    else { R(g, x + 45, y + 37, 8, 18, P.rust); R(g, x + 15, y + 86, 7, 15, P.rust); R(g, x + 50, y + 91, 5, 9, P.rust); }
    if (dmg) {
      if (metal) { R(g, x + 37, y + 62, 16, 20, P.ironS); R(g, x + 41, y + 66, 9, 12, P.dark); }
      else { L(g, x + 21, y + 43, x + 48, y + 68, P.dark, 4); L(g, x + 48, y + 68, x + 27, y + 94, P.dark, 4); }
    }
  }

  // 快取：每種材質 × 完好／破損。精靈含 3D 延伸面，所以要留 padding。
  const cache = new Map();
  const PAD = 24;
  C.bake = function (type, dmg) {
    const key = type + (dmg ? '!' : '');
    if (cache.has(key)) return cache.get(key);
    const m = M[type];
    const cv = document.createElement('canvas');
    cv.width = m.w + Math.round(m.d * .72) + PAD * 2;
    cv.height = m.h + Math.round(m.d * .38) + PAD * 2;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    // 前面左上角落在 (PAD, PAD + d*0.38)，頂面往上長出去
    DRAW[type](g, PAD, PAD + Math.round(m.d * .38), dmg ? 1 : 0);
    const out = { cv, ox: PAD, oy: PAD + Math.round(m.d * .38) };
    cache.set(key, out);
    return out;
  };
  const DEBRIS_COL = { straw: P.strawT, barrel: P.woodT, beam: P.woodF, brick: P.brickT, iron: P.ironT, stone: P.stoneT, bomb: P.bombT };

  // ---- 場景 ----
  // 地面靜止 → Mode 7 只算一次快取（風格聖經 §1）
  let groundCv = null;
  C.buildGround = function (world7) {
    groundCv = document.createElement('canvas');
    groundCv.width = C.W; groundCv.height = C.H;
    const g = groundCv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const img = g.createImageData(C.W, C.H);
    MODE7.renderInto(img, C.W, world7, { x: 0, y: 0, w: C.W, h: C.H, horizon: C.HORIZON, scroll: 0, camX: 0, f: C.F, tex: 1 });
    g.putImageData(img, 0, 0);
    // 天空那一整條太空，補遠丘與樹線（跟滑雪同一支）才有縱深
    MODE7.horizonScape(g, { W: C.W, horizon: C.HORIZON, kind: world7.kind });
    return groundCv;
  };

  function drawEnt(g, e) {
    const pr = C.project(e.x, e.y + e.h, e.z);       // 以「前面頂端中心」定位
    if (!pr) return null;
    const sp = C.bake(e.t, e.hp < e.maxHp);
    const k = pr.k;
    const w = sp.cv.width * k, h = sp.cv.height * k;
    // 前面左上角應該落在 (sx - e.w/2*k, sy)
    const px = pr.sx - (e.w / 2) * k - sp.ox * k;
    const py = pr.sy - sp.oy * k;
    if (Math.abs(e.rot) > 0.01) {
      g.save();
      g.translate(pr.sx, pr.sy + (e.h / 2) * k);
      g.rotate(e.rot);
      g.drawImage(sp.cv, -((e.w / 2) + sp.ox) * k, -(sp.oy + e.h / 2) * k, w, h);
      g.restore();
    } else {
      g.drawImage(sp.cv, px, py, w, h);
    }
    return pr;
  }

  // colors: 玩家色；aims: [{idx,name,nx,ny,lock}] 各玩家的雷射點（lock=已確定的準心）
  C.render = function (g, world, colors, aims) {
    g.imageSmoothingEnabled = false;
    g.save();
    if (world.shake > 0) {                            // 撞擊震動
      const s = world.shake;
      g.translate((Math.random() - .5) * 14 * s, (Math.random() - .5) * 10 * s);
    }
    if (groundCv) g.drawImage(groundCv, 0, 0);
    else { g.fillStyle = '#101018'; g.fillRect(0, 0, C.W, C.H); }

    // 影子先畫（全部都在地上）
    for (const e of world.ents) {
      if (e.dead) continue;
      const pr = C.project(e.x, 0, e.z);
      if (!pr) continue;
      const hi = Math.max(0, Math.min(1, e.y / 300));
      g.globalAlpha = .34 * (1 - hi * .7);
      g.fillStyle = '#1b1a24';
      g.beginPath();
      g.ellipse(pr.sx, pr.sy, (e.w / 2 + e.d * .3) * pr.k, (e.d * .5) * pr.k, 0, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }

    // 由遠到近（painter's algorithm）
    const order = world.ents.filter((e) => !e.dead).sort((a, b) => b.z - a.z);
    for (const e of order) {
      // 衝到鏡頭前的物件拉一條殘影，才有「爆飛」的速度感
      if (e.loose && e.z < 90) {
        const sp2 = Math.hypot(e.vx, e.vy, e.vz);
        if (sp2 > 200) {
          const pr = C.project(e.x, e.y + e.h / 2, e.z);
          if (pr) {
            g.globalAlpha = .22;
            g.fillStyle = DEBRIS_COL[e.t] || P.white;
            const len = Math.min(160, sp2 * .12) * pr.k;
            g.fillRect(pr.sx - e.w / 2 * pr.k, pr.sy, e.w * pr.k, len);
            g.globalAlpha = 1;
          }
        }
      }
      drawEnt(g, e);
    }

    // 碎片
    for (const d of world.debris) {
      const pr = C.project(d.x, d.y, d.z);
      if (!pr) continue;
      g.globalAlpha = Math.min(1, d.life);
      // 夾住螢幕尺寸：貼到鏡頭的碎片如果照實畫，整個畫面會變成一塊塊色板
      const s = Math.max(1, Math.min(56, d.s * pr.k));
      R(g, pr.sx - s / 2, pr.sy - s / 2, s, s, DEBRIS_COL[d.t] || P.white);
      if (s > 10) { g.globalAlpha *= .5; R(g, pr.sx - s / 2, pr.sy - s / 2, s, Math.max(1, s * .22), P.white); }
      g.globalAlpha = 1;
    }

    // 球：拖尾＋本體
    for (const b of world.balls) {
      const col = colors[b.owner % colors.length];
      for (let i = 0; i < b.trail.length; i++) {
        const tp = C.project(b.trail[i][0], b.trail[i][1], b.trail[i][2]);
        if (!tp) continue;
        g.globalAlpha = (i / b.trail.length) * .55;
        const s = Math.max(1, b.r * 1.4 * tp.k);
        R(g, tp.sx - s / 2, tp.sy - s / 2, s, s, col);
      }
      g.globalAlpha = 1;
      const pr = C.project(b.x, b.y, b.z);
      if (!pr) continue;
      const s = Math.max(3, b.r * 2 * pr.k);
      R(g, pr.sx - s / 2, pr.sy - s * .35, s, s * .7, '#20222a');
      R(g, pr.sx - s * .35, pr.sy - s / 2, s * .7, s, '#20222a');
      R(g, pr.sx - s * .33, pr.sy - s * .33, s * .66, s * .66, col);
    }

    // 爆炸：3D 擴散環
    for (const f of world.fx) {
      if (f.kind !== 'boom') continue;
      const t = f.t / f.life;
      const pr = C.project(f.x, f.y, f.z);
      if (!pr) continue;
      g.globalAlpha = 1 - t;
      for (let i = 0; i < 3; i++) {
        const rr = (60 + i * 70) * (0.3 + t * 1.5) * pr.k;
        g.strokeStyle = i === 0 ? P.fire : i === 1 ? P.orange : P.red;
        g.lineWidth = Math.max(2, 8 * pr.k);
        g.strokeRect(pr.sx - rr, pr.sy - rr, rr * 2, rr * 2);
      }
      g.globalAlpha = 1;
    }
    g.restore();

    // 各玩家的雷射點（畫在最上層，不吃震動）
    // lock=true 的是「已確定」的準心：十字＋方框，跟還在飄的圓點一眼分得出來
    for (const a of aims || []) {
      const x = a.nx * C.W, y = a.ny * C.H;
      const col = colors[a.idx % colors.length];
      g.strokeStyle = col;
      if (a.lock) {
        g.lineWidth = 3;
        g.strokeRect(x - 17, y - 17, 34, 34);
        g.beginPath();
        g.moveTo(x - 26, y); g.lineTo(x - 8, y);
        g.moveTo(x + 8, y); g.lineTo(x + 26, y);
        g.moveTo(x, y - 26); g.lineTo(x, y - 8);
        g.moveTo(x, y + 8); g.lineTo(x, y + 26);
        g.stroke();
        g.fillStyle = col;
        g.fillRect(x - 3, y - 3, 6, 6);
      } else {
        g.lineWidth = 3;
        g.beginPath(); g.arc(x, y, 15, 0, Math.PI * 2); g.stroke();
        g.fillStyle = col;
        g.fillRect(x - 2, y - 2, 4, 4);
      }
      if (a.name) {                                   // 平台鐵則：任何視角都要有名字
        g.font = '700 13px system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillStyle = 'rgba(0,0,0,.65)';
        g.fillText(a.name, x + 1, y - 26);
        g.fillStyle = col;
        g.fillText(a.name, x, y - 27);
        g.textAlign = 'left';
      }
    }
  };
})();
