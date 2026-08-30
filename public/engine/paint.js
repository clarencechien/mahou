// paint.js — 名畫變色龍：名畫載入／像素化＋變色龍（隱藏小人）渲染
// 移植自 masterpiece_chameleon_fullscreen_poses_lab 原型，去掉 DOM 依賴改吃參數物件。
// 名畫走 Wikimedia 直連；載不到就退程序化抽象畫，遊戲永遠開得起來（家宴現場網路不可信）。
(function () {
  const P = (window.PAINT = {});

  // 檔名 → 本機檔名。跟 tools/fetch-arts.mjs 的 slug 必須一模一樣。
  P.slug = (f) => f.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  // 可覆寫，測試時指到本機的假 Commons（含逐級退寬度的行為）
  P.FILE = (f, w) => 'https://commons.wikimedia.org/wiki/Special:Redirect/file/' + encodeURIComponent(f) + '?width=' + (w || 1280);
  const FILE = (f, w) => P.FILE(f, w);
  // 自己 host 的那一份（public/arts/）。同源＝canvas 不會 tainted，色階量化才跑得起來。
  P.LOCAL = (f) => '/arts/' + P.slug(f) + '.jpg';
  // 名畫系八張，全部是公有領域作品。自己 host 在 public/arts/，Wikimedia 只當備援。
  //
  // 兩條挑選標準，缺一不可：
  // 1. **好不好藏人**：畫面要夠花、明度層次多。純色大背景的畫藏不住小人。
  // 2. **小朋友看了不會怕**：家宴現場有小孩。裸體（維納斯的誕生）、驚恐（吶喊）、
  //    妖怪與骸骨（百鬼夜行、相馬の古內裏）、地獄場景（人間樂園）一律不收——
  //    就算它們藏人的效果很好。兒童遊戲那張反而是最理想的：
  //    兩百多個小孩在玩，本來就滿是小人，藏一隻進去剛剛好。
  P.THEMES = [
    {
      key: 'art', name: '名畫系',
      list: [
        { name: '星夜', meta: 'Vincent van Gogh · 1889', file: 'Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg' },
        { name: '神奈川沖浪裏', meta: '葛飾北齋 · c.1830–31', file: 'The_Great_Wave_off_Kanagawa.jpg' },
        { name: '蒙娜麗莎', meta: 'Leonardo da Vinci · c.1503–19', file: 'Leonardo_da_Vinci_-_Mona_Lisa.jpg' },
        { name: '兒童遊戲', meta: 'Pieter Bruegel · 1560', file: 'Pieter_Bruegel_the_Elder_-_Children’s_Games_-_Google_Art_Project.jpg' },
        { name: '夜巡', meta: 'Rembrandt · 1642', file: 'The_Night_Watch.jpg' },
        { name: '睡蓮', meta: 'Claude Monet · 1920–26', file: 'Water_lilies_Monet.jpg' },
        { name: '吻', meta: 'Gustav Klimt · 1907–08', file: 'The_Kiss_-_Gustav_Klimt_-_Google_Cultural_Institute.jpg' },
        { name: '大碗島的星期天下午', meta: 'Georges Seurat · 1884', file: 'A_Sunday_on_La_Grande_Jatte,_Georges_Seurat,_1884.jpg' },
      ],
    },
    {
      // 自訂主題：主持人自己從電腦選圖片。
      // 圖片**只存在這台瀏覽器的 IndexedDB 裡**——不會上傳、不會進 git、不會進部署。
      // 之前的公有領域卡通系拿掉了，因為使用者要用自己的圖；
      // 而吉伊卡哇／皮克敏／寶可夢那類素材有版權，不能放進這個公開 repo 或公開網址。
      // 直式的手機桌布靠隨機裁切就能用（見 P.pickCrop）。
      key: 'custom', name: '自訂', list: [],
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
    if (art.blob) {                                  // 自訂主題：圖片就在瀏覽器裡，不用連外
      const img = new Image();
      img.onload = () => cb(img, { name: art.name, ok: true, width: img.naturalWidth, ms: 0, src: 'local' });
      img.onerror = () => cb(null, { name: art.name, ok: false, ms: 0, src: 'local' });
      img.src = art.blob;
      return;
    }
    const t0 = (performance && performance.now) ? performance.now() : Date.now();
    // 先試自己 host 的那一份，失敗才往 Wikimedia 退
    const srcs = [{ url: P.LOCAL(art.file), tag: 'local', w: 1280 }]
      .concat(WIDTHS.map((w) => ({ url: FILE(art.file, w), tag: 'commons', w })));
    let step = 0;
    const attempt = () => {
      if (step >= srcs.length) { cb(null, { name: art.name, ok: false, ms: Math.round(now() - t0) }); return; }
      const { url: u, tag, w } = srcs[step++];
      const img = new Image();
      let done = false;
      const finish = (ok) => {
        if (done) return; done = true;
        clearTimeout(t);
        if (ok) cb(img, { name: art.name, ok: true, width: w, src: tag, ms: Math.round(now() - t0) });
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
      img.src = u;
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

  // 隨機裁切：從原圖裡挑一塊「跟畫布同比例」的區域。
  //
  // 三個好處，一次拿到：
  // 1. 直式的畫（蒙娜麗莎 1280×1913、手機桌布 800×1732）本來只能用畫面中間一條，
  //    裁切之後填滿整個畫面，藏人的面積直接多一倍以上。
  // 2. 同一張畫每一關都不一樣，玩家沒辦法靠「上次那隻在左上角」記位置。
  // 3. 放大之後細節變大，小人躲在細節裡才有得躲。
  // amount 0=不裁切（整張 contain 進去），1=裁得最兇。seed 來自 DO 的回合種子，
  // 所以同一回合重畫（例如換像素大小）不會跳掉。
  P.pickCrop = function (img, W, H, seed, amount) {
    const a = Math.max(0, Math.min(1, amount == null ? 0.6 : amount));
    if (a <= 0.001) return null;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih) return null;
    const rnd = mulberry32(seed >>> 0);
    const aspect = W / H;
    let mw = iw, mh = iw / aspect;                       // 塞得進原圖的最大同比例視窗
    if (mh > ih) { mh = ih; mw = ih * aspect; }
    const box = () => {
      const zoom = 1 - a * (0.30 + rnd() * 0.35);        // a=1 → 取 35%–70%
      const sw = Math.max(48, Math.round(mw * zoom));
      const sh = Math.max(27, Math.round(mh * zoom));
      return { sx: Math.round(rnd() * (iw - sw)), sy: Math.round(rnd() * (ih - sh)), sw, sh };
    };
    // 丟 6 個候選，挑「最藏得住人」的那個。
    // 隨便裁會裁到夜巡左上那一整片黑，或睡蓮的一池同色——太暗或太平的區塊
    // 小人不是看不見就是一眼就看到，兩種都不好玩。
    // 評分：明度標準差越高越好，平均明度偏離中間值就扣分。
    // ⚠️ 起始分數要用 -Infinity，不是 -1。夜巡那種整片暗的畫，
    // 六個候選的分數全部是負的（sd 30 − |mean−128|×0.35 ≈ −9），
    // 用 -1 當起點的話一個都選不上，best 留在 null＝那張畫完全不裁切。
    let best = null, bestScore = -Infinity;
    for (let k = 0; k < 6; k++) {
      const c = box();
      const sc = scoreCrop(img, c);
      if (sc == null) return c;                          // 讀不到像素（跨來源）就用第一個
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    return best;
  };
  let probe = null;
  function scoreCrop(img, c) {
    if (!probe) { probe = document.createElement('canvas'); probe.width = 32; probe.height = 18; }
    const g = probe.getContext('2d', { willReadFrequently: true });
    try {
      g.drawImage(img, c.sx, c.sy, c.sw, c.sh, 0, 0, 32, 18);
      const d = g.getImageData(0, 0, 32, 18).data;
      let sum = 0, sum2 = 0;
      for (let i = 0; i < d.length; i += 4) {
        const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        sum += L; sum2 += L * L;
      }
      const n = d.length / 4, mean = sum / n;
      const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
      return sd - Math.abs(mean - 128) * 0.35;
    } catch (e) { return null; }                         // canvas tainted：跳過評分
  }

  // 像素化：img（可為 null → 程序化）畫進 W×H 緩衝。
  // 有 crop 就把那一塊拉滿整個畫布（fit = 全畫面），沒有就 contain-fit。
  // 回傳 {bg, fit}。名畫來源沒有 CORS 也沒關係——偽裝只用 drawImage，不做 pixel read。
  P.pixelize = function (img, W, H, opts) {
    const o = Object.assign({ block: 6, contrast: 106, sat: 108, levels: 9, seed: 1, crop: null }, opts);
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
    const c = o.crop;
    let fw, fh;
    if (c) {
      fit = { x: 0, y: 0, w: W, h: H };                 // 裁切區塊拉滿畫布，沒有黑邊
      fw = W; fh = H;
    } else {
      const s = Math.min(W / img.naturalWidth, H / img.naturalHeight);
      fw = img.naturalWidth * s; fh = img.naturalHeight * s;
      fit = { x: (W - fw) / 2, y: (H - fh) / 2, w: fw, h: fh };
    }
    const tiny = document.createElement('canvas');
    tiny.width = Math.max(2, Math.round(fw / o.block));
    tiny.height = Math.max(2, Math.round(fh / o.block));
    const tg = tiny.getContext('2d', { willReadFrequently: true });
    tg.imageSmoothingEnabled = true;
    tg.filter = `contrast(${o.contrast}%) saturate(${o.sat}%)`;
    if (c) tg.drawImage(img, c.sx, c.sy, c.sw, c.sh, 0, 0, tiny.width, tiny.height);
    else tg.drawImage(img, 0, 0, tiny.width, tiny.height);
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
  // ---- 第二套：芽芽人（大頭、頭上一根莖、大眼睛）----
  //
  // 為什麼是自己畫不是抄：皮克敏那幾隻是任天堂的角色，不能直接複製。
  // 「頭上長芽的小人」本身是很廣的造型語彙，所以這裡自己組一套：
  // 大圓頭＋一根莖＋葉／花苞／花＋細手細腳。
  // 在畫上只有畫高 9–20%，真正認得出來的是**剪影**——莖跟大頭的輪廓
  // 其實比原本方頭人更好認，這是玩法上的差別，不是純美術。
  function buildSprout(kind) {
    const cells = new Set();
    const add = (x, y) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < LW && y >= 0 && y < LH) cells.add(x + ',' + y); };
    const rect = (x, y, w, h) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) add(xx, yy); };
    const ell = (cx, cy, rx, ry) => {
      for (let y = Math.ceil(cy - ry); y <= cy + ry; y++)
        for (let x = Math.ceil(cx - rx); x <= cx + rx; x++) {
          const dx = (x - cx) / rx, dy = (y - cy) / ry;
          if (dx * dx + dy * dy <= 1.02) add(x, y);
        }
    };
    const line = (x0, y0, x1, y1, t = 2) => {
      const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx - dy, x = x0, y = y0;
      while (true) {
        const h = Math.floor(t / 2);
        for (let oy = -h; oy <= h; oy++) for (let ox = -h; ox <= h; ox++) add(x + ox, y + oy);
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
      }
    };
    // 剪影只有這三段撐得住縮小：**一顆蛋形身體 ＋ 一根長莖 ＋ 四肢細棍**。
    // 前兩版都栽在「頭跟身體分兩顆橢圓」——縮到畫上就是一坨保齡球瓶，
    // 而且腰間那點凹陷第一個被吃掉。頭身合成一顆反而更像，也更耐縮。
    ell(11.5, 15, 4.8, 6);            // 蛋形身體：y 9–21，寬 9.6
    rect(11, 4, 2, 6);                // 莖：細細一根，比身體高一半才看得出來
    // 頭上的裝飾：葉／花苞／花。五種姿勢配三種頂，剪影才不會五隻長一樣
    if (kind === 0 || kind === 3) {                       // 葉子：偏一邊，剪影最好認
      ell(15.4, 2.2, 3.8, 1.9);
      line(12, 4, 13, 3, 1);
    } else if (kind === 1 || kind === 4) {                // 花苞
      ell(11.5, 2.2, 2.6, 2.4);
    } else {                                              // 花：四片
      for (const [ox, oy] of [[-2.6, .4], [2.6, .4], [0, -2.1], [0, 2.3]]) ell(11.5 + ox, 2.2 + oy, 1.8, 1.6);
    }
    // 四肢是細棍，而且要從身體輪廓**外面**收尾，縮小之後才留得住
    if (kind === 0) {                                     // 站著，手垂在身側
      line(8, 16, 5, 21, 2); line(15, 16, 18, 21, 2);
      line(10, 20, 9, 31, 2); line(13, 20, 14, 31, 2);
    } else if (kind === 1) {                              // 雙手舉高
      line(8, 15, 4, 8, 2); line(15, 15, 19, 8, 2);
      line(10, 20, 9, 31, 2); line(13, 20, 14, 31, 2);
    } else if (kind === 2) {                              // 單手舉（招手）
      line(8, 15, 4, 8, 2); line(15, 16, 18, 21, 2);
      line(10, 20, 9, 31, 2); line(13, 20, 14, 31, 2);
    } else if (kind === 3) {                              // 手腳張開
      line(8, 14, 1, 10, 2); line(15, 14, 22, 10, 2);
      line(10, 20, 4, 31, 2); line(13, 20, 19, 31, 2);
    } else {                                              // 走路：手腳一前一後
      line(8, 16, 4, 20, 2); line(15, 15, 20, 12, 2);
      line(10, 20, 5, 31, 2); line(13, 20, 17, 29, 2);
    }
    return cells;
  }

  function boundsOf(cells) {
    let minX = 99, minY = 99, maxX = -1, maxY = -1;
    for (const k of cells) {
      const [x, y] = k.split(',').map(Number);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }
  const IDX = [0, 1, 2, 3, 4];
  const SETS = {
    block: {
      name: '方頭人',
      cells: IDX.map(buildPose),
      eyes: [[[12, 7], [15, 7]], [[11, 6], [14, 6]], [[11, 8], [14, 8]], [[11, 6], [14, 6]], [[11, 6], [14, 6]]],
    },
    sprout: {
      name: '芽芽人',
      cells: IDX.map(buildSprout),
      // 大眼睛：位置一樣（身體是共用的），眼睛本身在 drawChameleon 放大
      eyes: IDX.map(() => [[9, 13], [14, 13]]),   // 大眼睛在蛋形的上半，左右各一
      eyeScale: 1.9,
    },
  };
  for (const k of Object.keys(SETS)) SETS[k].bounds = SETS[k].cells.map(boundsOf);
  P.CHARSETS = Object.keys(SETS).map((k) => ({ key: k, name: SETS[k].name }));
  P.charset = 'block';
  P.setCharset = function (k) { if (SETS[k]) P.charset = k; };
  const SET = () => SETS[P.charset] || SETS.block;
  Object.defineProperty(P, 'POSE_BOUNDS', { get: () => SET().bounds });

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
    const S = SET();
    const cells = S.cells[ch.pose], b = S.bounds[ch.pose];
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
    const eyeSize = Math.max(2, Math.round((opts.eyeSize ?? 3) * (S.eyeScale || 1)));
    ctx.save(); ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = 'rgba(255,255,255,.88)';
    for (const [ex, ey] of S.eyes[ch.pose]) {
      const X = Math.round(px + ex * u), Y = Math.round(py + ey * u);
      if (ch.blink) ctx.fillRect(X - Math.round(eyeSize * .55), Y, Math.max(2, eyeSize + 1), Math.max(1, Math.round(eyeSize * .28)));
      else { ctx.globalAlpha = .36; ctx.fillRect(X - Math.floor(eyeSize / 2), Y - Math.floor(eyeSize / 2), eyeSize, eyeSize); ctx.globalAlpha = 1; }
    }
    ctx.restore();
  };
})();
