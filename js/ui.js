/**
 * ui.js —— 界面：神力面板、世界信息、事件日志、单位详情、交互绑定
 */
import { CFG, REALMS, STAGES, ROOTS, BIOME_INFO, RES_INFO, ORES, HERBS, ARTIFACT_TIERS, TECH_TIERS, PILLS } from './config.js';
import { getIcon, iconURL, drawPower, drawViewTag, drawSpiritStone, drawHerb, drawArtifact, drawTechnique, drawPill, drawOre } from './icons.js';
import { clamp, fmt, fmtTime } from './util.js';
import { U_TYPE } from './units.js';
import { POWER_LIST } from './powers.js';

const VIEWS = [
  { id: 'terrain', n: '地形' },
  { id: 'aura', n: '灵气' },
  { id: 'demon', n: '魔气' },
  { id: 'politics', n: '宗门' },
  { id: 'resource', n: '资源' },
];

export class UI {
  constructor(ctx) {
    this.ctx = ctx;
    this.view = 'terrain';
    this.speedIdx = 1;
    this.rightTab = 'world';
    this.logOpen = true;
    this.selUnit = null;
    this.selSite = null;
    this.selSect = null;
    this.toastT = 0;
    this.lastInfo = 0;
    this.panMode = false;    // ✋ 移动模式：单指拖动镜头（长按神力按钮不影响）
  }

  mount() {
    const app = document.getElementById('app');
    app.innerHTML = `
    <canvas id="world"></canvas>
    <div id="brushHint"></div>
    <header id="topbar">
      <div class="brand"><span class="glyph">☯</span><span class="tname">太虚演天</span><span class="ver">v${CFG.version}</span></div>
      <div class="tgroup" id="timeCtl">
        <button class="tbtn" data-act="speed" data-v="0" title="暂停">⏸</button>
        <button class="tbtn on" data-act="speed" data-v="1">1x</button>
        <button class="tbtn" data-act="speed" data-v="2">2x</button>
        <button class="tbtn" data-act="speed" data-v="5">5x</button>
        <button class="tbtn" data-act="speed" data-v="10">10x</button>
        <button class="tbtn" data-act="speed" data-v="20">20x</button>
      </div>
      <div class="tgroup" id="viewCtl"></div>
      <div class="tgroup">
        <div class="mana"><div class="manaFill" id="manaFill"></div><span id="manaTxt">天道之力 140</span></div>
      </div>
      <div class="tgroup right">
        <button class="tbtn" data-act="toggle-left" title="神力">⚙</button>
        <button class="tbtn" data-act="toggle-right" title="信息">☰</button>
        <button class="tbtn" data-act="save" title="存档">💾</button>
        <button class="tbtn" data-act="help" title="帮助">?</button>
      </div>
    </header>
    <aside id="panel-left"><div class="ptitle">天道神力</div><div id="powerList"></div>
      <div class="brushBox">
        <label>笔刷半径 <b id="brVal">6</b></label>
        <input type="range" id="brRange" min="2" max="18" value="6">
        <label>神力强度 <b id="stVal">1.0</b></label>
        <input type="range" id="stRange" min="0.3" max="2.5" step="0.1" value="1">
        <div class="tip" id="powerTip">选择一个神力后，在地图上点击或拖动施放。</div>
      </div>
    </aside>
    <aside id="panel-right">
      <div class="tabs" id="rightTabs">
        <button class="rtab on" data-act="rtab" data-v="world">世界</button>
        <button class="rtab" data-act="rtab" data-v="rank">天骄</button>
        <button class="rtab" data-act="rtab" data-v="sect">宗门</button>
        <button class="rtab" data-act="rtab" data-v="unit">查看</button>
        <button class="rtab" data-act="rtab" data-v="dao">道统</button>
      </div>
      <div class="pbody" id="rightBody"></div>
    </aside>
    <footer id="logbar">
      <div class="loghead" data-act="toggle-log"><span>世界大事记</span><span id="logArrow">▾</span></div>
      <div class="logbody" id="logBody"></div>
    </footer>
    <div id="toast"></div>
    <div id="modal" class="hidden"><div class="mbox" id="modalBody"></div></div>
    <div id="zoomCtl">
      <button class="zbtn" data-act="panmode" title="移动镜头模式">✋</button>
      <button class="zbtn" data-act="zoom" data-v="1">＋</button>
      <button class="zbtn" data-act="zoom" data-v="-1">－</button>
    </div>`;
    this.el = {
      canvas: document.getElementById('world'),
      powerList: document.getElementById('powerList'),
      viewCtl: document.getElementById('viewCtl'),
      rightBody: document.getElementById('rightBody'),
      logBody: document.getElementById('logBody'),
      manaFill: document.getElementById('manaFill'),
      manaTxt: document.getElementById('manaTxt'),
      toast: document.getElementById('toast'),
      brushHint: document.getElementById('brushHint'),
      modal: document.getElementById('modal'),
      modalBody: document.getElementById('modalBody'),
      logbar: document.getElementById('logbar'),
    };
    this._buildPowers();
    this._buildViews();
    this._bindGlobal();
    // 注意：画布绑定必须等 Renderer 创建之后再调用（见 main.js 的 bindCanvas）
    this.refreshLog();
    this.refreshInfo(true);
  }

  /* ---------- 神力面板 ---------- */
  _buildPowers() {
    const cats = {};
    for (const p of POWER_LIST) { (cats[p.cat] = cats[p.cat] || []).push(p); }
    let html = '';
    for (const cat in cats) {
      html += '<div class="pcat">' + cat + '</div><div class="pgrid">';
      for (const p of cats[cat]) {
        html += `<button class="pbtn" data-act="power" data-v="${p.id}" title="${p.name}｜${p.desc}（耗${p.cost}）">
          <span class="pico" data-pw="${p.id}"></span></button>`;
      }
      html += '</div>';
    }
    this.el.powerList.innerHTML = html;
    // 图标
    this.el.powerList.querySelectorAll('[data-pw]').forEach(sp => {
      const id = sp.dataset.pw;
      const c = getIcon('pw_' + id, 30, (g, s) => drawPower(g, s, id));
      sp.appendChild(c);
    });
  }

