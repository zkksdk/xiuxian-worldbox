/**
 * icons.js —— 全部图标由 Canvas 路径实时绘制，零外部图片资源。
 * 绘制结果按 (key,size) 缓存，避免重复绘制。
 */

const cache = new Map();

export function getIcon(key, size, drawFn) {
  const k = key + '@' + size;
  let c = cache.get(k);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  drawFn(g, size);
  cache.set(k, c);
  return c;
}

const urlCache = new Map();
/** 返回 dataURL，可安全重复用于 <img> */
export function iconURL(key, size, drawFn) {
  const k = key + '@' + size;
  let u = urlCache.get(k);
  if (u) return u;
  u = getIcon(key, size, drawFn).toDataURL();
  urlCache.set(k, u);
  return u;
}

/* ============ 灵石 ============ */
export function drawSpiritStone(g, size, tier) {
  const colors = [
    ['#7a7a84', '#c8c8d0'], ['#48a8d8', '#a0e8ff'],
    ['#a050e0', '#e0a0ff'], ['#e8b800', '#fff0a0'],
  ];
  const c = colors[Math.min(tier, 3)];
  const cx = size / 2, cy = size / 2, r = size * 0.38;
  const grad = g.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, c[0]); grad.addColorStop(1, c[1]);
  g.beginPath();
  g.moveTo(cx, cy - r); g.lineTo(cx + r * 0.68, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r * 0.68, cy);
  g.closePath();
  g.fillStyle = grad; g.fill();
  g.beginPath();
  g.moveTo(cx, cy - r * 0.62); g.lineTo(cx + r * 0.28, cy - r * 0.08); g.lineTo(cx, cy + r * 0.24);
  g.closePath();
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.fill();
  if (tier >= 2) { g.shadowBlur = size * 0.32; g.shadowColor = c[1]; g.stroke(); }
}

/* ============ 灵草 ============ */
export function drawHerb(g, size, tier) {
  const cx = size / 2, cy = size / 2;
  const leafCount = 3 + tier;
  const colors = ['#6a8a4a', '#7a9a5a', '#8aaa6a', '#9aba7a', '#aaca8a', '#badaba'];
  const color = colors[Math.min(tier, 5)];
  g.strokeStyle = '#4a6a2a'; g.lineWidth = Math.max(1, size * 0.05);
  g.beginPath(); g.moveTo(cx, cy + size * 0.36); g.lineTo(cx, cy - size * 0.05); g.stroke();
  for (let i = 0; i < leafCount; i++) {
    const a = -Math.PI / 2 + (i - (leafCount - 1) / 2) * 0.72;
    const lx = cx + Math.cos(a) * size * 0.15, ly = cy - size * 0.05 + Math.sin(a) * size * 0.15;
    g.save(); g.translate(lx, ly); g.rotate(a + Math.PI / 2);
    g.beginPath(); g.ellipse(0, -size * 0.07, size * 0.09, size * 0.17, 0, 0, 6.2832);
    g.fillStyle = color; g.fill();
    g.restore();
  }
  if (tier >= 3) {
    g.beginPath(); g.arc(cx, cy - size * 0.14, size * 0.07, 0, 6.2832);
    g.fillStyle = '#fff8a0'; g.shadowBlur = size * 0.24; g.shadowColor = '#fff8a0'; g.fill(); g.shadowBlur = 0;
  }
}

