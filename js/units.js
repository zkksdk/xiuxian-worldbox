/**
 * units.js —— 单位系统：修士 / 妖兽 / 灵植
 * 包含境界成长、突破渡劫、AI 状态机、战斗结算。
 */
import { CFG, REALMS, STAGES, ROOTS, MAX_REALM, BIOME, ELEMENTS, TECH_TIERS, ARTIFACT_TIERS, HERBS } from './config.js';
import { RNG, clamp, lerp, dist, smoothstep, Namer, fmt } from './util.js';
import { ACT, N_IN, N_HID, N_OUT, randomPersona, inheritPersona } from './brain.js';

export const U_TYPE = { CULTIVATOR: 0, BEAST: 1, PLANT: 2 };

export const ST = {
  IDLE: 'idle', WANDER: 'wander', SEEK: 'seek', CULTIVATE: 'cultivate',
  FIGHT: 'fight', FLEE: 'flee', BREAK: 'break', TRIB: 'trib',
  EXPLORE: 'explore', FOUND: 'found', MATED: 'mated',
  EXPAND: 'expand',   // 奉宗门之命外出拓土
};

export class Units {
  constructor(ctx) {
    this.ctx = ctx;                 // {world, sects, events, fx, rng, units}
    this.list = [];
    this.byId = new Map();
    this.nextId = 1;
    this.rng = ctx.rng;
    this.namer = new Namer(this.rng);
    this.yearAcc = 0;
    this._gate = 0;
    // 空间网格：把"找附近单位"从 O(n) 降到 O(邻近格)，是无限数量的关键
    const W = ctx.world.W, H = ctx.world.H;
    this.gCell = 12;
    this.gW = Math.ceil(W / this.gCell);
    this.gH = Math.ceil(H / this.gCell);
    this.grid = new Map();
    this._gridFrame = 0;
    this._motionPhase = 0;
    // 决策缓冲区（复用，避免每次决策都建数组）
    this._sc = new Float32Array(7);
    this._in = new Float32Array(N_IN);
    this._hid = new Float32Array(N_HID);
    this._out = new Float32Array(N_OUT);
  }

