// 把現場合成的配樂錄成 mp3，用來「聽」原型——改一次曲子跑一次，不用開房間也不用喇叭。
//
//   npx wrangler dev --port 8788 &
//   node tools/bgm-preview.mjs                       # 滑雪，四個強度各錄 8 秒接成一軌
//   node tools/bgm-preview.mjs --track freeze        # 換一首（ski / freeze / hunt / cans）
//   node tools/bgm-preview.mjs --all                 # 四首各錄一遍，各自輸出一個 mp3
//   node tools/bgm-preview.mjs --lv 2 --sec 12       # 只錄第二強度 12 秒
//
// 做法：headless Chromium 開主控頁，把 BGM 的輸出接到 MediaStreamDestination 上錄，
// 再用 ffmpeg 轉 mp3。錄的是**真正的訊號路徑**（同一組 PeriodicWave、同一組濾波器），
// 不是另外寫一份模擬——模擬跟本體走鐘的話，聽起來對、上線卻不對。
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const FFMPEG = require('ffmpeg-static');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const URL_ = arg('url', 'http://localhost:8788/host');
const SEC = +arg('sec', 8);
const ONE = arg('lv', null);
const LVS = ONE == null ? [0, 1, 2, 3] : [+ONE];
const TRACK = arg('track', 'ski');
const ALL = process.argv.includes('--all');
const OUT0 = arg('out', null);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(URL_, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

const NAMES = ALL ? await page.evaluate(() => BGM.tracks()) : [TRACK];
for (const name of NAMES) await record(name);
await browser.close();

async function record(name) {
const OUT = join(ROOT, OUT0 || `tools/bgm-${name}.mp3`);
console.log(`\n🎵 ${name}：錄 ${LVS.map((l) => 'lv' + l).join(' / ')}，每段 ${SEC} 秒…`);
const { audio: b64, stats } = await page.evaluate(async ({ lvs, sec, name }) => {
  BGM.setVolume(0.2);
  BGM.play(name);
  const ac = SFX.context();
  const dest = ac.createMediaStreamDestination();
  BGM.out().connect(dest);                       // 照樣送去喇叭，這裡只是多接一路出來錄
  const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.start();
  const stats = [];
  for (const lv of lvs) {
    BGM.setIntensity(lv);
    BGM.stats();                                 // 歸零，只算這一段
    await new Promise((r) => setTimeout(r, sec * 1000));
    stats.push(BGM.stats());
  }
  const blob = await new Promise((r) => { rec.onstop = () => r(new Blob(chunks)); rec.stop(); });
  BGM.stop();
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
  return { audio: btoa(s), stats };
}, { lvs: LVS, sec: SEC, name });

const webm = Buffer.from(b64, 'base64');
mkdirSync(dirname(OUT), { recursive: true });
const tmp = OUT.replace(/\.mp3$/, '.webm');
writeFileSync(tmp, webm);
execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', tmp,
  '-codec:a', 'libmp3lame', '-b:a', '128k', OUT]);
// 順便量一下有沒有削頂：配樂疊四個聲部，音量沒抓好就會爆
const vol = spawnSync(FFMPEG, ['-hide_banner', '-i', OUT, '-af', 'volumedetect', '-f', 'null', '-'],
  { encoding: 'utf8' }).stderr || '';                 // volumedetect 印在 stderr
console.log(`寫進 ${OUT}（${Math.round(webm.length / 1024)}KB webm → mp3）`);
for (const line of vol.split('\n')) if (/max_volume|mean_volume/.test(line)) console.log('  ' + line.split(']').pop().trim());

// ---- 每一檔到底有沒有真的變忙 ----
// ⚠️ 兩個看起來很合理、其實都會騙人的量法：
//   RMS——16 分音符比 8 分密，但每個音更短，RMS 反而掉（實測 lv2 的中頻比 lv1 低 0.5dB）。
//   從錄音抓起音——到了 16 分格就飽和，音跟音之間包絡沒掉下來，量到假的持平。
// 所以直接數排程器排了幾個音（BGM.stats()），那是音樂真正的密度。
if (LVS.length > 1) {
  console.log('\n檔位   音符／秒   鼓／秒   合計');
  const rows = LVS.map((lv, i) => ({
    lv, n: stats[i].notes / SEC, d: stats[i].drums / SEC,
    all: (stats[i].notes + stats[i].drums) / SEC,
  }));
  for (const r of rows) {
    console.log(`  lv${r.lv}   ${r.n.toFixed(1).padStart(6)}   ${r.d.toFixed(1).padStart(6)}   ${r.all.toFixed(1).padStart(6)}`);
  }
  let bad = 0;
  for (let i = 1; i < rows.length; i++) {
    const ok = rows[i].all > rows[i - 1].all * 1.08;   // 每升一檔至少要忙 8%
    if (!ok) bad++;
    console.log(`  ${ok ? '✅' : '❌'} lv${rows[i].lv} 比 lv${rows[i - 1].lv} 忙 ` +
      `${((rows[i].all / rows[i - 1].all - 1) * 100).toFixed(0)}%`);
  }
  if (bad) process.exitCode = 1;
}
}
