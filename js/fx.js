/**
 * fx.js —— 粒子、光效、天劫雷电、全屏闪光
 * 全部由代码生成，不依赖任何图片资源。
 */
import { clamp } from './util.js';
import { U_TYPE } from './units.js';

const MAX_P = 520;

export class FX {
  constructor(ctx) {
    this.ctx = ctx;
    this.parts = [];
    this.pool = [];
    this.bolts = [];
    this.rings = [];
    this.texts = [];
    this.flash = null;
    this.tribs = [];
    this.rains = [];
    this.time = 0;
  }

  _p() {
    return this.pool.pop() || { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, c: '#fff', s: 2, g: 0, add: 1 };
  }

  emit(x, y, n, opt) {
    if (this.parts.length > MAX_P) n = Math.min(n, 4);
    for (let i = 0; i < n; i++) {
      const p = this._p();
      p.x = x; p.y = y;
      const a = Math.random() * 6.2832, sp = (opt.sp || 6) * (0.4 + Math.random() * 0.9);
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
      p.max = p.life = (opt.life || 0.6) * (0.6 + Math.random() * 0.8);
      p.c = Array.isArray(opt.c) ? opt.c[(Math.random() * opt.c.length) | 0] : (opt.c || '#fff');
      p.s = (opt.s || 2) * (0.6 + Math.random() * 0.9);
      p.g = opt.g || 0;
      p.add = opt.add == null ? 1 : opt.add;
      this.parts.push(p);
    }
  }

  ring(x, y, c, r0, r1, life) {
    this.rings.push({ x, y, c, r0, r1, t: 0, life: life || 0.7 });
  }

  text(x, y, str, c) {
    this.texts.push({ x, y, s: str, c: c || '#fff', t: 0, life: 1.6 });
  }

  bolt(x1, y1, x2, y2, c) {
    this.bolts.push({ x1, y1, x2, y2, c: c || '#cfe6ff', t: 0, life: 0.34, seed: Math.random() * 999 });
  }

  /** 刀光：斗法时一闪而过的直线光，混战时满屏交错 */
  slash(x1, y1, x2, y2, c) {
    if (this.bolts.length > 120) return;
    this.bolts.push({ x1, y1, x2, y2, c: c || '#fff3c0', t: 0, life: 0.30, seed: Math.random() * 999, thin: 1 });
  }

  doFlash(color, a) {
    // 冷却：闪光未过半时不重复触发，避免连续落雷把屏幕闪成频闪灯
    if (this.flash && this.flash.t < this.flash.life * 0.6) return;
    this.flash = { c: color || '#ffffff', a: a || 0.5, t: 0, life: 0.30 };
  }

  /* ---------- 事件入口 ---------- */
  hit(x, y, c) { this.emit(x, y, 6, { c: [c, '#ffe9a0'], sp: 7, life: 0.42, s: 1.7 }); }

  death(u) {
    const c = u.type === U_TYPE.BEAST ? '#ff9060' : (u.isDemon ? '#ff5050' : '#d8c8ff');
    this.emit(u.x, u.y, u.realm >= 3 ? 22 : 12, { c: [c, '#ffffff'], sp: 8, life: 0.9, s: 2.1 });
    if (u.realm >= 3) { this.ring(u.x, u.y, c, 1, 7, 0.9); this.doFlash('#ffffff', 0.04); }
  }

  breakthrough(u, big) {
    const c = u.isDemon ? '#ff6060' : '#ffd24a';
    this.ring(u.x, u.y, c, 1, big ? 12 : 7, 1.1);
    this.ring(u.x, u.y, '#ffffff', 1, big ? 8 : 5, 0.8);
    this.emit(u.x, u.y, big ? 30 : 16, { c: [c, '#fff8d0', '#ffffff'], sp: 9, life: 1.2, s: 2.4, g: -2 });
    this.text(u.x, u.y - 2, u.realm >= 3 ? '突破！' : '+', c);
  }

  tribStart(u) { this.tribs.push({ id: u.id, t: 0, next: 0.2 }); }

