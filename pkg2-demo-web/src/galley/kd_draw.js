// Генератор КД (векторно, в мм листа) по спецификации модуля: сборочный чертёж (виды, размеры, позиции, ТТ),
// узлы (шип-паз, уголок, вставка, крепление к полу, петля), схема покрытий, спецификация, схема соединений жгута,
// чертежи деталей (панели с пазами и вставками), маршрут ТП. Рамка и основная надпись — по ГОСТ 2.104 (упрощённо).
// Рисуется «в негативе» (светлые линии на тёмном) — в очках белый лист слепит и закрывает обзор.
import { docByCode } from './catalog.js';
import { OPERATIONS, TP } from './process.js';
import * as S from './spec.js';

export const FORMATS = { A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [210, 297] };
const INK = '#dff6ff', THIN = '#9fd6e8', DIM = '#7fe0ff', ACC = '#ffd45a', HID = '#86b9c9', FILL = 'rgba(120,220,255,0.10)';

/** Вид: масштаб (px на мм листа) и сдвиг. */
export function fitView(fmt, w, h, pad = 10) {
  const [W, H] = FORMATS[fmt];
  const s = Math.min((w - pad * 2) / W, (h - pad * 2) / H);
  return { s, ox: (w - W * s) / 2, oy: (h - H * s) / 2 };
}

class Pen {
  constructor(ctx, view) { this.c = ctx; this.v = view; }
  lw(mm) { this.c.lineWidth = Math.max(mm * this.v.s * 1.4, 1.6) / this.v.s; }
  begin(color = INK, mm = 0.5, dash = null) {
    const c = this.c; c.strokeStyle = color; this.lw(mm);
    c.setLineDash(dash ? dash.map((d) => d) : []); c.beginPath();
  }
  line(x1, y1, x2, y2, color, mm, dash) { this.begin(color, mm, dash); this.c.moveTo(x1, y1); this.c.lineTo(x2, y2); this.c.stroke(); }
  rect(x, y, w, h, color, mm, dash) { this.begin(color, mm, dash); this.c.strokeRect(x, y, w, h); }
  fillRect(x, y, w, h, fill) { this.c.fillStyle = fill; this.c.fillRect(x, y, w, h); }
  poly(pts, color, mm, close = true, dash = null, fill = null) {
    this.begin(color, mm, dash);
    pts.forEach(([x, y], i) => (i ? this.c.lineTo(x, y) : this.c.moveTo(x, y)));
    if (close) this.c.closePath();
    if (fill) { this.c.fillStyle = fill; this.c.fill(); }
    this.c.stroke();
  }
  circle(x, y, r, color = INK, mm = 0.35, fill = null) {
    this.begin(color, mm); this.c.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { this.c.fillStyle = fill; this.c.fill(); }
    this.c.stroke();
  }
  text(str, x, y, size = 3.5, { color = INK, align = 'left', base = 'alphabetic', bold = false, rot = 0, font = 'Plex' } = {}) {
    const c = this.c;
    if (size * this.v.s < 2.2) {                  // слишком мелко — штрих вместо текста
      c.fillStyle = color; c.globalAlpha = 0.35;
      const w = str.length * size * 0.5;
      c.fillRect(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x, y - size * 0.6, w, size * 0.5);
      c.globalAlpha = 1; return;
    }
    c.save(); c.translate(x, y); if (rot) c.rotate(rot);
    c.fillStyle = color; c.textAlign = align; c.textBaseline = base;
    c.font = `${bold ? 600 : 400} ${size}px ${font === 'mono' ? '"IBM Plex Mono", monospace' : '"IBM Plex Sans Condensed", "IBM Plex Sans", sans-serif'}`;
    c.fillText(str, 0, 0);
    c.restore();
  }
  /** Размер: линия с засечками-стрелками и текстом. */
  dim(x1, y1, x2, y2, label, off = 8, { color = DIM, size = 3.2 } = {}) {
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const ax = x1 + nx * off, ay = y1 + ny * off, bx = x2 + nx * off, by = y2 + ny * off;
    this.line(x1, y1, ax + nx * 1.5, ay + ny * 1.5, color, 0.18);
    this.line(x2, y2, bx + nx * 1.5, by + ny * 1.5, color, 0.18);
    this.line(ax, ay, bx, by, color, 0.18);
    const ux = dx / L, uy = dy / L, a = 2.5, w = 0.7;
    for (const [px, py, s] of [[ax, ay, 1], [bx, by, -1]]) {
      this.c.fillStyle = color; this.c.beginPath();
      this.c.moveTo(px, py); this.c.lineTo(px + ux * a * s + nx * w, py + uy * a * s + ny * w); this.c.lineTo(px + ux * a * s - nx * w, py + uy * a * s - ny * w); this.c.fill();
    }
    const ang = Math.atan2(uy, ux);
    const up = ang > Math.PI / 2 || ang < -Math.PI / 2 ? ang + Math.PI : ang;
    this.text(label, (ax + bx) / 2 + nx * 1.2, (ay + by) / 2 + ny * 1.2, size, { color, align: 'center', rot: up });
  }
  /** Позиция: выноска с полкой и номером. */
  pos(n, x, y, tx, ty) {
    this.circle(x, y, 0.6, ACC, 0.2, ACC);
    this.line(x, y, tx, ty, ACC, 0.18);
    this.line(tx, ty, tx + (tx > x ? 9 : -9), ty, ACC, 0.25);
    this.text(String(n), tx + (tx > x ? 4.5 : -4.5), ty - 1.2, 4.2, { color: ACC, align: 'center', bold: true });
  }
  /** Штриховка (сечение) прямоугольника. */
  hatch(x, y, w, h, step = 2, color = THIN, ang = 1) {
    const c = this.c; c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    this.begin(color, 0.13);
    for (let k = -h; k < w + h; k += step) { c.moveTo(x + k, y + (ang > 0 ? h : 0)); c.lineTo(x + k + h * ang, y + (ang > 0 ? 0 : h)); }
    c.stroke(); c.restore();
  }
  /** Соты в сечении: ряд шестиугольников. */
  honeycomb(x, y, w, h, cell = 3.2) {
    const c = this.c; c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    this.begin('#c9a04a', 0.12);
    for (let cx = x; cx < x + w + cell; cx += cell * 0.75 * 2) {
      for (let cy = y; cy < y + h + cell; cy += cell * 0.866) {
        for (const off of [0, cell * 0.75]) {
          const px = cx + off, py = cy + (off ? cell * 0.433 : 0);
          for (let k = 0; k < 6; k++) {
            const a1 = (k * Math.PI) / 3, a2 = ((k + 1) * Math.PI) / 3, r = cell / 2;
            c.moveTo(px + r * Math.cos(a1), py + r * Math.sin(a1)); c.lineTo(px + r * Math.cos(a2), py + r * Math.sin(a2));
          }
        }
      }
    }
    c.stroke(); c.restore();
  }
}