/* ============ 法宝 ============ */
export function drawArtifact(g, size, kind, tier) {
  const cx = size / 2, cy = size / 2;
  const cols = ['#a0a0a0', '#60d0ff', '#c060ff', '#ffd700', '#ff6080', '#ffffff'];
  const color = cols[Math.min(tier, 5)];
  g.strokeStyle = color; g.lineWidth = Math.max(1.2, size * 0.075);
  if (tier >= 3) { g.shadowBlur = size * 0.28; g.shadowColor = color; }
  if (kind === 0) {           // 剑
    g.beginPath(); g.moveTo(cx, cy - size * 0.36); g.lineTo(cx, cy + size * 0.12); g.stroke();
    g.beginPath(); g.moveTo(cx - size * 0.16, cy + size * 0.12); g.lineTo(cx + size * 0.16, cy + size * 0.12); g.stroke();
    g.beginPath(); g.moveTo(cx, cy + size * 0.12); g.lineTo(cx, cy + size * 0.4); g.stroke();
  } else if (kind === 1) {    // 甲
    g.beginPath();
    g.moveTo(cx, cy - size * 0.36); g.lineTo(cx + size * 0.26, cy - size * 0.14);
    g.lineTo(cx + size * 0.26, cy + size * 0.16); g.lineTo(cx, cy + size * 0.36);
    g.lineTo(cx - size * 0.26, cy + size * 0.16); g.lineTo(cx - size * 0.26, cy - size * 0.14);
    g.closePath(); g.stroke();
  } else if (kind === 2) {    // 符
    g.strokeRect(cx - size * 0.19, cy - size * 0.3, size * 0.38, size * 0.6);
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const y = cy - size * 0.2 + i * size * 0.13;
      g.moveTo(cx - size * 0.1, y); g.lineTo(cx + size * 0.1, y);
    }
    g.stroke();
  } else {                    // 阵盘
    g.beginPath(); g.arc(cx, cy, size * 0.3, 0, 6.2832); g.stroke();
    g.beginPath(); g.arc(cx, cy, size * 0.15, 0, 6.2832); g.stroke();
    g.beginPath();
    g.moveTo(cx - size * 0.3, cy); g.lineTo(cx + size * 0.3, cy);
    g.moveTo(cx, cy - size * 0.3); g.lineTo(cx, cy + size * 0.3);
    g.stroke();
  }
  g.shadowBlur = 0;
}

/* ============ 功法卷轴 ============ */
export function drawTechnique(g, size, tier) {
  const cx = size / 2, cy = size / 2;
  const colors = ['#c0a060', '#60d0ff', '#c060ff', '#ffd700', '#ff6080', '#ffffff'];
  const color = colors[Math.min(tier, 5)];
  g.fillStyle = '#f0e6cc';
  g.fillRect(cx - size * 0.26, cy - size * 0.3, size * 0.52, size * 0.6);
  g.fillStyle = color;
  g.beginPath(); g.ellipse(cx - size * 0.26, cy, size * 0.06, size * 0.3, 0, 0, 6.2832); g.fill();
  g.beginPath(); g.ellipse(cx + size * 0.26, cy, size * 0.06, size * 0.3, 0, 0, 6.2832); g.fill();
  if (tier >= 1) {
    g.strokeStyle = color; g.lineWidth = Math.max(1, size * 0.04);
    if (tier >= 3) { g.shadowBlur = size * 0.2; g.shadowColor = color; }
    g.beginPath();
    for (let i = -1; i <= 1; i++) {
      const y = cy + i * size * 0.15;
      g.moveTo(cx - size * 0.14, y); g.lineTo(cx + size * 0.14, y);
    }
    g.stroke(); g.shadowBlur = 0;
  }
}

/* ============ 丹药 ============ */
export function drawPill(g, size, tier) {
  const cx = size / 2, cy = size / 2, r = size * 0.26;
  const colors = ['#e0d0a0', '#a8e0c0', '#c0a0e8', '#e8c060', '#ff9a6a'];
  const c = colors[Math.min(tier, 4)];
  const grad = g.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.4, c); grad.addColorStop(1, '#806040');
  g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.fillStyle = grad; g.fill();
  if (tier >= 2) { g.shadowBlur = size * 0.25; g.shadowColor = c; g.stroke(); g.shadowBlur = 0; }
}

