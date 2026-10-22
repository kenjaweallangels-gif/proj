/**
 * Star colour from the B-V index: Ballesteros' formula gives the black-body temperature, then an
 * approximate black-body -> sRGB fit (Tanner Helland), converted to linear and normalised so the
 * brightest channel is 1 (brightness is handled separately by the magnitude). Slightly desaturated:
 * stars look nearly white to the eye, with a bluish / orange cast.
 */
export function bvToTemperature(bv) {
  bv = Math.min(2.0, Math.max(-0.4, bv));
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

export function bvToLinearRgb(bv, out = [0, 0, 0]) {
  const t = Math.min(40000, Math.max(1000, bvToTemperature(bv))) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  r = Math.min(255, Math.max(0, r)) / 255; g = Math.min(255, Math.max(0, g)) / 255; b = Math.min(255, Math.max(0, b)) / 255;
  // sRGB -> linear
  r = Math.pow(r, 2.2); g = Math.pow(g, 2.2); b = Math.pow(b, 2.2);
  const m = Math.max(r, g, b, 1e-4);
  r /= m; g /= m; b /= m;
  const k = 0.3;   // desaturate toward white
  out[0] = r + (1 - r) * k; out[1] = g + (1 - g) * k; out[2] = b + (1 - b) * k;
  return out;
}
