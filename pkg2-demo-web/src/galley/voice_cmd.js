// Голосовые команды сборщика КМ-2. Фраза начинается со слова «сборка» (или «окей сборка»), дальше — команда.
// Без слова активации команда принимается только в режиме «слушаю» (кнопка/жест) — так речь в цеху
// не перелистывает переходы. Числа — цифрами (как отдаёт распознаватель) или словами: «тысяча сто пять»,
// «один и шесть десятых», «три и две». Чертёжный номер: «найди ка эм два сто пятьдесят» → КМ2.150.
// Тот же разбор — для голосовой строки, планшета и распознавания речи в браузере.

export const WAKE = ['сборка', 'окей сборка', 'ок сборка'];

const UNITS = {
  ноль: 0, нуль: 0, один: 1, одна: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9,
  десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17,
  восемнадцать: 18, девятнадцать: 19, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70,
  восемьдесят: 80, девяносто: 90, сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600,
  семьсот: 700, восемьсот: 800, девятьсот: 900, полтора: 1.5, полторы: 1.5,
};
const THOUSAND = /^тысяч[аиу]?$/;
const POINT = new Set(['и', 'точка', 'запятая', 'целых', 'целая']);
const FRAC = { десятых: 10, десятая: 10, сотых: 100, сотая: 100 };

/** Число из слов (или цифр). Возвращает null, если чисел нет. */
export function parseNumber(words) {
  const joined = words.join(' ');
  const m = joined.match(/-?\d+(?:[.,]\d+)?/);
  if (m) return parseFloat(m[0].replace(',', '.'));
  let whole = 0, part = 0, frac = 0, fracDigits = '', inFrac = false, seen = false, div = 0;
  for (const w of words) {
    if (POINT.has(w) && seen) { inFrac = true; continue; }
    if (FRAC[w] && inFrac) { div = FRAC[w]; continue; }
    if (THOUSAND.test(w)) { part = (part || 1) * 1000; whole += part; part = 0; seen = true; continue; }
    if (w in UNITS) {
      seen = true;
      if (inFrac) { frac += UNITS[w]; fracDigits += String(UNITS[w]); } else part += UNITS[w];
    }
  }
  if (!seen) return null;
  whole += part;
  if (!inFrac) return whole;
  return div ? whole + frac / div : parseFloat(`${whole}.${fracDigits || 0}`);
}

const LETTERS = { ка: 'К', эм: 'М', км: 'КМ', тэ: 'Т', пэ: 'П', сб: 'СБ', эс: 'С', бэ: 'Б' };
/** «ка эм два сто пятьдесят ноль ноль ноль» / «км 2 150 000» → «КМ2.150.000» (по группам из трёх цифр). */
export function parseCode(words) {
  let prefix = '';
  const nums = [];
  let i = 0;
  while (i < words.length && (LETTERS[words[i]] || /^[a-zа-я]{1,3}$/i.test(words[i]) && /км|kм|km/i.test(words[i]))) { prefix += LETTERS[words[i]] || words[i].toUpperCase(); i++; }
  if (!prefix) return null;
  const rest = words.slice(i);
  // группы: число цифрами или словами; «ноль» — отдельная цифра
  let buf = [];
  const flush = () => { if (buf.length) { const n = parseNumber(buf); if (n != null) nums.push(String(n)); buf = []; } };
  for (const w of rest) {
    if (/^\d+$/.test(w)) { flush(); nums.push(w); continue; }
    if (w === 'ноль' || w === 'нуль') { flush(); nums.push('0'); continue; }
    if (w in UNITS || THOUSAND.test(w)) { if (buf.length && UNITS[w] >= 100) flush(); buf.push(w); } else flush();
  }
  flush();
  if (!nums.length) return prefix.replace('KM', 'КМ');
  const digits = nums.join('');
  const head = digits[0], tail = digits.slice(1);
  const groups = tail.match(/.{1,3}/g) || [];
  return `${prefix.replace('KM', 'КМ')}${head}${groups.length ? `.${groups.join('.')}` : ''}`;
}

