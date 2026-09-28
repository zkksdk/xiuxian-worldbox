/**
 * world.js —— 世界数据与程序化生成
 * 全部标量场使用 TypedArray（SoA），保证缓存友好。
 */
import { CFG, BIOME, BIOME_INFO, RES_TYPE, ORES, HERBS, WONDERS } from './config.js';
import { RNG, Simplex, fbm, ridged, clamp, lerp, smoothstep, dist, DIR8, DIR4, shuffle } from './util.js';
import { D, DECOR_META } from './decor.js';

const CH = CFG.world.CHUNK;

/** 高度分位映射：p(0..1) → 高度(0..1)。海平面 0.355 */
const H_SEGS = [
  [0.00, 0.06], [0.20, 0.24], [0.38, 0.350],
  [0.40, 0.360],            // 海平面（约 40% 为海）
  [0.55, 0.475],            // 沙滩 → 平原
  [0.75, 0.605],            // 丘陵
  [0.89, 0.725],            // 高山
  [0.965, 0.860],           // 雪线
  [1.00, 1.00],
];
function hQuantile(p) {
  for (let i = 0; i < H_SEGS.length - 1; i++) {
    const a = H_SEGS[i], b = H_SEGS[i + 1];
    if (p <= b[0]) return a[1] + (b[1] - a[1]) * (p - a[0]) / (b[0] - a[0] || 1);
  }
  return 1;
}

export class World {
  constructor(seed, W, H) {
    this.seed = seed >>> 0;
    this.W = W; this.H = H;
    const N = W * H;
    this.N = N;
    this.rng = new RNG(this.seed);

    // ---- 地形与气候 ----
    this.height = new Uint8Array(N);   // 0-255 → 0..1
    this.temp = new Uint8Array(N);
    this.moist = new Uint8Array(N);
    // ---- 灵气 / 魔气（0-100，浮点）----
    this.aura = new Float32Array(N);
    this.auraBase = new Float32Array(N);
    this.demon = new Float32Array(N);
    // ---- 派生 ----
    this.biome = new Uint8Array(N);
    this.ley = new Uint8Array(N);       // 龙脉强度 0-3
    this.flag = new Uint8Array(N);      // 1洞天 2奇观 3仙缘
    this.resType = new Uint8Array(N);   // RES_TYPE
    this.resId = new Int16Array(N);     // 资源点索引，-1 无

    // ---- 实体容器 ----
    this.sites = [];        // 资源点
    this.wonders = [];      // 奇观
    this.leyPaths = [];     // 龙脉路径（渲染用）
    this.auraNodes = [];    // 灵眼/绝地（渲染用）
    this.relics = [];             // 陨落遗物（可被有缘人拾取）
    this.decor = [];              // 地表装饰物（草木石竹）
    this.decorChunks = new Map(); // chunkIdx -> 装饰物数组
    this.bigDecorGrid = new Map();// 大装饰空间网格（遮挡判定用），cell = 8 格
    this._bigDecW = Math.ceil(W / 8);

    // ---- 运行状态 ----
    this.dirty = new Set();     // 脏块
    this.phase = 0;             // 灵气潮汐相位（真实秒）
    this.year = 0;
    this._tickCount = 0;
    this._chunkW = Math.ceil(W / CH);

    for (let i = 0; i < N; i++) { this.resId[i] = -1; }
    this.markAllDirty();
  }