  /** 重建空间网格（每若干帧一次，单位移动缓慢，粗粒度足够） */
  rebuildGrid() {
    const g = this.grid;
    g.clear();
    const CW = this.gCell, GW = this.gW;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (!u.alive) continue;
      const ci = ((u.y / CW) | 0) * GW + ((u.x / CW) | 0);
      const arr = g.get(ci);
      if (arr) arr.push(u);
      else g.set(ci, [u]);
    }
    this._gridFrame = 0;
  }

  get world() { return this.ctx.world; }

  /* ================= 创建 ================= */
  spawn(type, x, y, opt = {}) {
    const w = this.world;
    if (!w.passable(x, y)) {
      const alt = w.findLandNear(x, y, 8);
      if (!alt) return null;
      x = alt.x; y = alt.y;
    }
    if (this.list.length >= CFG.sim.maxUnits) return null;
    const u = {
      id: this.nextId++, type, alive: true,
      x: x + 0.5, y: y + 0.5, hx: x + 0.5, hy: y + 0.5,
      hp: 100, maxHp: 100,
      realm: 0, stage: 0, cult: 0, cp: 1,
      root: 0, elem: 0, daoHeart: 50,
      age: 0, life: 120,
      path: 0, isDemon: false,
      sectId: -1, state: ST.IDLE, stateT: 0, decideT: 0,
      atkCd: 0, target: -1, trib: null,
      stones: 0, herbs: {}, ores: {}, woods: 0, pills: {}, arts: [], tech: 0,
      pillBuff: null, flags: 0, wanderT: 0,
      name: '', title: '', ccolor: '#d8d8dc',
      lastAura: -1, mateCd: 0, grow: 0, mature: false,
    };
    if (type === U_TYPE.CULTIVATOR) this._initCultivator(u, opt);
    else if (type === U_TYPE.BEAST) this._initBeast(u, opt);
    else this._initPlant(u, opt);
    this.list.push(u);
    this.byId.set(u.id, u);
    return u;
  }

  _initCultivator(u, opt) {
    u.name = this.namer.person();
    u.title = '';
    const root = opt.root != null ? ROOTS[opt.root] : this.namer.root();
    u.root = ROOTS.indexOf(root);
    u.elem = this.rng.int(0, 4);
    u.daoHeart = clamp(this.rng.gauss(50, 14), 5, 95);
    const realm = opt.realm != null ? opt.realm : 0;
    this._setRealm(u, realm, opt.stage || 0);
    u.cult = opt.cult != null ? opt.cult : this.rng.range(0, this.needFor(u) * 0.4);
    u.hp = u.maxHp;
    // 初始资产
    const r = realm;
    u.stones = Math.round(this.rng.range(5, 40) * (1 + r * r * 2.5));
    if (this.rng.chance(0.25 + r * 0.1)) u.pills[0] = this.rng.int(1, 2);
    if (r >= 1 && this.rng.chance(0.3)) u.arts.push({ tier: Math.min(5, Math.floor(r / 1.5)), kind: this.rng.int(0, 3) });
    if (r >= 2) u.tech = Math.min(4, Math.floor(r / 1.6));
    if (this.rng.chance(0.02)) { u.tech = 3; u.flags |= 1; }   // 天命之子：自带天阶功法
    // —— 性格基因 + 道统（神经网络权重索引）——
    u.pers = randomPersona(this.rng);
    const pool = this.ctx.brains;
    u.brainId = pool ? ((this.rng.next() * pool.size) | 0) : 0;
    u.mem = { grudge: 0, foeId: -1, safeX: 0, safeY: 0, safeAura: -1, dangerX: 0, dangerY: 0, avenge: 0 };
    // —— 关系网：师承 / 门下 / 道侣 / 血仇 ——
    u.rel = { master: -1, dis: [], mate: -1, since: 0 };
    u.lastAct = ACT.CULTIVATE;
    u.state = ST.WANDER;
  }

  _initBeast(u, opt) {
    const tier = opt.tier || 1;
    u.beastTier = tier;
    u.realm = clamp(tier - 1, 0, MAX_REALM);
    u.name = this._beastName(tier);
    u.hp = 100 * Math.pow(REALMS[u.realm].power, 0.85);
    u.maxHp = u.hp;
    u.life = REALMS[u.realm].life * 0.8;
    u.daoHeart = 30;
    u.cp = REALMS[u.realm].power * 0.9;
    u.ccolor = '#c05555';
    u.mateCd = this.rng.range(0, 40);
    u.hunger = this.rng.range(10, 45);
    u.food = 0;
    // —— 兽性（凶性/狡诈/贪食/群性）+ 兽道网络 ——
    u.pers = [
      clamp(this.rng.gauss(0.5, 0.25), 0.05, 0.95),
      clamp(this.rng.gauss(0.5, 0.25), 0.05, 0.95),
      clamp(this.rng.gauss(0.5, 0.22), 0.05, 0.95),
      clamp(this.rng.gauss(0.4, 0.25), 0.05, 0.95),
    ];
    const bp = this.ctx.beastBrains;
    u.brainId = bp ? ((this.rng.next() * bp.size) | 0) : 0;
    u.mem = { lastEat: 0, lastHurt: 0 };
    u._foeCache = null;
    u._grassCache = null;
    u.state = ST.WANDER;
  }

  /** 妖兽七艺 */
  static get BACT() { return { FORAGE: 0, HUNT: 1, FLEE: 2, WANDER: 3, BREED: 4, GUARD: 5, REST: 6 }; }

  _initPlant(u, opt) {
    const tier = opt.tier || 0;
    u.plantTier = tier;
    u.grow = this.rng.range(0, 0.5);
    u.mature = false;
    u.ccolor = '#7ad07a';
    u.hp = 20 + tier * 10;
    u.maxHp = u.hp;
    u.state = ST.IDLE;
  }

  _beastName(tier) {
    const pre = ['赤目', '黑鳞', '玄爪', '风翼', '雷纹', '血口', '金瞳', '冰脊', '紫鬃', '铁背'];
    const kind = [['妖狼', '毒蛛', '玄蛇', '山魈'], ['灵狐', '虎蛟', '铁鹰', '石猿'],
                  ['炎蟒', '雷鹏', '冥豹', '冰蟾'], ['蛟龙', '饕餮', '窮奇', '梼杌'], ['上古凶兽', '混元兽', '太古遗种', '噬天蛟']];
    const k = kind[clamp(tier - 1, 0, 4)];
    return this.rng.pick(pre) + this.rng.pick(k);
  }

  /** 设置境界并刷新属性 */
  _setRealm(u, realm, stage) {
    u.realm = clamp(realm, 0, MAX_REALM);
    u.stage = clamp(stage || 0, 0, 3);
    const R = REALMS[u.realm];
    u.life = R.life;
    const root = ROOTS[u.root];
    const cm = u.type === U_TYPE.BEAST ? 0.9 : root.cult;
    u.cp = R.power * (1 + 0.18 * u.stage) * (1 + (u.tech ? TECH_TIERS[u.tech].power : 0)) * cm;
    u.maxHp = 100 * Math.pow(R.power, 0.85) * (1 + 0.15 * u.stage);
    if (u.type === U_TYPE.CULTIVATOR) {
      u.ccolor = R.color;
      if (u.isDemon) u.ccolor = '#ff6060';
    }
  }

  /** 当前阶段突破所需修为 */
  needFor(u) {
    const b = CFG.balance;
    if (u.stage < 3) return REALMS[u.realm].need * b.stageNeedMul[u.stage];
    if (u.realm >= MAX_REALM) return REALMS[MAX_REALM].need * 0.9;   // 飞升之劫所需
    return REALMS[u.realm + 1].need * b.realmBreakNeedMul;
  }

  realmName(u) {
    if (u.type === U_TYPE.PLANT) return '灵植';
    if (u.type === U_TYPE.BEAST) return '妖兽·' + REALMS[u.realm].n;
    return REALMS[u.realm].n + '·' + STAGES[u.stage];
  }

  /* ================= 年度推进 ================= */
  updateYear(years) {
    // 类型统计不必每年全量刷新（数量大时全表扫描很贵）
    if (!this._counts || (this._gate & 3) === 0) this._counts = this.countTypes();
    const list = this.list;
    const n = list.length;
    // 分级降载：数量大时分成 4 组轮转，每组每 4 年处理一次（时间跨度翻 4 倍补偿）
    if (n > 1200) {
      const groups = n > 3600 ? 8 : 4;          // 数量越多，分帧越细
      const mask = groups - 1;
      this._yearPhase = ((this._yearPhase || 0) + 1) & mask;
      const ph = this._yearPhase, yN = years * groups;
      for (let i = ph; i < n; i += groups) this._yearOne(list[i], yN);
    } else {
      for (let i = 0; i < n; i++) this._yearOne(list[i], years);
    }
    if (this._gate++ % 16 === 0) this.compact();
  }

  /** 单个单位的年度推进（拆出来便于分帧调度） */
  _yearOne(u, years) {
    if (!u.alive) return;
    if (u.type === U_TYPE.PLANT) { this._plantYear(u, years); return; }
    if (u.type === U_TYPE.BEAST) { this._beastYear(u, years); return; }
    u.age += years;
    if (u.age >= u.life) {
      // 老死也是世间常态：资质不足者，往往耗死在大道中途
      if (u.realm >= 2 || (u.realm >= 1 && this.rng.chance(0.25))) {
        this.ctx.events && this.ctx.events.add('death',
          '† ' + u.name + ' 寿元耗尽，坐化（' + this.realmName(u) + '）');
      }
      this.kill(u, '寿元耗尽');
      return;
    }
    if (u.pillBuff) { u.pillBuff.t -= years; if (u.pillBuff.t <= 0) u.pillBuff = null; }
    // —— 高境界的代价：化神以上每百余年遭一次心魔劫 ——
    if (u.realm >= 4 && u.state !== ST.TRIB) {
      u.tribCd = (u.tribCd == null ? this.rng.range(40, 180) : u.tribCd) - years;
      if (u.tribCd <= 0) {
        u.tribCd = this.rng.range(260, 420);
        const roll = this.rng.next();
        if (roll < 0.06) { this.kill(u, '心魔劫发，走火入魔而亡'); return; }
        if (roll < 0.36) {
          // 三成概率不是跌境界，而是道心破碎、就此堕魔 —— 魔道的主要来源
          if (!u.isDemon && this.rng.chance(0.3)) {
            this._fallToDemon(u, '心魔劫发，道心破碎，堕入魔道');
          } else {
            if (u.stage > 0) u.stage--;
            else if (u.realm > 0) { u.realm--; u.stage = 3; }
            u.cult = 0;
            this._setRealm(u, u.realm, u.stage);
            u.hp = Math.max(1, u.maxHp * 0.45);
            u.daoHeart = clamp(u.daoHeart - 12, 0, 100);
            if (this.rng.chance(0.3)) {
              this.ctx.events && this.ctx.events.add('disaster', '☠ ' + u.name + ' 心魔劫发，境界跌落至 ' + this.realmName(u));
            }
          }
        } else {
          u.daoHeart = clamp(u.daoHeart + 5, 0, 100);   // 渡过者道心更坚
        }
      }
    }
    if (u.state === ST.TRIB) { this._tickTribulation(u, years); return; }
    if (u.state === ST.FIGHT) {
      u.fightT = (u.fightT || 0) + years;
      if (u.fightT > 5) { u.state = ST.IDLE; u.target = -1; u.fightT = 0; u.decideT = 0; }
    } else u.fightT = 0;
    this._cultivate(u, years);
    this._gather(u, years);          // 顺手采伐周边草木
    u.daoHeart = clamp(u.daoHeart + 0.18 * years, 0, 100);
    u.decideT -= years;
    if (u.decideT <= 0) this._decide(u);
    if (u.cult >= this.needFor(u)) this._checkBreak(u);
    // 路过陨落之地，或有遗物可拾
    if (this.world.relics.length) this._tryPickRelic(u);
  }

  _plantYear(u, years) {
    const w = this.world;
    const i = w.idx(Math.floor(u.x), Math.floor(u.y));
    const aura = w.aura[i];
    const nice = clamp(aura / 60, 0.15, 2.2);
    u.grow += years * 0.02 * nice * (1 + u.plantTier * 0.15);
    if (!u.mature && u.grow >= 1) { u.mature = true; u.grow = 1; }
    if (u.mature) {
      // 灵材累积（由灵植吸收天地灵气而结出）
      u.yieldAcc = (u.yieldAcc || 0) + years * 0.4 * nice;
      if (u.yieldAcc >= 16) {
        u.yieldAcc = 0;
        // 由附近修士采走：灵草的归宿是被人服食，而不是凭空消失
        let picker = null;
        this.forEachNear(u.x, u.y, 3, (o) => {
          if (picker || !o.alive || o.type !== U_TYPE.CULTIVATOR) return;
          picker = o;
        });
        if (picker) {
          const tier = u.plantTier || 0;
          picker.herbs[tier] = (picker.herbs[tier] || 0) + 1;
          // 服食灵草，化为修为（灵草 ← 灵植 ← 天地灵气，链条完整）
          picker.cult += (tier + 1) * 6 * (1 + picker.realm * 0.6);
          w.aura[i] = Math.max(1, w.aura[i] - 0.6);
          // 采走之后要重新生长，不能立刻再产
          u.mature = false;
          u.grow = 0.25;
          if (tier >= 3 && this.rng.chance(0.22)) {
            const hname = ['聚灵草', '凝露花', '金髓芝', '龙涎果', '太阴真芝', '太阳神草'][Math.min(5, tier)];
            this.ctx.events && this.ctx.events.add('divine', '✿ ' + picker.name + ' 采得「' + hname + '」，服之修为大进');
          }
        }
      }
    }
    if (u.grow > 0 && !u.mature) u.hp = u.maxHp * (0.4 + 0.6 * u.grow);
  }

  _beastYear(u, years) {
    u.age += years;
    if (u.age >= u.life) { this.kill(u, '寿元耗尽'); return; }
    const eco = CFG.eco;
    // —— 饥饿：妖兽的第一驱动力 ——
    if (u.hunger == null) u.hunger = this.rng.range(10, 45);
    if (u.food == null) u.food = 0;
    const hRate = eco.hungerRate * (u.beastTier >= 3 ? eco.hungerHighMul : 1);
    u.hunger = Math.min(100, u.hunger + hRate * years);
    if (u.hunger >= 100) {
      u.hp -= u.maxHp * eco.starveHpLoss * years;   // 饿到极处，气血自耗
      if (u.hp <= 0) { this.kill(u, '饥馁而死'); return; }
    } else if (u.hunger < 80) {
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.018 * years);
    }
    // —— 进化：必须吃饱（累计进食量达标），而非熬年头 ——
    const needFood = eco.evolveFoodNeed[u.beastTier] != null ? eco.evolveFoodNeed[u.beastTier] : 1e9;
    // 灵地出凶兽：所在之地灵气（或魔气）越足，越易开窍进化
    const w2 = this.world;
    const ii = w2.idx(clamp(Math.floor(u.x), 0, w2.W - 1), clamp(Math.floor(u.y), 0, w2.H - 1));
    const env = 1 + (w2.aura[ii] + w2.demon[ii]) / 120;
    if (u.beastTier < 5 && u.food >= needFood && this.rng.chance(eco.evolveChance * years * env)) {
      u.beastTier++;
      u.food -= needFood;                 // 进化消耗存粮（须重新积累，故高阶稀少）
      this._setRealm(u, u.beastTier - 1, 0);
      u.hp = u.maxHp;
      u.hunger = Math.max(0, u.hunger - 25);
      if (u.beastTier >= 4 && this.rng.chance(0.3)) {
        this.ctx.events && this.ctx.events.add('disaster', '⚠ ' + u.name + ' 吞噬生灵无数，晋为 ' + u.beastTier + ' 阶凶兽');
      }
    }
    u.mateCd -= years;
    u.decideT -= years;
    if (u.decideT <= 0) this._decide(u);
    // —— 就近啃食：饱了就不吃，饿了就在 3×3 区块里找草 ——
    if (u.hunger > 25 && this.rng.chance(0.30 * years)) {
      const w = this.world;
      const cx = Math.floor(u.x / 16), cy = Math.floor(u.y / 16);
      let eaten = false;
      for (let dy = -1; dy <= 1 && !eaten; dy++) {
        for (let dx = -1; dx <= 1 && !eaten; dx++) {
          const arr = w.decorChunks.get((cy + dy) * w._chunkW + (cx + dx));
          if (!arr) continue;
          for (let k = 0; k < arr.length; k++) {
            const d = arr[k];
            if (!d.alive) continue;
            const dd = (d.x - u.x) * (d.x - u.x) + (d.y - u.y) * (d.y - u.y);
            if (dd < 25) {
              d.alive = 0;
              w.markDirtyArea(Math.floor(d.x), Math.floor(d.y), 1);
              u.hunger = Math.max(0, u.hunger - eco.hungerEatPlant);
              u.food += eco.hungerEatPlant;
              eaten = true;
              break;
            }
          }
        }
      }
    }
  }

  /**
   * 采集周边草木：伐木得木料、采药得灵草、凿石得矿石。
   * 草木被砍掉后会消失，须待灵气滋养方能再生 —— 世界因此是"活"的。
   */
  _gather(u, years) {
    const rate = u.realm >= 3 ? 0.04 : (u.realm >= 1 ? 0.10 : 0.17);
    if (!this.rng.chance(rate * years)) return;
    const w = this.world;
    const CH = 16;
    const cx = Math.floor(u.x / CH), cy = Math.floor(u.y / CH);
    let target = null, bd = 6.25;   // 2.5 格内
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = w.decorChunks.get((cy + dy) * w._chunkW + (cx + dx));
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const d = arr[k];
          if (!d.alive) continue;
          const dd = (d.x - u.x) * (d.x - u.x) + (d.y - u.y) * (d.y - u.y);
          if (dd < bd) { bd = dd; target = d; }
        }
      }
    }
    if (!target) return;
    target.alive = 0;
    w.markDirtyArea(Math.floor(target.x), Math.floor(target.y), 1);
    const t = target.t;
    // 产出分类：木料 / 灵草 / 矿石
    if (t === 0 || t === 1 || t === 2 || t === 11) {
      u.woods = (u.woods || 0) + 1;
    } else if (t === 4 || t === 8 || t === 12) {
      const tier = t === 8 ? 3 : 0;
      u.ores = u.ores || {};
      u.ores[tier] = (u.ores[tier] || 0) + 1;
    } else {
      const tier = target.pal === 7 || target.pal === 8 ? 2 : (target.pal === 6 ? 3 : 0);
      u.herbs = u.herbs || {};
      u.herbs[tier] = (u.herbs[tier] || 0) + 1;
    }
  }

  /** 修炼积累 */
  _cultivate(u, years) {
    const w = this.world;
    const i = w.idx(clamp(Math.floor(u.x), 0, w.W - 1), clamp(Math.floor(u.y), 0, w.H - 1));
    const aura = w.aura[i] * (u.flags & 2 ? 1.2 : 1);
    const demon = w.demon[i];
    let eff;
    if (u.isDemon) eff = aura * 0.30 + demon * 1.20;
    else eff = Math.max(0, aura - demon * 0.9);
    const b = CFG.balance;
    const auraFactor = b.auraFunc.base + (clamp(eff, 0, 100) / 100) * b.auraFunc.span;
    const R = REALMS[u.realm];
    let speed = R.speed * b.cultSpeedBase * auraFactor * ROOTS[u.root].cult;
    speed *= 1 + u.daoHeart / 300;
    if (u.sectId >= 0) speed *= 1.18;
    if (u.rel) {                                  // 师承与因缘
      if (u.rel.master >= 0) speed *= 1.15;       // 有师父指点
      if (u.rel.mate >= 0) speed *= 1.12;         // 阴阳双修
      if (u.rel.dis && u.rel.dis.length) speed *= 1 + Math.min(0.12, u.rel.dis.length * 0.03);  // 教学相长
    }
    // 功法品阶决定修炼效率（黄阶 +0% → 仙阶 +100%）
    if (u.tech) speed *= 1 + TECH_TIERS[u.tech].cult * 0.5;
    if (u.pillBuff && u.pillBuff.eff === 'cult') speed *= 1 + u.pillBuff.val;
    if (u.flags & 2) speed *= 1.5;      // 洞天福地加成
    u.cult += speed * years;
    // 吐纳天地：吸走的灵气是真的从这一方土地上少掉了
    // 境界越高吞吐越猛，元婴以上还会**损伤地脉**（基准值下降，需靠灵脉回灌）
    const drain = (0.12 + u.realm * 0.10 + u.realm * u.realm * 0.035) * years;
    w.aura[i] = Math.max(1, w.aura[i] - drain);
    if (u.realm >= 2) {
      w.auraBase[i] = Math.max(6, w.auraBase[i] - drain * 0.14);
    }
    // 魔修污染
    if (u.isDemon && u.realm >= 2) {
      w.demon[i] = Math.min(100, w.demon[i] + 0.05 * years);
    }
  }

  /* ---- 突破 ---- */
  _checkBreak(u) {
    if (u.state === ST.FIGHT || u.state === ST.TRIB) return;
    if (u.stage < 3) this._minorBreak(u);
    else this._startTribulation(u);   // 大境界之劫；大乘圆满则为飞升之劫
  }

  _breakChance(u, isTrib) {
    const w = this.world;
    const i = w.idx(clamp(Math.floor(u.x), 0, w.W - 1), clamp(Math.floor(u.y), 0, w.H - 1));
    const aura = w.aura[i], demon = w.demon[i];
    const b = CFG.balance;
    let p = isTrib ? b.tribBase : b.breakBase;
    p += ROOTS[u.root].brk;                        // 灵根资质
    if (u.tech) p += TECH_TIERS[u.tech].cult * 0.08;   // 功法品阶（天阶 +8%、仙阶 +16%）
    if (aura > 80) p += 0.18; else if (aura > 60) p += 0.10;
    else if (aura < 20) p -= 0.25; else if (aura < 40) p -= 0.12;
    p += (u.daoHeart - 50) / 250;
    if (isTrib) p += u.realm * 0.022;        // 境界越高，渡劫阅历越丰
    if (!u.isDemon && demon > 40) p -= 0.15;
    if (u.isDemon && aura > 60) p -= 0.12;
    // 丹药
    if (u.pillBuff && u.pillBuff.eff === (isTrib ? 'trib' : 'break')) p += u.pillBuff.val;
    // 宗门护法
    if (u.sectId >= 0 && this.ctx.sects) {
      const s = this.ctx.sects.byId.get(u.sectId);
      if (s && s.members.length > 4) p += 0.06;
    }
    // 奇观：北斗灵枢
    for (const wd of w.wonders) {
      if (wd.def === 'beidou' && dist(u.x, u.y, wd.x, wd.y) < wd.r) p += 0.10;
      if (wd.def === 'wuxing' && dist(u.x, u.y, wd.x, wd.y) < wd.r) p += 0.05;
    }
    if (u.flags & 4) p += 0.30;    // 护道
    if (u.flags & 8) p -= 0.50;    // 心魔
    return clamp(p, 0.03, 0.97);
  }

  _minorBreak(u) {
    const p = this._breakChance(u, false);
    if (this.rng.chance(p)) {
      u.cult -= this.needFor(u);
      u.stage++;
      this._setRealm(u, u.realm, u.stage);
      u.hp = u.maxHp;
      u.daoHeart = clamp(u.daoHeart + 4, 0, 100);
      u.flags &= ~4;
      // 突破瞬间一次性光环（转瞬即逝，不做持续闪烁）
      if (this.ctx.fx && u.realm >= 1) {
        this.ctx.fx.ring(u.x, u.y, u.isDemon ? '#ff8080' : REALMS[u.realm].color, 0.4, 3.2, 0.5);
      }
      if (u.realm >= 2 && this.rng.chance(0.35)) {
        this.ctx.events && this.ctx.events.add('break',
          u.name + ' 突破至 ' + REALMS[u.realm].n + STAGES[u.stage] + '，气息沉凝');
      }
    } else {
      u.cult *= (1 - CFG.balance.failCultLoss);
      u.hp = Math.max(1, u.hp - u.maxHp * 0.25);
      if (this.rng.chance(CFG.balance.qiDeviation * 0.4) && !u.isDemon && u.realm >= 2) {
        this._fallToDemon(u, '突破失败，心魔入侵，堕入魔道');
      }
    }
  }

  _fallToDemon(u, msg) {
    u.isDemon = true; u.path = 1; u.ccolor = '#ff6060';
    u.daoHeart = clamp(u.daoHeart - 25, 0, 100);
    this.ctx.events && this.ctx.events.add('disaster', '☠ ' + u.name + ' ' + msg);
    if (this.ctx.sects && u.sectId >= 0) this.ctx.sects.leaveSect(u, true);
  }

  /** 开始渡劫 */
  _startTribulation(u) {
    const types = ['五行雷劫', '九天玄劫', '心魔劫'];
    const ascend = u.realm >= MAX_REALM;
    u.trib = {
      t: 0, dur: 3.2 + u.realm * 0.7,   // 单位：世界年（1x 速度下约 3~9 秒）
      type: ascend ? '飞升天劫' : types[this.rng.int(0, 2)],
      p: this._breakChance(u, true),
      struck: 0,
      ascend,
    };
    u.state = ST.TRIB;
    u.stateT = 0;
    const where = ascend ? '【飞升之劫】' : '【' + REALMS[u.realm + 1].n + '之劫】';
    this.ctx.events && this.ctx.events.add('ascend',
      '⚡ ' + u.name + ' 于 ' + this._placeName(u) + ' 引动 ' + u.trib.type + '，' + where);
    this.ctx.fx && this.ctx.fx.tribStart(u);
  }

  _tickTribulation(u, dt) {
    const t = u.trib;
    t.t += dt;
    const strikes = Math.floor(t.t / (t.dur / 6));
    if (strikes > t.struck) { t.struck = strikes; this.ctx.fx && this.ctx.fx.tribStrike(u); }
    if (t.t >= t.dur) this._resolveTribulation(u);
  }

  _resolveTribulation(u) {
    const t = u.trib;
    const p = clamp(t.p + (u.flags & 4 ? 0.3 : 0) - (u.flags & 8 ? 0.5 : 0), 0.02, 0.97);
    u.trib = null;
    u.flags &= ~(4 | 8);
    if (this.rng.chance(p)) {
      // 飞升
      if (t.ascend) { this._ascend(u); return; }
      // 成功
      const nr = u.realm + 1;
      const oldLife = REALMS[u.realm].life;
      u.cult = 0;
      this._setRealm(u, nr, 0);
      u.hp = u.maxHp;
      u.daoHeart = clamp(u.daoHeart + 8, 0, 100);
      // 突破只是"延寿"而非"重置"：年龄按比例回落，但资质不足者依旧会耗死在半路
      // 天灵根一路顺畅，五灵根往往在筑基/金丹之前油尽灯枯 —— 除非另有奇遇
      u.age = Math.min(u.age * 0.55, u.life * 0.45);
      u.state = ST.IDLE;
      this.ctx.events && this.ctx.events.add('break',
        '✦ ' + u.name + ' 渡过' + t.type + '，晋升 ' + REALMS[nr].n + '期！');
      this.ctx.fx && this.ctx.fx.breakthrough(u, true);
      // 飞升
      if (nr >= MAX_REALM) { /* 大乘圆满后再渡劫则飞升 */ }
    } else {
      const roll = this.rng.next();
      u.state = ST.IDLE;
      if (roll < 0.30) {
        this.kill(u, '渡劫失败，身死道消');
      } else if (roll < 0.80) {
        if (u.stage > 0) u.stage--;
        else if (u.realm > 0) { u.realm--; u.stage = 3; }
        this._setRealm(u, u.realm, u.stage);
        u.cult = 0;
        u.hp = Math.max(1, u.maxHp * 0.25);
        this.ctx.events && this.ctx.events.add('death', '✗ ' + u.name + ' 渡劫失败，境界跌落，重伤遁走');
      } else {
        u.hp = Math.max(1, u.maxHp * 0.4);
        u.cult *= 0.5;
        this.ctx.events && this.ctx.events.add('death', '✗ ' + u.name + ' 渡劫失败，道基受损');
      }
      this.ctx.fx && this.ctx.fx.tribFail(u);
    }
  }

  /** 飞升：留下仙缘，灵气永驻 */
  _ascend(u) {
    const w = this.world;
    const ix = clamp(Math.floor(u.x), 0, w.W - 1), iy = clamp(Math.floor(u.y), 0, w.H - 1);
    const i = w.idx(ix, iy);
    w.flag[i] = 3;
    w.addAura(ix, iy, 8, 24, true);
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      if (dx * dx + dy * dy > 25) continue;
      const x = ix + dx, y = iy + dy;
      if (!w.inB(x, y)) continue;
      const j = w.idx(x, y);
      if (w.flag[j] === 0) w.flag[j] = 3;
      w.aura[j] = Math.min(100, w.aura[j] + 10);
      w.auraBase[j] = Math.min(100, w.auraBase[j] + 8);
      w.markDirty(x, y);
    }
    this.ctx.fx.ascend(u.x, u.y);
    this.ctx.fx.text(u.x, u.y - 3, '飞升！', '#ffe680');
    this.ctx.events.add('ascend', '✧ ' + u.name + ' 渡劫飞升，霞光万丈，天地同贺！留下仙缘于' + this._placeName(u));
    this.ctx.stats.ascended = (this.ctx.stats.ascended || 0) + 1;
    u.alive = false;
    u.ascended = true;
    if (u.sectId >= 0 && this.ctx.sects) this.ctx.sects.onUnitDeath(u);
  }

  _placeName(u) {
    const w = this.world;
    const b = w.biomeAt(Math.floor(u.x), Math.floor(u.y));
    const names = ['东海之滨', '青云山麓', '黑风谷', '赤炎岭', '寒潭水府', '万兽林', '紫雷原', '幽冥涧', '九霄巅', '无名之地'];
    if (b === BIOME.SNOW || b === BIOME.SNOWFIELD) return '极北雪原';
    if (b === BIOME.DESERT) return '黄沙绝域';
    if (b === BIOME.MOUNTAIN) return '苍茫群山';
    if (b === BIOME.ABYSS) return '魔渊深处';
    return names[(Math.floor(u.x / 32) + Math.floor(u.y / 32)) % names.length];
  }

  /** 陨落之地留下遗物，以待有缘人 */
  _dropRelic(u, x, y, byTrib) {
    const rng = this.rng;
    // —— 妖兽：掉兽骨兽皮（炼器材料），高阶凶兽还会留下灵石 ——
    if (u.type === U_TYPE.BEAST) {
      const items = [];
      const tier = Math.min(4, u.beastTier || 1);
      if (rng.chance(0.55)) items.push({ kind: 'beast', tier });
      if ((u.beastTier || 1) >= 3 && rng.chance(0.3)) items.push({ kind: 'stone', tier: 1, amount: 8 * u.beastTier });
      if (!items.length) return;
      this.world.relics.push({ x: x + 0.5, y: y + 0.5, items, name: u.name, realm: u.beastTier || 1, t: 0 });
      return;
    }
    // —— 灵植：掉灵草 ——
    if (u.type === U_TYPE.PLANT) {
      if (u.mature || rng.chance(0.5)) {
        this.world.relics.push({
          x: x + 0.5, y: y + 0.5, t: 0,
          items: [{ kind: 'herb', tier: Math.min(5, u.plantTier || 0) }],
          name: (HERBS[Math.min(5, u.plantTier || 0)] || { n: '灵草' }).n, realm: 0,
        });
      }
      return;
    }
    if (u.type !== U_TYPE.CULTIVATOR) return;
    const bonus = byTrib ? 1.6 : 1;         // 被天雷劈死的，遗物更厚
    const items = [];
    const stones = Math.round((u.stones || 0) * 0.6 * bonus);
    if (stones > 0) items.push({ kind: 'stone', tier: Math.min(3, Math.floor(u.realm / 2)), amount: stones });
    if (u.arts && u.arts.length && rng.chance(0.38 * bonus)) {
      items.push({ kind: 'artifact', tier: u.arts[0].tier, k: u.arts[0].kind });
    }
    if ((u.tech || 0) >= 2 && rng.chance(0.30 * bonus)) items.push({ kind: 'tech', tier: u.tech });
    if (u.pills && Object.keys(u.pills).length && rng.chance(0.45)) items.push({ kind: 'pill', tier: 0 });
    if (!items.length) return;
    this.world.relics.push({ x: x + 0.5, y: y + 0.5, items, name: u.name, realm: u.realm, t: 0 });
    if (u.realm >= 3) {
      this.ctx.events && this.ctx.events.add('death', '☄ ' + u.name + ' 陨落之地遗下重宝，静待有缘人');
    }
  }

  /** 路过拾取遗物 */
  _tryPickRelic(u) {
    const w = this.world, rs = w.relics;
    if (!rs.length) return;
    for (let i = rs.length - 1; i >= 0; i--) {
      const r = rs[i];
      const d2 = (r.x - u.x) * (r.x - u.x) + (r.y - u.y) * (r.y - u.y);
      if (d2 > 4) continue;
      const got = [];
      for (const it of r.items) {
        if (it.kind === 'stone') { u.stones = (u.stones || 0) + it.amount; got.push('灵石' + fmt(it.amount)); }
        else if (it.kind === 'artifact') { u.arts.push({ tier: it.tier, kind: it.k }); this._setRealm(u, u.realm, u.stage); got.push(ARTIFACT_TIERS[it.tier].n); }
        else if (it.kind === 'tech') { u.tech = Math.max(u.tech || 0, it.tier); got.push(TECH_TIERS[it.tier].n + '功法'); }
        else if (it.kind === 'pill') { u.pills[0] = (u.pills[0] || 0) + 1; got.push('丹药'); }
        else if (it.kind === 'beast') { u.ores = u.ores || {}; u.ores[it.tier] = (u.ores[it.tier] || 0) + 1; got.push('兽材'); }
        else if (it.kind === 'herb') { u.herbs = u.herbs || {}; u.herbs[it.tier] = (u.herbs[it.tier] || 0) + 1; got.push('灵草'); }
      }
      rs.splice(i, 1);
      if (got.length && this.rng.chance(0.45)) {
        this.ctx.events && this.ctx.events.add('divine', '✦ ' + u.name + ' 拾得 ' + r.name + ' 的遗物：' + got.join('、'));
      }
      return;
    }
  }

  /** 死亡处理 */
  kill(u, cause) {
    if (!u.alive) return;
    u.alive = false;
    const w = this.world;
    const ix = clamp(Math.floor(u.x), 0, w.W - 1), iy = clamp(Math.floor(u.y), 0, w.H - 1);
    const i = w.idx(ix, iy);
    const causeStr = String(cause);
    const byTrib = causeStr.indexOf('渡劫') >= 0 || causeStr.indexOf('心魔') >= 0 || causeStr.indexOf('天劫') >= 0;
    // 遗蜕：陨落之地灵气回涌
    if (u.realm >= 2) {
      w.aura[i] = Math.min(100, w.aura[i] + 6 + u.realm * 2.5);
      if (u.realm >= 4 && this.rng.chance(0.5)) {
        w.flag[i] = 3;
        w.auraBase[i] = Math.min(100, w.auraBase[i] + 10);
      }
      if (this.rng.chance(0.22)) {
        w._addSite(1, ix, iy, 2.2, Math.min(3, Math.floor(u.realm / 2)));
      }
      // 被天雷劈杀的：焦土陷坑，草木成灰（天地留痕）
      if (byTrib && u.realm >= 3) w.strikeScorch(ix, iy, 1 + u.realm * 0.35);
    }
    // 遗物掉落：被雷劈死的更厚
    this._dropRelic(u, ix, iy, byTrib);
    if (u.sectId >= 0 && this.ctx.sects) this.ctx.sects.onUnitDeath(u);
    // 因缘了断：师父失去弟子、道侣痛失所爱
    if (u.rel) {
      if (u.rel.master >= 0) {
        const m = this.byId.get(u.rel.master);
        if (m && m.rel) {
          const k = m.rel.dis.indexOf(u.id);
          if (k >= 0) m.rel.dis.splice(k, 1);
        }
      }
      if (u.rel.mate >= 0) {
        const p = this.byId.get(u.rel.mate);
        if (p && p.rel) {
          p.rel.mate = -1;
          p.daoHeart = clamp(p.daoHeart - 15, 0, 100);
          if (p.mem) p.mem.avenge = 1;
          if (this.rng.chance(0.35)) {
            this.ctx.events && this.ctx.events.add('death', '† ' + p.name + ' 痛失道侣 ' + u.name + '，道心大损');
          }
        }
      }
      u.rel = null;
    }
    this.ctx.fx && this.ctx.fx.death(u);
    if (u.realm >= 2 || cause.indexOf('渡劫') >= 0) {
      this.ctx.events && this.ctx.events.add('death',
        '† ' + (u.name || '一只妖兽') + ' ' + cause + '（' + this.realmName(u) + '）');
    }
  }

  /** 各类型存活统计（供 AI 决策复用，避免频繁全量扫描） */
  countTypes() {
    let cult = 0, beast = 0, plant = 0;
    for (const u of this.list) {
      if (!u.alive) continue;
      if (u.type === U_TYPE.CULTIVATOR) cult++;
      else if (u.type === U_TYPE.BEAST) beast++;
      else plant++;
    }
    return { cult, beast, plant };
  }

  compact() {
    const list = this.list;
    const n = list.length;
    if (n < 128) return;
    let dead = 0;
    for (let i = 0; i < n; i++) if (!list[i].alive) dead++;
    if (dead < 40) return;
    // 原地压缩，避免大数组频繁重建（单位数上万时 filter 会明显卡顿）
    let w = 0;
    for (let i = 0; i < n; i++) {
      const u = list[i];
      if (u.alive) list[w++] = u;
    }
    list.length = w;
    this.byId.clear();
    for (let i = 0; i < w; i++) this.byId.set(list[i].id, list[i]);
  }

  /* ================= AI 决策 ================= */
  _decide(u) {
    // 拓土途中不受其他念头干扰（除非遭遇战斗）
    if (u.state === ST.EXPAND && u.expedition) {
      if (!(u.state === ST.FIGHT)) { u.decideT = 20; return; }
    }
    // 分级降载：单位越多，思考得越"懒"，但行为模式保持一致
    const n = this.list.length;
    const lo = n < CFG.sim.lodDecide ? CFG.sim.decideMin : (n < CFG.sim.lodHeavy ? 2 : 4);
    const hi = n < CFG.sim.lodDecide ? CFG.sim.decideMax : (n < CFG.sim.lodHeavy ? 5 : 10);
    u.decideT = this.rng.range(lo, hi);
    const w = this.world;
    const simplify = n > CFG.sim.detailCap;

    if (u.type === U_TYPE.BEAST) { this._decideBeast(u); return; }

    // —— 性格 + 道统网络驱动的评分制决策 ——
    // （下方旧规则链保留备查，已不再执行）
    this._decideScored(u, n > CFG.sim.detailCap);
    return;

    // 1. 低血逃跑
    if (u.hp < u.maxHp * 0.3 && u.state !== ST.FLEE) {
      u.state = ST.FLEE; u.stateT = 0;
      const ang = Math.atan2(w.H / 2 - u.y, w.W / 2 - u.x) + this.rng.range(-1, 1);
      u.hx = clamp(u.x + Math.cos(ang) * 20, 2, w.W - 2);
      u.hy = clamp(u.y + Math.sin(ang) * 20, 2, w.H - 2);
      return;
    }
    // 2. 渡劫前准备（大境界圆满）
    if (u.stage === 3 && u.realm < MAX_REALM && u.cult >= this.needFor(u) * 0.6 && u.state !== ST.TRIB) {
      // 寻找安静的高灵气地点
      const spot = w.findCultSpot(u.x, u.y, 14, 18);
      u.state = ST.SEEK; u.hx = spot.x + 0.5; u.hy = spot.y + 0.5;
      return;
    }
    // 3. 寻敌（同区域敌对宗门 / 魔修 vs 正道）
    if (!simplify && u.realm >= 1) {
      const foe = this._findFoe(u, u.realm >= 3 ? 12 : 8);
      if (foe) {
        u.target = foe.id;
        u.state = ST.FIGHT; u.stateT = 0;
        u.hx = foe.x; u.hy = foe.y;
        return;
      }
    }
    // 4. 加入宗门（筑基以上，附近有宗门）
    if (u.sectId < 0 && u.realm >= 1 && this.ctx.sects) {
      const s = this.ctx.sects.nearby(u.x, u.y, 30, u.isDemon);
      if (s && s.members.length < CFG.sect.maxMembers[Math.min(5, s.level)]) {
        this.ctx.sects.join(s, u);
        u.state = ST.IDLE;
        return;
      }
    }
    // 5. 立宗（金丹以上）
    if (u.sectId < 0 && u.realm >= CFG.sect.foundRealm && this.ctx.sects && this.rng.chance(0.25)) {
      if (this.ctx.sects.tryFound(u)) { u.state = ST.FOUND; return; }
    }
    // 6. 探索洞天（元婴以上）
    if (u.realm >= 3 && this.rng.chance(0.18)) {
      const cave = w.nearestSite(u.x, u.y, [5], 60);
      if (cave && cave.ownerUnit !== u.id) {
        u.state = ST.EXPLORE; u.hx = cave.x + 0.5; u.hy = cave.y + 0.5;
        u.exploreSite = cave.id;
        return;
      }
    }
    // 7. 争夺资源点（筑基以上，附近无主或弱主的资源点）
    if (u.realm >= 1 && this.rng.chance(0.22)) {
      const site = w.nearestSite(u.x, u.y, [1, 2, 3, 4], 26);
      if (site && site.owner < 0 && site.ownerUnit !== u.id) {
        u.state = ST.SEEK; u.hx = site.x + 0.5; u.hy = site.y + 0.5;
        u.claimSite = site.id;
        return;
      }
    }
    // 8. 寻找修炼点
    const cur = w.auraAt(Math.floor(u.x), Math.floor(u.y));
    if (u.state !== ST.CULTIVATE || cur < 30 || this.rng.chance(0.35)) {
      const spot = w.findCultSpot(u.x, u.y, CFG.sim.viewAuraRange, simplify ? 12 : 26);
      const gain = spot.v - (cur + w.ley[clamp(Math.floor(u.y),0,w.H-1) * w.W + clamp(Math.floor(u.x),0,w.W-1)] * 3);
      if (gain > 6 || u.state !== ST.CULTIVATE) {
        u.state = ST.SEEK; u.hx = spot.x + 0.5; u.hy = spot.y + 0.5;
        return;
      }
    }
    u.state = ST.CULTIVATE;
    u.wanderT = 0;
  }

  /**
   * 评分制决策：先由规则算"基础倾向分"，再经道统网络调制、性格加权，
   * 最后用硬性掩码兜底（保证不出智障行为），取最高分执行。
   */
  _decideScored(u, simplify) {
    const rng = this.rng;
    // 社会行为（与七路并行，不参与评分）
    if (u.sectId < 0 && u.realm >= 1 && this.ctx.sects) {
      const s = this.ctx.sects.nearby(u.x, u.y, 30, u.isDemon);
      if (s && s.members.length < CFG.sect.maxMembers[Math.min(5, s.level)] && rng.chance(0.55)) {
        this.ctx.sects.join(s, u);
        u.state = ST.IDLE;
        return;
      }
    }
    if (u.sectId < 0 && u.realm >= CFG.sect.foundRealm && this.ctx.sects && rng.chance(0.25)) {
      if (this.ctx.sects.tryFound(u)) { u.state = ST.FOUND; return; }
    }
    // 因缘际会：拜师学艺、结为道侣（低概率触发，不打断主决策）
    if (u.rel && rng.chance(0.07) && this._trySocial(u)) return;
    const S = this._sc;
    this._assess(u, S, simplify);
    let best = ACT.CULTIVATE, bv = -1e9;
    for (let i = 0; i < 7; i++) if (S[i] > bv) { bv = S[i]; best = i; }
    u.lastAct = best;
    this._execAct(u, best);
  }

  /** 计算七种行为的基础倾向分 */
  _assess(u, S, simplify) {
    const w = this.world, rng = this.rng, pers = u.pers || (u.pers = [0.5, 0.5, 0.5, 0.5]);
    const hpR = clamp(u.hp / u.maxHp, 0, 1);
    const need = this.needFor(u);
    const prog = need === Infinity ? 1 : clamp(u.cult / need, 0, 1);
    for (let i = 0; i < 7; i++) S[i] = 0;

    // ① 遁走
    if (hpR < 0.6) S[ACT.FLEE] = (0.6 - hpR) * 1.7 * (0.4 + pers[0] * 1.6);
    // ② 苦修
    S[ACT.CULTIVATE] = 0.40 * (1.3 - pers[1] * 0.45) * (u.state === ST.CULTIVATE ? 1.18 : 1);
    // ③ 争锋
    u._foeCache = null;
    if (!(simplify && rng.chance(0.5)) && u.realm >= 0) {
      const foe = this._findFoe(u, u.realm >= 3 ? 12 : 8);
      if (foe) {
        u._foeCache = foe;
        const d = dist(u.x, u.y, foe.x, foe.y);
        let sc = (0.30 + Math.max(0, 1 - d / 14) * 0.45) * (0.35 + pers[1] * 1.7);
        if (u.mem && u.mem.foeId === foe.id) sc *= (u.mem.avenge ? 1.85 : 1.35);   // 身负血仇者更凶悍
        if (u.state === ST.FIGHT) sc *= 1.7;                  // 战意正浓，不会中途跑去打坐
        if (u.warSect != null && u.warSect === foe.sectId) sc *= 1.4;   // 正是征讨之敌
        S[ACT.FIGHT] = sc;
      }
    }
    // ④ 探秘
    u._caveCache = null;
    if (u.realm >= 2) {
      const cave = w.nearestSite(u.x, u.y, [5], 110);   // 洞天稀少，须放宽搜寻
      if (cave && cave.ownerUnit !== u.id) {
        u._caveCache = cave;
        S[ACT.EXPLORE] = 0.30 + pers[3] * 0.62;
      }
    }
    // ⑤ 拓业（占资源点）
    u._siteCache = null;
    if (u.realm >= 1) {
      const site = w.nearestSite(u.x, u.y, [1, 2, 3, 4], 30);
      if (site && site.owner < 0 && site.ownerUnit !== u.id) {
        u._siteCache = site;
        S[ACT.CLAIM] = 0.24 + pers[2] * 0.66;
      }
    }
    // ⑥ 冲关
    if (prog >= 1) S[ACT.BREAK] = 1.25;
    // ⑦ 游历（兜底）
    S[ACT.WANDER] = 0.16;
    // ⑧ 战时驻留：已出征者死守战区，无心他顾（否则会陆续溜回家打坐）
    if (u.warSect != null && this.ctx.sects) {
      const foeSect = this.ctx.sects.byId.get(u.warSect);
      const mySect = u.sectId >= 0 ? this.ctx.sects.byId.get(u.sectId) : null;
      // 只要战事未歇就驻留前线（不按距离判断，否则远距离宗门永远打不起来）
      if (foeSect && mySect && mySect.war) {
        S[ACT.FIGHT] = Math.max(S[ACT.FIGHT], 0.6);
        S[ACT.CULTIVATE] *= 0.4;
        S[ACT.CLAIM] *= 0.35;
        S[ACT.EXPLORE] *= 0.35;
        S[ACT.WANDER] *= 0.5;
      } else {
        u.warSect = null;    // 战事已了，收兵回山
      }
    }

    // —— 道统网络调制：tanh 输出映射到 [0.62, 1.38] 倍率 ——
    const pool = this.ctx.brains;
    if (pool) {
      this._fillInput(u, prog, hpR);
      pool.forward(pool.at(u.brainId).w, this._in, this._hid, this._out);
      for (let i = 0; i < 7; i++) S[i] *= 0.62 + (this._out[i] + 1) * 0.38;
    }

    // —— 硬性掩码：绝不出智障行为 ——
    if (prog < 1) S[ACT.BREAK] = 0;
    if (!u._foeCache) S[ACT.FIGHT] = 0;
    if (!u._caveCache) S[ACT.EXPLORE] = 0;
    if (!u._siteCache) S[ACT.CLAIM] = 0;
    if (hpR < 0.14) {   // 濒死只会跑
      S[ACT.FIGHT] = 0; S[ACT.EXPLORE] = 0; S[ACT.CLAIM] = 0; S[ACT.BREAK] = 0; S[ACT.WANDER] = 0;
      S[ACT.FLEE] = Math.max(S[ACT.FLEE], 1.4);
    }
  }

  /**
   * 世间因缘：拜师学艺、结为道侣。
   * 拜师需同门且对方高自己两个大境界；道侣需境界相近的单身者。
   */
  _trySocial(u) {
    const sects = this.ctx.sects;
    // ① 拜师
    if (u.rel.master < 0 && u.realm <= 4 && sects && u.sectId >= 0) {
      const s = sects.byId.get(u.sectId);
      if (s) {
        let best = null, bd = 500;
        for (const id of s.members) {
          const m = this.byId.get(id);
          if (!m || !m.alive || m === u || !m.rel) continue;
          if (m.realm < u.realm + 2) continue;
          if (m.rel.dis.length >= 5) continue;
          const d = dist(u.x, u.y, m.x, m.y);
          if (d < bd) { bd = d; best = m; }
        }
        if (best) {
          u.rel.master = best.id;
          best.rel.dis.push(u.id);
          this.ctx.events && this.ctx.events.add('divine',
            '✦ ' + best.name + ' 收 ' + u.name + ' 为徒（' + this.realmName(best) + '）');
          return true;
        }
      }
    }
    // ② 结为道侣
    if (u.rel.mate < 0 && u.age > 18) {
      let best = null, bd = 169;
      this.forEachNear(u.x, u.y, 13, (o) => {
        if (best || !o.alive || o.type !== U_TYPE.CULTIVATOR || o === u || !o.rel) return;
        if (o.rel.mate >= 0) return;
        if (Math.abs(o.realm - u.realm) > 1) return;
        if (u.sectId >= 0 && o.sectId >= 0 && o.sectId !== u.sectId) return;   // 只与同门或散修结缘
        const d = dist(o.x, o.y, u.x, u.y);
        if (d < bd) { bd = d; best = o; }
      });
      if (best) {
        u.rel.mate = best.id;
        best.rel.mate = u.id;
        u.rel.since = this.world.year;
        best.rel.since = this.world.year;
        this.ctx.events && this.ctx.events.add('divine',
          '❀ ' + u.name + ' 与 ' + best.name + ' 结为道侣，此后携手同修');
        return true;
      }
    }
    return false;
  }

  /** 组织神经网络输入（24 维） */
  _fillInput(u, prog, hpR) {
    const w = this.world, inp = this._in;
    const ix = clamp(Math.floor(u.x), 0, w.W - 1), iy = clamp(Math.floor(u.y), 0, w.H - 1);
    const i = w.idx(ix, iy);
    let foe = 0, ally = 0;
    this.forEachNear(u.x, u.y, 12, (o) => {
      if (!o.alive || o === u) return;
      if (o.type === U_TYPE.BEAST) { if (u.type !== U_TYPE.BEAST) foe++; else ally++; }
      else if (o.type === U_TYPE.CULTIVATOR && u.type === U_TYPE.CULTIVATOR) ally++;
    });
    const sec = (u.sectId >= 0 && this.ctx.sects) ? this.ctx.sects.byId.get(u.sectId) : null;
    const mem = u.mem || (u.mem = {});
    let k = 0;
    inp[k++] = hpR;
    inp[k++] = prog;
    inp[k++] = u.realm / 7;
    inp[k++] = u.daoHeart / 100;
    inp[k++] = clamp(u.age / u.life, 0, 1);
    inp[k++] = clamp(ROOTS[u.root].cult / 1.6, 0, 1);
    inp[k++] = u.isDemon ? 1 : 0;
    inp[k++] = w.aura[i] / 100;
    inp[k++] = w.demon[i] / 100;
    inp[k++] = w.ley[i] / 3;
    inp[k++] = clamp(foe / 5, 0, 1);
    inp[k++] = clamp(ally / 10, 0, 1);
    inp[k++] = u.sectId >= 0 ? 1 : 0;
    inp[k++] = sec ? clamp((sec.area || 0) / 500, 0, 1) : 0;
    inp[k++] = sec && sec.war ? 1 : 0;
    inp[k++] = clamp((u.stones || 0) / 5000, 0, 1);
    inp[k++] = clamp((mem.grudge || 0) / 8, 0, 1);
    const p = u.pers;
    inp[k++] = p[0]; inp[k++] = p[1]; inp[k++] = p[2]; inp[k++] = p[3];
    // 附近资源点/危险点的接近度
    inp[k++] = u._siteCache ? clamp(1 - dist(u.x, u.y, u._siteCache.x, u._siteCache.y) / 30, 0, 1) : 0;
    inp[k++] = u._caveCache ? clamp(1 - dist(u.x, u.y, u._caveCache.x, u._caveCache.y) / 70, 0, 1) : 0;
    inp[k++] = prog >= 1 ? 1 : 0;
    inp[k++] = 0.5;   // 预留
  }

  /** 执行选中的行为 */
  _execAct(u, act) {
    const w = this.world;
    switch (act) {
      case ACT.FLEE: {
        u.state = ST.FLEE; u.stateT = 0;
        const ang = Math.atan2(w.H / 2 - u.y, w.W / 2 - u.x) + this.rng.range(-1, 1);
        u.hx = clamp(u.x + Math.cos(ang) * 20, 2, w.W - 2);
        u.hy = clamp(u.y + Math.sin(ang) * 20, 2, w.H - 2);
        if (u.mem) { u.mem.dangerX = u.x; u.mem.dangerY = u.y; }
        break;
      }
      case ACT.FIGHT: {
        const foe = u._foeCache;
        if (!foe || !foe.alive) { u.state = ST.CULTIVATE; break; }
        u.target = foe.id;
        if (u.mem) u.mem.foeId = foe.id;
        u.state = ST.FIGHT; u.stateT = 0;
        u.hx = foe.x; u.hy = foe.y;
        break;
      }
      case ACT.EXPLORE: {
        const cave = u._caveCache;
        if (!cave) { u.state = ST.CULTIVATE; break; }
        u.state = ST.EXPLORE; u.hx = cave.x + 0.5; u.hy = cave.y + 0.5;
        u.exploreSite = cave.id;
        break;
      }
      case ACT.CLAIM: {
        const site = u._siteCache;
        if (!site) { u.state = ST.CULTIVATE; break; }
        u.state = ST.SEEK; u.hx = site.x + 0.5; u.hy = site.y + 0.5;
        u.claimSite = site.id;
        break;
      }
      case ACT.BREAK: {
        const spot = w.findCultSpot(u.x, u.y, 14, 18);
        u.state = ST.SEEK; u.hx = spot.x + 0.5; u.hy = spot.y + 0.5;
        break;
      }
      case ACT.WANDER: {
        this._wander(u, 16);
        u.state = ST.SEEK;
        break;
      }
      default: {   // 苦修
        // 出征在外的：先往敌方山门推进（没有对手就主动去找）
        if (u.warSect != null && this.ctx.sects) {
          const foeSect = this.ctx.sects.byId.get(u.warSect);
          if (foeSect && dist(u.x, u.y, foeSect.cx, foeSect.cy) > 5) {
            u.hx = foeSect.cx + this.rng.range(-4, 4);
            u.hy = foeSect.cy + this.rng.range(-4, 4);
            u.state = ST.SEEK;
            break;
          }
        }
        const cur = w.auraAt(Math.floor(u.x), Math.floor(u.y));
        const spot = w.findCultSpot(u.x, u.y, CFG.sim.viewAuraRange, 20);
        if (spot.v > cur + 5 || u.state !== ST.CULTIVATE) {
          u.state = ST.SEEK; u.hx = spot.x + 0.5; u.hy = spot.y + 0.5;
          if (u.mem) { u.mem.safeX = spot.x; u.mem.safeY = spot.y; u.mem.safeAura = spot.v; }
        } else {
          u.state = ST.CULTIVATE;
        }
        break;
      }
    }
  }

  _decideBeast(u) {
    // ★ 兽道网络评分决策（下方旧规则链保留备查，不再执行）
    this._decideBeastScored(u);
    return;
    /* eslint-disable no-unreachable */
    const w = this.world, eco = CFG.eco;
    if (u.hunger == null) u.hunger = 30;
    const counts = this._counts || (this._counts = this.countTypes());
    const beastCap = Math.max(18, Math.floor((counts.cult || 100) * 0.5));
    // ① 饥不择食：饿疯了就主动扑击修士（哪怕打不过）
    if (u.hunger > eco.hungerHunt) {
      const prey = this._findFoe(u, 20);
      if (prey) { u.target = prey.id; u.state = ST.FIGHT; u.stateT = 0; u.hx = prey.x; u.hy = prey.y; return; }
      this._wander(u, 22);
      u.state = ST.SEEK;
      return;
    }
    // ② 常规觅食：先猎弱猎物，再找草木（走过去吃）
    if (u.hunger > eco.hungerForage) {
      const prey = this._findFoe(u, u.beastTier >= 3 ? 14 : 9);
      if (prey) { u.target = prey.id; u.state = ST.FIGHT; u.stateT = 0; u.hx = prey.x; u.hy = prey.y; return; }
      const grass = this._findPlant(u, 18);
      if (grass) { u.hx = grass.x; u.hy = grass.y; u.state = ST.SEEK; return; }
      this._wander(u, 16);
      u.state = ST.SEEK;
      return;
    }
    // ③ 吃饱了才繁衍（饿着肚子生不出崽）
    if (u.hunger < 45 && u.mateCd <= 0 && counts.beast < beastCap && this.list.length < CFG.sim.maxUnits * 0.92) {
      let mate = null;
      this.forEachNear(u.x, u.y, 6, (o) => {
        if (mate || o.type !== U_TYPE.BEAST || !o.alive || o === u) return;
        if (o.beastTier !== u.beastTier || o.mateCd > 0) return;
        if (dist(o.x, o.y, u.x, u.y) < 6) mate = o;
      });
      if (mate) {
        u.mateCd = 26; mate.mateCd = 26;
        u.hunger += 25; mate.hunger += 25;   // 生育耗神，须重新觅食
        const baby = this.spawn(U_TYPE.BEAST, Math.floor((u.x + mate.x) / 2), Math.floor((u.y + mate.y) / 2), { tier: Math.max(1, u.beastTier - 1) });
        if (baby) {
          counts.beast++;
          this.ctx.events && this.ctx.events.add('birth', '妖兽繁衍：' + baby.name + ' 降生');
        }
        return;
      }
    }
    // 野性繁衍：凶兽生命力顽强，无偶亦可产仔（否则被修士屠尽）
    const cap2 = Math.max(18, Math.floor(((this._counts && this._counts.cult) || 100) * 0.5));
    if (u.hunger < 40 && u.mateCd <= 0 && counts.beast < cap2 && this.rng.chance(0.038)) {
      u.mateCd = 22;
      const baby = this.spawn(U_TYPE.BEAST, Math.floor(u.x), Math.floor(u.y), { tier: Math.max(1, u.beastTier - 1) });
      if (baby) {
        counts.beast++;
        if (this.rng.chance(0.2)) this.ctx.events && this.ctx.events.add('birth', '凶兽生息：' + baby.name + ' 现世');
      }
      return;
    }
    // 游荡
    if (u.state !== ST.WANDER && u.state !== ST.SEEK) {
      this._wander(u, u.beastTier >= 3 ? 26 : 14);
      u.state = ST.SEEK;
    } else if (this.rng.chance(0.4)) {
      this._wander(u, u.beastTier >= 3 ? 26 : 14);
    }
  }

  _wander(u, r) {
    const w = this.world;
    for (let k = 0; k < 8; k++) {
      const x = clamp(Math.round(u.x + this.rng.range(-r, r)), 2, w.W - 3);
      const y = clamp(Math.round(u.y + this.rng.range(-r, r)), 2, w.H - 3);
      if (w.passable(x, y)) { u.hx = x + 0.5; u.hy = y + 0.5; return; }
    }
    u.hx = u.x; u.hy = u.y;
  }

  /* ================= 兽道：妖兽的评分制决策 ================= */

  /** 妖兽七艺的倾向评分 → 选最高者执行 */
  _decideBeastScored(u) {
    const eco = CFG.eco;
    if (u.hunger == null) u.hunger = 30;
    if (!u.pers) u.pers = [0.5, 0.5, 0.5, 0.4];
    const S = this._sc;
    for (let i = 0; i < 7; i++) S[i] = 0;
    const hpR = clamp(u.hp / u.maxHp, 0, 1);
    const pers = u.pers;
    const counts = this._counts || (this._counts = this.countTypes());
    const beastCap = Math.max(18, Math.floor((counts.cult || 100) * 0.5));

    // 各行为的原料
    u._foeCache = (u.hunger > eco.hungerHunt) ? this._findFoe(u, 20) : this._findFoe(u, u.beastTier >= 3 ? 14 : 9);
    u._grassCache = u.hunger > 25 ? this._findPlant(u, 18) : null;
    let threat = null;
    this.forEachNear(u.x, u.y, 9, (o) => {
      if (threat || !o.alive || o === u) return;
      if (o.type === U_TYPE.CULTIVATOR && o.cp > u.cp * 2.5) threat = o;
      if (o.type === U_TYPE.BEAST && o.beastTier > u.beastTier + 1) threat = o;
    });
    u._threat = threat;

    // ① 觅食（吃草）
    if (u._grassCache) S[0] = (0.25 + Math.min(0.7, u.hunger / 100)) * (0.5 + pers[2] * 1.3);
    // ② 猎杀
    if (u._foeCache) S[1] = (0.2 + Math.min(0.7, u.hunger / 110)) * (0.35 + pers[0] * 1.7);
    // ③ 逃遁
    if (u._threat) S[2] = (0.35 + (1 - hpR) * 0.8) * (0.35 + pers[1] * 1.7);
    if (hpR < 0.30) S[2] = Math.max(S[2], 1.15);
    // ④ 游荡
    S[3] = 0.16;
    // ⑤ 繁衍（须吃饱）
    if (u.hunger < 45 && u.mateCd <= 0 && counts.beast < beastCap) S[4] = 0.45 + pers[3] * 0.25;
    // ⑥ 守地盘
    S[5] = 0.1 + pers[0] * 0.18;
    // ⑦ 蛰伏（饿极时保留体力）
    if (u.hunger > 85) S[6] = 0.4;

    // —— 兽道网络调制 ——
    const pool = this.ctx.beastBrains;
    if (pool) {
      this._fillBeastInput(u, hpR, counts);
      pool.forward(pool.at(u.brainId).w, this._in, this._hid, this._out);
      for (let i = 0; i < 7; i++) S[i] *= 0.62 + (this._out[i] + 1) * 0.38;
    }
    // —— 掩码 ——
    if (!u._grassCache) S[0] = 0;
    if (!u._foeCache) S[1] = 0;
    if (!u._threat && hpR > 0.3) S[2] = 0;
    if (u.hunger >= 85) { S[1] *= 0.6; S[4] = 0; }   // 饿肚子不想生崽

    let best = 3, bv = -1e9;
    for (let i = 0; i < 7; i++) if (S[i] > bv) { bv = S[i]; best = i; }
    u.lastAct = best;
    this._execBeastAct(u, best);
  }

  _fillBeastInput(u, hpR, counts) {
    const w = this.world, inp = this._in, pers = u.pers || [0.5, 0.5, 0.5, 0.4];
    const ix = clamp(Math.floor(u.x), 0, w.W - 1), iy = clamp(Math.floor(u.y), 0, w.H - 1);
    const i = w.idx(ix, iy);
    let same = 0, men = 0, strong = 0;
    this.forEachNear(u.x, u.y, 12, (o) => {
      if (!o.alive || o === u) return;
      if (o.type === U_TYPE.BEAST) { same++; if (o.beastTier > u.beastTier) strong++; }
      else if (o.type === U_TYPE.CULTIVATOR) men++;
    });
    const mem = u.mem || (u.mem = { lastEat: 0, lastHurt: 0 });
    let k = 0;
    inp[k++] = hpR;
    inp[k++] = clamp((u.hunger || 0) / 100, 0, 1);
    inp[k++] = (u.beastTier || 1) / 5;
    inp[k++] = clamp(u.age / u.life, 0, 1);
    inp[k++] = clamp(u.cp / 500, 0, 1);
    inp[k++] = u._grassCache ? 1 : 0;
    inp[k++] = w.aura[i] / 100;
    inp[k++] = w.demon[i] / 100;
    inp[k++] = clamp(men / 5, 0, 1);
    inp[k++] = clamp(same / 10, 0, 1);
    inp[k++] = clamp(strong / 5, 0, 1);
    inp[k++] = u._foeCache ? clamp(1 - dist(u.x, u.y, u._foeCache.x, u._foeCache.y) / 20, 0, 1) : 0;
    inp[k++] = u._threat ? clamp(1 - dist(u.x, u.y, u._threat.x, u._threat.y) / 12, 0, 1) : 0;
    inp[k++] = 1;
    inp[k++] = 0;
    inp[k++] = clamp((u.food || 0) / 600, 0, 1);
    inp[k++] = 0; inp[k++] = 0;
    inp[k++] = pers[0]; inp[k++] = pers[1]; inp[k++] = pers[2]; inp[k++] = pers[3];
    inp[k++] = clamp((counts.cult || 0) / 300, 0, 1);
    inp[k++] = clamp((counts.beast || 0) / 200, 0, 1);
  }

  _execBeastAct(u, act) {
    const eco = CFG.eco;
    switch (act) {
      case 0: {   // 觅食
        const g = u._grassCache;
        if (!g) { u.state = ST.WANDER; break; }
        u.hx = g.x; u.hy = g.y;
        u.state = ST.SEEK;
        break;
      }
      case 1: {   // 猎杀
        const f = u._foeCache;
        if (!f) { u.state = ST.WANDER; break; }
        u.target = f.id;
        u.state = ST.FIGHT; u.stateT = 0;
        u.hx = f.x; u.hy = f.y;
        break;
      }
      case 2: {   // 逃遁（远离威胁）
        const t = u._threat;
        u.state = ST.FLEE; u.stateT = 0;
        if (t) {
          const ang = Math.atan2(u.y - t.y, u.x - t.x) + this.rng.range(-0.5, 0.5);
          u.hx = clamp(u.x + Math.cos(ang) * 22, 2, this.world.W - 2);
          u.hy = clamp(u.y + Math.sin(ang) * 22, 2, this.world.H - 2);
        } else {
          this._wander(u, 20);
        }
        break;
      }
      case 4: {   // 繁衍
        const counts = this._counts || (this._counts = this.countTypes());
        const beastCap = Math.max(18, Math.floor((counts.cult || 100) * 0.5));
        let mate = null;
        this.forEachNear(u.x, u.y, 6, (o) => {
          if (mate || o.type !== U_TYPE.BEAST || !o.alive || o === u) return;
          if (o.beastTier !== u.beastTier || o.mateCd > 0) return;
          if (dist(o.x, o.y, u.x, u.y) < 6) mate = o;
        });
        if (mate && counts.beast < beastCap) {
          u.mateCd = 26; mate.mateCd = 26;
          u.hunger += 25; mate.hunger += 25;
          const baby = this.spawn(U_TYPE.BEAST, Math.floor((u.x + mate.x) / 2), Math.floor((u.y + mate.y) / 2), { tier: Math.max(1, u.beastTier - 1) });
          if (baby) {
            counts.beast++;
            this.ctx.events && this.ctx.events.add('birth', '妖兽繁衍：' + baby.name + ' 降生');
          }
        } else if (u.mateCd <= 0 && counts.beast < beastCap && this.rng.chance(0.04)) {
          u.mateCd = 22; u.hunger += 25;
          const baby = this.spawn(U_TYPE.BEAST, Math.floor(u.x), Math.floor(u.y), { tier: Math.max(1, u.beastTier - 1) });
          if (baby) counts.beast++;
        }
        u.state = ST.WANDER;
        break;
      }
      case 5: {   // 守地盘：原地盘桓
        this._wander(u, 5);
        u.state = ST.SEEK;
        break;
      }
      case 6: {   // 蛰伏
        u.state = ST.IDLE;
        break;
      }
      default: {  // 游荡
        this._wander(u, u.beastTier >= 3 ? 26 : 14);
        u.state = ST.SEEK;
        break;
      }
    }
  }

  /** 寻最近的活植被（妖兽觅食用） */
  _findPlant(u, range) {
    const w = this.world;
    const cx = Math.floor(u.x / 16), cy = Math.floor(u.y / 16);
    const R = Math.ceil(range / 16) + 1;
    let best = null, bd = range * range;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const arr = w.decorChunks.get((cy + dy) * w._chunkW + (cx + dx));
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const d = arr[k];
          if (!d.alive) continue;
          const dd = (d.x - u.x) * (d.x - u.x) + (d.y - u.y) * (d.y - u.y);
          if (dd < bd) { bd = dd; best = d; }
        }
      }
    }
    return best;
  }

  /** 遍历空间网格中给定半径内的单位（替代 O(n) 全表扫描） */
  forEachNear(x, y, range, cb) {
    const CW = this.gCell, GW = this.gW;
    const c0x = Math.max(0, ((x - range) / CW) | 0), c1x = ((x + range) / CW) | 0;
    const c0y = Math.max(0, ((y - range) / CW) | 0), c1y = ((y + range) / CW) | 0;
    const grid = this.grid;
    for (let cy = c0y; cy <= c1y; cy++) {
      const row = cy * GW;
      for (let cx = c0x; cx <= c1x; cx++) {
        const arr = grid.get(row + cx);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) cb(arr[k]);
      }
    }
  }

  /** 寻找敌对目标（走空间网格，数量再多也不会拖垮） */
  _findFoe(u, range) {
    // 正在交战的宗门，门人视野放宽（战场上到处都是敌人）
    if (u.sectId >= 0 && this.ctx.sects) {
      const s = this.ctx.sects.byId.get(u.sectId);
      if (s && s.war) range = Math.min(20, range * 1.8);
    }
    let best = null, bd = range * range;
    const list = this.list;
    const heavy = list.length > CFG.sim.lodHeavy;
    this.forEachNear(u.x, u.y, range, (o) => {
      if (!o.alive || o === u || o.type === U_TYPE.PLANT) return;
      const d = (o.x - u.x) * (o.x - u.x) + (o.y - u.y) * (o.y - u.y);
      if (d > bd) return;
      // 敌对判定
      let hostile = false;
      if (u.type === U_TYPE.BEAST) hostile = (o.type === U_TYPE.CULTIVATOR) || (o.type === U_TYPE.BEAST && o.beastTier > u.beastTier + 1);
      else if (o.type === U_TYPE.BEAST) hostile = o.beastTier >= 2 || u.realm >= 1;
      else hostile = (o.isDemon !== u.isDemon);
      if (!hostile && !heavy && this.ctx.sects && u.sectId >= 0 && o.sectId >= 0) {
        hostile = this.ctx.sects.hostile(u.sectId, o.sectId);
      }
      if (!hostile) return;
      // 实力差距过大则不主动（妖兽畏强）
      if (u.type === U_TYPE.BEAST && o.type === U_TYPE.CULTIVATOR && o.cp > u.cp * 3) return;
      if (d < bd) { bd = d; best = o; }
    });
    return best;
  }
}

