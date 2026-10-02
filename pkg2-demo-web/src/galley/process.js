// Технологический процесс сборки модуля кухонного КМ-2 (условный): операции → переходы с текстом, инструментом,
// материалами, деталями и крепежом, ссылками на листы и зоны КД, таймерами выдержки и контролем.
// Чистые данные + движок состояния, без three.js (тестируется в node). Режимы материалов — условные,
// по типовым паспортам эпоксидных клеев, заливочных компаундов и ЛКМ; в работе — из ТП и паспортов на партию.
import { BRACKETS, CLAMPS, DECOR, DOORS, FITTINGS, HINGES, JOINTS, LATCHES, PANELS, PRODUCT, TRIMS } from './spec.js';

export const TP = {
  designation: 'ТП 7.КМ2.00001',
  name: 'Сборка модуля кухонного КМ-2',
  product: PRODUCT.designation,
  revision: 'Б',
  workplace: 'Цех 12, участок сборки монументов, стапель СТ-3',
};

export const MATERIALS = {
  glue: { id: 'M-01', name: 'Клей-паста эпоксидная двухкомпонентная (усл. ВК-9)', potLifeMin: 60, fixMin: 240, cureH: 24 },
  potting: { id: 'M-02', name: 'Компаунд заливочный для вставок (усл.)', potLifeMin: 40, cureMin: 120 },
  solvent: { id: 'M-03', name: 'Нефрас С2-80/120 (обезжириватель)', flashMin: 10 },
  primer: { id: 'M-04', name: 'Грунт эпоксидный (усл. ЭП-0215)', flashMin: 30 },
  enamel: { id: 'M-05', name: 'Эмаль полиуретановая RAL 9002 (усл.)', interCoatMin: 20, tackFreeMin: 120 },
  film: { id: 'M-06', name: 'Плёнка декоративная самоклеящаяся ДП-217 (усл.)', settleMin: 60 },
  sealant: { id: 'M-07', name: 'Герметик силиконовый (усл.)', skinMin: 15 },
  tape: { id: 'M-08', name: 'Лента малярная 25 мм' },
};

export const TOOLS = {
  wrench: { id: 'T-01', name: 'Отвёртка динамометрическая 0,5–5 Н·м' },
  torque: { id: 'T-02', name: 'Ключ динамометрический 5–25 Н·м' },
  gun: { id: 'T-03', name: 'Пистолет для двухкомпонентного клея, смеситель статический' },
  spatula: { id: 'T-04', name: 'Шпатель пластиковый' },
  template320: { id: 'T-05', name: 'Шаблон ширины отсека Ш-320' },
  tape: { id: 'T-06', name: 'Рулетка 3 м, линейка 1000 мм' },
  caliper: { id: 'T-07', name: 'Штангенциркуль ШЦ-I-250' },
  spray: { id: 'T-08', name: 'Краскопульт HVLP, сопло 1,3 мм' },
  thickness: { id: 'T-09', name: 'Толщиномер покрытий' },
  squeegee: { id: 'T-10', name: 'Ракель фетровый' },
  heatgun: { id: 'T-11', name: 'Фен технический с термоконтролем' },
  knife: { id: 'T-12', name: 'Нож с отламывающимся лезвием' },
  megger: { id: 'T-13', name: 'Мегаомметр 500 В, мультиметр' },
  pressure: { id: 'T-14', name: 'Стенд опрессовки 0–1 МПа' },
  sander: { id: 'T-15', name: 'Шлифмашинка орбитальная, абразив P240' },
  clamps: { id: 'T-16', name: 'Прижимы стапеля (штатные)' },
  stand: { id: 'T-17', name: 'Стенд проверки 115 В 400 Гц' },
};

const ids = (arr) => arr.map((x) => x.id);
const jointsOf = (...panelIds) => JOINTS.filter((j) => panelIds.includes(j.a)).map((j) => j.id);
const bracketsOf = (pred) => BRACKETS.filter(pred);
const screwsOf = (brs) => brs.flatMap((b) => b.screws);

function S(id, kind, title, o = {}) {
  return {
    id, op: id.split('.')[0], kind, title,
    text: o.text || [], warn: o.warn || [],
    parts: o.parts || [], joints: o.joints || [], fasteners: o.fasteners || [],
    tools: o.tools || [], materials: o.materials || [],
    kd: o.kd || [], timer: o.timer || null, check: o.check || null,
    photo: !!o.photo, critical: !!o.critical, normMin: o.normMin ?? 5, measure: o.measure || null, paint: o.paint || null,
  };
}

const KD_SB = 'КМ2.000.000 СБ';
const glueText = (what) => [
  `Подготовить клей: смешать компоненты А и Б через статический смеситель, первые 5 см валика — в отход.`,
  `Нанести клей в пазы ${what} валиком Ø4–5 мм по дну паза; заполнение паза 60–70 % (излишек выдавится при сборке).`,
  `Время от смешивания до сборки — не более ${MATERIALS.glue.potLifeMin} мин (таймер жизнеспособности запущен).`,
];

const lowerBr = bracketsOf((b) => /^J-(BASE|DIV-(W|T\d))/.test(b.joint));
const deckBr = bracketsOf((b) => /^J-DECK/.test(b.joint));
const upperDivBr = bracketsOf((b) => /^J-DIV-(E|U)/.test(b.joint));
const shelfTopBr = bracketsOf((b) => /^J-(SHELF|TOP)/.test(b.joint));

