// CSV (Content/Rakis/Data — источник правды и для UE) → src/data/data.js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', '..', 'Content', 'Rakis', 'Data');
const OUT = join(here, '..', 'src', 'data', 'data.js');

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}
const num = (v) => (v === '' || v == null ? 0 : Number(v));
const color = (v) => {
  const m = /R=([\d.]+),G=([\d.]+),B=([\d.]+)/.exec(v || '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [1, 1, 1];
};
const load = (name) => {
  const p = join(SRC, `${name}.csv`);
  if (!existsSync(p)) { console.warn(`нет ${p}`); return []; }
  return parseCSV(readFileSync(p, 'utf8'));
};

const data = {
  Dialogue: Object.fromEntries(load('Dialogue_S1').map((r) => [r.DialogueID, {
    id: r.DialogueID, speaker: r.Speaker, RU: r.Line_RU, EN: r.Line_EN, condition: r.Condition,
    emotion: r.Emotion, duration: num(r.Duration), next: r.NextID,
  }])),
  Barks: load('Barks').map((r) => ({ id: r.BarkID, archetype: r.Archetype, context: r.Context, RU: r.Line_RU, EN: r.Line_EN, weight: num(r.Weight) || 1, cooldown: num(r.Cooldown) })),
  StoryBeats: load('StoryBeats').map((r) => ({ id: r.BeatID, order: num(r.Order), trigger: r.Trigger, action: r.Action, param: r.Param, delay: num(r.Delay) })).sort((a, b) => a.order - b.order),
  WeatherPresets: Object.fromEntries(load('WeatherPresets').map((r) => [r.PresetID, {
    id: r.PresetID, hours: num(r.TimeOfDayHours), sunLux: num(r.SunIntensityLux), sunColor: color(r.SunColor),
    sky: num(r.SkyLightIntensity), fogDensity: num(r.FogDensity), fogFalloff: num(r.FogHeightFalloff),
    fogColor: color(r.FogInscatterColor), volFog: num(r.VolumetricFogScattering), dust: num(r.DustDensity),
    wind: num(r.WindSpeed), windYaw: num(r.WindDirectionYaw), storm: num(r.StormIntensity), haze: num(r.HeatHaze),
    exposure: num(r.ExposureBias), clouds: num(r.CloudCoverage),
  }])),
  CrowdArchetypes: load('CrowdArchetypes').map((r) => ({ id: r.Archetype, RU: r.DisplayName_RU, EN: r.DisplayName_EN, walkSpeed: num(r.WalkSpeed) / 100, tags: (r.SmartObjectTags || '').split(';').filter(Boolean), palette: (r.ClothPalette || '').split(';').filter(Boolean), weight: num(r.SpawnWeight) || 1, age: r.AgeGroup })),
  AudioEvents: load('AudioEvents').map((r) => ({ id: r.EventID, trigger: r.Trigger, bus: r.Bus, volume: num(r.Volume) || 1 })),
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `// Сгенерировано tools/build_data.mjs из Content/Rakis/Data/*.csv — не править вручную.\nexport default ${JSON.stringify(data)};\n`);
console.log(`data.js: ${Object.keys(data.Dialogue).length} реплик, ${data.Barks.length} лаев, ${data.StoryBeats.length} битов, ${Object.keys(data.WeatherPresets).length} пресетов`);
