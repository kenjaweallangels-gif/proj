/** Web Worker: renders foley bank entries off the main thread (see Bank.js). */
import { generate } from './foley.js';

self.onmessage = (e) => {
  const { id, name, v, sr } = e.data;
  try {
    const g = generate(name, sr, v);
    if (!g) { self.postMessage({ id, name, v, error: 'unknown' }); return; }
    self.postMessage({ id, name, v, loop: g.loop, channels: g.channels }, g.channels.map((c) => c.buffer));
  } catch (err) {
    self.postMessage({ id, name, v, error: String(err && err.message || err) });
  }
};
