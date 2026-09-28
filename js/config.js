/**
 * config.js —— 全局配置、平衡性参数、静态数据表
 * 所有可调数值集中于此，方便调优。
 */

export const CFG = {
  version: '1.0.0',
  title: '太虚演天',

  world: {
    W: 256, H: 256,        // 世界尺寸（格）
    TILE: 8,               // 离屏地形图每格像素（决定放大后的精细度）
    CHUNK: 16,             // 脏块尺寸（格）
    seeds: [20260925],
  },

  time: {
    yearsPerSecond: 1,     // 1x 速度下，1 真实秒 = 1 世界年
    speeds: [0, 1, 2, 5, 10, 20],
    moveMulMax: 8,         // 单位位移动画的最高倍率（否则高倍速下行军永远走不到战场）
    maxTicksPerFrame: 24,  // 单帧最多补算的世界年数
  },

  noise: { octaves: 6, lacunarity: 2.0, gain: 0.5 },

  sim: {
    maxUnits: 999999,      // 无上限（性能靠空间网格 + 分级降载扛）
    detailCap: 900,        // 超过则启用简化 AI
    viewAuraRange: 24,     // 寻找修炼点时的搜索半径
    decideMin: 1, decideMax: 3,
    lodDecide: 320,        // 超过此数拉长决策间隔
    lodHeavy: 900,         // 超过此数进一步简化
    lodExtreme: 2200,      // 超过此数启用分帧更新
  },

  god: {
    powerMax: 140,
    powerRegen: 1.6,       // 每秒恢复
  },

  balance: {
    cultSpeedBase: 1.8,          // 修炼速度全局倍率（配合寿元：炼气约需 130 年，飞升需约两万年）
    stageNeedMul: [0.30, 0.45, 0.58],  // 小阶段需求 = realm.need * mul（合计 1.33）
    realmBreakNeedMul: 0.30,     // 跨大境界需求 = next.need * mul
    auraFunc: { base: 0.25, span: 1.35 },
    breakBase: 0.42,             // 小阶段基础成功率（低基数，让资质/功法/道心/灵气拉开差距）
    tribBase: 0.36,              // 渡劫基础成功率
    failCultLoss: 0.45,          // 突破失败损失修为（加重，避免反复硬试必成）
    failHpLoss: 0.40,
    qiDeviation: 0.05,           // 走火入魔概率
  },

  sect: {
    foundRealm: 2,         // 金丹起可立宗
    foundNeighbors: 2,     // 需要附近无宗修士响应数
    maxMembers: [0, 12, 30, 70, 140, 260],
    expand: 0.10,          // 每年扩张概率
    war: 0.022,            // 每年开战概率（提高以增加大规模会战出现率）
    taxPerSite: 1.0,
  },

  res: {
    siteGen: 9,            // 资源点采样间隔（格）
  },

  // ---- 生态：妖兽以饥饿为第一驱动力，进化需吃饱 ----
  eco: {
    hungerRate: 2.5,         // 每年饥饿增长
    hungerHighMul: 2,        // 3 阶以上消耗翻倍
    hungerEatPlant: 24,      // 啃食草木回补（须高于 hungerRate/啃食概率）
    hungerKill: 35,          // 猎杀得手回补
    starveHpLoss: 0.06,      // 饿极时每年流失的 HP 比例
    hungerHunt: 70,          // 超过此值：饥不择食，主动扑击修士
    hungerForage: 35,        // 超过此值：开始觅食
    evolveFoodNeed: [0, 250, 800, 2200, 5000],  // 各阶进化所需"存粮"（进化时消耗）
    evolveChance: 0.008,     // 达标后每年进化概率（低概率才不至于人人满阶）
  },
};