// ---------- рамка, зоны, основная надпись ----------
const ZONE_ROWS = 'ABCD';
export function zoneRect(fmt, zone) {
  const [W, H] = FORMATS[fmt];
  const cols = fmt === 'A1' ? 8 : fmt === 'A2' ? 6 : 4, rows = 4;
  const m = /^([A-D])(\d)$/.exec(zone || '');
  if (!m) return null;
  const r = ZONE_ROWS.indexOf(m[1]), k = Number(m[2]) - 1;
  const x0 = 20, y0 = 5, w = (W - 25) / cols, h = (H - 10) / rows;
  return { x: x0 + k * w, y: y0 + r * h, w, h };
}

function frame(p, fmt, doc, sheet, total, title, scale) {
  const [W, H] = FORMATS[fmt];
  p.rect(0, 0, W, H, THIN, 0.2);
  p.rect(20, 5, W - 25, H - 10, INK, 0.7);
  if (fmt !== 'A4') {
    const cols = fmt === 'A1' ? 8 : fmt === 'A2' ? 6 : 4;
    for (let k = 0; k < cols; k++) { const x = 20 + ((k + 0.5) * (W - 25)) / cols; p.text(String(k + 1), x, 4, 3, { color: THIN, align: 'center' }); p.text(String(k + 1), x, H - 1.2, 3, { color: THIN, align: 'center' }); }
    for (let r = 0; r < 4; r++) { const y = 5 + ((r + 0.5) * (H - 10)) / 4; p.text(ZONE_ROWS[r], 12, y + 1, 3, { color: THIN, align: 'center' }); }
  }
  // основная надпись 185×55 (форма 1)
  const x = W - 5 - 185, y = H - 5 - 55;
  p.rect(x, y, 185, 55, INK, 0.7);
  for (const yy of [5, 10, 15, 20, 25, 30, 35, 40]) p.line(x, y + yy, x + 65, y + yy, THIN, 0.2);
  for (const xx of [7, 17, 40, 55, 65]) p.line(x + xx, y, x + xx, y + 55, THIN, 0.2);
  p.line(x + 65, y + 15, x + 185, y + 15, INK, 0.5);
  p.line(x + 65, y + 40, x + 185, y + 40, INK, 0.5);
  p.line(x + 135, y + 15, x + 135, y + 55, INK, 0.5);
  p.line(x + 135, y + 20, x + 185, y + 20, THIN, 0.2);
  p.line(x + 135, y + 35, x + 185, y + 35, THIN, 0.2);
  p.line(x + 150, y + 15, x + 150, y + 35, THIN, 0.2);
  p.line(x + 167, y + 15, x + 167, y + 35, THIN, 0.2);
  p.text(doc, x + 125, y + 10, 6, { align: 'center', bold: true, font: 'mono' });
  const tl = title.length > 34 ? [title.slice(0, title.lastIndexOf(' ', 34)), title.slice(title.lastIndexOf(' ', 34) + 1)] : [title];
  tl.forEach((t, i) => p.text(t, x + 100, y + 25 + i * 6 - (tl.length - 1) * 3, 4.2, { align: 'center' }));
  p.text('Лит.', x + 142, y + 19, 2.5, { align: 'center', color: THIN });
  p.text('Масса', x + 158, y + 19, 2.5, { align: 'center', color: THIN });
  p.text('Масштаб', x + 176, y + 19, 2.5, { align: 'center', color: THIN });
  p.text('О1', x + 142, y + 30, 3.5, { align: 'center' });
  p.text(scale, x + 176, y + 30, 3.5, { align: 'center' });
  p.text(`Лист ${sheet}`, x + 140, y + 39, 2.8, { color: THIN });
  p.text(`Листов ${total}`, x + 165, y + 39, 2.8, { color: THIN });
  p.text('Цех 12 · АР-сборка', x + 160, y + 49, 3.4, { align: 'center' });
  [['Разраб.', 'Конструктор'], ['Пров.', 'Вед. констр.'], ['Т.контр.', 'Технолог'], ['', ''], ['Н.контр.', 'Нормоконтр.'], ['Утв.', 'Гл. констр.']].forEach(([a, b], i) => {
    p.text(a, x + 1, y + 29 + i * 5, 2.4, { color: THIN });
    p.text(b, x + 18, y + 29 + i * 5, 2.4, { color: THIN });
  });
  p.text('Копировал', x + 60, y + 59, 2.4, { color: THIN });
  p.text(`Формат ${fmt}`, x + 150, y + 59, 2.4, { color: THIN });
  p.text('УСЛОВНЫЙ ОБРАЗЕЦ ДЛЯ ДЕМОНСТРАЦИИ', 24, 12, 3.2, { color: ACC });
}

