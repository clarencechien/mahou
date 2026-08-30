// paint.js — 名畫變色龍：名畫載入／像素化＋變色龍（隱藏小人）渲染
// 移植自 masterpiece_chameleon_fullscreen_poses_lab 原型，去掉 DOM 依賴改吃參數物件。
// 名畫走 Wikimedia 直連；載不到就退程序化抽象畫，遊戲永遠開得起來（家宴現場網路不可信）。
(function () {
  const P = (window.PAINT = {});

  // 可覆寫，測試時指到本機的假 Commons（含逐級退寬度的行為）
  P.FILE = (f, w) => 'https://commons.wikimedia.org/wiki/Special:Redirect/file/' + encodeURIComponent(f) + '?width=' + (w || 1280);
  const FILE = (f, w) => P.FILE(f, w);
  // 兩套主題各八張，全部是公有領域作品（Wikimedia 直連，載不到退程序化抽象畫）。
  // 挑選標準是「好不好藏人」：畫面要夠花、明度層次多，純色大背景的畫藏不住小人。
  P.THEMES = [
    {
      key: 'art', name: '名畫系',
      list: [
        { name: '星夜', meta: 'Vincent van Gogh · 1889', file: 'Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg' },
        { name: '神奈川沖浪裏', meta: '葛飾北齋 · c.1830–31', file: 'The_Great_Wave_off_Kanagawa.jpg' },
        { name: '蒙娜麗莎', meta: 'Leonardo da Vinci · c.1503–19', file: 'Leonardo_da_Vinci_-_Mona_Lisa.jpg' },
        { name: '吶喊', meta: 'Edvard Munch · 1893', file: 'Edvard_Munch_-_The_Scream.jpg' },
        { name: '維納斯的誕生', meta: 'Sandro Botticelli · c.1484–86', file: 'Birth_of_Venus_Botticelli.jpg' },
        { name: '睡蓮', meta: 'Claude Monet · 1920–26', file: 'Water_lilies_Monet.jpg' },
        { name: '吻', meta: 'Gustav Klimt · 1907–08', file: 'The_Kiss_-_Gustav_Klimt_-_Google_Cultural_Institute.jpg' },
        { name: '大碗島的星期天下午', meta: 'Georges Seurat · 1884', file: 'A_Sunday_on_La_Grande_Jatte,_Georges_Seurat,_1884.jpg' },
      ],
    },
    {
      // 卡通系＝「看起來就像卡通」的公有領域作品：戲畫、妖怪繪卷、國芳的貓、
      // 波希的怪物、盧梭的平塗叢林、布勒哲爾的一百個小人。
      // ⚠️ 吉伊卡哇／皮克敏／寶可夢這類還在版權內的角色不能放進來。
      key: 'toon', name: '卡通系',
      list: [
        { name: '鳥獸戲畫・相撲', meta: '傳鳥羽僧正 · 12 世紀', file: 'Chouju_sumo2.jpg' },
        { name: '百鬼夜行繪卷', meta: '室町時代 · 付喪神', file: 'Hyakki-Yagyo-Emaki_Tsukumogami_1.jpg' },
        { name: '貓飼好五十三疋', meta: '歌川國芳 · 1848', file: 'Cats_suggested_as_the_fifty-three_stations_of_the_Tokaido.jpg' },
        { name: '東海道五十三對', meta: '歌川國芳 · c.1845', file: 'Kuniyoshi_Utagawa,_The_fifty_three_stations_of_the_tokaido.jpg' },
        { name: '相馬の古內裏', meta: '歌川國芳 · c.1844 · 骸骨', file: 'Takiyasha_the_Witch_and_the_Skeleton_Spectre,_by_Utagawa_Kuniyoshi.jpg' },
        { name: '人間樂園', meta: 'Hieronymus Bosch · c.1500', file: 'The_Garden_of_earthly_delights.jpg' },
        { name: '夢', meta: 'Henri Rousseau · 1910', file: 'Henri_Rousseau_-_Il_sogno.jpg' },
        { name: '尼德蘭箴言', meta: 'Pieter Bruegel · 1559', file: 'Pieter_Bruegel_the_Elder_-_The_Dutch_Proverbs_-_Google_Art_Project.jpg' },
      ],
    },
  ];
  P.theme = 0;
  P.setTheme = function (i) { P.theme = ((i | 0) % P.THEMES.length + P.THEMES.length) % P.THEMES.length; P.ARTS = P.THEMES[P.theme].list; };
  P.ARTS = P.THEMES[0].list;

  // 載入名畫。cb(img|null, info)
  //
  // 為什麼要退寬度重試：Commons 的縮圖是「有人要過才生成、之後才進 CDN」。
  // 蒙娜麗莎那種名作 1600px 早就在快取裡，秒回；但卡通系那幾張冷門作品
  // （鳥獸戲畫、國芳的貓）1600px 可能要現生，第一個人就會等很久。
  // 原本 8 秒超時 → 整套卡通系在現場全部退成程序化抽象畫＝「沒有圖」。
  // 所以逐級退寬度：1280 → 800，兩個都是 Commons 的標準縮圖尺寸（比較可能已在快取）。
  // 也不再要 1600：畫布只有 960 寬，之後還要打成像素格，1280 已經綽綽有餘，
  // 而且位元組少一半（實測布勒哲爾 1600px 1085KB → 1280px 480KB）。
  const WIDTHS = [1280, 800];
  P.LOAD_TIMEOUT = 10000;
  P.load = function (idx, cb) {
    const art = P.ARTS[idx % P.ARTS.length];
    const t0 = (performance && performance.now) ? performance.now() : Date.now();
    let step = 0;
    const attempt = () => {
      if (step >= WIDTHS.length) { cb(null, { name: art.name, ok: false, ms: Math.round(now() - t0) }); return; }
      const w = WIDTHS[step++];
      const img = new Image();
      let done = false;
      const finish = (ok) => {
        if (done) return; done = true;
        clearTimeout(t);
        if (ok) cb(img, { name: art.name, ok: true, width: w, ms: Math.round(now() - t0) });
        else attempt();
      };
      const t = setTimeout(() => {
        // ⚠️ 超時一定要真的把這個請求收掉，不能只是不理它。
        // 瀏覽器對同一個 host 只開 6 條連線，卡住的請求會一直佔著；
        // 一次預載 8 張的話，六條全被卡死，連退寬度的重試都排不進去
        //（症狀就是整套主題「一張都載不到」，而不是慢）。
        img.onload = img.onerror = null;
        img.src = '';
        finish(false);
      }, P.LOAD_TIMEOUT);
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = FILE(art.file, w);
    };
    const now = () => ((performance && performance.now) ? performance.now() : Date.now());
    attempt();
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 變色龍藏匿位置：正規化座標（0-1 相對於畫的顯示矩形）。
  // ⚠️ 這段跟 worker/room.js 的 placeChams 是同一份演算法，改一邊一定要改另一邊——
  // DO 用它做命中判定，host 用它渲染，兩邊必須長出一模一樣的位置。
  // best-candidate 撒點：每一隻都丟 12 個候選，挑「離已放的最遠」那個。
  // 舊版是「隨機丟、太近就重試」，20 隻的時候會撞到重試上限而少放好幾隻，
  // 而且剩下的會擠在同一區——正好是「小人一起躲」的原因。
  P.place = function (seed, count) {
    const rnd = mulberry32(seed);
    const out = [];
    for (let i = 0; i < count; i++) {
      let best = null, bestD = -1;
      for (let k = 0; k < 12; k++) {
        const x = 0.06 + rnd() * 0.88, y = 0.20 + rnd() * 0.74;
        let d = 9;
        for (const p of out) d = Math.min(d, Math.hypot((p.x - x) * 1.7, p.y - y));   // 1.7 = 畫面比例，讓橫向也算得夠開
        if (d > bestD) { bestD = d; best = { x, y }; }
      }
      out.push({ x: best.x, y: best.y, pose: Math.floor(rnd() * 5) });
    }
    return out;
  };

  // 沒網路時的抽象畫：色帶＋圓弧＋Bayer 抖動，10 色受限調色盤（風格聖經 §0）
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const FALLBACK_PALS = [
    ['#1b2a4a', '#274b7a', '#3a6ea5', '#7fa8d0', '#e8d9a0', '#d4a24e', '#a06a35', '#5f4527', '#2f4858', '#c05f4e'],
    ['#2d2137', '#54365f', '#8a4d76', '#c76d7e', '#eda58a', '#f5d0a9', '#5d7052', '#8ba36b', '#324a3f', '#e0b449'],
    ['#20343c', '#2f5d62', '#5e8b7e', '#a7c4bc', '#dfeeea', '#e0a458', '#a4693f', '#6f4030', '#41292c', '#c8b88a'],
  ];
  P.procedural = function (seed, W, H) {
    const rnd = mulberry32(seed);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const pal = FALLBACK_PALS[Math.floor(rnd() * FALLBACK_PALS.length)];
    const cell = Math.max(4, Math.round(W / 96));            // 內部就是粗格子，天然像素風
    const bandN = 4 + Math.floor(rnd() * 3);
    const bands = [];
    for (let i = 0; i < bandN; i++) bands.push({ y: (i + rnd() * .8) / bandN, amp: .04 + rnd() * .07, ph: rnd() * 7, c: i * 2 % pal.length });
    const blobs = [];
    for (let i = 0; i < 7; i++) blobs.push({ x: rnd(), y: rnd(), r: .06 + rnd() * .14, c: (1 + i * 3) % pal.length });
    for (let y = 0; y < H; y += cell) {
      for (let x = 0; x < W; x += cell) {
        const u = x / W, v = y / H;
        let ci = pal.length - 1;
        for (const b of bands) { if (v > b.y + Math.sin(u * 6 + b.ph) * b.amp) ci = b.c; }
        for (const b of blobs) {
          const d = Math.hypot(u - b.x, (v - b.y) * (H / W));
          if (d < b.r) ci = b.c;
          else if (d < b.r * 1.25 && BAYER[(y / cell) & 3][(x / cell) & 3] / 16 > (d - b.r) / (b.r * .25)) ci = b.c;
        }
        g.fillStyle = pal[ci];
        g.fillRect(x, y, cell, cell);
      }
    }
    return cv;
  };

  // 像素化：img（可為 null → 程序化）畫進 W×H 緩衝，contain-fit。
  // 回傳 {bg, fit}。名畫來源沒有 CORS 也沒關係——偽裝只用 drawImage，不做 pixel read。
  P.pixelize = function (img, W, H, opts) {
    const o = Object.assign({ block: 6, contrast: 106, sat: 108, levels: 9, seed: 1 }, opts);
    const bg = document.createElement('canvas');
    bg.width = W; bg.height = H;
    const g = bg.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#050609'; g.fillRect(0, 0, W, H);
    let fit;
    if (!img) {
      const art = P.procedural(o.seed, W, H);
      fit = { x: 0, y: 0, w: W, h: H };
      g.drawImage(art, 0, 0);
      return { bg, fit, fallback: true };
    }
    const s = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    const fw = img.naturalWidth * s, fh = img.naturalHeight * s;
    fit = { x: (W - fw) / 2, y: (H - fh) / 2, w: fw, h: fh };
    const tiny = document.createElement('canvas');
    tiny.width = Math.max(2, Math.round(fw / o.block));
    tiny.height = Math.max(2, Math.round(fh / o.block));
    const tg = tiny.getContext('2d', { willReadFrequently: true });
    tg.imageSmoothingEnabled = true;
    tg.filter = `contrast(${o.contrast}%) saturate(${o.sat}%)`;
    tg.drawImage(img, 0, 0, tiny.width, tiny.height);
    tg.filter = 'none';
    try {                                                    // 來源允許 pixel read 才做色階量化
      const q = (v) => { const step = 255 / (o.levels - 1); return Math.round(v / step) * step; };
      const d = tg.getImageData(0, 0, tiny.width, tiny.height);
      for (let i = 0; i < d.data.length; i += 4) { d.data[i] = q(d.data[i]); d.data[i + 1] = q(d.data[i + 1]); d.data[i + 2] = q(d.data[i + 2]); }
      tg.putImageData(d, 0, 0);
    } catch (e) { /* tainted：跳過量化，像素化仍然成立 */ }
    g.drawImage(tiny, fit.x, fit.y, fit.w, fit.h);
    return { bg, fit, fallback: false };
  };

  // ---- 五種姿勢（lab 原樣移植）----
  const LW = 24, LH = 32;
  function buildPose(kind) {
    const cells = new Set();
    const add = (x, y) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < LW && y >= 0 && y < LH) cells.add(x + ',' + y); };
    const rect = (x, y, w, h) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) add(xx, yy); };
    const line = (x0, y0, x1, y1, t = 2) => {
      const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx - dy, x = x0, y = y0;
      while (true) {
        for (let oy = -Math.floor(t / 2); oy <= Math.floor(t / 2); oy++)
          for (let ox = -Math.floor(t / 2); ox <= Math.floor(t / 2); ox++) add(x + ox, y + oy);
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
      }
    };
    const head = (cx, cy) => { rect(cx - 2, cy - 3, 5, 7); rect(cx - 3, cy - 2, 7, 5); };
    if (kind === 0) { head(13, 7); line(11, 11, 9, 19, 5); line(10, 13, 4, 9, 3); line(10, 13, 17, 9, 3); line(9, 19, 6, 29, 3); line(9, 20, 13, 29, 3); }
    else if (kind === 1) { head(12, 6); rect(9, 10, 7, 11); line(10, 12, 4, 9, 3); line(4, 9, 4, 4, 3); line(15, 12, 20, 9, 3); line(20, 9, 20, 4, 3); line(11, 20, 10, 30, 3); line(14, 20, 15, 30, 3); }
    else if (kind === 2) { head(12, 8); rect(9, 12, 7, 10); line(10, 13, 7, 5, 3); line(7, 5, 10, 1, 3); line(15, 13, 17, 5, 3); line(17, 5, 14, 1, 3); line(11, 21, 10, 30, 3); line(14, 21, 15, 30, 3); }
    else if (kind === 3) { head(12, 6); rect(9, 10, 7, 9); line(10, 13, 2, 9, 3); line(15, 13, 22, 9, 3); line(10, 18, 4, 29, 3); line(15, 18, 21, 29, 3); }
    // 第五種：立正站好、手垂在身側。原本是趴著的姿勢，外框又寬又矮，
    // 縮到畫上只剩一坨看不出是人——說明卡跟遊戲裡都認不出來，所以換掉。
    else { head(12, 6); rect(9, 10, 7, 11); line(9, 12, 8, 20, 3); line(16, 12, 17, 20, 3); line(11, 21, 11, 30, 3); line(14, 21, 14, 30, 3); }
    return cells;
  }
  const POSE_CELLS = [0, 1, 2, 3, 4].map(buildPose);
  const POSE_BOUNDS = POSE_CELLS.map((cells) => {
    let minX = 99, minY = 99, maxX = -1, maxY = -1;
    for (const k of cells) {
      const [x, y] = k.split(',').map(Number);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
  });
  const EYES = [[[12, 7], [15, 7]], [[11, 6], [14, 6]], [[11, 8], [14, 8]], [[11, 6], [14, 6]], [[11, 6], [14, 6]]];
  P.POSE_BOUNDS = POSE_BOUNDS;

  function cellsPath(cells, px, py, u, ox = 0, oy = 0) {
    const p = new Path2D();
    for (const k of cells) {
      const [x, y] = k.split(',').map(Number);
      p.rect(Math.round(px + x * u + ox), Math.round(py + y * u + oy), Math.max(1, Math.ceil(u)), Math.max(1, Math.ceil(u)));
    }
    return p;
  }

  // ch: {x,y(正規化), pose, blink}；opts: {hNorm, depth(0-1), edge(0-1), eyeSize, camoOffset}
  P.drawChameleon = function (ctx, bg, fit, ch, opts) {
    const cells = POSE_CELLS[ch.pose], b = POSE_BOUNDS[ch.pose];
    const targetH = opts.hNorm * fit.h;
    const u = targetH / b.h;
    const cx = fit.x + ch.x * fit.w, groundY = fit.y + ch.y * fit.h;
    const px = cx - (b.minX + b.w / 2) * u, py = groundY - (b.maxY + 1) * u;
    const body = cellsPath(cells, px, py, u);
    const depth = opts.depth, off = opts.camoOffset ?? 5;

    if (depth > 0) {                                        // 投影：立體感越高越好找
      const sh = Math.round(depth * Math.max(2, u * 2.8));
      ctx.save(); ctx.globalAlpha = .12 + .35 * depth; ctx.fillStyle = '#050506';
      ctx.fill(cellsPath(cells, px, py, u, sh, Math.round(sh * .72)));
      ctx.restore();
    }
    ctx.save(); ctx.clip(body); ctx.drawImage(bg, off, -Math.round(off * .65)); ctx.restore();   // 偽裝：直接借畫底下的像素
    if (depth > 0) {                                        // 邊緣亮暗條＝voxel 質感
      const strip = Math.max(1, Math.round(u * .24));
      const has = (x, y) => cells.has(x + ',' + y);
      ctx.save();
      for (const k of cells) {
        const [x, y] = k.split(',').map(Number);
        const sx = Math.round(px + x * u), sy = Math.round(py + y * u);
        const cw = Math.max(1, Math.ceil(u)), chh = Math.max(1, Math.ceil(u));
        if (!has(x - 1, y)) { ctx.globalAlpha = .08 + .24 * depth; ctx.fillStyle = '#fff6dd'; ctx.fillRect(sx, sy, strip, chh); }
        if (!has(x, y - 1)) { ctx.globalAlpha = .06 + .20 * depth; ctx.fillStyle = '#fff9e8'; ctx.fillRect(sx, sy, cw, strip); }
        if (!has(x + 1, y)) { ctx.globalAlpha = .10 + .34 * depth; ctx.fillStyle = '#090a0d'; ctx.fillRect(sx + cw - strip, sy, strip, chh); }
        if (!has(x, y + 1)) { ctx.globalAlpha = .08 + .30 * depth; ctx.fillStyle = '#07080a'; ctx.fillRect(sx, sy + chh - strip, cw, strip); }
      }
      ctx.restore();
    }
    if (opts.edge > 0) {                                    // 輪廓破綻：越高越好找
      ctx.save(); ctx.globalAlpha = opts.edge; ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = ch.pose % 2 ? '#d9ecff' : '#ffe7b0'; ctx.fill(body); ctx.restore();
    }
    const eyeSize = opts.eyeSize ?? 3;
    ctx.save(); ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = 'rgba(255,255,255,.88)';
    for (const [ex, ey] of EYES[ch.pose]) {
      const X = Math.round(px + ex * u), Y = Math.round(py + ey * u);
      if (ch.blink) ctx.fillRect(X - Math.round(eyeSize * .55), Y, Math.max(2, eyeSize + 1), Math.max(1, Math.round(eyeSize * .28)));
      else { ctx.globalAlpha = .36; ctx.fillRect(X - Math.floor(eyeSize / 2), Y - Math.floor(eyeSize / 2), eyeSize, eyeSize); ctx.globalAlpha = 1; }
    }
    ctx.restore();
  };
})();