export const OPERATIONS = [
  { id: '010', title: 'Подготовительная', steps: [
    S('010.01', 'prep', 'Получить задание, изучить КД и ТП', {
      text: ['Открыть сменное задание в окне «Задание и чат».', `В окне «Система сборщика» найти ${KD_SB} и ${TP.designation}.`,
        'Изучить лист 1 (виды), лист 2 (узлы А–Г), технические требования.'],
      kd: [{ doc: KD_SB, sheet: 1, zone: 'A1' }], normMin: 10 }),
    S('010.02', 'prep', 'СИЗ и рабочее место', {
      text: ['Надеть нитриловые перчатки и антистатический халат; AR-очки выполняют функцию защитных.',
        'Включить местную вытяжку клеевого стола, проверить по индикатору расхода.',
        'Проверить срок годности клея и компаунда по этикеткам партии.'],
      warn: ['Эпоксидные составы — раздражающее действие на кожу. Работать только в перчатках.'], normMin: 5 }),
    S('010.03', 'check', 'Проверить стапель по меткам', {
      text: ['Посмотреть на метки стапеля Ф1–Ф4: система совместит модель со стапелем.',
        'Проверить, что все прижимы и упоры в исходном (отведённом) положении.'],
      check: { name: 'Отклонение базовых упоров', nominal: 0, tol: 0.5, unit: 'мм' }, tools: ['T-06'], normMin: 10 }),
    S('010.04', 'inspect', 'Комплектность по спецификации', {
      text: ['Сверить панели на стеллаже комплектации с ведомостью: 16 панелей, маркировка на кромке.',
        `Уголки КМ2.300.010 — ${BRACKETS.length} шт., винты М4×10 — ${BRACKETS.length * 2} шт., профили кромок — ${TRIMS.length} шт.`],
      kd: [{ doc: 'КМ2.000.000', sheet: 1, zone: 'A1' }], normMin: 15 }),
  ] },
  { id: '020', title: 'Подготовка панелей', steps: [
    S('020.01', 'inspect', 'Осмотр сотовых панелей', {
      text: ['Осмотреть панели: нет расслоений обшивки, вмятин > 0,3 мм, сколов кромок.',
        'Проверить шипы: соты закрыты, обшивки не отслоены; пазы чистые, без заусенцев.'],
      parts: ids(PANELS), normMin: 15 }),
    S('020.02', 'check', 'Проверить закладные вставки', {
      text: ['Проверить наличие вставок по шаблону сверловки (КД лист 2, узел В).',
        'Выступание торца вставки над обшивкой — не более 0,1 мм; резьба М4 — калибром.'],
      check: { name: 'Выступание вставки', nominal: 0, tol: 0.1, unit: 'мм' }, tools: ['T-07'],
      kd: [{ doc: KD_SB, sheet: 2, zone: 'C2' }], normMin: 20 }),
    S('020.03', 'prep', 'Обезжирить зоны склеивания', {
      text: ['Протереть шипы и пазы салфеткой, смоченной нефрасом, затем сухой салфеткой.', 'Не касаться обезжиренных зон руками.'],
      materials: ['M-03'], timer: { kind: 'flash', min: MATERIALS.solvent.flashMin, label: 'Испарение растворителя', blocking: true }, normMin: 15 }),
  ] },
  { id: '030', title: 'Установка основания и боковин в стапель', steps: [
    S('030.01', 'install', 'Установить основание на ложементы', {
      text: ['Уложить основание КМ2.140.000 на ложементы стапеля, задняя кромка — к упорам задней балки.', 'Прижать фиксаторами 1–4.'],
      parts: ['BASE'], tools: ['T-16'], kd: [{ doc: KD_SB, sheet: 1, zone: 'B3' }], normMin: 10 }),
    S('030.02', 'glue', 'Клей в пазы боковин под основание', {
      text: [...glueText('боковин под шипы основания'), 'Клей наносить на боковины, лежащие на столе комплектации, пазами вверх.'], joints: ['J-BASE-L', 'J-BASE-R'], materials: ['M-01'], tools: ['T-03'],
      timer: { kind: 'pot_life', min: MATERIALS.glue.potLifeMin, label: 'Жизнеспособность клея', blocking: false },
      kd: [{ doc: KD_SB, sheet: 2, zone: 'A2' }], critical: true, normMin: 10 }),
    S('030.03', 'install', 'Установить боковину левую', {
      text: ['Установить КМ2.110.000 на вертикальные ложементы левой стойки стапеля.',
        'Совместить базовые отверстия с фиксаторами Ф5, Ф6; прижать рычажными прижимами.'],
      parts: ['SIDE-L'], tools: ['T-16'], kd: [{ doc: KD_SB, sheet: 1, zone: 'B2' }], normMin: 10 }),
    S('030.04', 'install', 'Установить боковину правую', {
      text: ['Установить КМ2.120.000 на ложементы правой стойки, совместить с фиксаторами Ф7, Ф8.'],
      parts: ['SIDE-R'], tools: ['T-16'], kd: [{ doc: KD_SB, sheet: 1, zone: 'B4' }], normMin: 10 }),
    S('030.05', 'check', 'Свести боковины до упора шипов, проверить ширину', {
      text: ['Подвести винтовыми упорами стапеля боковины к основанию до посадки шипов в пазы.',
        'Удалить выдавленный клей шпателем. Измерить ширину по наружным поверхностям вверху и внизу.'],
      check: { name: 'Ширина модуля', nominal: 1700, tol: 0.5, unit: 'мм' }, tools: ['T-06', 'T-04'],
      measure: { from: [-850, 900, 700], to: [850, 900, 700] }, normMin: 10 }),
  ] },
  { id: '040', title: 'Установка задней панели', steps: [
    S('040.01', 'glue', 'Клей в пазы под заднюю панель', {
      text: glueText('боковин и основания под заднюю панель'), joints: ['J-BACK-L', 'J-BACK-R', 'J-BASE-B'], materials: ['M-01'],
      tools: ['T-03'], timer: { kind: 'pot_life', min: MATERIALS.glue.potLifeMin, label: 'Жизнеспособность клея', blocking: false },
      kd: [{ doc: KD_SB, sheet: 2, zone: 'A2' }], critical: true, normMin: 10 }),
    S('040.02', 'install', 'Установить заднюю панель', {
      text: ['Завести КМ2.130.000 сверху шипами в пазы боковин, опустить до упора в основание.', 'Поджать прижимами задней балки стапеля (3 шт.).'],
      parts: ['BACK'], tools: ['T-16'], kd: [{ doc: KD_SB, sheet: 1, zone: 'B3' }], normMin: 15 }),
    S('040.03', 'check', 'Диагонали проёма', {
      text: ['Измерить диагонали переднего проёма между боковинами (по меткам на кромках).', 'Разность диагоналей — не более 1,0 мм.'],
      check: { name: 'Разность диагоналей', nominal: 0, tol: 1.0, unit: 'мм' }, tools: ['T-06'],
      measure: { from: [-825, 30, 850], to: [825, 2040, 590] }, critical: true, normMin: 10 }),
  ] },
  { id: '050', title: 'Перегородки тележечных отсеков', steps: [
    S('050.01', 'glue', 'Клей в пазы основания и задней панели под перегородки', {
      text: glueText('основания и задней панели под перегородки'),
      joints: JOINTS.filter((j) => /^J-DIV-(W|T\d)-(BS|BK)$/.test(j.id)).map((j) => j.id), materials: ['M-01'], tools: ['T-03'],
      timer: { kind: 'pot_life', min: MATERIALS.glue.potLifeMin, label: 'Жизнеспособность клея', blocking: false }, normMin: 15 }),
    S('050.02', 'install', 'Установить перегородки по шаблону Ш-320', {
      text: ['Установить перегородку отсека отходов КМ2.161.000 и три перегородки КМ2.160.000 (исп. 00, 01, 02).',
        'Ширину каждого тележечного отсека выставить шаблоном Ш-320, перегородку прижать к шаблону.'],
      parts: ['DIV-W', 'DIV-T1', 'DIV-T2', 'DIV-T3'], tools: ['T-05'], kd: [{ doc: KD_SB, sheet: 1, zone: 'C3' }], normMin: 20 }),
    S('050.03', 'check', 'Ширина тележечных отсеков', {
      text: ['Измерить ширину отсеков 1–4 вверху и внизу. Тележка 302 мм должна входить с зазором.'],
      check: { name: 'Ширина отсека', nominal: 320, tol: 1.0, unit: 'мм' }, tools: ['T-06'],
      measure: { from: [-161, 600, 840], to: [159, 600, 840] }, critical: true, normMin: 10 }),
  ] },
  { id: '060', title: 'Установка рабочего стола', steps: [
    S('060.01', 'glue', 'Клей в пазы стола и боковин', {
      text: glueText('стола (под перегородки) и боковин/задней панели (под стол)'),
      joints: [...jointsOf('DECK'), ...JOINTS.filter((j) => /^J-DIV-(W|T\d)-DK$/.test(j.id)).map((j) => j.id)],
      materials: ['M-01'], tools: ['T-03'], timer: { kind: 'pot_life', min: MATERIALS.glue.potLifeMin, label: 'Жизнеспособность клея', blocking: false },
      kd: [{ doc: KD_SB, sheet: 2, zone: 'A3' }], critical: true, normMin: 15 }),
    S('060.02', 'install', 'Установить стол на упоры высоты', {
      text: ['Выставить упоры высоты стапеля на 1105 мм (по шкале стойки).',
        'Опустить стол КМ2.150.000 шипами в пазы боковин и задней панели, одновременно — пазами на шипы перегородок.'],
      parts: ['DECK'], tools: ['T-16'], kd: [{ doc: KD_SB, sheet: 1, zone: 'B3' }], normMin: 15 }),
    S('060.03', 'check', 'Высота рабочей поверхности', {
      text: ['Измерить высоту поверхности стола от плоскости основания у левой и правой боковин.'],
      check: { name: 'Высота стола', nominal: 1105, tol: 1.0, unit: 'мм' }, tools: ['T-06'],
      measure: { from: [-700, 0, 820], to: [-700, 1105, 820] }, normMin: 5 }),
  ] },
  { id: '070', title: 'Выдержка клеевых соединений нижнего яруса', steps: [
    S('070.01', 'wait', 'Выдержка до фиксации клея', {
      text: [`Выдержать сборку в прижимах ${MATERIALS.glue.fixMin / 60} ч при 18–25 °C.`,
        'Не нагружать, не снимать прижимы. В это время — подготовка верхних панелей (оп. 080).'],
      timer: { kind: 'fix', min: MATERIALS.glue.fixMin, label: 'Фиксация клея (нижний ярус)', blocking: true }, critical: true, normMin: 240 }),
  ] },
  { id: '080', title: 'Верхний ярус', steps: [
    S('080.01', 'glue', 'Клей в пазы под перегородки оборудования', {
      text: glueText('стола и задней панели под перегородки оборудования'), joints: [...jointsOf('DIV-E1', 'DIV-E2')].filter((j) => !/-SH$/.test(j)),
      materials: ['M-01'], tools: ['T-03'], timer: { kind: 'pot_life', min: MATERIALS.glue.potLifeMin, label: 'Жизнеспособность клея', blocking: false }, normMin: 10 }),
    S('080.02', 'install', 'Установить перегородки отсека оборудования', {
      text: ['Установить КМ2.170.000 и исп. 01; проверить перпендикулярность к столу угольником (≤ 0,5 мм на 400 мм).'],
      parts: ['DIV-E1', 'DIV-E2'], kd: [{ doc: KD_SB, sheet: 1, zone: 'B2' }], normMin: 10 }),
    S('080.03', 'glue', 'Клей в пазы под полку', {
      text: glueText('боковин и задней панели под полку, пазы полки — под шипы перегородок'),
      joints: [...jointsOf('SHELF'), 'J-DIV-E1-SH', 'J-DIV-E2-SH'], materials: ['M-01'], tools: ['T-03'],
      timer: { kind: 'pot_life', min: MATERIALS.glue.potLifeMin, label: 'Жизнеспособность клея', blocking: false }, normMin: 10 }),
    S('080.04', 'install', 'Установить полку среднюю', {
      text: ['Установить полку КМ2.180.000 (криволинейная передняя кромка — наружу) на съёмные кронштейны стапеля.',
        'Посадить шипы в пазы боковин и задней панели, пазы полки — на шипы перегородок.'],
      parts: ['SHELF'], kd: [{ doc: KD_SB, sheet: 1, zone: 'B2' }], normMin: 15 }),
    S('080.05', 'glue', 'Клей в пазы полки и крышки под верхние перегородки', {
      text: glueText('полки и крышки под верхние перегородки, боковин и задней панели под крышку'),
      joints: [...jointsOf('DIV-U1', 'DIV-U2', 'DIV-U3'), ...jointsOf('TOP')], materials: ['M-01'], tools: ['T-03'],
      timer: { kind: 'pot_life', min: MATERIALS.glue.potLifeMin, label: 'Жизнеспособность клея', blocking: false }, normMin: 15 }),
    S('080.06', 'install', 'Установить перегородки верхних отсеков', {
      text: ['Установить три перегородки КМ2.190.000 (исп. 00, 01, 02) — скруглённый угол вперёд-вверх.'],
      parts: ['DIV-U1', 'DIV-U2', 'DIV-U3'], kd: [{ doc: KD_SB, sheet: 1, zone: 'A2' }], normMin: 15 }),
    S('080.07', 'install', 'Установить крышку верхнюю', {
      text: ['Опустить крышку КМ2.200.000 на шипы боковин, задней панели и перегородок.', 'Поджать верхней траверсой стапеля.'],
      parts: ['TOP'], kd: [{ doc: KD_SB, sheet: 1, zone: 'A3' }], normMin: 15 }),
    S('080.08', 'wait', 'Выдержка до фиксации клея верхнего яруса', {
      text: [`Выдержать ${MATERIALS.glue.fixMin / 60} ч в прижимах. Полное отверждение — ${MATERIALS.glue.cureH} ч (до окраски).`],
      timer: { kind: 'fix', min: MATERIALS.glue.fixMin, label: 'Фиксация клея (верхний ярус)', blocking: true }, critical: true, normMin: 240 }),
  ] },
  { id: '090', title: 'Установка уголков крепления', steps: [
    S('090.01', 'fasten', 'Уголки нижнего яруса', {
      text: ['Установить уголки КМ2.300.010 во внутренние углы отсеков: основание — боковины, основание — задняя стенка, перегородки — основание и стол.',
        `Винты М4×10 во вставки, момент ${BRACKETS[0] ? '1,6' : ''} Н·м, крест-накрест.`],
      parts: ids(lowerBr), fasteners: screwsOf(lowerBr), tools: ['T-01'], kd: [{ doc: KD_SB, sheet: 2, zone: 'B2' }], normMin: 30 }),
    S('090.02', 'fasten', 'Уголки под столом', {
      text: ['Уголки под столом у боковин и задней панели; винты М4×10, момент 1,6 Н·м.'],
      parts: ids(deckBr), fasteners: screwsOf(deckBr), tools: ['T-01'], kd: [{ doc: KD_SB, sheet: 2, zone: 'B2' }], normMin: 20 }),
    S('090.03', 'fasten', 'Уголки перегородок оборудования и верхних отсеков', {
      text: ['Уголки перегородок к столу, полке и крышке; винты М4×10, 1,6 Н·м.'],
      parts: ids(upperDivBr), fasteners: screwsOf(upperDivBr), tools: ['T-01'], kd: [{ doc: KD_SB, sheet: 2, zone: 'B3' }], normMin: 20 }),
    S('090.04', 'fasten', 'Уголки полки и крышки', {
      text: ['Уголки под полкой и под крышкой у боковин и задней панели; винты М4×10, 1,6 Н·м.'],
      parts: ids(shelfTopBr), fasteners: screwsOf(shelfTopBr), tools: ['T-01'], kd: [{ doc: KD_SB, sheet: 2, zone: 'B3' }], normMin: 20 }),
    S('090.05', 'check', 'Выборочный контроль момента', {
      text: ['Проверить момент на 10 % винтов (не менее 5), отметить проверенные маркером.'],
      check: { name: 'Момент затяжки', nominal: 1.6, tol: 0.2, unit: 'Н·м' }, tools: ['T-01'], normMin: 10 }),
  ] },
  { id: '100', title: 'Узлы крепления к самолёту', steps: [
    S('100.01', 'fasten', 'Узлы крепления к полу', {
      text: ['Установить 4 узла КМ2.400.010 на нижние кромки боковин; болты М6 во вставки, момент 9 Н·м.', 'Законтрить проволокой.'],
      parts: ids(FITTINGS.filter((f) => f.id.startsWith('FT-FL'))), tools: ['T-02'], kd: [{ doc: KD_SB, sheet: 2, zone: 'D2' }], critical: true, normMin: 20 }),
    S('100.02', 'fasten', 'Кронштейны верхнего крепления', {
      text: ['Установить 2 кронштейна КМ2.400.020 на крышку; винты М5, момент 5 Н·м.'],
      parts: ids(FITTINGS.filter((f) => f.id.startsWith('FT-UP'))), tools: ['T-01'], kd: [{ doc: KD_SB, sheet: 2, zone: 'D3' }], critical: true, normMin: 15 }),
  ] },
  { id: '110', title: 'Окантовка кромок', steps: [
    S('110.01', 'install', 'Профиль кромки стола', {
      text: ['Нанести герметик в паз профиля КМ2.310.010, надеть на переднюю кромку стола от центра к краям.',
        'Профиль повторяет выпуклую кромку — прикатать роликом, удалить излишки герметика.'],
      parts: ['TR-DECK'], materials: ['M-07'], timer: { kind: 'skin', min: MATERIALS.sealant.skinMin, label: 'Плёнкообразование герметика', blocking: false }, normMin: 15 }),
    S('110.02', 'install', 'Профили полки и крышки', { text: ['Установить профили КМ2.310.020 и исп. 01 аналогично.'], parts: ['TR-SHELF', 'TR-TOP'], materials: ['M-07'], normMin: 15 }),
    S('110.03', 'install', 'Профили передних кромок боковин', {
      text: ['Гибкий профиль КМ2.310.030 — по S-образной кромке боковины снизу вверх, без складок на радиусах.'],
      parts: ['TR-SIDE-L', 'TR-SIDE-R'], materials: ['M-07'], normMin: 20 }),
    S('110.04', 'install', 'Накладки защитные перегородок', { text: ['Накладки КМ2.310.040 на передние кромки перегородок тележечных отсеков.'],
      parts: ids(TRIMS.filter((t) => t.profile === 'kick')), normMin: 10 }),
  ] },
  { id: '120', title: 'Подготовка к окраске', steps: [
    S('120.01', 'prep', 'Шлифование клеевых швов и кромок', {
      text: ['Зашкурить выступившие клеевые швы и зоны окраски абразивом P240 до матовой поверхности.', 'Обеспылить сжатым воздухом и салфеткой.'],
      tools: ['T-15'], warn: ['Работать с местной вытяжкой, в респираторе.'], normMin: 30 }),
    S('120.02', 'prep', 'Обезжиривание', { text: ['Обезжирить окрашиваемые поверхности нефрасом.'], materials: ['M-03'],
      timer: { kind: 'flash', min: MATERIALS.solvent.flashMin, label: 'Испарение растворителя', blocking: true }, normMin: 15 }),
    S('120.03', 'prep', 'Маскирование', {
      text: ['Закрыть лентой: наружные стороны боковин (под плёнку), профили кромок, вставки, узлы крепления.'],
      materials: ['M-08'], normMin: 20 }),
  ] },
  { id: '130', title: 'Окрашивание внутренних поверхностей', steps: [
    S('130.01', 'paint', 'Грунтование', {
      text: ['Нанести грунт распылением, 1 слой 15–20 мкм, расстояние 200–250 мм, перекрытие 50 %.'],
      parts: ['PAINT-INT'], materials: ['M-04'], tools: ['T-08'], paint: 'primer',
      timer: { kind: 'flash', min: MATERIALS.primer.flashMin, label: 'Межслойная выдержка грунта', blocking: true },
      warn: ['Окраска — только в зоне с переносной вытяжкой, респиратор с фильтром A2P2.'], normMin: 30 }),
    S('130.02', 'paint', 'Эмаль, слой 1', {
      text: ['Эмаль RAL 9002, 1-й слой 25–30 мкм.'], parts: ['PAINT-INT'], materials: ['M-05'], tools: ['T-08'], paint: 'coat1',
      timer: { kind: 'flash', min: MATERIALS.enamel.interCoatMin, label: 'Межслойная выдержка эмали', blocking: true }, normMin: 25 }),
    S('130.03', 'paint', 'Эмаль, слой 2', {
      text: ['2-й слой 25–30 мкм, без потёков.'], parts: ['PAINT-INT'], materials: ['M-05'], tools: ['T-08'], paint: 'coat2',
      timer: { kind: 'dry', min: MATERIALS.enamel.tackFreeMin, label: 'Сушка до отлипа', blocking: true }, normMin: 25 }),
    S('130.04', 'check', 'Толщина покрытия, снять маскировку', {
      text: ['Измерить толщину покрытия в 5 точках каждого отсека.', 'Снять маскирующую ленту под углом 45°.'],
      check: { name: 'Толщина покрытия', nominal: 70, tol: 10, unit: 'мкм' }, tools: ['T-09'], normMin: 15 }),
  ] },
  { id: '140', title: 'Декоративная плёнка', steps: [
    S('140.01', 'prep', 'Обезжирить наружные поверхности боковин', { text: ['Нефрас, затем сухая салфетка.'], materials: ['M-03'],
      timer: { kind: 'flash', min: MATERIALS.solvent.flashMin, label: 'Испарение растворителя', blocking: true }, normMin: 10 }),
    S('140.02', 'prep', 'Раскрой плёнки', { text: ['Раскроить плёнку ДП-217 по шаблону боковины с припуском 10 мм по контуру.', 'Направление рисунка — вертикально, стрелка на подложке вверх.'],
      materials: ['M-06'], tools: ['T-12'], normMin: 15 }),
    S('140.03', 'film', 'Наклеить плёнку на левую боковину', {
      text: ['Снять подложку на 100 мм, совместить плёнку по задней кромке боковины.',
        'Прикатать ракелем от центра к краям, постепенно снимая подложку; пузыри не допускаются.'],
      parts: ['FILM-L'], materials: ['M-06'], tools: ['T-10'], kd: [{ doc: KD_SB, sheet: 3, zone: 'B2' }], normMin: 20 }),
    S('140.04', 'film', 'Наклеить плёнку на правую боковину', { text: ['Аналогично 140.03.'], parts: ['FILM-R'], materials: ['M-06'], tools: ['T-10'],
      kd: [{ doc: KD_SB, sheet: 3, zone: 'B4' }], normMin: 20 }),
    S('140.05', 'prep', 'Прогрев и обрезка кромок', {
      text: ['Прогреть кромки феном 60–70 °C, завернуть плёнку на торцы, обрезать припуск ножом по кромке профиля.'],
      tools: ['T-11', 'T-12'], timer: { kind: 'settle', min: MATERIALS.film.settleMin, label: 'Стабилизация клеевого слоя плёнки', blocking: true }, normMin: 15 }),
  ] },
  { id: '145', title: 'Столешница и облицовка листом', steps: [
    S('145.01', 'install', 'Облицовка столешницы листом', {
      text: ['Обезжирить верх стола и обратную сторону листа КМ2.150.100.', 'Нанести клей-герметик змейкой с шагом 80 мм, по периметру выреза под раковину — сплошным валиком.',
        'Уложить лист по базовым упорам, прикатать от центра; отбортовку завести под бортик профиля кромки стола.'],
      parts: ['SHEET-DECK'], materials: ['M-07'], tools: ['T-10'], timer: { kind: 'skin', min: MATERIALS.sealant.skinMin, label: 'Плёнкообразование клея-герметика', blocking: false },
      kd: [{ doc: KD_SB, sheet: 3, zone: 'B3' }], normMin: 25 }),
    S('145.02', 'install', 'Облицовка задней стенки (фартук)', {
      text: ['Лист КМ2.130.100 на заднюю стенку отсека оборудования на двусторонней ленте и герметике по периметру.', 'Стыки с боковинами и столом — герметик, валик Ø3 мм, разгладить.'],
      parts: ['SHEET-BS'], materials: ['M-07'], normMin: 20 }),
  ] },
  { id: '150', title: 'Электромонтаж', steps: [
    S('150.01', 'install', 'Щиток автоматов защиты', { text: ['Установить щиток КМ2.500.100 на заднюю стенку правого отсека оборудования, 4 винта М4.'],
      parts: ['CB-1'], tools: ['T-01'], kd: [{ doc: 'КМ2.500.000 Э4', sheet: 1, zone: 'B4' }], normMin: 15 }),
    S('150.02', 'wire', 'Проложить основной жгут', {
      text: ['Ввести жгут КМ2.500.000 через проходник крышки, проложить по задней стенке вниз до щитка.', 'Закрепить хомутами ХП-10 с шагом не более 250 мм.'],
      parts: ['HN-MAIN', 'HN-CB'], fasteners: ids(CLAMPS.filter((c) => /MAIN|CB/.test(c.on))), kd: [{ doc: 'КМ2.500.000 Э4', sheet: 1, zone: 'A3' }], normMin: 25 }),
    S('150.03', 'wire', 'Отводы к оборудованию и светильнику', {
      text: ['Проложить отводы к печам, кофеварке, кипятильнику и светильнику; разъёмы — у задней стенки вставок.', 'Радиус изгиба жгута — не менее 5 диаметров.'],
      parts: ['HN-OV', 'HN-BEV', 'HN-LT'], fasteners: ids(CLAMPS.filter((c) => /OV|BEV|LT/.test(c.on))), kd: [{ doc: 'КМ2.500.000 Э4', sheet: 1, zone: 'B2' }], normMin: 30 }),
    S('150.04', 'install', 'Светильники', { text: ['Светильник рабочей зоны КМ2.500.200 — под полкой, разъём Х7.', 'Светильник подсветки прохода КМ2.500.210 — на переднюю кромку крышки, разъём Х8.'],
      parts: ['LIGHT-1', 'LIGHT-2'], tools: ['T-01'], normMin: 15 }),
    S('150.05', 'check', 'Прозвонка и сопротивление изоляции', {
      text: ['Прозвонить цепи по таблице соединений.', 'Измерить сопротивление изоляции жгута мегаомметром 500 В.'],
      check: { name: 'Сопротивление изоляции (не менее)', nominal: 20, tol: 0, min: 20, unit: 'МОм' }, tools: ['T-13'], critical: true, photo: true, normMin: 20 }),
  ] },
  { id: '160', title: 'Водоснабжение, раковина, дренаж', steps: [
    S('160.01', 'wire', 'Трубопровод подвода воды', { text: ['Проложить трубопровод КМ2.700.010 в отсеке отходов и по задней стенке к кипятильнику; хомуты через 250 мм.'], parts: ['WL-1'], normMin: 20 }),
    S('160.02', 'install', 'Кран запорный и отвод к крану', { text: ['Установить шаровой кран КМ2.710.040 на трубопровод в отсеке отходов, ручкой к проходу.', 'Проложить отвод КМ2.700.030 под столом к крану питьевой воды.'],
      parts: ['VALVE-1', 'WL-2'], normMin: 15 }),
    S('160.03', 'install', 'Раковина', { text: ['Нанести герметик под борт раковины КМ2.710.010, вставить в вырез столешницы.', 'Затянуть прижимы снизу стола (4 шт.) равномерно; излишки герметика удалить.'],
      parts: ['SINK-1'], materials: ['M-07'], timer: { kind: 'skin', min: MATERIALS.sealant.skinMin, label: 'Плёнкообразование герметика раковины', blocking: false }, normMin: 20 }),
    S('160.04', 'install', 'Кран питьевой воды', { text: ['Установить кран КМ2.710.020 в отверстие столешницы за раковиной, гайку снизу — 6 Н·м.', 'Подсоединить отвод воды.'],
      parts: ['FAUCET-1'], tools: ['T-02'], normMin: 15 }),
    S('160.05', 'install', 'Сифон и дренаж', { text: ['Подсоединить сифон КМ2.710.030 к выпуску раковины, гидрозатвор вниз.', 'Трубопровод дренажа КМ2.700.020 — от сифона вниз с уклоном не менее 3°.'],
      parts: ['SIPHON-1', 'DR-1'], normMin: 20 }),
    S('160.06', 'check', 'Опрессовка подвода воды', {
      text: ['Подать давление 0,35 МПа, выдержать 10 мин. Падение давления не допускается, течи нет.'],
      check: { name: 'Падение давления', nominal: 0, tol: 0, max: 0, unit: 'МПа' }, tools: ['T-14'],
      timer: { kind: 'test', min: 10, label: 'Выдержка под давлением', blocking: true }, critical: true, normMin: 15 }),
    S('160.07', 'inspect', 'Проверка слива', { text: ['Залить в раковину 2 л воды, проверить слив и отсутствие течи сифона и соединений дренажа.'], photo: true, normMin: 10 }),
  ] },
  { id: '170', title: 'Установка оборудования', steps: [
    S('170.01', 'install', 'Печи', { text: ['Задвинуть печи по направляющим до фиксации защёлок, проверить разъём питания.'], parts: ['OVEN-1', 'OVEN-2'], normMin: 15 }),
    S('170.02', 'install', 'Кофеварка и кипятильник', { text: ['Установить вставки, подключить разъёмы и быстроразъёмные соединения воды.'], parts: ['BEV-1', 'BOIL-1'], normMin: 15 }),
    S('170.03', 'check', 'Функциональная проверка', { text: ['Подать питание со стенда 115 В 400 Гц, включить каждую вставку, проверить индикацию и светильник.'],
      tools: ['T-17'], photo: true, normMin: 20 }),
  ] },
  { id: '175', title: 'Навеска дверец', steps: [
    S('175.01', 'fasten', 'Петли на дверцы', { text: ['Установить петли КМ2.630.010 на дверцы, винты М3 во вставки дверец, 1,2 Н·м.'],
      parts: ids(HINGES), tools: ['T-01'], kd: [{ doc: KD_SB, sheet: 2, zone: 'C3' }], normMin: 20 }),
    S('175.02', 'install', 'Навесить дверцы', { text: ['Навесить дверцы верхних отсеков и дверцу отсека отходов: вторые полотна петель — на кромки перегородок и боковин.',
      'Предварительно затянуть винты, выставить зазоры.'], parts: ids(DOORS), tools: ['T-01'], normMin: 25 }),
    S('175.03', 'fasten', 'Защёлки', { text: ['Установить защёлки КМ2.640.010 и ответные скобы; проверить запирание на ¼ оборота.'], parts: ids(LATCHES), tools: ['T-01'], normMin: 15 }),
    S('175.04', 'check', 'Зазоры дверец', { text: ['Зазоры по контуру дверец 2 ± 0,5 мм, перепад плоскостей соседних дверец не более 0,5 мм.', 'Дверца открывается на 110° без касания соседней.'],
      check: { name: 'Зазор по контуру дверцы', nominal: 2, tol: 0.5, unit: 'мм' }, tools: ['T-07'], normMin: 15 }),
    S('175.05', 'install', 'Планка-ограничитель', { text: ['Установить планку КМ2.650.010 в правом отсеке оборудования, 2 винта.'], parts: ['RET-1'], normMin: 5 }),
  ] },
  { id: '180', title: 'Фурнитура и декоративные элементы', steps: [
    S('180.01', 'fasten', 'Фиксаторы тележек', { text: ['Установить поворотные фиксаторы КМ2.620.010 вверху и внизу каждого отсека, винты во вставки.'],
      parts: ids(DECOR.filter((d) => d.kind === 'turnbutton')), tools: ['T-01'], normMin: 20 }),
    S('180.02', 'install', 'Поручень', { text: ['Установить поручень КМ2.610.010 на правую боковину, 4 винта.'], parts: ['HANDLE-R'], normMin: 10 }),
    S('180.03', 'install', 'Таблички', { text: ['Наклеить таблички отсеков по схеме лист 3; ровность ±1 мм по шаблону.'],
      parts: ids(DECOR.filter((d) => d.kind === 'placard')), kd: [{ doc: KD_SB, sheet: 3, zone: 'C3' }], normMin: 10 }),
    S('180.04', 'check', 'Пробная установка тележек и контейнеров', {
      text: ['Закатить тележки во все отсеки, закрыть фиксаторы; вставить контейнеры в верхние отсеки.', 'Зазор тележка — перегородка не менее 3 мм с каждой стороны.'],
      parts: ['TRL-1', 'TRL-2', 'TRL-3', 'TRL-4', 'SU-11', 'SU-12', 'SU-21', 'SU-22', 'SU-31', 'SU-32', 'SU-41', 'SU-42'],
      check: { name: 'Зазор тележка — перегородка', nominal: 9, tol: 6, min: 3, unit: 'мм' }, normMin: 15 }),
  ] },
  { id: '190', title: 'Контроль ОТК', steps: [
    S('190.01', 'check', 'Габаритные размеры', { text: ['Ширина 1700, глубина 860, высота 2050 мм.'],
      check: { name: 'Высота модуля', nominal: 2050, tol: 1.5, unit: 'мм' }, measure: { from: [860, 0, 860], to: [860, 2050, 600] }, tools: ['T-06'], normMin: 15 }),
    S('190.02', 'inspect', 'Внешний вид', { text: ['Плёнка — без пузырей > 2 мм и складок; покрытие — без потёков и включений; профили — без зазоров.'], normMin: 15 }),
    S('190.03', 'inspect', 'Фото в журнал и предъявление ОТК', { text: ['Сфотографировать модуль спереди и с обеих сторон (команда «сборка фото»), предъявить ОТК.'],
      photo: true, critical: true, normMin: 10 }),
  ] },
];

