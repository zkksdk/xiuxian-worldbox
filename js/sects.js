/**
 * sects.js —— 宗门、领地、正魔分化、宗门战争
 */
import { CFG, REALMS } from './config.js';
import { clamp, dist, hsl } from './util.js';
import { inheritPersona } from './brain.js';

// 与 units.js 的单位状态常量保持一致（用字面量避免模块循环依赖）
const ST_SEEK = 'seek', ST_EXPAND = 'expand';
const ST_FIGHT = 'fight', ST_FLEE = 'flee', ST_TRIB = 'trib';

export class Sects {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = [];
    this.byId = new Map();
    this.nextId = 1;
    this.hue = ctx.rng.range(0, 360);
    this.territoryGrid = new Int16Array(ctx.world.W * ctx.world.H).fill(-1);
  }

  get world() { return this.ctx.world; }

  nearby(x, y, r, demonic) {
    let best = null, bd = r * r;
    for (const s of this.list) {
      if (s.demonic !== demonic) continue;
      const d = (s.cx - x) * (s.cx - x) + (s.cy - y) * (s.cy - y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  hostile(aId, bId) {
    if (aId < 0 || bId < 0) return false;
    const a = this.byId.get(aId), b = this.byId.get(bId);
    if (!a || !b) return false;
    if (a.demonic !== b.demonic) return true;    // 正魔不两立
    return a.enemies.has(bId);
  }

  /** 尝试立宗（需要附近有足够无宗修士响应） */
  tryFound(u) {
    let support = 0;
    // 走空间网格，避免在成千上万单位里做全表扫描
    this.ctx.units.forEachNear(u.x, u.y, 14, (o) => {
      if (!o.alive || o === u || o.type !== 0 || o.sectId >= 0) return;
      if (dist(o.x, o.y, u.x, u.y) < 14) support++;
    });
    if (support < CFG.sect.foundNeighbors) return false;
    for (const s of this.list) {
      if (dist(s.cx, s.cy, u.x, u.y) < 22) return false;   // 太近，不重复立宗
    }
    const demonic = u.isDemon;
    const sect = this.create(u.x, u.y, u, demonic);
    // 招募响应者（同样走网格）
    const recruits = [];
    this.ctx.units.forEachNear(u.x, u.y, 14, (o) => {
      if (!o.alive || o === u || o.type !== 0 || o.sectId >= 0) return;
      if (dist(o.x, o.y, u.x, u.y) < 14 && this.rngChance(0.75)) recruits.push(o);
    });
    for (let i = 0; i < recruits.length; i++) this.join(sect, recruits[i]);
    return true;
  }

  rngChance(p) { return this.ctx.rng.chance(p); }

  create(x, y, leader, demonic) {
    this.hue = (this.hue + 47 + this.ctx.rng.range(0, 30)) % 360;
    const s = {
      id: this.nextId++,
      name: this.ctx.units.namer.sect(demonic),
      color: demonic ? hsl(340 + this.ctx.rng.range(-20, 20), 60, 45) : hsl(this.hue, 55, 52),
      demonic, level: 1,
      leaderId: leader.id,
      members: [],
      cx: x, cy: y, radius: 13, maxR: 24,
      area: 0, frontier: [], expeditions: [],
      founded: this.world.year,
      res: { stones: 60, herbs: 10, ores: 5 },
      sites: [], enemies: new Set(), allies: new Set(),
      war: null, power: 0,
    };
    this.list.push(s);
    this.byId.set(s.id, s);
    leader.sectId = s.id;
    s.members.push(leader.id);
    s.leaderName = leader.name;
    this.ctx.events.add('sect', (demonic ? '☠ 魔道「' : '⛩ 「') + s.name + (demonic ? '」' : '」') +
      ' 于 ' + this.placeName(x, y) + ' 立下道统，' + leader.name + ' 为开宗祖师');
    this.ctx.fx && this.ctx.fx.sectFound(x, y, s.color);
    this._initTerritory(s);
    return s;
  }

  placeName(x, y) {
    const w = this.world;
    const b = w.biomeAt(Math.floor(x), Math.floor(y));
    const n = ['青云峰', '黑风谷', '赤炎岭', '寒潭', '万兽林', '紫雷原', '幽泉涧', '九霄崖',
               '落霞涧', '苍梧山', '玄冰谷', '碎星崖'];
    return n[(Math.floor(x / 24) * 7 + Math.floor(y / 24) * 3) % n.length];
  }

  join(s, u) {
    if (u.sectId === s.id) return;
    if (u.sectId >= 0) this.leaveSect(u, false);
    u.sectId = s.id;
    s.members.push(u.id);
    // 门风：弟子性格向宗主靠拢，所习道统（打法）亦随师门
    const leader = this.ctx.units.byId.get(s.leaderId);
    if (leader) {
      if (leader.pers && u.pers) inheritPersona(u.pers, leader.pers, this.ctx.rng, 0.32);
      if (leader.brainId != null) u.brainId = leader.brainId;
    }
    if (s.members.length === 4) {
      this.ctx.events.add('sect', '「' + s.name + '」广纳门徒，初具规模');
    }
    if (s.members.length === 20) {
      this.ctx.events.add('sect', '「' + s.name + '」声势日隆，晋为一方大派');
    }
  }

  leaveSect(u, silent) {
    if (u.sectId < 0) return;
    const s = this.byId.get(u.sectId);
    if (s) {
      const i = s.members.indexOf(u.id);
      if (i >= 0) s.members.splice(i, 1);
      if (s.leaderId === u.id && s.members.length) {
        s.leaderId = s.members[0];
      }
    }
    u.sectId = -1;
  }

  onUnitDeath(u) {
    if (u.sectId < 0) return;
    const s = this.byId.get(u.sectId);
    if (!s) { u.sectId = -1; return; }
    const i = s.members.indexOf(u.id);
    if (i >= 0) s.members.splice(i, 1);
    if (s.leaderId === u.id) {
      if (s.members.length === 0) { this.dissolve(s, '宗主陨落，门中无人'); return; }
      const nl = this.ctx.units.byId.get(s.members[0]);
      s.leaderId = s.members[0];
      s.leaderName = nl ? nl.name : '无名';
      this.ctx.events.add('sect', '「' + s.name + '」宗主陨落，' + (nl ? nl.name : '新主') + ' 继任');
    }
    if (s.members.length === 0) this.dissolve(s, '门中凋零');
  }

  dissolve(s, why) {
    const i = this.list.indexOf(s);
    if (i >= 0) this.list.splice(i, 1);
    this.byId.delete(s.id);
    for (const u of this.ctx.units.list) if (u.sectId === s.id) u.sectId = -1;
    this.ctx.events.add('sect', '「' + s.name + '」' + why + '，山门就此闭绝');
  }

  /** 立宗：山门周围一圈立为根基，并建立扩张前沿 */
  _initTerritory(s) {
    const W = this.world.W, H = this.world.H, g = this.territoryGrid;
    const cx = Math.round(s.cx), cy = Math.round(s.cy);
    s.frontier = [];
    s.area = 0;
    s.maxR = 16 + s.level * 5 + Math.sqrt(s.members.length) * 2.5;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (!this.world.passable(x, y)) continue;
        const i = y * W + x;
        if (g[i] >= 0) continue;
        g[i] = s.id;
        s.area++;
      }
    }
    this.rebuildFrontier(s);
  }

  /** 从现有领地重建前沿（用于读档、战争夺地之后） */
  rebuildFrontier(s) {
    const W = this.world.W, H = this.world.H, g = this.territoryGrid;
    const fr = [];
    let area = 0;
    for (let i = 0; i < g.length; i++) {
      if (g[i] !== s.id) continue;
      area++;
      const x = i % W;
      if (x > 0 && g[i - 1] < 0) fr.push(i - 1);
      if (x < W - 1 && g[i + 1] < 0) fr.push(i + 1);
      if (i >= W && g[i - W] < 0) fr.push(i - W);
      if (i < g.length - W && g[i + W] < 0) fr.push(i + W);
    }
    s.frontier = fr;
    s.area = area;
  }

  /**
   * 领地生长：从前沿随机取格向外推进。
   * 遇海止步、山地/绝地/魔渊难攻，因此版图天然奇形怪状。
   */
  _grow(s, years) {
    const W = this.world.W, H = this.world.H, g = this.territoryGrid;
    const w = this.world, rng = this.ctx.rng;
    // 每年可推进的格数：随宗门等级与门人数量增长
    let budget = (0.55 + s.level * 0.45 + s.members.length * 0.09) * years;
    if (s.maxR < 60) s.maxR = Math.min(60, 16 + s.level * 5 + Math.sqrt(s.members.length) * 2.5);
    let guard = 900;
    while (budget >= 1 && s.frontier.length && guard-- > 0) {
      budget -= 1;
      const fi = (rng.next() * s.frontier.length) | 0;
      const idx = s.frontier[fi];
      s.frontier[fi] = s.frontier[s.frontier.length - 1];
      s.frontier.pop();
      if (g[idx] >= 0) continue;
      const x = idx % W, y = (idx / W) | 0;
      if (!w.passable(x, y)) continue;                     // 水域不可占
      const b = w.biome[idx];
      if (b === 6 || b === 5) { if (!rng.chance(0.42)) continue; }        // 雪峰 / 高山
      else if (b === 14) { if (!rng.chance(0.22)) continue; }             // 绝灵之地
      else if (b === 15) { if (!rng.chance(0.10)) continue; }             // 魔渊
      const dx = x - s.cx, dy = y - s.cy;
      if (dx * dx + dy * dy > s.maxR * s.maxR) continue;   // 势力投射极限
      g[idx] = s.id;
      s.area++;
      if (x > 0 && g[idx - 1] < 0) s.frontier.push(idx - 1);
      if (x < W - 1 && g[idx + 1] < 0) s.frontier.push(idx + 1);
      if (y > 0 && g[idx - W] < 0) s.frontier.push(idx - W);
      if (y < H - 1 && g[idx + W] < 0) s.frontier.push(idx + W);
      if (s.frontier.length > 4000) s.frontier.length = 3000;   // 防止无限膨胀
    }
    if (s.frontier.length === 0) this.rebuildFrontier(s);
  }

  rebuildAllTerritory() {
    for (const s of this.list) {
      if (!s.expeditions) s.expeditions = [];
      this.rebuildFrontier(s);
    }
  }

  /** 派遣弟子前往领地前沿立桩拓土 */
  _dispatchExpedition(s, years) {
    if (!s.frontier || s.frontier.length === 0) { this.rebuildFrontier(s); return; }
    if (!s.expeditions) s.expeditions = [];
    const maxTeams = Math.min(5, 1 + Math.floor(s.members.length / 4));
    if (s.expeditions.length >= maxTeams) return;
    const rng = this.ctx.rng;
    // 派遣意愿：门人越多、越强，越积极开疆
    if (!rng.chance(Math.min(0.85, (0.20 + s.members.length * 0.022) * years))) return;
    const units = this.ctx.units;
    // 挑一名得空的弟子（优先派境界低的，长老留守）
    let envoy = null, bestScore = 1e9;
    for (const id of s.members) {
      const u = units.byId.get(id);
      if (!u || !u.alive || u.type !== 0) continue;
      const st = u.state;
      if (st === ST_SEEK || st === ST_FIGHT || st === ST_FLEE || st === ST_TRIB || st === ST_EXPAND) continue;
      if (u.hp < u.maxHp * 0.55) continue;
      const score = u.realm * 60 + Math.abs(u.x - s.cx) + Math.abs(u.y - s.cy) * 0.4;
      if (score < bestScore) { bestScore = score; envoy = u; }
    }
    if (!envoy) return;
    // 选目标：从前沿里挑离山门较远的（向外拓）
    const W = this.world.W;
    let bestIdx = -1, bestD = -1;
    const tries = Math.min(26, s.frontier.length);
    for (let k = 0; k < tries; k++) {
      const idx = s.frontier[(rng.next() * s.frontier.length) | 0];
      const x = idx % W, y = (idx / W) | 0;
      if (!this.world.passable(x, y)) continue;
      const d = (x - s.cx) * (x - s.cx) + (y - s.cy) * (y - s.cy);
      if (d > bestD) { bestD = d; bestIdx = idx; }
    }
    if (bestIdx < 0) return;
    const tx = bestIdx % W, ty = (bestIdx / W) | 0;
    envoy.state = ST_EXPAND;
    envoy.expedition = { sectId: s.id, tx, ty };
    envoy.hx = tx + 0.5; envoy.hy = ty + 0.5;
    envoy.decideT = 60;                     // 拓荒途中不做别的决策
    s.expeditions.push(envoy.id);
  }

  /** 弟子抵达后占领一片区域（就地立桩，疆土随人而增） */
  claimArea(u, x, y, r) {
    const W = this.world.W, H = this.world.H, g = this.territoryGrid;
    const s = this.byId.get(u.sectId);
    if (!s) return 0;
    const rng = this.ctx.rng;
    let n = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 1) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
        const i = ny * W + nx;
        if (g[i] >= 0) continue;
        if (!this.world.passable(nx, ny)) continue;
        const b = this.world.biome[i];
        let pass = 0.88;
        if (b === 6 || b === 5) pass = 0.55;
        else if (b === 14) pass = 0.35;
        else if (b === 15) pass = 0.12;
        if (!rng.chance(pass)) continue;
        const ddx = nx - s.cx, ddy = ny - s.cy;
        if (ddx * ddx + ddy * ddy > s.maxR * s.maxR) continue;
        g[i] = s.id;
        s.area++;
        n++;
      }
    }
    if (n) {
      this.rebuildFrontier(s);
      if (n >= 4 && rng.chance(0.4)) {
        this.ctx.events.add('sect', '⚑ 「' + s.name + '」门人 ' + u.name + ' 拓土 ' + n + ' 里');
      }
    }
    return n;
  }

  territoryAt(x, y) {
    const i = y * this.world.W + x;
    return this.territoryGrid[i] || -1;
  }

  /** 年度推进 */
  updateYear(years) {
    const units = this.ctx.units;
    for (let k = this.list.length - 1; k >= 0; k--) {
      const s = this.list[k];
      const leader = units.byId.get(s.leaderId);
      if (!leader || !leader.alive) {
        if (s.members.length) { s.leaderId = s.members[0]; s.leaderName = units.byId.get(s.leaderId)?.name || ''; }
        else { this.dissolve(s, '群龙无首'); continue; }
      } else {
        s.level = clamp(leader.realm - 1, 1, 5);
      }
      // 收入：全部来自领地内资源点的开采（有储量、会枯竭、靠自己恢复）
      // 没有地盘就没有进项——这正是宗门拼命扩张与开战的理由
      let income = 0;
      for (const sid of s.sites) {
        const site = this.world.sites[sid];
        if (!site) continue;
        const rate = (0.6 + site.tier * 0.8) * (s.demonic ? 0.6 : 1);
        const avail = clamp(site.reserve / 25, 0, 1);      // 储量越少，产出越薄
        income += rate * avail;
        site.reserve = Math.max(0, site.reserve - rate * 0.32 * years);
        // 露天开采会把山挖矮 —— 地貌被"用"出来，而不是一成不变
        if (site.type === 2 && site.reserve < 70 && this.ctx.rng.chance(0.10 * years)) {
          this.world.shapeTerrain(site.x, site.y, 2.0, -0.005);
        }
        if (site.reserve <= 0 && !site.depleted) {
          site.depleted = 1;
          const tname = { 1: '灵脉', 2: '矿脉', 3: '灵田', 4: '药谷', 5: '洞天', 6: '魔渊' }[site.type] || '宝地';
          this.ctx.events.add('disaster', '⚠ 「' + s.name + '」的' + tname + '开采过度，地力枯竭');
        }
      }
      s.res.stones += income * years;
      // 支出：门人俸禄与日常开销
      s.res.stones -= s.members.length * 0.03 * years;

      // 疆土靠门人亲自去拓：派遣弟子前往前沿立桩
      s.maxR = Math.min(60, 16 + s.level * 5 + Math.sqrt(s.members.length) * 2.5);
      this._dispatchExpedition(s, years);
      // 少量自然归附（边民依附、日常巡视），保证无人可派时也不至于完全停滞
      if (this.ctx.rng.chance(0.10 * years)) this._grow(s, 1);
      // 偶尔派弟子抢占资源点
      if (this.ctx.rng.chance(CFG.sect.expand * years)) this._expand(s);
      // 资源枯竭/破产
      if (s.res.stones < -30) {
        this.ctx.events.add('sect', '「' + s.name + '」库府空虚，门人离散');
        const half = Math.ceil(s.members.length / 2);
        for (let m = 0; m < half && s.members.length; m++) {
          const u = units.byId.get(s.members[Math.floor(this.ctx.rng.next() * s.members.length)]);
          if (u) this.leaveSect(u, false);
        }
        s.res.stones = 0;
      }
      // 战争
      this._warCheck(s, years);
    }
  }

  _expand(s) {
    const w = this.world, units = this.ctx.units;
    // 找附近无主资源点
    let best = null, bd = 1e9;
    for (const site of w.sites) {
      if (site.owner >= 0 || site.ownerUnit >= 0) continue;
      const d = dist(site.x, site.y, s.cx, s.cy);
      if (d < bd && d < 34) { bd = d; best = site; }
    }
    if (best && s.res.stones > 40) {
      best.owner = s.id;
      best.ownerUnit = -1;
      s.sites.push(best.id);
      s.res.stones -= 30;
      const tname = { 1: '灵脉', 2: '矿脉', 3: '灵田', 4: '药谷', 5: '洞天福地' }[best.type] || '宝地';
      this.ctx.events.add('sect', '「' + s.name + '」占据了一处' + tname);
    }
    // 领地范围由 _grow 的前沿扩张决定，不再用几何半径
  }

  _warCheck(s, years) {
    const rng = this.ctx.rng;
    // 正魔自动敌对；同阵营因边界摩擦开战
    for (const o of this.list) {
      if (o.id <= s.id) continue;
      const d = dist(s.cx, s.cy, o.cx, o.cy);
      if (d > (s.maxR || 30) + (o.maxR || 30) + 8) continue;
      const rival = s.demonic !== o.demonic;
      if (s.war && s.war.with === o.id) continue;
      if (rival || rng.chance(0.25)) {
        if (rng.chance(CFG.sect.war * years * (rival ? 2.2 : 1))) this.startWar(s, o);
      }
    }
  }

  startWar(a, b) {
    a.war = { with: b.id, t: 0 };
    b.war = { with: a.id, t: 0 };
    a.enemies.add(b.id); b.enemies.add(a.id);
    const reason = a.demonic !== b.demonic ? '正魔之争' : '灵脉资源之争';
    this.ctx.events.add('war', '⚔ ' + reason + '：「' + a.name + '」与「' + b.name + '」爆发大战！');
    // 参战者进入战斗状态
    this._rally(a, b);
    this._rally(b, a);
    this.ctx.stats.wars = (this.ctx.stats.wars || 0) + 1;
  }

  _rally(a, b) {
    const units = this.ctx.units;
    // 倾巢而出：出征人数与宗门规模挂钩（最多 30 名），会战才有气势
    const maxSend = Math.min(30, Math.max(5, Math.floor(a.members.length * 0.7)));
    let n = 0;
    for (const id of a.members) {
      const u = units.byId.get(id);
      if (!u || !u.alive) continue;
      if (n >= maxSend) break;
      if (u.realm < 1) continue;                 // 炼气弟子留守山门
      if (this.ctx.rng.chance(0.85)) {
        u.state = 'seek';
        // 在敌方山门外围列阵（收拢些，才有阵势）
        u.hx = b.cx + this.ctx.rng.range(-3.5, 3.5);
        u.hy = b.cy + this.ctx.rng.range(-3.5, 3.5);
        u.target = -1;
        u.warSect = b.id;
        n++;
      }
    }
    return n;
  }

  endWar(a, b, reason) {
    a.war = null; b.war = null;
    a.enemies.delete(b.id); b.enemies.delete(a.id);
    this.ctx.events.add('war', '☮ 「' + a.name + '」与「' + b.name + '」' + reason + '，战事暂歇');
  }

  /** 战争状态推进 */
  warTick(years) {
    for (const s of this.list) {
      if (!s.war) continue;
      s.war.t += years;
      const o = this.byId.get(s.war.with);
      if (!o) { s.war = null; continue; }
      if (o.id < s.id) continue;  // 只处理一次
      // 会战中持续增援：不断有门人从山门赶赴前线（才有人山人海的样子）
      if (this.ctx.rng.chance(0.22 * years)) {
        this._rally(s, o);
        this._rally(o, s);
      }
      // 一方衰弱或久战力竭 → 停战（时长须覆盖行军时间，否则人还在半路仗就打完了）
      const aStr = this._strength(s), bStr = this._strength(o);
      const minSt = Math.min(aStr, bStr);
      const reach = Math.max(1, Math.floor(Math.sqrt((s.cx - o.cx) * (s.cx - o.cx) + (s.cy - o.cy) * (s.cy - o.cy)) / 1.6));
      const maxT = 18 + reach;
      if (s.war.t > maxT && (this.ctx.rng.chance(0.35) || minSt < 3)) {
        if (aStr > bStr * 1.6) {
          this._seize(s, o);
          this.endWar(s, o, '，' + s.name + '大获全胜');
        } else if (bStr > aStr * 1.6) {
          this._seize(o, s);
          this.endWar(s, o, '，' + o.name + '大获全胜');
        } else {
          this.endWar(s, o, '，两败俱伤');
        }
      }
    }
  }

  _strength(s) {
    let v = 0;
    for (const id of s.members) {
      const u = this.ctx.units.byId.get(id);
      if (u && u.alive) v += Math.sqrt(u.cp);
    }
    return v;
  }

  /** 战胜者割取败者领地与资源点 */
  _seize(win, lose) {
    // 1) 资源点易主
    if (lose.sites.length) {
      const sid = lose.sites.pop();
      win.sites.push(sid);
      const site = this.world.sites[sid];
      if (site) { site.owner = win.id; site.ownerUnit = -1; }
    }
    // 2) 割让疆土：靠近胜者的那一片被吞掉
    const W = this.world.W, g = this.territoryGrid;
    const cands = [];
    for (let i = 0; i < g.length; i++) {
      if (g[i] !== lose.id) continue;
      const x = i % W, y = (i / W) | 0;
      const dx = x - win.cx, dy = y - win.cy;
      cands.push([dx * dx + dy * dy, i]);
    }
    if (!cands.length) {
      this.ctx.events.add('war', '⚑ 「' + win.name + '」击溃「' + lose.name + '」');
      return;
    }
    cands.sort((a, b) => a[0] - b[0]);
    const want = Math.min(cands.length, Math.max(24, Math.floor((lose.area || cands.length) * 0.22)));
    let taken = 0;
    for (let k = 0; k < cands.length && taken < want; k++) {
      const i = cands[k][1];
      if (g[i] !== lose.id) continue;
      g[i] = win.id;
      win.area = (win.area || 0) + 1;
      lose.area = Math.max(0, (lose.area || 0) - 1);
      taken++;
    }
    this.rebuildFrontier(win);
    this.rebuildFrontier(lose);
    this.ctx.events.add('war', '⚑ 「' + win.name + '」攻取「' + lose.name + '」' + taken + ' 里疆土');
  }

  stats() {
    return {
      count: this.list.length,
      demonic: this.list.filter(s => s.demonic).length,
      wars: this.list.filter(s => s.war).length / 2,
      biggest: this.list.slice().sort((a, b) => b.members.length - a.members.length)[0] || null,
    };
  }
}
