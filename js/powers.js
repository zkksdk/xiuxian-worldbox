/**
 * powers.js —— 神力系统：事件驱动的玩家干预笔刷
 */
import { CFG, REALMS, ARTIFACT_TIERS, TECH_TIERS, ORES, HERBS } from './config.js';
import { clamp, dist } from './util.js';
import { U_TYPE } from './units.js';
import { RES_TYPE } from './config.js';

export const POWER_LIST = [
  { id: 'raise',  cat: '地形', name: '造山',     desc: '隆起大地，山峦自生', cost: 3,   kind: 'brush', r: 6 },
  { id: 'lower',  cat: '地形', name: '沉降',     desc: '压低地势，可成湖海', cost: 3,   kind: 'brush', r: 6 },
  { id: 'ore',    cat: '地形', name: '点石成金', desc: '地层生矿，化作矿脉', cost: 8,   kind: 'brush', r: 4 },
  { id: 'auraAdd',cat: '灵气', name: '注灵',     desc: '提升区域灵气浓度',   cost: 4,   kind: 'brush', r: 7 },
  { id: 'auraSub',cat: '灵气', name: '抽灵',     desc: '抽走区域灵气',       cost: 3,   kind: 'brush', r: 7 },
  { id: 'demon',  cat: '灵气', name: '魔染',     desc: '魔气侵蚀，催生魔修', cost: 6,   kind: 'brush', r: 6 },
  { id: 'rain',   cat: '灵气', name: '灵雨',     desc: '灵雨降世，修炼提速', cost: 10,  kind: 'brush', r: 10 },
  { id: 'cultivator', cat: '生灵', name: '播撒修士', desc: '点化凡人，踏上仙途', cost: 5, kind: 'point' },
  { id: 'beast',  cat: '生灵', name: '播撒妖兽', desc: '凶兽降世，为祸一方', cost: 5,   kind: 'point' },
  { id: 'plant',  cat: '生灵', name: '播种灵植', desc: '种下灵草，天地生财', cost: 3,   kind: 'brush', r: 4 },
  { id: 'thunder',cat: '天罚', name: '雷劫',     desc: '九霄神雷，范围重创', cost: 14,  kind: 'brush', r: 6 },
  { id: 'fire',   cat: '天罚', name: '焚天火劫', desc: '烈焰焚世，万物成灰', cost: 14,  kind: 'brush', r: 6 },
  { id: 'gale',   cat: '天罚', name: '九幽风劫', desc: '罡风撕裂，寸草不生', cost: 14,  kind: 'brush', r: 7 },
  { id: 'enlighten', cat: '点化', name: '点化', desc: '直接提升一个小境界', cost: 25, kind: 'target' },
  { id: 'protect', cat: '点化', name: '护道', desc: '护其渡劫，成功率+30%', cost: 12, kind: 'target' },
  { id: 'innerDemon', cat: '点化', name: '心魔', desc: '降下心魔，渡劫-50%', cost: 10, kind: 'target' },
  { id: 'bestow', cat: '点化', name: '赐宝', desc: '赐予一件法宝', cost: 16, kind: 'target' },
  { id: 'teach',  cat: '点化', name: '传功', desc: '传授高深功法', cost: 20, kind: 'target' },
  { id: 'reincarnate', cat: '点化', name: '轮回', desc: '重塑道基，保留悟性', cost: 18, kind: 'target' },
];