  /* ================= 基础访问 ================= */
  idx(x, y) { return y * this.W + x; }
  inB(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  markAllDirty() { for (let i = 0; i < this._chunkW * Math.ceil(this.H / CH); i++) this.dirty.add(i); }
  markDirty(x, y) {
    const cx = x >> 4, cy = y >> 4;
    this.dirty.add(cy * this._chunkW + cx);
  }
  markDirtyArea(x, y, r) {
    const x0 = Math.max(0, x - r), x1 = Math.min(this.W - 1, x + r);
    const y0 = Math.max(0, y - r), y1 = Math.min(this.H - 1, y + r);
    for (let cy = y0 >> 4; cy <= (y1 >> 4); cy++)
      for (let cx = x0 >> 4; cx <= (x1 >> 4); cx++) this.dirty.add(cy * this._chunkW + cx);
  }

  /** 地形高度 0..1 */
  hAt(x, y) { return this.inB(x, y) ? this.height[this.idx(x, y)] / 255 : 0; }
  /** 生成阶段的海洋判断（不依赖 biome 数组） */
  isSeaAt(x, y) { return this.height[this.idx(x, y)] / 255 < 0.355; }
  auraAt(x, y) { return this.inB(x, y) ? this.aura[this.idx(x, y)] : 0; }
  demonAt(x, y) { return this.inB(x, y) ? this.demon[this.idx(x, y)] : 0; }
  biomeAt(x, y) { return this.inB(x, y) ? this.biome[this.idx(x, y)] : BIOME.DEEP_SEA; }
  isWater(x, y) { const b = this.biomeAt(x, y); return b === BIOME.DEEP_SEA || b === BIOME.SEA; }
  isLand(x, y) { return !this.isWater(x, y); }
  passable(x, y) { return this.isLand(x, y) && this.inB(x, y); }

  /** 查询最近的资源点（可指定类型过滤） */
  nearestSite(x, y, kinds, maxR) {
    let best = null, bd = maxR * maxR;
    for (const s of this.sites) {
      if (kinds && kinds.indexOf(s.type) < 0) continue;
      const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /* ================= 生成流程 ================= */
  /** 返回 [{label, fn}]，主循环逐步执行以显示进度 */
  genSteps() {
    return [
      ['开辟天地', () => this._genHeight()],
      ['调和阴阳', () => this._genClimate()],
      ['灵气初生', () => this._genAura()],
      ['灵气汇聚', () => { this._smoothAura(3); this._valleyGather(); }],
      ['龙脉显形', () => this._genLeyLines()],
      ['灵脉落位', () => this._genSites()],
      ['洞天福地', () => this._genWonders()],
      ['划分地脉', () => this._genBiomes()],
      ['草木生发', () => { this._genDecor(); this._finalize(); }],
    ];
  }

  /* ---- 1. 高度图：fBm + 山脊噪声 + 分位数映射 ---- */
  _genHeight() {
    const { W, H } = this;
    const s = this.seed;
    const n1 = new Simplex(s + 101), n2 = new Simplex(s + 202), n3 = new Simplex(s + 303);
    const oct = CFG.noise.octaves, lac = CFG.noise.lacunarity, gain = CFG.noise.gain;
    const raw = new Float32Array(this.N);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const cont = fbm(n1, x * 0.0062, y * 0.0062, 4, lac, gain) * 0.5 + 0.5;
        const det = fbm(n2, x * 0.038, y * 0.038, oct, lac, gain) * 0.5 + 0.5;
        const mt = ridged(n3, x * 0.0155, y * 0.0155, 5, lac, gain);
        const dx = (x / W) * 2 - 1, dy = (y / H) * 2 - 1;
        const d = Math.sqrt(dx * dx * 0.92 + dy * dy * 1.08);
        const edge = 1 - smoothstep(clamp((d - 0.52) / 0.46, 0, 1));
        let v = cont * 0.70 + det * 0.18;
        v += mt * 0.46 * smoothstep(clamp((v - 0.40) / 0.22, 0, 1));
        v *= (0.28 + 0.72 * edge);
        raw[this.idx(x, y)] = v;
      }
    }
    // 分位数映射：精确控制海陆比与地貌层次
    const sorted = Float32Array.from(raw).sort();
    const N = this.N, hgt = this.height;
    for (let i = 0; i < N; i++) {
      const v = raw[i];
      let lo = 0, hi = N - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < v) lo = mid + 1; else hi = mid;
      }
      hgt[i] = clamp(hQuantile(lo / (N - 1)), 0, 1) * 255;
    }
  }

  /* ---- 2. 温度与湿度 ---- */
  _genClimate() {
    const { W, H } = this;
    const n = new Simplex(this.seed + 404);
    for (let y = 0; y < H; y++) {
      const lat = Math.abs((y / H) * 2 - 1);          // 0 赤道 → 1 两极
      for (let x = 0; x < W; x++) {
        const i = this.idx(x, y);
        const h = this.height[i] / 255;
        let t = 1 - lat * 0.82 + (n.noise2D(x * 0.012, y * 0.012)) * 0.10;
        t -= smoothstep(clamp((h - 0.52) / 0.42, 0, 1)) * 0.62;
        this.temp[i] = clamp(t, 0, 1) * 255;

        let m = fbm(n, x * 0.019, y * 0.019, 4) * 0.5 + 0.5;
        m -= smoothstep(clamp((h - 0.5) / 0.45, 0, 1)) * 0.30;
        m += (0.5 - Math.abs(t - 0.55)) * 0.18;
        this.moist[i] = clamp(m, 0, 1) * 255;
      }
    }
  }

  /* ---- 3. 灵气场 ---- */
  _genAura() {
    const { W, H, rng } = this;
    const n = new Simplex(this.seed + 505);
    const a = this.aura;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = this.idx(x, y);
        const h = this.height[i] / 255, t = this.temp[i] / 255, m = this.moist[i] / 255;
        let v;
        if (h < 0.355) v = 6 + h * 26;                       // 海洋：稀薄 6~15
        else {
          const above = (h - 0.355) / 0.645;
          v = 34 + above * 48;                               // 平地 34 → 高山 82
        }
        v += (m - 0.5) * 10 - Math.abs(t - 0.58) * 8;        // 湿润温和处更旺
        v += fbm(n, x * 0.028, y * 0.028, 4) * 24;           // 噪声起伏
        a[i] = v;
      }
    }
    // 灵眼与绝地
    const nodes = [];
    const eyes = rng.int(14, 22);
    for (let k = 0; k < eyes; k++) {
      const x = rng.int(14, W - 15), y = rng.int(14, H - 15);
      if (this.height[this.idx(x, y)] / 255 < 0.38) continue;
      const r = rng.range(9, 24), s = rng.range(26, 58);
      this._radialAdd(a, x, y, r, s);
      nodes.push({ x, y, r, s, kind: 1 });
    }
    const deads = rng.int(6, 10);
    for (let k = 0; k < deads; k++) {
      const x = rng.int(14, W - 15), y = rng.int(14, H - 15);
      const r = rng.range(7, 15), s = -rng.range(52, 78);
      this._radialAdd(a, x, y, r, s);
      nodes.push({ x, y, r, s: -s, kind: -1 });
    }
    this.auraNodes = nodes;
    for (let i = 0; i < a.length; i++) a[i] = clamp(a[i], 1, 100);
  }

  _radialAdd(arr, cx, cy, r, amp) {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.H - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d2 > r2) continue;
        const w = 1 - Math.sqrt(d2) / r;
        arr[this.idx(x, y)] += amp * w * w;
      }
    }
  }

  /** 3x3 平滑（保留局部极值） */
  _smoothAura(passes) {
    const { W, H, aura } = this;
    let tmp = new Float32Array(aura.length);
    for (let p = 0; p < passes; p++) {
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          const s = aura[i - 1] + aura[i + 1] + aura[i - W] + aura[i + W];
          tmp[i] = aura[i] * 0.6 + s * 0.1;
        }
      }
      for (let i = 0; i < aura.length; i++) aura[i] = tmp[i] ? tmp[i] : aura[i];
    }
  }

  /** 灵气向低洼汇聚（山谷加成） */
  _valleyGather() {
    const { W, H, aura, height } = this;
    // 近似局部均值：隔点采样
    for (let y = 2; y < H - 2; y++) {
      for (let x = 2; x < W - 2; x++) {
        const i = y * W + x;
        const h = height[i];
        let sum = 0, cnt = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx += 2) {
          sum += height[i + dy * W + dx]; cnt++;
        }
        const avg = sum / cnt;
        const valley = clamp((avg - h) / 46, 0, 1);
        aura[i] += valley * 20;
      }
    }
    for (let i = 0; i < aura.length; i++) aura[i] = clamp(aura[i], 1, 100);
  }

  /* ---- 4. 龙脉：从灵势峰值沿最陡下降追踪 ---- */
  _genLeyLines() {
    const { W, H } = this;
    const pot = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) {
      const h = this.height[i];
      pot[i] = this.aura[i] * 0.55 + (h / 255) * 46;
    }
    // 平滑势场，保证连线自然
    let tmp = new Float32Array(this.N);
    for (let p = 0; p < 2; p++) {
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          tmp[i] = pot[i] * 0.5 + (pot[i - 1] + pot[i + 1] + pot[i - W] + pot[i + W]) * 0.125;
        }
      }
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; pot[i] = tmp[i]; }
    }
    // 选种子：网格内局部最大
    const STEP = 22;
    const seeds = [];
    for (let y = STEP; y < H - STEP; y += STEP) {
      for (let x = STEP; x < W - STEP; x += STEP) {
        let bi = -1, bv = -1e9;
        for (let dy = -8; dy <= 8; dy += 2) for (let dx = -8; dx <= 8; dx += 2) {
          const j = (y + dy) * W + (x + dx);
          if (pot[j] > bv) { bv = pot[j]; bi = j; }
        }
        if (bi >= 0) {
          const px = bi % W, py = (bi / W) | 0;
          if (this.height[bi] / 255 > 0.42 && this.aura[bi] > 42) seeds.push({ x: px, y: py, v: bv });
        }
      }
    }
    seeds.sort((a, b) => b.v - a.v);
    const paths = [];
    const visited = new Uint8Array(this.N);
    for (let si = 0; si < Math.min(seeds.length, 26); si++) {
      const s = seeds[si];
      if (visited[this.idx(s.x, s.y)]) continue;
      const path = [];
      let cx = s.x, cy = s.y, px = cx, py = cy, guard = 0;
      const strength = clamp((this.aura[this.idx(cx, cy)] - 40) / 30, 0.35, 1);
      while (guard++ < 260) {
        const i = cy * W + cx;
        if (visited[i]) break;
        visited[i] = 1;
        path.push(cx, cy);
        // 找最陡下降（带方向惯性）
        let bx = -1, by = -1, bv = pot[i];
        for (const d of DIR8) {
          const nx = cx + d[0], ny = cy + d[1];
          if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
          const j = ny * W + nx;
          let v = pot[j];
          if (nx === px && ny === py) v += 0.01;   // 轻微防回头
          if (v < bv) { bv = v; bx = nx; by = ny; }
        }
        if (bx < 0) break;
        px = cx; py = cy; cx = bx; cy = by;
      }
      if (path.length >= 6) {
        paths.push({ pts: path, s: strength });
        for (let k = 0; k < path.length; k += 2) {
          const i = path[k + 1] * W + path[k];
          const lv = strength > 0.75 ? 3 : (strength > 0.5 ? 2 : 1);
          if (this.ley[i] < lv) this.ley[i] = lv;
        }
        // 龙脉滋养：沿脉补灵气
        for (let k = 0; k < path.length; k += 2) {
          this._radialAdd(this.aura, path[k], path[k + 1], 3.2, strength * 6);
        }
      }
    }
    this.leyPaths = paths;
    for (let i = 0; i < this.N; i++) this.aura[i] = clamp(this.aura[i], 1, 100);
  }

  /* ---- 5. 灵脉 / 矿脉 / 灵田 / 药谷 / 魔渊 ---- */
  _genSites() {
    const { W, H, rng } = this;
    const G = CFG.res.siteGen;
    let id = 0;
    const add = (type, x, y, r, tier) => {
      const s = {
        id: id++, type, x, y, r, tier, owner: -1, ownerUnit: -1,
        reserve: 100, maxReserve: 100, depleted: 0, yieldAcc: 0,
        regen: this._siteRegen(type),
      };
      this.sites.push(s);
      const i = this.idx(x, y);
      this.resType[i] = type; this.resId[i] = s.id;
      return s;
    };
    for (let gy = G; gy < H - G; gy += G) {
      let xoff = ((gy / G) | 0) % 2 === 0 ? 0 : (G / 2) | 0;   // 交错网格
      for (let gx = G + xoff; gx < W - G; gx += G) {
        const x = clamp(gx + rng.int(-3, 3), 2, W - 3), y = clamp(gy + rng.int(-3, 3), 2, H - 3);
        const i = this.idx(x, y);
        if (this.isSeaAt(x, y)) continue;
        const a = this.aura[i], h = this.height[i] / 255, m = this.moist[i] / 255, t = this.temp[i] / 255;
        const isLey = this.ley[i] > 0;
        if (a > 72 && (isLey || rng.chance(0.62))) {
          add(RES_TYPE.LINGMAI, x, y, rng.range(2.5, 4.5), a > 88 ? 3 : (a > 81 ? 2 : 1));
        } else if (h > 0.54 && a > 46 && rng.chance(0.34)) {
          // 矿脉：海拔与灵气决定档次
          let tier = 0;
          if (h > 0.82 && a > 62) tier = rng.chance(0.35) ? 3 : 2;      // 寒铁
          else if (h > 0.74 && a > 55) tier = rng.chance(0.4) ? 2 : 1;
          else if (h > 0.62) tier = rng.chance(0.5) ? 1 : 0;
          else tier = 0;
          if (this.flag[i] === 2) tier = 4;                               // 奇观附近出星辰铁
          add(RES_TYPE.ORESITE, x, y, rng.range(2.2, 3.8), tier);
        } else if (h < 0.58 && a > 54 && rng.chance(0.52)) {
          add(RES_TYPE.LINGTIAN, x, y, rng.range(2.5, 4), 0);
        } else if (m > 0.48 && a > 58 && t > 0.32 && t < 0.76 && rng.chance(0.45)) {
          add(RES_TYPE.YAOGU, x, y, rng.range(2.4, 4), 1);
        } else if (a < 20 && rng.chance(0.10)) {
          add(RES_TYPE.ABYSSNODE, x, y, rng.range(2, 3.2), 0);
        }
      }
    }
    // 标记资源点覆盖格（用于渲染与查询）
    for (const s of this.sites) {
      const r = Math.ceil(s.r);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = s.x + dx, y = s.y + dy;
        if (!this.inB(x, y)) continue;
        if (dx * dx + dy * dy > s.r * s.r) continue;
        const i = this.idx(x, y);
        if (this.resId[i] < 0) { this.resId[i] = s.id; this.resType[i] = s.type; }
      }
    }
  }

  /* ---- 6. 洞天福地与奇观 ---- */
  _genWonders() {
    const { W, H, rng } = this;
    // 洞天福地：龙脉末端
    let caveCount = 0;
    for (let k = 0; k < this.leyPaths.length && caveCount < 6; k++) {
      const p = this.leyPaths[k];
      if (p.pts.length < 24) continue;
      if (!rng.chance(0.62)) continue;
      const ex = p.pts[p.pts.length - 2], ey = p.pts[p.pts.length - 1];
      if (this.isSeaAt(ex, ey)) continue;
      const r = rng.range(3, 5);
      const site = this._addSite(RES_TYPE.DONGXUE, ex, ey, r, 3);
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const x = ex + dx, y = ey + dy;
        if (!this.inB(x, y) || dx * dx + dy * dy > 30) continue;
        const i = this.idx(x, y);
        this.flag[i] = 1;
        this.aura[i] = Math.min(100, this.aura[i] + 26);
      }
      caveCount++;
    }
    // 世界奇观：1-3 个，落在灵气最高的开阔地
    let best = -1;
    const scores = [];
    for (let y = 12; y < H - 12; y += 6) {
      for (let x = 12; x < W - 12; x += 6) {
        const i = this.idx(x, y);
        if (this.isSeaAt(x, y)) continue;
        const h = this.height[i] / 255;
        if (h > 0.78) continue;
        // 局部均值灵气
        let s = 0;
        for (let dy = -6; dy <= 6; dy += 3) for (let dx = -6; dx <= 6; dx += 3) s += this.aura[this.idx(x + dx, y + dy)];
        s /= 25;
        scores.push({ x, y, s });
      }
    }
    scores.sort((a, b) => b.s - a.s);
    const used = [];
    const want = rng.int(1, 3);
    for (const sc of scores) {
      if (this.wonders.length >= want) break;
      let ok = true;
      for (const u of used) if (dist(u.x, u.y, sc.x, sc.y) < 60) { ok = false; break; }
      if (!ok) continue;
      used.push(sc);
      const def = WONDERS[this.wonders.length % WONDERS.length];
      const w = { id: this.wonders.length, def: def.id, name: def.n, x: sc.x, y: sc.y, r: 10, active: true, owner: -1 };
      this.wonders.push(w);
      for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
        const x = sc.x + dx, y = sc.y + dy;
        if (!this.inB(x, y) || dx * dx + dy * dy > 100) continue;
        const i = this.idx(x, y);
        this.flag[i] = 2;
        this.aura[i] = Math.min(100, this.aura[i] + 18);
      }
    }
  }

  /** 资源再生速率（每年恢复的储量百分比） */
  _siteRegen(type) {
    switch (type) {
      case RES_TYPE.LINGTIAN: return 1.0;    // 灵田：草木自生
      case RES_TYPE.YAOGU: return 0.8;       // 药谷
      case RES_TYPE.DONGXUE: return 0.65;    // 洞天福地
      case RES_TYPE.LINGMAI: return 0.45;    // 灵脉：地气汇聚
      case RES_TYPE.ABYSSNODE: return 0.3;   // 魔渊
      default: return 0.18;                  // 矿脉：极慢，故矿产珍贵
    }
  }

  _addSite(type, x, y, r, tier) {
    const s = {
      id: this.sites.length, type, x, y, r, tier, owner: -1, ownerUnit: -1,
      reserve: 100, maxReserve: 100, depleted: 0, yieldAcc: 0,
      regen: this._siteRegen(type),
    };
    this.sites.push(s);
    const i = this.idx(x, y);
    if (this.resId[i] < 0) { this.resType[i] = type; this.resId[i] = s.id; }
    return s;
  }

  /* ---- 7. 生物群系 ---- */
  /** 单一群系判定（水优先，避免海洋被误判） */
  _biomeFor(x, y) {
    const i = this.idx(x, y);
    const h = this.height[i] / 255, t = this.temp[i] / 255, m = this.moist[i] / 255;
    const a = this.aura[i], dm = this.demon[i];
    const B = BIOME;
    if (h < 0.295) return B.DEEP_SEA;
    if (h < 0.355) return B.SEA;
    if (h < 0.392) return B.BEACH;
    if (dm > 55) return B.ABYSS;
    if (this.flag[i] === 1) return B.CAVE;
    if (a < 15) return B.DEADLAND;
    if (h > 0.855) return B.SNOW;
    if (h > 0.715) return B.MOUNTAIN;
    if (h > 0.60) return B.HILL;
    if (a > 66 && m > 0.40) return B.LINGTIAN;
    if (a > 56 && m > 0.48 && t > 0.32 && t < 0.80) return B.YAOGU;
    if (a > 46 && m > 0.52 && t > 0.28 && t < 0.82) return B.DEMON_FOREST;
    if (t > 0.68 && m < 0.36) return B.DESERT;
    if (t < 0.22) return B.SNOWFIELD;
    if (m > 0.58) return B.FOREST;
    if (m > 0.42) return B.GRASS;
    return B.PLAIN;
  }

  _genBiomes() {
    const { W, H } = this;
    const B = BIOME;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        this.biome[this.idx(x, y)] = this._biomeFor(x, y);
      }
    }
    // 资源点覆盖群系（让地图上看得见）
    for (const s of this.sites) {
      const i = this.idx(s.x, s.y);
      if (s.type === 3) this.biome[i] = B.LINGTIAN;
      else if (s.type === 4) this.biome[i] = B.YAOGU;
      else if (s.type === 6) this.biome[i] = B.ABYSS;
    }
  }

  /* ---- 8. 地表装饰：草木石竹，按群系落位 ---- */
  _genDecor() {
    const { W, H, rng } = this;
    const B = BIOME, d = D;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = this.idx(x, y);
        const b = this.biome[i];
        const r = rng.next();
        let t = -1, pal = 0, big = 0;
        switch (b) {
          case B.FOREST:
            if (r < 0.135) { t = rng.chance(0.42) ? d.PINE : d.TREE; pal = rng.chance(0.28) ? 1 : 0; big = 1; }
            else if (r < 0.20) { t = d.BUSH; pal = rng.chance(0.3) ? 1 : 0; }
            else if (r < 0.24) { t = d.MUSHROOM; pal = 1; }
            else if (r < 0.31) { t = rng.chance(0.5) ? d.GRASS : d.FLOWER; pal = 0; }
            else if (r < 0.325) { t = d.ROCK; pal = 0; }
            break;
          case B.DEMON_FOREST:
            if (r < 0.20) { t = d.TREE; pal = 5; big = 1; }
            else if (r < 0.31) { t = d.DEAD; pal = 5; big = 1; }
            else if (r < 0.40) { t = d.BUSH; pal = 5; }
            else if (r < 0.44) { t = d.BONE; pal = 5; }
            break;
          case B.GRASS: case B.PLAIN:
            if (r < 0.11) { t = d.GRASS; pal = 0; }
            else if (r < 0.15) { t = d.FLOWER; pal = 0; }
            else if (r < 0.175) { t = rng.chance(0.35) ? d.TREE : d.BUSH; pal = 0; big = r < 0.16 ? 1 : 0; }
            break;
          case B.HILL:
            if (r < 0.055) { t = d.ROCK; pal = 0; }
            else if (r < 0.075) { t = d.BUSH; pal = 0; }
            else if (r < 0.10) { t = rng.chance(0.5) ? d.GRASS : d.FLOWER; pal = 0; }
            else if (r < 0.115) { t = d.PINE; pal = 0; big = 1; }
            break;
          case B.MOUNTAIN:
            if (r < 0.09) { t = d.ROCK; pal = 0; }
            else if (r < 0.105) { t = d.PINE; pal = 2; big = 1; }
            break;
          case B.SNOW: case B.SNOWFIELD:
            if (r < 0.055) { t = d.CRYSTAL; pal = 4; big = 1; }
            else if (r < 0.085) { t = d.PINE; pal = 2; big = 1; }
            else if (r < 0.10) { t = d.ROCK; pal = 4; }
            break;
          case B.DESERT:
            if (r < 0.035) { t = d.CACTUS; pal = 3; big = 1; }
            else if (r < 0.06) { t = d.ROCK; pal = 3; }
            else if (r < 0.072) { t = d.DEAD; pal = 3; big = 1; }
            break;
          case B.BEACH:
            if (r < 0.055) { t = d.REED; pal = 9; }
            else if (r < 0.075) { t = d.TREE; pal = 9; big = 1; }
            else if (r < 0.09) { t = d.ROCK; pal = 9; }
            break;
          case B.LINGTIAN:
            if (r < 0.14) { t = d.FLOWER; pal = 8; }
            else if (r < 0.22) { t = d.GRASS; pal = 8; }
            else if (r < 0.245) { t = d.BAMBOO; pal = 8; big = 1; }
            break;
          case B.YAOGU:
            if (r < 0.12) { t = d.FLOWER; pal = 7; }
            else if (r < 0.20) { t = d.GRASS; pal = 7; }
            else if (r < 0.235) { t = d.BUSH; pal = 7; }
            else if (r < 0.255) { t = d.MUSHROOM; pal = 7; }
            else if (r < 0.27) { t = d.PINE; pal = 7; big = 1; }
            break;
          case B.CAVE:
            if (r < 0.075) { t = d.CRYSTAL; pal = 6; big = 1; }
            else if (r < 0.12) { t = d.LOTUS; pal = 6; }
            else if (r < 0.16) { t = d.MUSHROOM; pal = 6; }
            else if (r < 0.20) { t = d.TREE; pal = 6; big = 1; }
            break;
          case B.ABYSS:
            if (r < 0.10) { t = d.DEAD; pal = 5; big = 1; }
            else if (r < 0.17) { t = d.BUSH; pal = 5; }
            else if (r < 0.21) { t = d.BONE; pal = 5; }
            break;
          case B.DEADLAND:
            if (r < 0.045) { t = d.DEAD; pal = 3; big = 1; }
            else if (r < 0.085) { t = d.ROCK; pal = 3; }
            else if (r < 0.10) { t = d.BONE; pal = 3; }
            break;
          case B.SEA:
            if (r < 0.03) { t = d.LOTUS; pal = 6; }
            else if (r < 0.05) { t = d.REED; pal = 8; }
            break;
        }
        if (t < 0) continue;
        const meta = DECOR_META[t];
        const dec = {
          x: x + 0.5, y: y + 0.5, t, pal,
          v: rng.int(0, 3),
          s: 0.82 + rng.next() * 0.42,
          big: meta ? meta.big : 0,
          alive: 1,
        };
        this.decor.push(dec);
        const ci = (y >> 4) * this._chunkW + (x >> 4);
        let arr = this.decorChunks.get(ci);
        if (!arr) { arr = []; this.decorChunks.set(ci, arr); }
        arr.push(dec);
        // 大装饰另建 8 格粒度的空间网格，供单位遮挡判定快速查询
        if (dec.big) {
          const gi = (y >> 3) * this._bigDecW + (x >> 3);
          let g2 = this.bigDecorGrid.get(gi);
          if (!g2) { g2 = []; this.bigDecorGrid.set(gi, g2); }
          g2.push(dec);
        }
      }
    }
  }

  /** 天灾：烧毁/摧毁区域内的草木 */
  burnDecor(cx, cy, r, chance) {
    const c0x = Math.max(0, Math.floor((cx - r) / 16)), c1x = Math.min(this._chunkW - 1, Math.floor((cx + r) / 16));
    const c0y = Math.max(0, Math.floor((cy - r) / 16)), c1y = Math.min(this._chunkW - 1, Math.floor((cy + r) / 16));
    let n = 0;
    for (let cyy = c0y; cyy <= c1y; cyy++) {
      for (let cxx = c0x; cxx <= c1x; cxx++) {
        const arr = this.decorChunks.get(cyy * this._chunkW + cxx);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const d = arr[k];
          if (!d.alive) continue;
          const dd = (d.x - cx) * (d.x - cx) + (d.y - cy) * (d.y - cy);
          if (dd > r * r) continue;
          if (this.rng.chance(chance)) { d.alive = 0; n++; }
        }
      }
    }
    if (n) this.markDirtyArea(cx, cy, Math.ceil(r) + 1);   // 让地形块重建以抹去草木
    return n;
  }

  /** 生长：灵气充沛处草木复苏 */
  growDecor(cx, cy, r, chance) {
    const c0x = Math.max(0, Math.floor((cx - r) / 16)), c1x = Math.min(this._chunkW - 1, Math.floor((cx + r) / 16));
    const c0y = Math.max(0, Math.floor((cy - r) / 16)), c1y = Math.min(this._chunkW - 1, Math.floor((cy + r) / 16));
    let n = 0;
    for (let cyy = c0y; cyy <= c1y; cyy++) {
      for (let cxx = c0x; cxx <= c1x; cxx++) {
        const arr = this.decorChunks.get(cyy * this._chunkW + cxx);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const d = arr[k];
          if (d.alive) continue;
          const dd = (d.x - cx) * (d.x - cx) + (d.y - cy) * (d.y - cy);
          if (dd > r * r) continue;
          if (this.rng.chance(chance)) { d.alive = 1; n++; }
        }
      }
    }
    if (n) this.markDirtyArea(cx, cy, Math.ceil(r) + 1);
    return n;
  }

  _finalize() {
    for (let i = 0; i < this.N; i++) {
      this.aura[i] = clamp(this.aura[i], 1, 100);
      this.auraBase[i] = this.aura[i];
    }
    this.markAllDirty();
  }
}

