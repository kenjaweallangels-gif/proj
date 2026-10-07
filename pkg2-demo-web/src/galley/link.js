// Связь «очки ↔ планшет сборщика». Три канала, работают одновременно, сообщения с одинаковым id не дублируются:
//  • BroadcastChannel — планшет в соседней вкладке или в выдвижной панели того же браузера (демо на одном ПК);
//  • сервер участка pkg1 — WebSocket /ws/remote/{комната} (реальный цех: планшет и очки в Wi-Fi цеха), ?ws=ws://сервер:8080&room=ST3;
//  • комната опубликованной страницы (claude.use('room')) — планшет открывает ту же ссылку с #tablet на другом устройстве.
// Протокол: {type:'cmd', cmd, arg} — команда с планшета; {type:'state', …} — состояние очков (2 раза в секунду);
// {type:'hello'} — новый участник просит состояние.

export const TOPICS = { cmd: 'ar.cmd', state: 'ar.state', hello: 'ar.hello' };

let seq = 0;
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-${seq++}`;

export function createLink({ role, room = 'ST3', ws = null } = {}) {
  const handlers = new Map();
  const seen = new Set();
  const status = { bc: false, ws: false, room: false };
  const listeners = [];
  const deliver = (msg) => {
    if (!msg || typeof msg !== 'object' || !msg.type || msg.from === role) return;
    if (msg.id) { if (seen.has(msg.id)) return; seen.add(msg.id); if (seen.size > 500) seen.delete(seen.values().next().value); }
    (handlers.get(msg.type) || []).forEach((fn) => fn(msg));
  };
  const changed = () => listeners.forEach((fn) => fn({ ...status }));

  let bc = null;
  try { bc = new BroadcastChannel(`km2-ar-${room}`); bc.onmessage = (e) => deliver(e.data); status.bc = true; } catch { bc = null; }

  let sock = null;
  function connectWs() {
    if (!ws) return;
    try {
      sock = new WebSocket(`${ws.replace(/\/$/, '')}/ws/remote/${encodeURIComponent(room)}`);
      sock.onopen = () => { status.ws = true; changed(); send('hello', {}); };
      sock.onmessage = (e) => { try { deliver(JSON.parse(e.data)); } catch { /* не JSON */ } };
      sock.onclose = () => { status.ws = false; changed(); setTimeout(connectWs, 3000); };
      sock.onerror = () => sock.close();
    } catch { status.ws = false; }
  }
  connectWs();

  let rm = null;
  (async () => {
    try {
      rm = await globalThis.claude?.use?.('room');
      if (!rm) return;
      for (const [type, topic] of Object.entries(TOPICS)) rm.on(topic, (m) => { if (!m.sameTab) deliver({ ...(m.data || {}), type }); });
      status.room = true; changed();
      send('hello', {});
    } catch { rm = null; }
  })();

  function send(type, data = {}) {
    const msg = { ...data, type, from: role, id: uid() };
    seen.add(msg.id);
    try { bc?.postMessage(msg); } catch { /* закрыт */ }
    try { if (sock?.readyState === 1) sock.send(JSON.stringify(msg)); } catch { /* разрыв */ }
    try { if (rm && TOPICS[type]) rm.emit(TOPICS[type], msg).catch(() => {}); } catch { /* нет прав */ }
    return msg;
  }

  return {
    send,
    on(type, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); },
    onStatus(fn) { listeners.push(fn); fn({ ...status }); },
    get status() { return { ...status }; },
  };
}

/** Состояние очков для планшета — компактно (комната ограничивает сообщение 4 КиБ). */
export function trimText(s, n) { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; }