  _buildViews() {
    this.el.viewCtl.innerHTML = VIEWS.map(v =>
      `<button class="tbtn ${v.id === this.view ? 'on' : ''}" data-act="view" data-v="${v.id}" title="${v.n}视图">
        <span data-vw="${v.id}"></span><i>${v.n}</i></button>`).join('');
    this.el.viewCtl.querySelectorAll('[data-vw]').forEach(sp => {
      const id = sp.dataset.vw;
      const c = getIcon('vw_' + id, 22, (g, s) => drawViewTag(g, s, id));
      sp.appendChild(c);
    });
  }

  /* ---------- 信息面板 ---------- */
  refreshInfo(force) {
    const now = performance.now();
    if (!force && now - this.lastInfo < 420) return;
    this.lastInfo = now;
    const ctx = this.ctx;
    const st = ctx.units.stats();
    const w = ctx.world;
    const sects = ctx.sects.stats();
    let html = '';
    if (this.rightTab === 'world') {
      const power = ctx.sects.list.reduce((a, s) => a + s.members.length, 0);
      html += `<div class="card">
        <div class="ct">世界概览</div>
        <div class="kv"><span>纪元</span><b>${fmtTime(w.year)}</b></div>
        <div class="kv"><span>修士</span><b>${st.cult} 人</b></div>
        <div class="kv"><span>妖兽</span><b>${st.beast}</b></div>
        <div class="kv"><span>灵植</span><b>${st.plant}</b></div>
        <div class="kv"><span>魔修</span><b class="dn">${st.demon}</b></div>
        <div class="kv"><span>宗门</span><b>${sects.count}（魔道 ${sects.demonic}）</b></div>
        <div class="kv"><span>战事</span><b class="wr">${sects.wars | 0}</b></div>
        <div class="kv"><span>平均境界</span><b>${st.cult ? REALMS[Math.floor(st.avgRealm)].n : '—'}</b></div>
        <div class="kv"><span>元婴以上</span><b class="hl">${st.high} 人</b></div>
        <div class="kv"><span>灵气均值</span><b>${(w.auraAvgCache != null ? w.auraAvgCache : this._avgAura(w)).toFixed(1)}</b></div>
        <div class="kv"><span>魔气均值</span><b class="dn">${this._avgDemon(w).toFixed(2)}</b></div>
      </div>`;
      // 资质分布
      const rh = new Array(ROOTS.length).fill(0);
      let demon = 0;
      for (const u2 of ctx.units.list) {
        if (!u2.alive || u2.type !== U_TYPE.CULTIVATOR) continue;
        rh[u2.root]++;
        if (u2.isDemon) demon++;
      }
      const total = rh.reduce((a, b) => a + b, 0);
      html += `<div class="card"><div class="ct">修士资质分布</div>`;
      if (!total) html += '<div class="empty">世上暂无修士</div>';
      else {
        ROOTS.forEach((r, i) => {
          if (!rh[i]) return;
          const pct = rh[i] / total * 100;
          html += `<div class="rootrow">
            <span class="rootn" style="color:${r.color}">${r.n}</span>
            <span class="rootbar"><i style="width:${pct.toFixed(0)}%;background:${r.color}"></i></span>
            <span class="rootc">${rh[i]}</span></div>`;
        });
        html += `<div class="kv small" style="margin-top:5px"><span>资质总评</span><b>${total ? this._gradeText(rh, total) : '—'}</b></div>`;
      }
      html += `</div>`;
      html += `<div class="card"><div class="ct">本纪大事</div><div class="mini" id="miniLog"></div></div>`;
    } else if (this.rightTab === 'rank') {
      const top = ctx.units.top(12);
      html += '<div class="card"><div class="ct">境界榜</div>';
      if (!top.length) html += '<div class="empty">天地初开，尚无修士</div>';
      top.forEach((u, i) => {
        const rc = REALMS[u.realm].color;
        const rt = ROOTS[u.root];
        html += `<div class="rk" data-act="focusunit" data-v="${u.id}">
          <span class="rki">${i + 1}</span>
          <span class="rkn" style="color:${u.isDemon ? '#ff8080' : rc}">${u.name}</span>
          <span class="rg" style="color:${rt.color}" title="${rt.n}资质">${rt.n[0]}</span>
          <span class="rkr" style="color:${rc}">${REALMS[u.realm].n}${STAGES[u.stage]}</span>
          <span class="rks">${this._sectName(u)}</span></div>`;
      });
      html += `<div class="legend">资质简称：<b style="color:#ffe680">天</b>灵根·<b style="color:#ff9ae0">变</b>异·<b style="color:#a0e0ff">单</b>·<b style="color:#b8ffb8">双</b>·<b style="color:#d8d8d8">三</b>·<b style="color:#e0c090">四</b>·<b style="color:#c09090">五</b></div>`;
      html += '</div>';
    } else if (this.rightTab === 'sect') {
      html += '<div class="card"><div class="ct">宗门录</div>';
      if (!ctx.sects.list.length) html += '<div class="empty">天下无宗，散修各行其道</div>';
      const list = ctx.sects.list.slice().sort((a, b) => b.members.length - a.members.length);
      for (const s of list) {
        html += `<div class="sec" data-act="focussect" data-v="${s.id}">
          <span class="dot" style="background:${s.color}"></span>
          <span class="sn">${s.name}</span>
          <span class="sg">${s.demonic ? '魔' : '正'}·${s.level}阶</span>
          <span class="sc">${s.members.length}人</span>
          <span class="ss">${s.area || 0}里·${s.sites.length}资源</span>
          ${s.war ? '<span class="sw">战</span>' : ''}
        </div>`;
      }
      html += '</div>';
    } else if (this.rightTab === 'dao') {
      const pool = ctx.brains;
      html += '<div class="card"><div class="ct">当世道统</div>';
      if (!pool) html += '<div class="empty">道统未立</div>';
      else {
        html += '<div class="kv small"><span>评法</span><b>五十年一选，成就高者传法</b></div>';
        const rk = pool.ranking(16);
        const top = Math.max(1, rk[0].fitness || 1);
        for (const b of rk) {
          const pct = clamp(b.fitness / top * 100, 0, 100);
          html += `<div class="rootrow">
            <span class="rootn" style="color:#9fd8ff">${b.name}</span>
            <span class="rootbar"><i style="width:${pct.toFixed(0)}%;background:linear-gradient(90deg,#4a8ac0,#8ecfff)"></i></span>
            <span class="rootc">${Math.round(b.fitness)}</span></div>
            <div class="daoMeta">第 ${b.gen} 代 · 门徒 ${b.use} 人</div>`;
        }
      }
      html += '</div>';
    } else {
      html += this._unitCard();
    }
    this.el.rightBody.innerHTML = html;
    const ml = document.getElementById('miniLog');
    if (ml) {
      ml.innerHTML = ctx.events.recent(6).map(e =>
        `<div class="mline"><i style="color:${ctx.events.color(e.type)}">●</i>${e.text}</div>`).join('');
    }
  }

