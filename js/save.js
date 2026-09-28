/**
 * save.js —— localStorage 自动存档 + JSON 导出/导入
 */
const KEY = 'xiuxian_worldbox_save_v1';

function bytesToB64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
/** 浮点标量场压缩成字节（0-100 → 0-255） */
function packFloat(arr) {
  const n = arr.length;
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = Math.max(0, Math.min(255, Math.round(arr[i] * 2.55)));
  return bytesToB64(u);
}
function unpackFloat(b64, n) {
  const u = b64ToBytes(b64);
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = u[i] / 2.55;
  return f;
}
function packU8(arr) { return bytesToB64(new Uint8Array(arr.buffer, arr.byteOffset, arr.length)); }
function unpackU8(b64, n) { return new Uint8Array(b64ToBytes(b64).buffer, 0, n); }

export class Save {
  constructor(ctx) {
    this.ctx = ctx;
    this.timer = 0;
    this.auto = true;
    this.lastSave = 0;
  }

  update(dt) {
    if (!this.auto) return;
    this.timer += dt;
    if (this.timer > 45) { this.timer = 0; this.save(true); }
  }

  serialize() {
    const ctx = this.ctx, w = ctx.world;
    const units = ctx.units.list.filter(u => u.alive).map(u => ({
      i: u.id, t: u.type, x: +u.x.toFixed(2), y: +u.y.toFixed(2),
      r: u.realm, s: u.stage, k: Math.round(u.cult), o: u.root, e: u.elem,
      h: Math.round(u.hp), H: Math.round(u.maxHp), a: Math.round(u.age), d: Math.round(u.daoHeart),
      D: u.isDemon ? 1 : 0, g: u.sectId, st: Math.round(u.stones), c: u.tech || 0,
      n: u.name, f: u.flags || 0, bt: u.beastTier || 0, pt: u.plantTier || 0,
      wd: u.woods || 0, ks: u.kills || 0,
      gr: u.grow ? +u.grow.toFixed(2) : 0, m: u.mature ? 1 : 0,
      A: (u.arts || []).map(a => [a.tier, a.kind]),
    }));
    const sects = ctx.sects.list.map(s => ({
      i: s.id, n: s.name, c: s.color, d: s.demonic ? 1 : 0, l: s.level,
      L: s.leaderId, M: s.members, X: s.cx, Y: s.cy, R: s.radius || 13,
      A: s.area || 0, MR: s.maxR || 24,
      F: Math.round(s.founded), st: Math.round(s.res.stones), S: s.sites,
      E: [...s.enemies],
    }));
    // 动态资源点（生成的）
    const sites = w.sites.map(s => [s.id, s.type, s.x, s.y, +s.r.toFixed(1), s.tier, s.owner, s.ownerUnit]);
    return {
      v: 1, seed: w.seed, W: w.W, H: w.H, year: Math.round(w.year),
      data: {
        height: packU8(w.height), temp: packU8(w.temp), moist: packU8(w.moist),
        aura: packFloat(w.aura), auraBase: packFloat(w.auraBase), demon: packFloat(w.demon),
        biome: packU8(w.biome), ley: packU8(w.ley), flag: packU8(w.flag),
        resType: packU8(w.resType), resId: packU8(new Uint8Array(w.resId.buffer, w.resId.byteOffset, w.resId.length)),
      },
      sites, units, sects,
      events: ctx.events.list.slice(-90),
      stats: ctx.stats,
      cam: { x: this.ctx.renderer.cam.x, y: this.ctx.renderer.cam.y, z: this.ctx.renderer.cam.zoom },
    };
  }