export default World;

/* ================= 运行时逻辑 ================= */

/** 灵气潮汐乘数（0.9 ~ 1.1），随真实时间周期波动 */
World.prototype.auraMul = function () {
  return 1 + Math.sin(this.phase * Math.PI * 2 / 24) * 0.10;
};

/** 世界年度推进 */
World.prototype.tick = function (years) {
  this.year += years;
  this._tickCount++;
  const a = this.aura, ab = this.auraBase, d = this.demon;
  const N = this.N;
  const grp = this._tickCount & 7;
  for (let i = grp; i < N; i += 8) {
    if (a[i] !== ab[i]) {
      const diff = ab[i] - a[i];
      if (diff > 0) {
        // 地脉补给：富集之地地气活络、回得快；贫瘠之地回得极慢
        const rate = 0.0050 + ab[i] * 0.00015;
        if (diff < 0.06) a[i] = ab[i];
        else a[i] += Math.min(diff, rate * years);
      } else {
        // 灵气过剩则自然散去（灵雨润泽不会永驻）
        a[i] += diff * Math.min(0.5, 0.010 * years);
      }
    }
    if (d[i] > 0.02) {
      d[i] -= 0.006 * years;
      if (d[i] < 0.05) d[i] = 0;
    }
  }
  if ((this._tickCount & 15) === 0) this._demonDiffuse(years);
};

