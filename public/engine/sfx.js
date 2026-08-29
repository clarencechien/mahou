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
})();
