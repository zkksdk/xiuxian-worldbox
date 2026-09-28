/**
 * render.js —— Canvas 2D 渲染：地形（分块脏重绘）、灵气/魔气/政治叠层、单位、选中高亮
 */
import { CFG, BIOME, BIOME_INFO, REALMS, ROOTS } from './config.js';
import { clamp, heat, demonHeat, hex2rgb, rgba } from './util.js';
import { U_TYPE, ST } from './units.js';
import { decorSprite, DECOR_META } from './decor.js';

const T = CFG.world.TILE;
const RES_LABEL = { 1: '灵脉', 2: '矿脉', 3: '灵田', 4: '药谷', 5: '洞天福地', 6: '魔渊' };
const hex2 = (n) => ('0' + (+n).toString(16)).slice(-2);

export class Renderer {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.g = canvas.getContext('2d');
    this.world = ctx.world;

    const W = this.world.W, H = this.world.H;
    this.tw = W * T; this.th = H * T;
    this.terrain = document.createElement('canvas');
    this.terrain.width = this.tw; this.terrain.height = this.th;
    this.tctx = this.terrain.getContext('2d');
    this.tctx.imageSmoothingEnabled = false;

    this.ov = document.createElement('canvas');
    this.ov.width = W; this.ov.height = H;
    this.ovctx = this.ov.getContext('2d');
    this.ovImg = this.ovctx.createImageData(W, H);
    this.ovDirty = true;
    this.ovTimer = 0;

    this.cam = { x: W / 2, y: H / 2, zoom: 3.2 };
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.resize();