// ---------- виды модуля ----------
function frontView(p, ox, oy, k = 0.1, { positions = true, dims = true, coat = false } = {}) {
  const X = (x) => ox + x * k, Y = (y) => oy - y * k;
  const R = (x0, y0, x1, y1, c = INK, mm = 0.5, dash = null) => p.rect(X(x0), Y(y1), (x1 - x0) * k, (y1 - y0) * k, c, mm, dash);
  const W2 = S.G.W / 2;
  if (coat) {          // схема покрытий: нержавеющий лист, окраска
    p.fillRect(X(-825), Y(1519 - 19), 1650 * k, (1500 - 1105) * k, 'rgba(200,220,235,0.25)');
    p.fillRect(X(-825), Y(1080), 1650 * k, (1080 - 25) * k, 'rgba(255,255,255,0.06)');
  }
  for (const s of [-1, 1]) R(s < 0 ? -W2 : W2 - 25, 0, s < 0 ? -W2 + 25 : W2, S.G.H);
  R(-825, 0, 825, 25); R(-825, 1080, 825, 1105); R(-825, 1500, 825, 1519); R(-825, 2031, 825, 2050);
  for (const id of ['DIV-W', 'DIV-T1', 'DIV-T2', 'DIV-T3', 'DIV-E1', 'DIV-E2', 'DIV-U1', 'DIV-U2', 'DIV-U3']) {
    const pb = S.panelBox(S.panelById.get(id));
    R(pb.min[0], pb.min[1], pb.max[0], pb.max[1], THIN, 0.35);
  }
  for (const d of S.DOORS) {
    R(d.x0, d.y0, d.x1, d.y1, INK, 0.35);
    const hx = d.hinge === 'L' ? d.x0 : d.x1;
    for (const hg of S.HINGES.filter((h) => h.door === d.id)) p.rect(X(hx) - 1, Y(hg.pos[1]) - 2, 2, 4, THIN, 0.2);
    const lt = S.LATCHES.find((l) => l.door === d.id);
    p.circle(X(lt.pos[0]), Y(lt.pos[1]), 1.1, THIN, 0.2);
  }
  for (const e of S.EQUIPMENT.filter((x) => /OVEN|BEV|BOIL/.test(x.id))) {
    R(e.pos[0] - e.size[0] / 2, e.pos[1], e.pos[0] + e.size[0] / 2, e.pos[1] + e.size[1], THIN, 0.25);
    R(e.pos[0] - e.size[0] / 2 + 30, e.pos[1] + 50, e.pos[0] + e.size[0] / 2 - 30, e.pos[1] + 200, THIN, 0.15);
  }
  const L1 = S.EQUIPMENT.find((e) => e.id === 'LIGHT-1');
  R(-750, 1482, 750, 1494, THIN, 0.2);
  const sk = S.SINK;
  R(sk.x - sk.w / 2, 1105 - sk.depth, sk.x + sk.w / 2, 1105, HID, 0.25, [2, 1]);
  p.poly([[X(sk.x), Y(1105)], [X(sk.x), Y(1300)], [X(sk.x + 60), Y(1300)], [X(sk.x + 60), Y(1280)]], INK, 0.3, false);
  p.text('Тележки условно не показаны', X(-300), Y(500), 2.6, { color: THIN });
  if (dims) {
    p.dim(X(-W2), Y(0), X(W2), Y(0), '1700', 14);
    p.dim(X(W2), Y(0), X(W2), Y(S.G.H), '2050', -14);
    p.dim(X(-W2), Y(0), X(-W2), Y(1105), '1105±1', 9);
    p.dim(X(-W2), Y(1105), X(-W2), Y(1519), '414', 9);
    for (const b of S.BAYS.slice(1)) p.dim(X(b.x0), Y(1080), X(b.x1), Y(1080), '320+1', -5, { size: 2.6 });
    p.dim(X(S.BAYS[0].x0), Y(1080), X(S.BAYS[0].x1), Y(1080), '318', -5, { size: 2.6 });
  }
  if (positions) {
    const P = (n, x, y, tx, ty) => p.pos(n, X(x), Y(y), X(tx), Y(ty));
    P(1, -838, 1800, -1080, 2150); P(2, 838, 1800, 1080, 2150); P(3, -300, 1300, -1150, 1700);
    P(4, -200, 12, -1150, -120); P(5, 300, 1092, 1150, 1180); P(6, -167, 700, -1150, 900); P(7, -500, 300, -1150, 500);
    P(8, 300, 1300, 1150, 1400); P(9, 100, 1510, 1150, 1600); P(10, 0, 1750, 1150, 1900); P(11, 200, 2040, 1150, 2200);
    P(12, -600, 1780, -1150, 2000); P(13, -700, 600, -1150, 300); P(14, sk.x, 1050, -1150, 1150); P(15, sk.x, 1250, -1150, 1350);
    P(16, -100, 1106, 1150, 1050); P(17, 0, 1488, 1150, 1500);
  }
  return { X, Y };
}