/** 魔气低频扩散 */
World.prototype._demonDiffuse = function (years) {
  const { W, H, demon } = this;
  const rate = Math.min(0.5, 0.012 * years);
  const delta = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const v = demon[i];
      if (v < 2) continue;
      const out = v * rate;
      demon[i] -= out;
      const nb = [i - 1, i + 1, i - W, i + W];
      for (let k = 0; k < 4; k++) delta.push(nb[k], out * 0.25);
    }
  }
  for (let k = 0; k < delta.length; k += 2) {
    const i = delta[k];
    demon[i] = Math.min(100, demon[i] + delta[k + 1]);
  }
};

/** 神力：增减灵气（同时调整基准，避免被恢复机制抹掉） */
World.prototype.addAura = function (cx, cy, r, amt, toBase = true) {
  this._radialAdd(this.aura, cx, cy, r, amt);
  if (toBase) this._radialAdd(this.auraBase, cx, cy, r, amt);
  // 夹紧
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = this.idx(x, y);
    this.aura[i] = clamp(this.aura[i], 0, 100);
    this.auraBase[i] = clamp(this.auraBase[i], 0, 100);
  }
  this.markDirtyArea(cx, cy, Math.ceil(r) + 1);
};

/** 神力：魔气污染 */
World.prototype.addDemon = function (cx, cy, r, amt) {
  this._radialAdd(this.demon, cx, cy, r, amt);
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = this.idx(x, y);
    this.demon[i] = clamp(this.demon[i], 0, 100);
  }
  this.markDirtyArea(cx, cy, Math.ceil(r) + 1);
};