// команды: [ключ, синонимы (начало фразы после слова активации)]
export const GRAMMAR = [
  ['auto_stop', ['останови имитацию', 'стоп имитация', 'останови сборку', 'выключи имитацию']],
  ['auto_start', ['запусти сборку', 'запусти имитацию', 'начни сборку', 'имитация', 'автосборка', 'собирай', 'продолжи', 'продолжай']],
  ['auto_pause', ['пауза', 'подожди', 'постой']],
  ['auto_free', ['хожу сам', 'сам хожу', 'свободно', 'свободный режим', 'свободное движение']],
  ['auto_guide', ['веди меня', 'камера ведет', 'веди']],
  ['corner', ['алгоритм в угол', 'алгоритм в углу', 'окно в угол', 'в угол', 'алгоритм']],
  ['recenter', ['по центру', 'центр', 'выровняй окна', 'окна передо мной']],
  ['device', ['очки', 'профиль очков', 'переключи очки']],
  ['next', ['дальше', 'далее', 'выполнено', 'готово', 'следующий переход', 'следующий шаг', 'вперед']],
  ['prev', ['назад', 'предыдущий', 'вернись']],
  ['repeat', ['повтори', 'еще раз', 'прочитай', 'что делать']],
  ['photo', ['фото', 'снимок', 'сфотографируй']],
  ['timer', ['сколько осталось', 'таймер', 'время']],
  ['kd_next', ['следующий лист', 'лист дальше']],
  ['kd_prev', ['предыдущий лист', 'лист назад']],
  ['kd_sheet', ['лист']],
  ['zoom_in', ['увеличь', 'крупнее', 'приблизь']],
  ['zoom_out', ['уменьши', 'мельче', 'отдали']],
  ['kd_fit', ['вписать', 'весь лист', 'целиком']],
  ['kd_zone', ['зона']],
  ['overlay', ['контур', 'наложи чертеж', 'наложи чертёж']],
  ['open_kd', ['покажи кд', 'покажи чертеж', 'открой кд', 'открой чертеж', 'чертеж', 'кд']],
  ['open_task', ['открой задание', 'покажи задание', 'задание']],
  ['open_chat', ['открой чат', 'покажи чат', 'чат']],
  ['open_system', ['открой систему', 'система', 'техпроцесс', 'покажи тп']],
  ['open_step', ['покажи переход', 'переход']],
  ['close', ['закрой', 'убери', 'скрой']],
  ['search', ['найди', 'поиск', 'открой документ']],
  ['inspect', ['осмотр', 'что здесь', 'что тут', 'покажи здесь']],
  ['exit', ['выход', 'выйти', 'к стапелю']],
  ['dim_more', ['темнее', 'затемни', 'затемнение больше']],
  ['dim_less', ['светлее', 'затемнение меньше', 'убери затемнение']],
  ['dim_auto', ['затемнение авто', 'авто затемнение', 'автозатемнение']],
  ['bright_up', ['ярче', 'яркость больше']],
  ['bright_down', ['тусклее', 'яркость меньше']],
  ['pin', ['закрепи', 'закрепить окно']],
  ['follow', ['за мной', 'следуй', 'окно за мной']],
  ['call', ['вызови мастера', 'позови мастера', 'мастера к стапелю', 'вызов мастера']],
  ['message', ['сообщение', 'напиши мастеру', 'передай мастеру']],
  ['ok', ['норма', 'годно', 'в допуске']],
  ['reject', ['брак', 'не годно', 'негодно']],
  ['value', ['значение', 'замер', 'размер', 'момент', 'введи']],
  ['help', ['помощь', 'что сказать', 'команды']],
  ['stop', ['стоп', 'хватит', 'не слушай']],
];

const PANEL_WORDS = { кд: 'kd', чертеж: 'kd', задание: 'task', чат: 'task', систему: 'system', система: 'system', переход: 'step', окно: 'local', осмотр: 'local' };