    this.iconCache = new Map();
    this.sel = null;
    this.hover = null;
    this.time = 0;
    this.showGrid = false;
  }

  resize() {
    const c = this.canvas;
    const r = c.parentElement.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width * this.dpr));
    const h = Math.max(1, Math.floor(r.height * this.dpr));
    // 尺寸未变则直接返回：给 canvas.width 赋值会清空位图，移动端地址栏收放等
    // 场景会频繁触发 resize，不判断就会周期性闪黑
    if (c.width === w && c.height === h && this.cw === r.width && this.ch === r.height) return;
    c.width = w;
    c.height = h;
    c.style.width = r.width + 'px';
    c.style.height = r.height + 'px';
    this.cw = r.width; this.ch = r.height;
    this.g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ovDirty = true;
    this.resizeCount = (this.resizeCount || 0) + 1;
  }

  /* ============ 坐标 ============ */
  w2s(wx, wy) {
    return { x: (wx - this.cam.x) * this.cam.zoom + this.cw / 2, y: (wy - this.cam.y) * this.cam.zoom + this.ch / 2 };
  }
  s2w(sx, sy) {
    return { x: (sx - this.cw / 2) / this.cam.zoom + this.cam.x, y: (sy - this.ch / 2) / this.cam.zoom + this.cam.y };
  }
  viewBounds() {
    const hw = this.cw / 2 / this.cam.zoom, hh = this.ch / 2 / this.cam.zoom;
    return { x0: this.cam.x - hw, y0: this.cam.y - hh, x1: this.cam.x + hw, y1: this.cam.y + hh };
  }
  clampCam() {
    const W = this.world.W, H = this.world.H;
    const hw = this.cw / 2 / this.cam.zoom, hh = this.ch / 2 / this.cam.zoom;
    const mx = 3;
    if (hw * 2 < W - mx * 2) this.cam.x = clamp(this.cam.x, hw - mx, W - hw + mx);
    else this.cam.x = W / 2;
    if (hh * 2 < H - mx * 2) this.cam.y = clamp(this.cam.y, hh - mx, H - hh + mx);
    else this.cam.y = H / 2;
    this.cam.zoom = clamp(this.cam.zoom, 0.5, 20);
  }

  /* ============ 地形分块 ============ */
  buildDirty(maxChunks) {
    const dirty = this.world.dirty;
    if (!dirty.size) return true;
    let n = 0;
    const CH = CFG.world.CHUNK, cw = Math.ceil(this.world.W / CH);
    for (const ci of dirty) {
      this._buildChunk(ci, cw, CH);
      dirty.delete(ci);
      if (++n >= (maxChunks || 4)) return false;
    }
    return true;
  }

  /** 计算单格基色（供像素填充复用） */
  _cellColor(wx, wy) {
    const w = this.world;
    const i = wy * w.W + wx;
    const info = BIOME_INFO[w.biome[i]];
    let r = info.c[0], g = info.c[1], b = info.c[2];
    // 光照：高度梯度（制造立体感）
    const h = w.height[i];
    const hL = wx > 0 ? w.height[i - 1] : h;
    const hU = wy > 0 ? w.height[i - w.W] : h;
    const sh = 1 + (h - hL) * 0.0042 + (h - hU) * 0.0042;
    r *= sh; g *= sh; b *= sh;
    // 魔气染色
    const dm = w.demon[i];
    if (dm > 18) {
      const t = clamp((dm - 18) / 60, 0, 0.75);
      r = r * (1 - t) + 118 * t; g = g * (1 - t) + 12 * t; b = b * (1 - t) + 158 * t;
    }
    // 资源点染色
    const rt = w.resType[i];
    if (rt === 1) { r = r * 0.72 + 46 * 0.28; g = g * 0.72 + 236 * 0.28; b = b * 0.72 + 196 * 0.28; }
    else if (rt === 2) { r = r * 0.76 + 236 * 0.24; g = g * 0.76 + 190 * 0.24; b = b * 0.76 + 72 * 0.24; }
    else if (rt === 3) { r = r * 0.78 + 130 * 0.22; g = g * 0.78 + 236 * 0.22; b = b * 0.78 + 130 * 0.22; }
    else if (rt === 4) { r = r * 0.78 + 206 * 0.22; g = g * 0.78 + 130 * 0.22; b = b * 0.78 + 240 * 0.22; }
    else if (rt === 5) { r = r * 0.66 + 210 * 0.34; g = g * 0.66 + 230 * 0.34; b = b * 0.66 + 255 * 0.34; }
    else if (rt === 6) { r = r * 0.5 + 150 * 0.5; g = g * 0.5 + 20 * 0.5; b = b * 0.5 + 190 * 0.5; }
    // 龙脉微光
    if (w.ley[i] > 1) { g += 8; b += 10; }
    // 每格色调微差（自然过渡）
    const nz = ((wx * 73856093) ^ (wy * 19349663)) & 255;
    const nn = (nz / 255 - 0.5) * 11;
    r += nn; g += nn; b += nn;
    return [r, g, b, w.biome[i]];
  }

  _buildChunk(ci, cw, CH) {
    const cx = (ci % cw) * CH, cy = Math.floor(ci / cw) * CH;
    const w = this.world;
    const x1 = Math.min(cx + CH, w.W), y1 = Math.min(cy + CH, w.H);
    const bw = (x1 - cx) * T, bh = (y1 - cy) * T;
    const img = this.tctx.createImageData(bw, bh);
    const d = img.data;
    const B = BIOME;
    // 纹理特征：不同群系有不同的"颗粒感"与点缀色
    // 1 = 森林类（树冠暗点）2 = 山地岩石（高光点）3 = 平地草甸（细碎）4 = 雪/冰（晶粒）
    const texKind = (bi) => {
      if (bi === B.FOREST || bi === B.DEMON_FOREST) return 1;
      if (bi === B.MOUNTAIN || bi === B.HILL) return 2;
      if (bi === B.SNOW || bi === B.SNOWFIELD || bi === B.BEACH) return 4;
      if (bi === B.DEEP_SEA || bi === B.SEA) return 5;
      if (bi === B.CAVE || bi === B.LINGTIAN || bi === B.YAOGU) return 6;
      return 3;
    };
    for (let gy = 0; gy < (y1 - cy); gy++) {
      const wy = cy + gy;
      for (let gx = 0; gx < (x1 - cx); gx++) {
        const wx = cx + gx;
        const c = this._cellColor(wx, wy);
        let r = c[0], g = c[1], b = c[2];
        const kind = texKind(c[3]);
        const seed = (wx * 2654435761 ^ wy * 40503) >>> 0;
        const py0 = gy * T, px0 = gx * T;
        for (let sy = 0; sy < T; sy++) {
          const row = (py0 + sy) * bw + px0;   // 行首 + 本格列偏移
          for (let sx = 0; sx < T; sx++) {
            // 亚像素噪声（2×2 块状，营造颗粒质感）
            const bx = sx >> 1, by = sy >> 1;
            const hsh = (seed + bx * 73856093 + by * 19349663) >>> 0;
            const q = hsh & 15;
            let rr = r, gg = g, bb = b;
            // 基础颗粒
            const grain = ((hsh >> 4) & 7) - 3.5;
            rr += grain * 1.7; gg += grain * 1.7; bb += grain * 1.7;
            if (kind === 1) {              // 森林：树冠暗斑 + 少量亮斑
              if (q === 0) { rr *= 0.72; gg *= 0.80; bb *= 0.72; }
              else if (q === 9) { rr *= 1.05; gg *= 1.16; bb *= 1.02; }
            } else if (kind === 2) {       // 山地：岩石高光与阴影
              if (q === 0) { rr *= 1.16; gg *= 1.16; bb *= 1.14; }
              else if (q === 1) { rr *= 0.84; gg *= 0.84; bb *= 0.86; }
            } else if (kind === 4) {       // 冰雪沙滩：晶粒
              if (q === 0) { rr = rr * 0.9 + 26; gg = gg * 0.9 + 26; bb = bb * 0.9 + 26; }
            } else if (kind === 5) {       // 海洋：水平波纹
              if (sy === 0) { rr *= 1.10; gg *= 1.10; bb *= 1.14; }
              else if (sy === 3) { rr *= 0.93; gg *= 0.94; bb *= 0.96; }
            } else if (kind === 6) {       // 灵田/洞天：灵光点
              if (q === 0) { gg = gg * 0.92 + 22; bb = bb * 0.92 + 20; rr = rr * 0.92 + 6; }
            } else {                       // 草甸：细碎草簇
              if (q === 0) { rr *= 0.90; gg *= 1.06; bb *= 0.90; }
              else if (q === 5) { rr *= 0.95; gg *= 1.02; bb *= 0.92; }
            }
            const o = (row + sx) * 4;
            d[o] = clamp(rr, 0, 255); d[o + 1] = clamp(gg, 0, 255); d[o + 2] = clamp(bb, 0, 255); d[o + 3] = 255;
          }
        }
      }
    }
    this.tctx.putImageData(img, cx * T, cy * T);
    // —— 该区块的草木石竹（烘焙进地形图：渲染零额外开销）——
    // 关键：putImageData 是"覆盖"，会把相邻区块伸过来的树冠擦掉。
    // 所以每块都要把 3×3 邻域中"伸进本块"的草木一并重画，否则边界上的树都会缺半边。
    const gcx = ci % cw, gcy = Math.floor(ci / cw);
    const ncy = Math.ceil(w.H / CH);
    const bx0 = cx * T, by0 = cy * T, bx1 = bx0 + bw, by1 = by0 + bh;
    this.tctx.imageSmoothingEnabled = true;   // 草木用平滑缩放更自然
    for (let dy = -1; dy <= 1; dy++) {
      const ny = gcy + dy;
      if (ny < 0 || ny >= ncy) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = gcx + dx;
        if (nx < 0 || nx >= cw) continue;
        const arr = w.decorChunks.get(ny * cw + nx);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const d = arr[k];
          if (!d.alive) continue;
          const meta = DECOR_META[d.t];
          if (!meta) continue;
          const sz = meta.size * d.s * T * 1.45;
          const px = d.x * T, py = d.y * T;
          // 与本块矩形有无交集（无交集直接跳过，省开销）
          if (px + sz * 0.5 < bx0 || px - sz * 0.5 > bx1) continue;
          if (py + sz * 0.06 < by0 || py - sz * 0.94 > by1) continue;
          this.tctx.drawImage(decorSprite(d.t, d.pal, d.v, 32), px - sz / 2, py - sz * 0.94, sz, sz);
        }
      }
    }
    this.tctx.imageSmoothingEnabled = false;
  }

  /** 灵气/魔气/政治叠层 */
  _updateOverlay(mode) {
    const w = this.world, W = w.W, H = w.H;
    const d = this.ovImg.data;
    const sects = this.ctx.sects;
    const rgbCache = {};
    const parseC = (c) => {
      if (rgbCache[c]) return rgbCache[c];
      let out;
      if (c && c[0] === '#') out = hex2rgb(c);
      else {
        const m = c && c.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        out = m ? [+m[1], +m[2], +m[3]] : [140, 207, 255];
      }
      rgbCache[c] = out;
      return out;
    };
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      let r = 0, g = 0, b = 0, a = 0;
      if (mode === 'aura' || mode === 'terrain') {
        const t = clamp(w.aura[i] / 100, 0, 1);
        const c = heat(t);
        r = c[0]; g = c[1]; b = c[2];
        a = mode === 'terrain' ? clamp((t - 0.35) * 90, 0, 60) * 0.5 : 235;
        // 地形视图下勾勒势力疆界：边界描亮线，内部极淡填色
        if (mode === 'terrain' && sects && sects.list.length) {
          const grid = sects.territoryGrid;
          const sid = grid[i];
          if (sid >= 0) {
            const s = sects.byId.get(sid);
            if (s) {
              const sc = parseC(s.color);
              const x = i % W, y = (i / W) | 0;
              const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1 ||
                grid[i - 1] !== sid || grid[i + 1] !== sid ||
                grid[i - W] !== sid || grid[i + W] !== sid;
              if (edge) {
                // 疆界线（主线）：宗门色提亮，叠层 0.22 后仍是清晰的边
                r = (sc[0] + 255) * 0.5; g = (sc[1] + 255) * 0.5; b = (sc[2] + 255) * 0.5;
                a = 255;
              } else if (x > 1 && y > 1 && x < W - 2 && y < H - 2 &&
                (grid[i - 2] !== sid || grid[i + 2] !== sid ||
                 grid[i - W * 2] !== sid || grid[i + W * 2] !== sid)) {
                // 副线：让疆界在低倍率下也有 2 格厚度
                r = r * 0.3 + ((sc[0] + 255) * 0.5) * 0.7;
                g = g * 0.3 + ((sc[1] + 255) * 0.5) * 0.7;
                b = b * 0.3 + ((sc[2] + 255) * 0.5) * 0.7;
                a = 170;
              } else {
                r = r * 0.62 + sc[0] * 0.38;
                g = g * 0.62 + sc[1] * 0.38;
                b = b * 0.62 + sc[2] * 0.38;
                a = Math.max(a, 78);
              }
            }
          }
        }
      } else if (mode === 'demon') {
        const t = clamp(w.demon[i] / 100, 0, 1);
        const c = demonHeat(t);
        r = c[0]; g = c[1]; b = c[2];
        a = 235;
      } else if (mode === 'politics') {
        const grid = sects ? sects.territoryGrid : null;
        const sid = grid ? grid[i] : -1;
        if (sid >= 0) {
          const s = sects.byId.get(sid);
          if (s) {
            const x = i % W, y = (i / W) | 0;
            // 领地边界描白线，一眼看清势力疆域
            const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1 ||
              grid[i - 1] !== sid || grid[i + 1] !== sid ||
              grid[i - W] !== sid || grid[i + W] !== sid;
            if (edge) { r = 236; g = 244; b = 255; a = 215; }
            else {
              const c = parseC(s.color);
              r = c[0]; g = c[1]; b = c[2]; a = 145;
            }
          }
        }
      } else if (mode === 'resource') {
        const rt = w.resType[i];
        if (rt > 0) {
          const cols = { 1: [64, 255, 208], 2: [255, 200, 80], 3: [140, 240, 140], 4: [208, 128, 255], 5: [255, 255, 255], 6: [160, 32, 192] };
          const c = cols[rt] || [255, 255, 255];
          r = c[0]; g = c[1]; b = c[2]; a = 190;
        }
      }
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
    }
    this.ovctx.putImageData(this.ovImg, 0, 0);
  }

  /* ============ 主渲染 ============ */
  render(dt, mode, fx) {
    this.time += dt;
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#05060c';
    g.fillRect(0, 0, this.cw, this.ch);

    const dirtyN = this.world.dirty.size;
    this.buildDirty(dirtyN > 48 ? 14 : (dirtyN > 12 ? 6 : 3));
    this._drawTerrainImage();

    // 叠层
    if (!this._ovMode || this._ovMode !== mode) { this._ovMode = mode; this.ovDirty = true; }
    this.ovTimer += dt;
    const ovInt = (mode === 'aura' || mode === 'demon') ? 0.6 : 3.5;
    if (this.ovDirty || this.ovTimer > ovInt) {
      this._updateOverlay(mode);
      this.ovDirty = false; this.ovTimer = 0;
    }
    if (mode !== 'terrain' || true) {
      // 地形视图：0.42 让势力疆界清晰可辨，同时灵气色依旧极淡不抢戏
      g.globalAlpha = mode === 'terrain' ? 0.42 : (mode === 'politics' || mode === 'resource' ? 0.85 : 0.92);
      this._drawImageWorldAligned(this.ov);
      g.globalAlpha = 1;
    }

    this._drawSiteGlow();
    this._drawUnits(mode);
    this._drawSects(mode);
    if (fx) fx.draw(g, this);
    this._drawSelection();
  }

  /** 宗门山门旗帜（地标，压在最上层，永远可见） */
  _sectSprite(color, demonic) {
    const key = color + (demonic ? 'D' : 'N');
    if (!this._sectCache) this._sectCache = {};
    if (this._sectCache[key]) return this._sectCache[key];
    const S = 48;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    // 旗杆
    g.strokeStyle = '#6a5a44'; g.lineWidth = 2.6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(22, 45); g.lineTo(22, 7); g.stroke();
    // 旗面
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(22, 8); g.lineTo(43, 15); g.lineTo(22, 23);
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.beginPath(); g.moveTo(22, 16); g.lineTo(37, 19); g.lineTo(22, 23); g.closePath(); g.fill();
    // 山门基座
    g.fillStyle = 'rgba(22,18,32,0.92)';
    g.beginPath(); g.moveTo(22, 31); g.lineTo(40, 45); g.lineTo(4, 45); g.closePath(); g.fill();
    g.fillStyle = color;
    g.globalAlpha = 0.75;
    g.beginPath(); g.moveTo(22, 33); g.lineTo(35, 43); g.lineTo(9, 43); g.closePath(); g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(22, 31); g.lineTo(40, 45); g.lineTo(4, 45); g.closePath(); g.stroke();
    // 魔道魔气
    if (demonic) {
      g.strokeStyle = 'rgba(255,60,110,0.9)'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(22, 8); g.lineTo(43, 15); g.lineTo(22, 23); g.closePath(); g.stroke();
    }
    this._sectCache[key] = c;
    return c;
  }

  _drawSects(mode) {
    const sects = this.ctx.sects;
    if (!sects || !sects.list.length) return;
    const z = this.cam.zoom;
    if (z < 1.4) return;
    const g = this.g;
    const b = this.viewBounds();
    const showName = z > 3.0;
    const dim = (mode === 'politics' || mode === 'resource') ? 0.7 : 1;
    for (const s of sects.list) {
      if (s.cx < b.x0 - 6 || s.cx > b.x1 + 6 || s.cy < b.y0 - 6 || s.cy > b.y1 + 6) continue;
      const p = this.w2s(s.cx, s.cy);
      const sz = clamp(z * 5.6, 18, 62);
      g.globalAlpha = dim;
      g.drawImage(this._sectSprite(s.color, s.demonic), p.x - sz / 2, p.y - sz * 0.94, sz, sz);
      if (showName) {
        const fs = clamp(z * 1.4, 10, 15);
        g.font = '600 ' + fs.toFixed(0) + 'px system-ui,-apple-system,sans-serif';
        g.textAlign = 'center';
        const label = s.name + (s.war ? ' ⚔' : '');
        const wl = g.measureText(label).width;
        const ly = p.y + sz * 0.06;
        g.fillStyle = 'rgba(4,6,14,0.78)';
        g.fillRect(p.x - wl / 2 - 4, ly, wl + 8, fs + 5);
        g.fillStyle = s.color;
        g.fillText(label, p.x, ly + fs + 1);
      }
      g.globalAlpha = 1;
    }
    g.textAlign = 'left';
  }

  /** 地表装饰：草木石竹（按视口裁剪 + 缩放分级） */
  _drawDecor(mode) {
    const z = this.cam.zoom;
    if (z < 2.4) return;
    const w = this.world;
    const chunks = w.decorChunks;
    if (!chunks || !chunks.size) return;
    const g = this.g;
    const b = this.viewBounds();
    const CH = CFG.world.CHUNK, cw = w._chunkW;
    const ncy = Math.ceil(w.H / CH);
    const c0x = Math.max(0, Math.floor(b.x0 / CH)), c1x = Math.min(cw - 1, Math.floor(b.x1 / CH));
    const c0y = Math.max(0, Math.floor(b.y0 / CH)), c1y = Math.min(ncy - 1, Math.floor(b.y1 / CH));
    const full = z >= 5.2;                 // LOD：高倍率才画灌木花草
    const dim = (mode === 'politics' || mode === 'resource') ? 0.55 : 1;
    if (dim !== 1) g.globalAlpha = dim;
    let drawn = 0;
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const arr = chunks.get(cy * cw + cx);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const d = arr[k];
          if (!d.alive) continue;
          if (!full && !d.big) continue;
          const meta = DECOR_META[d.t];
          if (!meta) continue;
          const sz = meta.size * d.s * z * 1.7;
          if (sz < 4) continue;
          const p = this.w2s(d.x, d.y);
          if (p.x < -sz || p.x > this.cw + sz || p.y < -sz || p.y > this.ch + sz) continue;
          g.drawImage(decorSprite(d.t, d.pal, d.v, 32), p.x - sz / 2, p.y - sz * 0.92, sz, sz);
          if (++drawn > 2800) { if (dim !== 1) g.globalAlpha = 1; return; }
        }
      }
    }
    if (dim !== 1) g.globalAlpha = 1;
  }

  _drawImageWorldAligned(src) {
    const g = this.g;
    const sw = src.width, sh = src.height;
    const s = this.w2s(0, 0);
    const e = this.w2s(sw, sh);
    g.drawImage(src, s.x, s.y, e.x - s.x, e.y - s.y);
  }

  _drawTerrainImage() {
    const g = this.g;
    const z = this.cam.zoom;
    const b = this.viewBounds();
    let sx = b.x0 * T, sy = b.y0 * T, sw = (b.x1 - b.x0) * T, sh = (b.y1 - b.y0) * T;
    const s0x = Math.max(0, sx), s0y = Math.max(0, sy);
    const s1x = Math.min(this.tw, sx + sw), s1y = Math.min(this.th, sy + sh);
    if (s1x <= s0x || s1y <= s0y) return;
    const dx = (s0x - sx) / sw * this.cw, dy = (s0y - sy) / sh * this.ch;
    const dw = (s1x - s0x) / sw * this.cw, dh = (s1y - s0y) / sh * this.ch;
    g.drawImage(this.terrain, s0x, s0y, s1x - s0x, s1y - s0y, dx, dy, dw, dh);
  }

  /** 资源点脉动光效 */
  _drawSiteGlow() {
    const g = this.g;
    const w = this.world, z = this.cam.zoom;
    const b = this.viewBounds();
    const t = this.time;
    if (z < 1.2) return;
    for (const s of w.sites) {
      if (s.x < b.x0 - 6 || s.x > b.x1 + 6 || s.y < b.y0 - 6 || s.y > b.y1 + 6) continue;
      const p = this.w2s(s.x + 0.5, s.y + 0.5);
      const pulse = 0.6 + 0.4 * Math.sin(t * 1.8 + s.x * 0.3 + s.y * 0.2);
      const cols = { 1: '64,255,208', 2: '255,200,80', 3: '140,240,140', 4: '208,128,255', 5: '230,240,255', 6: '190,60,220' };
      const c = cols[s.type] || '255,255,255';
      const r = Math.max(4, s.r * z * 0.62) * pulse;
      if (r > 26) continue;
      const sp = this._glowSprite(c);
      g.globalAlpha = pulse;
      g.drawImage(sp, p.x - r, p.y - r, r * 2, r * 2);
      g.globalAlpha = 1;
      // 放大后标注资源点名称
      if (z > 5.5) {
        const label = (RES_LABEL[s.type] || '') + (s.tier ? '·' + s.tier + '阶' : '');
        g.font = '600 9px system-ui,sans-serif';
        g.textAlign = 'center';
        const wl = g.measureText(label).width;
        g.fillStyle = 'rgba(4,6,14,0.7)';
        g.fillRect(p.x - wl / 2 - 2, p.y + 8, wl + 4, 11);
        g.fillStyle = '#' + c.split(',').map(hex2).join('');
        g.fillText(label, p.x, p.y + 16.5);
      }
    }
    g.globalAlpha = 1;
    g.textAlign = 'left';
    // 遗物光点：陨落之地留待有缘人
    const relics = w.relics;
    if (relics && relics.length) {
      const spR = this._glowSprite('255,235,150');
      for (let ri = 0; ri < relics.length; ri++) {
        const r = relics[ri];
        if (r.x < b.x0 - 5 || r.x > b.x1 + 5 || r.y < b.y0 - 5 || r.y > b.y1 + 5) continue;
        const p = this.w2s(r.x, r.y);
        const pulse = 0.55 + 0.45 * Math.sin(t * 3 + ri * 1.7);
        const rr = Math.max(6, z * 2.4);
        g.globalAlpha = pulse;
        g.drawImage(spR, p.x - rr, p.y - rr, rr * 2, rr * 2);
      }
      g.globalAlpha = 1;
    }
    // 奇观
    for (const wd of w.wonders) {
      const p = this.w2s(wd.x + 0.5, wd.y + 0.5);
      const pulse = 0.55 + 0.45 * Math.sin(t * 1.1);
      const r = Math.max(10, wd.r * z * 0.95);
      const sp = this._glowSprite('255,240,180');
      g.globalAlpha = pulse * 0.9;
      g.drawImage(sp, p.x - r, p.y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
  }

  /* ============ 单位 ============ */
  _unitSprite(u) {
    const key = u.type === U_TYPE.CULTIVATOR
      ? (u.realm * 2 + (u.isDemon ? 1 : 0))
      : (u.type === U_TYPE.BEAST ? 100 + (u.beastTier || 1)
        : 200 + (u.plantTier || 0) + (u.mature ? 50 : 0));
    if (u._spKey === key && u._sp) return u._sp;
    let sp = this.iconCache.get(key);
    if (sp) { u._spKey = key; u._sp = sp; return sp; }
    const S = 48, c = document.createElement('canvas');
    c.width = S; c.height = S;
    const gg = c.getContext('2d');
    const cx = S / 2, cy = S / 2;
    if (u.type === U_TYPE.CULTIVATOR) {
      // —— 人形：道袍 + 头 + 发髻，境界越高身形越挺拔、灵光越盛 ——
      const col = u.isDemon ? '#ff6060' : REALMS[u.realm].color;
      const sc = 1 + Math.min(0.42, u.realm * 0.06);
      const bodyH = S * 0.34 * sc, bodyW = S * 0.26 * sc;
      const headR = S * 0.11 * sc;
      if (u.realm >= 1) {
        const gr = gg.createRadialGradient(cx, cy, 0, cx, cy, S * 0.44);
        gr.addColorStop(0, col + (u.realm >= 4 ? '90' : '55'));
        gr.addColorStop(1, col + '00');
        gg.fillStyle = gr;
        gg.beginPath(); gg.arc(cx, cy, S * 0.44, 0, 6.2832); gg.fill();
      }
      // 道袍（下摆外扩）
      gg.beginPath();
      gg.moveTo(cx - bodyW * 0.5, cy - bodyH * 0.42);
      gg.lineTo(cx + bodyW * 0.5, cy - bodyH * 0.42);
      gg.lineTo(cx + bodyW * 0.95, cy + bodyH * 0.80);
      gg.lineTo(cx - bodyW * 0.95, cy + bodyH * 0.80);
      gg.closePath();
      gg.fillStyle = col; gg.fill();
      gg.strokeStyle = 'rgba(0,0,0,0.55)'; gg.lineWidth = 1.6; gg.stroke();
      // 衣襟 + 腰带
      gg.strokeStyle = 'rgba(255,255,255,0.5)'; gg.lineWidth = 1.3;
      gg.beginPath();
      gg.moveTo(cx - bodyW * 0.56, cy + bodyH * 0.18);
      gg.lineTo(cx + bodyW * 0.56, cy + bodyH * 0.18);
      gg.stroke();
      gg.beginPath();
      gg.moveTo(cx, cy - bodyH * 0.42); gg.lineTo(cx, cy + bodyH * 0.18);
      gg.stroke();
      // 头
      gg.fillStyle = '#f2dcc0';
      gg.beginPath(); gg.arc(cx, cy - bodyH * 0.74, headR, 0, 6.2832); gg.fill();
      gg.strokeStyle = 'rgba(0,0,0,0.5)'; gg.lineWidth = 1.1; gg.stroke();
      // 发髻
      gg.fillStyle = '#241c24';
      gg.beginPath(); gg.arc(cx, cy - bodyH * 0.84, headR * 0.9, Math.PI, 6.2832); gg.fill();
      gg.beginPath(); gg.arc(cx, cy - bodyH * 0.74 - headR * 1.1, headR * 0.34, 0, 6.2832); gg.fill();
      // 元婴以上：脑后灵环
      if (u.realm >= 3) {
        gg.strokeStyle = col; gg.lineWidth = 1.4;
        gg.beginPath(); gg.arc(cx, cy - bodyH * 0.74, headR * 1.7, 0, 6.2832); gg.stroke();
      }
      // 化神以上：金冠
      if (u.realm >= 4) {
        gg.fillStyle = '#ffd24a';
        gg.beginPath();
        gg.moveTo(cx - headR * 0.9, cy - bodyH * 0.74 - headR * 0.75);
        gg.lineTo(cx, cy - bodyH * 0.74 - headR * 2.0);
        gg.lineTo(cx + headR * 0.9, cy - bodyH * 0.74 - headR * 0.75);
        gg.closePath(); gg.fill();
      }
      // 魔道：血煞之气
      if (u.isDemon) {
        gg.strokeStyle = 'rgba(255,40,60,0.8)'; gg.lineWidth = 1.7;
        gg.beginPath();
        gg.moveTo(cx - bodyW * 0.95, cy - bodyH * 0.25);
        gg.lineTo(cx - bodyW * 1.35, cy + bodyH * 0.9);
        gg.stroke();
        gg.beginPath();
        gg.moveTo(cx + bodyW * 0.95, cy - bodyH * 0.25);
        gg.lineTo(cx + bodyW * 1.35, cy + bodyH * 0.9);
        gg.stroke();
      }
    } else if (u.type === U_TYPE.BEAST) {
      // —— 兽形：四足 + 身躯 + 头 + 尾，等阶越高体型越大、越有凶相 ——
      const tier = u.beastTier || 1;
      const bodyC = tier >= 4 ? '#d4722a' : (tier >= 3 ? '#a85050' : (tier >= 2 ? '#95703a' : '#7d5a45'));
      const dark = tier >= 4 ? '#8a4410' : (tier >= 3 ? '#6a2a2a' : '#4a3320');
      const sz = 0.82 + tier * 0.12;
      const bw = S * 0.30 * sz, bh = S * 0.20 * sz;
      // 四足
      gg.strokeStyle = dark; gg.lineWidth = S * 0.05;
      const legs = [[-0.62, -0.55], [0.62, -0.55], [-0.62, 0.55], [0.62, 0.55]];
      for (let k = 0; k < 4; k++) {
        const lx = legs[k][0], ly = legs[k][1];
        gg.beginPath();
        gg.moveTo(cx + lx * bw, cy + ly * bh * 0.6);
        gg.lineTo(cx + lx * bw * 1.2, cy + ly * bh * 1.5);
        gg.stroke();
      }
      // 尾
      gg.strokeStyle = bodyC; gg.lineWidth = S * 0.045;
      gg.beginPath();
      gg.moveTo(cx - bw * 0.92, cy);
      gg.quadraticCurveTo(cx - bw * 1.6, cy - bh * 0.5, cx - bw * 1.5, cy - bh * 1.4);
      gg.stroke();
      // 身躯
      gg.fillStyle = bodyC;
      gg.beginPath(); gg.ellipse(cx, cy, bw, bh, 0, 0, 6.2832); gg.fill();
      gg.strokeStyle = 'rgba(0,0,0,0.5)'; gg.lineWidth = 1.4; gg.stroke();
      // 头
      const hx = cx + bw * 0.88, hy = cy - bh * 0.45;
      const hr = S * 0.105 * sz;
      gg.fillStyle = bodyC;
      gg.beginPath(); gg.arc(hx, hy, hr, 0, 6.2832); gg.fill();
      gg.strokeStyle = 'rgba(0,0,0,0.5)'; gg.lineWidth = 1.2; gg.stroke();
      // 角或耳
      gg.fillStyle = dark;
      if (tier >= 3) {
        gg.beginPath();
        gg.moveTo(hx - hr * 0.7, hy - hr * 0.8);
        gg.lineTo(hx - hr * 1.5, hy - hr * 2.1);
        gg.lineTo(hx - hr * 0.1, hy - hr * 1.1);
        gg.closePath(); gg.fill();
        gg.beginPath();
        gg.moveTo(hx + hr * 0.7, hy - hr * 0.8);
        gg.lineTo(hx + hr * 1.5, hy - hr * 2.1);
        gg.lineTo(hx + hr * 0.1, hy - hr * 1.1);
        gg.closePath(); gg.fill();
      } else {
        gg.beginPath(); gg.arc(hx - hr * 0.62, hy - hr * 0.85, hr * 0.36, 0, 6.2832); gg.fill();
        gg.beginPath(); gg.arc(hx + hr * 0.62, hy - hr * 0.85, hr * 0.36, 0, 6.2832); gg.fill();
      }
      // 凶目
      gg.fillStyle = tier >= 3 ? '#ffd24a' : '#ffe08a';
      gg.beginPath(); gg.arc(hx + hr * 0.26, hy - hr * 0.06, hr * 0.21, 0, 6.2832); gg.fill();
    } else {
      // —— 植株：根丛 + 茎 + 叶片 + 花果，品阶越高越繁茂 ——
      const tier = u.plantTier || 0;
      const cols = ['#5f9440', '#6ea44c', '#7fb45c', '#90c46c', '#a2d47e', '#b6e492'];
      const c2 = cols[Math.min(5, tier)];
      const h = S * (0.36 + tier * 0.045);
      // 根丛
      gg.strokeStyle = '#3d6b30'; gg.lineWidth = S * 0.042;
      for (let k = -1; k <= 1; k++) {
        gg.beginPath();
        gg.moveTo(cx + k * S * 0.07, cy + h * 0.66);
        gg.quadraticCurveTo(cx + k * S * 0.14, cy + h * 0.30, cx + k * S * 0.05, cy + h * 0.05);
        gg.stroke();
      }
      // 茎
      gg.strokeStyle = '#4a7a3a'; gg.lineWidth = S * 0.05;
      gg.beginPath(); gg.moveTo(cx, cy + h * 0.62); gg.lineTo(cx, cy - h * 0.35); gg.stroke();
      // 叶片
      const leaves = 2 + Math.min(2, Math.floor(tier / 2));
      for (let i = 0; i < leaves; i++) {
        const dir = i % 2 === 0 ? 1 : -1;
        const ly = cy + h * 0.28 - i * h * 0.30;
        gg.beginPath();
        gg.ellipse(cx + dir * h * 0.30, ly, h * 0.34, h * 0.15, dir * 0.55, 0, 6.2832);
        gg.fillStyle = c2; gg.fill();
        gg.strokeStyle = 'rgba(0,0,0,0.32)'; gg.lineWidth = 1; gg.stroke();
      }
      // 花 / 果
      if (tier >= 1) {
        const fc = tier >= 4 ? '#ffd24a' : (tier >= 3 ? '#e07070' : '#e88ab0');
        gg.fillStyle = fc;
        if (tier >= 3) { gg.shadowBlur = S * 0.22; gg.shadowColor = fc; }
        gg.beginPath(); gg.arc(cx, cy - h * 0.54, h * 0.17, 0, 6.2832); gg.fill();
        gg.shadowBlur = 0;
      }
      // 成熟灵光
      if (u.mature) {
        gg.strokeStyle = 'rgba(190,255,180,0.55)'; gg.lineWidth = 1.3;
        gg.beginPath(); gg.arc(cx, cy - h * 0.1, S * 0.30, 0, 6.2832); gg.stroke();
      }
    }
    this.iconCache.set(key, c);
    u._spKey = key; u._sp = c;
    return c;
  }

  /** 预渲染的径向光点（避免每帧创建渐变对象） */
  _glowSprite(rgb) {
    let s = this._glowCache || (this._glowCache = {});
    if (s[rgb]) return s[rgb];
    const S = 64;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(' + rgb + ',0.55)');
    grad.addColorStop(0.55, 'rgba(' + rgb + ',0.18)');
    grad.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    s[rgb] = c;
    return c;
  }

  _drawUnits(mode) {
    const g = this.g;
    const z = this.cam.zoom;
    const b = this.viewBounds();
    const list = this.ctx.units.list;
    const detail = list.length < 700 || z > 2;
    const simpleDraw = list.length > 900 && z < 5.2;
    const occludeOn = z > 3.4 && list.length < 2600;
    // 极端数量：按 id 稳定采样（不会闪烁），但重要单位始终绘制
    const overload = list.length > 5200 ? 4 : (list.length > 2600 ? 2 : 1);
    let nameBudget = z > 4.6 ? 26 : 0;
    const names = [];   // 名牌收集（最后统一绘制）
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (!u.alive) continue;
      if (u.x < b.x0 - 2 || u.x > b.x1 + 2 || u.y < b.y0 - 2 || u.y > b.y1 + 2) continue;
      if (overload > 1 && (u.id % overload) !== 0) {
        const vital = u.realm >= 4 || u.state === ST.FIGHT || u.state === ST.TRIB ||
          (this.sel && this.sel.id === u.id) || u.type !== U_TYPE.CULTIVATOR;
        if (!vital) continue;
      }
      const p = this.w2s(u.x, u.y);
      // 数量极多且缩得很小时，用色块代替精灵图，保住帧率
      if (simpleDraw && u.type === U_TYPE.CULTIVATOR) {
        const s2 = Math.max(2, z * 1.9);
        g.fillStyle = u.isDemon ? '#ff6060' : REALMS[u.realm].color;
        g.fillRect(p.x - s2 / 2, p.y - s2 / 2, s2, s2);
        continue;
      }
      const sp = this._unitSprite(u);
      const base = u.type === U_TYPE.PLANT ? 0.6 : 1;
      let sz = clamp(z * 2.5, 8, 34) * base;
      // 打坐时的呼吸：幅度压到极小、频率放慢，避免满场"一闪一闪"
      if (u.state === ST.CULTIVATE && u.type === U_TYPE.CULTIVATOR &&
        this.cam.zoom > 3.5 && list.length < 900) {
        sz *= 1 + 0.015 * Math.sin(this.time * 1.2 + u.id * 0.53);
      }
      g.drawImage(sp, p.x - sz / 2, p.y - sz / 2, sz, sz);
      // 被前方草木遮挡：把"站在单位前面"的大树重绘一遍，形成前后层次
      if (occludeOn) this._occludeUnit(u, z, mode);
      // 状态标识
      if (detail && z > 2.4 && u.type === U_TYPE.CULTIVATOR) {
        if (u.state === ST.TRIB || u.state === ST.BREAK) {
          // 渡劫/突破：稳定光环，不再脉动
          g.strokeStyle = 'rgba(255,240,160,0.9)'; g.lineWidth = 1.4;
          g.beginPath(); g.arc(p.x, p.y, sz * 0.8 + 3, 0, 6.2832); g.stroke();
        } else if (u.state === ST.FIGHT) {
          g.fillStyle = '#ff5050';
          g.fillRect(p.x - 1.6, p.y - sz * 0.85 - 3, 3.2, 3.2);
        }
      }
      // 选中
      if (this.sel && this.sel.id === u.id) {
        g.strokeStyle = '#ffe680'; g.lineWidth = 1.8;
        g.beginPath(); g.arc(p.x, p.y, sz * 0.7 + 4, 0, 6.2832); g.stroke();
      }
      // 名牌稍后统一绘制（保证不被草木盖住）
      if (z > 4.6 && u.type === U_TYPE.CULTIVATOR && nameBudget > 0) {
        nameBudget--;
        names.push(p.x, p.y, sz, u.name, u.isDemon ? 1 : 0, u.realm);
      }
    }
    // —— 名牌层（最上） ——
    if (names.length) {
      g.font = '600 10px system-ui,-apple-system,sans-serif';
      g.textAlign = 'center';
      for (let i = 0; i < names.length; i += 6) {
        const px = names[i], py = names[i + 1], s2 = names[i + 2];
        const label = names[i + 3], demon = names[i + 4], realm = names[i + 5];
        const wl = g.measureText(label).width;
        const ly = py + s2 * 0.5 + 2;
        g.fillStyle = 'rgba(4,6,14,0.74)';
        g.fillRect(px - wl / 2 - 3, ly, wl + 6, 12);
        g.fillStyle = demon ? '#ffb4b4' : REALMS[realm].color;
        g.fillText(label, px, ly + 9.5);
      }
    }
    g.textAlign = 'left';
  }

  /** 重绘"站在该单位前方"的大树，实现草木遮挡人物的纵深层次 */
  _occludeUnit(u, z, mode) {
    const w = this.world;
    const grid = w.bigDecorGrid;
    if (!grid || !grid.size) return;
    const gx = Math.floor(u.x / 8), gy = Math.floor(u.y / 8);
    const g = this.g;
    const dim = (mode === 'politics' || mode === 'resource') ? 0.55 : 1;
    if (dim !== 1) g.globalAlpha = dim;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = grid.get((gy + dy) * w._bigDecW + (gx + dx));
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const d = arr[k];
          if (!d.alive) continue;
          if (d.y <= u.y - 0.35) continue;         // 在单位身后 → 无需重绘
          if (d.y > u.y + 4.5) continue;           // 距离过远
          const ddx = d.x - u.x;
          if (ddx > 2.6 || ddx < -2.6) continue;   // 水平不重叠
          const meta = DECOR_META[d.t];
          if (!meta) continue;
          const sz = meta.size * d.s * z * 1.45;
          if (sz < 7) continue;
          const p = this.w2s(d.x, d.y);
          g.drawImage(decorSprite(d.t, d.pal, d.v, 32), p.x - sz / 2, p.y - sz * 0.94, sz, sz);
        }
      }
    }
    if (dim !== 1) g.globalAlpha = 1;
  }

  _drawSelection() {
    const g = this.g;
    // 笔刷光标
    if (this.brushCursor && this.ctx.powers && this.ctx.powers.activePower) {
      const p = this.w2s(this.brushCursor.x, this.brushCursor.y);
      const r = Math.max(6, this.brushCursor.r * this.cam.zoom);
      g.strokeStyle = 'rgba(255,214,110,0.8)'; g.lineWidth = 1.6;
      g.setLineDash([5, 4]);
      g.beginPath(); g.arc(p.x, p.y, r, 0, 6.2832); g.stroke();
      g.setLineDash([]);
      g.strokeStyle = 'rgba(255,214,110,0.22)'; g.lineWidth = 1;
      g.beginPath(); g.arc(p.x, p.y, r * 0.5, 0, 6.2832); g.stroke();
    }
    if (this.hoverSite != null) {
      const s = this.world.sites[this.hoverSite];
      if (s) {
        const p = this.w2s(s.x + 0.5, s.y + 0.5);
        g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.2;
        g.beginPath(); g.arc(p.x, p.y, s.r * this.cam.zoom, 0, 6.2832); g.stroke();
      }
    }
  }

  /** 鼠标拾取 */
  pick(sx, sy) {
    const w = this.s2w(sx, sy);
    const gx = Math.floor(w.x), gy = Math.floor(w.y);
    if (!this.world.inB(gx, gy)) return { kind: 'none', gx, gy };
    // 宗门山门旗帜优先：点在旗杆附近即视为选择宗门（旗帜是地标，意图明确）
    const sects = this.ctx.sects;
    if (sects && sects.list.length && this.cam.zoom > 1.3) {
      const sr = Math.max(1.7, 9 / this.cam.zoom);
      let best = null, bd = sr * sr;
      for (const s of sects.list) {
        const d = (s.cx - w.x) * (s.cx - w.x) + (s.cy - w.y) * (s.cy - w.y);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) return { kind: 'sect', sect: best, gx, gy };
    }
    // 单位（容差随缩放自适应：缩得越小，判定越宽松，手指也能点中）
    const tol = Math.max(2.4, 10 / this.cam.zoom);
    const u = this.ctx.units.pick(w.x, w.y, tol);
    if (u) return { kind: 'unit', unit: u, gx, gy };
    const sid = this.world.resId[gy * this.world.W + gx];
    if (sid >= 0) return { kind: 'site', site: this.world.sites[sid], gx, gy };
    return { kind: 'tile', gx, gy };
  }
}

export default Renderer;