export default Units;

/* ================= 每帧：移动与战斗（追加） ================= */
Units.prototype.updateMotion = function (dt) {
  const list = this.list;
  const n = list.length;
  // 空间网格维护：数量越多重建越稀疏（单位移动缓慢，粗粒度足够）
  this._gridFrame = (this._gridFrame || 0) + 1;
  const gEvery = n > CFG.sim.lodExtreme ? 14 : (n > CFG.sim.lodHeavy ? 8 : 5);
  if (this._gridFrame >= gEvery) this.rebuildGrid();

  const mul = this.ctx.moveMul || 1;
  let step = dt * mul;
  let start = 0, end = n;
  // 极端数量下分两批隔帧更新（步长×2 补偿，视觉几乎无差别）
  if (n > CFG.sim.lodExtreme) {
    const groups = n > 4200 ? 3 : 2;          // 越多分得越细
    const chunk = Math.ceil(n / groups);
    const g = (this._motionPhase = ((this._motionPhase || 0) + 1) % groups);
    start = g * chunk;
    end = Math.min(n, start + chunk);
    step *= groups;
  }
  for (let i = start; i < end; i++) {
    const u = list[i];
    if (!u.alive) continue;
    if (u.type === U_TYPE.PLANT) continue;
    u.stateT += dt;
    if (u.state === ST.TRIB) continue;   // 渡劫由年度逻辑推进
    if (u.atkCd > 0) u.atkCd -= dt;

    switch (u.state) {
      case ST.FIGHT: this._fightMove(u, step); break;
      case ST.SEEK: case ST.WANDER: case ST.FLEE: case ST.EXPLORE: case ST.EXPAND:
        if (this._move(u, step)) this._onArrive(u);
        break;
      case ST.CULTIVATE: case ST.IDLE: case ST.FOUND:
        break;
      default: break;
    }
  }
};

