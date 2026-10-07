// Стенд очков (lab.html): тестовые картинки на дисплее очков, подключённых к ПК как второй монитор.
// Работает в штатном режиме любых очков (без SDK): поле, резкость, читаемость, яркость, цвет, стерео, задержка.
// С мостом позы (pkg1-sim-vm/tools/glasses_lab/pose_bridge.py) — «картинка в мире»: видно задержку и дрейф трекинга.
// Замеры вносятся в форму (M) и скачиваются файлом measurements/<модель>.json — его читает симулятор.
import { DEVICES, deviceById } from '../galley/glasses.js';
import { installMeasurements } from '../galley/measured.js';
import { DEFAULT_POSE_URL, PoseLink } from '../galley/pose_link.js';
import { frameStats, gridStep, scaleFor, textPx } from './scale.js';

installMeasurements();
const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const cv = $('c'), g = cv.getContext('2d');
document.head.insertAdjacentHTML('beforeend', `<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden;font:14px/1.4 system-ui,sans-serif;color:#e3eef3}
  canvas{position:fixed;inset:0;width:100%;height:100%}
  #hud{position:fixed;left:12px;top:10px;background:rgba(8,14,18,.82);border:1px solid #2f3d46;border-radius:8px;padding:8px 12px;max-width:560px}
  #hud b{color:#58e6ff} #hud kbd{border:1px solid #445;border-radius:3px;padding:0 4px;font-size:12px} #hud .t{color:#94a7b2;font-size:12.5px}
  #hud button,#panel button{background:#11171b;color:#e3eef3;border:1px solid #2f3d46;border-radius:6px;padding:4px 9px;cursor:pointer;margin:4px 4px 0 0}
  #hud[hidden],#panel[hidden]{display:none}
  #panel{position:fixed;right:12px;top:10px;width:min(440px,calc(100vw - 24px));max-height:calc(100vh - 20px);overflow:auto;background:rgba(8,14,18,.95);border:1px solid #58e6ff;border-radius:10px;padding:12px 14px}
  #panel label{display:grid;grid-template-columns:1fr 110px;gap:8px;align-items:center;margin:4px 0;font-size:13px}
  #panel input{background:#0b1114;color:#e3eef3;border:1px solid #2f3d46;border-radius:5px;padding:3px 6px}
  #panel h3{margin:0 0 6px;color:#58e6ff;font-size:15px}
</style>`);

const PATTERNS = [
  ['field', 'Поле и сетка', 'Градусная сетка от центра. Отметьте, на каком градусе обрезается картинка по краям, — это поле дисплея.'],
  ['sharp', 'Резкость', 'Решётки 1, 2, 3 пикселя в центре и по углам: где линии сливаются — там оптика мылит.'],
  ['text', 'Читаемость', 'Строки КД разной угловой высоты. Найдите самую мелкую, которую читаете без напряжения.'],
  ['bright', 'Яркость', 'Поле серого: 0–9 — уровень 0–100 %. Люксметр к линзе — яркость белого; снизу — шкала из 16 ступеней.'],
  ['color', 'Цвет', 'Пробел — красный, зелёный, синий, белый, серый 50 %: равномерность и оттенок по полю.'],
  ['stereo', 'Стерео (SBS)', 'Включите на очках 3D (3840 по ширине). Л и П должны быть у своих глаз; кольца — ближе и дальше экрана.'],
  ['latency', 'Задержка и частота', 'Сделайте зеркало экрана, снимите телефоном (slow-mo) монитор и очки вместе: разница счётчиков × интервал кадра = задержка.'],
  ['world', 'Поза головы', 'Мост позы: сетка и крест «стоят в мире». Отставание при поворотах — задержка; уплывание в покое — дрейф. R — обнулить.'],
];
let pat = Math.max(0, PATTERNS.findIndex((p) => p[0] === q.get('p')));
let dev = deviceById.get(q.get('glasses')) || DEVICES[0];
let level = 10, colorIdx = 0, hudOn = true, frameNo = 0;
const dts = [];
let lastT = performance.now();
let link = null;