export const STEPS = OPERATIONS.flatMap((o) => o.steps);
export const stepById = new Map(STEPS.map((s) => [s.id, s]));

/** Проверка значения по контролю шага. */
export function checkValue(check, v) {
  if (!check || !Number.isFinite(v)) return false;
  if (check.min != null && v < check.min) return false;
  if (check.max != null && v > check.max) return false;
  if (check.min != null || check.max != null) return true;
  return Math.abs(v - check.nominal) <= check.tol + 1e-9;
}

/** Состояние изделия перед шагом index: что установлено, приклеено, окрашено. */
export function stateBefore(index) {
  const st = { installed: new Set(), glued: new Set(), paint: null, film: new Set(), fastened: new Set() };
  for (const s of STEPS.slice(0, index)) applyStep(st, s);
  return st;
}

export function applyStep(st, s) {
  if (s.kind === 'install' || s.kind === 'wire') s.parts.forEach((p) => st.installed.add(p));
  if (s.kind === 'fasten') { s.parts.forEach((p) => st.installed.add(p)); s.fasteners.forEach((f) => st.fastened.add(f)); }
  if (s.kind === 'glue') s.joints.forEach((j) => st.glued.add(j));
  if (s.kind === 'paint') st.paint = s.paint;
  if (s.kind === 'film') s.parts.forEach((p) => st.film.add(p));
  if (s.id === '180.04') s.parts.forEach((p) => st.installed.add(p));
  return st;
}