function sideView(p, ox, oy, k = 0.1, { dims = true, film = false } = {}) {
  const X = (z) => ox + z * k, Y = (y) => oy - y * k;
  const prof = S.sideProfile().map(([z, y]) => [X(z), Y(y)]);
  p.poly(prof, INK, 0.5, true, null, film ? 'rgba(220,220,210,0.18)' : null);
  if (film) for (let i = 0; i < 40; i++) p.circle(X(40 + ((i * 197) % 520)), Y(80 + ((i * 331) % 1850)), 0.25, THIN, 0.1);
  for (const [y0, y1, z1] of [[0, 25, 860], [1080, 1105, 854], [1500, 1519, 590], [2031, 2050, 590]]) p.rect(X(13), Y(y1), (z1 - 13) * k, (y1 - y0) * k, HID, 0.25, [2, 1]);
  p.rect(X(0), Y(2050), 13 * k, 2050 * k, HID, 0.25, [2, 1]);
  for (const f of S.FITTINGS.filter((x) => x.id.startsWith('FT-FL-1') || x.id.startsWith('FT-FL-2'))) p.rect(X(f.pos[2] - 45), Y(38), 90 * k, 38 * k, THIN, 0.3);
  if (dims) {
    p.dim(X(0), Y(0), X(860), Y(0), '860', 14);
    p.dim(X(0), Y(2050), X(600), Y(2050), '600', -8);
    p.dim(X(860), Y(1105), X(600), Y(1335), 'R≈230 (S-кривая)', 10, { size: 2.6 });
  }
}

function topView(p, ox, oy, k = 0.1) {
  const X = (x) => ox + x * k, Z = (z) => oy + z * k;
  p.rect(X(-850), Z(0), 1700 * k, 860 * k, INK, 0.5);
  const top = S.panelById.get('TOP');
  p.poly(top.outline.filter(([, v]) => v > 300).map(([u, v]) => [X(u), Z(v)]), THIN, 0.3, false);
  for (const f of S.FITTINGS.filter((x) => x.id.startsWith('FT-UP'))) { p.rect(X(f.pos[0] - 35), Z(f.pos[2] - 55), 70 * k, 110 * k, ACC, 0.3); }
  p.text('Вид сверху (крепление под тяги — 2 места)', X(-850), Z(-6), 3, { color: THIN });
}

// ---------- листы ----------
function sheetAssembly(p, n) {
  if (n === 1) {
    frame(p, 'A1', `${S.PRODUCT.designation} СБ`, 1, 3, `${S.PRODUCT.name}. Сборочный чертёж`, '1:10');
    p.text('Главный вид', 120, 50, 4, { color: THIN });
    frontView(p, 230, 290);
    p.text('Вид слева', 470, 50, 4, { color: THIN });
    sideView(p, 440, 290);
    topView(p, 145, 330);
    const tt = [
      'ТЕХНИЧЕСКИЕ ТРЕБОВАНИЯ',
      '1. * Размеры для справок. Неуказанные предельные отклонения ±1 мм.',
      '2. Соединения шип-паз — на клей-пасте эпоксидной (усл. ВК-9), заполнение паза 60–70 %.',
      '3. Выдержка в прижимах стапеля не менее 4 ч при 18–25 °C; окраска — не ранее 24 ч.',
      '4. Уголки поз. 18 — на винты М4×10 во вставки, момент 1,6±0,2 Н·м.',
      '5. Внутренние поверхности: грунт эпоксидный + эмаль ПУ RAL 9002, 60–80 мкм.',
      '6. Наружные стороны боковин — плёнка ДП-217, пузыри > 2 мм не допускаются.',
      '7. Столешница и фартук — лист 12Х18Н10Т на клей-герметике.',
      '8. Зазоры по контуру дверец 2±0,5 мм. Тележка в отсеке — зазор ≥ 3 мм.',
      '9. Опрессовка подвода воды 0,35 МПа, 10 мин; сопротивление изоляции ≥ 20 МОм.',
    ];
    tt.forEach((t, i) => p.text(t, 600, 360 + i * 7, i ? 3.3 : 3.8, { bold: !i }));
  } else if (n === 2) {
    frame(p, 'A1', `${S.PRODUCT.designation} СБ`, 2, 3, `${S.PRODUCT.name}. Узлы`, '2:1');
    nodeTongue(p, 60, 60); nodeBracket(p, 260, 60); nodeInsert(p, 460, 60); nodeFloor(p, 60, 330); nodeHinge(p, 300, 330);
  } else {
    frame(p, 'A1', `${S.PRODUCT.designation} СБ`, 3, 3, `${S.PRODUCT.name}. Схема покрытий`, '1:10');
    frontView(p, 230, 290, 0.1, { positions: false, dims: false, coat: true });
    sideView(p, 440, 290, 0.1, { dims: false, film: true });
    const rows = [['Зона', 'Покрытие', 'Толщина'], ['Боковины снаружи', 'Плёнка ДП-217 «Гранит светлый»', '0,15'], ['Отсеки внутри', 'Грунт ЭП + эмаль ПУ RAL 9002', '0,06–0,08'],
      ['Столешница, фартук', 'Лист 12Х18Н10Т, шлиф. №4', '0,5–0,6'], ['Кромки', 'Профили Д16Т анод. / нерж.', '—'], ['Дверцы', 'Плёнка ДП-217, кромка ПВХ', '—'], ['Таблички', 'Плёнка жёлтая RAL 1023, текст чёрный', '—']];
    rows.forEach((r, i) => { r.forEach((t, j) => p.text(t, 590 + [0, 50, 160][j], 120 + i * 9, 3.4, { bold: !i })); p.line(588, 122 + i * 9, 815, 122 + i * 9, THIN, 0.15); });
  }
}