  _sectName(u) {
    if (u.sectId < 0) return '散修';
    const s = this.ctx.sects.byId.get(u.sectId);
    return s ? s.name : '散修';
  }

  _avgAura(w) {
    if (w._avgT && performance.now() - w._avgT < 3000) return w._avgCache || 0;
    let sum = 0; const step = 7;
    let n = 0;
    for (let i = 0; i < w.N; i += step) { sum += w.aura[i] * step; n++; }
    const v = sum / (n * step);
    w._avgCache = v; w._avgT = performance.now(); w.auraAvgCache = v;
    return v;
  }
  _avgDemon(w) {
    const now = performance.now();
    if (w._dAvgT && now - w._dAvgT < 3000) return w._dAvgCache || 0;
    let sum = 0; const step = 11; let n = 0;
    for (let i = 0; i < w.N; i += step) { sum += w.demon[i]; n++; }
    const v = sum / n;
    w._dAvgCache = v; w._dAvgT = now;
    return v;
  }

  /* ---------- 单位详情 ---------- */
  _unitCard() {
    if (this.selSect) return this._sectCard();
    const u = this.selUnit;
    if (!u || !u.alive) return '<div class="card"><div class="empty">点击地图上的单位或宗门旗帜查看详情</div></div>';
    if (u.type === U_TYPE.BEAST) return this._beastCard(u);
    if (u.type === U_TYPE.PLANT) return this._plantCard(u);
    return this._cultivatorCard(u);
  }

  /** 宗门详情卡 */
  _sectCard() {
    const s = this.selSect;
    const ctx = this.ctx;
    if (!s || !ctx.sects.byId.get(s.id)) {
      this.selSect = null;
      return '<div class="card"><div class="empty">点击地图上的单位或宗门旗帜查看详情</div></div>';
    }
    const leader = ctx.units.byId.get(s.leaderId);
    const years = Math.max(0, Math.round(ctx.world.year - s.founded));
    const siteTxt = this._siteSummary(s);
    let html = `<div class="card unit">
      <div class="ct" style="color:${s.color}">${s.name}</div>
      <div class="kv"><span>道统</span><b class="${s.demonic ? 'dn' : 'hl'}">${s.demonic ? '魔道' : '正道'}</b></div>
      <div class="kv"><span>阶位</span><b>${s.level} 阶</b></div>
      <div class="kv"><span>宗主</span><b>${leader ? leader.name : '—'}</b></div>
      ${leader ? `<div class="kv small"><span>宗主境界</span><b style="color:${REALMS[leader.realm].color}">${ctx.units.realmName(leader)}</b></div>` : ''}
      <div class="kv"><span>门人</span><b>${s.members.length} 人</b></div>
      <div class="kv"><span>疆域</span><b class="hl">${s.area || 0} 里</b></div>
      <div class="kv"><span>驻跸</span><b>${ctx.sects.placeName(s.cx, s.cy)}</b></div>
      <div class="kv small"><span>立宗</span><b>第 ${Math.round(s.founded)} 年 · 已历 ${years} 载</b></div>
      <div class="kv"><span>库府</span><b>${fmt(s.res.stones)} 灵石</b></div>
      <div class="kv small"><span>产业</span><b>${siteTxt}</b></div>
      ${s.war ? `<div class="warn">⚔ 正在与「${(ctx.sects.byId.get(s.war.with) || {}).name || '—'}」交战</div>` : ''}
      ${s.enemies && s.enemies.size ? `<div class="kv small"><span>宿敌</span><b class="dn">${[...s.enemies].map(id => (ctx.sects.byId.get(id) || {}).name || '').filter(Boolean).join('、')}</b></div>` : ''}
      <div class="assets">${this._memberChips(s)}</div>
      <div class="uacts">
        <button class="abtn" data-act="focusmap" data-v="${Math.round(s.cx)},${Math.round(s.cy)}">定位山门</button>
        ${leader ? `<button class="abtn" data-act="focusunit" data-v="${leader.id}">查看宗主</button>` : ''}
      </div>
    </div>`;
    return html;
  }

  _siteSummary(s) {
    const ctx = this.ctx;
    const cnt = {};
    for (const sid of s.sites) {
      const site = ctx.world.sites[sid];
      if (!site) continue;
      const n = { 1: '灵脉', 2: '矿脉', 3: '灵田', 4: '药谷', 5: '洞天', 6: '魔渊' }[site.type] || '宝地';
      cnt[n] = (cnt[n] || 0) + 1;
    }
    const keys = Object.keys(cnt);
    if (!keys.length) return '无（靠什么吃饭？）';
    return keys.map(k => k + '×' + cnt[k]).join('　');
  }

  _memberChips(s) {
    const ctx = this.ctx;
    let h = '', n = 0;
    const alive = [];
    for (const id of s.members) {
      const u = ctx.units.byId.get(id);
      if (u && u.alive) alive.push(u);
    }
    alive.sort((a, b) => (b.realm * 100 + b.stage) - (a.realm * 100 + a.stage));
    for (const u of alive) {
      if (n >= 8) break;
      h += `<span class="chip" data-act="focusunit" data-v="${u.id}" style="border-color:${u.isDemon ? '#ff6060' : REALMS[u.realm].color}">${u.name}</span>`;
      n++;
    }
    if (alive.length > n) h += `<span class="chip more">+${alive.length - n}</span>`;
    return h || '<span class="empty small">门中无人</span>';
  }

