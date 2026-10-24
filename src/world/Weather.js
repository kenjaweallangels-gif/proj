import * as THREE from 'three';

/**
 * CPU side of the evolving weather on the Earth (all in the Earth-fixed frame of the sphere meshes:
 * +Y north pole, +X lon 0, -Z lon 90E):
 *  - tropical cyclones of the sim date's season (October basins: NW Pacific, N Atlantic, NE Pacific, Bay of Bengal,
 *    Arabian Sea), each a deterministic sequence of storms with a genesis box, a WNW track that recurves poleward
 *    and eastward, intensification, decay over land / cold water, and an outer radius and eye from intensity;
 *  - thunderstorm cells around the station's visible cap, spawned in clusters from a convective-potential
 *    climatology (ITCZ and subtropical bands, land with an afternoon/evening maximum, oceans at night, cyclone
 *    rain bands), with a growth/decay life cycle in sim time;
 *  - lightning: per-cell Poisson flashes in real time (multi-stroke, 25 ms stroke decay + continuing current,
 *    neighbouring cells triggered for a moment), the brightest MAX_FLASH sent to the shaders;
 *  - aurora activity (slow Kp-like drift with substorm brightenings).
 * Uniform arrays are preallocated; update() does not allocate.
 */

const DEG = Math.PI / 180;
const R_KM = 6371;
const DAY = 86400;
const VIEW_CAP_DEG = 23;          // horizon from 410 km is ~20 deg; cells a little beyond are kept

// October climatology (genesis box, initial heading deg clockwise from north, translation m/s, recurvature latitude,
// peak intensity, lifetime and gap in days, age of the first storm at the epoch in days, outer cloud radius km)
const BASINS = [
  { lat: [10, 15], lon: [134, 146], heading: 292, speed: 5.5, recurve: 21, peak: 1.0, life: 9, gap: 1.5, age0: 4.3, radius: 720 },
  { lat: [13, 18], lon: [-60, -47], heading: 287, speed: 5.0, recurve: 25, peak: 0.85, life: 8, gap: 3.0, age0: 3.2, radius: 620 },
  { lat: [11, 14], lon: [-108, -99], heading: 290, speed: 4.5, recurve: 99, peak: 0.8, life: 6, gap: 2.0, age0: 2.4, radius: 520 },
  { lat: [10, 13], lon: [86, 91], heading: 318, speed: 3.6, recurve: 99, peak: 0.62, life: 4.5, gap: 4.0, age0: 1.9, radius: 480 },
  { lat: [12, 15], lon: [62, 68], heading: 300, speed: 3.0, recurve: 99, peak: 0.5, life: 5, gap: 6.0, age0: 0.9, radius: 420 },
];

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Unit vector of (lat, lon) degrees in the Earth-fixed mesh frame. */
export function latLonToObj(lat, lon, out) {
  const cl = Math.cos(lat * DEG);
  return out.set(cl * Math.cos(lon * DEG), Math.sin(lat * DEG), -cl * Math.sin(lon * DEG));
}

export class Weather {
  constructor({ maxCyclones = 6, maxCells = 24, maxFlashes = 8, seed = 7 } = {}) {
    this.maxCyclones = maxCyclones; this.maxCells = maxCells; this.maxFlashes = maxFlashes;
    this.rand = mulberry32(seed);
    this.uCyc = Array.from({ length: maxCyclones * 2 }, () => new THREE.Vector4());
    this.uCell = Array.from({ length: maxCells * 2 }, () => new THREE.Vector4());
    this.uFlash = Array.from({ length: maxFlashes * 2 }, () => new THREE.Vector4());
    this.uAurora = new THREE.Vector4(1, 1, 0, 0);
    this.cells = Array.from({ length: maxCells }, () => ({ active: false, lat: 0, lon: 0, dir: new THREE.Vector3(), radius: 20, born: 0, life: 3600, seed: 0, downwind: 1, rate: 0.2, boost: 0, potential: 0 }));
    this.flashes = Array.from({ length: 24 }, () => ({ active: false, t0: 0, n: 1, times: new Float32Array(5), peaks: new Float32Array(5), size: 10, dir: new THREE.Vector3(), I: 0 }));
    this.cyclones = [];               // current storms: { lat, lon, I, radius, eye, spin, hemi, dir }
    for (let i = 0; i < maxCyclones; i++) this.cyclones.push({ active: false, lat: 0, lon: 0, I: 0, radius: 500, eye: 25, spin: 0, dir: new THREE.Vector3() });
    this.tracks = new Map();          // `${basin}:${k}` -> Float32Array [lat, lon, I] hourly
    this.land = null; this.cloud = null; this.gridW = 0; this.gridH = 0;
    this.realTime = 0;
    this.flashLight = 0;              // sum of current flash intensities (for optional effects)
    this._spawnTimer = 0;
    this._initialised = false;
    this._v = new THREE.Vector3();
  }