/* ============ 矿石 ============ */
export function drawOre(g, size, tier) {
  const cx = size / 2, cy = size / 2, r = size * 0.3;
  const cols = ['#a08060', '#c08040', '#d0d0e0', '#ffd700', '#585868', '#88d0ff', '#ffffff'];
  const c = cols[Math.min(tier, 6)];
  g.beginPath();
  g.moveTo(cx, cy - r); g.lineTo(cx + r * 0.85, cy - r * 0.2);
  g.lineTo(cx + r * 0.5, cy + r); g.lineTo(cx - r * 0.5, cy + r);
  g.lineTo(cx - r * 0.85, cy - r * 0.2);
  g.closePath();
  g.fillStyle = c; g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1; g.stroke();
  g.beginPath(); g.moveTo(cx - r * 0.4, cy - r * 0.1); g.lineTo(cx + r * 0.3, cy + r * 0.3); g.stroke();
}

/* ============ 神力图标 ============ */
export function drawPower(g, size, id) {
  const cx = size / 2, cy = size / 2, s = size * 0.34;
  const C = {
    terrain: '#d8b088', aura: '#40ffd0', life: '#8ef08e', doom: '#ff8a4a', boon: '#c090ff',
  };
  g.lineCap = 'round'; g.lineJoin = 'round';
  let col = '#8ecfff';
  const paint = (c) => { g.strokeStyle = c; g.fillStyle = c; };
  switch (id) {
    case 'raise': col = C.terrain; paint(col); g.lineWidth = size * 0.09;
      g.beginPath(); g.moveTo(cx - s, cy + s * 0.8); g.lineTo(cx, cy - s); g.lineTo(cx + s, cy + s * 0.8); g.stroke(); break;
    case 'lower': col = C.terrain; paint(col); g.lineWidth = size * 0.09;
      g.beginPath(); g.moveTo(cx - s, cy - s * 0.8); g.lineTo(cx, cy + s); g.lineTo(cx + s, cy - s * 0.8); g.stroke(); break;
    case 'ore': paint(C.terrain);
      g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx + s * 0.8, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s * 0.8, cy);
      g.closePath(); g.fill(); break;
    case 'auraAdd': paint(C.aura);
      g.lineWidth = size * 0.09;
      g.beginPath(); g.arc(cx, cy + s * 0.2, s * 0.55, 0, 6.2832); g.stroke();
      g.beginPath(); g.moveTo(cx, cy + s * 0.75); g.lineTo(cx, cy - s); g.stroke();
      g.beginPath(); g.moveTo(cx - s * 0.45, cy - s * 0.5); g.lineTo(cx, cy - s); g.lineTo(cx + s * 0.45, cy - s * 0.5); g.stroke(); break;
    case 'auraSub': paint('#7a8898');
      g.lineWidth = size * 0.09;
      g.beginPath(); g.arc(cx, cy - s * 0.2, s * 0.55, 0, 6.2832); g.stroke();
      g.beginPath(); g.moveTo(cx, cy - s * 0.75); g.lineTo(cx, cy + s); g.stroke();
      g.beginPath(); g.moveTo(cx - s * 0.45, cy + s * 0.5); g.lineTo(cx, cy + s); g.lineTo(cx + s * 0.45, cy + s * 0.5); g.stroke(); break;
    case 'demon': paint('#c050ff');
      g.beginPath(); g.arc(cx, cy, s * 0.72, 0, 6.2832); g.fill();
      g.beginPath(); g.moveTo(cx - s * 0.7, cy - s * 0.5); g.lineTo(cx - s * 0.35, cy - s * 1.0); g.lineTo(cx - s * 0.25, cy - s * 0.45); g.fill();
      g.beginPath(); g.moveTo(cx + s * 0.7, cy - s * 0.5); g.lineTo(cx + s * 0.35, cy - s * 1.0); g.lineTo(cx + s * 0.25, cy - s * 0.45); g.fill(); break;
    case 'rain': paint('#8ed8ff'); g.lineWidth = size * 0.08;
      for (let i = -1; i <= 1; i++) {
        const lx = cx + i * s * 0.55;
        g.beginPath(); g.moveTo(lx, cy - s * 0.9); g.lineTo(lx - s * 0.18, cy + s * 0.2);
        g.quadraticCurveTo(lx, cy + s * 0.5, lx + s * 0.18, cy + s * 0.2); g.closePath(); g.fill();
      } break;
    case 'cultivator': paint('#ffe680');
      g.beginPath(); g.arc(cx, cy - s * 0.5, s * 0.34, 0, 6.2832); g.fill();
      g.beginPath(); g.moveTo(cx, cy - s * 0.1); g.lineTo(cx, cy + s * 0.55); g.stroke();
      g.lineWidth = size * 0.07;
      g.beginPath(); g.moveTo(cx - s * 0.5, cy + s * 0.05); g.lineTo(cx + s * 0.5, cy + s * 0.05); g.stroke(); break;
    case 'beast': paint('#e08a30');
      g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx + s, cy + s * 0.85); g.lineTo(cx - s, cy + s * 0.85);
      g.closePath(); g.fill(); break;
    case 'plant': paint('#8ef08e'); g.lineWidth = size * 0.07;
      g.beginPath(); g.moveTo(cx, cy + s); g.lineTo(cx, cy - s * 0.3); g.stroke();
      g.beginPath(); g.ellipse(cx - s * 0.42, cy - s * 0.2, s * 0.4, s * 0.18, -0.6, 0, 6.2832); g.fill();
      g.beginPath(); g.ellipse(cx + s * 0.42, cy - s * 0.2, s * 0.4, s * 0.18, 0.6, 0, 6.2832); g.fill(); break;
    case 'thunder': paint('#dceaff');
      g.beginPath(); g.moveTo(cx + s * 0.2, cy - s); g.lineTo(cx - s * 0.55, cy + s * 0.15);
      g.lineTo(cx + s * 0.02, cy + s * 0.15); g.lineTo(cx - s * 0.25, cy + s);
      g.lineTo(cx + s * 0.6, cy - s * 0.2); g.lineTo(cx + s * 0.05, cy - s * 0.2);
      g.closePath(); g.fill(); break;
    case 'fire': paint('#ff8a3a');
      g.beginPath(); g.moveTo(cx, cy + s);
      g.quadraticCurveTo(cx - s * 1.1, cy + s * 0.1, cx - s * 0.25, cy - s * 0.55);
      g.quadraticCurveTo(cx - s * 0.1, cy - s, cx, cy - s * 1.05);
      g.quadraticCurveTo(cx + s * 0.1, cy - s, cx + s * 0.25, cy - s * 0.55);
      g.quadraticCurveTo(cx + s * 1.1, cy + s * 0.1, cx, cy + s);
      g.closePath(); g.fill(); break;
    case 'gale': paint('#a0ffd0'); g.lineWidth = size * 0.07;
      g.beginPath(); g.arc(cx, cy, s * 0.72, 0.4, 4.4); g.stroke();
      g.beginPath(); g.arc(cx, cy, s * 0.42, 1.6, 5.6); g.stroke();
      g.beginPath(); g.arc(cx, cy, s * 0.16, 2.6, 6.4); g.stroke(); break;
    case 'enlighten': paint('#ffe680');
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, r = i % 2 === 0 ? s : s * 0.42;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
      g.closePath(); g.fill(); break;
    case 'protect': paint('#ffe680'); g.lineWidth = size * 0.08;
      g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx + s * 0.75, cy - s * 0.45);
      g.lineTo(cx + s * 0.6, cy + s * 0.45); g.lineTo(cx, cy + s);
      g.lineTo(cx - s * 0.6, cy + s * 0.45); g.lineTo(cx - s * 0.75, cy - s * 0.45);
      g.closePath(); g.stroke(); break;
    case 'innerDemon': paint('#a040c0');
      g.beginPath(); g.moveTo(cx - s * 0.7, cy + s * 0.3); g.lineTo(cx - s * 0.6, cy - s * 0.85);
      g.lineTo(cx - s * 0.2, cy - s * 0.1); g.lineTo(cx + s * 0.2, cy - s * 0.1);
      g.lineTo(cx + s * 0.6, cy - s * 0.85); g.lineTo(cx + s * 0.7, cy + s * 0.3);
      g.closePath(); g.fill();
      g.beginPath(); g.arc(cx, cy + s * 0.5, s * 0.32, 0, 6.2832); g.fill(); break;
    case 'bestow': col = '#ffd700'; paint(col); g.lineWidth = size * 0.08;
      g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx, cy + s * 0.2); g.stroke();
      g.beginPath(); g.moveTo(cx - s * 0.5, cy + s * 0.2); g.lineTo(cx + s * 0.5, cy + s * 0.2); g.stroke();
      g.beginPath(); g.moveTo(cx, cy + s * 0.2); g.lineTo(cx, cy + s * 0.95); g.stroke(); break;
    case 'teach': col = '#c060ff'; paint(col); g.lineWidth = size * 0.07;
      g.beginPath(); g.arc(cx, cy, s * 0.78, 0, 6.2832); g.stroke();
      g.beginPath(); g.moveTo(cx - s * 0.4, cy - s * 0.4); g.lineTo(cx + s * 0.4, cy + s * 0.4); g.stroke();
      g.beginPath(); g.moveTo(cx + s * 0.4, cy - s * 0.4); g.lineTo(cx - s * 0.4, cy + s * 0.4); g.stroke(); break;
    case 'reincarnate': col = '#8ecfff'; paint(col); g.lineWidth = size * 0.08;
      g.beginPath(); g.arc(cx, cy, s * 0.7, 0.6, 5.2); g.stroke();
      g.beginPath(); g.moveTo(cx + s * 0.55, cy - s * 0.55); g.lineTo(cx + s * 0.95, cy - s * 0.15);
      g.lineTo(cx + s * 0.35, cy - s * 0.05); g.closePath(); g.fill(); break;
    default: paint('#8ecfff');
      g.beginPath(); g.arc(cx, cy, s * 0.8, 0, 6.2832); g.stroke();
  }
}