/** 朝目标移动，返回是否到达 */
Units.prototype._move = function (u, step) {
  const w = this.world;
  const dx = u.hx - u.x, dy = u.hy - u.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.35) return true;
  const R = REALMS[u.realm];
  let spd = (u.type === U_TYPE.BEAST ? 1.6 + u.beastTier * 0.5 : R.move);
  if (u.state === ST.FLEE) spd *= 1.55;   // 亡命奔逃，须快过凶兽
  const s = Math.min(step * spd, d);
  const nx = u.x + dx / d * s, ny = u.y + dy / d * s;
  const gx = Math.floor(nx), gy = Math.floor(ny);
  if (w.passable(gx, gy)) { u.x = nx; u.y = ny; return false; }
  if (w.passable(gx, Math.floor(u.y))) { u.x = nx; return false; }
  if (w.passable(Math.floor(u.x), gy)) { u.y = ny; return false; }
  this._wander(u, 6);
  return false;
};

Units.prototype._onArrive = function (u) {
  const w = this.world;
  // —— 奉宗门之命拓土：抵达后就地立桩，疆土随人而增 ——
  if (u.state === ST.EXPAND && u.expedition) {
    const sects = this.ctx.sects;
    if (sects) {
      const s = sects.byId.get(u.expedition.sectId);
      if (s) {
        if (s.expeditions) {
          const i = s.expeditions.indexOf(u.id);
          if (i >= 0) s.expeditions.splice(i, 1);
        }
        sects.claimArea(u, u.expedition.tx, u.expedition.ty, 2);
      }
    }
    u.expedition = null;
    u.state = ST.CULTIVATE;      // 立桩后就在此打坐镇守
    u.decideT = 3;
    return;
  }
  if (u.state === ST.EXPLORE && u.exploreSite != null) {
    const site = w.sites[u.exploreSite];
    if (site && dist(u.x, u.y, site.x, site.y) < site.r + 2) {
      const roll = this.rng.next();
      if (roll < 0.33) {
        const tier = Math.min(4, 2 + Math.floor(u.realm / 2));
        u.arts.push({ tier, kind: this.rng.int(0, 3) });
        this.ctx.events && this.ctx.events.add('divine', '✦ ' + u.name + ' 于洞天福地寻得「' + ARTIFACT_TIERS[tier].n + '」一件');
      } else if (roll < 0.58) {
        u.tech = Math.min(4, (u.tech || 0) + 1);
        this.ctx.events && this.ctx.events.add('divine', '✦ ' + u.name + ' 参悟上古传承，功法晋升「' + TECH_TIERS[u.tech].n + '」');
      } else if (roll < 0.72) {
        // 大机缘·洗髓伐骨：返老还童，足以救资质不足者一命
        const back = Math.round(u.age * 0.45);
        u.age = Math.max(12, u.age - back);
        u.daoHeart = clamp(u.daoHeart + 8, 0, 100);
        u.flags |= 2;
        this.ctx.events && this.ctx.events.add('divine',
          '✦ ' + u.name + ' 于洞天中洗髓伐骨，返老还童 ' + back + ' 载，仙途再续');
      } else {
        u.flags |= 2;
        u.daoHeart = clamp(u.daoHeart + 12, 0, 100);
        this.ctx.events && this.ctx.events.add('divine', '✦ ' + u.name + ' 于洞天中悟道，道心大进');
      }
      this._setRealm(u, u.realm, u.stage);
      u.exploreSite = null;
      u.state = ST.IDLE; u.decideT = 2;
      return;
    }
    u.state = ST.IDLE; u.decideT = 0;
    return;
  }
  if (u.state === ST.SEEK && u.claimSite != null) {
    const site = w.sites[u.claimSite];
    if (site && site.owner < 0 && dist(u.x, u.y, site.x, site.y) < site.r + 2) {
      site.ownerUnit = u.id;
      u.claimSite = null;
      if (u.realm >= 1 && this.rng.chance(0.45)) {
        this.ctx.events && this.ctx.events.add('divine', '⚑ ' + u.name + ' 占据了一处' + ({ 1: '灵脉', 2: '矿脉', 3: '灵田', 4: '药谷' })[site.type]);
      }
    }
    u.claimSite = null;
    u.state = ST.CULTIVATE; u.decideT = 1.5;
    return;
  }
  if (u.state === ST.FLEE) { u.state = ST.IDLE; u.decideT = 0.5; return; }
  u.state = ST.CULTIVATE;
  u.decideT = Math.min(u.decideT, 1.2);
};

