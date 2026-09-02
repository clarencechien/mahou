// sfx.js — 程序化音效（WebAudio，零音檔）
// 派對遊戲在大螢幕出聲，手機只震動。AudioContext 必須由使用者手勢啟動。
(function () {
  const SFX = (window.SFX = {});
  let ac = null, master = null;
  SFX.enabled = true;

  SFX.init = function () {                       // 在按鈕的 click 裡呼叫
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.28;
    master.connect(ac.destination);
  };

  function tone(freq, t0, dur, type, vol, slideTo) {
    if (!ac || !SFX.enabled) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.5, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  const now = () => (ac ? ac.currentTime : 0);
  SFX.context = () => ac;                        // bgm.js 共用同一顆 AudioContext

  // 大螢幕上最多 12 個人同時在跳、在撞。每個事件都出聲會變成一團噪音，
  // 所以同一種音效有最短間隔：只讓第一個人的那一下出聲，其他人吃掉。
  const gates = new Map();
  function gate(key, ms) {
    const t = now();
    if (t - (gates.get(key) || -9) < ms / 1000) return false;
    gates.set(key, t);
    return true;
  }

  // 雜訊：撞擊、落地的「沙」聲。跟 bgm.js 各自持有一份，音效不該依賴配樂有沒有載入。
  let nb = null;
  function noise(t0, dur, vol, type, freq) {
    if (!ac || !SFX.enabled) return;
    if (!nb) {
      const n = Math.floor(ac.sampleRate * 0.4);
      nb = ac.createBuffer(1, n, ac.sampleRate);
      const d = nb.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = nb; src.loop = true;
    f.type = type || 'bandpass'; f.frequency.value = freq || 1200; f.Q.value = 0.7;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  // 「一」「二」「三」逐字升音，「木頭人！」是三連音收尾
  SFX.chant = function (i) {
    if (!ac) return;
    const t = now();
    if (i < 3) tone([392, 440, 494][i], t, 0.16, 'square', 0.42);
    else { tone(587, t, 0.10, 'square', 0.45); tone(659, t + 0.11, 0.10, 'square', 0.45); tone(784, t + 0.22, 0.26, 'square', 0.5); }
  };
  // 轉身：下滑 whoosh ＋ 悶響
  SFX.turn = function () {
    if (!ac) return;
    const t = now();
    tone(880, t, 0.22, 'sawtooth', 0.35, 220);
    tone(110, t + 0.06, 0.30, 'triangle', 0.5);
  };
  SFX.ok = function () { const t = now(); tone(784, t, 0.09, 'square', 0.4); tone(1047, t + 0.08, 0.16, 'square', 0.4); };
  SFX.bad = function () { const t = now(); tone(311, t, 0.30, 'sawtooth', 0.4, 150); };
  SFX.caught = function () { const t = now(); tone(233, t, 0.14, 'square', 0.5); tone(185, t + 0.13, 0.30, 'square', 0.5); };
  SFX.go = function () { const t = now(); tone(523, t, 0.10, 'square', 0.4); tone(659, t + 0.09, 0.10, 'square', 0.4); tone(880, t + 0.18, 0.22, 'square', 0.45); };
  SFX.win = function () {
    const t = now();
    [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.13, 0.24, 'square', 0.45));
  };

  // ---- 滑雪 ----
  // 起跳：短促上滑。落地跟小彈都是悶響＋一點沙聲，差別只在音量與音高，
  // 因為它們在遊戲裡的意義也只差一級（真跳台 vs 輾過去彈一下）。
  SFX.skiJump = function () {
    if (!gate('skiJump', 70)) return;
    const t = now();
    tone(440, t, 0.10, 'square', 0.30, 900);
  };
  SFX.skiLand = function () {
    if (!gate('skiLand', 70)) return;
    const t = now();
    tone(170, t, 0.09, 'triangle', 0.40);
    noise(t, 0.07, 0.16, 'lowpass', 900);
  };
  SFX.skiRoll = function () {
    if (!gate('skiRoll', 90)) return;
    const t = now();
    tone(130, t, 0.07, 'triangle', 0.24);
  };
  SFX.skiCrash = function () {
    if (!gate('skiCrash', 120)) return;
    const t = now();
    noise(t, 0.26, 0.42, 'bandpass', 700);
    tone(300, t, 0.28, 'sawtooth', 0.34, 90);
    window.BGM && BGM.duck(0.4, 260);
  };
  // 升檔：檔位越高，音階越長、越亮。這是全場最該被聽見的一下，所以配樂讓路讓得最多。
  SFX.skiGear = function (lv) {
    if (!gate('skiGear', 300)) return;
    const t = now();
    const runs = [[], [659, 784, 988], [659, 831, 988, 1245], [784, 988, 1245, 1568, 1976]];
    const seq = runs[Math.max(1, Math.min(3, lv | 0))];
    seq.forEach((f, i) => tone(f, t + i * 0.055, 0.14 + i * 0.02, 'square', 0.34));
    if (lv >= 3) tone(2637, t + seq.length * 0.055, 0.3, 'square', 0.2);
    window.BGM && BGM.duck(0.3, 120 + lv * 90);
  };
})();
