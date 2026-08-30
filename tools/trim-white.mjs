// 量出背景圖四邊的純白留白，寫回 playlists.json 的 trim 欄位。
//   node tools/trim-white.mjs            # 只印，不改檔
//   node tools/trim-white.mjs --write    # 寫回 playlists.json
//
// 為什麼要離線量：民宿相簿有幾張是把直式照片貼在 1280×853 的白底上，
// 左右各一大條白邊。放到電視上就是照片中間浮著、兩側刷白，很刺眼。
// 本來想在瀏覽器即時偵測，但 img.hiweb.tw 跟 family-feast 都沒有送
// Access-Control-Allow-Origin——圖畫進 canvas 就 tainted，getImageData 會丟例外，
// 讀不到像素。除非自己開 proxy 把別人的圖轉一手（不想這樣做），
// 不然只能離線量好、把結果存進設定檔。清單本來就是手挑的，量一次就好。
//
// trim 存的是比例不是像素：對面哪天換成別的解析度，同一組數字照樣對。
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CFG = join(ROOT, 'public', 'ambient', 'playlists.json');
const write = process.argv.includes('--write');

// 「這一排是白邊」的判準：整排每一個像素都幾乎純白。
// 不能用平均值——8876 上面那排有三分之二是白邊、剩下是亮亮的天空，
// 平均 245 就會被誤判成留白，一刀切下去把照片的天空切掉。
const WHITE = 248;

function edges(data, W, H, C) {
  const minRow = (y) => { let m = 255; for (let x = 0; x < W; x++) { const o = (y * W + x) * C; m = Math.min(m, data[o], data[o + 1], data[o + 2]); } return m; };
  const minCol = (x) => { let m = 255; for (let y = 0; y < H; y++) { const o = (y * W + x) * C; m = Math.min(m, data[o], data[o + 1], data[o + 2]); } return m; };
  let t = 0; while (t < H - 1 && minRow(t) >= WHITE) t++;
  let b = H - 1; while (b > t && minRow(b) >= WHITE) b--;
  let l = 0; while (l < W - 1 && minCol(l) >= WHITE) l++;
  let r = W - 1; while (r > l && minCol(r) >= WHITE) r--;
  return { t, b, l, r };
}

const cfg = JSON.parse(readFileSync(CFG, 'utf8'));
let changed = 0;
for (const back of cfg.backdrops || []) {
  if (!back.images) continue;                 // manifest 那種（家宴相簿）不在這裡處理
  console.log(`\n── ${back.name}`);
  const out = [];
  for (const item of back.images) {
    const url = typeof item === 'string' ? item : item.url;
    const r = await fetch(url);
    if (!r.ok) { console.error(`  ❌ ${r.status} ${url}`); out.push(item); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const { width: W, height: H, channels: C } = info;
    const { t, b, l, r: rr } = edges(data, W, H, C);
    const cw = rr - l + 1, ch = b - t + 1;
    const name = url.split('/').pop();
    if (cw === W && ch === H) {
      console.log(`  ✅ ${name} ${W}x${H} 沒有白邊`);
      out.push(url);
      continue;
    }
    const f = (n) => Math.round(n * 1e4) / 1e4;
    const trim = [f(l / W), f(t / H), f(cw / W), f(ch / H)];
    console.log(`  ✂️  ${name} ${W}x${H} → ${cw}x${ch}（左${l} 上${t} 右${W - 1 - rr} 下${H - 1 - b}）trim ${JSON.stringify(trim)}`);
    out.push({ url, trim });
    changed++;
  }
  back.images = out;
}
if (write && changed) {
  writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`\n寫回 ${CFG}，${changed} 張有白邊`);
} else {
  console.log(`\n${changed} 張有白邊${write ? '' : '（加 --write 才會寫回設定檔）'}`);
}