function ensureLink() {
  if (link) return link;
  link = new PoseLink(q.get('pose') && q.get('pose') !== '1' ? q.get('pose') : DEFAULT_POSE_URL, { onState: () => hud() });
  return link;
}

function resize() {
  cv.width = Math.round(innerWidth * devicePixelRatio); cv.height = Math.round(innerHeight * devicePixelRatio);
}
addEventListener('resize', () => { resize(); hud(); });
resize();

// ---------- рисование ----------
const W = () => cv.width, H = () => cv.height;
function txt(s, x, y, px, color = '#fff', align = 'left') { g.fillStyle = color; g.font = `${px}px system-ui, sans-serif`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y); }

/** Нарисовать картинку для одного глаза в прямоугольнике (ox, oy, ew, eh); side — 'Л'/'П' для стерео. */
function drawEye(s, ox, oy, side) {
  const cx = ox + s.ew / 2, cy = oy + s.eh / 2;
  const P = PATTERNS[pat][0];
  if (P === 'field') {
    const st = gridStep(s);
    g.lineWidth = 1;
    for (let d = -60; d <= 60; d += st) {
      const major = d % 10 === 0;
      g.strokeStyle = major ? '#5fd' : '#245';
      const x = cx + d * s.ppdX, y = cy + d * s.ppdY;
      if (x > ox && x < ox + s.ew) { g.beginPath(); g.moveTo(x + 0.5, oy); g.lineTo(x + 0.5, oy + s.eh); g.stroke(); if (major) txt(`${d}°`, x + 3, cy - 10, 14, '#5fd'); }
      if (y > oy && y < oy + s.eh) { g.beginPath(); g.moveTo(ox, y + 0.5); g.lineTo(ox + s.ew, y + 0.5); g.stroke(); if (major && d) txt(`${-d}°`, cx + 4, y - 9, 14, '#5fd'); }
    }
    g.strokeStyle = '#fff'; g.lineWidth = 2;
    for (const r of [10, 20, 25]) { g.beginPath(); g.arc(cx, cy, r * s.ppdX, 0, Math.PI * 2); g.stroke(); }
    txt(`${dev.name}: окно по профилю ${s.degW.toFixed(1)}×${s.degH.toFixed(1)}°`, cx, oy + 24, 18, '#fff', 'center');
  }
  if (P === 'sharp') {
    const patch = (px0, py0) => {
      for (let k = 1; k <= 3; k++) {
        for (let i = 0; i < 60; i += 2 * k) { g.fillStyle = '#fff'; g.fillRect(px0 + (k - 1) * 70 + i, py0, k, 60); g.fillRect(px0 + (k - 1) * 70, py0 + 70 + i, 60, k); }
        txt(`${k} пикс`, px0 + (k - 1) * 70 + 30, py0 + 145, 13, '#9ab', 'center');
      }
    };
    for (const [fx, fy] of [[0.5, 0.5], [0.12, 0.15], [0.88, 0.15], [0.12, 0.85], [0.88, 0.85]]) patch(Math.round(ox + fx * s.ew - 100), Math.round(oy + fy * s.eh - 75));
    txt(`${(s.ppdX).toFixed(1)} пикс/° — деталь меньше ${(60 / s.ppdX).toFixed(1)}′ не различить`, cx, oy + s.eh - 20, 16, '#5fd', 'center');
  }
  if (P === 'text') {
    let y = oy + 40;
    for (const deg of [0.2, 0.3, 0.4, 0.5, 0.7, 1.0, 1.4]) {
      const px = textPx(s, deg);
      txt(`${deg}° (${px} пикс): КМ2.150.000 · момент 1,6 Н·м · поз. 17 · зазор 3±1 мм`, ox + 30, y + px / 2, px, '#fff');
      y += px * 1.6 + 6;
      if (y > oy + s.eh * 0.62) break;
    }
    g.fillStyle = '#e8eef2'; g.fillRect(ox + 30, oy + s.eh * 0.68, s.ew - 60, s.eh * 0.26);
    let y2 = oy + s.eh * 0.68 + 20;
    for (const deg of [0.3, 0.5, 0.8]) { const px = textPx(s, deg); txt(`${deg}°: тёмный текст на светлом — так выглядит лист КД (светлый фон в очках «светит»)`, ox + 44, y2 + px / 2, px, '#111'); y2 += px * 1.7; }
  }
  if (P === 'bright') {
    const v = Math.round((level / 10) * 255);
    g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(ox, oy, s.ew, s.eh * 0.85);
    for (let i = 0; i < 16; i++) { const c = Math.round((i / 15) * 255); g.fillStyle = `rgb(${c},${c},${c})`; g.fillRect(ox + (i * s.ew) / 16, oy + s.eh * 0.88, s.ew / 16 + 1, s.eh * 0.12); }
    txt(`${level * 10} % · максимум профиля ${dev.nits} нит → ожидаемо ≈ ${Math.round(dev.nits * Math.pow(level / 10, 2.2))} нит`, cx, oy + s.eh * 0.82, 20, level > 5 ? '#000' : '#fff', 'center');
  }
  if (P === 'color') {
    const C = ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#808080'][colorIdx % 5];
    g.fillStyle = C; g.fillRect(ox, oy, s.ew, s.eh);
    txt(['красный', 'зелёный', 'синий', 'белый', 'серый 50 %'][colorIdx % 5], cx, oy + s.eh - 30, 18, colorIdx % 5 === 3 ? '#000' : '#fff', 'center');
  }
  if (P === 'stereo') {
    txt(side || '—', cx, cy - s.eh * 0.3, 90, side === 'Л' ? '#ff7a7a' : '#7ad1ff', 'center');
    // кольца: смещение к носу — ближе экрана, к виску — дальше; 0 — на расстоянии экрана (≈ 4 м)
    // перекрёстное смещение: у левого глаза кольцо «ближе» сдвинуто вправо, у правого — влево (0,5°)
    const sgn = side === 'Л' ? 1 : -1;
    [[1, 'ближе'], [0, 'экран'], [-1, 'дальше']].forEach(([off, name], i) => {
      const x = cx + (i - 1) * 260 + sgn * off * 0.5 * s.ppdX;
      g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath(); g.arc(x, cy + 40, 50, 0, Math.PI * 2); g.stroke();
      txt(name, cx + (i - 1) * 260, cy + 130, 22, '#9ab', 'center');
    });
    if (!s.sbs) txt('Сейчас 2D: обе половины не разделены — включите 3D на очках (кнопкой)', cx, oy + s.eh - 40, 18, '#ffc845', 'center');
  }
  if (P === 'latency') {
    txt(String(frameNo).padStart(6, '0'), cx, cy - 60, Math.round(s.eh * 0.16), '#fff', 'center');
    txt(`${performance.now().toFixed(0)} мс`, cx, cy + 60, 40, '#5fd', 'center');
    g.fillStyle = frameNo % 2 ? '#fff' : '#000'; g.fillRect(ox + 20, oy + 20, 80, 80);
    const bx = ox + ((performance.now() / 1000) % 1) * s.ew;
    g.fillStyle = '#ffc845'; g.fillRect(bx, oy + s.eh - 140, 12, 120);
    const fs = frameStats(dts);
    txt(`кадров в секунду ${fs.hz.toFixed(1)} · пропусков за 2 с ${fs.dropped}`, cx, oy + s.eh - 170, 20, '#fff', 'center');
  }
  if (P === 'world') {
    const L = ensureLink();
    const r = L.fresh ? L.last.rel : null;
    const yawD = r ? (r.yaw * 180) / Math.PI : 0, pitD = r ? (r.pitch * 180) / Math.PI : 0, rollR = r ? r.roll : 0;
    g.save(); g.translate(cx, cy); g.rotate(-rollR);
    g.strokeStyle = '#245'; g.lineWidth = 1;
    for (let d = -90; d <= 90; d += 10) {
      const x = (d + yawD) * s.ppdX, y = (d + pitD) * s.ppdY;
      g.beginPath(); g.moveTo(x, -s.eh); g.lineTo(x, s.eh); g.stroke();
      g.beginPath(); g.moveTo(-s.ew, y); g.lineTo(s.ew, y); g.stroke();
    }
    const tx = yawD * s.ppdX, ty = pitD * s.ppdY;
    g.strokeStyle = '#58e6ff'; g.lineWidth = 3; g.beginPath(); g.moveTo(tx - 40, ty); g.lineTo(tx + 40, ty); g.moveTo(tx, ty - 40); g.lineTo(tx, ty + 40); g.stroke();
    g.restore();
    txt(r ? `курс ${yawD.toFixed(2)}° · тангаж ${pitD.toFixed(2)}° · крен ${((rollR * 180) / Math.PI).toFixed(2)}° · ${L.hz.toFixed(0)} Гц` : `мост позы: ${L.state} (${L.url})`, cx, oy + s.eh - 30, 18, r ? '#fff' : '#ffc845', 'center');
  }
}