/** 神力：地形隆起 / 沉降 */
World.prototype.shapeTerrain = function (cx, cy, r, amt) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 > r * r) continue;
      const i = this.idx(x, y);
      const w = 1 - Math.sqrt(d2) / r;
      this.height[i] = clamp(this.height[i] + amt * w * w * 255, 0, 255);
    }
  }
  this.markDirtyArea(cx, cy, Math.ceil(r) + 1);
  this.reclassify(cx, cy, Math.ceil(r) + 2);
};

/** 局部重算群系 */
World.prototype.reclassify = function (cx, cy, r) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      this.biome[this.idx(x, y)] = this._biomeFor(x, y);
    }
  }
};

/** 寻找附近灵气最高的可通行点（修炼位） */
World.prototype.findCultSpot = function (cx, cy, radius, samples = 26) {
  let bx = cx, by = cy, bv = -1;
  const rng = this._spotRng || (this._spotRng = new RNG(12345));
  for (let k = 0; k < samples; k++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * radius;
    const x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d);
    if (!this.passable(x, y)) continue;
    const i = this.idx(x, y);
    const score = this.aura[i] - this.demon[i] * 0.8 + this.ley[i] * 3;
    if (score > bv) { bv = score; bx = x; by = y; }
  }
  return { x: bx, y: by, v: bv };
};