  deserialize(d) {
    const ctx = this.ctx, w = ctx.world;
    const N = w.N;
    const dd = d.data;
    w.height.set(unpackU8(dd.height, N));
    w.temp.set(unpackU8(dd.temp, N));
    w.moist.set(unpackU8(dd.moist, N));
    w.aura.set(unpackFloat(dd.aura, N));
    w.auraBase.set(unpackFloat(dd.auraBase, N));
    w.demon.set(unpackFloat(dd.demon, N));
    w.biome.set(unpackU8(dd.biome, N));
    w.ley.set(unpackU8(dd.ley, N));
    w.flag.set(unpackU8(dd.flag, N));
    w.resType.set(unpackU8(dd.resType, N));
    const rid = unpackU8(dd.resId, N * 2);
    w.resId.set(new Int16Array(rid.buffer, 0, N));
    w.year = d.year || 0;
    // 资源点
    w.sites = (d.sites || []).map(a => ({
      id: a[0], type: a[1], x: a[2], y: a[3], r: a[4], tier: a[5], owner: a[6], ownerUnit: a[7],
      reserve: 100, depleted: 0, yieldAcc: 0,
    }));
    w.wonders = w.wonders || [];
    // 单位
    ctx.units.list = [];
    ctx.units.byId.clear();
    let maxId = 1;
    for (const a of d.units || []) {
      const u = {
        id: a.i, type: a.t, alive: true, x: a.x, y: a.y, hx: a.x, hy: a.y,
        realm: a.r, stage: a.s, cult: a.k, root: a.o, elem: a.e,
        hp: a.h, maxHp: a.H, age: a.a, daoHeart: a.d, life: 120,
        isDemon: !!a.D, path: a.D ? 1 : 0, sectId: a.g,
        state: 'idle', stateT: 0, decideT: 0, atkCd: 0, target: -1, trib: null,
        stones: a.st, herbs: {}, ores: {}, pills: {}, arts: (a.A || []).map(x => ({ tier: x[0], kind: x[1] })),
        tech: a.c, pillBuff: null, flags: a.f, wanderT: 0,
        name: a.n, title: '', ccolor: '#d8d8dc', lastAura: -1, mateCd: 0,
        grow: a.gr, mature: !!a.m, beastTier: a.bt || 1, plantTier: a.pt || 0,
        woods: a.wd || 0, kills: a.ks || 0,
      };
      if (u.type === 0) { u.life = [120, 200, 500, 1000, 2000, 5000, 10000, 30000][u.realm] || 120; }
      ctx.units._setRealm(u, u.realm, u.stage);
      u.maxHp = a.H; u.hp = a.h;
      ctx.units.list.push(u);
      ctx.units.byId.set(u.id, u);
      maxId = Math.max(maxId, u.id);
    }
    ctx.units.nextId = maxId + 1;
    // 宗门
    ctx.sects.list = [];
    ctx.sects.byId.clear();
    let msId = 1;
    for (const a of d.sects || []) {
      const s = {
        id: a.i, name: a.n, color: a.c, demonic: !!a.d, level: a.l, leaderId: a.L,
        members: a.M, cx: a.X, cy: a.Y, radius: a.R || 13, maxR: a.MR || 24,
        area: a.A || 0, frontier: [], founded: a.F,
        res: { stones: a.st, herbs: 0, ores: 0 }, sites: a.S,
        enemies: new Set(a.E || []), allies: new Set(), war: null, power: 0,
        leaderName: (ctx.units.byId.get(a.L) || {}).name || '',
      };
      ctx.sects.list.push(s);
      ctx.sects.byId.set(s.id, s);
      msId = Math.max(msId, s.id);
    }
    ctx.sects.nextId = msId + 1;
    ctx.sects.rebuildAllTerritory();
    ctx.events.list = d.events || [];
    ctx.stats = Object.assign(ctx.stats, d.stats || {});
    if (d.cam) { ctx.renderer.cam.x = d.cam.x; ctx.renderer.cam.y = d.cam.y; ctx.renderer.cam.zoom = d.cam.z || 3; }
    w.markAllDirty();
    ctx.renderer.ovDirty = true;
  }

  save(silent) {
    try {
      const data = this.serialize();
      localStorage.setItem(KEY, JSON.stringify(data));
      this.lastSave = Date.now();
      if (!silent) this.ctx.ui.toast('已存档（' + (JSON.stringify(data).length / 1024).toFixed(0) + ' KB）');
      return true;
    } catch (e) {
      if (!silent) this.ctx.ui.toast('存档失败：' + e.message);
      return false;
    }
  }

  has() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) { this.ctx.ui.toast('没有找到存档'); return false; }
      const d = JSON.parse(raw);
      if (d.W !== this.ctx.world.W || d.H !== this.ctx.world.H) {
        this.ctx.ui.toast('存档尺寸与当前世界不符，已忽略');
        return false;
      }
      this.deserialize(d);
      this.ctx.ui.toast('读档完成（第 ' + d.year + ' 年）');
      return true;
    } catch (e) {
      this.ctx.ui.toast('读档失败：' + e.message);
      return false;
    }
  }

  clear() { try { localStorage.removeItem(KEY); } catch (e) {} }

  exportFile() {
    const data = this.serialize();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '太虚演天_第' + Math.round(this.ctx.world.year) + '年.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
}