  /** Low-resolution land fraction and cloud cover grids (Uint8, row 0 = north) for placement decisions. */
  setClimate(land, cloud, w, h) { this.land = land; this.cloud = cloud; this.gridW = w; this.gridH = h; }

  sample(grid, lat, lon) {
    if (!grid) return 0;
    const x = Math.floor(((lon + 180) / 360) * this.gridW) % this.gridW;
    const y = Math.min(this.gridH - 1, Math.max(0, Math.floor(((90 - lat) / 180) * this.gridH)));
    return grid[y * this.gridW + (x < 0 ? x + this.gridW : x)] / 255;
  }

  // ------------------------------------------------------------------ cyclones
  track(b, k) {
    const key = b * 1000 + k;
    let tr = this.tracks.get(key);
    if (tr) return tr;
    if (this.tracks.size > 64) this.tracks.clear();
    const B = BASINS[b];
    const rnd = mulberry32(9137 + b * 7919 + k * 104729);
    const hours = Math.ceil(B.life * 24) + 1;
    tr = new Float32Array(hours * 3);
    let lat = k === 0 ? 0.5 * (B.lat[0] + B.lat[1]) : B.lat[0] + rnd() * (B.lat[1] - B.lat[0]);
    let lon = k === 0 ? 0.5 * (B.lon[0] + B.lon[1]) : B.lon[0] + rnd() * (B.lon[1] - B.lon[0]);
    const peak = B.peak * (k === 0 ? 1 : 0.6 + 0.4 * rnd());
    const wob = rnd() * 6.28, wobRate = 0.05 + 0.05 * rnd();
    let landHours = 0;
    for (let i = 0; i < hours; i++) {
      const age = i / 24;
      const onLand = this.sample(this.land, lat, lon) > 0.5;
      if (onLand) landHours++;
      let I = peak * smooth(0, 0.35 * B.life, age) * (1 - smooth(0.72 * B.life, B.life, age));
      I *= Math.exp(-landHours / 16) * (1 - 0.75 * smooth(27, 40, Math.abs(lat)));
      tr[i * 3] = lat; tr[i * 3 + 1] = lon; tr[i * 3 + 2] = I;
      // motion: WNW steering, poleward turn toward the recurvature latitude, then NE and faster
      let hd = B.heading + 10 * Math.sin(wob + i * wobRate);
      let sp = B.speed;
      if (B.recurve < 90) {
        hd += (360 - B.heading) * smooth(B.recurve - 9, B.recurve, lat) + 45 * smooth(B.recurve, B.recurve + 7, lat);
        sp *= 1 + 1.2 * smooth(B.recurve, B.recurve + 12, lat);
      } else {
        hd += 15 * smooth(14, 22, lat);
      }
      const d = sp * 3.6;                     // km per hour
      lat += (d * Math.cos(hd * DEG)) / 111.2;
      lon += (d * Math.sin(hd * DEG)) / (111.2 * Math.max(0.2, Math.cos(lat * DEG)));
      if (lon > 180) lon -= 360; if (lon < -180) lon += 360;
    }
    this.tracks.set(key, tr);
    return tr;
  }

