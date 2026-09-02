// bgm.js — 程序化配樂（WebAudio，零音檔）
//
// 為什麼不放 mp3、也不放 MIDI：
//   1. 零位元組。不用下載、不用煩版權，公開 deploy 不會多出任何一個要授權的檔案。
//   2. **音樂要跟著遊戲變**。錄好的檔做不到：滑雪升檔就加聲部加速、木頭人紅燈整個停拍，
//      這種事只有現場合成才便宜。
//   3. 瀏覽器沒有內建 GM 音源。想「直接播 .mid」就得塞一顆軟體合成器＋好幾 MB 的
//      soundfont，聲音還是 1998 年的 Windows 味。MIDI 適合當**創作格式**：
//      在 DAW 寫完匯出，離線轉成下面這種音符陣列，執行期照樣是我們自己的合成器在播。
//
// 聲部配置照 FC（NES）：兩支脈衝波 ＋ 三角波貝斯 ＋ 雜訊鼓。真正的 FC 味在
// **duty cycle**（12.5% / 25% / 50%），不是在「用 square」——所以脈衝波是自己算
// 傅立葉係數做 PeriodicWave，不是 oscillator.type = 'square'。
(function () {
  const BGM = (window.BGM = {});
  let ac = null, bus = null, duckGain = null;
  let timer = null, step = 0, nextT = 0, track = null, held = false;
  let intensity = 0;                       // 0–3，跟遊戲自己的「檔位」對應
  let nNotes = 0, nDrums = 0;              // 排了幾個音（給 tools/bgm-preview.mjs 量密度用）
  BGM.volume = 0.12;                       // 壓在 SFX（master 0.28）之下，音效要蓋得過配樂

  // ---- 音色 ----
  const waves = new Map();
  function pulse(d) {                      // 佔空比 d 的脈衝波
    if (waves.has(d)) return waves.get(d);
    const N = 20, real = new Float32Array(N + 1), imag = new Float32Array(N + 1);
    for (let k = 1; k <= N; k++) {
      real[k] = (2 / (k * Math.PI)) * Math.sin(2 * Math.PI * k * d);
      imag[k] = (2 / (k * Math.PI)) * (1 - Math.cos(2 * Math.PI * k * d));
    }
    const w = ac.createPeriodicWave(real, imag);
    waves.set(d, w);
    return w;
  }
  let noise = null;
  function noiseBuf() {
    if (noise) return noise;
    const n = Math.floor(ac.sampleRate * 0.5);
    noise = ac.createBuffer(1, n, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return noise;
  }
  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  function note(midi, t0, dur, ch) {
    nNotes++;
    const o = ac.createOscillator(), g = ac.createGain();
    if (ch.duty != null) o.setPeriodicWave(pulse(ch.duty)); else o.type = ch.wave || 'triangle';
    o.frequency.setValueAtTime(hz(midi), t0);
    // 尾巴留 0.02 秒讓音符斷開，不然連續同音會黏成一條；attack 給 6ms 免得爆音
    const end = t0 + Math.max(0.04, dur - 0.02);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(ch.vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    o.connect(g); g.connect(bus);
    o.start(t0); o.stop(end + 0.02);
  }
  function drum(kind, t0, vol) {
    nDrums++;
    if (kind === 'k') {                                        // 大鼓：音高直接掉下去
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t0);
      o.frequency.exponentialRampToValueAtTime(45, t0 + 0.11);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
      o.connect(g); g.connect(bus); o.start(t0); o.stop(t0 + 0.15);
      return;
    }
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf();
    s.loop = true;
    const dur = kind === 's' ? 0.13 : 0.03;                    // 小鼓長、腳踏鈸短
    if (kind === 's') { f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8; }
    else { f.type = 'highpass'; f.frequency.value = 7000; }
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t0); s.stop(t0 + dur + 0.02);
  }

  // ---- 寫譜用的小工具 ----
  // 一小節 16 步（16 分音符）。音符寫成 [起始步, midi, 幾步長]。
  // 琶音：每 every 步換一個音，四小節各用一組和弦音循環。off 是整體往後推幾步（反拍用）
  function arp(chords, every, off = 0) {
    const out = [];
    for (let bar = 0; bar < chords.length; bar++) {
      const c = chords[bar];
      for (let s = 0; s + off < 16; s += every) out.push([bar * 16 + s + off, c[(s / every) % c.length], every]);
    }
    return out;
  }
  // 打點貝斯：pat 是一小節內的音級位移，undefined 代表這一格不彈
  function bassline(roots, pat, every) {
    const out = [];
    for (let bar = 0; bar < roots.length; bar++) {
      for (let i = 0; i < pat.length; i++) {
        if (pat[i] == null) continue;
        out.push([bar * 16 + i * every, roots[bar] + pat[i], every]);
      }
    }
    return out;
  }

  const TRACKS = {};

  // ---- 滑雪下坡：往下衝的驅動曲，Am–F–C–G ----
  const SKI_HARM = [[69, 72, 76], [65, 69, 72], [72, 76, 79], [67, 71, 74]];
  TRACKS.ski = {
    bpm: 150, lvBpm: 0.07, steps: 64,
    ch: [
      { name: 'lead', duty: 0.125, vol: 0.30, lvMin: 0, notes: [
        [0, 76, 2], [2, 81, 2], [4, 79, 2], [6, 76, 2], [8, 76, 4], [12, 74, 2], [14, 72, 2],
        [16, 77, 4], [20, 76, 2], [22, 77, 2], [24, 81, 4], [28, 79, 4],
        [32, 76, 2], [34, 79, 2], [36, 84, 4], [40, 83, 2], [42, 79, 2], [44, 76, 4],
        [48, 74, 2], [50, 79, 2], [52, 83, 4], [56, 81, 2], [58, 79, 2], [60, 74, 4],
      ] },
      // 第一檔的琶音刻意踩在**反拍**。踩正拍的話會跟貝斯的 8 分疊在同一格，
      // 量到的密度只多 4%——聽起來就是同一段音樂大聲了一點。第二檔再切成 16 分填滿。
      { name: 'harm', duty: 0.25, vol: 0.17, lvMin: 1, altLv: 2,
        notes: arp(SKI_HARM, 2, 1), alt: arp(SKI_HARM, 1) },
      { name: 'spark', duty: 0.5, vol: 0.16, lvMin: 3, notes: arp([
        [81, 84, 88], [77, 81, 84], [84, 88, 91], [79, 83, 86],
      ], 1) },
      { name: 'bass', wave: 'triangle', vol: 0.42, lvMin: 0,
        notes: bassline([45, 41, 48, 43], [0, 0, 12, 0, 0, 0, 12, 7], 2) },
    ],
    drums(b, s, lv) {
      const out = [];
      if (b === 0 || b === 8) out.push(['k', 0.55]);
      if (b === 4 || b === 12) out.push(['s', 0.30]);
      if (b % 2 === 0) out.push(['h', 0.14]);
      else if (lv >= 2) out.push(['h', 0.13]);                 // 第二檔起腳踏鈸切成 16 分
      if (lv >= 2 && (b === 7 || b === 15)) out.push(['s', 0.16]);
      // 頂檔加雙踏，最後一小節再補一段小鼓滾奏。第三檔的 16 分格已經滿了，
      // 再加旋律線是「疊在同一格」，量起來完全沒變忙——要加就得加在還空著的地方。
      if (lv >= 3) {
        if (b === 6 || b === 14) out.push(['k', 0.40]);
        if (s >= 60) out.push(['s', 0.22]);
      }
      return out;
    },
  };

  // ---- 一二三木頭人：躡手躡腳的曲子，C–Am–F–G ----
  // 這首的重點不在旋律，在**它會停**：紅燈時整首歌卡在原地，綠燈再從同一格接下去。
  // 音樂本身就是紅綠燈，不用再多一個提示。所以寫得稀疏，留空間給「一二三木頭人」的喊聲。
  TRACKS.freeze = {
    bpm: 124, lvBpm: 0.06, steps: 64,
    ch: [
      { name: 'lead', duty: 0.125, vol: 0.26, lvMin: 0, notes: [
        [0, 72, 2], [4, 76, 2], [8, 79, 2], [10, 76, 2], [12, 72, 4],
        [16, 69, 2], [20, 72, 2], [24, 76, 2], [26, 72, 2], [28, 69, 4],
        [32, 65, 2], [36, 69, 2], [40, 72, 4], [44, 69, 2], [46, 65, 2],
        [48, 67, 2], [52, 71, 2], [56, 74, 4], [60, 71, 4],
      ] },
      // 琶音的升級放在第二段（原本放第三段，量到第二段只比第一段多 12%——
      // 只多一個小鼓背拍，數字太薄）
      { name: 'harm', duty: 0.5, vol: 0.13, lvMin: 1, altLv: 2,
        notes: arp([[60, 64], [57, 60], [53, 57], [55, 59]], 4, 2),
        alt: arp([[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], 2, 1) },
      // 踮腳的貝斯：四分打點、句尾插一個八分，像偷偷多走半步
      { name: 'bass', wave: 'triangle', vol: 0.40, lvMin: 0,
        notes: bassline([48, 45, 41, 43], [0, 0, 7, 0, null, 12, 7, 5], 2) },
    ],
    drums(b, s, lv) {
      const out = [];
      if (b === 0) out.push(['k', 0.50]);
      if (b === 10) out.push(['k', 0.34]);                     // 落在奇怪的位置，才有鬼祟感
      if (b % 4 === 0) out.push(['h', 0.11]);
      if (lv >= 1 && b % 2 === 0) out.push(['h', 0.09]);
      if (lv >= 2 && (b === 4 || b === 12)) out.push(['s', 0.22]);
      if (lv >= 3 && b % 2 === 1) out.push(['h', 0.08]);
      if (lv >= 3 && (b === 6 || b === 14)) out.push(['k', 0.30]);
      return out;
    },
  };

  // ---- 名畫變色龍：美術館裡找東西，Am–F–Dm–E ----
  // 這首要**安靜**。玩家在瞇著眼睛掃一張畫，音樂大聲只會妨礙。所以低檔位完全沒有鼓，
  // 到了最後幾隻才把時鐘般的滴答放進來——那時候才需要催。
  TRACKS.hunt = {
    bpm: 96, lvBpm: 0.05, steps: 64,
    ch: [
      { name: 'lead', duty: 0.5, vol: 0.20, lvMin: 0, notes: [
        [0, 69, 4], [4, 72, 4], [8, 76, 6], [14, 72, 2],
        [16, 69, 4], [20, 65, 4], [24, 69, 8],
        [32, 65, 4], [36, 69, 4], [40, 74, 6], [46, 69, 2],
        [48, 68, 4], [52, 71, 4], [56, 76, 8],
      ] },
      { name: 'harm', duty: 0.25, vol: 0.10, lvMin: 2, altLv: 3,
        notes: arp([[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]], 4),
        alt: arp([[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]], 2) },
      { name: 'bass', wave: 'triangle', vol: 0.36, lvMin: 0,
        notes: bassline([45, 41, 38, 40], [0, null, null, 7, null, null, 12, null], 2) },
    ],
    drums(b, s, lv) {
      const out = [];
      if (lv >= 1 && b === 0) out.push(['h', 0.09]);
      if (lv >= 2 && b % 8 === 0) out.push(['h', 0.10]);
      if (lv >= 3 && b % 4 === 0) out.push(['h', 0.12]);       // 只剩最後幾隻：秒針開始走
      if (lv >= 3 && (b === 0 || b === 8)) out.push(['k', 0.30]);
      return out;
    },
  };

  // ---- 砸罐子：進行曲，越後面的關卡越重，Dm–Bb–F–C ----
  TRACKS.cans = {
    bpm: 132, lvBpm: 0.05, steps: 64,
    ch: [
      { name: 'lead', duty: 0.25, vol: 0.28, lvMin: 0, notes: [
        [0, 62, 4], [4, 65, 2], [6, 69, 2], [8, 74, 4], [12, 69, 4],
        [16, 70, 4], [20, 74, 2], [22, 70, 2], [24, 65, 6], [30, 62, 2],
        [32, 65, 4], [36, 69, 2], [38, 72, 2], [40, 77, 4], [44, 72, 4],
        [48, 72, 4], [52, 76, 2], [54, 72, 2], [56, 67, 6], [62, 62, 2],
      ] },
      { name: 'harm', duty: 0.125, vol: 0.14, lvMin: 1, altLv: 2,
        notes: arp([[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], 4, 2),
        alt: arp([[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], 2, 1) },
      { name: 'bass', wave: 'triangle', vol: 0.46, lvMin: 0,
        notes: bassline([38, 34, 41, 36], [0, 0, 0, 12, 0, 0, 7, 12], 2) },
    ],
    drums(b, s, lv) {
      const out = [];
      if (b % 4 === 0) out.push(['k', 0.52]);                  // 四拍四踏，砸東西要有重量
      if (b === 4 || b === 12) out.push(['s', 0.34]);
      if (b % 2 === 0) out.push(['h', 0.13]);
      if (lv >= 2 && b % 2 === 1) out.push(['h', 0.11]);
      if (lv >= 2 && (b === 6 || b === 14)) out.push(['s', 0.18]);
      if (lv >= 3 && (b === 2 || b === 10)) out.push(['k', 0.34]);
      if (lv >= 3 && s >= 56) out.push(['s', 0.20]);
      return out;
    },
  };

  // ---- 排程 ----
  // ⚠️ 音符**不能**用 setTimeout 觸發，一定飄。標準做法：25ms 醒一次，把接下來
  // 100ms 內該響的音以 ac.currentTime 為基準先排進去（Web Audio 的 lookahead scheduler）。
  const LOOKAHEAD = 0.1, TICK = 25;
  function stepDur() { return 60 / (track.bpm * (1 + intensity * track.lvBpm)) / 4; }

  function scheduleStep(s, t) {
    for (const ch of track.ch) {
      if (intensity < ch.lvMin) continue;
      const list = ch.alt && intensity >= ch.altLv ? ch.alt : ch.notes;
      for (const [at, midi, len] of list) if (at === s) note(midi, t, len * stepDur(), ch);
    }
    for (const [kind, vol] of track.drums(s % 16, s, intensity)) drum(kind, t, vol);
  }

  function pump() {
    if (held) return;
    while (nextT < ac.currentTime + LOOKAHEAD) {
      scheduleStep(step, nextT);
      nextT += stepDur();
      step = (step + 1) % track.steps;
    }
  }

  BGM.play = function (name) {
    if (!window.SFX || !TRACKS[name]) return;
    SFX.init();
    ac = SFX.context && SFX.context();
    if (!ac) return;
    if (timer) BGM.stop();
    if (!bus) {
      bus = ac.createGain();
      duckGain = ac.createGain();
      duckGain.gain.value = 1;
      bus.connect(duckGain); duckGain.connect(ac.destination);
    }
    // stop() 用 setTargetAtTime 淡出，那條自動化不會自己結束；不先 cancel 就直接寫 .value
    // 的話會被殘留的排程蓋掉，第二次開始比賽就變成沒聲音
    bus.gain.cancelScheduledValues(ac.currentTime);
    bus.gain.setValueAtTime(BGM.volume, ac.currentTime);
    track = TRACKS[name];
    held = false; step = 0; nextT = ac.currentTime + 0.08;
    timer = setInterval(pump, TICK);
    pump();
  };
  BGM.stop = function () {
    clearInterval(timer); timer = null; held = false;
    if (bus) bus.gain.setTargetAtTime(0.0001, ac.currentTime, 0.08);   // 直接切會啪一聲
  };
  // 卡在原地：木頭人的紅燈。不是暫停音量，是**排程器不再排音**，綠燈再從同一格接下去。
  // 已經排進 WebAudio 的音會自然收尾（最多一格），所以聽起來是「彈到一半停住」而不是被剪斷。
  BGM.hold = function (on) {
    if (!timer || held === !!on) return;
    held = !!on;
    if (!held) nextT = ac.currentTime + 0.02;                  // 停了多久不算拍，直接從現在接
  };
  BGM.playing = () => !!timer;
  BGM.holding = () => held;
  BGM.out = () => duckGain;                // 錄音／分析用的取樣點（tools/bgm-preview.mjs）
  // 「這一檔有沒有真的變忙」用排程器自己的計數最準：從錄音抓起音，
  // 到了 16 分音符就飽和（音跟音之間包絡沒掉下來），量到的會是假的持平。
  BGM.stats = function () { const r = { notes: nNotes, drums: nDrums }; nNotes = nDrums = 0; return r; };
  BGM.setVolume = function (v) {
    BGM.volume = Math.max(0, Math.min(0.4, v));
    if (bus && timer) bus.gain.setTargetAtTime(BGM.volume, ac.currentTime, 0.05);
  };
  BGM.setIntensity = function (lv) { intensity = Math.max(0, Math.min(3, lv | 0)); };
  BGM.tracks = () => Object.keys(TRACKS);
  // 音效要蓋得過配樂：撞到、升檔那種大事件先把配樂壓下去零點幾秒再放回來
  BGM.duck = function (amount = 0.45, ms = 220) {
    if (!duckGain || !timer) return;
    const t = ac.currentTime;
    duckGain.gain.cancelScheduledValues(t);
    duckGain.gain.setValueAtTime(amount, t);
    duckGain.gain.setTargetAtTime(1, t + ms / 1000, 0.12);
  };
})();
