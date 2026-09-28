/**
 * main.js —— 引导、世界生成调度、主循环
 */
import { CFG, REALMS } from './config.js';
import { RNG, clamp, fmt } from './util.js';
import { World } from './world.js';
import { Units, U_TYPE } from './units.js';
import { BrainPool } from './brain.js';
import { Sects } from './sects.js';
import { Events } from './events.js';
import { Renderer } from './render.js';
import { FX } from './fx.js';
import { Powers } from './powers.js';
import { UI } from './ui.js';
import { Save } from './save.js';

const ctx = {
  sim: { speed: 1, paused: false, lastSpeed: 1 },
  stats: { wars: 0, founded: 0, ascended: 0 },
  moveMul: 1,
};

/* ============ 加载进度 UI ============ */
function setLoading(p, label) {
  const bar = document.getElementById('loadBar');
  const txt = document.getElementById('loadTxt');
  if (bar) bar.style.width = (p * 100).toFixed(1) + '%';
  if (txt) txt.textContent = label || '开辟天地…';
}

function nextFrame() {
  return new Promise(r => requestAnimationFrame(() => r()));
}

/* ============ 世界生成（分步，保持界面响应） ============ */
async function generateWorld(seed, W, H) {
  const world = new World(seed, W, H);
  ctx.world = world;
  const steps = world.genSteps();
  for (let i = 0; i < steps.length; i++) {
    setLoading(i / (steps.length + 2) * 0.9, steps[i][0] + '…');
    await nextFrame();
    const t0 = performance.now();
    steps[i][1]();
    await nextFrame();
  }
  setLoading(0.92, '地表成形…');
  await nextFrame();
  return world;
}

/* ============ 初始生命 ============ */
function seedLife() {
  const w = ctx.world, rng = ctx.rng;
  setLoading(0.94, '播撒生灵…');
  const pick = (minAura, tries) => {
    for (let k = 0; k < tries; k++) {
      const x = rng.int(4, w.W - 5), y = rng.int(4, w.H - 5);
      if (!w.passable(x, y)) continue;
      if (w.auraAt(x, y) < minAura) continue;
      return { x, y };
    }
    return null;
  };
  // 修士
  let n = 0;
  for (let k = 0; k < 6000 && n < 92; k++) {
    const p = pick(26, 1);
    if (!p) continue;
    if (rng.chance(0.42)) continue;
    const realm = rng.chance(0.74) ? 0 : (rng.chance(0.62) ? 1 : (rng.chance(0.55) ? 2 : 3));
    ctx.units.spawn(U_TYPE.CULTIVATOR, p.x, p.y, { realm, stage: rng.int(0, 3) });
    n++;
  }
  // 妖兽
  n = 0;
  for (let k = 0; k < 6000 && n < 64; k++) {
    const p = pick(18, 1);
    if (!p) continue;
    if (rng.chance(0.55)) continue;
    const tier = rng.chance(0.5) ? 1 : (rng.chance(0.6) ? 2 : (rng.chance(0.5) ? 3 : 4));
    ctx.units.spawn(U_TYPE.BEAST, p.x, p.y, { tier });
    n++;
  }
  // 灵植
  n = 0;
  for (let k = 0; k < 9000 && n < 130; k++) {
    const p = pick(24, 1);
    if (!p) continue;
    if (rng.chance(0.5)) continue;
    const tier = clamp(Math.floor(w.auraAt(p.x, p.y) / 24), 0, 4);
    ctx.units.spawn(U_TYPE.PLANT, p.x, p.y, { tier });
    n++;
  }
}

/* ============ 主循环 ============ */
let last = 0, acc = 0, tickCount = 0, logVer = -1;

