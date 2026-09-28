/**
 * events.js —— 世界大事记
 */
import { EV_COLOR } from './config.js';

export class Events {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = [];
    this.limit = 260;
    this.version = 0;
    this.onNew = null;
  }

  add(type, text) {
    const year = this.ctx.world ? this.ctx.world.year : 0;
    const e = { type, text, year, seq: this.version };
    this.list.push(e);
    if (this.list.length > this.limit) this.list.splice(0, this.list.length - this.limit);
    this.version++;
    if (this.onNew) this.onNew(e);
  }

  recent(n) {
    return this.list.slice(-(n || 40)).reverse();
  }

  color(type) { return EV_COLOR[type] || '#9aa8b8'; }

  /** 导出纯文本 */
  toText() {
    return this.list.map(e => '[' + Math.floor(e.year) + '年] ' + e.text).join('\n');
  }
}