  tribStrike(u) {
    const sx = u.x + (Math.random() - 0.5) * 1.2, sy = u.y;
    this.bolt(sx, sy - 14, sx, sy, '#dceaff');
    this.emit(sx, sy, 16, { c: ['#dceaff', '#9fd0ff', '#ffffff'], sp: 10, life: 0.6, s: 2.1 });
    // 用"落点处的光斑"代替全屏闪白 —— 有照亮感，但不闪整个屏幕
    this.ring(sx, sy, 'rgba(220,235,255,0.9)', 0.6, 7, 0.42);
    this.doFlash('#dce8ff', 0.04);
  }

  tribFail(u) {
    this.emit(u.x, u.y, 26, { c: ['#804060', '#c06080', '#503050'], sp: 7, life: 1.3, s: 2.6 });
    this.doFlash('#6a1030', 0.09);
  }

  ascend(x, y) {
    this.ring(x, y, '#ffe680', 1, 16, 1.6);
    this.ring(x, y, '#ffffff', 1, 11, 1.2);
    this.emit(x, y, 40, { c: ['#ffe680', '#fff8d0', '#ffffff', '#a0e8ff'], sp: 11, life: 1.8, s: 2.8, g: -4 });
    this.doFlash('#fff8d0', 0.14);   // 飞升是稀有事，留一点仪式感
  }

  sectFound(x, y, c) {
    this.ring(x, y, c, 1, 9, 1.2);
    this.emit(x, y, 18, { c: [c, '#ffffff'], sp: 6, life: 1.1, s: 2.2, g: -1.5 });
  }

  rain(cx, cy, r) {
    this.rains.push({ x: cx, y: cy, r, t: 0, life: 5 });
    this.emit(cx, cy, 18, { c: ['#a0e8ff', '#d0f4ff'], sp: 5, life: 1.4, s: 1.8, g: 3 });
  }

  demonize(cx, cy, r) {
    this.emit(cx, cy, 30, { c: ['#a020c0', '#601080', '#d060ff'], sp: 7, life: 1.6, s: 2.6, g: -0.5 });
    this.ring(cx, cy, '#a020c0', 1, r, 1.2);
  }

  terrainPuff(x, y, c, n) { this.emit(x, y, n || 12, { c: [c, '#d8d0c0'], sp: 5, life: 0.9, s: 2.4 }); }

  strikeZone(x, y, r, c) {
    this.ring(x, y, c, 1, r, 0.9);
    this.emit(x, y, 24, { c: [c, '#ffffff'], sp: r * 0.5, life: 1.0, s: 2.4 });
    this.doFlash(c, 0.2);
  }