  _bar(pct, color) {
    return `<div class="bar"><div class="barf" style="width:${clamp(pct, 0, 100).toFixed(1)}%;background:${color}"></div></div>`;
  }

  /** 修士：灵根资质以星级呈现 */
  _cultivatorCard(u) {
    const ctx = this.ctx;
    const need = ctx.units.needFor(u);
    const prog = clamp(u.cult / need, 0, 1);
    const R = REALMS[u.realm];
    const rt = ROOTS[u.root];
    const t = Math.min(5, rt.tier);
    const stars = '★'.repeat(t) + '☆'.repeat(5 - t);
    const agePct = clamp(u.age / u.life, 0, 1) * 100;
    const w = ctx.world;
    const ix = clamp(Math.floor(u.x), 0, w.W - 1), iy = clamp(Math.floor(u.y), 0, w.H - 1);
    const aura = w.aura[w.idx(ix, iy)];
    const place = ctx.sects ? ctx.sects.placeName(u.x, u.y) : '荒野';
    const sec = u.sectId >= 0 && ctx.sects ? ctx.sects.byId.get(u.sectId) : null;
    const sectInfo = sec
      ? (sec.name + '（' + sec.members.length + ' 人 · ' + (sec.area || 0) + ' 里 · ' + sec.level + ' 阶）')
      : '散修';
    return `<div class="card unit">
      <div class="ct" style="color:${u.ccolor}">${u.name}</div>
      <div class="kv"><span>境界</span><b style="color:${R.color}">${ctx.units.realmName(u)}</b></div>
      <div class="kv"><span>灵根资质</span><b style="color:${rt.color}">${rt.n}</b></div>
      <div class="kv small"><span>资质评级</span><b style="color:${rt.color};letter-spacing:1px">${stars}</b></div>
      <div class="kv"><span>道心</span><b>${u.daoHeart.toFixed(0)} / 100</b></div>
      ${this._bar(u.daoHeart, '#9fd8ff')}
      <div class="kv small"><span>寿元</span><b>${u.age.toFixed(0)} / ${u.life} 年</b></div>
      ${this._bar(100 - agePct, '#a0e8c0')}
      <div class="kv small"><span>气血</span><b>${(clamp(u.hp / u.maxHp, 0, 1) * 100).toFixed(0)}%</b></div>
      ${this._bar(clamp(u.hp / u.maxHp, 0, 1) * 100, u.hp / u.maxHp < 0.35 ? '#ff7070' : '#8ef08e')}
      <div class="kv"><span>宗门</span><b>${this._sectName(u)}</b></div>
      <div class="kv"><span>道途</span><b class="${u.isDemon ? 'dn' : 'hl'}">${u.isDemon ? '魔道' : '正道'}</b></div>
      <div class="kv"><span>性情</span><b class="hl">${this._persText(u)}</b></div>
      <div class="kv small"><span>所习道统</span><b>${this._brainName(u)}</b></div>
      <div class="kv"><span>状态</span><b>${this._stateName(u)}</b></div>
      <div class="kv"><span>战力</span><b class="hl">${fmt(u.cp)}</b></div>
      <div class="kv"><span>战绩</span><b class="${(u.kills || 0) > 0 ? 'wr' : ''}">${u.kills || 0} 杀</b></div>
      ${this._bar(prog * 100, R.color)}
      <div class="kv small"><span>修为</span><b>${fmt(u.cult)} / ${need === Infinity ? '圆满' : fmt(need)}</b></div>
      <div class="kv small"><span>突破预估</span><b>${this._breakEta(u, need)}</b></div>
      <div class="kv"><span>所在地</span><b>${place}</b></div>
      <div class="kv small"><span>此地灵气</span><b style="color:${aura > 60 ? '#8ef08e' : (aura > 30 ? '#ffd24a' : '#ff8080')}">${aura.toFixed(0)} / 100</b></div>
      ${this._envRow(u)}
      <div class="kv"><span>门中</span><b>${sectInfo}</b></div>
      <div class="kv"><span>师承</span><b>${u.rel && u.rel.master >= 0 ? this._relName(u.rel.master) : '无师自通'}</b></div>
      <div class="kv small"><span>门下</span><b>${this._disText(u)}</b></div>
      <div class="kv"><span>道侣</span><b class="hl">${u.rel && u.rel.mate >= 0 ? this._relName(u.rel.mate) : '独修'}</b></div>
      ${u.mem && u.mem.avenge ? '<div class="warn">⚔ 身负血仇，誓杀 ' + this._relName(u.mem.foeId) + '</div>' : ''}
      <div class="kv"><span>功法</span><b style="color:${TECH_TIERS[u.tech || 0].c}">${TECH_TIERS[u.tech || 0].n}</b></div>
      <div class="kv"><span>灵石</span><b>${fmt(u.stones)}</b></div>
      <div class="kv small"><span>采获</span><b>木 ${u.woods || 0} · 药 ${this._herbCount(u)} · 矿 ${this._oreCount(u)}</b></div>
      <div class="assets">${this._assetsHtml(u)}</div>
      <div class="uacts">
        <button class="abtn" data-act="uact" data-v="enlighten">点化</button>
        <button class="abtn" data-act="uact" data-v="protect">护道</button>
        <button class="abtn" data-act="uact" data-v="bestow">赐宝</button>
        <button class="abtn" data-act="uact" data-v="teach">传功</button>
        <button class="abtn" data-act="uact" data-v="reincarnate">轮回</button>
      </div>
      ${u.trib ? '<div class="warn">⚡ 正在渡劫：' + u.trib.type + '</div>' : ''}
    </div>`;
  }

