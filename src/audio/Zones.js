/**
 * Acoustic description of the interior zones (src/station/interior): room class (reverb), ambience bed,
 * floor surface for footsteps, sound occlusion between zones through hatches, positions of zone sources.
 */

/** Room class of a zone (keys of Mixer.ROOMS). x = ring-local x of the listener (cabins off the corridor aisle). */
export function roomClass(z, x = 0) {
  if (!z) return null;
  const id = z.id;
  if (id === 'airlockE' || id === 'airlockC') return 'airlock';
  if (id === 'cupola') return 'cupola';
  if (id === 'greenhouse') return 'green';
  if (id === 'service') return 'service';
  if (id === 'hub' || id === 'ringHub') return 'hub';
  if (id === 'svcTunnel' || id === 'spine') return 'tunnel';
  if (id.startsWith('node')) return 'node';
  if (id.startsWith('spoke')) return 'spoke';
  if (id.startsWith('pod')) return 'hall';
  if (id.startsWith('cor')) return Math.abs(x) > 1.7 ? 'cabin' : 'corridor';
  return 'module';
}

/** Ambience bed (foley loop) and its level for a zone / room class. */
export function bedFor(z, cls) {
  if (!z) return null;
  if (z.id === 'ringHub') return ['bed_hub', 0.55];
  switch (cls) {
    case 'service': return ['bed_service', 0.75];
    case 'node': return ['bed_node', 0.5];
    case 'hub': return ['bed_node', 0.55];
    case 'airlock': return ['bed_airlock', 0.5];
    case 'cupola': return ['bed_cupola', 0.32];
    case 'green': return ['bed_green', 0.45];
    case 'tunnel': return ['bed_tunnel', 0.5];
    case 'spoke': return ['bed_spoke', 0.5];
    case 'hall': return ['bed_ring', 0.42];
    case 'corridor': return ['bed_ring', 0.36];
    case 'cabin': return ['bed_ring', 0.2];
    default: return ['bed_module', 0.52];
  }
}

/**
 * Floor surface under the player in the ring. Sector halls: k%3 = 0 control post (grating), 1 gym (rubber
 * mat), 2 wardroom (carpet); corridors: the central aisle is a grating, carpet beside it and in the cabins.
 */
export function surfaceAt(z, x = 0) {
  if (!z) return 'panel';
  const id = z.id;
  if (id.startsWith('pod')) { const k = parseInt(id.slice(3), 10) || 0; return ['grate', 'mat', 'carpet'][k % 3]; }
  if (id.startsWith('cor')) return Math.abs(x) < 1.0 ? 'grate' : 'carpet';
  if (id.startsWith('spoke')) return 'grate';
  return 'panel';
}

/**
 * Sound transmission from the listener's zone to other zones through the portal graph: per zone a gain and a
 * low-pass cutoff. Open hatches cost a little level and top end per hop; a closed hatch passes only a dull,
 * strongly attenuated rumble (structure + gaps). Beyond 3 hops nothing is heard.
 */
export class Occlusion {
  constructor() { this.map = new Map(); this.from = null; this._q = []; this._d = []; }

  update(zone) {
    const m = this.map;
    m.clear();
    this.from = zone;
    if (!zone) return;
    const q = this._q, d = this._d;
    q.length = 0; d.length = 0;
    m.set(zone, { gain: 1, lp: 20000 });
    q.push(zone); d.push(0);
    for (let i = 0; i < q.length; i++) {
      const z = q[i], depth = d[i], cur = m.get(z);
      if (depth >= 3) continue;
      for (const p of z.portals || []) {
        const nz = p.zone;
        if (!nz) continue;
        const open = !p.gate || p.gate.isOpen || (p.gate.progress ?? 0) > 0.15;
        const g = cur.gain * (open ? 0.6 : 0.06), lp = Math.min(cur.lp, open ? cur.lp * 0.55 + 1500 : 450);
        const prev = m.get(nz);
        if (!prev || prev.gain < g) {
          if (prev) { prev.gain = g; prev.lp = lp; } else m.set(nz, { gain: g, lp });
          q.push(nz); d.push(depth + 1);
        }
      }
    }
  }

  get(zone) { return this.map.get(zone) || null; }
}

/** World position of a point given in a zone's frame (ring zones: ring-local -> world). out: {x,y,z}. */
export function zoneToWorld(interior, z, lx, ly, lz, out) {
  if (z.frame === 'ring' && interior?.ringMat) {
    const e = interior.ringMat.elements;
    out.x = e[0] * lx + e[4] * ly + e[8] * lz + e[12];
    out.y = e[1] * lx + e[5] * ly + e[9] * lz + e[13];
    out.z = e[2] * lx + e[6] * ly + e[10] * lz + e[14];
  } else { out.x = lx; out.y = ly; out.z = lz; }
  return out;
}
