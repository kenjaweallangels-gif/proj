/** Sun disc + corona quads (always facing the camera). The Moon is world/Moon.js. */

export const QUAD_VERTEX = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Photosphere: very bright HDR disc with limb darkening, anti-aliased edge. uDisc = disc radius / quad half size. */
export const SUN_DISC_FRAGMENT = /* glsl */`
uniform vec3 uColor;
uniform float uIntensity, uDisc;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0 / uDisc;
  float r = length(p);
  float e = max(fwidth(r) * 1.2, 0.004);
  float disc = 1.0 - smoothstep(1.0 - e, 1.0 + e, r);
  float ld = 1.0 - 0.45 * (1.0 - sqrt(max(1.0 - r * r, 0.0)));   // limb darkening
  vec3 col = uColor * uIntensity * ld * disc;
  gl_FragColor = vec4(col, 1.0);
}`;

/** Soft corona / glare around the disc, additive. uDisc = disc radius / quad half size. */
export const SUN_CORONA_FRAGMENT = /* glsl */`
uniform vec3 uColor;
uniform float uIntensity, uDisc;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 p = (vUv - 0.5) * 2.0 / uDisc;     // 1.0 at the disc edge
  float r = max(length(p), 1.0e-3);
  float ang = atan(p.y, p.x);
  float streaks = 0.85 + 0.15 * (sin(ang * 9.0) * sin(ang * 5.0 + 1.3));
  float g = 1.1 * exp(-(r - 1.0) * 2.4) + 0.09 * exp(-(r - 1.0) * 0.45) * streaks;
  g *= smoothstep(0.0, 0.2, 1.0 - r / (1.0 / uDisc));       // fade out at the quad border
  vec3 col = uColor * uIntensity * g;
  col += (hash(gl_FragCoord.xy) - 0.5) * 0.002;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;