/** Нормативное время по операциям, мин. */
export function normByOperation() {
  return Object.fromEntries(OPERATIONS.map((o) => [o.id, o.steps.reduce((a, s) => a + s.normMin, 0)]));
}

/** Шаги, относящиеся к элементу (детали, соединению, крепежу) — для «локального алгоритма» в точке. */
export function stepsForFeature(id) {
  return STEPS.filter((s) => s.parts.includes(id) || s.joints.includes(id) || s.fasteners.includes(id));
}

// ---------- движок исполнения с таймерами ----------
// Время «участка» идёт с ускорением (демо), таймеры — в минутах участка. Блокирующий таймер не даёт перейти дальше.
export class ProcessRun {
  constructor(steps = STEPS, startIndex = 0) {
    this.steps = steps;
    this.index = startIndex;
    this.timers = [];            // {id, step, label, kind, endMin, blocking}
    this.clockMin = 0;           // минуты участка с начала смены
    this.log = [];
    this.values = {};
    this.listeners = [];
  }

  get step() { return this.steps[this.index]; }
  on(fn) { this.listeners.push(fn); }
  emit(e) { this.listeners.forEach((fn) => fn(e, this)); this.log.push({ t: this.clockMin, ...e }); }

  /** Сдвинуть часы участка на dtMin. */
  tick(dtMin) {
    this.clockMin += dtMin;
    for (const t of this.timers) {
      if (!t.done && this.clockMin >= t.endMin) { t.done = true; this.emit({ event: 'timer_done', timer: t }); }
    }
  }

