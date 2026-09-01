// bgm.js — 程序化配樂（WebAudio，零音檔）
//
// 為什麼不放 mp3、也不放 MIDI：
//   1. 零位元組。不用下載、不用煩版權，公開 deploy 不會多出任何一個要授權的檔案。
//   2. **音樂要跟著遊戲變**。錄好的檔做不到：滑雪升檔就把 BPM 推上去、加一軌和聲，
//      這件事只有現場合成才便宜。
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
  let timer = null, step = 0, nextT = 0, track = null;
  let intensity = 0;                       // 0–3，跟滑雪的檔位同一套
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

  // ---- 曲子 ----
  // 一小節 16 步（16 分音符），四小節一循環＝64 步。和聲 Am–F–C–G。
  // 音符寫成 [起始步, midi, 幾步長]。lvMin＝這一軌要到第幾檔才進來，
  // 所以升檔不是只有速度變快，是**多一層聲音疊進來**。
  const HARM = [[69, 72, 76], [65, 69, 72], [72, 76, 79], [67, 71, 74]];
  const SKI = {
    bpm: 150,
    steps: 64,
    ch: [
      { name: 'lead', duty: 0.125, vol: 0.30, lvMin: 0, notes: [
        // Am
        [0, 76, 2], [2, 81, 2], [4, 79, 2], [6, 76, 2], [8, 76, 4], [12, 74, 2], [14, 72, 2],
        // F
        [16, 77, 4], [20, 76, 2], [22, 77, 2], [24, 81, 4], [28, 79, 4],
        // C
        [32, 76, 2], [34, 79, 2], [36, 84, 4], [40, 83, 2], [42, 79, 2], [44, 76, 4],
        // G
        [48, 74, 2], [50, 79, 2], [52, 83, 4], [56, 81, 2], [58, 79, 2], [60, 74, 4],
      ] },
      // 第一檔的琶音刻意踩在**反拍**（第 1、3、5… 步）。踩正拍的話會跟貝斯的 8 分
      // 疊在同一格，量到的起音密度只多 4%——聽起來就是同一段音樂大聲了一點。
      // 第二檔再切成 16 分，正反拍都填滿。
      { name: 'harm', duty: 0.25, vol: 0.17, lvMin: 1, altLv: 2,
        notes: arp(HARM, 2, 1), alt: arp(HARM, 1) },
      { name: 'spark', duty: 0.5, vol: 0.16, lvMin: 3, notes: arp([
        [81, 84, 88], [77, 81, 84], [84, 88, 91], [79, 83, 86],
      ], 1) },
      { name: 'bass', wave: 'triangle', vol: 0.42, lvMin: 0, notes: bass([45, 41, 48, 43]) },
    ],
  };
  // 琶音：每 every 步換一個音，四小節各用一組和弦音循環。off 是整體往後推幾步（反拍用）
  function arp(chords, every, off = 0) {
    const out = [];
    for (let bar = 0; bar < 4; bar++) {
      const c = chords[bar];
      for (let s = 0; s + off < 16; s += every) out.push([bar * 16 + s + off, c[(s / every) % c.length], every]);
    }
    return out;
  }
  // 貝斯：八分音符打點，第 3、7 下跳高八度，句尾走五度——不然四小節聽起來像節拍器
  function bass(roots) {
    const P = [0, 0, 12, 0, 0, 0, 12, 7];
    const out = [];
    for (let bar = 0; bar < 4; bar++) {
      for (let i = 0; i < 8; i++) out.push([bar * 16 + i * 2, roots[bar] + P[i], 2]);
    }
    return out;
  }

  // ---- 排程 ----
  // ⚠️ 音符**不能**用 setTimeout 觸發，一定飄。標準做法：25ms 醒一次，把接下來
  // 100ms 內該響的音以 ac.currentTime 為基準先排進去（Web Audio 的 lookahead scheduler）。
  const LOOKAHEAD = 0.1, TICK = 25;
  // 每檔 +7% BPM（150 → 160.5 → 171 → 181.5）。+5% 實測聽不太出來，
  // 而升檔的重點就是要聽得出來換了一檔
  function stepDur() { return 60 / (SKI.bpm * (1 + intensity * 0.07)) / 4; }

  function scheduleStep(s, t) {
    for (const ch of track.ch) {
      if (intensity < ch.lvMin) continue;
      const list = ch.alt && intensity >= ch.altLv ? ch.alt : ch.notes;
      for (const [at, midi, len] of list) if (at === s) note(midi, t, len * stepDur(), ch);
    }
    const b = s % 16;
    if (b === 0 || b === 8) drum('k', t, 0.55);
    if (b === 4 || b === 12) drum('s', t, 0.30);
    if (b % 2 === 0) drum('h', t, 0.14);
    else if (intensity >= 2) drum('h', t, 0.13);               // 第二檔起腳踏鈸切成 16 分
    if (intensity >= 2 && (b === 7 || b === 15)) drum('s', t, 0.16);   // 句尾補一下小鼓，往前推
    // 頂檔加雙踏，最後一小節再補一段小鼓滾奏。第三檔的琶音跟 16 分格已經滿了，
    // 再加旋律線是「疊在同一格」，量起來完全沒變忙——要加就得加在還空著的地方。
    if (intensity >= 3) {
      if (b === 6 || b === 14) drum('k', t, 0.40);
      if (s >= 60) drum('s', t, 0.22);
    }
  }

  function pump() {
    while (nextT < ac.currentTime + LOOKAHEAD) {
      scheduleStep(step, nextT);
      nextT += stepDur();
      step = (step + 1) % track.steps;
    }
  }

  BGM.play = function (name) {
    if (!window.SFX) return;
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
    track = name === 'ski' ? SKI : SKI;
    step = 0; nextT = ac.currentTime + 0.08;
    timer = setInterval(pump, TICK);
    pump();
  };
  BGM.stop = function () {
    clearInterval(timer); timer = null;
    if (bus) bus.gain.setTargetAtTime(0.0001, ac.currentTime, 0.08);   // 直接切會啪一聲
  };
  BGM.playing = () => !!timer;
  BGM.out = () => duckGain;                // 錄音／分析用的取樣點（tools/bgm-preview.mjs）
  // 「這一檔有沒有真的變忙」用排程器自己的計數最準：從錄音抓起音，
  // 到了 16 分音符就飽和（音跟音之間包絡沒掉下來），量到的會是假的持平。
  BGM.stats = function () { const r = { notes: nNotes, drums: nDrums }; nNotes = nDrums = 0; return r; };
  BGM.setVolume = function (v) {
    BGM.volume = Math.max(0, Math.min(0.4, v));
    if (bus && timer) bus.gain.setTargetAtTime(BGM.volume, ac.currentTime, 0.05);
  };
  BGM.setIntensity = function (lv) { intensity = Math.max(0, Math.min(3, lv | 0)); };
  // 音效要蓋得過配樂：撞到、升檔那種大事件先把配樂壓下去零點幾秒再放回來
  BGM.duck = function (amount = 0.45, ms = 220) {
    if (!duckGain || !timer) return;
    const t = ac.currentTime;
    duckGain.gain.cancelScheduledValues(t);
    duckGain.gain.setValueAtTime(amount, t);
    duckGain.gain.setTargetAtTime(1, t + ms / 1000, 0.12);
  };
})();
