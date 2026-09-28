/**
 * util.js —— 通用工具：随机数、Simplex 噪声、fBm、颜色、几何、命名
 */
import { NAME, ROOTS } from './config.js';

/* ============ 数学 ============ */
export const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = t => t * t * (3 - 2 * t);
export const dist2 = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; };
export const dist = (x1, y1, x2, y2) => Math.sqrt(dist2(x1, y1, x2, y2));
export const sign = v => v < 0 ? -1 : (v > 0 ? 1 : 0);

/* ============ 随机数（可复现） ============ */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed) { this.f = mulberry32(seed); }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.f() * arr.length) % arr.length]; }
  chance(p) { return this.f() < p; }
  /** 权重挑选：items = [{w:number}] */
  weighted(items, key = 'w') {
    let total = 0;
    for (const it of items) total += it[key];
    let r = this.f() * total;
    for (const it of items) { r -= it[key]; if (r <= 0) return it; }
    return items[items.length - 1];
  }
  /** 高斯近似 */
  gauss(mean = 0, sd = 1) {
    let u = 0, v = 0;
    while (u === 0) u = this.f();
    while (v === 0) v = this.f();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ============ Simplex 噪声 (2D) ============ */
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

export class Simplex {
  constructor(seed = 1) {
    const rng = mulberry32(seed >>> 0);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    this.permMod8 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod8[i] = this.perm[i] % 8;
    }
  }

  noise2D(xin, yin) {
    const perm = this.perm, pm8 = this.permMod8;
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const X0 = i - t, Y0 = j - t;
    const x0 = xin - X0, y0 = yin - Y0;
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) { const g = GRAD2[pm8[ii + perm[jj]]]; t0 *= t0; n0 = t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) { const g = GRAD2[pm8[ii + i1 + perm[jj + j1]]]; t1 *= t1; n1 = t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) { const g = GRAD2[pm8[ii + 1 + perm[jj + 1]]]; t2 *= t2; n2 = t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * (n0 + n1 + n2);
  }
}

/** fBm 分形布朗运动，返回 [-1,1] */
export function fbm(nz, x, y, oct = 6, lac = 2.0, gain = 0.5) {
  let a = 1, f = 1, s = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += a * nz.noise2D(x * f, y * f);
    norm += a; a *= gain; f *= lac;
  }
  return s / norm;
}

/** 山脊噪声（用于山脉走向） */
export function ridged(nz, x, y, oct = 5, lac = 2.0, gain = 0.5) {
  let a = 1, f = 1, s = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(nz.noise2D(x * f, y * f));
    s += a * n * n;
    norm += a; a *= gain; f *= lac;
  }
  return s / norm;
}

/* ============ 颜色 ============ */
export function rgb(r, g, b) { return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')'; }
export function rgba(r, g, b, a) { return 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + a + ')'; }
export function mix(c1, c2, t) {
  return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
}
export function hex2rgb(h) {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
/** 热力图配色（0-1）→ [r,g,b] */
export function heat(t) {
  t = clamp(t, 0, 1);
  const stops = [[0, [10, 16, 40]], [0.25, [20, 90, 140]], [0.45, [30, 190, 190]],
                 [0.65, [120, 240, 160]], [0.82, [255, 220, 90]], [1, [255, 90, 60]]];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (t <= b[0]) return mix(a[1], b[1], (t - a[0]) / (b[0] - a[0]));
  }
  return stops[stops.length - 1][1];
}
/** 紫黑系魔气配色 */
export function demonHeat(t) {
  t = clamp(t, 0, 1);
  const stops = [[0, [8, 4, 16]], [0.35, [48, 8, 70]], [0.65, [110, 20, 150]], [1, [220, 90, 255]]];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (t <= b[0]) return mix(a[1], b[1], (t - a[0]) / (b[0] - a[0]));
  }
  return stops[stops.length - 1][1];
}
const _hslCache = {};
export function hsl(h, s, l) {
  const key = h + '_' + s + '_' + l;
  if (_hslCache[key]) return _hslCache[key];
  h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) { r = g = b = l; } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  const out = rgb(r * 255, g * 255, b * 255);
  _hslCache[key] = out;
  return out;
}

/* ============ 网格邻域 ============ */
export const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
export const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/* ============ 命名 ============ */
export class Namer {
  constructor(rng) { this.rng = rng; this.usedSect = new Set(); this.usedPerson = new Set(); }

  person() {
    const r = this.rng;
    for (let t = 0; t < 60; t++) {
      const sur = r.pick(NAME.sur);
      const n1 = r.pick(NAME.given);
      const name = r.chance(0.5) ? sur + n1 : sur + n1 + r.pick(NAME.given);
      if (!this.usedPerson.has(name)) { this.usedPerson.add(name); return name; }
    }
    return r.pick(NAME.sur) + r.pick(NAME.given) + r.pick(NAME.given);
  }

  daoTitle() { return this.rng.pick(NAME.title); }

  sect(demonic) {
    const r = this.rng;
    for (let t = 0; t < 80; t++) {
      let name;
      if (demonic) name = r.pick(NAME.sectDemonA) + r.pick(NAME.sectDemonB);
      else name = r.pick(NAME.sectA) + r.pick(NAME.sectB);
      if (!this.usedSect.has(name)) { this.usedSect.add(name); return name; }
    }
    return '无名' + (demonic ? '魔窟' : '宗');
  }

  root() { return this.rng.weighted(ROOTS); }
}

/* ============ 杂项 ============ */
export function fmt(n) {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}
export function fmtTime(year) {
  const y = Math.floor(year);
  const season = ['春', '夏', '秋', '冬'][Math.floor((year % 1) * 4)];
  return '第 ' + y + ' 年 · ' + season;
}
/** 数组洗牌 */
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
/** 从 TypedArray 找最大值索引 */
export function argmaxU8(arr, from = 0, to = arr.length) {
  let bi = from, bv = -1;
  for (let i = from; i < to; i++) if (arr[i] > bv) { bv = arr[i]; bi = i; }
  return bi;
}