  updateCyclones(simT) {
    let n = 0;
    for (let b = 0; b < BASINS.length && n < this.maxCyclones; b++) {
      const B = BASINS[b];
      const cycle = (B.life + B.gap) * DAY;
      const since = simT + B.age0 * DAY;
      if (since < 0) continue;
      const k = Math.floor(since / cycle);
      const age = since - k * cycle;
      if (age > B.life * DAY) continue;
      const tr = this.track(b, k);
      const fh = age / 3600, i0 = Math.min(Math.floor(fh), tr.length / 3 - 2), f = Math.min(1, fh - i0);
      const lat = tr[i0 * 3] + (tr[i0 * 3 + 3] - tr[i0 * 3]) * f;
      let dl = tr[i0 * 3 + 4] - tr[i0 * 3 + 1]; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
      const lon = tr[i0 * 3 + 1] + dl * f;
      const I = tr[i0 * 3 + 2] + (tr[i0 * 3 + 5] - tr[i0 * 3 + 2]) * f;
      if (I < 0.03) continue;
      const c = this.cyclones[n++];
      c.active = true; c.lat = lat; c.lon = lon; c.I = I;
      c.radius = B.radius * (0.55 + 0.45 * Math.min(1, I * 1.3));
      c.eye = 34 - 22 * I;
      c.hemi = lat >= 0 ? 1 : -1;
      c.spin = ((simT / (9 * 3600)) * 2 * Math.PI + b * 1.7) % (2 * Math.PI);
      latLonToObj(lat, lon, c.dir);
    }
    for (let i = n; i < this.maxCyclones; i++) this.cyclones[i].active = false;
  }

  // ------------------------------------------------------------------ convective potential and cells
  localHour(lon, utcHours) { return (((utcHours + lon / 15) % 24) + 24) % 24; }

  /** Thunderstorm potential 0..~2 at (lat, lon) for the given UTC hour. */
  potential(lat, lon, utcH) {
    const land = this.sample(this.land, lat, lon);
    const cloud = this.sample(this.cloud, lat, lon);
    const lst = this.localHour(lon, utcH);
    const afternoon = Math.exp(-(((lst - 16.5) / 3.2) ** 2)) + 0.35 * Math.exp(-(((lst - 21) / 3) ** 2));
    let dn = Math.abs(lst - 3.5); if (dn > 12) dn = 24 - dn;
    const night = Math.exp(-((dn / 4.5) ** 2));
    const zone = Math.exp(-(((lat - 6) / 11) ** 2)) + 0.45 * Math.exp(-(((Math.abs(lat) - 27) / 8) ** 2)) + 0.08;
    const humid = smooth(0.08, 0.45, cloud);
    let p = zone * humid * (land * (0.15 + 1.6 * afternoon) + (1 - land) * (0.25 + 0.3 * night));
    for (const c of this.cyclones) {
      if (!c.active) continue;
      const v = latLonToObj(lat, lon, this._v);
      const dKm = Math.acos(Math.min(1, v.dot(c.dir))) * R_KM;
      if (dKm < c.radius) p += 1.8 * c.I * (Math.exp(-(((dKm - c.eye * 1.5) / 40) ** 2)) + 0.5 * smooth(c.radius, c.radius * 0.3, dKm));
    }
    return p;
  }

  spawnCluster(lat, lon, simT, utcH, mature, subDir) {
    const rnd = this.rand;
    const n = 1 + Math.floor(rnd() * rnd() * 4);
    const p = this.potential(lat, lon, utcH);
    for (let j = 0; j < n; j++) {
      const cell = this.freeCell();
      if (!cell) return;
      const az = rnd() * 2 * Math.PI, dist = j === 0 ? 0 : 40 + rnd() * 110;
      cell.lat = lat + (dist * Math.cos(az)) / 111.2;
      cell.lon = lon + (dist * Math.sin(az)) / (111.2 * Math.max(0.2, Math.cos(lat * DEG)));
      latLonToObj(cell.lat, cell.lon, cell.dir);
      if (subDir && Math.acos(Math.min(1, cell.dir.dot(subDir))) > VIEW_CAP_DEG * DEG) continue;
      cell.active = true;
      cell.radius = 14 + rnd() * 22 + 18 * Math.min(1, p * 0.5) * rnd();
      cell.life = (40 + rnd() * 70) * 60;
      cell.born = mature ? simT - rnd() * cell.life * 0.8 : simT;
      cell.seed = rnd() * 50;
      cell.downwind = Math.abs(cell.lat) < 25 ? -1 : 1;    // anvils blow west under the tropical easterlies
      cell.rate = (0.05 + 0.4 * rnd() * rnd()) * Math.min(1.6, 0.5 + p) * (cell.radius / 28);
      cell.boost = 0;
      cell.potential = p;
    }
  }