function draw(now) {
  const dt = now - lastT; lastT = now; frameNo++;
  if (dt > 0 && dt < 500) { dts.push(dt); if (dts.length > 120) dts.shift(); }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000'; g.fillRect(0, 0, W(), H());
  const s = scaleFor(dev, W(), H());
  if (s.sbs) { drawEye(s, 0, 0, 'Л'); drawEye(s, s.ew, 0, 'П'); } else drawEye(s, 0, 0, PATTERNS[pat][0] === 'stereo' ? 'Л' : null);
  if (frameNo % 30 === 0) hud();
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// ---------- подсказка и управление ----------
function hud() {
  const el = $('hud');
  el.hidden = !hudOn;
  if (!hudOn) return;
  const s = scaleFor(dev, W(), H());
  const fs = frameStats(dts);
  el.innerHTML = `<b>${pat + 1}/${PATTERNS.length} · ${PATTERNS[pat][1]}</b> · ${dev.brand} ${dev.name}${dev.measured ? ' (замеры ' + dev.measured.date + ')' : ''}<br>
    <span class="t">${PATTERNS[pat][2]}</span><br>
    <span class="t">Экран ${W()}×${H()}${s.sbs ? ' (стерео SBS)' : ''} · ${s.ppdX.toFixed(1)} пикс/° · ${fs.hz.toFixed(0)} Гц</span><br>
    <span class="t"><kbd>←</kbd><kbd>→</kbd> картинка · <kbd>F</kbd> во весь экран · <kbd>D</kbd> модель · <kbd>M</kbd> замеры · <kbd>H</kbd> скрыть · <kbd>1</kbd>–<kbd>8</kbd> картинка, на «Яркости» <kbd>0</kbd>–<kbd>9</kbd> уровень (<kbd>⇧9</kbd> — 100 %) · <kbd>Пробел</kbd> цвет · <kbd>R</kbd> обнулить курс</span><br>
    <button id="b_screen">На экран очков</button><button id="b_meas">Замеры (M)</button><a href="./galley.html${q.get('pose') ? '?pose=' + encodeURIComponent(q.get('pose')) : ''}" style="color:#58e6ff;margin-left:6px">симулятор →</a>`;
  $('b_screen').onclick = toGlassesScreen;
  $('b_meas').onclick = () => togglePanel();
}

/** Полный экран на мониторе очков (Chrome: Window Management API — нужен разрешающий клик). */
async function toGlassesScreen() {
  try {
    if (window.getScreenDetails) {
      const sd = await window.getScreenDetails();
      const scr = sd.screens.find((x) => /viture|xreal|nreal|air|one|luma|beast/i.test(x.label)) || sd.screens.find((x) => !x.isPrimary) || sd.currentScreen;
      await document.documentElement.requestFullscreen({ screen: scr });
      return;
    }
  } catch (e) { console.warn(e); }
  await document.documentElement.requestFullscreen?.();
}

const FIELDS = [
  ['nits', 'Яркость белого, нит'], ['fovDiag', 'Поле по диагонали, °'], ['transmit', 'Пропускание линз, доля'], ['refresh', 'Частота, Гц'],
  ['latencyMs', 'Задержка штатно, мс'], ['driftDegMin', 'Дрейф 3DoF, °/мин'], ['weightG', 'Вес, г'], ['distM', 'Экран, м'],
];
const SDKF = [['latencyMs', 'Своё ПО: задержка, мс'], ['hz', 'Своё ПО: кадров/с'], ['trackMM', 'Своё ПО: дрожание, мм'], ['trackDeg', 'Своё ПО: дрожание, °']];
function togglePanel(on) {
  const p = $('panel');
  p.hidden = on === undefined ? !p.hidden : !on;
  if (p.hidden) return;
  const fs = frameStats(dts);
  const val = (k, sdk) => (sdk ? dev.measured?.sdk?.[k] : dev.measured?.keys.includes(k) ? dev[k] : '') ?? '';
  p.innerHTML = `<h3>Замеры: ${dev.brand} ${dev.name}</h3>
    <div class="t" style="font-size:12.5px;color:#94a7b2">Пустые поля не сохраняются. Файл кладите в <code>pkg2-demo-web/measurements/${dev.id}.json</code> — симулятор подставит значения.</div>
    <label>Кто мерил<input id="m_by" value="${dev.measured?.by || ''}"></label>
    ${FIELDS.map(([k, n]) => `<label>${n}<input data-k="${k}" type="number" step="any" value="${k === 'refresh' && !val(k) && fs.hz ? Math.round(fs.hz) : val(k)}"></label>`).join('')}
    ${SDKF.map(([k, n]) => `<label>${n}<input data-s="${k}" type="number" step="any" value="${val(k, true)}"></label>`).join('')}
    ${link?.fresh ? `<label>Частота позы (мост), Гц<input data-i="imuHz" type="number" value="${link.hz.toFixed(0)}"></label>` : ''}
    <label>Как мерили<input id="m_method" placeholder="люксметр, съёмка 240 к/с…"></label>
    <button id="m_save">Скачать ${dev.id}.json</button><button id="m_close">Закрыть</button>`;
  $('m_close').onclick = () => togglePanel(false);
  $('m_save').onclick = () => {
    const values = {}, sdk = {};
    p.querySelectorAll('input[data-k],input[data-i]').forEach((i) => { if (i.value !== '') values[i.dataset.k || i.dataset.i] = Number(i.value); });
    p.querySelectorAll('input[data-s]').forEach((i) => { if (i.value !== '') sdk[i.dataset.s] = Number(i.value); });
    const m = { device: dev.id, date: new Date().toISOString().slice(0, 10), by: $('m_by').value, values, sdk,
      method: Object.fromEntries(Object.keys(values).map((k) => [k, $('m_method').value || 'lab.html'])), notes: '' };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(m, null, 2) + '\n'], { type: 'application/json' }));
    a.download = `${dev.id}.json`; a.click();
  };
}

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.code;
  if (k === 'ArrowRight') pat = (pat + 1) % PATTERNS.length;
  if (k === 'ArrowLeft') pat = (pat + PATTERNS.length - 1) % PATTERNS.length;
  if (/^Digit[0-9]$/.test(k)) {
    const n = Number(k.slice(5));
    if (PATTERNS[pat][0] === 'bright') level = n;                    // 0 — чёрное поле, 9 — 90 %; Shift+9 — 100 %
    else if (n >= 1 && n <= PATTERNS.length) pat = n - 1;
    if (PATTERNS[pat][0] === 'bright' && e.shiftKey && n === 9) level = 10;
  }
  if (k === 'Space') { e.preventDefault(); colorIdx++; }
  if (k === 'KeyF') toGlassesScreen();
  if (k === 'KeyH') hudOn = !hudOn;
  if (k === 'KeyD') { dev = DEVICES[(DEVICES.indexOf(dev) + 1) % DEVICES.length]; if (!$('panel').hidden) togglePanel(true); }
  if (k === 'KeyM') togglePanel();
  if (k === 'KeyR') link?.recenter();
  hud();
});
hud();
window.__demo = { ready: true, lab: true };
window.__lab = { ready: true, get pattern() { return PATTERNS[pat][0]; }, setPattern: (id) => { pat = PATTERNS.findIndex((p) => p[0] === id); hud(); }, scale: () => scaleFor(dev, W(), H()) };
