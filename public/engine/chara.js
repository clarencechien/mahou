// chara.js — 程序化角色渲染器（來源：mode7_character_canvas_64 原型）
// 32×32 設計格，U 倍放大成來源畫布；每個 (玩家,方向,幀) 預先畫好快取，之後只做 drawImage。
// 配色規則：每位玩家只有一個識別色系 accent0/1/2，帽子・背心・鞋子同色系；
// 頭髮、皮膚、褲子共用中性色，避免角色越做越花。
(function () {
  const CHARA = (window.CHARA = {});
  const BASE = {
    outline: '#211d29', hair0: '#30242f', hair1: '#4b3740',
    skin0: '#c97c58', skin1: '#eda674', skin2: '#ffd09a',
    pants0: '#30313a', pants1: '#4a4c58', eye: '#f7f0df',
  };
  CHARA.PLAYERS = [
    { name: '紅', accent0: '#9f2f37', accent1: '#dd4650', accent2: '#ff7b72' },
    { name: '橘', accent0: '#a94e1e', accent1: '#e77728', accent2: '#ffae55' },
    { name: '黃', accent0: '#9c7416', accent1: '#d7a92a', accent2: '#f5d65e' },
    { name: '綠', accent0: '#2e713b', accent1: '#48a554', accent2: '#79d877' },
    { name: '青', accent0: '#1f6f70', accent1: '#35a4a5', accent2: '#6ed5cf' },
    { name: '藍', accent0: '#315c9e', accent1: '#4b82d2', accent2: '#79a9f1' },
    { name: '紫', accent0: '#68449a', accent1: '#9161c9', accent2: '#bd8ae9' },
    { name: '粉', accent0: '#9d4775', accent1: '#d5659b', accent2: '#f498c4' },
  ];
  // 鬼／主持角色：刻意用中性暗色，跟任何玩家色都不撞
  CHARA.GUARD = { name: '鬼', accent0: '#332a44', accent1: '#4d4166', accent2: '#6b5d8c' };

  let U = 1, S = 32, sc = null, sctx = null;
  function ensure(u) {
    if (U === u && sc) return;
    U = u; S = 32 * u;
    sc = document.createElement('canvas'); sc.width = sc.height = S;
    sctx = sc.getContext('2d'); sctx.imageSmoothingEnabled = false;
  }
  const R = (c, x, y, w, h) => { sctx.fillStyle = c; sctx.fillRect(x * U, y * U, w * U, h * U); };
  const px = (c, pts) => { sctx.fillStyle = c; for (const [x, y, w = 1, h = 1] of pts) sctx.fillRect(x * U, y * U, w * U, h * U); };
  const shadow = () => { R('#0c0d14a8', 10, 29, 12, 2); R('#0c0d14a8', 8, 30, 16, 1); };

  function drawFront(P, f) {
    const bob = (f === 1 || f === 3) ? -1 : 0, step = [0, 1, 0, -1][f];
    shadow();
    R(P.outline, 10 + step, 23 + bob, 5, 6); R(P.pants0, 11 + step, 23 + bob, 4, 5);
    R(P.outline, 17 - step, 23 + bob, 5, 6); R(P.pants1, 17 - step, 23 + bob, 4, 5);
    R(P.outline, 9 + step, 27 + bob, 7, 3); R(P.accent1, 10 + step, 27 + bob, 5, 2); R(P.accent2, 10 + step, 27 + bob, 2, 1);
    R(P.outline, 16 - step, 27 + bob, 7, 3); R(P.accent1, 17 - step, 27 + bob, 5, 2); R(P.accent2, 20 - step, 27 + bob, 2, 1);
    R(P.outline, 8, 14 + bob, 16, 11); R(P.accent0, 9, 15 + bob, 14, 9); R(P.accent1, 10, 15 + bob, 12, 8);
    R(P.accent2, 15, 15 + bob, 2, 7); R(P.outline, 15, 17 + bob, 1, 7);
    R(P.outline, 6, 16 + bob, 4, 8); R(P.accent0, 7, 17 + bob, 3, 5); R(P.skin1, 7, 21 + bob, 3, 2);
    R(P.outline, 22, 16 + bob, 4, 8); R(P.accent0, 22, 17 + bob, 3, 5); R(P.skin1, 22, 21 + bob, 3, 2);
    R(P.outline, 9, 5 + bob, 14, 11); R(P.hair0, 10, 7 + bob, 12, 8);
    R(P.skin0, 11, 8 + bob, 10, 7); R(P.skin1, 11, 9 + bob, 10, 5); R(P.skin2, 13, 9 + bob, 6, 2);
    px(P.hair0, [[11, 8 + bob, 3, 2], [14, 7 + bob, 3, 2], [18, 8 + bob, 3, 2], [10, 10 + bob, 2, 3], [20, 10 + bob, 2, 3]]);
    R(P.outline, 12, 11 + bob, 2, 2); R(P.outline, 18, 11 + bob, 2, 2);
    R(P.eye, 12, 11 + bob, 1, 1); R(P.eye, 18, 11 + bob, 1, 1);
    R(P.skin0, 15, 13 + bob, 2, 1);
    R(P.outline, 10, 3 + bob, 13, 6); R(P.accent0, 11, 4 + bob, 11, 4); R(P.accent1, 12, 3 + bob, 9, 4); R(P.accent2, 14, 4 + bob, 4, 2);
    R(P.outline, 19, 7 + bob, 7, 3); R(P.accent0, 20, 7 + bob, 5, 2); R(P.accent1, 20, 7 + bob, 4, 1);
  }
  function drawBack(P, f) {
    const bob = (f === 1 || f === 3) ? -1 : 0, step = [0, 1, 0, -1][f];
    shadow();
    R(P.outline, 10 + step, 23 + bob, 5, 6); R(P.pants0, 11 + step, 23 + bob, 4, 5);
    R(P.outline, 17 - step, 23 + bob, 5, 6); R(P.pants1, 17 - step, 23 + bob, 4, 5);
    R(P.outline, 9 + step, 27 + bob, 7, 3); R(P.accent1, 10 + step, 27 + bob, 5, 2); R(P.accent2, 10 + step, 27 + bob, 2, 1);
    R(P.outline, 16 - step, 27 + bob, 7, 3); R(P.accent1, 17 - step, 27 + bob, 5, 2); R(P.accent2, 20 - step, 27 + bob, 2, 1);
    R(P.outline, 8, 14 + bob, 16, 11); R(P.accent0, 9, 15 + bob, 14, 9); R(P.accent1, 10, 15 + bob, 12, 8);
    R(P.accent2, 10, 15 + bob, 12, 1);
    R(P.outline, 6, 16 + bob, 4, 8); R(P.accent0, 7, 17 + bob, 3, 6);
    R(P.outline, 22, 16 + bob, 4, 8); R(P.accent0, 22, 17 + bob, 3, 6);
    R(P.outline, 9, 5 + bob, 14, 11); R(P.hair0, 10, 7 + bob, 12, 8); R(P.hair1, 11, 8 + bob, 10, 6);
    px(P.hair0, [[10, 10 + bob, 2, 4], [20, 10 + bob, 2, 4], [12, 13 + bob, 2, 2], [18, 13 + bob, 2, 2]]);
    R(P.outline, 10, 3 + bob, 13, 6); R(P.accent0, 11, 4 + bob, 11, 4); R(P.accent1, 12, 3 + bob, 9, 4); R(P.accent2, 14, 4 + bob, 4, 1);
  }

  function drawSide(P, f, flip) {
    const bob = (f === 1 || f === 3) ? -1 : 0, stride = [0, 2, 0, -2][f];
    shadow();
    R(P.outline, 13, 23 + bob, 4, 6); R(P.pants0, 14, 23 + bob, 3, 5);
    R(P.outline, 18 + Math.max(0, stride), 23 + bob, 4, 6); R(P.pants1, 18 + Math.max(0, stride), 23 + bob, 3, 5);
    R(P.outline, 12, 27 + bob, 6, 3); R(P.accent1, 13, 27 + bob, 4, 2); R(P.accent2, 13, 27 + bob, 2, 1);
    R(P.outline, 18 + Math.max(0, stride), 27 + bob, 7, 3); R(P.accent1, 19 + Math.max(0, stride), 27 + bob, 5, 2); R(P.accent2, 22 + Math.max(0, stride), 27 + bob, 2, 1);
    R(P.outline, 10, 14 + bob, 13, 11); R(P.accent0, 11, 15 + bob, 11, 9); R(P.accent1, 12, 15 + bob, 9, 8); R(P.accent2, 12, 16 + bob, 2, 5);
    const ax = 20 + (f === 1 ? 2 : f === 3 ? -1 : 0), ay = 16 + bob;
    R(P.outline, ax, ay, 4, 8); R(P.accent0, ax, ay + 1, 3, 5); R(P.skin1, ax, ay + 5, 3, 2);
    R(P.outline, 10, 5 + bob, 13, 11); R(P.hair0, 11, 7 + bob, 11, 8); R(P.skin0, 14, 8 + bob, 8, 7);
    R(P.skin1, 15, 9 + bob, 7, 5); R(P.skin2, 16, 9 + bob, 5, 2);
    R(P.hair0, 11, 8 + bob, 5, 3); R(P.hair0, 11, 10 + bob, 3, 4);
    R(P.outline, 19, 11 + bob, 2, 2); R(P.eye, 19, 11 + bob, 1, 1); R(P.skin2, 22, 12 + bob, 2, 1);
    R(P.outline, 10, 3 + bob, 13, 6); R(P.accent0, 11, 4 + bob, 11, 4); R(P.accent1, 12, 3 + bob, 9, 4); R(P.accent2, 14, 4 + bob, 4, 2);
    R(P.outline, 20, 7 + bob, 7, 3); R(P.accent0, 21, 7 + bob, 5, 2); R(P.accent1, 21, 7 + bob, 4, 1);
    if (flip) {
      const tmp = document.createElement('canvas'); tmp.width = tmp.height = S;
      tmp.getContext('2d').drawImage(sc, 0, 0);
      sctx.clearRect(0, 0, S, S);
      sctx.save(); sctx.translate(S, 0); sctx.scale(-1, 1); sctx.drawImage(tmp, 0, 0); sctx.restore();
    }
  }

  // 滑雪板：只換掉鞋子下方，服裝幾何完全不動。座標以 64 格為基準，用 U/2 換算
  function drawSkis(P, dir, f) {
    const ski0 = '#d9dee4', ski1 = '#8f9aa5', k = U / 2;
    const d = (c, x, y, w, h) => { sctx.fillStyle = c; sctx.fillRect(x * k, y * k, (w || 1) * k, (h || 1) * k); };
    const sway = (f === 1 ? 1 : f === 3 ? -1 : 0);
    if (dir === 'front' || dir === 'back') {
      for (const [bx, sw] of [[19, sway], [37, -sway]]) {
        d(P.outline, bx + sw, 58, 7, 6); d(ski1, bx + 1 + sw, 58, 5, 5);
        d(ski0, bx + 2 + sw, 58, 3, 4); d(P.accent2, bx + 2 + sw, 58, 3, 1);
        d(P.outline, bx + 1 + sw, 57, 5, 1); d(P.accent1, bx + 2 + sw, 57, 3, 1);
      }
    } else {
      const faceRight = dir === 'right', x0 = faceRight ? 9 : 11, tipX = faceRight ? 48 : 11;
      d(P.outline, x0, 58, 44, 3); d(ski1, x0 + 1, 59, 42, 1); d(ski0, x0 + 5, 58, 32, 1);
      d(P.outline, x0 + 2, 61, 40, 3); d(ski1, x0 + 3, 62, 38, 1); d(ski0, x0 + 7, 61, 28, 1);
      d(P.accent2, tipX, 57, 5, 1); d(P.accent1, tipX, 58, 5, 1);
    }
  }

  // 快取：key = player|dir|frame|U
  const cache = new Map();
  function build(pal, dir, frame, u, ski) {
    ensure(u);
    sctx.clearRect(0, 0, S, S);
    const P = { ...BASE, ...pal };
    if (dir === 'left') drawSide(P, frame, false);
    else if (dir === 'right') drawSide(P, frame, true);
    else (dir === 'back' ? drawBack : drawFront)(P, frame);
    if (ski) drawSkis(P, dir, frame);
    const out = document.createElement('canvas');
    out.width = out.height = S;
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.drawImage(sc, 0, 0);
    return out;
  }
  // pal 可以是 PLAYERS 索引，或直接給一個 {accent0,1,2} 物件（例如 GUARD）
  CHARA.sprite = (who, dir, frame, u, ski) => {
    u = u || 1;
    const pal = typeof who === 'number' ? CHARA.PLAYERS[who % CHARA.PLAYERS.length] : who;
    const key = (pal.name || 'x') + '|' + dir + '|' + frame + '|' + u + (ski ? '|s' : '');
    if (!cache.has(key)) cache.set(key, build(pal, dir, frame, u, ski));
    return cache.get(key);
  };
  // 以「腳底中心」對齊繪製，這樣站位不受角色高度影響
  CHARA.drawFeet = (ctx, who, dir, frame, cx, feetY, u, ski) => {
    const img = CHARA.sprite(who, dir, frame, u || 1, ski);
    ctx.drawImage(img, Math.round(cx - img.width / 2), Math.round(feetY - img.height + 2 * (u || 1)));
  };
  // 滑雪用：可縮放＋可旋轉（跳躍時轉體）
  CHARA.drawSki = (ctx, who, dir, frame, cx, feetY, scale, rot) => {
    const img = CHARA.sprite(who, dir, frame, 2, true);
    const w = img.width * scale, h = img.height * scale;
    if (!rot) { ctx.drawImage(img, Math.round(cx - w / 2), Math.round(feetY - h), Math.round(w), Math.round(h)); return; }
    ctx.save();
    ctx.translate(cx, feetY - h / 2);
    ctx.rotate(rot);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  };
})();
