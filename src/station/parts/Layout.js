/**
 * Station layout constants (meters, station frame: +X prograde, +Y zenith, +Z = X x Y).
 * All parts read their coordinates from here so they never overlap.
 *
 *   x: -88 ......... -76 ....... -64/-56 ...... -42 ...... -30 ............ 42 ... 50..62 ....... 76 ....... 88
 *      aft end      aft arrays   radiators    gravity ring  module cluster  hub   antennas   fwd arrays   fwd end
 */
export const LAYOUT = {
  spineHalf: 88,          // truss from -88 to +88
  spineSize: 4.5,         // square section
  clusterY: -8,           // centreline of the pressurised modules (below the spine)
  ringX: -42, ringR: 40, ringTube: 3.5, ringHubR: 5.0,
  arrayJointX: 76, arrayInner: 6, arrayLen: 36, arrayWidth: 12,
  radiatorX: [-56, -64], radiatorLen: 15, radiatorWidth: 7,
  hubX: 39,               // docking hub centre (x), on the cluster centreline
  airlock: { x: -18.5, zStart: 2.4, len: 7.2, r: 2.0 },
  stationName: 'АВРОРА',
  stationNameLatin: 'AURORA',
};