Units.prototype._fightMove = function (u, step) {
  let t = this.byId.get(u.target);
  if (!t || !t.alive) {
    // 对手已殒命 —— 战场上立刻寻找下一个，方能连番厮杀（而非打一场就散）
    const foe = this._findFoe(u, 16);
    if (foe) {
      t = foe;
      u.target = foe.id;
      u.state = ST.FIGHT;
      u.stateT = 0;
    } else {
      u.target = -1; u.state = ST.IDLE; u.decideT = 0;
      return;
    }
  }
  const d = dist(u.x, u.y, t.x, t.y);
  if (d > 1.9) {
    u.hx = t.x; u.hy = t.y;
    this._move(u, step);
  } else if (u.atkCd <= 0) {
    u.atkCd = 0.5;
    this._strike(u, t);
  }
};

Units.prototype._strike = function (a, d) {
  const atk = a.cp, def = d.cp;
  const dmg = atk * 12 * this.rng.range(0.85, 1.15) / (1 + (def / (atk + 0.01)) * 0.8);
  d.hp -= dmg;
  if (this.ctx.fx) {
    this.ctx.fx.slash(a.x, a.y, d.x, d.y, a.isDemon ? '#ff9090' : '#fff3c0');
    this.ctx.fx.hit((a.x + d.x) / 2, (a.y + d.y) / 2, atk > def ? '#ffd24a' : '#ff8080');
  }
  if (d.hp <= 0) {
    a.kills = (a.kills || 0) + 1;
    // 妖兽进食：猎杀得手后饱餐一顿（这是它们进化的能量来源）
    if (a.type === U_TYPE.BEAST && d.type !== U_TYPE.PLANT) {
      a.hunger = Math.max(0, (a.hunger || 0) - CFG.eco.hungerKill);
      a.food = (a.food || 0) + CFG.eco.hungerKill;
    }
    // 血仇：死者的师门、道侣、门下都会记恨凶手，并带着复仇之志
    if (d.rel) {
      const av = [];
      if (d.rel.master >= 0) av.push(d.rel.master);
      if (d.rel.mate >= 0) av.push(d.rel.mate);
      if (d.rel.dis) for (const x of d.rel.dis) av.push(x);
      let n = 0;
      for (const aid of av) {
        const t2 = this.byId.get(aid);
        if (t2 && t2.alive && t2.mem) {
          t2.mem.grudge = Math.min(30, (t2.mem.grudge || 0) + 8);
          t2.mem.foeId = a.id;
          t2.mem.avenge = 1;
          n++;
        }
      }
      if (n && this.rng.chance(0.4)) {
        this.ctx.events && this.ctx.events.add('death', '⚔ ' + d.name + ' 陨落，其师门誓要寻 ' + a.name + ' 雪仇');
      }
    }
    this.kill(d, '斗法身亡');
    if (a.type === U_TYPE.CULTIVATOR && d.type === U_TYPE.CULTIVATOR) {
      a.stones += (d.stones || 0) * 0.5;
      if (a.isDemon && this.rng.chance(0.6)) {
        a.cult += (d.cult || 0) * 0.25 + REALMS[d.realm].need * 0.05;
        this.ctx.events && this.ctx.events.add('disaster', '☠ ' + a.name + ' 吞噬 ' + d.name + ' 精血，修为暴涨');
      }
      if (d.arts && d.arts.length && this.rng.chance(0.4)) a.arts.push(d.arts[0]);
    }
    a.target = -1; a.state = ST.IDLE; a.decideT = 0.5;
  } else if (d.state !== ST.FIGHT && d.state !== ST.FLEE && d.type !== U_TYPE.PLANT) {
    d.target = a.id;
    d.state = ST.FIGHT;
    d.stateT = 0;
  }
  // 记仇：被打过的人会认人，下次见面分外眼红
  if (d.mem && a.type !== 1) {
    d.mem.grudge = Math.min(20, (d.mem.grudge || 0) + 2);
    d.mem.foeId = a.id;
  }
  // 高阶斗法殃及四野：草木尽毁，大能交手甚至把地打凹
  if (a.realm >= 3 && this.rng.chance(0.22)) {
    const w = this.world;
    const mx = (a.x + d.x) / 2, my = (a.y + d.y) / 2;
    w.burnDecor(mx, my, 2.2, 0.5);
    if (a.realm >= 5 && this.rng.chance(0.3)) {
      w.shapeTerrain(mx, my, 1.6, -0.004);
      this.ctx.fx && this.ctx.fx.terrainPuff(mx, my, '#b09878', 6);
    }
  }
};

