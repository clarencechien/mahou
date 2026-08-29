// course.js — 滑雪賽道：由 DO 發的種子生成，手機與大螢幕長出完全一樣的世界
// 這是「client 權威 ＋ host 外推」能成立的前提：兩端的障礙物必須一致。
(function () {
  const C = (window.COURSE = {});

  // 決定性 PRNG（mulberry32）：同一個種子 → 同一條賽道
  C.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  C.HALF_W = 260;          // 賽道半寬（世界紋理單位）
  C.START_Y = 165;         // 玩家起點的 wy
  C.SPAN = 120000;         // 生成長度，全程加速也跑不完
  C.BASE_WPM = 22;         // 公尺 → 世界單位的基準值

  // 速度倍率：同時放大「每秒前進的世界單位」與「障礙物間距」。
  // 兩個一起縮放 → 每秒遇到的障礙物數量不變，但每個物件掃過畫面的時間變短，
  // 這才是「變快」而不是「變難」。純粹改速度不改間距的話會直接難到不能玩。
  C.SPEED_MUL = 1;
  C.WORLD_PER_M = C.BASE_WPM;
  C.HIT_Y = 46;
  C.RAMP_Y = 70;
  C.setSpeed = function (mul) {
    C.SPEED_MUL = Math.max(0.4, Math.min(4, +mul || 1));
    C.WORLD_PER_M = C.BASE_WPM * C.SPEED_MUL;
    C.HIT_Y = 46 * C.SPEED_MUL;     // 判定窗口也要跟著放大，秒數才維持不變
    C.RAMP_Y = 70 * C.SPEED_MUL;
  };

  // 賽道物件：障礙物（樹／石頭）與跳台混在同一條排序好的清單裡。
  // 平均約每 1.4 秒來一組，其中三成是跳台——跳台是唯一的加速來源，所以不能太稀。
  C.build = function (seed, mul) {
    if (mul != null) C.setSpeed(mul);
    const k = C.SPEED_MUL;
    const rnd = C.rng(seed);
    const items = [];
    let wy = C.START_Y + 800 * k;                   // 開頭留一段淨空給人反應
    const span = C.SPAN * k;
    while (wy < span) {
      const t = Math.min(1, wy / span);
      wy += (300 - t * 80 + rnd() * 190) * k;       // 間距隨進度縮短
      if (rnd() < 0.34) {
        // 跳台：不放在最外側，兩邊都要留得過去的路給不想跳的人
        items.push({ wx: (rnd() * 2 - 1) * (C.HALF_W - 145), wy, ramp: true });
        wy += 240 * k;                              // 跳台後留空，落地不會馬上撞
      } else {
        const n = rnd() < .26 ? 2 : 1;              // 偶爾成對出現
        for (let j = 0; j < n; j++) {
          items.push({ wx: (rnd() * 2 - 1) * (C.HALF_W - 30), wy: wy + j * 46 * k, rock: rnd() < .22 });
        }
      }
    }
    items.sort((a, b) => a.wy - b.wy);
    return items;
  };

  // 賽道邊標竿：兩側各一排，位置固定 → 在畫面上連成兩條收斂線。
  // 間距刻意不隨速度倍率放大，所以速度越快掠過越兇——速度感其實來自
  // 「每秒有多少東西刷過去」，不是玩家自己跑多快。順便把賽道邊界標出來。
  C.PROP_GAP = 165;
  C.PROP_X = C.HALF_W + 24;
  C.props = function (fromWy, toWy) {
    const out = [];
    const i0 = Math.max(0, Math.floor(fromWy / C.PROP_GAP)), i1 = Math.ceil(toWy / C.PROP_GAP);
    for (let i = i0; i <= i1; i++) {
      const wy = i * C.PROP_GAP;
      out.push({ wx: -C.PROP_X, wy, red: (i & 1) === 0 });
      out.push({ wx: C.PROP_X, wy, red: (i & 1) === 0 });
    }
    return out;
  };

  // 碰撞：跳躍中（air>0）可以越過樹，石頭要跳更高
  C.HIT_X = 34;
  C.hitAt = function (obs, from, x, wy, air) {
    for (let i = from; i < obs.length; i++) {
      const o = obs[i];
      if (o.ramp) continue;
      if (o.wy < wy - C.HIT_Y) continue;
      if (o.wy > wy + C.HIT_Y) break;
      if (Math.abs(o.wx - x) > C.HIT_X) continue;
      if (air > (o.rock ? 0.34 : 0.12)) continue;   // 跳得夠高就過得去
      return i;
    }
    return -1;
  };

  // 跳台判定：容忍值刻意放寬（左右 ±70、前後 ±70×速度倍率），派對寧可寬鬆也不要挫折
  C.RAMP_X = 70;
  C.rampAt = function (obs, from, x, wy) {
    for (let i = from; i < obs.length; i++) {
      const o = obs[i];
      if (!o.ramp || o.used) continue;
      if (o.wy < wy - C.RAMP_Y) continue;
      if (o.wy > wy + C.RAMP_Y) break;
      if (Math.abs(o.wx - x) > C.RAMP_X) continue;
      return i;
    }
    return -1;
  };

  // 手機端提示用：找出前方最近、而且橫向搆得到的跳台
  C.nextRamp = function (obs, from, x, wy, ahead) {
    for (let i = from; i < obs.length; i++) {
      const o = obs[i];
      if (o.wy < wy) continue;
      if (o.wy > wy + ahead) break;
      if (!o.ramp || o.used) continue;
      if (Math.abs(o.wx - x) > C.RAMP_X * 2.2) continue;   // 太遠就別叫人硬轉
      return o;
    }
    return null;
  };

  // 掃描指標：物件依 wy 排序，只要往前推進不用每幀從頭找
  C.advance = function (obs, from, wy) {
    let i = from;
    while (i < obs.length && obs[i].wy < wy - C.HIT_Y * 2) i++;
    return i;
  };
})();
