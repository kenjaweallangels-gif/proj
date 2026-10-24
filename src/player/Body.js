import * as THREE from 'three';

/**
 * Body dimensions of the astronaut (metres) and the collision shapes built from them.
 * Shared contract for the physics (Player / Iva) and the visuals (suit / body model): the camera is the eye,
 * every other dimension is relative to it in the body frame (camera frame: +Y up the spine, -Z forward).
 *
 *   unsuited ('iva'):  1.80 m tall, eye 1.68 m above the soles, shoulder half-width ~0.25 m (+ arms: radius 0.30)
 *   suited ('airlock', 'eva'): EVA suit with backpack (PLSS / SAFER), boots and helmet: 1.90 m, eye 1.72 m above
 *                       the boot soles, body radius 0.42 m around an axis 0.16 m behind the eye
 *
 * Collision model (see Player.js / Iva.js):
 *   - head: rigid sphere around the eye (keeps the camera off walls: near plane 0.05 m, front clearance >= 0.15 m)
 *   - spin gravity (ring decks): rigid upright capsule from the head down to `stepHeight` above the soles + a
 *     downward sphere cast for the floor (steps up to `stepHeight` are climbed, slopes follow the deck)
 *   - zero-g (modules, hub, EVA): the head is rigid, the rest of the body is a compliant capsule hanging from the
 *     neck: it trails behind the head when moving (head-first through hatches), relaxes toward "down" at rest and
 *     swings away from what it touches (it pushes the head only partly)
 */
export const BODY = {
  unsuited: {
    height: 1.80,        // soles to the top of the head
    eyeHeight: 1.68,     // soles to the eye
    headTop: 0.12,       // eye to the top of the head (along body up)
    neck: 0.20,          // eye to the neck joint (along body down)
    hipHeight: 0.95,     // soles to the hip joint
    radius: 0.30,        // body capsule radius (shoulders + arms)
    axisBack: 0.10,      // body axis behind the eye (along +Z)
    headRadius: 0.20,    // head sphere
    headBack: 0.04,      // head sphere centre behind the eye
    stepHeight: 0.30,    // highest step walked up without jumping
  },
  suited: {
    height: 1.90,
    eyeHeight: 1.72,
    headTop: 0.18,       // helmet top
    neck: 0.24,
    hipHeight: 1.00,
    radius: 0.42,        // torso + backpack
    axisBack: 0.16,
    headRadius: 0.28,    // helmet bubble
    headBack: 0.04,
    stepHeight: 0.25,
  },
};

/** Dimensions for the current suit state. */
export function bodyDims(suited) { return suited ? BODY.suited : BODY.unsuited; }

const _up = new THREE.Vector3();
const _back = new THREE.Vector3();

/**
 * Head sphere centre (into out) for an eye at `eye` with body up `up` and body back `back` (unit vectors,
 * any frame). Returns the radius.
 */
export function headSphere(dims, eye, up, back, out) {
  out.copy(eye).addScaledVector(back, dims.headBack);
  void up;
  return dims.headRadius;
}

/**
 * Upright capsule of a standing body (gravity): segment a (top) .. b (bottom) for an eye at `eye`, the radial
 * `up` and the horizontal `back` direction. The bottom sphere ends `stepHeight` above the soles (the floor is
 * found with a separate downward cast). Returns the radius.
 */
export function standingCapsule(dims, eye, up, back, a, b) {
  const r = dims.radius;
  _up.copy(up); _back.copy(back);
  a.copy(eye).addScaledVector(_up, dims.headTop - r).addScaledVector(_back, dims.axisBack);
  b.copy(eye).addScaledVector(_up, -(dims.eyeHeight - dims.stepHeight - r)).addScaledVector(_back, dims.axisBack);
  return r;
}