/** 找附近随机陆地 */
World.prototype.findLandNear = function (cx, cy, radius, samples = 20) {
  const rng = this._spotRng || (this._spotRng = new RNG(12345));
  for (let k = 0; k < samples; k++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * radius;
    const x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d);
    if (this.passable(x, y)) return { x, y };
  }
  return null;
};

/** 草木自然再生：灵气充沛之地恢复得更快（被砍伐后会自己长回来） */
World.prototype.regenDecor = function (years) {
  const chunks = this.decorChunks;
  if (!chunks || !chunks.size) return;
  if (!this._decorKeys) this._decorKeys = Array.from(chunks.keys());
  const keys = this._decorKeys;
  const rng = this._spotRng || (this._spotRng = new RNG(999));
  // 每年抽查若干区块，避免全量遍历
  for (let i = 0; i < 8; i++) {
    const arr = chunks.get(keys[(rng.next() * keys.length) | 0]);
    if (!arr) continue;
    for (let k = 0; k < arr.length; k++) {
      const d = arr[k];
      if (d.alive) continue;
      const ix = Math.floor(d.x), iy = Math.floor(d.y);
      if (!this.inB(ix, iy)) continue;
      const aura = this.aura[this.idx(ix, iy)];
      if (aura > 38 && rng.chance(0.20 * years)) {
        d.alive = 1;
        this.markDirtyArea(ix, iy, 1);
      }
    }
  }
};