  /** 妖兽：等阶 + 血脉 */
  _beastCard(u) {
    const R = REALMS[u.realm];
    const tiers = ['', '一阶', '二阶', '三阶', '四阶', '五阶'];
    const bt = u.beastTier || 1;
    const stars = '★'.repeat(Math.min(5, bt)) + '☆'.repeat(5 - Math.min(5, bt));
    return `<div class="card unit beast">
      <div class="ct" style="color:#e08a30">${u.name}</div>
      <div class="kv"><span>等阶</span><b style="color:#e08a30">${tiers[bt] || '一阶'}妖兽</b></div>
      <div class="kv small"><span>血脉评级</span><b style="color:#e08a30;letter-spacing:1px">${stars}</b></div>
      <div class="kv"><span>实力</span><b style="color:${R.color}">${R.n}期</b></div>
      <div class="kv"><span>气血</span><b>${(clamp(u.hp / u.maxHp, 0, 1) * 100).toFixed(0)}%</b></div>
      ${this._bar(clamp(u.hp / u.maxHp, 0, 1) * 100, '#e0a050')}
      <div class="kv small"><span>兽龄</span><b>${u.age.toFixed(0)} / ${u.life} 年</b></div>
      ${this._bar(100 - clamp(u.age / u.life, 0, 1) * 100, '#a0e8c0')}
      <div class="kv"><span>状态</span><b>${this._stateName(u)}</b></div>
      <div class="kv small"><span>习性</span><b>${bt >= 4 ? '凶悍，主动猎杀修士' : bt >= 2 ? '择弱者而食' : '避强凌弱'}</b></div>
    </div>`;
  }

  /** 灵植：品阶 + 生长 */
  _plantCard(u) {
    const herb = HERBS[Math.min(5, u.plantTier || 0)];
    const gp = clamp(u.grow || 0, 0, 1) * 100;
    const num = '一二三四五六'[(u.plantTier || 0)] || '一';
    const stars = '★'.repeat(Math.min(5, (u.plantTier || 0) + 1)) + '☆'.repeat(4 - Math.min(4, u.plantTier || 0));
    return `<div class="card unit plant">
      <div class="ct" style="color:${herb.c}">${herb.n}</div>
      <div class="kv"><span>品阶</span><b style="color:${herb.c}">${num}品灵植</b></div>
      <div class="kv small"><span>灵性评级</span><b style="color:${herb.c};letter-spacing:1px">${stars}</b></div>
      <div class="kv"><span>状态</span><b style="color:${u.mature ? '#8ef08e' : '#a8b8c8'}">${u.mature ? '✦ 已成熟' : '生长中'}</b></div>
      ${this._bar(gp, '#8ef08e')}
      <div class="kv small"><span>成熟度</span><b>${gp.toFixed(0)}%</b></div>
      <div class="kv small"><span>药性</span><b>${['温养经脉，固本培元', '清心凝神，助益筑基', '通络活血，金丹之引', '蕴龙息，元婴可期', '太阴之精，化神妙药', '太阳之华，渡劫至宝'][Math.min(5, u.plantTier || 0)]}</b></div>
      <div class="kv small"><span>习性</span><b>成熟后自行吐纳灵气，可被修士采集</b></div>
    </div>`;
  }

  /** 性格四维 → 人话 */
  _persText(u) {
    if (!u.pers) return '—';
    const p = u.pers, t = [];
    if (p[0] > 0.62) t.push('谨慎'); else if (p[0] < 0.38) t.push('莽撞');
    if (p[1] > 0.62) t.push('好战'); else if (p[1] < 0.38) t.push('平和');
    if (p[2] > 0.62) t.push('贪婪'); else if (p[2] < 0.38) t.push('清高');
    if (p[3] > 0.62) t.push('好奇'); else if (p[3] < 0.38) t.push('守成');
    return t.length ? t.join('·') : '中庸';
  }

  _brainName(u) {
    const pool = this.ctx.brains;
    if (!pool || u.brainId == null) return '—';
    const b = pool.at(u.brainId);
    return b ? (b.name + ' · 第 ' + b.gen + ' 代') : '—';
  }

  _relName(id) {
    if (id == null || id < 0) return '—';
    const o = this.ctx.units.byId.get(id);
    if (!o) return '（无从查考）';
    return o.alive ? o.name : o.name + '（已故）';
  }

  _disText(u) {
    if (!u.rel || !u.rel.dis || !u.rel.dis.length) return '暂无弟子';
    const names = [];
    for (const id of u.rel.dis) {
      const o = this.ctx.units.byId.get(id);
      if (o && o.alive) names.push(o.name);
    }
    return names.length ? names.join('、') : '弟子皆已凋零';
  }

  _herbCount(u) { let n = 0; for (const k in (u.herbs || {})) n += u.herbs[k]; return n; }
  _oreCount(u) { let n = 0; for (const k in (u.ores || {})) n += u.ores[k]; return n; }

  /** 突破预估：按当前环境灵气推算还需多少年 */
  _breakEta(u, need) {
    if (need === Infinity) return '已至巅峰';
    const ctx = this.ctx, w = ctx.world, b = CFG.balance;
    const i = w.idx(clamp(Math.floor(u.x), 0, w.W - 1), clamp(Math.floor(u.y), 0, w.H - 1));
    const aura = w.aura[i], demon = w.demon[i];
    const eff = u.isDemon ? aura * 0.30 + demon * 1.20 : Math.max(0, aura - demon * 0.9);
    const af = b.auraFunc.base + clamp(eff, 0, 100) / 100 * b.auraFunc.span;
    const speed = REALMS[u.realm].speed * b.cultSpeedBase * af * ROOTS[u.root].cult * (1 + u.daoHeart / 300);
    const left = Math.max(0, need - u.cult);
    if (left <= 0) return '随时可破';
    const y = left / Math.max(0.01, speed);
    if (y > 4000) return '遥遥无期';
    return '约 ' + Math.round(y) + ' 年';
  }