function worldTick() {
  tickCount++;
  ctx.units.updateYear(1);
  ctx.sects.updateYear(1);
  ctx.sects.warTick(1);
  ctx.world.tick(1);
  ctx.world.tickSites(1);      // 资源点再生（开采之后靠时间恢复）
  ctx.world.regenDecor(1);     // 草木再生（被砍伐后会自己长回来）
  ctx.world.abyssSeep(1);      // 魔渊渗出魔气（魔道之源）
  ctx.world.leyRecharge(1);    // 灵脉回灌地气（灵气并非无限）
  if (tickCount % 2 === 0) awakenMortals();
  if (tickCount % 5 === 0) maybeWorldEvent();
  // 每五十年一次"道统评选"：世界自己筛选活法
  if (tickCount % 50 === 0 && ctx.brains && tickCount > 60) {
    ctx.brains.evolve(ctx.units.list);
    for (const e of ctx.brains.pending) {
      ctx.events.add('sys', '☯ 道统更替：「' + e.name + '」继「' + e.from + '」之法，已传至第 ' + e.gen + ' 代');
    }
    ctx.brains.pending.length = 0;
    // 兽道演进：凶兽也有各自的活法
    if (ctx.beastBrains) {
      ctx.beastBrains.evolve(ctx.units.list, 1);
      const bp = ctx.beastBrains.pending;
      if (bp.length) {
        ctx.events.add('sys', '🐾 兽道更替：「' + bp[0].name + '」血脉大兴，已传至第 ' + bp[0].gen + ' 代');
        ctx.beastBrains.pending.length = 0;
      }
    }
  }
  if (ctx.events.version !== logVer) { logVer = ctx.events.version; ctx.ui.refreshLog(); }
}

/** 凡人觉醒：灵气充沛之地自有人踏上仙途，维持世界人口 */
function awakenMortals() {
  const c = ctx.units._counts || ctx.units.countTypes();
  if (c.cult >= 6000) return;   // 仅作极端情况的兜底，不再限制正常增长
  // 统计低阶修士（炼气/筑基）：世界需要源源不断的新生代，避免只剩老怪物
  let low = 0;
  for (const u of ctx.units.list) {
    if (u.alive && u.type === U_TYPE.CULTIVATOR && u.realm <= 1) low++;
  }
  if (low >= 78) return;
  const w = ctx.world, rng = ctx.rng;
  const want = low < 25 ? 4 : (low < 50 ? 3 : 2);
  for (let k = 0; k < want; k++) {
    let spot = null;
    for (let t = 0; t < 90; t++) {
      const x = rng.int(4, w.W - 5), y = rng.int(4, w.H - 5);
      if (!w.passable(x, y)) continue;
      if (w.auraAt(x, y) < 32) continue;
      if (rng.chance(0.5)) continue;
      spot = { x, y };
      break;
    }
    if (!spot) continue;
    const realm = rng.chance(0.86) ? 0 : (rng.chance(0.7) ? 1 : 2);
    const u = ctx.units.spawn(U_TYPE.CULTIVATOR, spot.x, spot.y, { realm, stage: 0 });
    if (u && rng.chance(0.06)) {
      ctx.events.add('birth', '☆ ' + ctx.sects.placeName(spot.x, spot.y) + '有凡人觉醒灵根，' + u.name + ' 拜入仙途');
    }
  }
}

