// mode7.js — Mode 7 掃描線地面（來源：mode7_grounds 原型）
// 四種地表共用同一個投影器，只換 world sampler、palette 與少量紋理規則。
// 靜態場景（木頭人）畫一次快取；會捲動的場景（滑雪）才逐幀重算。
(function () {
  const M7 = (window.MODE7 = {});
  const TILE = 8, MAP = 128;
  const PALS = M7.PALS = {
    grass: ['#173c2b', '#205237', '#2b6640', '#39784a', '#4a8b55', '#71a85f', '#a6bb68', '#d6d586', '#efe7a6', '#8a633e', '#65462f'],
    snow:  ['#eef3e7', '#d9e6e4', '#bed4df', '#9bbccc', '#789eaf', '#5b7d91', '#466270', '#f6f3df', '#b7c8c8', '#8aa7b2'],
    stone: ['#292b33', '#3b3e47', '#50535c', '#686a70', '#808079', '#99968c', '#b2aa99', '#c8bda5', '#6d6254', '#50493f'],
    dirt:  ['#3d291f', '#583828', '#754a2f', '#915f3b', '#ad7648', '#c28d59', '#d8aa6d', '#ead18c', '#6d5140', '#8e7258', '#b9a07b'],
  };
  const RGB = Object.fromEntries(Object.entries(PALS).map(([k, p]) =>
    [k, p.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)])]));
  const SKY = M7.SKY = { grass: [119, 166, 188], snow: [138, 170, 189], stone: [151, 144, 135], dirt: [164, 157, 130] };
  const FAR = { grass: [48, 103, 63], snow: [209, 224, 226], stone: [121, 119, 112], dirt: [154, 105, 66] };

  function hash(x, y, s = 0) {
    let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177); n ^= n >>> 16;
    return (n >>> 0) / 4294967295;
  }
  const wrap = (n) => ((n % MAP) + MAP) % MAP;

  M7.buildWorld = function (kind) {
    const base = new Uint8Array(MAP * MAP), feature = new Uint8Array(MAP * MAP);
    const seed = { grass: 2, snow: 4, stone: 6, dirt: 8 }[kind];
    for (let ty = 0; ty < MAP; ty++) for (let tx = 0; tx < MAP; tx++) {
      const i = ty * MAP + tx;
      const macro = hash(tx >> 2, ty >> 2, seed), mid = hash(tx >> 1, ty >> 1, seed + 7), fine = hash(tx, ty, seed + 39);
      if (kind === 'grass') {
        base[i] = macro < .24 ? 1 : macro < .50 ? 2 : macro < .76 ? 3 : 4;
        if (mid > .82) base[i] = 5;
        if (fine > .992) feature[i] = 2; else if (fine < .035) feature[i] = 1;
      } else if (kind === 'snow') {
        base[i] = macro < .33 ? 1 : macro < .72 ? 0 : 7;
        if (mid < .18) base[i] = 2; if (mid < .07) base[i] = 3;
        if (fine > .92) feature[i] = 1; if (fine > .972) feature[i] = 2;
      } else if (kind === 'stone') {
        base[i] = macro < .20 ? 2 : macro < .52 ? 3 : macro < .80 ? 4 : 5;
        if (mid > .84) base[i] = 6;
        if (fine > .955) feature[i] = 1; else if (fine < .022) feature[i] = 2;
      } else {
        base[i] = macro < .18 ? 1 : macro < .48 ? 2 : macro < .76 ? 3 : 4;
        if (mid > .84) base[i] = 5;
        if (fine > .955) feature[i] = 1; else if (fine < .025) feature[i] = 2;
      }
    }
    return { base, feature, kind };
  };

  function sample(world, kind, wx, wy) {
    const fx = Math.floor(wx), fy = Math.floor(wy);
    const tx = wrap(Math.floor(fx / TILE)), ty = wrap(Math.floor(fy / TILE));
    const i = ty * MAP + tx, lx = ((fx % TILE) + TILE) % TILE, ly = ((fy % TILE) + TILE) % TILE;
    let idx = world.base[i]; const feat = world.feature[i], pal = RGB[kind];
    if (kind === 'grass') {
      if (feat === 2 && lx >= 3 && lx <= 4 && ly >= 2 && ly <= 4) idx = (hash(tx, ty, 99) > .5 ? 8 : 7);
      else if (feat === 1 && ((lx === 3 && ly >= 3) || (lx === 5 && ly >= 4 && ly <= 6))) idx = 0;
    } else if (kind === 'snow') {
      if (feat === 1 && lx >= 2 && lx <= 3 && ly <= 6) idx = 2; else if (feat === 2 && lx === 4 && ly <= 5) idx = 3;
    } else if (kind === 'stone') {
      const slabY = ((fy % 24) + 24) % 24, row = Math.floor(fy / 24), offset = (row & 1) ? 16 : 0;
      const slabX = ((fx + offset) % 32 + 32) % 32;
      if (slabY === 0 || slabX === 0) idx = 0;
      else if (slabY === 1 || slabX === 1) idx = 1;
      else if (feat === 1 && ((lx === 2 && ly >= 3 && ly <= 5) || (ly === 5 && lx >= 2 && lx <= 5))) idx = 1;
      else if (feat === 2 && lx >= 4 && ly >= 4) idx = 6;
    } else {
      const lane = ((fx % 48) + 48) % 48;
      if ((lane === 11 || lane === 12 || lane === 35 || lane === 36) && ((fy >> 3) & 3) !== 0) idx = 1;
      else if (feat === 1 && lx >= 2 && lx <= 5 && ly >= 3 && ly <= 4) idx = 8;
      else if (feat === 2 && ((lx === 4 && ly === 4) || (lx === 5 && ly === 4))) idx = 9;
    }
    return pal[idx];
  }

  // 分割畫面用：把一格視野畫進共用 ImageData 的子矩形。
  // 一次 putImageData 就能上完所有格子——分割數不是成本，總像素才是。
  // vp: {x,y,w,h,horizon,scroll,camX,f=90}
  // vp.tex：地面紋理密度倍率。只縮放取樣座標，不動幾何——
  // 每秒掃過的格子變多＝速度感變強，但碰撞、距離、難度完全沒變。
  M7.renderInto = function (img, fullW, world, vp) {
    const d = img.data, kind = world.kind;
    const f = vp.f || 90, hz = vp.horizon, camX = vp.camX || 0, scroll = vp.scroll || 0;
    const tex = vp.tex || 1;
    const sky = SKY[kind], far = FAR[kind];
    for (let ly = 0; ly < vp.h; ly++) {
      let o = ((vp.y + ly) * fullW + vp.x) * 4;
      if (ly <= hz) {
        const t = ly / hz;
        const r = Math.round(sky[0] * (1 - t * .12)), g = Math.round(sky[1] * (1 - t * .05)), b = sky[2];
        for (let lx = 0; lx < vp.w; lx++) { d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = 255; }
        continue;
      }
      const dy = ly - hz, z = f / dy, wy = z * 165 + scroll;
      for (let lx = 0; lx < vp.w; lx++) {
        const wx = (lx - vp.w / 2) * z / f * 112 + camX;
        const rgb = z > 22 ? far : sample(world, kind, wx * tex, wy * tex);
        d[o++] = rgb[0]; d[o++] = rgb[1]; d[o++] = rgb[2]; d[o++] = 255;
      }
    }
  };

  // 世界座標 → 該格的螢幕座標。從 renderInto 的投影式反推：
  //   wy = z*165 + scroll        → z  = (wy - scroll) / 165
  //   wx = (lx - w/2)*z/f*112+camX → lx = w/2 + (wx-camX)*f/(z*112)
  //   sy = horizon + f/z
  M7.project = function (vp, wx, wy) {
    const f = vp.f || 90;
    const z = (wy - (vp.scroll || 0)) / 165;
    if (z <= 0.05) return null;                       // 在鏡頭後面
    const dy = f / z;
    if (dy > vp.h * 3) return null;                   // 太近，已經衝出畫面
    return {
      sx: vp.x + vp.w / 2 + (wx - (vp.camX || 0)) * f / (z * 112),
      sy: vp.y + vp.horizon + dy,
      k: dy / (f / 1),                                // 尺寸係數（z=1 時為 1）
      z,
    };
  };

  // opts: {W,H,horizon,scroll,f=90,sky:true}
  M7.render = function (ctx, world, opts) {
    const W = opts.W, H = opts.H, horizon = opts.horizon, f = opts.f || 90;
    const kind = world.kind, scroll = opts.scroll || 0;
    const img = ctx.createImageData(W, H), d = img.data;
    const sky = SKY[kind], far = FAR[kind];
    let o = 0;
    for (let y = 0; y < H; y++) {
      if (y <= horizon) {
        const t = y / horizon;
        const r = Math.round(sky[0] * (1 - t * .12)), g = Math.round(sky[1] * (1 - t * .05)), b = sky[2];
        for (let x = 0; x < W; x++) { d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = 255; }
        continue;
      }
      const dy = y - horizon, z = f / dy, wy = z * 165 + scroll;
      for (let x = 0; x < W; x++) {
        const wx = (x - W / 2) * z / f * 112;
        const rgb = z > 22 ? far : sample(world, kind, wx, wy);
        d[o++] = rgb[0]; d[o++] = rgb[1]; d[o++] = rgb[2]; d[o++] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // 地平線壓一條深色，讓地面跟天空分開
    const hc = { grass: [PALS.grass[0], PALS.grass[1]], snow: [PALS.snow[4], PALS.snow[2]],
                 stone: [PALS.stone[1], PALS.stone[2]], dirt: [PALS.dirt[1], PALS.dirt[2]] }[kind];
    ctx.fillStyle = hc[0]; ctx.fillRect(0, horizon - 2, W, 2);
    ctx.fillStyle = hc[1]; ctx.fillRect(0, horizon, W, 1);
  };

  // 地平線背景：遠丘 + 樹線，全部取自同一組 palette（風格聖經：受限調色盤）
  M7.horizonScape = function (ctx, opts) {
    const W = opts.W, hz = opts.horizon, P = PALS[opts.kind || 'grass'];
    // 遠丘：兩層低頻起伏
    for (const [amp, freq, ph, col, drop] of [[7, .020, 0.0, P[1], 0], [5, .034, 2.1, P[2], 3]]) {
      ctx.fillStyle = col;
      for (let x = 0; x < W; x++) {
        const h = amp * (Math.sin(x * freq + ph) * .6 + Math.sin(x * freq * 2.3 + ph * 1.7) * .4);
        const top = hz - 10 + drop - h;
        ctx.fillRect(x, top, 1, hz - top);
      }
    }
    // 樹線：扇形輪廓兩層，越後面越暗
    for (const [yo, col, step] of [[0, P[0], 4], [2, P[1], 3]]) {
      ctx.fillStyle = col;
      for (let x = -2; x < W; x += step) {
        const h = 5 + Math.abs(Math.sin(x * .23 + yo * 1.3)) * 4 + Math.abs(Math.sin(x * .058)) * 3 - yo;
        ctx.fillRect(x, hz - h, step, h);
      }
    }
  };

  // 木頭人專用：起跑線與終點線（世界 z 位置 → 螢幕 y）
  M7.laneLines = function (ctx, opts, zs, color) {
    const f = opts.f || 90;
    ctx.fillStyle = color || '#e9d27b';
    for (const wz of zs) {
      const sy = Math.round(opts.horizon + f / wz), half = Math.round(54 / wz * 8);
      if (sy > opts.H || sy < opts.horizon) continue;
      ctx.fillRect(opts.W / 2 - half, sy, half * 2, 1);
    }
  };
})();