/** 地脉回灌：灵脉与洞天会把地气缓缓补回周边（灵气并非凭空而来） */
World.prototype.leyRecharge = function (years) {
  const sites = this.sites;
  let touched = [];
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    if (s.type !== 1 && s.type !== 5) continue;    // 仅灵脉与洞天福地
    const gain = (s.type === 5 ? 0.35 : 0.22) * years;
    this._radialAdd(this.auraBase, s.x, s.y, s.r + 3, gain);
    this._radialAdd(this.aura, s.x, s.y, s.r + 3, gain);
    touched.push(s);
    // 锚住上限，避免无限攀升
    const r = Math.ceil(s.r + 4);
    const x0 = Math.max(0, s.x - r), x1 = Math.min(this.W - 1, s.x + r);
    const y0 = Math.max(0, s.y - r), y1 = Math.min(this.H - 1, s.y + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const j = this.idx(x, y);
        if (this.auraBase[j] > 96) this.auraBase[j] = 96;
        if (this.aura[j] > 100) this.aura[j] = 100;
      }
    }
    this.markDirtyArea(s.x, s.y, r);
  }
  // 灵眼同样在吐纳地气
  for (let k = 0; k < this.auraNodes.length; k++) {
    const nd = this.auraNodes[k];
    if (nd.kind !== 1) continue;
    this._radialAdd(this.auraBase, nd.x, nd.y, nd.r * 0.55, 0.03 * years);
  }
};