function nodeTongue(p, x, y) {
  p.text('Узел А (2:1) — соединение шип-паз', x, y - 8, 4.2, { bold: true });
  const k = 2;
  // панель b (вертикальная, 25 мм) с пазом
  p.rect(x + 60, y, 25 * k, 120, INK, 0.5); p.honeycomb(x + 61, y, 25 * k - 2, 120);
  p.line(x + 60, y, x + 60, y + 120, INK, 0.9); p.line(x + 60 + 50, y, x + 110, y + 120, INK, 0.9);
  // панель a (горизонтальная, 25 мм) с шипом 11 мм
  p.rect(x, y + 40, 60, 25 * k, INK, 0.5); p.honeycomb(x, y + 41, 60, 48);
  p.rect(x + 60, y + 42, 11 * k, 46, ACC, 0.5); p.honeycomb(x + 60, y + 43, 22, 44);
  p.hatch(x + 82, y + 41, 3, 48, 1.2, ACC);
  p.dim(x + 60, y + 40, x + 82, y + 40, '11', 10);
  p.dim(x + 110, y + 40, x + 110, y + 90, '25', -8);
  p.text('клей-паста, заполнение 60–70 %', x + 88, y + 108, 3, { color: ACC });
  p.text('обшивки 0,5 мм, соты 3,2-48', x, y + 135, 3, { color: THIN });
}
function nodeBracket(p, x, y) {
  p.text('Узел Б (2:1) — уголок на винтах во вставки', x, y - 8, 4.2, { bold: true });
  p.rect(x, y + 70, 150, 50, INK, 0.5); p.honeycomb(x, y + 71, 150, 48);
  p.rect(x + 100, y, 50, 70, INK, 0.5); p.honeycomb(x + 101, y, 48, 70);
  p.poly([[x + 100, y + 10], [x + 96, y + 10], [x + 96, y + 70], [x + 36, y + 70], [x + 36, y + 66], [x + 100, y + 66]], ACC, 0.5, true, null, 'rgba(255,212,90,0.25)');
  for (const [cx, cy, v] of [[x + 60, y + 70, true], [x + 100, y + 35, false]]) {
    if (v) { p.rect(cx - 7, cy, 14, 22, THIN, 0.3); p.hatch(cx - 7, cy, 14, 22, 1.2, THIN, -1); p.line(cx, cy - 4, cx, cy + 18, INK, 0.6); p.poly([[cx - 6, cy - 4], [cx + 6, cy - 4], [cx + 3, cy], [cx - 3, cy]], INK, 0.4); }
    else { p.rect(cx, cy - 7, 22, 14, THIN, 0.3); p.hatch(cx, cy - 7, 22, 14, 1.2, THIN, -1); p.line(cx - 4, cy, cx + 18, cy, INK, 0.6); }
  }
  p.text('Уголок КМ2.300.010; винт М4×10 — 1,6 Н·м', x, y + 135, 3, { color: THIN });
}
function nodeInsert(p, x, y) {
  p.text('Узел В (4:1) — вставка закладная', x, y - 8, 4.2, { bold: true });
  p.rect(x, y + 20, 160, 100, INK, 0.5); p.honeycomb(x + 1, y + 22, 158, 96, 12);
  p.poly([[x + 55, y + 20], [x + 105, y + 20], [x + 112, y + 70], [x + 48, y + 70]], THIN, 0.3, true, null, 'rgba(160,200,215,0.25)');
  p.rect(x + 66, y + 20, 28, 46, ACC, 0.6); p.rect(x + 60, y + 20, 40, 4, ACC, 0.6);
  for (let k = 0; k < 8; k++) p.line(x + 68, y + 28 + k * 4, x + 92, y + 30 + k * 4, ACC, 0.15);
  p.text('компаунд заливочный, жизнеспособность 40 мин', x + 10, y + 135, 3, { color: THIN });
  p.text('выступание торца ≤ 0,1', x + 104, y + 16, 3, { color: DIM });
}
function nodeFloor(p, x, y) {
  p.text('Узел Г (1:1) — крепление к полу', x, y - 8, 4.2, { bold: true });
  p.rect(x + 40, y, 25, 120, INK, 0.5); p.honeycomb(x + 41, y, 23, 120, 6);
  p.rect(x + 20, y + 120, 65, 38, ACC, 0.5);
  p.rect(x + 46, y + 158, 12, 18, THIN, 0.4);
  p.rect(x - 20, y + 176, 150, 14, THIN, 0.4); p.hatch(x - 20, y + 176, 150, 14, 2, THIN);
  p.text('рельс пола ВС', x + 90, y + 200, 3, { color: THIN });
  p.text('КМ2.400.010 — болты М6, 9 Н·м, контровка', x, y + 215, 3, { color: THIN });
}
function nodeHinge(p, x, y) {
  p.text('Узел Д (2:1) — петля дверцы', x, y - 8, 4.2, { bold: true });
  p.rect(x, y + 20, 20, 120, INK, 0.5); p.honeycomb(x + 1, y + 20, 18, 120, 6);
  p.rect(x + 26, y + 20, 160, 20, INK, 0.5); p.honeycomb(x + 26, y + 21, 160, 18, 6);
  p.circle(x + 26, y + 46, 8, ACC, 0.5);
  p.rect(x + 26, y + 40, 60, 3, ACC, 0.4); p.rect(x + 20, y + 40, 3, 60, ACC, 0.4);
  p.dim(x + 20, y + 20, x + 26, y + 20, '2±0,5', -10, { size: 2.6 });
  p.text('Петля КМ2.630.010, винты М3 — 1,2 Н·м', x, y + 160, 3, { color: THIN });
}

