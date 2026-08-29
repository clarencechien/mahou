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
  C.WORLD_PER_M = 22;      // 公尺 → 世界單位。地面捲動速度感就靠這個數字

  // 賽道物件：障礙物（樹／石頭）與跳台混在同一條排序好的清單裡。
  // 平均約每 1 秒來一組，其中三成是跳台——跳台是唯一的加速來源，所以不能太稀。
  C.build = function (seed) {
    const rnd = C.rng(seed);
    const items = [];
    let wy = C.START_Y + 800;                       // 開頭留一段淨空給人反應
    while (wy < C.SPAN) {
      const t = Math.min(1, wy / C.SPAN);
      wy += 300 - t * 80 + rnd() * 190;             // 間距隨進度縮短
      if (rnd() < 0.34) {
        // 跳台：不放在最外側，兩邊都要留得過去的路給不想跳的人
        items.push({ wx: (rnd() * 2 - 1) * (C.HALF_W - 145), wy, ramp: true });
        wy += 240;                                  // 跳台後留空，落地不會馬上撞
      } else {
        const n = rnd() < .26 ? 2 : 1;              // 偶爾成對出現
        for (let k = 0; k < n; k++) {
          items.push({ wx: (rnd() * 2 - 1) * (C.HALF_W - 30), wy: wy + k * 46, rock: rnd() < .22 });
        }
      }
    }
    items.sort((a, b) => a.wy - b.wy);
    return items;
  };

  // 碰撞：跳躍中（air>0）可以越過樹，石頭要跳更高
  C.HIT_X = 34;
  C.HIT_Y = 46;
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

  // 跳台判定：容忍值刻意放寬（左右 ±62、前後 ±70），派對場合寧可寬鬆也不要挫折
  C.RAMP_X = 70;
  C.RAMP_Y = 70;
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
