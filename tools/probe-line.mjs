// 剪一小段出來單獨聽寫，用來確認某一句到底幾秒開始。
//
//   gemini_key=... node tools/probe-line.mjs <mp3> <秒數,秒數,...> [窗長秒]
//   gemini_key=... node tools/probe-line.mjs public/ambient/music/Our_Table_B.mp3 6,7,8,9 3
//
// 對時間的抽查沒過的時候用這支逼近：在候選時間點各剪一段出來聽寫，
// **開頭從句子中間開始就代表時間標晚了**（家宴筆記：寧可早，不要晚）。
// Side B 就是這樣抓出第 0 句晚了 5 秒的：7 秒是靜的、8 秒聽到「Even」。
// ffmpeg 借 family-feast 的 ffmpeg-static，這個 repo 不另外裝。
import { readFileSync, rmSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';
const run = promisify(execFile);
const FFMPEG = createRequire('/home/user/family-feast/package.json')('ffmpeg-static');
const KEY = process.env.gemini_key;
const [file, list, win = '5'] = process.argv.slice(2);
for (const t of list.split(',').map(Number)) {
  const clip = join(tmpdir(), `probe-${t}.mp3`);
  await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(t), '-t', win, '-i', file, '-c', 'copy', clip]);
  const audio = readFileSync(clip).toString('base64');
  rmSync(clip, { force: true });
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: 'audio/mpeg', data: audio } },
      { text: 'Transcribe exactly what is sung in this clip, verbatim, in the language heard. If the clip starts in the middle of a word or phrase, start your transcript at that mid-point rather than guessing the beginning. If nothing is sung, return an empty string.' }] }],
    generationConfig: { thinkingConfig: { thinkingLevel: 'minimal' }, maxOutputTokens: 1024, temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] } },
  };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${KEY}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (j.error) { console.log(`${t}s  ERROR ${j.error.message.slice(0, 80)}`); continue; }
  const txt = JSON.parse(j.candidates[0].content.parts.map((p) => p.text).join('')).text || '(靜)';
  console.log(`${String(t).padStart(5)}s  ${txt.replace(/\n/g, ' ').slice(0, 70)}`);
}
