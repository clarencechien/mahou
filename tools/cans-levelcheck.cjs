global.window = {};
global.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }), width: 0, height: 0 }) };
require('../public/engine/cans.js');
const C = window.CANS;
let bad = 0;
for (const lv of [1, 2, 3, 4, 5]) {
  const w = C.build(lv);
  const msgs = [];
  // 1) 全部在畫面內
  for (const e of w.ents) {
    const top = C.project(e.x, e.y + e.h, e.z);
    const bot = C.project(e.x - e.w / 2, e.y, e.z);
    const rt = C.project(e.x + e.w / 2, e.y, e.z);
    if (!top || !bot) { msgs.push(`${e.t} 投影失敗`); continue; }
    if (top.sy < 14) msgs.push(`${e.t}@y${e.y} 頂端超出上緣 (sy=${top.sy.toFixed(0)})`);
    if (bot.sx < 6 || rt.sx > C.W - 6) msgs.push(`${e.t}@x${e.x} 超出左右 (${bot.sx.toFixed(0)}..${rt.sx.toFixed(0)})`);
    if (bot.sy > C.H - 6) msgs.push(`${e.t}@z${e.z} 太近，底部出畫面`);
  }
  // 2) 靜置不垮
  const w2 = C.build(lv);
  for (let i = 0; i < 180; i++) C.step(w2, 1 / 60);
  const moved = w2.ents.filter((e) => e.loose || e.dead);
  if (moved.length) msgs.push(`靜置 3 秒自己動了 ${moved.length} 個: ${moved.map((e) => e.t).join(',')}`);
  // 3) 每顆炸彈都瞄得到並引爆得了
  for (const e of w.ents.filter((o) => o.t === 'bomb')) {
    const pr = C.project(e.x, e.y + e.h / 2, e.z);
    if (!pr) { msgs.push('炸彈投影失敗'); continue; }
    const w3 = C.build(lv);
    C.throwBall(w3, pr.sx / C.W, pr.sy / C.H, 0.9, 0, 'p');
    let boom = 0;
    for (let i = 0; i < 400; i++) for (const ev of C.step(w3, 1 / 60)) if (ev.kind === 'boom') boom++;
    if (!boom) msgs.push(`炸彈@(${e.x},${e.y},${e.z}) 瞄準卻引爆不了`);
  }
  bad += msgs.length;
  console.log(`關 ${lv}  物件 ${w.ents.length}  HP ${w.totalHp}  ` + (msgs.length ? '❌\n    ' + msgs.join('\n    ') : '✅'));
}
console.log(bad ? `\n共 ${bad} 個問題` : '\n全部通過');
