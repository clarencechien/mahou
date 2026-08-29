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
  C.SPAN = 40000;          // 生成長度，30 秒跑不完

  // 障礙物：wy 越大越遠。密度隨距離微升，前段友善、後段刺激
  C.build = function (seed) {
    const rnd = C.rng(seed);
    const obs = [];
    let wy = C.START_Y + 900;                       // 開頭留一段淨空
    while (wy < C.SPAN) {
      const t = wy / C.SPAN;
      const gap = 340 - t * 130 + rnd() * 220;      // 間距隨進度縮短
      wy += gap;
      const n = rnd() < .28 ? 2 : 1;                // 偶爾成對出現
      for (let k = 0; k < n; k++) {
        const wx = (rnd() * 2 - 1) * (C.HALF_W - 30);
        obs.push({ wx, wy: wy + k * 40, rock: rnd() < .22 });
      }
    }
    obs.sort((a, b) => a.wy - b.wy);
    return obs;
  };

  // 碰撞：跳躍中（air>0）可以越過樹，但石頭要跳更高
  C.HIT_X = 34;
  C.HIT_Y = 46;
  C.hitAt = function (obs, from, x, wy, air) {
    for (let i = from; i < obs.length; i++) {
      const o = obs[i];
      if (o.wy < wy - C.HIT_Y) continue;
      if (o.wy > wy + C.HIT_Y) break;
      if (Math.abs(o.wx - x) > C.HIT_X) continue;
      if (air > (o.rock ? 0.34 : 0.12)) continue;   // 跳得夠高就過得去
      return i;
    }
    return -1;
  };
  // 掃描指標：障礙物依 wy 排序，只要往前推進不用每幀從頭找
  C.advance = function (obs, from, wy) {
    let i = from;
    while (i < obs.length && obs[i].wy < wy - C.HIT_Y * 2) i++;
    return i;
  };
})();
