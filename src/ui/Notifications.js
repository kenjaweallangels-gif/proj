import { el } from './dom.js';

/** Stack of short messages (ship radio traffic, suit notices). Items fade after `ttl` seconds; at most `max` visible. */
export class Notifications {
  constructor(root, { max = 4, ttl = 10 } = {}) {
    this.el = el('div', 'nt');
    root.append(this.el);
    this.items = [];
    this.max = max;
    this.ttl = ttl;
    this.now = 0;
  }

  /** notify(text, {kind: 'radio'|'info'|'warn'|'alert', ttl}) */
  push(text, { kind = 'info', ttl = this.ttl } = {}) {
    if (!text) return;
    const node = el('div', `nt-item ${kind}`);
    const tag = el('span', 'nt-tag', kind === 'radio' ? 'РАДИО' : kind === 'warn' ? 'ВНИМАНИЕ' : kind === 'alert' ? 'ТРЕВОГА' : 'СИСТЕМА');
    node.append(tag, document.createTextNode(String(text)));
    this.el.prepend(node);   // column-reverse: first child is at the bottom (newest)
    const item = { node, until: this.now + ttl, dead: false };
    this.items.unshift(item);
    while (this.items.length > this.max) { const old = this.items.pop(); old.node.remove(); }
  }

  /** Called at ~10 Hz with real seconds. */
  update(dt) {
    this.now += dt;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!it.dead && this.now >= it.until) { it.dead = true; it.node.classList.add('hide'); it.until = this.now + 0.8; }
      else if (it.dead && this.now >= it.until) { it.node.remove(); this.items.splice(i, 1); }
    }
  }

  clear() { for (const it of this.items) it.node.remove(); this.items.length = 0; }
}
