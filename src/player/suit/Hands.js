import * as THREE from 'three';
import { HAND, FINGERS } from './Rig.js';
import { sstep, V3 } from './Geo.js';

/**
 * Hands: palm + five articulated fingers (three phalanges each, thumb with its metacarpal), skinned to the
 * hand / finger bones with smooth blends at the knuckles. Used bare (crew: skin, knuckle bumps, nails,
 * creases) and gloved (suit: fabric back, rubber palm and finger pads, fingertip caps, knuckle bar,
 * back-of-hand strap). Bind pose: the hand hangs down, palm toward the body's midline, thumb forward.
 */

const X = V3(1, 0, 0), Y = V3(0, 1, 0), Z = V3(0, 0, 1);

/** Finger joint layout of one hand (side s = +1 left / -1 right) from the rig joints. */
function fingerFrames(J, s) {
  const S = s > 0 ? 'L' : 'R';
  const out = {};
  for (const f of FINGERS) {
    const k0 = J[`${f}1${S}`], k1 = J[`${f}2${S}`], k2 = J[`${f}3${S}`];
    const h = HAND[f];
    const d = f === 'thumb' ? V3(s * h.dir.x, h.dir.y, h.dir.z) : V3(0, -1, 0);
    out[f] = { k0, k1, k2, d, len: h.len, r: h.r, bones: [`hand${S}`, `${f}1${S}`, `${f}2${S}`, `${f}3${S}`] };
  }
  return out;
}

/**
 * Build one hand. opts: { glove: bool, s: +1|-1, scale (radius factor), skinCol, nailCol, fabricKey, rubberKey,
 *  dirt: 0..1 (glove grime) }
 */