  /* ---------- 更新 ---------- */
  update(dt) {
    this.time += dt;
    const P = this.parts;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life -= dt;
      if (p.life <= 0) { this.pool.push(p); P.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += p.g * dt;
      p.vx *= 0.985; p.vy *= 0.985;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt;
      if (r.t >= r.life) this.rings.splice(i, 1);
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]; b.t += dt;
      if (b.t >= b.life) this.bolts.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]; t.t += dt;
      if (t.t >= t.life) this.texts.splice(i, 1);
    }
    for (let i = this.rains.length - 1; i >= 0; i--) {
      const r = this.rains[i]; r.t += dt;
      if (r.t >= r.life) this.rains.splice(i, 1);
    }
    // 渡劫持续雷击
    for (let i = this.tribs.length - 1; i >= 0; i--) {
      const tr = this.tribs[i];
      const u = this.ctx.units.byId.get(tr.id);
      if (!u || !u.alive || u.state !== 'trib') { this.tribs.splice(i, 1); continue; }
      tr.t += dt; tr.next -= dt;
      if (tr.next <= 0) {
        tr.next = 0.35 + Math.random() * 0.5;
        this.tribStrike(u);
      }
    }
    if (this.flash) { this.flash.t += dt; if (this.flash.t >= this.flash.life) this.flash = null; }
  }

  /* ---------- 绘制 ---------- */
  draw(g, R) {
    const z = R.cam.zoom;
    g.save();
    g.globalCompositeOperation = 'lighter';

    // 粒子
    for (const p of this.parts) {
      const a = clamp(p.life / p.max, 0, 1);
      const s = R.w2s(p.x, p.y);
      g.globalAlpha = a;
      g.fillStyle = p.c;
      const r = Math.max(0.6, p.s * Math.min(z, 4) * 0.55) * a;
      g.beginPath(); g.arc(s.x, s.y, r, 0, 6.2832); g.fill();
    }
    g.globalAlpha = 1;

    // 冲击环
    for (const r of this.rings) {
      const t = r.t / r.life;
      const rad = (r.r0 + (r.r1 - r.r0) * t) * z;
      const s = R.w2s(r.x, r.y);
      g.globalAlpha = (1 - t) * 0.8;
      g.strokeStyle = r.c;
      g.lineWidth = Math.max(1, 2.4 * (1 - t) * Math.min(z, 3));
      g.beginPath(); g.arc(s.x, s.y, rad, 0, 6.2832); g.stroke();
    }
    g.globalAlpha = 1;

    // 灵雨
    for (const rr of this.rains) {
      const t = rr.t / rr.life;
      const a = (1 - t) * 0.5;
      const s = R.w2s(rr.x, rr.y);
      const rad = rr.r * z;
      g.globalAlpha = a;
      g.fillStyle = 'rgba(160,232,255,0.25)';
      g.beginPath(); g.arc(s.x, s.y, rad, 0, 6.2832); g.fill();
      // 雨丝
      g.strokeStyle = 'rgba(200,240,255,0.8)';
      g.lineWidth = 1;
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * 6.2832 + this.time * 1.5;
        const px = rr.x + Math.cos(ang) * rr.r * 0.8, py = rr.y + Math.sin(ang) * rr.r * 0.8;
        const sp = R.w2s(px, py);
        g.globalAlpha = a * 0.7;
        g.beginPath(); g.moveTo(sp.x, sp.y); g.lineTo(sp.x, sp.y + 6 * Math.min(z, 3)); g.stroke();
      }
      g.globalAlpha = 1;
    }

    // 雷电 / 刀光
    for (const b of this.bolts) {
      const t = b.t / b.life;
      const a = 1 - t;
      const s1 = R.w2s(b.x1, b.y1), s2 = R.w2s(b.x2, b.y2);
      g.strokeStyle = b.c;
      if (b.thin) {
        // 刀光：细、直、快，混战时交错成网
        g.globalAlpha = a * 0.9;
        g.lineWidth = 2.0 * a + 0.5;
        g.beginPath(); g.moveTo(s1.x, s1.y); g.lineTo(s2.x, s2.y); g.stroke();
        g.globalAlpha = a * 0.3;
        g.lineWidth = 4.5 * a;
        g.stroke();
        continue;
      }
      g.globalAlpha = a * 0.95;
      g.lineWidth = 2.2 * a + 0.6;
      g.beginPath();
      g.moveTo(s1.x, s1.y);
      const seg = 6;
      for (let k = 1; k < seg; k++) {
        const tt = k / seg;
        const nx = s1.x + (s2.x - s1.x) * tt + Math.sin(b.seed + k * 2.7) * 9 * (1 - tt);
        const ny = s1.y + (s2.y - s1.y) * tt;
        g.lineTo(nx, ny);
      }
      g.lineTo(s2.x, s2.y);
      g.stroke();
      g.globalAlpha = a * 0.35;
      g.lineWidth = 5 * a;
      g.stroke();
    }
    g.globalAlpha = 1;

    // 飘字
    g.globalCompositeOperation = 'source-over';
    g.textAlign = 'center';
    for (const t of this.texts) {
      const k = t.t / t.life;
      const s = R.w2s(t.x, t.y - k * 3);
      g.globalAlpha = 1 - k * k;
      g.font = 'bold ' + clamp(11 * Math.min(z / 3, 1.4), 10, 18) + 'px system-ui,sans-serif';
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillText(t.s, s.x + 1, s.y + 1);
      g.fillStyle = t.c;
      g.fillText(t.s, s.x, s.y);
    }
    g.globalAlpha = 1;
    g.restore();

    // 全屏闪光
    if (this.flash) {
      const k = 1 - this.flash.t / this.flash.life;
      g.globalAlpha = this.flash.a * k * k;
      g.fillStyle = this.flash.c;
      g.fillRect(0, 0, R.cw, R.ch);
      g.globalAlpha = 1;
    }
  }

  clear() { this.parts.length = 0; this.rings.length = 0; this.bolts.length = 0; this.texts.length = 0; this.rains.length = 0; }
}
