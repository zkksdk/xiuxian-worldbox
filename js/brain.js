/**
 * brain.js —— 性格基因 · 轻量神经网络 · 进化筛选
 *
 * 网络结构：24 输入 → 18 隐藏(tanh) → 7 输出
 * 全服只维护 16 套"道统"（权重池），每个单位引用其中一套。
 * 每 50 年按"使用者的成就"评选：淘汰最差、复制并变异最优 —— 世界自己筛选活法。
 *
 * 设计要点：网络只做"偏好偏移"，规则分作骨架（保证不出智障行为），
 * 性格基因做个性调制 —— 三者相乘才是最终倾向。
 */
import { RNG, clamp } from './util.js';

export const N_IN = 24, N_HID = 18, N_OUT = 7;
const OFF_W1 = 0;
const OFF_B1 = N_IN * N_HID;              // 18 个隐藏层偏置
const OFF_W2 = OFF_B1 + N_HID;
const OFF_B2 = OFF_W2 + N_HID * N_OUT;    // 7 个输出层偏置
export const W_LEN = OFF_B2 + N_OUT;

/** 七种行为 */
export const ACT = {
  FLEE: 0, CULTIVATE: 1, FIGHT: 2, EXPLORE: 3, CLAIM: 4, BREAK: 5, WANDER: 6,
};
export const ACT_NAME = ['遁走', '苦修', '争锋', '探秘', '拓业', '冲关', '游历'];

const DAO_NAMES = ['太虚道', '无极道', '青冥道', '赤阳道', '玄阴道', '长生道', '杀伐道', '守拙道',
                   '逍遥道', '寂灭道', '混元道', '紫霄道', '沧溟道', '星河道', '归元道', '问心道'];

/** 性格基因：4 维（谨慎 / 好战 / 贪婪 / 好奇），0~1 */
export function randomPersona(rng) {
  return [
    clamp(rng.gauss(0.5, 0.22), 0.05, 0.95),
    clamp(rng.gauss(0.45, 0.25), 0.05, 0.95),
    clamp(rng.gauss(0.5, 0.22), 0.05, 0.95),
    clamp(rng.gauss(0.5, 0.25), 0.05, 0.95),
  ];
}

/** 子代性格：向师门靠拢若干，再叠加变异 */
export function inheritPersona(child, parent, rng, blend = 0.35) {
  for (let i = 0; i < 4; i++) {
    const base = child[i] * (1 - blend) + parent[i] * blend;
    child[i] = clamp(base + rng.gauss(0, 0.06), 0.02, 0.98);
  }
  return child;
}

export class BrainPool {
  constructor(seed, size = 16) {
    this.rng = new RNG((seed ^ 0x5bd1e995) >>> 0);
    this.size = size;
    this.list = [];
    this.year = 0;
    this.pending = [];        // 待公告的进化事件
    for (let i = 0; i < size; i++) this.list.push(this._make(i, null, 1));
  }

  _make(id, parent, gen) {
    const w = new Float32Array(W_LEN);
    if (parent) {
      w.set(parent.w);
      this._mutate(w, 0.05);
    } else {
      for (let i = 0; i < W_LEN; i++) w[i] = (this.rng.next() * 2 - 1) * 0.7;
    }
    return {
      id, w,
      gen: parent ? Math.max(parent.gen + 1, gen || 1) : 1,
      name: parent ? parent.name : DAO_NAMES[id % DAO_NAMES.length],
      use: 0, fitness: 0, lastScore: 0, peak: 0,
    };
  }

  _mutate(w, rate) {
    const n = Math.max(6, Math.floor(W_LEN * rate));
    for (let k = 0; k < n; k++) {
      const i = (this.rng.next() * W_LEN) | 0;
      w[i] = clamp(w[i] + this.rng.gauss(0, 0.2), -3, 3);
    }
  }

  /** 前向传播：inp(N_IN) → out(N_OUT)，输出约在 [-1,1] */
  forward(w, inp, hid, out) {
    let p = OFF_W1;
    for (let h = 0; h < N_HID; h++) {
      let s = w[OFF_B1 + h];
      for (let i = 0; i < N_IN; i++) s += inp[i] * w[p + i];
      hid[h] = Math.tanh(s);
      p += N_IN;
    }
    let q = OFF_W2;
    for (let o = 0; o < N_OUT; o++) {
      let s = w[OFF_B2 + o];
      for (let h = 0; h < N_HID; h++) s += hid[h] * w[q + h];
      out[o] = Math.tanh(s);
      q += N_HID;
    }
  }

  at(id) { return this.list[(id | 0) % this.size]; }

  /** 进化：每 50 年一次，按使用者成就筛选（type 指定统计哪一类生灵） */
  evolve(units, type) {
    const wantType = type == null ? 0 : type;
    this.year += 50;
    const stat = [];
    for (let i = 0; i < this.size; i++) stat.push({ i, n: 0, s: 0, peak: 0 });
    for (const u of units) {
      if (!u.alive || u.type !== wantType) continue;
      const st = stat[(u.brainId | 0) % this.size];
      if (!st) continue;
      st.n++;
      const v = u.realm * 100 + u.stage * 22 + (u.kills || 0) * 6 + Math.min(300, (u.stones || 0) * 0.02);
      st.s += v;
      if (v > st.peak) st.peak = v;
    }
    for (const st of stat) {
      const b = this.list[st.i];
      b.use = st.n;
      const score = st.n ? (st.s / st.n) : 0;
      b.lastScore = score;
      b.fitness = b.fitness * 0.65 + score * 0.35;   // 滑动平均，避免一次爆发上位
      if (st.peak > b.peak) b.peak = st.peak;
    }
    // 排序（fitness 高者存活）
    const order = this.list.slice().sort((a, b) => b.fitness - a.fitness);
    const keep = Math.max(2, Math.floor(this.size * 0.7));
    const survivors = order.slice(0, keep);
    for (let i = keep; i < order.length; i++) {
      const dead = order[i];
      const parent = survivors[(this.rng.next() * survivors.length) | 0];
      const idx = this.list.indexOf(dead);
      const nb = this._make(dead.id, parent, parent.gen);
      nb.name = dead.name;                 // 道统名沿用（观念会变，名字留下）
      nb.fitness = parent.fitness * 0.8;   // 继承部分声望，便于继续被选中
      this.list[idx] = nb;
      this.pending.push({ name: dead.name, from: parent.name, gen: nb.gen });
    }
    return this.pending.length;
  }

  /** 当前最强道统（UI 用） */
  ranking(n) {
    return this.list.slice().sort((a, b) => b.fitness - a.fitness).slice(0, n || 6);
  }
}
