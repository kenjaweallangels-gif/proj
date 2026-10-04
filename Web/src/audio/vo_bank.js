// Банк озвучки: реплики и лай толпы, собранные Tools/tts/piper_build.py (Piper, голос на персонажа → Opus) и встроенные в assets/vo.js как data-URI.
// Декодирование ленивое (decodeAudioData) с небольшим LRU-кэшем: весь банк в PCM занял бы ~90 МБ.
// API: has(id), duration(id) — длительность из файла (с), decode(ctx, id) → Promise<AudioBuffer|null>, peek(id), barkCount(arch), barkPick(arch) → {key, uri, d}.
import { VO, VO_DUR, BARKS } from '../assets/vo.js';

const MAX = 36;
const cache = new Map();      // key → AudioBuffer (порядок вставки = LRU)
const pending = new Map();    // key → Promise
const failed = new Set();

function bytes(uri) {
  const bin = atob(uri.slice(uri.indexOf(',') + 1));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

function decodeUri(ctx, key, uri) {
  if (cache.has(key)) { const b = cache.get(key); cache.delete(key); cache.set(key, b); return Promise.resolve(b); }
  if (failed.has(key)) return Promise.resolve(null);
  if (pending.has(key)) return pending.get(key);
  const p = new Promise((resolve) => {
    try {
      const r = ctx.decodeAudioData(bytes(uri), (buf) => resolve(buf), () => resolve(null));
      if (r && typeof r.then === 'function') r.then(resolve, () => resolve(null));
    } catch { resolve(null); }
  }).then((buf) => {
    pending.delete(key);
    if (!buf) { failed.add(key); return null; }
    cache.set(key, buf);
    while (cache.size > MAX) cache.delete(cache.keys().next().value);
    return buf;
  });
  pending.set(key, p);
  return p;
}

export const has = (id) => !!VO[id];
export const duration = (id) => VO_DUR[id] || 0;
export const peek = (id) => cache.get(id) || null;
export const count = () => Object.keys(VO).length;
export const decode = (ctx, id) => (VO[id] ? decodeUri(ctx, id, VO[id]) : Promise.resolve(null));
export const barkCount = (arch) => (BARKS[arch] || []).length;
export function barkPick(arch, avoid = -1) {
  const list = BARKS[arch] || BARKS.Elder || [];
  if (!list.length) return null;
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === avoid) i = (i + 1) % list.length;
  return { key: `bark:${arch}:${i}`, idx: i, uri: list[i].u, d: list[i].d };
}
export const decodeBark = (ctx, pick) => (pick ? decodeUri(ctx, pick.key, pick.uri) : Promise.resolve(null));
