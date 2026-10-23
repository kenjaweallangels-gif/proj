/**
 * `three` with a global geometry-detail factor.
 *
 * vite.config.js aliases the bare specifier `three` to this module (for the app and the three.js
 * addons alike, so there is still exactly one three.js instance). Everything is re-exported
 * unchanged, except the round parametric geometries: their segment counts are multiplied by
 * `globalThis.__THREE_DETAIL` (default 1) at construction time. App sets the factor while it
 * builds the station, ships and suit, which lets the 'lite' preset (CPU rasterisers, where vertex
 * processing dominates) cut the triangle count without touching the ~120 call sites.
 */
import * as T from 'three-original';

export * from 'three-original';

const seg = (n, def, min) => {
  const f = globalThis.__THREE_DETAIL ?? 1;
  const v = n === undefined ? def : n;
  return f === 1 ? v : Math.max(min, Math.round(v * f));
};

export class CylinderGeometry extends T.CylinderGeometry {
  constructor(rt, rb, h, radial, hs, openEnded, thetaStart, thetaLength) {
    super(rt, rb, h, seg(radial, 32, 4), hs, openEnded, thetaStart, thetaLength);
  }
}
export class ConeGeometry extends T.ConeGeometry {
  constructor(r, h, radial, hs, openEnded, thetaStart, thetaLength) {
    super(r, h, seg(radial, 32, 4), hs, openEnded, thetaStart, thetaLength);
  }
}
export class SphereGeometry extends T.SphereGeometry {
  constructor(r, ws, hs, phiStart, phiLength, thetaStart, thetaLength) {
    super(r, seg(ws, 32, 6), seg(hs, 16, 3), phiStart, phiLength, thetaStart, thetaLength);
  }
}
export class TorusGeometry extends T.TorusGeometry {
  constructor(R, r, radial, tubular, arc) {
    super(R, r, seg(radial, 12, 3), seg(tubular, 48, 6), arc);
  }
}
export class LatheGeometry extends T.LatheGeometry {
  constructor(points, segments, phiStart, phiLength) {
    super(points, seg(segments, 12, 6), phiStart, phiLength);
  }
}
export class TubeGeometry extends T.TubeGeometry {
  constructor(path, tubular, radius, radial, closed) {
    super(path, seg(tubular, 64, 4), radius, seg(radial, 8, 3), closed);
  }
}
export class CircleGeometry extends T.CircleGeometry {
  constructor(r, segments, thetaStart, thetaLength) {
    super(r, seg(segments, 32, 6), thetaStart, thetaLength);
  }
}
export class RingGeometry extends T.RingGeometry {
  constructor(inner, outer, thetaSegments, phiSegments, thetaStart, thetaLength) {
    super(inner, outer, seg(thetaSegments, 32, 6), phiSegments, thetaStart, thetaLength);
  }
}
export class CapsuleGeometry extends T.CapsuleGeometry {
  constructor(r, len, capSegments, radial, hs) {
    super(r, len, seg(capSegments, 4, 2), seg(radial, 8, 4), hs);
  }
}