export function buildHand(B, J, opts) {
  const s = opts.s;
  const S = s > 0 ? 'L' : 'R';
  const W = J[`hand${S}`];
  const glove = !!opts.glove;
  const g = glove ? 1.32 : 1.0;          // glove bulk over the hand
  const F = fingerFrames(J, s);
  const lowDetail = B.detail < 0.2;
  const back = V3(s, 0, 0);              // back of the hand (lateral in the bind pose)
  const palmN = V3(-s, 0, 0);
  const skinCol = opts.skinCol || [1, 1, 1];

  // ------------------------------------------------------------------ palm
  const palmKey = glove ? opts.fabricKey : 'skin';
  B.mat(palmKey).color(glove ? [0.93, 0.93, 0.9] : skinCol).bone(`hand${S}`);
  // weights: wrist end blends from the forearm, knuckle end toward the finger bones (handled per finger)
  const iHand = B.bi(`hand${S}`), iFore = B.bi(`forearm${S}`);
  B.skinFn((p) => { const t = sstep(W.y + 0.012, W.y - 0.02, p.y); return [iFore, 1 - t, iHand, t]; });
  const yK = W.y - 0.094;                // knuckle line
  const palmRings = [];
  const K = B.seg(12, 5);
  for (let i = 0; i <= K; i++) {
    const t = i / K;
    const y = W.y + 0.01 - t * (W.y + 0.01 - (yK + 0.004));
    // width across (Z) and thickness (X): wrist narrower, metacarpal arch wider
    const wid = (0.031 + 0.012 * sstep(0, 0.55, t) - 0.001 * sstep(0.85, 1, t)) * g;
    const thk = (0.018 - 0.003 * sstep(0.2, 1, t)) * g;
    // thenar eminence (thumb ball) on the palm side near the thumb, hypothenar on the little finger side
    const thenar = 0.008 * Math.sin(Math.PI * Math.min(1, t * 1.4)) * g;
    palmRings.push({
      c: V3(W.x + s * (0.002 - 0.003 * t) * g, y, W.z + 0.004),
      ax: X, ay: Z, rx: thk, ry: wid, e: 2.4,
      r: (th) => {
        // th: 0 = +X; palm side for the left hand is -X (th = pi)
        const px = Math.cos(th) * -s, pz = Math.sin(th);
        let m = 1;
        if (px > 0) m += (thenar / thk) * Math.max(0, px) * Math.max(0, pz * 0.8 + 0.4) * 0.9;   // palm-side pads
        return m;
      },
    });
  }
  B.loft(palmRings, { n: 22, capStart: false, nMin: 8 });

  // ------------------------------------------------------------------ fingers
  for (const f of FINGERS) {
    const fr = F[f];
    const thumb = f === 'thumb';
    const L = fr.len[0] + fr.len[1] + fr.len[2];
    const r0 = fr.r * (glove ? 1.32 : 1.0);
    const ib = fr.bones.map((n) => B.bi(n));
    const j1 = fr.len[0], j2 = fr.len[0] + fr.len[1];
    const bw = 0.007;
    const start = thumb ? -0.012 : -0.012;   // begin inside the palm
    const along = (p) => _t.subVectors(p, fr.k0).dot(fr.d);
    B.skinFn((p) => {
      const a = along(p);
      if (a < -bw * 0.2) { const t = sstep(-0.02, 0.0, a); return [ib[0], 1 - t * 0.5, ib[1], t * 0.5]; }
      if (a < j1 - bw) { const t = sstep(-bw * 0.2, bw, a); return [ib[0], 0.5 * (1 - t), ib[1], 0.5 + 0.5 * t]; }
      if (a < j1 + bw) { const t = sstep(j1 - bw, j1 + bw, a); return [ib[1], 1 - t, ib[2], t]; }
      if (a < j2 - bw) return [ib[2], 1, 0, 0];
      const t = sstep(j2 - bw, j2 + bw, a); return [ib[2], 1 - t, ib[3], t];
    });
    // section frame: X axis toward the back of the finger (for thumbs: perpendicular in the thumb's plane)
    const ref = thumb ? new THREE.Vector3().crossVectors(fr.d, Y).normalize().multiplyScalar(-s) : back;
    if (thumb && ref.dot(back) < 0) ref.negate();
    const K2 = B.seg(30, 8);
    const pts = [];
    const sec = [];
    for (let i = 0; i <= K2; i++) {
      const u = i / K2;
      const a = start + u * (L - start);
      pts.push(fr.k0.clone().addScaledVector(fr.d, a));
      // radius taper; knuckles (bare) bulge on the back; tip rounds off over the last 0.8 r
      let r = r0 * (1 - 0.18 * sstep(0, L, a)) * (thumb ? (1 + 0.25 * (1 - sstep(0, j1, a))) : 1);
      const tipZone = L - a;
      if (tipZone < r0 * 0.9) r *= Math.sqrt(Math.max(0.0, 1 - Math.pow(1 - tipZone / (r0 * 0.9), 2))) * 0.98 + 0.02;
      // glove: slight bulge at mid-phalanges (fabric over the finger), pleats at the joints
      let knuck = 0;
      if (!glove) knuck = 0.12 * (Math.exp(-(((a - j1) / 0.007) ** 2)) + Math.exp(-(((a - j2) / 0.006) ** 2)) * 0.7 + Math.exp(-((a / 0.01) ** 2)) * 1.2);
      const pleat = glove && !lowDetail ? 0.05 * (Math.cos(((a - j1) / 0.006) * Math.PI) * Math.exp(-(((a - j1) / 0.01) ** 2)) + Math.cos(((a - j2) / 0.006) * Math.PI) * Math.exp(-(((a - j2) / 0.009) ** 2))) : 0;
      sec.push({ r, knuck, pleat });
    }
    // bare: skin. glove: fabric back, rubber on the palm side + fingertip cap -> two passes with partial rings
    const mk = (t0, t1, key, col, capEnd) => {
      B.mat(key).color(col);
      const rings = pts.map((c, i) => ({ c, rx: sec[i].r * 0.88, ry: sec[i].r, e: 2.2, r: (th) => 1 + sec[i].pleat + sec[i].knuck * Math.max(0, Math.cos(th)) ** 3 }));
      B.sweep(pts, (t, i) => ({ rx: rings[i].rx, ry: rings[i].ry, e: rings[i].e, r: rings[i].r }), { n: thumb ? 16 : 14, ref, t0, t1, nMin: 6 });
      void capEnd;
    };
    if (!glove || lowDetail) mk(undefined, undefined, glove ? opts.fabricKey : 'skin', glove ? [0.93, 0.93, 0.9] : skinCol);
    else {
      // back half fabric (around +ref), palm half rubber
      mk(-0.27, 0.27, opts.fabricKey, [0.93, 0.93, 0.9]);
      mk(0.27, 0.73, opts.rubberKey, [1, 1, 1]);
    }
    // nails (bare) / fingertip caps (glove)
    if (!lowDetail) {
      const tipA = L - r0 * 0.55;
      const c = fr.k0.clone().addScaledVector(fr.d, tipA - (thumb ? 0.006 : 0.005));
      const n = ref.clone();
      if (!glove) {
        B.mat('skin').color(opts.nailCol || [1.25, 1.05, 1.0]);
        const side = new THREE.Vector3().crossVectors(fr.d, n).normalize();
        const nl = (thumb ? 0.013 : 0.0115), nw = r0 * 1.25;
        B.patch((u, v, p, nn) => {
          const xx = (u - 0.5) * nw, yy = (v - 0.5) * nl;
          const curve = (xx * xx) / (r0 * 1.2);
          p.copy(c).addScaledVector(side, xx).addScaledVector(fr.d, yy).addScaledVector(n, r0 * 0.86 - curve + 0.0006);
          nn.copy(n).addScaledVector(side, xx / (r0 * 0.9)).normalize();
        }, 4, 2, null, { w: nw, h: nl });
      } else {
        // rubber thimble over the last 12 mm (fully round)
        B.mat(opts.rubberKey).color([1, 1, 1]);
        const c0 = fr.k0.clone().addScaledVector(fr.d, L - 0.014);
        const pts2 = [], K3 = B.seg(8, 4);
        for (let i = 0; i <= K3; i++) pts2.push(c0.clone().addScaledVector(fr.d, (i / K3) * 0.0142));
        B.sweep(pts2, (t) => { const tz = (1 - t) * 0.0142; const rr = r0 * (tz < r0 * 0.9 ? Math.sqrt(Math.max(0, 1 - Math.pow(1 - tz / (r0 * 0.9), 2))) * 0.98 + 0.02 : 1) * 1.04; return { rx: rr * 0.9, ry: rr, e: 2.2 }; }, { n: 14, ref, nMin: 6 });
      }
    }
  }

  // ------------------------------------------------------------------ glove extras: palm grip pad
  if (glove && !lowDetail) {
    B.bone(`hand${S}`).mat(opts.rubberKey).color([1, 1, 1]);
    const pc = V3(W.x - s * 0.026, W.y - 0.058, W.z + 0.004);
    B.rbox(pc, Z, Y, X, 0.036, 0.034, 0.004, { bevel: 0.0035, n: 16 });
  }
}

const _t = new THREE.Vector3();