function sheetSpec(p) {
  frame(p, 'A4', S.PRODUCT.designation, 1, 1, `${S.PRODUCT.name}. Спецификация`, '—');
  const cols = [8, 18, 28, 78, 160, 172];
  const head = ['Ф.', 'Зона', 'Поз.', 'Обозначение', 'Наименование', 'Кол.'];
  head.forEach((h, i) => p.text(h, 20 + cols[i] - 6, 18, 3, { bold: true }));
  p.line(20, 20, 205, 20, INK, 0.4);
  const groups = new Map();
  for (const f of [...S.PANELS, ...S.DOORS, { designation: 'КМ2.300.010', name: 'Уголок' }, ...S.TRIMS, ...S.FITTINGS, ...S.PLUMBING, ...S.EQUIPMENT, ...S.HINGES, ...S.LATCHES]) {
    const key = f.designation;
    const g = groups.get(key) || { d: key, n: f.name, q: 0 };
    g.q += key === 'КМ2.300.010' ? S.BRACKETS.length : 1;
    groups.set(key, g);
  }
  let row = 0;
  for (const g of groups.values()) {
    const yy = 26 + row * 5.6;
    if (yy > 225) break;
    p.text('A3', 21, yy, 2.6, { color: THIN });
    p.text(String(row + 1), 20 + cols[2] - 4, yy, 2.8);
    p.text(g.d, 20 + cols[3] - 48, yy, 2.6, { font: 'mono' });
    p.text(g.n.length > 44 ? `${g.n.slice(0, 43)}…` : g.n, 20 + cols[3] + 2, yy, 2.6);
    p.text(String(g.q), 20 + cols[5] - 4, yy, 2.8);
    p.line(20, yy + 1.6, 205, yy + 1.6, THIN, 0.1);
    row++;
  }
  p.text(`Стандартные: винт М4×10 — ${S.BRACKETS.length * 2}, вставка ВЗ-М4 — ${S.BRACKETS.length * 2}, хомут ХП-10 — ${S.CLAMPS.length}`, 22, 232, 2.6);
}

function sheetWiring(p) {
  frame(p, 'A2', 'КМ2.500.000 Э4', 1, 1, 'Жгут модуля. Схема соединений', '—');
  p.rect(40, 60, 60, 120, INK, 0.5);
  p.text('Щиток КМ2.500.100', 70, 55, 3.6, { align: 'center', bold: true });
  const outs = [['QF1', 'ПЕЧ1', 'X1', 'Печь 1'], ['QF2', 'ПЕЧ2', 'X2', 'Печь 2'], ['QF3', 'КОФ', 'X3', 'Кофеварка'], ['QF4', 'КИП', 'X4', 'Кипятильник'], ['QF5', 'СВЕТ', 'X7, X8', 'Светильники'], ['QF6', 'РЕЗ', '—', 'Резерв']];
  outs.forEach(([qf, lab, x, eq], i) => {
    const y = 75 + i * 18;
    p.rect(50, y - 6, 18, 12, THIN, 0.3); p.text(qf, 59, y + 1.5, 3, { align: 'center' });
    p.line(68, y, 100, y, INK, 0.4); p.line(100, y, 300, y, INK, 0.4, i === 5 ? [2, 1] : null);
    p.circle(300, y, 2.5, ACC, 0.4); p.text(x, 300, y - 4, 3, { align: 'center', color: ACC });
    p.rect(330, y - 7, 90, 14, INK, 0.4); p.text(eq, 375, y + 1.5, 3.2, { align: 'center' });
    p.text(`${lab} · 115 В 400 Гц`, 120, y - 2, 2.6, { color: THIN });
  });
  p.line(20, 200, 40, 200, INK, 0.6); p.text('Ввод 115/200 В 400 Гц, 28 В (от ВС)', 20, 196, 3, { color: THIN });
  p.text('Таблица проводов: МС 26-11 сеч. 1,0 (усл.), экранирование не требуется', 40, 300, 3, { color: THIN });
}

