// Правила выбора физического материала детали (фотореалистичный вид).
// Без three.js — чтобы тестироваться в node. Порядок: имя материала CAD → наименование детали → тип заглушки → цвет.

/** Ключи библиотеки материалов src/scene/materials.js. */
export const MATERIAL_KEYS = [
  'aluminium', 'anodized', 'steel', 'chrome', 'plastic_black', 'composite_panel', 'decor_panel', 'painted', 'rubber',
];

const RULES = [
  // [ключ, регулярное выражение по имени материала CAD или наименованию детали]
  ['chrome', /хром|chrome|никел|nickel/i],
  ['steel', /стал|steel|винт|болт|гайк|шайб|палец|петл|hinge|pin|bolt|screw|тяга|rod/i],
  ['anodized', /анод|anodi[sz]/i],
  ['plastic_black', /замок|защёлк|защелк|latch|lock|ручк|handle|полиамид|nylon|pa6|abs/i],
  ['rubber', /резин|rubber|уплотн|seal|демпф/i],
  ['decor_panel', /потолоч|ceiling|декор|decor|облицов|lining/i],
  ['composite_panel', /полк|shelf|bin|панел|panel|сот|honeycomb|композит|composite|стеклопласт|крышк/i],
  ['aluminium', /кронштейн|bracket|д16|д1т|ал[юь]мин|alumin|al\b|профил|profile|уголок|plate|пластин/i],
];

/** Светлота цвета #rrggbb, 0..1 (для решения «тёмный пластик или металл»). */
export function lightness(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return 0.6;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
}

/**
 * Ключ материала для детали.
 * @param {{name?: string, designation?: string, cadMaterial?: string, fallbackType?: string, color?: string}} p
 */
export function materialKeyFor(p = {}) {
  for (const text of [p.cadMaterial, p.name, p.designation]) {
    if (!text) continue;
    for (const [key, re] of RULES) if (re.test(text)) return key;
  }
  if (p.fallbackType === 'cylinder') return 'steel';
  const l = lightness(p.color);
  if (l < 0.3) return 'plastic_black';
  if (p.fallbackType === 'plate') return 'aluminium';
  return l > 0.75 ? 'composite_panel' : 'painted';
}
