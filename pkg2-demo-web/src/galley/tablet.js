// Планшет сборщика: пульт к AR-очкам. Показывает текущий переход, таймеры, контроль с цифровой клавиатурой,
// ТП и КД (поиск по чертёжному номеру → открыть лист в очках), чат с мастером, настройки очков; микрофон
// планшета передаёт фразы голосовому разбору очков. Связь — link.js (вкладка, сервер участка, комната страницы).
import { DOCUMENTS, searchDocs } from './catalog.js';
import { createLink } from './link.js';
import { OPERATIONS } from './process.js';
import { PRESETS } from './vision.js';
import { PHRASES, createRecognizer } from './voice_cmd.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (m) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const num = (v) => String(v).replace('.', ',');

const CSS = `
:root { --bg:#0e1418; --card:#152027; --line:#28404b; --ink:#e8f3f7; --mute:#8fa9b5; --acc:#4fd8f5; --ok:#4ee69a; --warn:#ffc845; --bad:#ff7a66;
  --sans:"IBM Plex Sans",system-ui,sans-serif; --mono:"IBM Plex Mono",ui-monospace,monospace; }
* { box-sizing:border-box; }
html,body { margin:0; height:100%; background:var(--bg); color:var(--ink); font:16px/1.4 var(--sans); -webkit-tap-highlight-color:transparent; }
body.tab { display:grid; grid-template-rows:auto 1fr auto; height:100dvh; overflow:hidden; }
header.t { display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
header.t b { font:600 17px var(--sans); color:var(--acc); }
header.t .clk { font:600 18px var(--mono); color:var(--warn); margin-left:auto; }
.dot { width:10px; height:10px; border-radius:50%; background:#3a4a52; display:inline-block; }
.dot.on { background:var(--ok); box-shadow:0 0 6px var(--ok); }
.links { display:flex; gap:10px; align-items:center; font-size:13px; color:var(--mute); }
main.t { overflow:auto; padding:12px 14px 20px; }
nav.t { display:grid; grid-template-columns:repeat(5,1fr); border-top:1px solid var(--line); }
nav.t button { background:none; border:0; color:var(--mute); padding:12px 4px 14px; font:600 14px var(--sans); }
nav.t button[aria-pressed=true] { color:var(--acc); box-shadow:inset 0 3px 0 var(--acc); }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px; margin-bottom:12px; }
.card h2 { margin:0 0 4px; font:600 22px var(--sans); text-wrap:balance; }
.card .id { font:600 15px var(--mono); color:var(--mute); }
.tag { display:inline-block; font-size:12px; padding:2px 8px; border-radius:20px; border:1px solid var(--warn); color:var(--warn); margin-left:6px; }
ul.txt { margin:8px 0 0; padding-left:20px; } ul.txt li { margin:4px 0; }
.row { display:flex; gap:8px; flex-wrap:wrap; }
.btn { flex:1 1 auto; min-height:52px; min-width:88px; border-radius:10px; border:1px solid var(--line); background:#1b2a32; color:var(--ink); font:600 16px var(--sans); padding:8px 12px; }
.btn.acc { border-color:var(--acc); color:var(--acc); } .btn.ok { background:#16392a; border-color:var(--ok); color:var(--ok); }
.btn.warn { border-color:var(--warn); color:var(--warn); } .btn.bad { border-color:var(--bad); color:var(--bad); } .btn[disabled] { opacity:.4; }
.btn[aria-pressed=true] { background:#173b47; border-color:var(--acc); color:#dffaff; }
.timer { margin:10px 0 0; } .timer .bar { height:10px; border-radius:6px; background:#22333b; overflow:hidden; margin-top:4px; }
.timer .bar i { display:block; height:100%; background:var(--acc); } .timer.blk .bar i { background:var(--warn); }
.timer .t { font:600 18px var(--mono); color:var(--warn); float:right; }
.keypad { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:10px; }
.keypad .btn { min-height:58px; font-size:22px; }
.val { font:600 30px var(--mono); padding:8px 12px; background:#0b1216; border:1px solid var(--line); border-radius:10px; min-height:56px; margin-top:8px; display:flex; align-items:center; justify-content:space-between; }
.val small { font:14px var(--sans); color:var(--mute); }
input.t { width:100%; min-height:52px; border-radius:10px; border:1px solid var(--line); background:#0b1216; color:var(--ink); font:18px var(--sans); padding:8px 12px; }
.list button { display:flex; gap:10px; width:100%; text-align:left; background:none; border:0; border-bottom:1px solid var(--line); color:var(--ink); padding:12px 4px; font:16px var(--sans); min-height:48px; align-items:baseline; }
.list button .c { font:600 15px var(--mono); color:var(--acc); min-width:150px; } .list button.cur { background:#2a2a14; }
.list .op { font:600 16px var(--sans); color:var(--acc); padding:14px 4px 6px; }
.zones { display:grid; grid-template-columns:repeat(8,1fr); gap:4px; margin-top:8px; } .zones .btn { min-width:0; min-height:40px; padding:4px; font-size:13px; }
.msg { padding:8px 10px; border-radius:10px; background:#1b2a32; margin:6px 0; max-width:88%; } .msg.mine { margin-left:auto; background:#16392a; }
.msg small { display:block; color:var(--mute); font-size:12px; }
.sl { display:grid; grid-template-columns:1fr auto; gap:4px 10px; align-items:center; margin:10px 0; } .sl input { grid-column:1/-1; width:100%; }
.heard { font-size:14px; color:var(--mute); margin-top:6px; min-height:20px; }
.off { color:var(--bad); font-size:14px; }
@media (min-width:900px) { main.t { display:grid; grid-template-columns:1fr 1fr; gap:12px; align-content:start; } .card { margin:0; } }
`;