function sheetPart(p, doc) {
  const panels = doc.panels.map((id) => S.panelById.get(id));
  const pnl = panels[0];
  const b = S.panelBox(pnl);
  const [ua, va] = pnl.plane === 'XY' ? [0, 1] : pnl.plane === 'ZY' ? [2, 1] : [0, 2];
  const w = b.max[ua] - b.min[ua], h = b.max[va] - b.min[va];
  const fmt = 'A2';
  const k = Math.min(440 / w, 300 / h, 0.2);
  const scale = k >= 0.2 ? '1:5' : k >= 0.1 ? '1:10' : '1:20';
  frame(p, fmt, doc.code, 1, 1, doc.title, scale);
  const ox = 60 - pnl.rect.u0 * k, oy = 360;
  const X = (u) => ox + u * k, Y = (v) => oy - (v - pnl.rect.v0) * k;
  p.poly(pnl.outline.map(([u, v]) => [X(u), Y(v)]), INK, 0.5);
  for (const hole of pnl.holes) p.poly(hole.map(([u, v]) => [X(u), Y(v)]), INK, 0.4);
  const inv = (pt) => (pnl.plane === 'XY' ? [pt[0], pt[1]] : pnl.plane === 'ZY' ? [pt[2], pt[1]] : [pt[0], pt[2]]);
  for (const g of S.GROOVES.filter((x) => x.panel === pnl.id)) {
    const [u0, v0] = inv(g.min), [u1, v1] = inv(g.max);
    p.rect(X(Math.min(u0, u1)), Y(Math.max(v0, v1)), Math.abs(u1 - u0) * k, Math.abs(v1 - v0) * k, ACC, 0.35, [1.5, 0.8]);
  }
  for (const f of S.FASTENERS.filter((x) => x.kind === 'insert' && x.panel === pnl.id)) {
    const [u, v] = inv(f.pos); p.circle(X(u), Y(v), 1.2, THIN, 0.25); p.line(X(u) - 2, Y(v), X(u) + 2, Y(v), THIN, 0.12); p.line(X(u), Y(v) - 2, X(u), Y(v) + 2, THIN, 0.12);
  }
  p.dim(X(pnl.rect.u0), Y(pnl.rect.v0), X(pnl.rect.u1), Y(pnl.rect.v0), String(Math.round(pnl.rect.u1 - pnl.rect.u0)), 12);
  p.dim(X(pnl.rect.u1), Y(pnl.rect.v0), X(pnl.rect.u1), Y(pnl.rect.v1), String(Math.round(pnl.rect.v1 - pnl.rect.v0)), -12);
  p.text(`Толщина ${pnl.t} мм. ${pnl.core || 'Соты арамидные 3,2-48, обшивки стеклопластик'}.`, 30, 380, 3.4);
  p.text('Пазы (штрих) — фрезеровать на глубину шипа +0,5; вставки (+) — залить компаундом по узлу В.', 30, 387, 3.2, { color: THIN });
  if (doc.variants) p.text(`Исполнения: ${[pnl.designation, ...doc.variants].filter((v, i, a) => a.indexOf(v) === i).join(', ')}`, 30, 394, 3.2, { color: ACC });
}

/** Кронштейн КМ2.310.050 (лист 1 — развёртка и вид сбоку, лист 2 — втулка и ТТ). Масштаб 2:1 / 4:1. */
function sheetBracket(p, doc, sheet) {
  const sh = doc.sheets.find((x) => x.n === sheet) || doc.sheets[0];
  frame(p, sh.format, doc.code, sh.n, doc.sheets.length, sh.n === 1 ? `${doc.title}` : 'Втулка КМ2.310.051', sh.scale);
  if (sh.n === 1) {
    const k = 2, X0 = 60, Y0 = 50;                                   // вид в плане (развёртка 120 × 60) — 2:1
    p.rect(X0, Y0, 120 * k, 60 * k, INK, 0.7);
    p.line(X0 + 60 * k, Y0 - 6, X0 + 60 * k, Y0 + 60 * k + 6, ACC, 0.35, [6, 2, 1, 2]);   // линия гиба
    for (const [x, y] of [[15, 15], [15, 45], [105, 15], [105, 45]]) { p.circle(X0 + x * k, Y0 + y * k, 3.2 * k, INK, 0.5); p.line(X0 + x * k - 9, Y0 + y * k, X0 + x * k + 9, Y0 + y * k, THIN, 0.18, [4, 1, 1, 1]); p.line(X0 + x * k, Y0 + y * k - 9, X0 + x * k, Y0 + y * k + 9, THIN, 0.18, [4, 1, 1, 1]); }
    p.dim(X0, Y0 + 60 * k, X0 + 120 * k, Y0 + 60 * k, '120', 14);
    p.dim(X0 + 120 * k, Y0, X0 + 120 * k, Y0 + 60 * k, '60', -14);
    p.dim(X0, Y0, X0 + 15 * k, Y0, '15', -8);
    p.dim(X0 + 15 * k, Y0, X0 + 105 * k, Y0, '90 ± 0,2', -8);
    p.text('4 отв. Ø6,4 H12', X0 + 15 * k + 8, Y0 + 15 * k - 8, 3.5, { color: ACC });
    p.text('Линия гиба', X0 + 60 * k + 3, Y0 - 8, 3, { color: ACC });
    const SX = 330, SY = 70;                                           // вид сбоку после гиба — уголок 90°
    p.poly([[SX, SY], [SX, SY + 60 * k], [SX + 60 * k, SY + 60 * k], [SX + 60 * k, SY + 60 * k - 4], [SX + 4, SY + 60 * k - 4], [SX + 4, SY]], INK, 0.6, true, null, FILL);
    p.text('90° ± 0,5°', SX + 14, SY + 60 * k - 14, 3.5, { color: DIM });
    p.text('R2 (внутр.)', SX + 8, SY + 60 * k - 26, 3, { color: THIN });
    p.text('δ = 2', SX + 8, SY + 12, 3, { color: THIN });
    p.text('Материал: лист Д16АТ 2,0 ГОСТ 21631. Покрытие: Ан.Окс.хром (Алодин 1132).', 30, 225, 3.4);
    p.text('1. Острые кромки притупить R0,3. 2. Заусенцы не допускаются. 3. Втулки — по листу 2, 2 шт.', 30, 232, 3.2, { color: THIN });
    p.text('4. Маркировать «КМ2.310.050», № партии — краской, шрифт 3.', 30, 239, 3.2, { color: THIN });
  } else {
    const k = 4, X0 = 40, Y0 = 50;                                     // втулка Ø6,4/Ø4,2 × 6 с буртиком — 4:1
    p.poly([[X0, Y0], [X0 + 2 * k, Y0], [X0 + 2 * k, Y0 + 1.1 * k], [X0 + 8 * k, Y0 + 1.1 * k], [X0 + 8 * k, Y0 + 5.3 * k], [X0 + 2 * k, Y0 + 5.3 * k], [X0 + 2 * k, Y0 + 6.4 * k], [X0, Y0 + 6.4 * k]], INK, 0.6, true, null, FILL);
    p.line(X0 - 4, Y0 + 3.2 * k, X0 + 8 * k + 4, Y0 + 3.2 * k, THIN, 0.18, [4, 1, 1, 1]);
    p.dim(X0, Y0 + 6.4 * k, X0 + 8 * k, Y0 + 6.4 * k, '8', 10);
    p.dim(X0 + 8 * k, Y0 + 1.1 * k, X0 + 8 * k, Y0 + 5.3 * k, 'Ø4,2', -12);
    p.text('Ø6,4 s6 (натяг в отв. Ø6,4 H12)', X0, Y0 - 6, 3.4, { color: ACC });
    p.text('Материал: 12Х18Н10Т. Запрессовка оправкой до упора буртика.', 20, 150, 3.4);
    p.text('Втулка не должна проворачиваться от момента 0,5 Н·м.', 20, 157, 3.2, { color: THIN });
  }
}