  /** 四周态势：同类与威胁 */
  _envRow(u) {
    let ally = 0, foe = 0;
    this.ctx.units.forEachNear(u.x, u.y, 12, (o) => {
      if (!o.alive || o === u) return;
      if (o.type === U_TYPE.BEAST) { if (u.type !== U_TYPE.BEAST) foe++; else ally++; }
      else if (u.type === U_TYPE.BEAST && o.type === U_TYPE.CULTIVATOR) foe++;
      else if (o.type === u.type) ally++;
    });
    const parts = [];
    if (ally) parts.push('同类 ' + ally);
    if (foe) parts.push('<span class="dn">威胁 ' + foe + '</span>');
    if (!parts.length) return '<div class="kv small"><span>四周</span><b>一片寂静</b></div>';
    return '<div class="kv small"><span>四周</span><b>' + parts.join(' · ') + '</b></div>';
  }

  /** 全服资质总评 */
  _gradeText(rh, total) {
    let sum = 0;
    ROOTS.forEach((r, i) => { sum += Math.min(5, r.tier) * rh[i]; });
    const avg = sum / total;
    if (avg >= 3.6) return '仙品辈出 ✦';
    if (avg >= 2.6) return '英才济济';
    if (avg >= 1.8) return '中规中矩';
    if (avg >= 1.0) return '良莠不齐';
    return '资质凋敝';
  }

  _stateName(u) {
    const s = u.state;
    const N = {
      idle: '静立', wander: '游荡', seek: '赶路', cultivate: '打坐修炼',
      fight: '斗法中', flee: '逃遁', break: '突破中', trib: '渡劫中',
      explore: '探秘', found: '开宗立派', mated: '交配',
      expand: '拓土开疆',
    };
    return N[s] || '静立';
  }

  _assetsHtml(u) {
    let h = '';
    if (u.arts && u.arts.length) {
      for (const a of u.arts.slice(0, 5)) {
        h += `<span class="asset" data-act="asset" data-k="art" data-v="${a.tier}_${a.kind}" title="${ARTIFACT_TIERS[a.tier].n}"></span>`;
      }
    }
    const herbs = Object.keys(u.herbs || {});
    for (const k of herbs.slice(0, 4)) {
      h += `<span class="asset" data-act="asset" data-k="herb" data-v="${k}" title="${HERBS[k].n}×${u.herbs[k]}"></span>`;
    }
    if (!h) h = '<span class="empty small">身无长物</span>';
    return h;
  }

  drawAssets() {
    this.el.rightBody.querySelectorAll('.asset').forEach(sp => {
      const k = sp.dataset.k, v = sp.dataset.v;
      let url;
      if (k === 'art') { const p = v.split('_'); const t = Number(p[0]), kind = Number(p[1]); url = iconURL('art' + t + '_' + kind, 26, (g, s) => drawArtifact(g, s, kind, t)); }
      else if (k === 'herb') { url = iconURL('herb' + v, 26, (g, s) => drawHerb(g, s, Number(v))); }
      else if (k === 'stone') { url = iconURL('stone' + v, 26, (g, s) => drawSpiritStone(g, s, Number(v))); }
      else if (k === 'ore') { url = iconURL('ore' + v, 26, (g, s) => drawOre(g, s, Number(v))); }
      else if (k === 'pill') { url = iconURL('pill' + v, 26, (g, s) => drawPill(g, s, Number(v))); }
      else if (k === 'tech') { url = iconURL('tech' + v, 26, (g, s) => drawTechnique(g, s, Number(v))); }
      if (url) { const im = document.createElement('img'); im.src = url; im.width = 26; im.height = 26; sp.appendChild(im); }
    });
  }

  /* ---------- 日志 ---------- */
  refreshLog() {
    const list = this.ctx.events.recent(46);
    this.el.logBody.innerHTML = list.map(e =>
      `<div class="logline"><span class="ly">${Math.floor(e.year)}年</span>
       <span class="lt" style="color:${this.ctx.events.color(e.type)}">${e.text}</span></div>`).join('');
  }

  /* ---------- 提示 ---------- */
  toast(msg, ms) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('show');
    this.toastT = performance.now() + (ms || 1800);
  }

  /* ---------- 各项刷新 ---------- */
  updateMana(mana, max) {
    this.el.manaFill.style.width = (mana / max * 100).toFixed(1) + '%';
    this.el.manaTxt.textContent = '天道之力 ' + Math.floor(mana);
  }

  setActivePower(id) {
    this.el.powerList.querySelectorAll('.pbtn').forEach(b => {
      b.classList.toggle('on', b.dataset.v === id);
    });
    const p = POWER_LIST.find(x => x.id === id);
    document.getElementById('powerTip').textContent = p
      ? p.name + '：' + p.desc + '（耗 ' + p.cost + ' 天道之力）'
      : '选择一个神力后，在地图上点击或拖动施放。';
  }

  setView(v) {
    this.view = v;
    this.el.viewCtl.querySelectorAll('.tbtn').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  }

  setSpeed(i) {
    this.speedIdx = i;
    document.querySelectorAll('#timeCtl .tbtn').forEach(b => b.classList.toggle('on', Number(b.dataset.v) === CFG.time.speeds[i]));
  }
}

