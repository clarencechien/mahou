// 把 paint.js 裡兩套主題的畫抓下來、縮到 1280 寬、存進 public/arts/。
// 用法：node tools/fetch-arts.mjs
//
// 為什麼要自己 host：現場最大的變數就是 Wikimedia。冷門作品的縮圖要現生，
// 網路差一點就整套退成程序化抽象畫。這些全部是公有領域作品，抓下來放自己家最保險，
// 而且同源＝canvas 不會 tainted，色階量化那段才跑得起來。
// 執行期仍然保留 Wikimedia 當備援：本機檔案掉了也還玩得下去。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'arts');
mkdirSync(OUT, { recursive: true });

// 從 paint.js 直接讀主題表，兩邊不會走鐘
const src = readFileSync(join(ROOT, 'public/engine/paint.js'), 'utf8');
const themes = [];
for (const m of src.matchAll(/key: '(\w+)',[\s\S]*?list: \[([\s\S]*?)\n {6}\],/g)) {
  const list = [...m[2].matchAll(/\{ name: '([^']+)',[^}]*?file: '([^']+)' \}/g)]
    .map(([, name, file]) => ({ name, file }));
  themes.push({ key: m[1], list });
}
if (!themes.length) { console.error('讀不到 paint.js 的主題表'); process.exit(1); }

const url = (f, w) =>
  'https://commons.wikimedia.org/wiki/Special:Redirect/file/' + encodeURIComponent(f) + '?width=' + w;

// slug 要跟 paint.js 的 P.slug 一模一樣
const slug = (f) => f.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

let ok = 0, skip = 0, fail = 0;
const manifest = [];
for (const th of themes) {
  for (const art of th.list) {
    const name = slug(art.file) + '.jpg';
    const dest = join(OUT, name);
    manifest.push({ theme: th.key, name: art.name, file: art.file, local: name });
    if (existsSync(dest) && !process.argv.includes('--force')) { skip++; continue; }
    let buf = null;
    for (const w of [1280, 800]) {
      try {
        const r = await fetch(url(art.file, w), { headers: { 'user-agent': 'mahou-party-poc/1.0 (banquet game; fetch-arts.mjs)' } });
        if (!r.ok) { console.warn(`  ${r.status} @${w} ${art.name}`); continue; }
        buf = Buffer.from(await r.arrayBuffer());
        break;
      } catch (e) { console.warn(`  ${e.message} @${w} ${art.name}`); }
      await new Promise((s) => setTimeout(s, 1500));      // 別把 Commons 打成 429
    }
    if (!buf) { fail++; console.error(`❌ ${art.name}`); continue; }
    // 畫布只有 960 寬、之後還要打成像素格，1280 就夠；quality 82 肉眼看不出差別
    const out = await sharp(buf).resize({ width: 1280, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    writeFileSync(dest, out);
    const meta = await sharp(out).metadata();
    ok++;
    console.log(`✅ ${art.name.padEnd(12, '　')} ${meta.width}x${meta.height}  ${Math.round(out.length / 1024)}KB  ${name}`);
    await new Promise((s) => setTimeout(s, 1500));
  }
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\n新抓 ${ok}、已存在 ${skip}、失敗 ${fail}`);
process.exit(fail ? 1 : 0);
