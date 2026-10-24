import { SOYUZ, PROGRESS } from './types/Soyuz.js';
import { DRAGON } from './types/Dragon.js';
import { STARLINER } from './types/Starliner.js';
import { CYGNUS } from './types/Cygnus.js';
import { HTVX } from './types/HTVX.js';
import { DREAMCHASER } from './types/DreamChaser.js';
import { DRONE } from './types/Drone.js';

/**
 * Ship type registry. `def` = { type, name, label, size, length, boundRadius, mainAxis, upAxis, author(kit) }
 * (see Kit.js / types/*). `dyn` holds the flight-dynamics limits used by the traffic controller:
 *   rcs  – max translational acceleration from RCS (m/s^2)
 *   main – main-engine acceleration (m/s^2)
 *   omega / alpha – max angular rate (rad/s) and angular acceleration (rad/s^2)
 *   puff – RCS puff look: particle speed / size / scale
 */
export const SHIP_TYPES = {
  soyuz:    { def: SOYUZ,    dyn: { rcs: 0.08, main: 0.3,  omega: 0.05,  alpha: 0.004,  puff: { speed: 9,  size: 0.55, scale: 0.8 } }, docks: true },
  progress: { def: PROGRESS, dyn: { rcs: 0.07, main: 0.28, omega: 0.045, alpha: 0.0035, puff: { speed: 9,  size: 0.55, scale: 0.8 } }, docks: true },
  dragon:      { def: DRAGON,      dyn: { rcs: 0.1,  main: 0.22, omega: 0.05,  alpha: 0.004,  puff: { speed: 9,  size: 0.5,  scale: 0.6 } }, docks: true },
  starliner:   { def: STARLINER,   dyn: { rcs: 0.09, main: 0.3,  omega: 0.05,  alpha: 0.004,  puff: { speed: 9,  size: 0.55, scale: 0.7 } }, docks: true },
  cygnus:      { def: CYGNUS,      dyn: { rcs: 0.06, main: 0.3,  omega: 0.035, alpha: 0.0025, puff: { speed: 10, size: 0.6,  scale: 0.8 } }, docks: true },
  htvx:        { def: HTVX,        dyn: { rcs: 0.05, main: 0.28, omega: 0.03,  alpha: 0.002,  puff: { speed: 10, size: 0.7,  scale: 0.9 } }, docks: true },
  dreamchaser: { def: DREAMCHASER, dyn: { rcs: 0.05, main: 0.2,  omega: 0.025, alpha: 0.0015, puff: { speed: 10, size: 0.6,  scale: 0.7 } }, docks: true },
  drone:    { def: DRONE,    dyn: { rcs: 0.3,  main: 0,    omega: 0.35,  alpha: 0.15,   puff: { speed: 5,  size: 0.25, scale: 0.4 } }, docks: false },
};