/** 天雷殛落：焦土、陷坑与方圆草木成灰 */
World.prototype.strikeScorch = function (x, y, power) {
  this.shapeTerrain(x, y, 1.6, -0.006 * power);
  this.burnDecor(x, y, 3.0 + power, 0.85);
  this.markDirtyArea(x, y, 6);
};

/** 魔渊渗出魔气：为魔道修士提供土壤（否则正魔失衡） */
World.prototype.abyssSeep = function (years) {
  for (let i = 0; i < this.sites.length; i++) {
    const s = this.sites[i];
    if (s.type !== 6) continue;
    const ix = this.idx(s.x, s.y);
    if (this.demon[ix] > 48) continue;
    this._radialAdd(this.demon, s.x, s.y, s.r + 2.5, 0.5 * years);
    // 夹紧并局部重算群系
    const r = Math.ceil(s.r + 3);
    const x0 = Math.max(0, s.x - r), x1 = Math.min(this.W - 1, s.x + r);
    const y0 = Math.max(0, s.y - r), y1 = Math.min(this.H - 1, s.y + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const j = this.idx(x, y);
        this.demon[j] = clamp(this.demon[j], 0, 100);
      }
    }
    this.reclassify(s.x, s.y, r);
    this.markDirtyArea(s.x, s.y, r);
  }
};

/** 资源点年度再生：开采之后靠时间恢复，绝不凭空产出 */
World.prototype.tickSites = function (years) {
  const sites = this.sites;
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    if (s.reserve >= s.maxReserve) continue;
    s.reserve = Math.min(s.maxReserve, s.reserve + s.regen * years);
    if (s.depleted && s.reserve > s.maxReserve * 0.35) {
      s.depleted = 0;
    }
  }
};

/** 世界统计（UI 用） */
World.prototype.landStats = function () {
  let land = 0, auraSum = 0, demonSum = 0, high = 0;
  for (let i = 0; i < this.N; i++) {
    const b = this.biome[i];
    if (b !== BIOME.DEEP_SEA && b !== BIOME.SEA) land++;
    auraSum += this.aura[i];
    demonSum += this.demon[i];
    if (this.aura[i] > 80) high++;
  }
  return {
    landRatio: land / this.N,
    auraAvg: auraSum / this.N,
    demonAvg: demonSum / this.N,
    highAuraCells: high,
    sites: this.sites.length,
    wonders: this.wonders.length,
  };
};