/** 低频自然事件：天象、灾劫、机缘 */
function maybeWorldEvent() {
  const rng = ctx.rng, w = ctx.world;
  if (!rng.chance(0.10)) return;
  const roll = rng.next();
  const cx = rng.range(20, w.W - 20), cy = rng.range(20, w.H - 20);
  if (roll < 0.28) {
    ctx.fx.rain(cx, cy, 12);
    w.addAura(cx, cy, 12, 12, false);
    ctx.events.add('divine', '☁ 甘霖降于' + ctx.sects.placeName(cx, cy) + '，灵气骤盛');
  } else if (roll < 0.48) {
    const dn = rng.range(3, 7);
    w.addDemon(cx, cy, 9, dn);
    w.reclassify(cx, cy, 10);
    ctx.fx.demonize(cx, cy, 9);
    ctx.events.add('disaster', '☠ ' + ctx.sects.placeName(cx, cy) + '地脉渗魔，魔气弥漫');
  } else if (roll < 0.66) {
    // 灵脉微动：灵气上涨
    const site = w.sites[rng.int(0, Math.max(0, w.sites.length - 1))];
    if (site) {
      w.aura[ w.idx(site.x, site.y) ] = Math.min(100, w.aura[w.idx(site.x, site.y)] + 8);
      w.addAura(site.x, site.y, site.r + 3, 6);
      ctx.events.add('divine', '✧ ' + ctx.sects.placeName(site.x, site.y) + '灵脉涌动，地气升腾');
    }
  } else if (roll < 0.80) {
    ctx.events.add('sys', '☄ 天有异象，紫气东来，天下修士若有所悟');
    for (const u of ctx.units.list) if (u.alive && u.type === U_TYPE.CULTIVATOR) u.daoHeart = clamp(u.daoHeart + 1.5, 0, 100);
  } else if (roll < 0.92) {
    // 秘境现世
    const p = w.findLandNear(cx, cy, 20);
    if (p) {
      const s = w._addSite(5, p.x, p.y, rng.range(3, 5), 3);
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const x = p.x + dx, y = p.y + dy;
        if (!w.inB(x, y) || dx * dx + dy * dy > 30) continue;
        const i = w.idx(x, y);
        w.flag[i] = 1;
        w.aura[i] = Math.min(100, w.aura[i] + 20);
        w.markDirty(x, y);
      }
      ctx.fx.ring(p.x, p.y, '#ffffff', 1, 12, 1.6);
      ctx.events.add('divine', '✦ ' + ctx.sects.placeName(p.x, p.y) + '虚空裂开，一处洞天福地现世！');
    }
  } else if (roll < 0.96) {
    // 兽潮：修士越盛，天地间凶物越多
    const p = w.findLandNear(cx, cy, 24);
    if (p) {
      const st = ctx.units.stats();
      const n = Math.max(3, Math.min(9, Math.round(st.cult / 60) + 2));
      for (let k = 0; k < n; k++) {
        const a = rng.range(0, 6.2832), d = rng.range(0, 5);
        ctx.units.spawn(U_TYPE.BEAST, Math.floor(p.x + Math.cos(a) * d), Math.floor(p.y + Math.sin(a) * d),
          { tier: rng.chance(0.5) ? rng.int(2, 3) : rng.int(3, 5) });
      }
      ctx.events.add('disaster', '⚠ 兽潮涌现于' + ctx.sects.placeName(p.x, p.y) + '，' + n + ' 头凶兽为祸一方');
    }
  } else {
    // 魔渊现世：地脉破裂，魔气涌出（魔道的土壤）
    const p = w.findLandNear(cx, cy, 22);
    if (p) {
      w._addSite(6, p.x, p.y, rng.range(2, 3.5), 0);
      w.addDemon(p.x, p.y, 6, 45);
      w.reclassify(p.x, p.y, 7);
      w.markDirtyArea(p.x, p.y, 8);
      ctx.fx.demonize(p.x, p.y, 6);
      ctx.events.add('disaster', '☠ ' + ctx.sects.placeName(p.x, p.y) + ' 地脉破裂，魔渊现世！');
    }
  }
}

function loop(now) {
  const raw = (now - last) / 1000;
  const dt = Math.min(raw, 0.5);   // 防止长时间挂起后一次性补算过多
  last = now;
  try {
    const sim = ctx.sim;
    const spd = sim.paused ? 0 : sim.speed;
    ctx.moveMul = clamp(spd, 0, CFG.time.moveMulMax);
    if (spd > 0) {
      acc += dt * spd * CFG.time.yearsPerSecond;
      let ticks = 0;
      while (acc >= 1 && ticks < CFG.time.maxTicksPerFrame) { worldTick(); acc -= 1; ticks++; }
      if (acc > 6) acc = 0;
      ctx.world.phase += dt;
      ctx.units.updateMotion(dt);
    }
    ctx.fx.update(dt);
    ctx.powers.update(dt);
    ctx.renderer.render(dt, ctx.ui.view, ctx.fx);
    ctx.ui.updateMana(ctx.powers.mana, ctx.powers.manaMax);
    ctx.ui.refreshInfo();
    ctx.save.update(dt);
  } catch (e) {
    // 单次异常不应中断世界演化
    if (window.__errs) {
      const m = 'loop: ' + e.message;
      if (window.__errs[window.__errs.length - 1] !== m) window.__errs.push(m);
    }
    console.error(e);
  }
  requestAnimationFrame(loop);
}