/* ---------- 境界体系 ---------- */
// life:寿元(年) speed:修炼速度倍率 need:本境界总需求 power:战力倍率
// move:移动速度(格/秒) color:代表色 glow:光晕档位
export const REALMS = [
  { n: '炼气', life: 260,   speed: 1,   need: 100,     power: 1,     move: 1.9, color: '#d8d8dc', glow: 0 },
  { n: '筑基', life: 440,   speed: 2,   need: 500,     power: 5,     move: 2.7, color: '#5cd65c', glow: 0 },
  { n: '金丹', life: 1100,  speed: 4,   need: 2000,    power: 25,    move: 3.6, color: '#5aa0ff', glow: 1 },
  { n: '元婴', life: 2200,  speed: 8,   need: 8000,    power: 100,   move: 4.6, color: '#b060ff', glow: 1 },
  { n: '化神', life: 4400,  speed: 16,  need: 30000,   power: 500,   move: 5.6, color: '#ffd24a', glow: 2 },
  { n: '炼虚', life: 11000, speed: 32,  need: 100000,  power: 2500,  move: 6.4, color: '#40ffd0', glow: 2 },
  { n: '合体', life: 22000, speed: 64,  need: 350000,  power: 10000, move: 7.0, color: '#ff9040', glow: 3 },
  { n: '大乘', life: 66000, speed: 128, need: 1000000, power: 50000, move: 7.6, color: '#ff50a0', glow: 3 },
];
export const STAGES = ['初期', '中期', '后期', '圆满'];
export const MAX_REALM = REALMS.length - 1;

/* ---------- 灵根 ---------- */
// w:权重 cult:修炼系数 brk:突破加成 color:颜色
export const ROOTS = [
  { n: '天灵根', w: 3,  cult: 1.55, brk: 0.20,  color: '#ffe680', tier: 5 },
  { n: '变异灵根', w: 5,  cult: 1.35, brk: 0.15, color: '#ff9ae0', tier: 4 },
  { n: '单灵根', w: 14, cult: 1.22, brk: 0.10,  color: '#a0e0ff', tier: 3 },
  { n: '双灵根', w: 26, cult: 1.08, brk: 0.05,  color: '#b8ffb8', tier: 2 },
  { n: '三灵根', w: 27, cult: 0.98, brk: 0.00,  color: '#d8d8d8', tier: 1 },
  { n: '四灵根', w: 17, cult: 0.86, brk: -0.07, color: '#e0c090', tier: 1 },
  { n: '五灵根', w: 8,  cult: 0.72, brk: -0.15, color: '#c09090', tier: 0 },
];
export const ELEMENTS = ['金', '木', '水', '火', '土'];
export const ELEM_COLORS = { 金: '#ffe9a0', 木: '#8ef08e', 水: '#8ec8ff', 火: '#ff9a7a', 土: '#e0c890' };

/* ---------- 生物群系 ---------- */
// water:是否水域 veg:植被密度 base:基础色
export const BIOME = {
  DEEP_SEA: 0, SEA: 1, BEACH: 2, PLAIN: 3, HILL: 4, MOUNTAIN: 5, SNOW: 6,
  FOREST: 7, GRASS: 8, DESERT: 9, SNOWFIELD: 10,
  LINGTIAN: 11, DEMON_FOREST: 12, YAOGU: 13, DEADLAND: 14, ABYSS: 15, CAVE: 16,
};

