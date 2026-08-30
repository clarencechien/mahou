// 變色龍撒點檢查：worker/room.js 的 placeChams 與 public/engine/paint.js 的 P.place
// 必須長出一模一樣的位置（DO 用它做命中判定，host 用它渲染），而且不能少放、不能擠成一團。
// 用法：node tools/hunt-placecheck.cjs
const fs = require('fs');
function grab(src, start, endMark) {
  const i = src.indexOf(start);
  const j = src.indexOf(endMark, i);
  return src.slice(i, j + endMark.length);
}
const wsrc = fs.readFileSync(require('path').join(__dirname, '../worker/room.js'), 'utf8');
const psrc = fs.readFileSync(require('path').join(__dirname, '../public/engine/paint.js'), 'utf8');
const mul = grab(wsrc, 'function mulberry32', '\n}\n');
const wPlace = grab(wsrc, 'function placeChams', '\n}\n');
const pPlace = grab(psrc, '  P.place = function', '\n  };\n').replace('P.place = function', 'const hostPlace = function');
const mod = new Function(mul + '\n' + wPlace + '\n' + pPlace + '\nreturn {placeChams, hostPlace};')();
let ok = true;
for (const [seed, n] of [[1,1],[7,5],[99,20],[1234,26],[555,3]]) {
  const a = JSON.stringify(mod.placeChams(seed, n)), b = JSON.stringify(mod.hostPlace(seed, n));
  const same = a === b;
  if (!same) ok = false;
  console.log(`${String(n).padStart(2)} 隻 seed ${String(seed).padEnd(5)} ${same ? '一致 ✅' : '不一致 ❌'}`);
}
for (const n of [1, 3, 8, 14, 20, 26]) {
  const P = mod.hostPlace(4242, n);
  if (P.length !== n) { console.log(`❌ 要 ${n} 隻只撒出 ${P.length} 隻`); ok = false; }
  let mind = 9;
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) mind = Math.min(mind, Math.hypot((P[i].x - P[j].x) * 1.7, P[i].y - P[j].y));
  console.log(`${String(n).padStart(2)} 隻：實際撒出 ${P.length} 隻，最近間距 ${n > 1 ? mind.toFixed(3) : '—'}`);
}
console.log(ok ? '\n全部通過' : '\n不合格');
process.exit(ok ? 0 : 1);
