/**
 * decor.js —— 地表装饰物：树木、灌木、花草、岩石、竹、冰晶、魔木……
 * 全部由 Canvas 路径程序化绘制并缓存为精灵，按视口 + LOD 绘制。
 */

export const D = {
  TREE: 0, PINE: 1, DEAD: 2, BUSH: 3, ROCK: 4, FLOWER: 5, GRASS: 6,
  CACTUS: 7, CRYSTAL: 8, LOTUS: 9, MUSHROOM: 10, BAMBOO: 11, BONE: 12, REED: 13,
};

/** big: 低倍率是否绘制　size: 基准尺寸（格）　h: 高度系数 */
export const DECOR_META = [
  { n: '阔叶树', big: 1, size: 2.2, h: 1.15 },
  { n: '松树',   big: 1, size: 2.1, h: 1.30 },
  { n: '枯木',   big: 1, size: 1.9, h: 1.10 },
  { n: '灌木',   big: 0, size: 1.1, h: 1.00 },
  { n: '岩石',   big: 0, size: 1.2, h: 0.75 },
  { n: '野花',   big: 0, size: 0.7, h: 1.00 },
  { n: '草簇',   big: 0, size: 0.8, h: 1.00 },
  { n: '仙人掌', big: 1, size: 1.6, h: 1.25 },
  { n: '灵晶',   big: 1, size: 1.4, h: 1.20 },
  { n: '灵莲',   big: 0, size: 1.0, h: 0.80 },
  { n: '灵菇',   big: 0, size: 1.0, h: 0.95 },
  { n: '青竹',   big: 1, size: 2.0, h: 1.45 },
  { n: '骸骨',   big: 0, size: 1.2, h: 0.70 },
  { n: '芦苇',   big: 0, size: 1.0, h: 1.10 },
];

/** 调色板：leaf 主色系 / trunk 干色 / accent 点缀 */
export const PALS = [
  { n: '温带',   leaf: ['#2f7a3a', '#3d8c46', '#276b32', '#4a9a52'], trunk: '#4a3524', accent: '#e8d24a' },
  { n: '深林',   leaf: ['#1f5a2c', '#2a6b34', '#174a24', '#357a3e'], trunk: '#3a2a1c', accent: '#ff6a8a' },
  { n: '寒带',   leaf: ['#2e6a52', '#3a7a5e', '#24584a', '#488a6a'], trunk: '#4a3a2c', accent: '#d8f0ff' },
  { n: '荒漠',   leaf: ['#8a9a52', '#7a8a46', '#9aaa5e', '#6a7a3a'], trunk: '#7a5a3a', accent: '#ffd06a' },
  { n: '雪原',   leaf: ['#c8d8e0', '#dae8f0', '#b0c4d0', '#e8f4ff'], trunk: '#5a4a3c', accent: '#a0e0ff' },
  { n: '魔渊',   leaf: ['#5a1a6a', '#7a2a8a', '#3a0e4a', '#9a3aaa'], trunk: '#2a1428', accent: '#ff4ad0' },
  { n: '洞天',   leaf: ['#7ad8c0', '#9ae8d0', '#5ac0a8', '#b8f4e0'], trunk: '#4a5a5a', accent: '#fff4b0' },
  { n: '药谷',   leaf: ['#4a9a5a', '#5aaa68', '#3a8a4a', '#6aba78'], trunk: '#5a4030', accent: '#d080ff' },
  { n: '灵田',   leaf: ['#6ac878', '#7ad888', '#5ab868', '#8ce898'], trunk: '#5a5030', accent: '#fff8a0' },
  { n: '海滨',   leaf: ['#5a9a6a', '#6aaa78', '#4a8a5a', '#7aba88'], trunk: '#8a7050', accent: '#ffe0c0' },
];