  freeCell() {
    for (const c of this.cells) if (!c.active) return c;
    return null;
  }

  activeCells() {
    let n = 0;
    for (const c of this.cells) if (c.active) n++;
    return n;
  }

  updateCells(simT, utcH, subLat, subLon, dtSim) {
    const rnd = this.rand;
    const sub = latLonToObj(subLat, subLon, this._sub || (this._sub = new THREE.Vector3()));
    // a jump of the viewpoint (time set from outside): repopulate the view with mature cells
    if (this._lastSub && this._lastSub.dot(sub) < Math.cos(5 * DEG)) this._initialised = false;
    (this._lastSub || (this._lastSub = new THREE.Vector3())).copy(sub);
    const cosCap = Math.cos((VIEW_CAP_DEG + 3) * DEG);
    let active = 0;
    for (const c of this.cells) {
      if (!c.active) continue;
      if (simT - c.born > c.life || c.dir.dot(sub) < cosCap || simT < c.born - 60) { c.active = false; continue; }
      active++;
    }
    // spawn: rejection-sample the convective potential inside the visible cap (more tries on the first frame)
    const tries = this._initialised ? Math.min(6, Math.ceil(Math.abs(dtSim) / 20) + 1) : 400;
    const e = this._e || (this._e = new THREE.Vector3()), nrt = this._nrt || (this._nrt = new THREE.Vector3());
    e.set(0, 1, 0).cross(sub); if (e.lengthSq() < 1e-8) e.set(1, 0, 0); e.normalize();
    nrt.copy(sub).cross(e);
    for (let i = 0; i < tries && active < this.maxCells; i++) {
      const ang = Math.acos(1 - rnd() * (1 - Math.cos(VIEW_CAP_DEG * DEG)));
      const az = rnd() * 2 * Math.PI;
      const s = Math.sin(ang);
      const v = this._v.copy(sub).multiplyScalar(Math.cos(ang)).addScaledVector(e, s * Math.cos(az)).addScaledVector(nrt, s * Math.sin(az));
      const lat = Math.asin(v.y) / DEG, lon = Math.atan2(-v.z, v.x) / DEG;
      const p = this.potential(lat, lon, utcH);
      if (rnd() * 2.2 > p) continue;
      // new cells near the horizon arrive mature (they rise over it); in the middle of the view they start young
      this.spawnCluster(lat, lon, simT, utcH, !this._initialised || ang > 15 * DEG, sub);
      active = this.activeCells();
    }
    this._initialised = true;
  }

  // ------------------------------------------------------------------ lightning
  triggerFlash(cell) {
    let f = null;
    for (const x of this.flashes) if (!x.active) { f = x; break; }
    if (!f) return;
    const rnd = this.rand;
    f.active = true; f.t0 = this.realTime;
    f.n = 1 + Math.floor(rnd() * rnd() * 4.99);
    let t = 0;
    for (let k = 0; k < f.n; k++) {
      f.times[k] = t; f.peaks[k] = (k === 0 ? 1 : 0.45 + 0.4 * rnd()) * (0.4 + 1.0 * rnd());
      t += 0.03 + rnd() * 0.09;
    }
    f.size = 6 + rnd() * 12;
    const az = rnd() * 2 * Math.PI, d = rnd() * cell.radius * 0.7;
    const lat = cell.lat + (d * Math.cos(az)) / 111.2;
    const lon = cell.lon + (d * Math.sin(az)) / (111.2 * Math.max(0.2, Math.cos(cell.lat * DEG)));
    latLonToObj(lat, lon, f.dir);
    // nearby cells are often triggered within a fraction of a second (storm complexes flash together)
    for (const c of this.cells) if (c.active && c !== cell && c.dir.dot(cell.dir) > Math.cos(220 / R_KM)) c.boost = Math.min(c.boost + 4, 10);
  }