export function mountTablet() {
  const q = new URLSearchParams(location.search);
  document.title = 'Планшет сборщика · КМ-2';
  document.body.className = 'tab';
  document.body.innerHTML = `<style>${CSS}</style>
    <header class="t"><b>Пульт сборщика · СТ-3</b><span class="links"><span class="dot" id="dBc"></span>вкладка <span class="dot" id="dWs"></span>сервер <span class="dot" id="dRm"></span>комната
      · очки: <span id="gst" class="off">нет связи</span></span><span class="clk" id="clk">--:--</span></header>
    <main class="t" id="m"></main>
    <nav class="t">${['Переход', 'ТП', 'КД', 'Чат', 'Очки'].map((t, i) => `<button data-tab="${i}">${t}</button>`).join('')}</nav>`;
  const $ = (id) => document.getElementById(id);
  const link = createLink({ role: 'tablet', room: q.get('room') || 'ST3', ws: q.get('ws') });
  link.onStatus((s) => { $('dBc').classList.toggle('on', s.bc); $('dWs').classList.toggle('on', s.ws); $('dRm').classList.toggle('on', s.room); });
  let S = null, lastT = 0, tab = 0, value = '', query = '', openOps = new Set(), chatDraft = '';
  const cmd = (c, arg = null, label = null) => link.send('cmd', { cmd: c, arg, label });
  link.on('state', (m) => {
    if (m.step) S = m;
    else if (S && m.heard) S.heard = m.heard;
    lastT = performance.now();
    render(false);
  });
  link.send('hello');
  setInterval(() => {
    const ok = performance.now() - lastT < 3000;
    $('gst').textContent = ok ? (S?.glasses ? 'на связи' : 'на связи (сняты)') : 'нет связи';
    $('gst').className = ok ? '' : 'off';
    if (!ok) link.send('hello');
  }, 1500);

  const rec = createRecognizer({
    onPhrase: (alts) => { link.send('voice', { alts }); $('heard') && ($('heard').textContent = `«${alts[0]}» → очки`); },
    onInterim: (t) => { $('heard') && ($('heard').textContent = `… ${t}`); },
    onState: (st) => { const b = $('mic'); if (b) b.setAttribute('aria-pressed', String(st.on)); if (st.error && $('heard')) $('heard').textContent = `микрофон: ${st.error}`; },
  });

  document.querySelectorAll('nav.t button').forEach((b) => b.onclick = () => { tab = Number(b.dataset.tab); render(true); });

  function stepCard() {
    if (!S) return '<div class="card"><h2>Ожидание очков…</h2><p>Откройте симулятор (galley.html) или наденьте очки на рабочем месте. Планшет найдёт их сам.</p></div>';
    const s = S.step;
    const need = s.need;
    const timers = S.timers.map((t) => `<div class="timer ${t.blocking ? 'blk' : ''}"><span class="t">${fmt(t.left)}</span>${t.blocking ? '⏳' : '⏱'} ${esc(t.label)}
      <div class="bar"><i style="width:${Math.round((1 - t.left / Math.max(1, t.total)) * 100)}%"></i></div></div>`).join('');
    const check = s.check ? `<div class="card"><div class="id">Контроль</div><h2>${esc(s.check.name)}</h2>
      <div>норма ${num(s.check.nominal)}${s.check.tol ? ` ± ${num(s.check.tol)}` : ''} ${esc(s.check.unit)}${s.value != null ? ` · <b style="color:var(--ok)">✓ ${num(s.value)}</b>` : ''}</div>
      <div class="val"><span>${esc(value || '—')}</span><small>${esc(s.check.unit)}</small></div>
      <div class="keypad">${['7', '8', '9', '⌫', '4', '5', '6', '−', '1', '2', '3', ',', '0', '00', 'C', 'OK'].map((k) => `<button class="btn ${k === 'OK' ? 'ok' : ''}" data-k="${k}">${k}</button>`).join('')}</div></div>` : '';
    return `<div class="card"><span class="id">${esc(s.id)} · ${S.index + 1}/${S.total}</span>${s.critical ? '<span class="tag">критичный</span>' : ''}
      <h2>${esc(s.title)}</h2>${S.preview ? `<div class="tag">в очках просмотр: ${esc(S.preview.id)}</div>` : ''}
      <ul class="txt">${s.text.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>${timers}
      <div class="row" style="margin-top:12px">
        <button class="btn" data-c="prev">◂ Назад</button>
        <button class="btn ok" data-c="next" ${need ? 'disabled' : ''}>${need === 'timer' ? 'Идёт выдержка' : need === 'value' ? 'Нужно значение' : need === 'photo' ? 'Нужно фото' : 'Выполнено ▸'}</button>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn ${s.photo ? 'warn' : ''}" data-c="photo">📷 Фото</button><button class="btn" data-c="repeat">🔊 Повторить</button>
        <button class="btn" data-c="${S.inspect ? 'exit' : 'inspect'}">${S.inspect ? 'Выйти из осмотра' : '🔍 Осмотр точки'}</button>
        ${s.kd.map((k) => `<button class="btn acc" data-doc="${esc(k.doc)}|${k.sheet}|${k.zone}">КД ${esc(k.doc)} л.${k.sheet} ${esc(k.zone)}</button>`).join('')}
      </div>
      ${S.inspect ? `<div style="margin-top:10px"><b>В точке:</b><ul class="txt">${S.inspect.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
      </div>${check}
      <div class="card"><div class="row"><button class="btn acc" id="mic" ${rec ? '' : 'disabled'}>🎤 Голос с планшета</button></div>
      <div class="heard" id="heard">${esc(S.heard || (rec ? 'Скажите: «сборка дальше»' : 'Распознавание речи недоступно — выберите фразу'))}</div>
      <div class="row" style="margin-top:6px">${PHRASES.slice(0, 8).map((p) => `<button class="btn" data-ph="${esc(p)}" style="flex:1 1 40%;font-size:14px">${esc(p.replace('сборка ', ''))}</button>`).join('')}</div></div>`;
  }

  function tpView() {
    const cur = S?.step.id;
    return `<div class="card list">${OPERATIONS.map((o) => `<div class="op" data-op="${o.id}">${openOps.has(o.id) ? '▾' : '▸'} ${o.id} ${esc(o.title)}</div>
      ${openOps.has(o.id) || o.steps.some((s) => s.id === cur) ? o.steps.map((s) => `<button class="${s.id === cur ? 'cur' : ''}" data-step="${s.id}"><span class="c">${s.id}</span>${esc(s.title)}${s.timer ? ` ⏱${s.timer.min}′` : ''}</button>`).join('') : ''}`).join('')}</div>`;
  }

  function kdView() {
    const res = query ? searchDocs(query) : DOCUMENTS.slice(0, 12);
    const k = S?.kd;
    return `<div class="card"><input class="t" id="q" placeholder="Чертёжный номер: КМ2.150 / KM2.000.000 СБ / наименование" value="${esc(query)}">
      <div class="row" style="margin-top:8px"><button class="btn acc" data-c="search_q">Найти и открыть в очках</button></div></div>
      ${k ? `<div class="card"><div class="id">В очках: ${esc(k.code)} · лист ${k.sheet}${k.zone ? ` · зона ${k.zone}` : ''} · ×${num(k.zoom)}</div>
        <div class="row" style="margin-top:8px"><button class="btn" data-c="kd_prev">◂ Лист</button><button class="btn" data-c="kd_next">Лист ▸</button>
        <button class="btn" data-c="zoom_out">−</button><button class="btn" data-c="zoom_in">+</button><button class="btn" data-c="kd_fit">Вписать</button>
        <button class="btn acc" data-c="overlay">Контур 1:1</button><button class="btn" data-c="pull" data-a="kd">Окно ближе</button></div>
        <div class="zones">${'ABCD'.split('').flatMap((r) => [1, 2, 3, 4, 5, 6, 7, 8].map((c) => `<button class="btn" data-zone="${r}${c}">${r}${c}</button>`)).join('')}</div></div>` : ''}
      <div class="card list">${res.map((d) => `<button data-doc="${esc(d.code)}|1|"><span class="c">${esc(d.code)}</span>${esc(d.title)}</button>`).join('')}</div>`;
  }

  function chatView() {
    return `<div class="card">${(S?.chat || []).map((m) => `<div class="msg ${m.mine ? 'mine' : ''}"><small>${esc(m.from)} · ${esc(m.time)}</small>${esc(m.text)}</div>`).join('') || '<p>Сообщений нет</p>'}</div>
      <div class="card"><input class="t" id="chat" placeholder="Сообщение мастеру" value="${esc(chatDraft)}">
      <div class="row" style="margin-top:8px"><button class="btn acc" data-c="send">Отправить</button><button class="btn warn" data-c="call">Вызвать мастера</button>
      <button class="btn bad" data-c="reject">Брак — стоп</button></div></div>`;
  }

  function glassesView() {
    const p = S?.panels || {};
    const d = S?.dim || { mode: 'auto', level: 0 };
    return `<div class="card"><div class="id">Окна в очках</div><div class="row" style="margin-top:8px">
      ${[['kd', 'КД'], ['step', 'Переход'], ['system', 'Система'], ['task', 'Задание и чат']].map(([k, t]) => `<button class="btn" aria-pressed="${!!p[k]}" data-c="toggle" data-a="${k}">${t}</button>`).join('')}
      <button class="btn" data-c="pull" data-a="step">Переход ближе</button><button class="btn" data-c="glasses">${S?.glasses ? 'Снять очки' : 'Надеть очки'}</button></div></div>
      <div class="card"><div class="id">Затемнение линз и яркость дисплея</div>
      <div class="row" style="margin-top:8px"><button class="btn" aria-pressed="${d.mode === 'auto'}" data-c="dim_auto">Авто по свету</button></div>
      <label class="sl">Затемнение <b>${Math.round(d.level * 100)} %</b><input type="range" min="0" max="0.95" step="0.05" value="${d.level}" data-set="dim_set"></label>
      <label class="sl">Яркость дисплея <b>${Math.round((S?.bright ?? 1) * 1250)} нит</b><input type="range" min="0.2" max="1" step="0.05" value="${S?.bright ?? 1}" data-set="bright_set"></label>
      <label class="sl">Освещённость участка (модель) <b>≈ ${S?.lux ?? '—'} лк</b><input type="range" min="0.3" max="3" step="0.1" value="${S?.light ?? 1}" data-set="light"></label></div>
      <div class="card"><div class="id">Зрение (модель)</div><div class="row" style="margin-top:8px">
      ${Object.entries(PRESETS).map(([k, v]) => `<button class="btn" style="flex:1 1 45%;font-size:14px" data-c="preset" data-a="${k}">${esc(v.label)}</button>`).join('')}</div></div>
      <div class="card"><div class="id">Время участка</div><div class="row" style="margin-top:8px">${[1, 60, 600].map((v) => `<button class="btn" aria-pressed="${S?.speed === v}" data-c="speed" data-a="${v}">×${v}</button>`).join('')}</div></div>`;
  }

  function render(full) {
    $('clk').textContent = S ? `${S.clock}${S.speed !== 1 ? ` ×${S.speed}` : ''}` : '--:--';
    document.querySelectorAll('nav.t button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.tab) === tab)));
    const ae = document.activeElement;
    if (!full && ae && (ae.id === 'q' || ae.id === 'chat' || ae.type === 'range')) return;   // не мешать вводу
    $('m').innerHTML = [stepCard, tpView, kdView, chatView, glassesView][tab]();
    bind();
  }

  function bind() {
    const m = $('m');
    m.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => {
      const c = b.dataset.c, a = b.dataset.a ?? null;
      if (c === 'search_q') { query = $('q').value; cmd('search', query, `поиск ${query}`); render(true); return; }
      if (c === 'send') { const t = $('chat').value.trim(); if (t) cmd('message', t, 'сообщение'); chatDraft = ''; return; }
      cmd(c, a === null ? null : /^\d+(\.\d+)?$/.test(a) ? Number(a) : a, b.textContent.trim());
    });
    m.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => {
      const k = b.dataset.k;
      if (k === '⌫') value = value.slice(0, -1);
      else if (k === 'C') value = '';
      else if (k === '−') value = value.startsWith('-') ? value.slice(1) : `-${value}`;
      else if (k === 'OK') { if (value) cmd('value', parseFloat(value.replace(',', '.')), `значение ${value}`); value = ''; }
      else if (k === ',') { if (!value.includes(',')) value += value ? ',' : '0,'; }
      else value += k;
      render(true);
    });
    m.querySelectorAll('[data-doc]').forEach((b) => b.onclick = () => { const [code, sheet, zone] = b.dataset.doc.split('|'); cmd('open_doc', { code, sheet: Number(sheet) || 1, zone: zone || null }, `КД ${code}`); });
    m.querySelectorAll('[data-zone]').forEach((b) => b.onclick = () => cmd('kd_zone', b.dataset.zone, `зона ${b.dataset.zone}`));
    m.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => cmd('preview', b.dataset.step, `просмотр ${b.dataset.step}`));
    m.querySelectorAll('[data-op]').forEach((b) => b.onclick = () => { const id = b.dataset.op; openOps.has(id) ? openOps.delete(id) : openOps.add(id); render(true); });
    m.querySelectorAll('[data-ph]').forEach((b) => b.onclick = () => link.send('voice', { alts: [b.dataset.ph] }));
    m.querySelectorAll('[data-set]').forEach((r) => r.onchange = () => cmd(r.dataset.set, Number(r.value)));
    const qi = $('q'); if (qi) qi.oninput = () => { query = qi.value; };
    if (qi) qi.onkeydown = (e) => { if (e.key === 'Enter') { query = qi.value; cmd('search', query, `поиск ${query}`); render(true); } };
    const ci = $('chat'); if (ci) { ci.oninput = () => { chatDraft = ci.value; }; ci.onkeydown = (e) => { if (e.key === 'Enter' && ci.value.trim()) { cmd('message', ci.value.trim(), 'сообщение'); chatDraft = ''; ci.value = ''; } }; }
    const mic = $('mic'); if (mic) mic.onclick = () => (rec.active ? rec.stop() : rec.start());
  }
  render(true);
  window.__tablet = { link, get state() { return S; }, cmd };
  window.__demo = { ready: true, tablet: true };
}
