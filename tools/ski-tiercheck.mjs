// 超加速檔位的量測：每一檔到底多快、待多久、升檔那一下有沒有「踢」出來。
//   node tools/ski-tiercheck.mjs
//
// 為什麼要用模型而不是開瀏覽器實測：滑雪的物理全在 client.html 裡跑，開真的房間
// 才量得到，但那量到的是「今天手氣好不好」。要回答的是「第二檔跟第一檔差多少」，
// 只跟速度模型有關——連點、surge、上限、衰減，就這四條。跳台與撞樹改成固定節奏餵進去，
// 兩檔之間的差就只剩檔位本身造成的。常數直接從 client.html 挖，不會跟本體走鐘。
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'public', 'client.html'), 'utf8');

// 抓 `const SKI = { … };` 那一整塊——括號配對，不要用 regex 猜結尾
function grabObject(text, marker) {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`client.html 裡找不到 ${marker}`);
  let i = text.indexOf('{', at), depth = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return text.slice(i, j + 1);
  }
  throw new Error('括號沒有配對');
}
const SKI = new Function('return ' + grabObject(src, 'const SKI = {'))();

const capOf = (lv) => SKI.HARD_CAP + lv * SKI.COMBO_CAP_STEP;
const lvOf = (combo) => Math.min(SKI.COMBO_MAX_LV, Math.floor(combo / SKI.COMBO_EVERY));

// tps：每秒點擊數。rampEvery：幾秒吃到一座跳台。crashEvery：幾秒撞一次（0＝不撞）。
function run({ tps = 6, rampEvery = 2.2, crashEvery = 0, secs = 60, dt = 1 / 60 } = {}) {
  const st = { boost: 0, surge: 0, speed: SKI.DRIFT, combo: 0, lv: 0 };
  const dwell = new Array(SKI.COMBO_MAX_LV + 1).fill(0);
  const top = new Array(SKI.COMBO_MAX_LV + 1).fill(0);
  const kick = [];                                   // 升檔前後 0.5 秒的速度差
  let nextRamp = rampEvery, nextCrash = crashEvery || Infinity, stun = 0, pend = null;
  for (let t = 0; t < secs; t += dt) {
    if (crashEvery && t >= nextCrash) {
      nextCrash += crashEvery;
      st.boost *= SKI.HIT_MUL; st.surge *= SKI.HIT_MUL; st.speed *= SKI.HIT_MUL;
      stun = SKI.STUN;
      st.combo = Math.floor(st.combo / 2); st.lv = lvOf(st.combo);   // dentCombo
    }
    if (t >= nextRamp && stun <= 0) {
      nextRamp += rampEvery;
      st.combo++;
      const lv = lvOf(st.combo), up = lv > st.lv;
      st.lv = lv;
      st.surge = Math.min(capOf(lv), st.surge + SKI.RAMP_SURGE + (up ? SKI.COMBO_SURGE * lv : 0));
      if (up) pend = { lv, before: st.speed, at: t + 0.5 };
    }
    st.boost = Math.min(SKI.TAP_CAP, st.boost + tps * dt * SKI.TAP_ACC);
    st.boost = Math.max(0, st.boost - st.boost * SKI.DECAY * dt * (stun > 0 ? 5 : 1));
    const decay = SKI.SURGE_DECAY / (1 + st.lv * 0.7);
    st.surge = Math.max(0, st.surge - st.surge * decay * dt * (stun > 0 ? 5 : 1));
    const target = Math.min(capOf(st.lv), SKI.DRIFT + st.boost + st.surge);
    st.speed += (target - st.speed) * Math.min(1, dt * 4);
    if (stun > 0) stun -= dt;
    dwell[st.lv] += dt;
    top[st.lv] = Math.max(top[st.lv], st.speed);
    if (pend && t >= pend.at) { kick.push({ lv: pend.lv, d: st.speed - pend.before }); pend = null; }
  }
  return { dwell, top, kick };
}

const NAMES = SKI.TIERS.map((x) => x.name || '無');
function show(title, opt) {
  const r = run(opt);
  console.log(`\n${title}`);
  console.log('  檔位      上限   停留秒   該檔最高速   升檔 0.5 秒內加速');
  for (let lv = 0; lv <= SKI.COMBO_MAX_LV; lv++) {
    const k = r.kick.filter((x) => x.lv === lv).map((x) => x.d.toFixed(1) + ' m/s').join('、') || '—';
    console.log(`  ${NAMES[lv].padEnd(4, '　')}  ${String(capOf(lv)).padStart(4)}  ` +
      `${r.dwell[lv].toFixed(1).padStart(7)}  ${(r.top[lv] || 0).toFixed(1).padStart(11)}   ${k}`);
  }
  return r;
}

console.log(`每 ${SKI.COMBO_EVERY} 連升一檔・最高 ${SKI.COMBO_MAX_LV} 檔・` +
            `檔名 ${SKI.TIERS.slice(1).map((x) => x.name).join(' → ')}`);
const clean = show('一路不漏跳（每 2.2 秒一座跳台，不撞）', { rampEvery: 2.2 });
const real = show('比較像真的玩（每 3 秒一座，12 秒撞一次）', { rampEvery: 3, crashEvery: 12 });

let bad = 0;
const t = (ok, msg) => { console.log((ok ? '✅ ' : '❌ ') + msg); if (!ok) bad++; };
console.log('');
// 每一檔都要真的比前一檔快，而且要快得看得出來——差不到 3 m/s 的話畫面上讀不出換檔
for (let lv = 2; lv <= SKI.COMBO_MAX_LV; lv++) {
  const d = clean.top[lv] - clean.top[lv - 1];
  t(d >= 3, `${NAMES[lv]} 比 ${NAMES[lv - 1]} 快 ${d.toFixed(1)} m/s（要 ≥3）`);
}
// 升檔的踢感要一檔比一檔強，不然第二檔只是第一檔再久一點
const kicks = [1, 2, 3].map((lv) => clean.kick.find((x) => x.lv === lv)?.d ?? 0);
t(kicks.every((k, i) => i === 0 || k > kicks[i - 1] - 0.01),
  `升檔踢感遞增：${kicks.map((k) => k.toFixed(1)).join(' → ')} m/s`);
// 正常玩要真的踩得到第二檔，不然「連 6 再一段」等於沒有
t(real.dwell[2] >= 3, `一般節奏下待在 ${NAMES[2]} ${real.dwell[2].toFixed(1)} 秒（要 ≥3）`);
// 每一檔都要有自己的名字與顏色，不能兩檔長一樣
const names = new Set(SKI.TIERS.slice(1).map((x) => x.name));
const bars = new Set(SKI.TIERS.slice(1).map((x) => x.bar));
t(names.size === SKI.COMBO_MAX_LV && bars.size === SKI.COMBO_MAX_LV, '每一檔的名字與顏色都不重複');
process.exit(bad ? 1 : 0);
