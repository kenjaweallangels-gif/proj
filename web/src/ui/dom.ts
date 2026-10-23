// Tiny DOM helpers: element factory, signature-guarded patching (keeps focus and scroll when nothing changed),
// Russian number/time formatting and a few shared widgets (badges, meters, tables, copy-to-clipboard).

export type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'vars' && typeof v === 'object') {
        for (const [name, value] of Object.entries(v as Record<string, string>)) el.style.setProperty(name, value);
      } else if (k === 'width') el.style.width = String(v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') Reflect.set(el, k, v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  appendAll(el, children);
  return el;
}

export function appendAll(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendAll(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Rebuilds `el` only when `signature` changed since the last call. Returns true when rebuilt. */
export function patch(el: HTMLElement, signature: string, build: () => Child[]): boolean {
  if (el.dataset.sig === signature) return false;
  el.dataset.sig = signature;
  const frag = document.createDocumentFragment();
  appendAll(frag, build());
  el.replaceChildren(frag);
  return true;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`нет элемента #${id}`);
  return el as T;
}

// ---------------------------------------------------------------- formatting (ru-RU)
const nf = new Map<number, Intl.NumberFormat>();
export function num(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  let f = nf.get(digits);
  if (!f) { f = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: 0 }); nf.set(digits, f); }
  return f.format(x);
}

export function pct(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return `${num(x * 100, digits)} %`;
}

export function ms(x: number | null | undefined, digits = 1): string {
  return x === null || x === undefined || !Number.isFinite(x) ? '—' : `${num(x, digits)} мс`;
}

export function secs(msValue: number | null | undefined): string {
  return msValue === null || msValue === undefined || !Number.isFinite(msValue) ? '—' : `${num(msValue / 1000, 1)} с`;
}

/** Sim clock: mm:ss or h:mm:ss. */
export function clock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p2(mm)}:${p2(ss)}` : `${p2(mm)}:${p2(ss)}`;
}

// ---------------------------------------------------------------- widgets
export const SOURCE_LABELS: Record<string, string> = {
  sim: 'симуляция', player: 'игрок', agent_accepted: 'агент: принято', director: 'директор', fallback: 'fallback',
};

export function sourceBadge(source: string): HTMLElement {
  return h('span', { class: `badge src-${source}`, text: SOURCE_LABELS[source] ?? source });
}

export const VERDICT_LABELS: Record<string, [string, string]> = {
  accepted: ['принято', 'ok'],
  awaiting_player: ['ждёт решения', 'info'],
  rejected: ['отклонено', 'bad'],
  stale: ['устарело', 'warn'],
  duplicate: ['повтор', ''],
  expired: ['истекло', 'warn'],
  fallback: ['fallback', 'warn'],
};

export function verdictBadge(status: string): HTMLElement {
  const [label, cls] = VERDICT_LABELS[status] ?? [status, ''];
  return h('span', { class: `badge ${cls}`, text: label });
}

export function meter(value: number, label: string, tone: 'ok' | 'warn' | 'bad' | 'info' | '' = ''): HTMLElement {
  const v = Math.max(0, Math.min(1, value));
  return h('div', { class: 'meter' },
    h('span', { text: label }),
    h('span', { class: 'track', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '1', 'aria-valuenow': v.toFixed(2), 'aria-label': label },
      h('i', { class: `fill ${tone}`, width: `${(v * 100).toFixed(1)}%` })),
    h('span', { text: num(value, 2) }));
}

export function table(head: (string | [string, string])[], rows: Child[][], foot?: Child[]): HTMLElement {
  const th = head.map((c) => (Array.isArray(c) ? h('th', { class: c[1], text: c[0] }) : h('th', { text: c })));
  const numeric = head.map((c) => (Array.isArray(c) ? c[1] : ''));
  return h('div', { class: 'table-wrap' },
    h('table', null,
      h('thead', null, h('tr', null, th)),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((cell, i) => h('td', { class: numeric[i] || undefined }, cell))))),
      foot ? h('tfoot', null, h('tr', null, foot.map((cell, i) => h('td', { class: numeric[i] || undefined }, cell)))) : null));
}

export function kv(pairs: [string, Child][]): HTMLElement {
  return h('dl', { class: 'kv' }, pairs.map(([k, v]) => [h('dt', { text: k }), h('dd', null, v)]));
}

export function sectionTitle(text: string, extra?: Child): HTMLElement {
  return h('div', { class: 'section-title' }, h('span', { text }), extra ?? null);
}

/**
 * «Копировать» for a <pre>: navigator.clipboard inside the click handler; when the viewer refuses clipboard access,
 * the text is selected so the player can press Ctrl+C. Downloads and alert() are not used (blocked in artifacts).
 */
export function copyButton(id: string, getText: () => string, target: () => HTMLElement | null): HTMLButtonElement {
  const btn = h('button', { class: 'btn btn-sm', type: 'button', id, text: 'Копировать' });
  btn.addEventListener('click', () => {
    const text = getText();
    const selectFallback = () => {
      const el = target();
      if (!el) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      btn.textContent = 'Выделено — нажмите Ctrl+C';
    };
    try {
      const p = navigator.clipboard?.writeText(text);
      if (!p) { selectFallback(); return; }
      p.then(() => { btn.textContent = 'Скопировано'; window.setTimeout(() => { btn.textContent = 'Копировать'; }, 1600); }, selectFallback);
    } catch {
      selectFallback();
    }
  });
  return btn;
}
