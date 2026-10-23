/** Tiny DOM helpers shared by the UI modules. */

/** el(tag, className?, text?) -> HTMLElement */
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

/** Appends children (elements or strings) and returns the parent. */
export function add(parent, ...children) {
  for (const c of children) if (c !== null && c !== undefined) parent.append(c);
  return parent;
}

/** Sets textContent only when the string changed (avoids useless DOM writes). */
export function setText(node, text) {
  const s = String(text);
  if (node._t !== s) { node._t = s; node.textContent = s; }
}

/** Toggles a class only when the state changed. */
export function setClass(node, cls, on) {
  const key = '_c_' + cls;
  const v = !!on;
  if (node[key] !== v) { node[key] = v; node.classList.toggle(cls, v); }
}

/** Shows/hides via the `.hidden` class (display: none). */
export function show(node, on) { setClass(node, 'hidden', !on); }

/** SVG element with attributes. */
export function svg(tag, attrs = {}) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

/** Number with a fallback for missing / NaN / Infinity values. */
export function num(v, fallback = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : fallback; }

/** hh:mm:ss from seconds. */
export function hms(sec) {
  const s = Math.max(0, Math.floor(num(sec, 0)));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** mm:ss (or h:mm:ss when over an hour). */
export function mmss(sec) {
  if (!Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Converts "Схватить (G)" / "E — шлюз" style text into a prompt with <span class="key"> badges. */
export function promptHtml(text) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return esc(text).replace(/\(([A-Za-z0-9+\/ ]{1,12})\)/g, (_, k) => `<span class="key">${k}</span>`);
}
