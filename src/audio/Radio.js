/**
 * Radio and public address. In the suit, transmissions arrive in the headset with quindar tones (2525 Hz in,
 * 2475 Hz out), band-limited and slightly saturated; without the suit they come over the station loudspeakers
 * (PA chime, then the voice in the room acoustics). The voices are synthetic pseudo-speech (foley
 * 'radio_babble'); the words appear as subtitles in the HUD. Phrases are short and invented.
 */
const EVA_PHRASES = [
  'ЦУП: «Аврора», связь устойчивая, продолжайте.',
  'ЦУП: Пульс в норме. Работайте спокойно.',
  'ЦУП: Проверьте карабин страховочного фала.',
  'Houston: Aurora, copy. You are go for translation.',
  'ЦУП: Телеметрия скафандра в норме.',
  'Houston: Nice and easy, take your time.',
  'ЦУП: Не торопитесь, запас по кислороду хороший.',
  'Houston: We have you on the external camera.',
];
const STATION_PHRASES = [
  'ЦУП: «Аврора», доброе утро. План дня — на борту.',
  'Борт: Экипажу — плановая проверка системы жизнеобеспечения.',
  'Houston: Aurora, cabin pressure looks nominal.',
  'ЦУП: Следующий сеанс связи через сорок минут.',
  'Борт: Напоминание — сеанс физкультуры в спортзале кольца.',
  'Houston: Copy your downlink, good data.',
  'ЦУП: Принято, «Аврора». Хорошего дня.',
];
const AIRLOCK_PHRASES = [
  'ЦУП: Видим сброс давления, всё штатно.',
  'Houston: Aurora, suit check complete, looking good.',
];

export class Radio {
  constructor(engine, ctx, onDuck) {
    this.e = engine; this.ctx = ctx;
    this.onDuck = onDuck;
    this.hiss = engine.loop('radio_hiss', 'radio', { gain: 0.0002 });   // runs silently; gated per transmission below
    this.timer = 25 + Math.random() * 30;
    this.level = 1;
    this.busyUntil = 0;
    this.last = -1;
  }

  /** Transmit: text (subtitle; null = none), voice 0..7 (babble variant), headset or PA decided by the helmet. */
  say(text = null, { helmet = 0, voice = null, short = false, chime = true } = {}) {
    const e = this.e, now = e.now();
    if (now < this.busyUntil || this.level <= 0) return 0;
    const v = voice ?? Math.floor(Math.random() * 8);
    const buf = e.bank.get('radio_babble', v, true);
    if (!buf) return 0;
    const rate = short ? 1.15 : 0.97 + Math.random() * 0.08;
    const len = buf.duration / rate;
    const lvl = this.level;
    let t;
    if (helmet > 0.5) {
      e.shot('quindar_in', { path: 'radio', gain: 0.35 * lvl, jitter: 0, prio: 1 });
      e.shot('radio_babble', { path: 'radio', v, gain: 0.9 * lvl, rate, jitter: 0, at: 0.32, prio: 1 });
      e.shot('quindar_out', { path: 'radio', gain: 0.35 * lvl, jitter: 0, at: 0.38 + len, prio: 1 });
      t = 0.7 + len;
      const hg = this.hiss.g.gain;
      hg.cancelScheduledValues(now); hg.setTargetAtTime(0.035 * lvl, now + 0.25, 0.03); hg.setTargetAtTime(0.0002, now + t, 0.06);
    } else {
      if (chime) e.shot('pa_chime', { path: 'pa', gain: 0.4 * lvl, jitter: 0, prio: 1 });
      e.shot('radio_babble', { path: 'pa', v, gain: 0.75 * lvl, rate, jitter: 0, at: chime ? 1.25 : 0.05, prio: 1 });
      t = (chime ? 1.3 : 0.1) + len;
    }
    this.busyUntil = now + t + 0.5;
    this.onDuck?.(t + 0.3);
    if (text) this.ctx.hud?.notify?.(text, { kind: 'radio' });
    return t;
  }

  pick(list) { let i = Math.floor(Math.random() * list.length); if (i === this.last) i = (i + 1) % list.length; this.last = i; return list[i]; }

  /** Ambient traffic: EVA chatter every ~1-2 min in the suit, ground / crew calls every few minutes inside. */
  update(dt, st, helmet, active) {
    this.timer -= dt;
    if (this.timer > 0 || !active) return;
    if (st.mode === 'eva') { this.say(this.pick(EVA_PHRASES), { helmet }); this.timer = 55 + Math.random() * 70; }
    else if (st.mode === 'airlock') { this.say(this.pick(AIRLOCK_PHRASES), { helmet }); this.timer = 70 + Math.random() * 60; }
    else { this.say(this.pick(STATION_PHRASES), { helmet }); this.timer = 160 + Math.random() * 200; }
  }
}