/* ============ 视图模式图标 ============ */
export function drawViewTag(g, size, mode) {
  const cx = size / 2, cy = size / 2, s = size * 0.3;
  g.lineCap = 'round';
  const paint = (c) => { g.strokeStyle = c; g.fillStyle = c; g.lineWidth = size * 0.085; };
  if (mode === 'terrain') {
    paint('#8bc34a');
    g.beginPath(); g.moveTo(cx - s, cy + s * 0.6); g.lineTo(cx - s * 0.2, cy - s * 0.6);
    g.lineTo(cx + s * 0.25, cy + s * 0.1); g.lineTo(cx + s, cy - s * 0.7);
    g.lineTo(cx + s, cy + s * 0.6); g.closePath(); g.fill();
  } else if (mode === 'aura') {
    paint('#40ffd0');
    for (let i = 0; i < 3; i++) {
      g.globalAlpha = 1 - i * 0.28;
      g.beginPath(); g.arc(cx, cy, s * (0.3 + i * 0.35), 0, 6.2832); g.stroke();
    }
    g.globalAlpha = 1;
  } else if (mode === 'demon') {
    paint('#c050ff');
    g.beginPath(); g.arc(cx, cy, s * 0.72, 0, 6.2832); g.fill();
  } else if (mode === 'politics') {
    // 旗帜：代表势力山门
    paint('#8ecfff');
    g.lineWidth = size * 0.085;
    g.beginPath(); g.moveTo(cx - s * 0.55, cy + s); g.lineTo(cx - s * 0.55, cy - s); g.stroke();
    g.beginPath();
    g.moveTo(cx - s * 0.55, cy - s * 0.95);
    g.lineTo(cx + s * 0.95, cy - s * 0.5);
    g.lineTo(cx - s * 0.55, cy - s * 0.05);
    g.closePath(); g.fill();
  } else {
    // 矿脉：菱形 + 高光
    paint('#ffc850');
    g.beginPath();
    g.moveTo(cx, cy - s); g.lineTo(cx + s * 0.85, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s * 0.85, cy);
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.moveTo(cx, cy - s * 0.55); g.lineTo(cx + s * 0.3, cy - s * 0.05); g.lineTo(cx - s * 0.5, cy - s * 0.1);
    g.closePath(); g.fill();
  }
}