/* ============ 引导 ============ */
async function boot() {
  setLoading(0.02, '叩问天道…');
  await nextFrame();

  let seed = Number(new URLSearchParams(location.search).get('seed')) || 0;
  if (!seed) {
    try { seed = Number(localStorage.getItem('xw_next_seed')) || 0; } catch (e) {}
  }
  if (!seed) seed = (Date.now() % 999983) + 7;
  try { localStorage.removeItem('xw_next_seed'); } catch (e) {}

  const W = CFG.world.W, H = CFG.world.H;
  ctx.rng = new RNG(seed ^ 0x9e3779b9);

  const world = await generateWorld(seed, W, H);

  setLoading(0.93, '构建洞天…');
  await nextFrame();

  ctx.events = new Events(ctx);
  ctx.brains = new BrainPool(seed >>> 0, 16);                      // 十六套道统，供万民师法
  ctx.beastBrains = new BrainPool((seed ^ 0x7f4a7c15) >>> 0, 12);   // 十二套兽道，供凶兽传承
  ctx.units = new Units(ctx);
  ctx.sects = new Sects(ctx);

  ctx.ui = new UI(ctx);
  ctx.ui.mount();
  ctx.renderer = new Renderer(document.getElementById('world'), ctx);
  ctx.ui.bindCanvas();   // 画布交互依赖 renderer，必须在此之后绑定
  ctx.fx = new FX(ctx);
  ctx.powers = new Powers(ctx);
  ctx.save = new Save(ctx);

  // 预构建地形分块（避免进入游戏后看到陆续"长出来"的地表）
  setLoading(0.95, '山河显形…');
  await new Promise(res => {
    let guard = 0;
    const chk = () => {
      ctx.renderer.buildDirty(26);
      if (ctx.world.dirty.size === 0 || guard++ > 200) return res();
      requestAnimationFrame(chk);
    };
    chk();
  });

  seedLife();

  setLoading(0.97, '点化众生…');
  await nextFrame();

  // 首批宗门成立
  let founded = 0;
  const high = ctx.units.list.filter(u => u.alive && u.type === U_TYPE.CULTIVATOR && u.realm >= 2);
  for (const u of high) {
    if (ctx.sects.list.length >= 4) break;
    if (ctx.sects.tryFound(u)) founded++;
  }

  ctx.events.add('sys', '天地初开 · 世界种子 ' + seed + ' · 万物自此生生不息');
  ctx.ui.refreshLog();
  ctx.ui.refreshInfo(true);

  // 居中
  ctx.renderer.cam.x = W / 2; ctx.renderer.cam.y = H / 2;
  ctx.renderer.clampCam();

  window.addEventListener('resize', () => { ctx.renderer.resize(); ctx.renderer.ovDirty = true; });
  window.addEventListener('beforeunload', () => { try { ctx.save.save(true); } catch (e) {} });

  document.getElementById('loading').classList.add('gone');
  setTimeout(() => { const l = document.getElementById('loading'); if (l) l.style.display = 'none'; }, 700);

  last = performance.now();
  requestAnimationFrame(loop);

  // 欢迎
  setTimeout(() => {
    ctx.ui.toast('天道已成 · 世界种子 ' + seed, 2600);
  }, 400);
  setTimeout(() => {
    ctx.ui.toast('单指拖动平移 · 双指缩放 · 右下角 ✋ 强制移动模式', 3600);
  }, 3600);
}

/* ============ 全局 API（供 UI 调用） ============ */
ctx._tick = worldTick;        // 测试／调试钩子：手动推进一个世界年
ctx._awaken = awakenMortals;
ctx.newWorld = function (seed) {
  try { localStorage.setItem('xw_next_seed', String(seed || ((Date.now() % 999983) + 7))); } catch (e) {}
  location.reload();
};
window.XW = ctx;

boot().catch(err => {
  const el = document.getElementById('loadTxt');
  if (el) el.textContent = '开天失败：' + err.message;
  console.error(err);
});
