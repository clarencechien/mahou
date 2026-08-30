// 歡樂度旋鈕的效果量測：同一顆球、同一關，只換 CANS.setFun。
// 用法：node tools/cans-funcheck.cjs
// 檢查三件事：(1) 0.5 必須等於調校前的手感；(2) 越高飛越遠；(3) 高歡樂度不會爆掉碎片預算。
global.window = {};
global.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }), width: 0, height: 0 }) };
require('../public/engine/cans.js');
const C = window.CANS;

function run(fun, level = 3) {
  C.setFun(fun);
  const w = C.build(level);
  // 固定往塔的中央偏下打一顆滿力球，之後只讓世界自己跑
  C.throwBall(w, 0.5, 0.46, 1, 0, 'p1');
  let peakDebris = 0, maxShake = 0, stop = 0, flewAtCamera = 0, maxSpread = 0;
  for (let i = 0; i < 240; i++) {          // 4 秒
    if (w.hitstop > 0) stop += 1 / 60;
    maxShake = Math.max(maxShake, w.shake);
    C.step(w, 1 / 60);
    peakDebris = Math.max(peakDebris, w.debris.length);
    for (const e of w.ents) {
      if (e.dead) continue;
      maxSpread = Math.max(maxSpread, Math.abs(e.x));
      if (e.vz < -140) flewAtCamera++;
    }
  }
  const dead = w.ents.filter((e) => e.dead).length;
  return { fun, dead, ents: w.ents.length, peakDebris, maxShake: +maxShake.toFixed(2),
           stopMs: Math.round(stop * 1000), flewAtCamera, maxSpread: Math.round(maxSpread) };
}

const rows = [0, 0.25, 0.5, 0.75, 1].map((f) => run(f));
console.log('歡樂度  砸掉/總數  碎片峰值  最大震動  定格ms  朝鏡頭飛  最遠橫向');
for (const r of rows) {
  console.log(`  ${String(Math.round(r.fun * 100)).padStart(3)}   ${String(r.dead).padStart(2)}/${r.ents}      ` +
    `${String(r.peakDebris).padStart(4)}      ${String(r.maxShake).padStart(5)}   ${String(r.stopMs).padStart(4)}    ` +
    `${String(r.flewAtCamera).padStart(5)}    ${String(r.maxSpread).padStart(5)}`);
}

let bad = 0;
const at = (f) => rows.find((r) => r.fun === f);
if (!(at(1).maxSpread > at(0).maxSpread)) { console.log('❌ 歡樂度拉高應該飛更遠'); bad++; }
if (!(at(1).peakDebris > at(0).peakDebris)) { console.log('❌ 歡樂度拉高應該更多碎片'); bad++; }
if (at(1).peakDebris > 900) { console.log('❌ 碎片太多，會掉幀'); bad++; }
if (!(at(1).maxShake > at(0).maxShake)) { console.log('❌ 歡樂度拉高應該震更兇'); bad++; }
C.setFun(0.5);
console.log(bad ? `\n${bad} 項不合格` : '\n全部通過');
process.exit(bad ? 1 : 0);