/* ================= 交互绑定（追加） ================= */
UI.prototype._bindGlobal = function () {
  const ctx = this.ctx;
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act, v = t.dataset.v;
    switch (act) {
      case 'speed': {
        const sp = Number(v);
        ctx.sim.speed = sp;
        this.setSpeed(CFG.time.speeds.indexOf(sp));
        ctx.sim.paused = sp === 0;
        break;
      }
      case 'view': this.setView(v); break;
      case 'power': {
        const id = ctx.powers.select(v);
        if (id && this.panMode) {           // 选神力即退出移动模式
          this.panMode = false;
          const pb = document.querySelector('[data-act="panmode"]');
          if (pb) pb.classList.remove('on');
        }
        this.setActivePower(id);
        break;
      }
      case 'rtab': {
        this.rightTab = v;
        document.querySelectorAll('.rtab').forEach(b => b.classList.toggle('on', b.dataset.v === v));
        this.refreshInfo(true);
        this.drawAssets();
        break;
      }
      case 'toggle-log':
        this.logOpen = !this.logOpen;
        this.el.logbar.classList.toggle('closed', !this.logOpen);
        break;
      case 'uact': {
        const u = this.selUnit;
        if (!u || !u.alive) { this.toast('未选中单位'); break; }
        ctx.powers.select(v);
        const r = ctx.powers.use(u.x, u.y, u);
        this.toast(r.ok ? ctx.powers.byId[v].name + ' 已施放' : (r.msg || '施放失败'));
        this.setActivePower(null);
        break;
      }
      case 'focusunit': {
        const u = ctx.units.byId.get(Number(v));
        if (u) { this.selUnit = u; this.selSect = null; this.rightTab = 'unit'; ctx.renderer.sel = u; ctx.renderer.cam.x = u.x; ctx.renderer.cam.y = u.y; ctx.renderer.clampCam(); this.refreshInfo(true); this.drawAssets(); }
        break;
      }
      case 'focussect': {
        const s = ctx.sects.byId.get(Number(v));
        if (s) {
          ctx.renderer.cam.x = s.cx; ctx.renderer.cam.y = s.cy;
          ctx.renderer.clampCam();
          this.selSect = s; this.selUnit = null; this.selSite = null;
          this.rightTab = 'unit';
          document.querySelectorAll('.rtab').forEach(b => b.classList.toggle('on', b.dataset.v === 'unit'));
          this.refreshInfo(true);
        }
        break;
      }
      case 'focusmap': {
        const p = String(v).split(',').map(Number);
        if (p.length === 2 && isFinite(p[0])) {
          ctx.renderer.cam.x = p[0]; ctx.renderer.cam.y = p[1];
          ctx.renderer.clampCam();
          this.toast('已定位', 900);
        }
        break;
      }
      case 'zoom': {
        ctx.renderer.cam.zoom *= (v === '1' ? 1.25 : 0.8);
        ctx.renderer.clampCam();
        break;
      }
      case 'panmode': {
        this.panMode = !this.panMode;
        if (this.panMode) {
          ctx.powers.select(null); this.setActivePower(null);
          this.toast('✋ 移动模式：单指拖动即可挪动镜头', 2000);
        } else {
          this.toast('已退出移动模式', 1200);
        }
        const pb = document.querySelector('[data-act="panmode"]');
        if (pb) pb.classList.toggle('on', this.panMode);
        break;
      }
      case 'save': ctx.save.save(); break;
      case 'help': this.showHelp(); break;
      case 'modal-close': this.el.modal.classList.add('hidden'); break;
      case 'toggle-left': document.getElementById('panel-left').classList.toggle('open'); break;
      case 'toggle-right': document.getElementById('panel-right').classList.toggle('open'); break;
      case 'preset': {
        ctx.newWorld(Number(v));
        break;
      }
    }
  });

  const br = document.getElementById('brRange');
  const st = document.getElementById('stRange');
  br.addEventListener('input', () => {
    ctx.powers.brushR = Number(br.value);
    document.getElementById('brVal').textContent = br.value;
  });
  st.addEventListener('input', () => {
    ctx.powers.strength = Number(st.value);
    document.getElementById('stVal').textContent = Number(st.value).toFixed(1);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') {
      e.preventDefault();
      const sp = ctx.sim.speed === 0 ? ctx.sim.lastSpeed || 1 : 0;
      if (sp === 0) ctx.sim.lastSpeed = ctx.sim.speed;
      ctx.sim.speed = sp; ctx.sim.paused = sp === 0;
      this.setSpeed(CFG.time.speeds.indexOf(sp));
    } else if (e.key >= '1' && e.key <= '5') {
      this.setView(VIEWS[Number(e.key) - 1].id);
    } else if (e.key === '[' || e.key === ']') {
      const idx = clamp(CFG.time.speeds.indexOf(ctx.sim.speed) + (e.key === ']' ? 1 : -1), 0, CFG.time.speeds.length - 1);
      ctx.sim.speed = CFG.time.speeds[idx]; ctx.sim.paused = ctx.sim.speed === 0;
      this.setSpeed(idx);
    } else if (e.key === 'w' || e.key === 'a' || e.key === 's' || e.key === 'd') {
      const d = 22 / ctx.renderer.cam.zoom * 1.6;
      if (e.key === 'w') ctx.renderer.cam.y -= d;
      if (e.key === 's') ctx.renderer.cam.y += d;
      if (e.key === 'a') ctx.renderer.cam.x -= d;
      if (e.key === 'd') ctx.renderer.cam.x += d;
      ctx.renderer.clampCam();
    } else if (e.key === 'Escape') {
      this.el.modal.classList.add('hidden');
      ctx.powers.select(null); this.setActivePower(null);
    }
  });
};