  activeTimers() { return this.timers.filter((t) => !t.done); }
  blockingTimer() { return this.timers.find((t) => !t.done && t.blocking); }

  /** Требование шага, без выполнения которого нельзя перейти дальше: 'value' | 'photo' | 'timer' | null. */
  needs() {
    const s = this.step;
    if (!s) return null;
    if (this.blockingTimer()) return 'timer';
    if (s.check && !(s.id in this.values)) return 'value';
    if (s.photo && !this.values[`${s.id}:photo`]) return 'photo';
    return null;
  }

  value(v) {
    const s = this.step;
    const ok = checkValue(s.check, v);
    if (ok) this.values[s.id] = v;
    this.emit({ event: 'value', step: s.id, value: v, ok });
    return ok;
  }

  photo() { this.values[`${this.step.id}:photo`] = true; this.emit({ event: 'photo', step: this.step.id }); }

  /** Завершить текущий шаг и перейти к следующему. Возвращает причину отказа или null. */
  next() {
    const need = this.needs();
    if (need) { this.emit({ event: 'rejected', need }); return need; }
    const s = this.step;
    this.emit({ event: 'step_done', step: s.id });
    if (s.timer && s.timer.blocking === false) this.startTimer(s);      // жизнеспособность — тикает во время работы
    if (this.index < this.steps.length - 1) {
      this.index++;
      const n = this.step;
      if (n.timer && n.timer.blocking) this.startTimer(n);              // выдержка начинается с началом шага
      this.emit({ event: 'step', step: n.id });
    } else this.emit({ event: 'done' });
    return null;
  }

  startTimer(s) {
    if (this.timers.some((t) => t.step === s.id && !t.done)) return;
    const t = { id: `${s.id}:${s.timer.kind}`, step: s.id, label: s.timer.label, kind: s.timer.kind, startMin: this.clockMin,
      endMin: this.clockMin + s.timer.min, blocking: !!s.timer.blocking, done: false };
    this.timers.push(t);
    this.emit({ event: 'timer_start', timer: t });
  }

  prev() { if (this.index > 0) { this.index--; this.emit({ event: 'step', step: this.step.id }); } }

  goto(id) {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i < 0) return false;
    this.index = i;
    if (this.step.timer?.blocking) this.startTimer(this.step);
    this.emit({ event: 'step', step: id });
    return true;
  }

  /** Остаток таймера, мин (≥ 0). */
  remaining(t) { return Math.max(0, t.endMin - this.clockMin); }
}