  updateLightning(dtReal, simT) {
    this.realTime += dtReal;
    const rnd = this.rand;
    for (const c of this.cells) {
      if (!c.active) continue;
      const age = simT - c.born;
      const m = smooth(0, 0.3 * c.life, age) * (1 - smooth(0.7 * c.life, c.life, age));
      c.boost *= Math.exp(-dtReal / 0.7);
      const rate = c.rate * m * (1 + c.boost);
      if (dtReal > 0 && rnd() < rate * dtReal) this.triggerFlash(c);
    }
    let total = 0;
    for (const f of this.flashes) {
      if (!f.active) continue;
      const t = this.realTime - f.t0;
      let I = 0;
      for (let k = 0; k < f.n; k++) {
        const s = t - f.times[k];
        if (s >= 0) I += f.peaks[k] * (Math.exp(-s / 0.025) + 0.22 * Math.exp(-s / 0.11));
      }
      // flicker within the continuing current
      I *= 0.85 + 0.3 * rnd();
      f.I = I;
      if (t > f.times[f.n - 1] + 0.6) { f.active = false; f.I = 0; }
      total += f.I;
    }
    this.flashLight = total;
  }

  /** Debug / screenshots: start `n` flashes now in random active cells. */
  forceFlashes(n = 4) {
    let active = 0;
    for (const c of this.cells) if (c.active) active++;
    if (!active) return 0;
    let k = 0;
    for (let i = 0; i < n * 4 && k < n; i++) {
      const c = this.cells[Math.floor(this.rand() * this.cells.length)];
      if (c.active) { this.triggerFlash(c); k++; }
    }
    return k;
  }

  // ------------------------------------------------------------------ per frame
  /**
   * @param simT sim seconds since the epoch, date = civil Date of simT, dtSim / dtReal = frame steps
   */
  update(simT, date, subLat, subLon, dtSim, dtReal, flashScale = 1) {
    const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    this.updateCyclones(simT);
    this.updateCells(simT, utcH, subLat, subLon, dtSim);
    this.updateLightning(dtReal, simT);
    // uniforms: cyclones
    for (let i = 0; i < this.maxCyclones; i++) {
      const c = this.cyclones[i], A = this.uCyc[i * 2], B = this.uCyc[i * 2 + 1];
      if (!c.active) { B.set(0, 0, 0, 0); continue; }
      A.set(c.dir.x, c.dir.y, c.dir.z, c.radius);
      B.set(c.I, c.hemi, c.eye, c.spin);
    }
    // cells
    let n = 0;
    for (const c of this.cells) {
      if (!c.active || n >= this.maxCells) continue;
      const age = simT - c.born;
      const m = smooth(0, 0.25 * c.life, age) * (1 - smooth(0.8 * c.life, c.life, age));
      if (m <= 0.01) continue;
      this.uCell[n * 2].set(c.dir.x, c.dir.y, c.dir.z, c.radius);
      this.uCell[n * 2 + 1].set(m, c.seed, c.downwind, 0);
      n++;
    }
    for (let i = n; i < this.maxCells; i++) this.uCell[i * 2 + 1].set(0, 0, 0, 0);
    // flashes: the brightest ones
    for (let i = 0; i < this.maxFlashes; i++) this.uFlash[i * 2].w = 0;
    for (const f of this.flashes) {
      if (!f.active || f.I <= 0.01) continue;
      let slot = -1, minI = Infinity;
      for (let i = 0; i < this.maxFlashes; i++) { const w = this.uFlash[i * 2].w; if (w < minI) { minI = w; slot = i; } }
      if (f.I * flashScale > minI) {
        this.uFlash[slot * 2].set(f.dir.x, f.dir.y, f.dir.z, f.I * flashScale);
        this.uFlash[slot * 2 + 1].set(f.size, 0, 0, 0);
      }
    }
    // aurora: slow activity drift + substorm brightenings every ~3 h (sim time); curtains move in real time
    const kp = 2.6 + 1.2 * Math.sin(simT / (7.3 * 3600) + 1.1);
    const ph = (simT / (3.1 * 3600) + 0.35) % 1;
    const sub = Math.exp(-(((ph - 0.5) / 0.07) ** 2));
    const s = (0.45 + 0.25 * (kp - 2)) * (1 + 2.2 * sub);
    this.uAurora.set(s, s * 0.9, this.realTime % 20000, 0.7 * (kp - 3) + 1.2 * sub);
  }
}