/** 绑定画布交互（必须在 Renderer 创建之后调用） */
UI.prototype.bindCanvas = function () {
  const ctx = this.ctx;
  const cv = this.el.canvas;
  const R = ctx.renderer;
  if (!R) { console.error('bindCanvas: Renderer 尚未创建'); return; }
  let drag = false, lastX = 0, lastY = 0, moved = 0;
  let casting = false, lastCast = 0;
  const ptrs = new Map();
  let pinch = 0, pinchCx = 0, pinchCy = 0;

  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  cv.addEventListener('contextmenu', e => e.preventDefault());

  cv.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') e.preventDefault();   // 触摸手势不被浏览器吞掉
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件可能失败 */ }
    const p = pos(e);
    ptrs.set(e.pointerId, p);
    if (ptrs.size >= 2) {
      const arr = [...ptrs.values()];
      pinch = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
      pinchCx = (arr[0].x + arr[1].x) / 2;
      pinchCy = (arr[0].y + arr[1].y) / 2;
      drag = false; casting = false;
      return;
    }
    if (e.button === 2 || e.button === 1 || e.shiftKey || this.panMode) {
      drag = true; lastX = p.x; lastY = p.y; moved = 0;
    } else {
      const pw = ctx.powers.activePower;
      if (pw) { casting = true; this._cast(p.x, p.y); lastCast = performance.now(); }
      else { drag = true; lastX = p.x; lastY = p.y; moved = 0; }
    }
  });

  cv.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') e.preventDefault();
    const p = pos(e);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
    // 笔刷指示
    const wp = R.s2w(p.x, p.y);
    R.brushCursor = { x: wp.x, y: wp.y, r: ctx.powers.brushR };
    if (ptrs.size >= 2) {
      const arr = [...ptrs.values()];
      const d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
      const cx = (arr[0].x + arr[1].x) / 2, cy = (arr[0].y + arr[1].y) / 2;
      // 双指捏合缩放
      if (pinch > 6 && d > 6) R.cam.zoom = clamp(R.cam.zoom * clamp(d / pinch, 0.9, 1.12), 0.5, 20);
      // 双指整体移动 → 平移镜头
      R.cam.x -= (cx - pinchCx) / R.cam.zoom;
      R.cam.y -= (cy - pinchCy) / R.cam.zoom;
      R.clampCam();
      pinch = d; pinchCx = cx; pinchCy = cy;
      return;
    }
    if (casting) {
      if (performance.now() - lastCast > 110) { this._cast(p.x, p.y); lastCast = performance.now(); }
      return;
    }
    if (drag) {
      const dx = p.x - lastX, dy = p.y - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      R.cam.x -= dx / R.cam.zoom;
      R.cam.y -= dy / R.cam.zoom;
      R.clampCam();
      lastX = p.x; lastY = p.y;
    }
  });

  const end = (e) => {
    const p = pos(e);
    const wasMulti = ptrs.size >= 2;
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) { pinch = 0; pinchCx = 0; pinchCy = 0; }
    // 双指抬起一指 → 剩下那指继续平移，避免手势中断
    if (wasMulti && ptrs.size === 1 && !casting) {
      const rest = [...ptrs.values()][0];
      drag = true; lastX = rest.x; lastY = rest.y; moved = 999;
      return;
    }
    if (casting) { casting = false; return; }
    if (drag) {
      if (moved < 5) this._tap(p.x, p.y);
      drag = false;
    }
  };
  const cancel = (e) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) { pinch = 0; pinchCx = 0; pinchCy = 0; }
    if (ptrs.size === 0) { drag = false; casting = false; }
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', cancel);
  cv.addEventListener('lostpointercapture', cancel);
  cv.addEventListener('pointerleave', () => { R.brushCursor = null; });

  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    R.cam.zoom *= (e.deltaY < 0 ? 1.14 : 0.88);
    R.clampCam();
  }, { passive: false });

  cv.addEventListener('dblclick', (e) => {
    const p = pos(e);
    const u = R.pick(p.x, p.y);
    if (u.kind === 'unit') { R.cam.x = u.unit.x; R.cam.y = u.unit.y; }
  });
};

UI.prototype._cast = function (sx, sy) {
  const ctx = this.ctx, R = ctx.renderer;
  const wp = R.s2w(sx, sy);
  const hit = ctx.units.pick(wp.x, wp.y);
  const r = ctx.powers.use(wp.x, wp.y, hit);
  if (!r.ok && r.msg) this.toast(r.msg, 900);
  else if (r.ok) this._bumpMana();
};

UI.prototype._bumpMana = function () {
  this.updateMana(this.ctx.powers.mana, this.ctx.powers.manaMax);
};

UI.prototype._tap = function (sx, sy) {
  const ctx = this.ctx, R = ctx.renderer;
  const hit = R.pick(sx, sy);
  if (hit.kind === 'unit') {
    this.selUnit = hit.unit;
    R.sel = hit.unit;
    this.selSite = null;
    if (this.rightTab !== 'unit') { this.rightTab = 'unit'; document.querySelectorAll('.rtab').forEach(b => b.classList.toggle('on', b.dataset.v === 'unit')); }
    this.refreshInfo(true);
    this.drawAssets();
  } else if (hit.kind === 'sect') {
    this.selSect = hit.sect;
    this.selUnit = null; this.selSite = null;
    R.sel = null; R.hoverSite = null;
    this.rightTab = 'unit';
    document.querySelectorAll('.rtab').forEach(b => b.classList.toggle('on', b.dataset.v === 'unit'));
    this.refreshInfo(true);
  } else if (hit.kind === 'site') {
    this.selSite = hit.site;
    this.selUnit = null; this.selSect = null; R.sel = null;
    R.hoverSite = hit.site.id;
    this.toast(RES_INFO[hit.site.type].n + '（品阶 ' + (hit.site.tier + 1) + '）· 储量 ' + Math.round(hit.site.reserve) + '%', 1600);
  } else {
    this.selUnit = null; this.selSect = null; R.sel = null; R.hoverSite = null;
    this.rightTab = 'world';
    document.querySelectorAll('.rtab').forEach(b => b.classList.toggle('on', b.dataset.v === 'world'));
    this.refreshInfo(true);
  }
};

UI.prototype.showHelp = function () {
  this.el.modalBody.innerHTML = `
    <h2>太虚演天 · 操作指引</h2>
    <div class="hsec"><b>视角</b>
      <p>左键拖动 / 右键拖动：平移　·　滚轮 / 双指：缩放　·　WASD 也可移动视角</p></div>
    <div class="hsec"><b>神力</b>
      <p>左侧选择神力 → 在地图上点击或拖动施放。施放消耗「天道之力」，随时间自动恢复。</p></div>
    <div class="hsec"><b>点化类神力</b>
      <p>先点击选中一位修士，再点「点化 / 护道 / 赐宝 / 传功 / 轮回」。</p></div>
    <div class="hsec"><b>观察</b>
      <p>切换视图查看灵气、魔气、宗门势力与资源分布。右侧面板可查看境界榜与宗门录。</p></div>
    <div class="hsec"><b>快捷键</b>
      <p>空格：暂停/继续　·　1-5：切换视图　·　[ ]：调速　·　Esc：取消</p></div>
    <div class="hsec"><b>世界会自己演化</b>
      <p>修士自行修炼、突破、结社、争斗。渡劫成败皆有天数，你可护道，亦可降下心魔。</p></div>
    <button class="abtn wide" data-act="modal-close">明白了</button>`;
  this.el.modal.classList.remove('hidden');
};
