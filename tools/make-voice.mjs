// 用 Gemini TTS 把說明畫面的旁白錄成 mp3，存進 public/voice/。
//
//   gemini_key=... node tools/make-voice.mjs --sample          # 各種聲音各念一段，挑聲音用
//   gemini_key=... node tools/make-voice.mjs --voice Sulafat   # 正式錄四段旁白
//
// 為什麼要「先錄好」而不是現場叫 API：
//   1. 金鑰不能進瀏覽器。這是唯一硬理由——現場呼叫就等於把 key 發給每一台主控。
//   2. 旁白是固定的四段字，沒有任何理由每次重念。
//   3. 現場網路爛掉照樣要能講話。
// 同一套邏輯跟背景模式的歌一樣：能先抓下來的就先抓下來。
//
// 台灣感是**提示詞**給的，不是聲音名稱給的。Gemini TTS 吃自然語言的演出指示，
// 所以 STYLE 那段比選哪個 voice 影響大得多。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const FFMPEG = require('ffmpeg-static');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'voice');
const KEY = process.env.gemini_key || process.env.GEMINI_API_KEY;
if (!KEY) { console.error('環境變數 gemini_key 沒設'); process.exit(1); }

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const MODEL = arg('model', 'gemini-2.5-flash-preview-tts');

// ⚠️ 演出指示。要「台灣感」就是靠這段，不是靠 voiceName。
// 講法刻意寫成「在朋友家的客廳」而不是「主持人」——主持人腔會變成尾牙司儀，
// 家宴要的是隔壁那個很會帶氣氛的親戚。
const STYLE = [
  '你是台灣人，在朋友家的客廳帶大家玩手機小遊戲。',
  '用自然的台灣中文口語念下面這段話：親切、有精神、帶一點笑意，像在跟熟人講話。',
  '不要新聞主播腔，不要字正腔圓的朗讀腔，不要刻意的兒化音或北方捲舌。',
  '語速中等偏快一點點，句子之間停一下下讓人跟得上。',
  '只念內容本身，不要念這段指示，也不要加任何開場白。',
  '',
  '內容：',
].join('\n');

// 旁白直接從 host.html 的 BRIEF 讀，兩邊不會走鐘
function readLines() {
  const src = readFileSync(join(ROOT, 'public', 'host.html'), 'utf8');
  const out = [];
  // ⚠️ 不要用「一整塊物件」的 regex 去抓。BRIEF 裡兩款寫在物件字面量裡
  //（`freeze: {`），另外兩款是後面補上去的（`BRIEF.cans = {`），縮排也不同，
  // 結構式的 regex 只會抓到前兩款——踩過。
  // 改成：先找出每一句 say，再往回找最近的那個 key，兩種寫法都吃得到。
  const KEY = /(?:^\s*BRIEF\.(\w+)\s*=\s*\{|^\s{2,6}(\w+):\s*\{)/gm;
  const keys = [...src.matchAll(KEY)].map((m) => ({ at: m.index, key: m[1] || m[2] }));
  for (const m of src.matchAll(/^\s*say:\s*'((?:[^'\\]|\\.)*)'/gm)) {
    const owner = keys.filter((k) => k.at < m.index).pop();
    if (owner) out.push({ key: owner.key, text: m[1].replace(/\\'/g, "'") });
  }
  return out;
}

async function tts(text, voice) {
  const body = {
    contents: [{ parts: [{ text: STYLE + text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (j.error) throw new Error(`${r.status} ${j.error.message}`.slice(0, 200));
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error('回應裡沒有音訊');
  return Buffer.from(part.inlineData.data, 'base64');   // 24kHz / 16-bit / mono 的裸 PCM
}

// 回來的是裸 PCM，沒有檔頭，瀏覽器不吃。直接餵給 ffmpeg 轉成 mp3。
// 旁白是人聲、24kHz，64kbps 單聲道就很夠，再高只是浪費頻寬。
function pcmToMp3(pcm, dest) {
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
    '-codec:a', 'libmp3lame', '-b:a', '64k', dest], { input: pcm });
}

mkdirSync(OUT, { recursive: true });

if (process.argv.includes('--sample')) {
  // 挑聲音用：同一段話，每個聲音各念一次
  const VOICES = (arg('voices', 'Sulafat,Puck,Zephyr,Kore,Aoede,Leda')).split(',');
  const line = arg('text', readLines().find((l) => l.key === 'hunt')?.text || '大家好，等一下就要開始囉。');
  const dir = join(ROOT, 'public', 'voice', 'samples');
  mkdirSync(dir, { recursive: true });
  console.log(`試聽稿（${line.length} 字）：${line.slice(0, 30)}…\n`);
  for (const v of VOICES) {
    try {
      const pcm = await tts(line, v);
      const dest = join(dir, `${v}.mp3`);
      pcmToMp3(pcm, dest);
      console.log(`✅ ${v.padEnd(10)} ${(pcm.length / 48000).toFixed(1)}s → voice/samples/${v}.mp3`);
    } catch (e) { console.error(`❌ ${v}：${e.message}`); }
  }
  console.log('\n挑好之後：node tools/make-voice.mjs --voice <名字>');
  process.exit(0);
}

const VOICE = arg('voice', 'Sulafat');
const lines = readLines();
if (!lines.length) { console.error('從 host.html 讀不到 BRIEF 的 say'); process.exit(1); }
console.log(`聲音 ${VOICE}・模型 ${MODEL}・${lines.length} 段\n`);
const manifest = { voice: VOICE, model: MODEL, style: 'taiwanese-casual', lines: {} };
let fail = 0;
for (const { key, text } of lines) {
  try {
    const pcm = await tts(text, VOICE);
    const dest = join(OUT, `${key}.mp3`);
    pcmToMp3(pcm, dest);
    const kb = Math.round(readFileSync(dest).length / 1024);
    manifest.lines[key] = { chars: text.length, sec: +(pcm.length / 48000).toFixed(1), kb };
    console.log(`✅ ${key.padEnd(8)} ${text.length} 字 → ${(pcm.length / 48000).toFixed(1)}s / ${kb}KB`);
  } catch (e) { fail++; console.error(`❌ ${key}：${e.message}`); }
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\n寫進 public/voice/（manifest.json 記了聲音與長度）${fail ? `，失敗 ${fail} 段` : ''}`);
process.exit(fail ? 1 : 0);
