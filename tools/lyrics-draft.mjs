// 把寫歌時那份純文字歌詞，轉成 songs/<id>.json 的草稿（時間先平均分，之後再對）。
//
//   node tools/lyrics-draft.mjs --id our-table --duration 207.8 \
//     --lyrics tools/lyrics/our-table.txt --audio music/Our_Table.mp3 \
//     --title "Our Table" --titleZh "我們的餐桌" --subtitle "Our Table"
//
// 文字檔的長相就是寫歌時的樣子：
//   [Section]        ← 中括號＝段落名
//   主歌詞            ← 一段之內用空行分隔每一句
//   （羅馬拼音）       ← 一句有三行時，中間那行當 romaji
//   中譯
//
// ⚠️ 這支只負責「切句」，**時間是假的**（照字數平均分）。真正的時間要跑
// family-feast 的 tools/align-lyrics.mjs——那支有靜音比對跟抽查驗證，
// 不要在這裡重寫一份比較差的。詳見 docs/games.md 的「歌詞怎麼對時間」。
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };

export function parseLyrics(txt) {
  const out = [];
  let section = '';
  for (const block of txt.replace(/\r/g, '').split(/\n\s*\n/)) {
    let rows = block.split('\n').map((s) => s.trim()).filter(Boolean);
    if (rows.length && /^\[.+\]$/.test(rows[0])) { section = rows.shift().slice(1, -1); }
    if (!rows.length) continue;
    rows = rows.filter((r) => !/^\(.*\)$/.test(r));           // (Fade out) 是舞台指示，不是歌詞
    // 同一句連寫三次（"Our Little Feast..." ×3）是唱三遍的意思，不是日／羅／中三行
    rows = rows.filter((r, i) => rows.indexOf(r) === i);
    if (!rows.length) continue;
    // 「Verse 1 - Male Vocal」拆成段落＋誰唱的，跟 family-feast 那五首同一個欄位
    const mv = /^(.*?)\s*[-–]\s*(.*(?:Vocal|Duet).*)$/i.exec(section);
    const line = mv ? { section: mv[1].trim(), voice: mv[2].trim() } : { section };
    if (rows.length >= 3) { line.jp = rows[0]; line.romaji = rows[1]; line.zh = rows.slice(2).join(' '); }
    else if (rows.length === 2) { line.jp = rows[0]; line.zh = rows[1]; }
    else { line.jp = rows[0]; }
    if (line.zh === line.jp) delete line.zh;                  // 一樣的話畫面上會重複兩次
    if (line.romaji === line.jp) delete line.romaji;
    out.push(line);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const id = arg('id');
  const duration = Number(arg('duration', '0'));
  if (!id || !duration) { console.error('缺 --id 或 --duration'); process.exit(1); }
  const lines = parseLyrics(readFileSync(join(ROOT, arg('lyrics')), 'utf8'));
  // 草稿時間：前奏 8 秒、尾奏 6 秒，中間平均分。反正等一下會被對時覆蓋掉。
  const intro = 8, outro = 6;
  const span = Math.max(1, duration - intro - outro);
  const song = {
    id,
    title: arg('title', id),
    titleZh: arg('titleZh', ''),
    subtitle: arg('subtitle', ''),
    audio: arg('audio'),
    duration,
    offset: 0,
    timing: { source: 'auto-draft', agreementMedianSec: 0, agreementWorstSec: 0, flagged: [], spotChecks: '' },
    lines: lines.map((l, i) => ({ t: Math.round((intro + (span * i) / lines.length) * 10) / 10, ...l })),
  };
  const out = join(ROOT, arg('out', 'public/ambient/songs'), id + '.json');
  writeFileSync(out, JSON.stringify(song, null, 2) + '\n');
  const kinds = lines.reduce((a, l) => (a[l.romaji ? 3 : l.zh ? 2 : 1] = (a[l.romaji ? 3 : l.zh ? 2 : 1] || 0) + 1, a), {});
  console.log(`${id}：${lines.length} 句（每句幾行：${JSON.stringify(kinds)}）、段落 ${[...new Set(lines.map((l) => l.section))].length} 個 → ${out}`);
}