function sheetSmall(p, doc) {
  frame(p, doc.sheets[0].format, doc.code, 1, 1, doc.title, doc.sheets[0].scale);
  const [W, H] = FORMATS[doc.sheets[0].format];
  p.rect(W * 0.25, H * 0.25, W * 0.35, H * 0.25, INK, 0.5);
  p.text(doc.title, W * 0.25, H * 0.22, 4, { bold: true });
  p.text('Чертёж детали (упрощённо): контур, материал и покрытие — по ТТ сборочного чертежа.', 30, H - 75, 3, { color: THIN });
}

function sheetTP(p) {
  frame(p, 'A4', TP.designation, 1, 1, `${TP.name}. Маршрут`, '—');
  let y = 18;
  for (const o of OPERATIONS) {
    if (y > 228) break;
    p.text(`${o.id}  ${o.title}`, 22, y, 3.2, { bold: true }); y += 5;
    for (const s of o.steps) {
      if (y > 228) break;
      const badges = `${s.timer ? ` ⏱${s.timer.min}′` : ''}${s.check ? ' ✓' : ''}${s.critical ? ' !' : ''}`;
      p.text(`${s.id}  ${s.title}${badges}`, 28, y, 2.6, { color: THIN }); y += 4.2;
    }
  }
}

/** Нарисовать лист документа. view = {s, ox, oy}; zone — подсветка зоны (например 'B3'). */
export function drawDoc(ctx, code, sheet, view, { zone = null } = {}) {
  const doc = docByCode.get(code);
  const fmt = doc ? doc.sheets.find((s) => s.n === sheet)?.format || doc.sheets[0].format : 'A4';
  ctx.save();
  ctx.setTransform(view.s, 0, 0, view.s, view.ox, view.oy);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const p = new Pen(ctx, view);
  const [W, H] = FORMATS[fmt];
  ctx.fillStyle = 'rgba(8,30,40,0.12)'; ctx.fillRect(0, 0, W, H);
  if (!doc) p.text(`Документ ${code} не найден`, 20, 40, 8);
  else if (doc.kind === 'СБ') sheetAssembly(p, sheet);
  else if (doc.kind === 'СП') sheetSpec(p);
  else if (doc.kind === 'Э4') sheetWiring(p);
  else if (doc.kind === 'ТП') sheetTP(p);
  else if (doc.bracket) sheetBracket(p, doc, sheet);
  else if (doc.panels) sheetPart(p, doc);
  else sheetSmall(p, doc);
  if (zone && doc) {
    const z = zoneRect(fmt, zone);
    if (z) { ctx.fillStyle = 'rgba(255,212,90,0.10)'; ctx.fillRect(z.x, z.y, z.w, z.h); p.rect(z.x, z.y, z.w, z.h, ACC, 0.8, [4, 2]); p.text(`зона ${zone}`, z.x + 3, z.y + 7, 5, { color: ACC, bold: true }); }
  }
  ctx.restore();
  return fmt;
}

export function docFormat(code, sheet = 1) {
  const d = docByCode.get(code);
  return d ? (d.sheets.find((s) => s.n === sheet) || d.sheets[0]).format : 'A4';
}
