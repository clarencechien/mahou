// 把背景模式要用的歌（音檔＋逐句時間）抓進 public/ambient/。
//
//   node tools/fetch-songs.mjs [--from ../family-feast] [--force]
//
// 來源優先順序：本機的 family-feast clone → 線上的 family-feast.ai-apps.work。
// 歌是使用者自己的作品，家宴當天不該還要靠別台機器活著——音檔放自己家，
// 現場網路爛掉、對面站台掛掉都照播。歌詞 JSON 本來就一定要同源（對面沒有 CORS）。
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'ambient');
const SITE = 'https://family-feast.ai-apps.work';

const args = process.argv.slice(2);
const force = args.includes('--force');
const fromArg = args[args.indexOf('--from') + 1];
const LOCAL = args.includes('--from') ? fromArg : join(ROOT, '..', 'family-feast');
const localSite = join(LOCAL, 'site');
const haveLocal = existsSync(join(localSite, 'data', 'songs', 'index.json'));
console.log(haveLocal ? `來源：本機 ${localSite}` : `來源：${SITE}`);

mkdirSync(join(OUT, 'songs'), { recursive: true });
mkdirSync(join(OUT, 'music'), { recursive: true });

async function grab(rel) {
  if (haveLocal) return readFileSync(join(localSite, rel));
  const r = await fetch(SITE + '/' + rel);
  if (!r.ok) throw new Error(`${r.status} ${rel}`);
  return Buffer.from(await r.arrayBuffer());
}

const index = JSON.parse((await grab('data/songs/index.json')).toString());
let songs = 0, audio = 0, skipped = 0, failed = 0;

for (const s of index.songs || []) {
  const jsonRel = `data/songs/${s.id}.json`;
  let meta;
  try {
    const buf = await grab(jsonRel);
    writeFileSync(join(OUT, 'songs', `${s.id}.json`), buf);
    meta = JSON.parse(buf.toString());
    songs++;
  } catch (e) { console.error(`❌ ${s.id} 歌詞：${e.message}`); failed++; continue; }

  // meta.audio 長這樣：music/Fruit_Cake_Love.mp3
  const rel = meta.audio && meta.audio.replace(/^\/+/, '');
  if (!rel) { console.error(`❌ ${s.id} 沒有 audio 欄位`); failed++; continue; }
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest) && !force) {
    skipped++;
    console.log(`⏭  ${(meta.titleZh || s.id).padEnd(10, '　')} 已存在`);
    continue;
  }
  try {
    if (haveLocal) cpSync(join(localSite, 'assets', rel), dest);
    else writeFileSync(dest, await grab('assets/' + rel));
    audio++;
    console.log(`✅ ${(meta.titleZh || s.id).padEnd(10, '　')} ${Math.round(statSync(dest).size / 1024)}KB  ${rel}`);
  } catch (e) { console.error(`❌ ${s.id} 音檔：${e.message}`); failed++; }
}

// 抓進來之後就該用本機的，不然白抓
const cfgPath = join(OUT, 'playlists.json');
if (existsSync(cfgPath) && audio + skipped > 0) {
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  // 要走 Worker 的 /audio/，不是直接吃靜態資源——assets handler 不回 Range，
  // 音檔會變成不可跳轉（點進度條沒反應）。
  if (cfg.audioBase !== '/audio/') {
    cfg.audioBase = '/audio/';
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    console.log('\nplaylists.json 的 audioBase 改成 /audio/（本機音檔，走 Worker 才有 Range）');
  }
}

console.log(`\n歌詞 ${songs}、音檔新抓 ${audio}、已存在 ${skipped}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