/* ================= 查询与统计 ================= */
Units.prototype.stats = function () {
  let cult = 0, beast = 0, plant = 0, demon = 0, high = 0, sumRealm = 0;
  for (const u of this.list) {
    if (!u.alive) continue;
    if (u.type === U_TYPE.CULTIVATOR) { cult++; sumRealm += u.realm; if (u.isDemon) demon++; if (u.realm >= 3) high++; }
    else if (u.type === U_TYPE.BEAST) beast++;
    else plant++;
  }
  return { cult, beast, plant, demon, high, avgRealm: cult ? sumRealm / cult : 0, total: this.list.length };
};

Units.prototype.top = function (n) {
  const t = performance.now();
  const n0 = this.list.length;
  // UI 每 0.4 秒就会拉一次榜单，数量大时排序很贵 → 结果缓存 1.5 秒
  if (this._topCache && this._topN === n0 && t - (this._topT || 0) < 1500) {
    return this._topCache.slice(0, n);
  }
  const arr = [];
  for (const u of this.list) if (u.alive && u.type === U_TYPE.CULTIVATOR) arr.push(u);
  arr.sort((a, b) => (b.realm * 100 + b.stage) - (a.realm * 100 + a.stage));
  this._topCache = arr; this._topT = t; this._topN = n0;
  return arr.slice(0, n);
};