/** 确定性伪随机（同一种子恒定输出） */
function prand(seed, k) {
  let h = (seed * 374761393 + k * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* ================= 绘制 ================= */
export function paintDecor(g, S, type, pal, seed) {
  const cx = S / 2, base = S * 0.94;
  const P = PALS[pal] || PALS[0];
  const L = P.leaf, T = P.trunk, A = P.accent;
  const pk = (k) => prand(seed, k);
  const lc = () => L[(pk(1) * L.length) | 0];
  g.lineCap = 'round';
  g.lineJoin = 'round';

  if (type === D.TREE) {
    const h = base * (0.82 + pk(2) * 0.34);
    const tw = S * (0.055 + pk(3) * 0.03);
    g.fillStyle = T;
    g.beginPath();
    g.moveTo(cx - tw, base);
    g.lineTo(cx - tw * 0.6, base - h * 0.52);
    g.lineTo(cx + tw * 0.6, base - h * 0.52);
    g.lineTo(cx + tw, base);
    g.closePath(); g.fill();
    // 树冠：4 团叶簇
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * 6.283 + pk(4 + i) * 1.2;
      const rr = h * (0.24 + pk(8 + i) * 0.13);
      const ox = Math.cos(a) * h * 0.17, oy = Math.sin(a) * h * 0.11;
      g.fillStyle = lc();
      g.beginPath(); g.arc(cx + ox, base - h * 0.62 + oy, rr, 0, 6.283); g.fill();
    }
    g.fillStyle = lc();
    g.beginPath(); g.arc(cx, base - h * 0.72, h * 0.27, 0, 6.283); g.fill();
    // 高光
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.beginPath(); g.arc(cx - h * 0.1, base - h * 0.82, h * 0.13, 0, 6.283); g.fill();
  } else if (type === D.PINE) {
    const h = base * (0.86 + pk(2) * 0.30);
    g.fillStyle = T;
    g.fillRect(cx - S * 0.035, base - h * 0.30, S * 0.07, h * 0.30);
    const layers = 3;
    for (let i = 0; i < layers; i++) {
      const t = i / layers;
      const y0 = base - h * (0.26 + t * 0.62);
      const half = h * (0.30 - t * 0.17);
      const hh = h * (0.30 - t * 0.06);
      g.fillStyle = L[(i + ((pk(3) * L.length) | 0)) % L.length];
      g.beginPath();
      g.moveTo(cx, y0 - hh);
      g.lineTo(cx + half, y0 + hh * 0.16);
      g.lineTo(cx - half, y0 + hh * 0.16);
      g.closePath(); g.fill();
    }
  } else if (type === D.DEAD) {
    const h = base * (0.78 + pk(2) * 0.3);
    g.strokeStyle = T; g.lineWidth = Math.max(1, S * 0.055);
    g.beginPath(); g.moveTo(cx, base); g.lineTo(cx, base - h * 0.86); g.stroke();
    for (let i = 0; i < 3; i++) {
      const yy = base - h * (0.34 + i * 0.2);
      const dir = i % 2 === 0 ? 1 : -1;
      g.beginPath(); g.moveTo(cx, yy);
      g.lineTo(cx + dir * h * (0.24 + pk(5 + i) * 0.1), yy - h * 0.2);
      g.stroke();
    }
  } else if (type === D.BUSH) {
    const h = base * (0.5 + pk(2) * 0.25);
    for (let i = 0; i < 3; i++) {
      const ox = (pk(3 + i) - 0.5) * S * 0.36;
      g.fillStyle = L[(i + 1) % L.length];
      g.beginPath(); g.arc(cx + ox, base - h * 0.5, h * (0.42 + pk(6 + i) * 0.2), 0, 6.283); g.fill();
    }
  } else if (type === D.ROCK) {
    const w = S * (0.34 + pk(2) * 0.16), h2 = w * (0.62 + pk(3) * 0.3);
    const grey = ['#8a8a92', '#767680', '#9a9aa4', '#666670'][(pk(4) * 4) | 0];
    g.fillStyle = grey;
    g.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * 6.283 - 1.0;
      const rr = w * (0.72 + pk(10 + k) * 0.42);
      const px = cx + Math.cos(a) * rr, py = base - h2 * 0.6 + Math.sin(a) * rr * 0.78;
      k === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
    }
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.20)';
    g.beginPath(); g.ellipse(cx - w * 0.22, base - h2 * 0.85, w * 0.28, h2 * 0.2, -0.4, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.beginPath(); g.ellipse(cx + w * 0.24, base - h2 * 0.35, w * 0.3, h2 * 0.18, 0.3, 0, 6.283); g.fill();
  } else if (type === D.FLOWER) {
    const h = base * (0.4 + pk(2) * 0.25);
    g.strokeStyle = '#4a7a3a'; g.lineWidth = Math.max(0.8, S * 0.035);
    g.beginPath(); g.moveTo(cx, base); g.lineTo(cx, base - h); g.stroke();
    const fc = [A, '#ffffff', '#ffb0d0', '#b0d8ff', '#ffd0a0'][(pk(3) * 5) | 0];
    g.fillStyle = fc;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * 6.283;
      g.beginPath();
      g.arc(cx + Math.cos(a) * S * 0.1, base - h + Math.sin(a) * S * 0.1, S * 0.075, 0, 6.283);
      g.fill();
    }
    g.fillStyle = '#fff8c0';
    g.beginPath(); g.arc(cx, base - h, S * 0.045, 0, 6.283); g.fill();
  } else if (type === D.GRASS) {
    const n = 4 + ((pk(2) * 3) | 0);
    g.strokeStyle = L[(pk(3) * L.length) | 0];
    g.lineWidth = Math.max(0.8, S * 0.04);
    for (let k = 0; k < n; k++) {
      const ox = (pk(4 + k) - 0.5) * S * 0.5;
      const hh = base * (0.3 + pk(10 + k) * 0.28);
      g.beginPath();
      g.moveTo(cx + ox, base);
      g.quadraticCurveTo(cx + ox + S * 0.08, base - hh * 0.6, cx + ox + S * 0.16 * (pk(20 + k) - 0.5) * 2, base - hh);
      g.stroke();
    }
  } else if (type === D.CACTUS) {
    const h = base * (0.72 + pk(2) * 0.28), w = S * 0.13;
    g.fillStyle = '#4a8a4a';
    g.beginPath();
    if (g.roundRect) { g.roundRect(cx - w / 2, base - h, w, h, w * 0.5); g.fill(); }
    else { g.fillRect(cx - w / 2, base - h, w, h); }
    // 手臂
    g.beginPath();
    g.moveTo(cx - w * 0.5, base - h * 0.55);
    g.lineTo(cx - w * 1.6, base - h * 0.55);
    g.lineTo(cx - w * 1.6, base - h * 0.78);
    g.strokeStyle = '#4a8a4a'; g.lineWidth = w * 0.62; g.stroke();
    g.beginPath();
    g.moveTo(cx + w * 0.5, base - h * 0.68);
    g.lineTo(cx + w * 1.5, base - h * 0.68);
    g.lineTo(cx + w * 1.5, base - h * 0.88);
    g.stroke();
    g.fillStyle = A;
    g.beginPath(); g.arc(cx, base - h * 0.98, w * 0.34, 0, 6.283); g.fill();
  } else if (type === D.CRYSTAL) {
    const h = base * (0.5 + pk(2) * 0.3);
    for (let i = 0; i < 3; i++) {
      const ox = (i - 1) * S * 0.16;
      const hh = h * (0.6 + pk(3 + i) * 0.5);
      const w2 = S * 0.085;
      g.fillStyle = i === 1 ? '#dff4ff' : '#a8dcf0';
      g.beginPath();
      g.moveTo(cx + ox, base - hh);
      g.lineTo(cx + ox + w2, base - hh * 0.45);
      g.lineTo(cx + ox, base);
      g.lineTo(cx + ox - w2, base - hh * 0.45);
      g.closePath(); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.beginPath(); g.moveTo(cx - S * 0.02, base - h); g.lineTo(cx + S * 0.04, base - h * 0.5); g.lineTo(cx - S * 0.06, base - h * 0.5); g.closePath(); g.fill();
  } else if (type === D.LOTUS) {
    const h = base * 0.42;
    g.fillStyle = '#3a6a4a';
    g.beginPath(); g.ellipse(cx, base, S * 0.3, S * 0.1, 0, 0, 6.283); g.fill();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * 6.283;
      g.fillStyle = k % 2 ? '#e8b0d8' : '#f8d0e8';
      g.beginPath();
      g.ellipse(cx + Math.cos(a) * S * 0.1, base - h * 0.6 + Math.sin(a) * S * 0.06, S * 0.09, S * 0.14, a, 0, 6.283);
      g.fill();
    }
    g.fillStyle = A;
    g.beginPath(); g.arc(cx, base - h * 0.6, S * 0.06, 0, 6.283); g.fill();
  } else if (type === D.MUSHROOM) {
    const h = base * (0.4 + pk(2) * 0.22);
    g.fillStyle = '#e8e0d0';
    g.fillRect(cx - S * 0.045, base - h * 0.7, S * 0.09, h * 0.7);
    const cap = ['#d05a5a', '#c88a4a', '#8a5ac8'][(pk(3) * 3) | 0];
    g.fillStyle = cap;
    g.beginPath(); g.ellipse(cx, base - h * 0.7, S * 0.19, S * 0.13, 0, Math.PI, 6.283); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath(); g.arc(cx - S * 0.07, base - h * 0.76, S * 0.026, 0, 6.283); g.fill();
    g.beginPath(); g.arc(cx + S * 0.06, base - h * 0.72, S * 0.02, 0, 6.283); g.fill();
  } else if (type === D.BAMBOO) {
    const h = base * (0.9 + pk(2) * 0.25);
    const n = 3;
    for (let i = 0; i < n; i++) {
      const ox = (i - 1) * S * 0.13 + (pk(3 + i) - 0.5) * S * 0.06;
      const hh = h * (0.62 + pk(6 + i) * 0.42);
      const w2 = S * 0.045;
      g.fillStyle = i === 1 ? '#78c060' : '#5aa048';
      g.fillRect(cx + ox - w2, base - hh, w2 * 2, hh);
      g.strokeStyle = 'rgba(20,60,20,0.5)'; g.lineWidth = Math.max(0.5, S * 0.012);
      for (let k = 1; k < 4; k++) {
        const yy = base - hh * (k / 4);
        g.beginPath(); g.moveTo(cx + ox - w2, yy); g.lineTo(cx + ox + w2, yy); g.stroke();
      }
      g.fillStyle = L[(i + 1) % L.length];
      g.beginPath(); g.ellipse(cx + ox + S * 0.1, base - hh * (0.72 + pk(10 + i) * 0.2), S * 0.11, S * 0.035, -0.5, 0, 6.283); g.fill();
    }
  } else if (type === D.BONE) {
    const w = S * 0.3;
    g.fillStyle = '#d8d0c0';
    g.beginPath(); g.ellipse(cx, base - S * 0.08, w * 0.5, S * 0.045, 0.2, 0, 6.283); g.fill();
    g.beginPath(); g.arc(cx - w * 0.5, base - S * 0.1, S * 0.055, 0, 6.283); g.fill();
    g.beginPath(); g.arc(cx + w * 0.5, base - S * 0.06, S * 0.055, 0, 6.283); g.fill();
    g.beginPath(); g.arc(cx, base - S * 0.18, S * 0.07, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.arc(cx - S * 0.026, base - S * 0.19, S * 0.016, 0, 6.283); g.fill();
    g.beginPath(); g.arc(cx + S * 0.026, base - S * 0.19, S * 0.016, 0, 6.283); g.fill();
  } else if (type === D.REED) {
    const n = 5;
    g.strokeStyle = '#7a9a5a'; g.lineWidth = Math.max(0.8, S * 0.03);
    for (let k = 0; k < n; k++) {
      const ox = (pk(2 + k) - 0.5) * S * 0.5;
      const hh = base * (0.45 + pk(10 + k) * 0.4);
      g.beginPath();
      g.moveTo(cx + ox, base);
      g.quadraticCurveTo(cx + ox + S * 0.05, base - hh * 0.5, cx + ox + S * 0.12, base - hh);
      g.stroke();
      g.fillStyle = '#c8a060';
      g.beginPath(); g.ellipse(cx + ox + S * 0.12, base - hh, S * 0.03, S * 0.07, 0.3, 0, 6.283); g.fill();
    }
  }
}

/* ================= 精灵缓存 ================= */
const spriteCache = new Map();

/** 取（或生成）一个装饰精灵 canvas */
export function decorSprite(type, pal, variant, S) {
  const key = type + '_' + pal + '_' + variant + '_' + S;
  let c = spriteCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  paintDecor(g, S, type, pal, variant * 7919 + 13);
  spriteCache.set(key, c);
  return c;
}

export const DECOR_VARIANTS = 4;