export function normalize(text) {
  return String(text || '').toLowerCase().replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}\s,.-]/gu, ' ')
    .replace(/(?<!\d)[,.]|[,.](?!\d)/g, ' ')
    .replace(/(\d)\s*-\s*(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Фраза → {cmd, arg} или null. requireWake — требовать слово «сборка».
 * arg: число (значение, лист), строка (зона, текст сообщения, код документа), имя окна.
 */
export function parseGalley(text, { requireWake = true } = {}) {
  let t = normalize(text);
  const wake = WAKE.find((w) => t === w || t.startsWith(`${w} `));
  if (requireWake && !wake) return null;
  if (wake) t = t.slice(wake.length).trim();
  if (!t) return { cmd: 'listen', arg: null };
  const words = t.split(' ');
  for (const [cmd, syns] of GRAMMAR) {
    for (const s of [...syns].sort((a, b) => b.length - a.length)) {
      if (t === s || t.startsWith(`${s} `)) {
        const rest = t.slice(s.length).trim();
        const rw = rest ? rest.split(' ') : [];
        switch (cmd) {
          case 'kd_sheet': { const n = parseNumber(rw); return n != null ? { cmd, arg: n } : { cmd: 'open_kd', arg: null }; }
          case 'kd_zone': { const m = rest.match(/^([абвгabcd])\s*(\d|один|два|три|четыре|пять|шесть|семь|восемь)/); if (!m) return null;
            const L = { а: 'A', б: 'B', в: 'C', г: 'D', a: 'A', b: 'B', c: 'C', d: 'D' }[m[1]]; return { cmd, arg: `${L}${parseNumber([m[2]])}` }; }
          case 'search': { const code = parseCode(rw); return { cmd, arg: code || rest }; }
          case 'close': return { cmd, arg: PANEL_WORDS[rw[0]] || null };
          case 'message': return { cmd, arg: rest };
          case 'value': { const n = parseNumber(rw); return n != null ? { cmd, arg: n } : null; }
          case 'device': return rest ? { cmd, arg: rest } : { cmd, arg: 1 };
          default: return { cmd, arg: null };
        }
      }
    }
  }
  const n = parseNumber(words);
  if (n != null) return { cmd: 'value', arg: n };
  return null;
}

/** Подсказка: что можно сказать. */
export const PHRASES = [
  'сборка дальше', 'сборка назад', 'сборка повтори', 'сборка фото', 'сборка значение тысяча сто пять',
  'сборка запусти сборку', 'сборка хожу сам', 'сборка алгоритм в угол', 'сборка пауза', 'сборка очки иксреал аура', 'сборка по центру', 'сборка покажи кд', 'сборка лист два', 'сборка зона б три', 'сборка увеличь', 'сборка вписать',
  'сборка найди ка эм два сто пятьдесят', 'сборка открой задание', 'сборка сколько осталось', 'сборка осмотр', 'сборка выход',
  'сборка темнее', 'сборка затемнение авто', 'сборка ярче', 'сборка закрепи', 'сборка вызови мастера', 'сборка сообщение нет винтов М4',
];

/** Распознавание речи браузера (Web Speech API, облако производителя браузера — только для показа; на очках — Vosk офлайн). */
export function createRecognizer({ onPhrase, onInterim = () => {}, onState = () => {} }) {
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = 'ru-RU'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 3;
  let on = false;
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) onPhrase([...r].map((a) => a.transcript));
      else onInterim(r[0].transcript);
    }
  };
  rec.onerror = (e) => { onState({ on, error: e.error }); if (e.error === 'not-allowed' || e.error === 'service-not-allowed') on = false; };
  rec.onend = () => { if (on) { try { rec.start(); } catch { on = false; onState({ on }); } } else onState({ on }); };
  return {
    start() { on = true; try { rec.start(); } catch { /* уже запущен */ } onState({ on }); },
    stop() { on = false; rec.stop(); onState({ on }); },
    get active() { return on; },
  };
}

/** Озвучка ответа (синтез речи браузера). */
export function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ru-RU'; u.rate = 1.05;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch { /* нет синтеза */ }
}