export class Powers {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = POWER_LIST;
    this.byId = {};
    for (const p of POWER_LIST) this.byId[p.id] = p;
    this.active = null;
    this.brushR = 6;
    this.strength = 1;
    this.mana = CFG.god.powerMax;
    this.manaMax = CFG.god.powerMax;
    this.lastUse = 0;
    this.cooldown = 0;
    this.history = 0;
  }

  select(id) {
    this.active = (this.active === id) ? null : id;
    const p = this.byId[id];
    if (p && p.r) this.brushR = p.r;
    return this.active;
  }

  get activePower() { return this.active ? this.byId[this.active] : null; }

  update(dt) {
    if (this.mana < this.manaMax) this.mana = Math.min(this.manaMax, this.mana + CFG.god.powerRegen * dt);
    if (this.cooldown > 0) this.cooldown -= dt;
  }

  canUse(p) { return this.mana >= p.cost && this.cooldown <= 0; }

  /** 在世界坐标使用神力 */
  use(wx, wy, targetUnit) {
    const p = this.activePower;
    if (!p) return { ok: false, msg: '未选择神力' };
    if (!this.canUse(p)) return { ok: false, msg: this.cooldown > 0 ? '神力冷却中' : '天道之力不足' };
    const w = this.ctx.world;
    let ok = true, msg = '';
    switch (p.id) {
      case 'raise': this._shape(wx, wy, +0.085); break;
      case 'lower': this._shape(wx, wy, -0.085); break;
      case 'ore': ok = this._ore(wx, wy); break;
      case 'auraAdd': w.addAura(wx, wy, this.brushR, 13 * this.strength); this.ctx.fx.ring(wx, wy, '#40ffd0', 1, this.brushR, 0.7); break;
      case 'auraSub': w.addAura(wx, wy, this.brushR, -13 * this.strength); this.ctx.fx.ring(wx, wy, '#506070', 1, this.brushR, 0.7); break;
      case 'demon': w.addDemon(wx, wy, this.brushR, 15 * this.strength); this.ctx.fx.demonize(wx, wy, this.brushR); w.reclassify(wx, wy, this.brushR + 1); break;
      case 'rain': this._rain(wx, wy); break;
      case 'cultivator': ok = this._spawn(U_TYPE.CULTIVATOR, wx, wy); break;
      case 'beast': ok = this._spawn(U_TYPE.BEAST, wx, wy); break;
      case 'plant': ok = this._plant(wx, wy); break;
      case 'thunder': this._disaster(wx, wy, '#cfe6ff', '雷劫'); break;
      case 'fire': this._disaster(wx, wy, '#ff8a3a', '火劫'); break;
      case 'gale': this._disaster(wx, wy, '#a0ffd0', '风劫'); break;
      case 'enlighten': case 'protect': case 'innerDemon': case 'bestow': case 'teach': case 'reincarnate': {
        const rr = this._target(p.id, targetUnit);
        ok = rr === true;
        if (rr && rr.msg) msg = rr.msg;
        break;
      }
      default: ok = false; msg = '未知神力';
    }
    if (ok) {
      this.mana -= p.cost;
      this.cooldown = 0.12;
      this.history++;
    }
    return { ok, msg };
  }

  _shape(wx, wy, dir) {
    const w = this.ctx.world;
    const r = this.brushR;
    w.shapeTerrain(wx, wy, r, dir * this.strength);
    // 造山消耗灵气 / 造湖带来水汽
    this.ctx.fx.terrainPuff(wx, wy, dir > 0 ? '#b09878' : '#5878a8', 14);
  }

  _ore(wx, wy) {
    const w = this.ctx.world;
    const gx = clamp(Math.floor(wx), 2, w.W - 3), gy = clamp(Math.floor(wy), 2, w.H - 3);
    if (w.isWater(gx, gy)) return false;
    const h = w.height[w.idx(gx, gy)] / 255;
    const tier = h > 0.8 ? 3 : h > 0.68 ? 2 : h > 0.55 ? 1 : 0;
    const s = w._addSite(RES_TYPE.ORESITE, gx, gy, this.brushR * 0.6, tier);
    this.ctx.fx.emit(gx, gy, 20, { c: [ORES[tier].c, '#ffffff'], sp: 6, life: 1.0, s: 2.2 });
    this.ctx.fx.ring(gx, gy, ORES[tier].c, 1, this.brushR, 0.8);
    this.ctx.events.add('divine', '矿脉自地底涌出：' + ORES[tier].n + ' 现世');
    return true;
  }

  _rain(wx, wy) {
    const w = this.ctx.world;
    const r = this.brushR;
    w.addAura(wx, wy, r, 22 * this.strength, false);
    this.ctx.fx.rain(wx, wy, r);
    w.growDecor(wx, wy, r * 0.85, 0.22);   // 枯木逢春
    // 灵植加速生长
    for (const u of this.ctx.units.list) {
      if (u.type === U_TYPE.PLANT && u.alive && dist(u.x, u.y, wx, wy) < r + 3) u.grow += 0.25;
    }
  }

  _spawn(type, wx, wy) {
    const gx = clamp(Math.floor(wx), 1, this.ctx.world.W - 2), gy = clamp(Math.floor(wy), 1, this.ctx.world.H - 2);
    const rng = this.ctx.rng;
    if (type === U_TYPE.CULTIVATOR) {
      const realm = rng.chance(0.62) ? 0 : (rng.chance(0.7) ? 1 : (rng.chance(0.6) ? 2 : 3));
      const u = this.ctx.units.spawn(U_TYPE.CULTIVATOR, gx, gy, { realm, stage: rng.int(0, 3) });
      if (!u) return false;
      this.ctx.fx.breakthrough(u, false);
      this.ctx.events.add('divine', '天道垂青，' + u.name + ' 自凡尘中踏上修行之路');
      return true;
    }
    if (type === U_TYPE.BEAST) {
      const tier = rng.chance(0.45) ? 1 : (rng.chance(0.6) ? 2 : (rng.chance(0.55) ? 3 : rng.int(4, 5)));
      const u = this.ctx.units.spawn(U_TYPE.BEAST, gx, gy, { tier });
      if (!u) return false;
      this.ctx.fx.emit(gx, gy, 14, { c: ['#e08a30', '#b85050'], sp: 6, life: 1.0, s: 2.2 });
      this.ctx.events.add('disaster', '⚠ ' + u.name + ' 现世，为祸一方');
      return true;
    }
    return false;
  }

  _plant(wx, wy) {
    const r = this.brushR;
    let n = 0;
    for (let k = 0; k < 5; k++) {
      const a = this.ctx.rng.range(0, 6.2832), d = Math.sqrt(this.ctx.rng.next()) * r;
      const x = Math.floor(wx + Math.cos(a) * d), y = Math.floor(wy + Math.sin(a) * d);
      if (!this.ctx.world.passable(x, y)) continue;
      const tier = clamp(Math.floor(this.ctx.world.auraAt(x, y) / 22), 0, 5);
      const u = this.ctx.units.spawn(U_TYPE.PLANT, x, y, { tier });
      if (u) n++;
    }
    if (n) this.ctx.fx.terrainPuff(wx, wy, '#8ef08e', 12);
    return n > 0;
  }

  _disaster(wx, wy, color, name) {
    const w = this.ctx.world;
    const r = this.brushR;
    this.ctx.fx.strikeZone(wx, wy, r * 1.6, color);
    if (name === '雷劫') this.ctx.fx.bolt(wx, wy - 16, wx, wy, '#e8f4ff');
    let killed = 0;
    for (const u of this.ctx.units.list) {
      if (!u.alive || u.type === U_TYPE.PLANT) continue;
      if (dist(u.x, u.y, wx, wy) > r * 1.5) continue;
      const dmg = u.maxHp * (0.30 + 0.45 * this.ctx.rng.next()) * this.strength;
      u.hp -= dmg;
      if (u.hp <= 0) { this.ctx.units.kill(u, '遭天道' + name + '轰杀'); killed++; }
    }
    let burned = 0;
    if (name === '火劫') {
      // 火劫烧毁草木与灵植、降低灵气
      w.addAura(wx, wy, r, -6);
      burned = w.burnDecor(wx, wy, r * 1.25, 0.8);
    } else if (name === '风劫') {
      w.addAura(wx, wy, r, -4);
      burned = w.burnDecor(wx, wy, r * 1.35, 0.5);
    } else if (name === '雷劫') {
      burned = w.burnDecor(wx, wy, r * 0.9, 0.35);
    }
    const where = this.ctx.sects ? this.ctx.sects.placeName(wx, wy) : '某地';
    this.ctx.events.add('disaster', '⚡ 天道降下' + name + '，' + where + '一片狼藉' +
      (killed ? '，' + killed + ' 名修士陨落' : '') + (burned ? '，焚毁草木 ' + burned + ' 株' : ''));
  }

  _target(id, u) {
    if (!u || !u.alive) return { ok: false, msg: '需点击一个目标' };
    const units = this.ctx.units;
    switch (id) {
      case 'enlighten':
        if (!units.boostRealm(u)) return { ok: false, msg: '已至大乘圆满' };
        this.ctx.fx.breakthrough(u, true);
        this.ctx.events.add('divine', '✦ 天道点化，' + u.name + ' 一步登天，晋升 ' + units.realmName(u));
        return true;
      case 'protect':
        u.flags |= 4; u.flags &= ~8;
        this.ctx.fx.ring(u.x, u.y, '#ffe680', 1, 6, 1.0);
        this.ctx.events.add('divine', '✦ 天道护道，' + u.name + ' 气运加身');
        return true;
      case 'innerDemon':
        u.flags |= 8; u.flags &= ~4;
        u.daoHeart = clamp(u.daoHeart - 18, 0, 100);
        this.ctx.fx.emit(u.x, u.y, 16, { c: ['#a020c0', '#401060'], sp: 5, life: 1.2, s: 2.2 });
        this.ctx.events.add('disaster', '☠ 天道降下心魔，' + u.name + ' 道心蒙尘');
        return true;
      case 'bestow': {
        const tier = clamp(1 + Math.floor(u.realm * 0.7), 0, 5);
        u.arts.push({ tier, kind: this.ctx.rng.int(0, 3) });
        units._setRealm(u, u.realm, u.stage);
        this.ctx.fx.ring(u.x, u.y, '#ffe680', 1, 5, 0.9);
        this.ctx.events.add('divine', '✦ 天赐「' + ARTIFACT_TIERS[tier].n + '」于 ' + u.name);
        return true;
      }
      case 'teach': {
        u.tech = Math.min(4, (u.tech || 0) + 2);
        units._setRealm(u, u.realm, u.stage);
        this.ctx.fx.ring(u.x, u.y, '#c060ff', 1, 5, 0.9);
        this.ctx.events.add('divine', '✦ 天道传功，' + u.name + ' 得授「' + TECH_TIERS[u.tech].n + '」功法');
        return true;
      }
      case 'reincarnate': {
        if (u.type !== U_TYPE.CULTIVATOR) return { ok: false, msg: '只能对修士使用' };
        const old = units.realmName(u);
        units.reincarnate(u);
        this.ctx.fx.ring(u.x, u.y, '#8ecfff', 1, 7, 1.2);
        this.ctx.events.add('divine', '↻ ' + u.name + ' 自' + old + '转入轮回，重头再来');
        return true;
      }
    }
    return false;
  }
}
