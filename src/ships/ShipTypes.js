import { buildCapsule } from './types/Capsule.js';
import { buildFreighter } from './types/Freighter.js';
import { buildShuttle } from './types/Shuttle.js';
import { buildTanker } from './types/Tanker.js';
import { buildDrone } from './types/Drone.js';
export { animateCommon } from './types/Common.js';

/**
 * Ship type registry. Each builder returns the structure documented in types/Common.js.
 * `dyn` holds the flight-dynamics limits used by the traffic controller:
 *   rcs  – max translational acceleration from RCS (m/s^2)
 *   main – main-engine acceleration (m/s^2)
 *   omega / alpha – max angular rate (rad/s) and angular acceleration (rad/s^2)
 *   puff – RCS puff look: particle speed / size
 */
export const SHIP_TYPES = {
  capsule:   { build: buildCapsule,   dyn: { rcs: 0.08, main: 0.3,  omega: 0.05,  alpha: 0.004,  puff: { speed: 9,  size: 0.7, scale: 1.0 } }, size: 'small', docks: true },
  freighter: { build: buildFreighter, dyn: { rcs: 0.05, main: 0.3,  omega: 0.025, alpha: 0.0015, puff: { speed: 11, size: 1.0, scale: 1.4 } }, size: 'large', docks: true },
  shuttle:   { build: buildShuttle,   dyn: { rcs: 0.05, main: 0.35, omega: 0.025, alpha: 0.0015, puff: { speed: 11, size: 1.0, scale: 1.6 } }, size: 'large', docks: true },
  tanker:    { build: buildTanker,    dyn: { rcs: 0.06, main: 0.4,  omega: 0.03,  alpha: 0.002,  puff: { speed: 10, size: 0.9, scale: 1.4 } }, size: 'large', docks: true },
  drone:     { build: buildDrone,     dyn: { rcs: 0.3,  main: 0,    omega: 0.35,  alpha: 0.15,   puff: { speed: 5,  size: 0.25, scale: 0.4 } }, size: 'small', docks: false },
};