Units.prototype.at = function (x, y, r) {
  const rr = r || 3, r2 = rr * rr;
  const out = [];
  // 走空间网格，避免在成千上万单位里做线性扫描
  this.forEachNear(x, y, rr, (u) => {
    if (!u.alive) return;
    const d = (u.x - x) * (u.x - x) + (u.y - y) * (u.y - y);
    if (d <= r2) out.push(u);
  });
  const D = (a) => (a.x - x) * (a.x - x) + (a.y - y) * (a.y - y);
  out.sort((a, b) => D(a) - D(b));
  return out;
};

/** 拾取：tol 为容差半径（格），随缩放自适应，触摸屏也能点中 */
Units.prototype.pick = function (x, y, tol) {
  const list = this.at(x, y, tol || 3);
  for (const u of list) if (u.type === U_TYPE.CULTIVATOR) return u;
  return list[0] || null;
};

/** 统计某单位附近的同类数量（详情面板用） */
Units.prototype.nearCount = function (u, r) {
  let n = 0;
  this.forEachNear(u.x, u.y, r || 12, (o) => {
    if (o !== u && o.alive && o.type === u.type) n++;
  });
  return n;
};

Units.prototype.boostRealm = function (u) {
  if (u.type !== U_TYPE.CULTIVATOR) return false;
  if (u.stage < 3) { u.stage++; this._setRealm(u, u.realm, u.stage); }
  else if (u.realm < MAX_REALM) { this._setRealm(u, u.realm + 1, 0); }
  else return false;
  u.cult = 0;
  u.hp = u.maxHp;
  u.daoHeart = clamp(u.daoHeart + 6, 0, 100);
  return true;
};

Units.prototype.reincarnate = function (u) {
  if (u.type !== U_TYPE.CULTIVATOR) return false;
  this._setRealm(u, 0, 0);
  u.cult = 0;
  u.age = 0;
  u.daoHeart = clamp(u.daoHeart + 20, 0, 100);
  u.flags |= 16;
  u.root = Math.max(0, u.root - 1);
  u.hp = u.maxHp;
  return true;
};