export const BIOME_INFO = [
  { id: 0,  n: '深海',     c: [8, 18, 52],    water: true,  pass: false },
  { id: 1,  n: '浅海',     c: [20, 58, 118],  water: true,  pass: false },
  { id: 2,  n: '沙滩',     c: [204, 192, 144],water: false, pass: true },
  { id: 3,  n: '平原',     c: [84, 138, 62],  water: false, pass: true },
  { id: 4,  n: '丘陵',     c: [108, 122, 66], water: false, pass: true },
  { id: 5,  n: '高山',     c: [128, 112, 92], water: false, pass: true },
  { id: 6,  n: '雪峰',     c: [226, 230, 238],water: false, pass: true },
  { id: 7,  n: '森林',     c: [48, 104, 52],  water: false, pass: true },
  { id: 8,  n: '草原',     c: [126, 168, 74], water: false, pass: true },
  { id: 9,  n: '沙漠',     c: [212, 186, 120],water: false, pass: true },
  { id: 10, n: '雪原',     c: [214, 222, 232],water: false, pass: true },
  { id: 11, n: '灵田',     c: [104, 190, 116],water: false, pass: true },
  { id: 12, n: '妖兽森林', c: [40, 88, 60],   water: false, pass: true },
  { id: 13, n: '药谷',     c: [122, 176, 132],water: false, pass: true },
  { id: 14, n: '绝灵之地', c: [92, 84, 76],   water: false, pass: true },
  { id: 15, n: '魔渊',     c: [58, 14, 78],   water: false, pass: true },
  { id: 16, n: '洞天福地', c: [176, 200, 230],water: false, pass: true },
];

/* ---------- 资源点 ---------- */
export const RES_TYPE = {
  NONE: 0, LINGMAI: 1, ORESITE: 2, LINGTIAN: 3, YAOGU: 4, DONGXUE: 5, ABYSSNODE: 6,
};
export const RES_INFO = {
  1: { n: '灵脉', c: '#40ffd0', yield: 'stone' },
  2: { n: '矿脉', c: '#ffc850', yield: 'ore' },
  3: { n: '灵田', c: '#8cf08c', yield: 'herb' },
  4: { n: '药谷', c: '#d080ff', yield: 'herb' },
  5: { n: '洞天福地', c: '#ffffff', yield: 'all' },
  6: { n: '魔渊', c: '#a020c0', yield: 'demon' },
};

export const ORES = [
  { n: '铁精',   tier: 0, c: '#a08868' },
  { n: '铜精',   tier: 0, c: '#c08040' },
  { n: '银精',   tier: 1, c: '#d0d0e0' },
  { n: '金精',   tier: 1, c: '#ffd700' },
  { n: '玄铁',   tier: 2, c: '#585868' },
  { n: '寒铁',   tier: 3, c: '#88d0ff' },
  { n: '星辰铁', tier: 4, c: '#ffffff' },
];

export const HERBS = [
  { n: '聚灵草', tier: 0, c: '#7aa85a', grow: 8 },
  { n: '凝露花', tier: 1, c: '#8ec8a8', grow: 20 },
  { n: '金髓芝', tier: 2, c: '#c8a848', grow: 50 },
  { n: '龙涎果', tier: 3, c: '#e07070', grow: 120 },
  { n: '太阴真芝', tier: 4, c: '#b0b0e8', grow: 300 },
  { n: '太阳神草', tier: 5, c: '#ffd050', grow: 600 },
];

export const PILLS = [
  { n: '聚气丹', tier: 0, eff: 'cult', val: 0.5, dur: 12 },
  { n: '筑基丹', tier: 1, eff: 'break', val: 0.20, realm: 1 },
  { n: '金丹',   tier: 2, eff: 'break', val: 0.15, realm: 2 },
  { n: '元婴丹', tier: 3, eff: 'break', val: 0.10, realm: 3 },
  { n: '渡劫丹', tier: 4, eff: 'trib', val: 0.20 },
  { n: '疗伤丹', tier: 0, eff: 'heal', val: 0.6 },
];

export const ARTIFACT_TIERS = [
  { n: '凡器', mult: 0.10 }, { n: '法器', mult: 0.30 }, { n: '灵器', mult: 0.80 },
  { n: '宝器', mult: 2.00 }, { n: '道器', mult: 5.00 }, { n: '仙器', mult: 20.0 },
];

export const TECH_TIERS = [
  { n: '黄阶', cult: 0.00,  power: 0.00, c: '#c0a060' },
  { n: '玄阶', cult: 0.20,  power: 0.20, c: '#60d0ff' },
  { n: '地阶', cult: 0.50,  power: 0.50, c: '#c060ff' },
  { n: '天阶', cult: 1.00,  power: 1.00, c: '#ffd700' },
  { n: '仙阶', cult: 2.00,  power: 3.00, c: '#ffffff' },
];

/* ---------- 世界奇观 ---------- */
export const WONDERS = [
  { id: 'taiji',  n: '太极冰火池', desc: '阴阳两仪，产太阴真芝与太阳神草', c: ['#ff8a5a', '#7ac0ff'] },
  { id: 'beidou', n: '北斗灵枢',   desc: '夜引星辰，方圆百里突破概率大增', c: ['#8ec8ff', '#ffffff'] },
  { id: 'wuxing', n: '五行造化环', desc: '五行流转，周边灵物产出倍增',     c: ['#ffd24a', '#8ef08e'] },
];

/* ---------- 命名素材 ---------- */
export const NAME = {
  sur: ('李王张刘陈杨黄赵吴周徐孙马朱胡郭何林罗高郑梁谢宋唐许韩冯邓曹彭萧蔡潘田董袁于余叶蒋杜苏魏程吕丁沈任姚卢傅钟姜崔谭廖范汪陆金石戴贾韦夏邱方侯邹熊孟秦白江阎薛尹段雷黎史陶贺毛郝顾龚邵万钱严武莫孔向汤常温康施文牛樊葛邢安齐易乔伍庞颜倪庄聂章鲁岳翟殷詹申欧耿关兰焦俞左柳甘祝包宁尚符舒阮柯纪梅童凌毕单季裴霍涂成苗谷盛曲翁冉骆蓝路游辛靳管柴蒙鲍华喻祁蒲房滕屈饶解牟艾尤阳时穆农司卓古吉缪简车项连芦麦褚娄窦戚岑景党宫费卜冷晏席卫米柏宗瞿桂全佟应臧闵苟邬边卞姬邰任仇栾隋商刁沙荣巫寇桑郎甄丛仲虞敖巩明佘池查麻苑迟范廉戴').split(''),
  given: ('玄尘羽清霜剑无涯墨白青离寒凌元真道天衍溟阳阴赤紫澜昀霄辰冥虚灵逸尘风雷云岳松竹梅兰菊亭月星辉光明远山泉江海渊博文昊乾坤宇轩然若水清源问心悟禅静宁空明').split(''),
  title: ['真人', '道君', '上人', '老祖', '真君', '散人', '居士', '仙尊'],
  sectA: ['太虚', '无极', '青云', '紫霄', '天罡', '幽泉', '血影', '万毒', '焚天', '玄阴', '少阳',
          '北斗', '九幽', '幻月', '寒山', '碎星', '赤霄', '灵犀', '流云', '碧游', '苍梧', '玉衡',
          '寂灭', '长生', '归元', '罗天', '混元', '星河', '雷泽', '沧溟'],
  sectB: ['宗', '门', '殿', '阁', '谷', '派', '教', '院'],
  sectDemonA: ['血', '魔', '煞', '冥', '尸', '鬼', '毒', '噬', '阴', '绝'],
  sectDemonB: ['罗殿', '渊', '教', '魔宗', '鬼窟', '血门', '煞宗'],
};

/* ---------- 事件类型 ---------- */
export const EV = {
  SECT: 'sect', ASCEND: 'ascend', WAR: 'war', BREAK: 'break',
  DISASTER: 'disaster', DIVINE: 'divine', DEATH: 'death', BIRTH: 'birth', SYS: 'sys',
};
export const EV_COLOR = {
  sect: '#8ecfff', ascend: '#ffd24a', war: '#ff6a6a', break: '#8ef08e',
  disaster: '#ff9a4a', divine: '#d0a0ff', death: '#a0a0a0', birth: '#a0e0c0', sys: '#7f8fa0',
};
