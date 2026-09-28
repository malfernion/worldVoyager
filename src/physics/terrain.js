// Terrain shape + colour for every solid body. The same functions feed the physics surface
// (landing / crashing) and the rendered mesh, so they always line up.
import { makeNoise, mulberry32 } from './noise.js';

const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const mix = (a, b, t) => {
  t = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
};
const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function randomDirs(seed, count) {
  const rand = mulberry32(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    out.push({ x: s * Math.cos(a), y: s * Math.sin(a), z, size: rand(), depth: rand() });
  }
  return out;
}

// Bowl-with-a-rim crater profile. d = angular distance / crater radius: -1 in the middle, a
// round rim 0.35 high at d = 1, and the ejecta sloping away to nothing at d = 1.6. Smooth all
// the way (no slope jumps at the rim or the ejecta's edge, #56), so rims read round on the
// mesh instead of as a ring of sharp facets.
export function craterProfile(d) {
  if (d >= 1.6) return 0;
  if (d < 1) {
    // A bowl as round at the bottom as the old one (-1 + d²), bending over smoothly into the
    // rim's crest (level there, like the ejecta's top).
    const u = d * d;
    return -1 + 1.35 * u * (0.74 + 2.52 * d - 2.26 * u);
  }
  return 0.35 * (1 - smooth(1, 1.6, d));
}

function craters(list, dx, dy, dz, scale) {
  let h = 0;
  for (const c of list) {
    const dot = dx * c.x + dy * c.y + dz * c.z;
    const rad = c.radius;
    if (dot < Math.cos(rad * 1.6)) continue;
    const ang = Math.acos(Math.min(1, dot));
    h += craterProfile(ang / rad) * c.deep * scale;
  }
  return h;
}

// Keep a flat, grassy pad around the launch site (straight "up" on Homestead).
const LAUNCH_DIR = { x: 0, y: 1, z: 0 };

/** A unit direction `a` round the flight plane and `z` towards the camera. */
export function dirOf(a, z) {
  const s = Math.sqrt(1 - z * z);
  return { x: s * Math.cos(a), y: s * Math.sin(a), z };
}

// Discoveries (#15) that shape the ground are placed here; the rest are in discoveries.js.
// The old observatory stands on a rocky hilltop behind the village (about 130 m from the pad),
// on a little flat top so it stands level.
export const OBSERVATORY = dirOf(1.13, -0.095);

// Liquids (#44): a world can have one liquid layer, separate from its solid ground. `kind` says
// what it is ('water' on Homestead; lava and methane are for later worlds) and `level` is its
// surface in metres above the world's base radius. The ground keeps its real shape underneath:
// the buggy drives on that, while a rocket touching the liquid's surface crashes. How each kind
// looks is in src/world/liquid.js; how the physics surfaces use it is in bodies.js.

/**
 * How deep the seabed lies for ground that would be `d` metres below the liquid: a little
 * shallower than the raw shape near the shore (gentle beaches the buggy can climb out of),
 * getting steeper further out, so seas are a few metres deep by the coast and deeper in the middle.
 */
export const seabedDepth = (d) => 0.6 * d + 0.08 * d * d;

// Pools (#45): a world whose liquid sits in pools (Sizzle's lava; lakes later, #46) keeps the
// same one-level model. Its level is set below all its natural ground, and each pool is a
// basin carved down through that level, so the liquid fills only the hollows. A pool is a
// round blob (`a` its middle) or a flow (a line from `a` to `b`), `r` metres from the middle
// line to the shore (wobbled by noise so it isn't a perfect circle). In it the floor is a
// bowl `deep` metres below the level in the middle; outside, a bank rises from the shore at
// `bank` (metres up per metre out) until it meets the natural ground. With `soft` (metres; Misty,
// #59) the bank rounds over into the ground instead of meeting it in a crease; it must stay less
// than the natural ground's height above the level at every shore, so the shores don't move.
const WOBBLE = 0.2; // how much a pool's shore wobbles in and out (times its r)
const NEAR = 15;

export function makePools(defs, radius, level, seed, soft = 0) {
  const { noise } = makeNoise(seed);
  const list = defs.map((d) => {
    const a = d.a, b = d.b ?? d.a;
    const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
    const ab2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const len = Math.sqrt(ab2) * radius;
    // Nothing further than this from the middle line is ever carved (the bank meets the
    // highest ground within that).
    const reach = (d.r * 1.25 + 40 / d.bank) / radius;
    // A quick test: angle from the pool's middle point.
    const m = [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
    const ml = Math.hypot(m[0], m[1], m[2]);
    return { ...d, a, b, ab, ab2, len, mid: { x: m[0] / ml, y: m[1] / ml, z: m[2] / ml }, cos: Math.cos(reach + len / 2 / radius) };
  });
  // Distance (m, along the ground, near enough) from p to a pool's middle line.
  const dist = (p, x, y, z) => {
    let t = 0;
    if (p.ab2 > 0) t = Math.max(0, Math.min(1, ((x - p.a.x) * p.ab[0] + (y - p.a.y) * p.ab[1] + (z - p.a.z) * p.ab[2]) / p.ab2));
    const qx = p.a.x + p.ab[0] * t, qy = p.a.y + p.ab[1] * t, qz = p.a.z + p.ab[2] * t;
    const dx = x - qx, dy = y - qy, dz = z - qz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) * radius;
  };
  // The shore's distance from that line there (the noise is the costly bit: only near a pool).
  const shoreAt = (p, x, y, z) => p.r * (1 + WOBBLE * noise(x * 7 + p.seed, y * 7, z * 7));
  return {
    list,
    level,
    /** The ground at (x, y, z) with the pools carved into it: `h` is the natural height there. */
    carve(x, y, z, h) {
      for (const p of list) {
        if (x * p.mid.x + y * p.mid.y + z * p.mid.z < p.cos) continue;
        const d = dist(p, x, y, z);
        if (d > p.r * (1 + WOBBLE) + (h + soft - level) / p.bank) continue;
        const shore = shoreAt(p, x, y, z);
        if (d > shore + (h + soft - level) / p.bank) continue;
        const s = d / shore;
        const bowl = s < 1 ? level - p.deep * (1 - s * s) : level + (d - shore) * p.bank;
        if (soft > 0) {
          // A smooth minimum: the same as min() once they're `soft` apart.
          const g = Math.max(0, 1 - Math.abs(h - bowl) / soft);
          h = Math.min(h, bowl) - soft * 0.25 * g * g;
        } else if (bowl < h) h = bowl;
      }
      return h;
    },
    /**
     * How far (m) the nearest pool's shore is from (x, y, z): negative in a pool, Infinity far
     * away. Exact within `NEAR` metres of a pool (the buggy's lava wall, the banks' colour,
     * rocks), roughly further out.
     */
    shoreDist(x, y, z) {
      let best = Infinity;
      for (const p of list) {
        if (x * p.mid.x + y * p.mid.y + z * p.mid.z < p.cos) continue;
        const d = dist(p, x, y, z);
        best = Math.min(best, d - p.r * (1 + WOBBLE) > NEAR ? d - p.r : d - shoreAt(p, x, y, z));
      }
      return best;
    },
  };
}

function makeHome() {
  const { fbm, noise } = makeNoise(11);
  const sea = -1.5;
  const raw = (x, y, z) => {
    const n = fbm(x * 2.2, y * 2.2, z * 2.2, 5);
    const m = Math.max(0, fbm(x * 1.1 + 7, y * 1.1, z * 1.1, 3) - 0.1) * 70;
    return n * 20 + m + 3;
  };
  const obs = OBSERVATORY;
  const hill = raw(obs.x, obs.y, obs.z);
  const OBS_COS = Math.cos(0.035);
  return {
    liquid: { kind: 'water', level: sea },
    height(x, y, z) {
      let h = raw(x, y, z);
      const d = Math.acos(Math.min(1, x * LAUNCH_DIR.x + y * LAUNCH_DIR.y + z * LAUNCH_DIR.z));
      h = h + (2.5 - h) * (1 - smooth(0.035, 0.12, d));
      const o = x * obs.x + y * obs.y + z * obs.z;
      if (o > OBS_COS) h = h + (hill - h) * (1 - smooth(0.015, 0.035, Math.acos(Math.min(1, o))));
      return h < sea ? sea - seabedDepth(sea - h) : h;
    },
    color(x, y, z, h) {
      if (h < sea) {
        // The seabed: sand by the shore, then weedy green, then dark blue-grey far down.
        const d = sea - h;
        const floor = mix(rgb(0x7f9a6a), rgb(0x3c5a66), smooth(2.5, 8, d));
        return mix(rgb(0xd9c68e), floor, smooth(0.3, 2.5, d));
      }
      const grass = mix(rgb(0x6fa045), rgb(0x4a7e3a), noise(x * 9, y * 9, z * 9) * 0.5 + 0.5);
      let c = mix(rgb(0xd9c68e), grass, smooth(sea + 0.2, sea + 2.5, h));
      c = mix(c, rgb(0x8c7a64), smooth(14, 22, h));
      c = mix(c, rgb(0xf2efe6), smooth(30, 38, h));
      return c;
    },
  };
}

function makePebble() {
  const { fbm } = makeNoise(23);
  const list = randomDirs(5, 36).map((c) => ({ ...c, radius: 0.08 + c.size * c.size * 0.35, deep: 2 + c.depth * 5 }));
  return {
    height(x, y, z) {
      return fbm(x * 3, y * 3, z * 3, 4) * 3 + craters(list, x, y, z, 1);
    },
    color(x, y, z, h) {
      const n = fbm(x * 6 + 3, y * 6, z * 6, 3);
      let c = mix(rgb(0xb8b2a6), rgb(0xa29b90), n + 0.5);
      c = mix(c, rgb(0x7f786f), smooth(-1, -4, h));
      c = mix(c, rgb(0xd6d1c7), smooth(0.8, 2, h));
      return c;
    },
  };
}

// Dusty's big volcano. Exported so the caldera puffs sit exactly on top of it.
export const DUSTY_VOLCANO = (() => {
  const v = { x: Math.cos(2.5), y: Math.sin(2.5), z: 0.15 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();

function makeDusty() {
  const { fbm, noise } = makeNoise(37);
  const volcano = DUSTY_VOLCANO;
  const canyon = (x, y, z) => {
    const r = 1 - Math.abs(noise(x * 1.7 + 4, y * 1.7, z * 1.7));
    return Math.pow(r, 10);
  };
  const volc = (x, y, z) => {
    const d = Math.acos(Math.min(1, x * volcano.x + y * volcano.y + z * volcano.z));
    if (d > 0.45) return 0;
    const cone = (1 - smooth(0, 0.45, d)) * 36;
    const caldera = (1 - smooth(0.02, 0.07, d)) * 10;
    return cone - caldera;
  };
  return {
    height(x, y, z) {
      return fbm(x * 2.5, y * 2.5, z * 2.5, 5) * 12 - canyon(x, y, z) * 18 + volc(x, y, z);
    },
    color(x, y, z, h) {
      const n = noise(x * 8, y * 8, z * 8);
      let c = mix(rgb(0xd0703f), rgb(0xb65a34), n + 0.5);
      c = mix(c, rgb(0x7a3822), canyon(x, y, z) * 1.3);
      c = mix(c, rgb(0x9a4b2d), smooth(8, 26, h));
      c = mix(c, rgb(0xe8a070), smooth(0.25, 0.4, fbm(x * 4 + 9, y * 4, z * 4, 3)));
      return c;
    },
  };
}

// Nibble's giant crater, like Stickney on Phobos: nearly as big as the moon itself. It crosses
// the flight plane so a rocket can land in it (a discovery, #15).
export const NIBBLE_CRATER = { ...dirOf(Math.PI, 0.12), radius: 0.62, deep: 5 };

function makeNibble() {
  const { fbm } = makeNoise(41);
  const list = randomDirs(17, 10).map((c) => ({ ...c, radius: 0.2 + c.size * 0.35, deep: 1.5 + c.depth * 2 }));
  list.push(NIBBLE_CRATER);
  const big = NIBBLE_CRATER;
  return {
    height(x, y, z) {
      // A lumpy potato, stretched along one axis.
      const stretch = 1 + 0.35 * x * x - 0.12 * z * z;
      return 30 * (stretch - 1) + fbm(x * 1.4, y * 1.4, z * 1.4, 4) * 10 + craters(list, x, y, z, 1);
    },
    color(x, y, z, h) {
      const n = fbm(x * 5, y * 5, z * 5, 3);
      const c = mix(mix(rgb(0x8f7c68), rgb(0x6f5f50), n + 0.5), rgb(0xb5a28a), smooth(6, 12, h));
      // The big crater's floor is paler, so it shows from orbit.
      const d = Math.acos(Math.min(1, x * big.x + y * big.y + z * big.z));
      return mix(c, rgb(0xb9a78f), (1 - smooth(big.radius * 0.6, big.radius, d)) * 0.7);
    },
  };
}

// Sizzle's volcano vents. Exported so the plumes rise from exactly these spots.
export const SIZZLE_VENTS = randomDirs(8, 7);

// Sizzle's lava (#45): pools and short flows, mostly at the feet of the volcanoes, below one lava level
// (see makePools). Placed by hand: clear of the vents' plumes (the biggest is a discovery,
// #15), Toasty's camp (#16, one pool is in view of it) and the great circle through the
// poles and the flight plane at x = 0 (where the buggy tests drive round), and only two cross the flight
// plane, so most of the rocket's ground is solid. Several are on the camera's side (z > 0),
// so they glow on the world's face from orbit. test/lava.test.js checks all of this.
export const SIZZLE_LAVA = {
  level: -4, // below all of Sizzle's natural ground (its lowest dip is about -2.7 m)
  radius: 110, // Sizzle's (bodies.js; a test checks they match)
  pools: [
    { a: dirOf(0.02, -0.04), r: 10, deep: 2.5, bank: 0.35 }, // at the west foot of the flight plane's volcano, across the plane
    { a: dirOf(1.93, 0.04), b: dirOf(2.08, -0.08), r: 7.5, deep: 2.2, bank: 0.35 }, // a flow in the lowland between two volcanoes, across the plane
    { a: dirOf(1.04, 0.38), r: 10, deep: 2.5, bank: 0.35 }, // in view of Toasty's camp
    { a: dirOf(1.12, 0.64), b: dirOf(1.32, 0.72), r: 8, deep: 2.2, bank: 0.35 }, // a flow north of it
    { a: dirOf(2.72, 0.56), b: dirOf(2.5, 0.68), r: 9, deep: 2.2, bank: 0.35 }, // below the biggest volcano
    { a: dirOf(0.5, 0.74), r: 9, deep: 2.5, bank: 0.35 }, // up behind the little volcano north of the flight plane's
    { a: dirOf(2.25, 0.82), b: dirOf(2.0, 0.88), r: 8, deep: 2.2, bank: 0.35 }, // a flow on the high plain
    { a: dirOf(3.45, -0.45), r: 11, deep: 2.5, bank: 0.35 }, // round the back
    { a: dirOf(4.95, 0.3), r: 10, deep: 2.5, bank: 0.35 }, // the far side
  ].map((p, i) => ({ ...p, seed: i * 3.7 })),
};

function makeSizzle() {
  const { fbm, noise } = makeNoise(53);
  const vents = SIZZLE_VENTS;
  const pools = makePools(SIZZLE_LAVA.pools, SIZZLE_LAVA.radius, SIZZLE_LAVA.level, 59);
  return {
    liquid: { kind: 'lava', level: SIZZLE_LAVA.level },
    pools,
    height(x, y, z) {
      let h = fbm(x * 2.8, y * 2.8, z * 2.8, 4) * 5;
      for (const v of vents) {
        const d = Math.acos(Math.min(1, x * v.x + y * v.y + z * v.z));
        if (d < 0.3) h += (1 - smooth(0, 0.3, d)) * 12 - (1 - smooth(0.02, 0.06, d)) * 5;
      }
      return pools.carve(x, y, z, h);
    },
    color(x, y, z, h) {
      const n = fbm(x * 5, y * 5, z * 5, 4);
      let c = mix(rgb(0xf0cf4a), rgb(0xe39a33), smooth(-0.1, 0.25, n));
      c = mix(c, rgb(0xf6f0d2), smooth(0.28, 0.4, noise(x * 3 + 5, y * 3, z * 3)));
      for (const v of vents) {
        const d = Math.acos(Math.min(1, x * v.x + y * v.y + z * v.z));
        c = mix(c, rgb(0x3d2a1f), 1 - smooth(0.05, 0.16, d));
        c = mix(c, rgb(0xff5a1f), 1 - smooth(0.0, 0.05, d));
      }
      // Round the lava: dark cooled rock on the banks, scorched orange just beyond.
      const s = pools.shoreDist(x, y, z);
      if (s < 12) {
        c = mix(c, rgb(0xb4552a), 1 - smooth(4, 12, s));
        c = mix(c, rgb(0x3a2419), 1 - smooth(1, 5, s));
      }
      return c;
    },
  };
}

// Frosty's deep cracks (#15): where the ocean under the ice glows faintly at night. Several,
// spread round the moon, so one is always on the night side. `t` is the way each crack runs.
export const FROSTY_GLOWS = [[0.5, 0.32, 0.4], [2.1, -0.3, 1.2], [3.7, 0.3, 2.2], [5.2, -0.34, 0.9]].map(([a, z, turn]) => {
  const up = dirOf(a, z);
  // A tangent: east-ish turned by `turn` towards north.
  const e = { x: -Math.sin(a), y: Math.cos(a), z: 0 };
  const n = { x: up.y * e.z - up.z * e.y, y: up.z * e.x - up.x * e.z, z: up.x * e.y - up.y * e.x };
  const c = Math.cos(turn), s = Math.sin(turn);
  return { ...up, t: { x: e.x * c + n.x * s, y: e.y * c + n.y * s, z: e.z * c + n.z * s } };
});

function makeFrosty() {
  const { fbm, noise } = makeNoise(67);
  const crack = (x, y, z) => {
    const a = 1 - Math.abs(noise(x * 3.1, y * 3.1, z * 3.1));
    const b = 1 - Math.abs(noise(x * 5.3 + 11, y * 5.3, z * 5.3));
    return Math.max(smooth(0.93, 0.99, a), smooth(0.95, 0.995, b) * 0.8);
  };
  // The glowing cracks: a straight groove through each spot, fading out at the ends.
  const deep = (x, y, z) => {
    let k = 0;
    for (const g of FROSTY_GLOWS) {
      const rx = x - g.x, ry = y - g.y, rz = z - g.z;
      if (rx * rx + ry * ry + rz * rz > 0.04) continue;
      const along = rx * g.t.x + ry * g.t.y + rz * g.t.z;
      const side = Math.hypot(rx - along * g.t.x, ry - along * g.t.y, rz - along * g.t.z);
      k = Math.max(k, (1 - smooth(0.1, 0.18, Math.abs(along))) * (1 - smooth(0.008, 0.03, side)));
    }
    return k;
  };
  return {
    height(x, y, z) {
      return fbm(x * 2, y * 2, z * 2, 4) * 3 + crack(x, y, z) * 1.5 - deep(x, y, z) * 1.5;
    },
    color(x, y, z, h) {
      let c = mix(rgb(0xeef4f7), rgb(0xc7dcea), smooth(-0.2, 0.3, fbm(x * 4, y * 4, z * 4, 3)));
      c = mix(c, rgb(0xd8b08c), smooth(0.2, 0.45, noise(x * 2 + 3, y * 2, z * 2)) * 0.6);
      c = mix(c, rgb(0xa9553a), crack(x, y, z));
      c = mix(c, rgb(0x2f5f86), deep(x, y, z));
      return c;
    },
  };
}

// Misty's methane lakes (#46), carved like Sizzle's lava (makePools) under one level. Like
// Titan's: most of them round the poles (here z = ±1, so the north ones face the camera from
// orbit), a big sea made of two long basins in the north and Ontario-style lakes in the south;
// and two cross the flight plane, so a rocket can come down in one and the helpers have
// something to avoid. Gentler banks than lava (the buggy drives in and out of these). Clear of
// Huygens (a discovery, #15, on the pebbly ground by the flight plane's big lake), and of the
// strip where the rocket lands most of the time. test/misty.test.js checks all of this.
export const MISTY_LAKES = {
  level: -5, // below all of Misty's natural ground (its lowest dip, by a lake, is about -3.5 m)
  radius: 160, // Misty's (bodies.js; a test checks they match)
  soft: 1.2, // the banks round over into the ground (#59; less than the ground's 1.5 m above the level)
  pools: [
    { a: dirOf(2.55, 0.0), r: 15, deep: 3.4, bank: 0.22 }, // across the flight plane: Huygens is on its shore
    { a: dirOf(5.3, 0.1), b: dirOf(5.45, 0.02), r: 8, deep: 2.2, bank: 0.22 }, // a narrow one across the plane, on the camera's side
    { a: dirOf(0.2, 0.86), b: dirOf(1.4, 0.9), r: 22, deep: 3.8, bank: 0.2 }, // the big northern sea (Kraken Mare)...
    { a: dirOf(1.9, 0.8), b: dirOf(2.4, 0.72), r: 16, deep: 2.8, bank: 0.2 }, // ...and its southern arm
    { a: dirOf(3.3, 0.86), r: 19, deep: 3.6, bank: 0.2 }, // a round northern sea (Ligeia Mare)
    { a: dirOf(4.6, 0.93), r: 12, deep: 2.4, bank: 0.2 }, // a small one right by the pole (Punga Mare)
    { a: dirOf(5.6, 0.7), r: 9, deep: 2.2, bank: 0.22 }, // little lakes further south
    { a: dirOf(4.1, 0.66), r: 8, deep: 2.2, bank: 0.22 },
    { a: dirOf(3.8, -0.82), b: dirOf(3.55, -0.86), r: 14, deep: 2.5, bank: 0.2 }, // the south's long lake (Ontario Lacus)
    { a: dirOf(0.9, -0.88), r: 10, deep: 2.2, bank: 0.22 },
  ].map((p, i) => ({ ...p, seed: i * 4.3 + 1 })),
};

// Misty's dunes (#59), like Titan's: long ridges in fields, mostly round the middle, with flat
// ground between them. Two sets, each ridged across its own direction `axis` (the ridges run
// round it, so their heading changes across the moon), `k` ridges per radian (about 17 and 21 m
// apart), bent by a gentle domain warp. Where both sets meet they cross.
const MISTY_DUNES = [
  { axis: [0.12, 0.3, 0.95], k: 59, off: 0 },
  { axis: [0.62, -0.38, 0.69], k: 48, off: 17 },
].map((d) => {
  const l = Math.hypot(...d.axis);
  const a = d.axis.map((c) => c / l);
  // Two directions square to the axis: coordinates along the ridges.
  let b = [a[1], -a[0], 0];
  const bl = Math.hypot(...b);
  b = b.map((c) => c / bl);
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return { ...d, axis: a, b, c };
});

function makeMisty() {
  const { fbm, noise } = makeNoise(131);
  const pools = makePools(MISTY_LAKES.pools, MISTY_LAKES.radius, MISTY_LAKES.level, 137, MISTY_LAKES.soft);
  // The lay of the land (#59) comes from one broad field, `g`: the plains' slow swell, and where
  // it's high, the rolling uplands (like Titan's bright Xanadu): big regions with soft edges.
  // Metres from the nearest lake's round shore (no wobble: smooth all the way out, where
  // shoreDist() switches from exact to rough). For the low ground round the lakes and the dunes.
  const lakeDist = (x, y, z) => {
    let best = Infinity;
    for (const p of pools.list) {
      let t = 0;
      if (p.ab2 > 0) t = Math.max(0, Math.min(1, ((x - p.a.x) * p.ab[0] + (y - p.a.y) * p.ab[1] + (z - p.a.z) * p.ab[2]) / p.ab2));
      const dx = x - p.a.x - p.ab[0] * t, dy = y - p.a.y - p.ab[1] * t, dz = z - p.a.z - p.ab[2] * t;
      best = Math.min(best, Math.sqrt(dx * dx + dy * dy + dz * dz) * MISTY_LAKES.radius - p.r);
    }
    return best;
  };
  // The low ground round the lakes: 1 at the shore, nothing 60 m out (so the lakes sit in hollows;
  // wobbled, so the hollows aren't round).
  const lowland = (s) => 1 - smooth(0, 60, s);
  // The dunes here: `shape.dune` their height (0..1, 1 on a tall crest) and `shape.sand` how much
  // dune field this is (0..1, the dark sand between the ridges too).
  const dune = (x, y, z, up, s) => {
    shape.dune = 0;
    shape.sand = 0;
    // Round the middle, off the uplands, never on the lakes' banks.
    const where = (1 - smooth(0.4, 0.72, Math.abs(z))) * (1 - 0.9 * up) * smooth(6, 22, s);
    if (where <= 0) return;
    // Fields with gaps between (plains, or ground too hard for sand).
    const where2 = where * smooth(-0.45, 0.2, noise(x * 1.7 + 41, y * 1.7, z * 1.7));
    if (where2 <= 0) return;
    shape.sand = where2;
    // One set's here, the other's there, crossing only in a narrow strip where they meet.
    const f = noise(x * 2.1 + 5, y * 2.1, z * 2.1);
    // One gentle warp for both sets (a shift across the ridges): they meander, fork and bend.
    const warp = noise(x * 3.1 + 11, y * 3.1, z * 3.1) * 0.05;
    for (let i = 0; i < MISTY_DUNES.length; i++) {
      const d = MISTY_DUNES[i], a = d.axis;
      const along = x * a[0] + y * a[1] + z * a[2];
      // (Near the set's own poles its ridges would curl into rings: faded out there.)
      const field = smooth(-0.1, 0.15, i ? -f : f) * smooth(0.55, 0.85, Math.sqrt(1 - along * along)) * where2;
      if (field <= 0) continue;
      const across = along + warp * (i ? -0.8 : 1);
      const c = 0.5 + 0.5 * Math.cos(across * d.k);
      // Each crest rises and falls along its length and breaks off: dunes of all lengths, 30 to
      // 150 m (noise stretched along the ridges: quick across them, slow along them).
      const b = d.b, e = d.c;
      const run = smooth(-0.4, 0.05, noise(across * 6 + d.off, (x * b[0] + y * b[1] + z * b[2]) * 2.6, (x * e[0] + y * e[1] + z * e[2]) * 2.6));
      // (Added so they join without a crease, as max() would leave.)
      const h = c * c * field * run;
      shape.dune += h - shape.dune * h;
    }
  };
  // All of it at once, shared by height and colour (the mesh asks for both at each vertex in
  // turn, so the last point's answer is kept).
  const shape = { up: 0, dune: 0, sand: 0, low: 0, h: 0, x: NaN, y: 0, z: 0 };
  const lay = (x, y, z) => {
    if (x === shape.x && y === shape.y && z === shape.z) return shape;
    shape.x = x;
    shape.y = y;
    shape.z = z;
    const s = lakeDist(x, y, z);
    const g = fbm(x * 1.3 + 7, y * 1.3, z * 1.3, 3);
    const up = smooth(0.02, 0.32, g); // 0 on the plains, 1 up on the uplands
    const low = s < 85 ? lowland(s + noise(x * 6 + 3, y * 6, z * 6 + 9) * 25) : 0;
    // Plains: nearly flat, a slow swell. Uplands: rounded hills. Hollows round the lakes.
    const swell = g * 2;
    const hills = up > 0 ? up * (1.6 + 1.9 * fbm(x * 4.5, y * 4.5 + 5, z * 4.5, 3)) : 0;
    dune(x, y, z, up, s);
    shape.up = up;
    shape.low = low;
    shape.h = swell * 1.4 + hills + shape.dune * 2.2 - low * 2.2;
    return shape;
  };
  return {
    liquid: { kind: 'methane', level: MISTY_LAKES.level },
    pools,
    height(x, y, z) {
      return pools.carve(x, y, z, lay(x, y, z).h);
    },
    color(x, y, z, h) {
      const { up, dune: d, sand, low } = lay(x, y, z);
      // Brown-orange plains, brighter uplands (like Titan's Xanadu), dark brown dune fields.
      const n = fbm(x * 5 + 2, y * 5, z * 5, 3);
      let c = mix(rgb(0x84552c), rgb(0x6c4322), n + 0.5);
      c = mix(c, rgb(0xb07c44), up * smooth(0.6, 2.4, h) * 0.85);
      // (Troughs darker, crests catching the light, so the dunes read through the haze; #53.)
      c = mix(c, rgb(0x3a2512), smooth(0, 1, sand) * 0.75);
      c = mix(c, rgb(0xa8763f), smooth(0.35, 0.85, d) * 0.7);
      // Round the lakes: dark, damp shores in the low ground.
      const s = pools.shoreDist(x, y, z);
      c = mix(c, rgb(0x4a3019), low * 0.35);
      if (s < 6) c = mix(c, rgb(0x2e2114), 1 - smooth(0, 6, s));
      return c;
    },
  };
}

// Gas giants' clouds are banded around a tilted spin axis so both map and flight views show stripes.
export const RINGO_AXIS = (() => {
  const t = 0.6;
  return { x: 0.25, y: Math.sin(t), z: Math.cos(t) };
})();

// Tumble is tipped on its side like Uranus: its axis lies almost in the flight plane, so its
// stripes and rings stand upright (tipped a little towards the camera so the rings still show).
export const TUMBLE_AXIS = (() => {
  const v = { x: 0.88, y: 0.15, z: 0.48 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();

// Yonder (#62) is tipped over like Pluto (and Uranus): its axis lies well out of square with the
// flight plane, leaning towards the camera, so its pale north pole shows from orbit and its dark
// reddish belt round the middle crosses the view. Rocky, so nothing spins: only its ground's
// pattern follows the axis.
export const YONDER_AXIS = (() => {
  const v = { x: -0.5, y: 0.55, z: 0.67 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();

/** Spin axis of each gas giant (bands, rings and the slow spin of the mesh), and Yonder's (its ground's pattern). */
export const SPIN_AXES = { ringo: RINGO_AXIS, tumble: TUMBLE_AXIS, yonder: YONDER_AXIS };

/**
 * The pole of a spin axis that the game's cameras see (#55: Tumble's hexagon). They all look at
 * the flight plane from its front (+z), so it's the end of the axis leaning towards +z (Tumble's
 * lies nearly in the plane, tipped a little towards the camera). A unit direction.
 */
export function facingPole(axis) {
  const k = (axis.z < 0 ? -1 : 1) / Math.hypot(axis.x, axis.y, axis.z);
  return { x: axis.x * k, y: axis.y * k, z: axis.z * k };
}

function makeBanded(axis, bands, seed, { warp = 0.25, stripes = 1.6 } = {}) {
  const { fbm } = makeNoise(seed);
  const al = Math.hypot(axis.x, axis.y, axis.z);
  return {
    height() {
      return 0;
    },
    color(x, y, z) {
      const lat = (x * axis.x + y * axis.y + z * axis.z) / al;
      const f = (lat + fbm(x * 3, y * 3, z * 3, 4) * warp + 1) * 0.5 * (bands.length - 1) * stripes;
      const i = Math.floor(f);
      const a = rgb(bands[((i % bands.length) + bands.length) % bands.length]);
      const b = rgb(bands[(((i + 1) % bands.length) + bands.length) % bands.length]);
      return mix(a, b, smooth(0.35, 0.65, f - i));
    },
  };
}

/**
 * Each gas giant's cloud bands (colours from pole to pole, repeated `stripes` times, wobbled by
 * `warp`). Shared with the per-pixel cloud shader (src/world/richLook.js, #51).
 */
export const GAS_BANDS = {
  ringo: { bands: [0xf1e3c2, 0xd9b77e, 0xe9d2a2, 0xc28d5a, 0xf3e7cb, 0xb87a4e, 0xe4c58f], warp: 0.25, stripes: 1.6 },
  // Ice giants are nearly plain, so only faint pale stripes.
  tumble: { bands: [0x8fd8d2, 0x7fcfcb, 0x9fe0da, 0x76c6c4, 0x8ad4d0, 0xa9e6e0], warp: 0.15, stripes: 1.2 },
};

const makeRingo = () => makeBanded(RINGO_AXIS, GAS_BANDS.ringo.bands, 79, GAS_BANDS.ringo);
const makeTumble = () => makeBanded(TUMBLE_AXIS, GAS_BANDS.tumble.bands, 83, GAS_BANDS.tumble);

// Flip's frosty geysers, like Triton's: placed by hand near the flight plane (z = 0, a little
// towards the camera) so they show while flying. `lean` is the way the wind blows each plume,
// and the dark streak it leaves on the ice points the same way. Exported for the plumes.
export const FLIP_GEYSERS = [
  [0.5, 0.08, 0.7], [1.75, 0.16, 0.4], [2.9, 0.05, 1.0], [4.1, 0.2, 0.55], [5.3, 0.1, 0.8], [2.3, 0.72, 0.6],
].map(([a, z, size], i) => {
  const s = Math.sqrt(1 - z * z);
  const up = { x: s * Math.cos(a), y: s * Math.sin(a), z };
  // Same tangent frame as the plumes use (src/world/ambient.js basis()).
  let t1 = { x: -up.y, y: up.x, z: 0 };
  const l1 = Math.hypot(t1.x, t1.y);
  t1 = { x: t1.x / l1, y: t1.y / l1, z: 0 };
  const t2 = { x: up.y * t1.z - up.z * t1.y, y: up.z * t1.x - up.x * t1.z, z: up.x * t1.y - up.y * t1.x };
  const lean = 2.2 + i * 0.15; // a steady wind: every plume blows roughly the same way
  const wind = { x: t1.x * Math.cos(lean) + t2.x * Math.sin(lean), y: t1.y * Math.cos(lean) + t2.y * Math.sin(lean), z: t1.z * Math.cos(lean) + t2.z * Math.sin(lean) };
  return { ...up, size, depth: lean / (Math.PI * 2), lean, wind };
});

function makeFlip() {
  const { fbm, noise } = makeNoise(97);
  const vents = FLIP_GEYSERS;
  // Triton's "cantaloupe" ground: lots of little dimples with ridges between them.
  const melon = (x, y, z) => 1 - Math.abs(noise(x * 6, y * 6, z * 6));
  const streak = (x, y, z) => {
    let k = 0;
    for (const v of vents) {
      const rx = x - v.x, ry = y - v.y, rz = z - v.z;
      const along = rx * v.wind.x + ry * v.wind.y + rz * v.wind.z;
      if (along < 0 || along > 0.45) continue;
      const px = rx - along * v.wind.x, py = ry - along * v.wind.y, pz = rz - along * v.wind.z;
      const side = Math.hypot(px, py, pz);
      k = Math.max(k, (1 - smooth(0.1, 0.45, along)) * (1 - smooth(0.02, 0.05 + along * 0.2, side)));
    }
    return k;
  };
  return {
    height(x, y, z) {
      let h = fbm(x * 2.2, y * 2.2, z * 2.2, 4) * 3 + melon(x, y, z) * 1.6;
      for (const v of vents) {
        const d = Math.acos(Math.min(1, x * v.x + y * v.y + z * v.z));
        if (d < 0.14) h += (1 - smooth(0, 0.14, d)) * 2.5 - (1 - smooth(0.01, 0.04, d)) * 2;
      }
      return h;
    },
    color(x, y, z, h) {
      const n = fbm(x * 4, y * 4, z * 4, 3);
      let c = mix(rgb(0xeee0da), rgb(0xc5d2dc), smooth(-0.2, 0.3, n));
      // A pink frosty cap, and pink patches drifting down towards the middle.
      c = mix(c, rgb(0xf2c4b8), Math.max(smooth(0.4, 0.6, z), smooth(0.25, 0.45, noise(x * 2 + 5, y * 2, z * 2)) * 0.7));
      c = mix(c, rgb(0xb7c1cc), smooth(0.9, 0.99, melon(x, y, z)) * 0.5);
      c = mix(c, rgb(0x6d6672), streak(x, y, z) * 0.8);
      for (const v of vents) {
        const d = Math.acos(Math.min(1, x * v.x + y * v.y + z * v.z));
        c = mix(c, rgb(0x514b58), 1 - smooth(0.015, 0.05, d));
      }
      return c;
    },
  };
}

// Ducky, the comet: two icy lobes joined by a neck, like comet 67P's rubber duck (a big body and
// a smaller head, both lying in the flight plane so the rocket's view shows the duck).
// The ground is the far side of whichever lobe a ray from the middle leaves last, blended so
// the neck is a smooth valley, not a crease.
const DUCK_LOBES = [
  { c: [-0.3, -0.05, 0], r: 0.95 }, // body
  { c: [0.48, 0.2, 0], r: 0.6 }, // head (the middle stays inside it, so every ray leaves it once)
];

// Ducky's gas jets: sunlight warms the ice, and gas fizzes out of little vents (67P's jets).
// Placed near the flight plane (z = 0, a little towards the camera) so they show while flying.
// Exported for the plumes and for the buggy, which the jets push around (JETS in buggy.js).
export const DUCKY_JETS = [
  [-2.6, 0.12, 0.9], [-1.4, 0.18, 0.6], [0.2, 0.1, 0.8], [1.2, 0.2, 0.7], [2.3, 0.08, 1.0], [3.0, 0.45, 0.6], [-0.6, -0.5, 0.7],
].map(([a, z, size]) => {
  const s = Math.sqrt(1 - z * z);
  return { x: s * Math.cos(a), y: s * Math.sin(a), z, size };
});

function makeDucky() {
  const { fbm, noise } = makeNoise(113);
  const pits = randomDirs(29, 14).map((c) => ({ ...c, radius: 0.1 + c.size * 0.2, deep: 0.8 + c.depth * 1.5 }));
  const lobe = (x, y, z, l) => {
    const b = x * l.c[0] + y * l.c[1] + z * l.c[2];
    const cc = l.c[0] * l.c[0] + l.c[1] * l.c[1] + l.c[2] * l.c[2];
    return b + Math.sqrt(Math.max(0, b * b - cc + l.r * l.r));
  };
  const shape = (x, y, z) => {
    // A smooth maximum of the two lobes (k sets how soft the neck is).
    const k = 10;
    let sum = 0;
    for (const l of DUCK_LOBES) sum += Math.exp(k * lobe(x, y, z, l));
    return Math.log(sum) / k;
  };
  const jet = (x, y, z) => {
    let d = Infinity;
    for (const v of DUCKY_JETS) d = Math.min(d, Math.acos(Math.min(1, x * v.x + y * v.y + z * v.z)));
    return d;
  };
  return {
    height(x, y, z) {
      let h = (shape(x, y, z) - 1) * 40 + fbm(x * 3, y * 3, z * 3, 4) * 2.5 + craters(pits, x, y, z, 1);
      const d = jet(x, y, z);
      if (d < 0.12) h -= (1 - smooth(0.02, 0.12, d)) * 1.5; // a little vent hollow
      return h;
    },
    color(x, y, z, h) {
      // Dark dusty ice (real comets are darker than coal), with bright frost in the hollows
      // and a fizz of white frost around each jet.
      const n = fbm(x * 5, y * 5, z * 5, 3);
      let c = mix(rgb(0x5d6470), rgb(0x444955), n + 0.5);
      c = mix(c, rgb(0xdfe9f2), smooth(0.2, 0.42, noise(x * 3 + 7, y * 3, z * 3)) * 0.85);
      c = mix(c, rgb(0x8a95a3), smooth(-3, -8, h) * 0.6);
      const d = jet(x, y, z);
      c = mix(c, rgb(0xf4fbff), 1 - smooth(0.04, 0.16, d));
      c = mix(c, rgb(0x2c3038), 1 - smooth(0.01, 0.035, d));
      return c;
    },
  };
}

// Yonder (#62), like Pluto: smooth pale plains of nitrogen ice, a belt of dark reddish-brown
// "tholin" lands round its middle (Pluto's Cthulhu is that colour: sunlight baking the ice's
// methane into a sticky red goo), broken into big patches, with a peach edge between the two,
// and bluish frost towards the poles. The dark lands are older, so they're hillier and have a few
// soft craters; the ice plains are young and smooth. Gentle all over: it's for driving on.
// And its heart (#62 stage 2, YONDER_HEART), like Pluto's Tombaugh Regio, with its mountains and
// glaciers.
const YONDER_PITS = randomDirs(211, 18);

// The heart's outline (heart units): two round lobes (middle x, y and radius; mirrored) and the
// sides running from its point at (0, 0) to touch them.
const HEART_LOBE = [0.3, 0.72, 0.36];
// Up each side: its unit direction (s1, s0 as x, y) and where it touches the lobe.
const [HEART_SIDE, HEART_TAN] = (() => {
  const [cx, cy, r] = HEART_LOBE;
  const c = Math.hypot(cx, cy);
  const a = Math.atan2(cy, cx) - Math.asin(r / c);
  const t = Math.sqrt(c * c - r * r);
  return [[Math.sin(a), Math.cos(a)], [Math.cos(a) * t, Math.sin(a) * t]];
})();

/**
 * Signed distance to a cartoon heart, in heart units: its point at (0, 0), two round lobes
 * meeting in a notch at (0, 0.92), 1.08 tall and 1.32 wide; negative inside. (Exact outside,
 * near enough inside, for soft masks.)
 */
export function heartDist(x, y) {
  const [lx, ly, lr] = HEART_LOBE;
  x = Math.abs(x);
  const circle = Math.hypot(x - lx, y - ly) - lr;
  // The body: from the point up the two sides to the lobes' middles.
  const side = x * HEART_SIDE[0] - y * HEART_SIDE[1];
  const top = y - ly;
  const inner = (x - HEART_TAN[0]) * HEART_SIDE[1] + (y - HEART_TAN[1]) * HEART_SIDE[0];
  return Math.min(circle, Math.max(side, top, inner));
}

/**
 * Yonder's heart (#62 stage 2), like Pluto's Tombaugh Regio: a big pale plain of nitrogen ice
 * shaped like a heart, on the side the cameras see (+z), upright on the map. `c` its middle (a
 * unit direction), `up` and `right` its frame along the ground there (`up`: the map's up, world
 * +y, turned `turn` radians), `size` radians of ground per heart unit, `mid` the heart units
 * from its point up to `c`. Its left lobe (like Sputnik Planitia) is a smooth basin `deep`
 * metres down with slowly churning convection cells (the ground shader, richLook.js
 * `HEART_LOOK`); its right lobe is mottled frost on higher ground (`east` m up); glaciers
 * flow from it down into the basin. Placed well in on the side the cameras see, so the whole
 * heart shows upright from the map and from orbit (a test checks); it doesn't reach the flight
 * plane, so the buggy drives to it from the landing strip (`HEART_NEAR` is on the way).
 */
export const YONDER_HEART = (() => {
  const { phi, elev, turn, size } = globalThis.__HEART ?? { phi: 2.2, elev: 1.1, turn: 0, size: 0.85 };
  const c = dirOf(phi, Math.sin(elev));
  let up = [-c.y * c.x, 1 - c.y * c.y, -c.y * c.z];
  const ul = Math.hypot(...up);
  up = up.map((v) => v / ul);
  let right = [up[1] * c.z - up[2] * c.y, up[2] * c.x - up[0] * c.z, up[0] * c.y - up[1] * c.x];
  const k = Math.cos(turn), s = Math.sin(turn);
  [up, right] = [up.map((v, i) => v * k - right[i] * s), right.map((v, i) => v * k + up[i] * s)];
  return { c, up: { x: up[0], y: up[1], z: up[2] }, right: { x: right[0], y: right[1], z: right[2] }, size, mid: 0.54, deep: 1.8, east: 0.6 };
})();

/** Where direction (x, y, z) is in the heart's frame, in heart units (its point at (0, 0)); into `out`. */
export function heartAt(x, y, z, out = { u: 0, v: 0 }) {
  const H = YONDER_HEART;
  const cc = x * H.c.x + y * H.c.y + z * H.c.z;
  const a = x * H.right.x + y * H.right.y + z * H.right.z;
  const b = x * H.up.x + y * H.up.y + z * H.up.z;
  // Along the ground from the middle (azimuthal equidistant: true distances from it).
  const t = Math.hypot(a, b);
  const k = t > 1e-12 ? Math.atan2(t, cc) / t / H.size : 1 / H.size;
  out.u = a * k;
  out.v = b * k + H.mid;
  return out;
}

/** The unit direction at (u, v) in the heart's frame (heartAt's inverse). */
export function heartDir(u, v) {
  const H = YONDER_HEART;
  const a = u * H.size, b = (v - H.mid) * H.size;
  const ang = Math.hypot(a, b);
  const k = ang > 1e-12 ? Math.sin(ang) / ang : 1;
  const c = Math.cos(ang);
  return {
    x: H.c.x * c + (H.right.x * a + H.up.x * b) * k,
    y: H.c.y * c + (H.right.y * a + H.up.y * b) * k,
    z: H.c.z * c + (H.right.z * a + H.up.z * b) * k,
  };
}

// The line between the heart's two lobes: west of it (u below this) is the basin. From the
// notch at the top down to the right side, like Sputnik Planitia's eastern shore.
const heartShore = (v) => 0.6 * Math.max(0, 0.9 - v) - 0.02;

// Glaciers (#62 stage 2): tongues of nitrogen ice flowing from the right lobe's uplands west
// down into the basin, square to its shore, like the ones on Pluto's heart. Where each crosses
// the shore (`v`, heart units), how far back into the uplands it starts and out onto the basin
// it spreads (`back`, `out`), and how wide it is (`w`; its snout spreads a little wider).
export const YONDER_GLACIERS = [
  { v: 0.36, back: 0.12, out: 0.12, w: 0.045 },
  { v: 0.5, back: 0.22, out: 0.13, w: 0.06 },
  { v: 0.72, back: 0.16, out: 0.1, w: 0.045 },
].map((g) => {
  // Down the flow: square to the shore line (du/dv = -0.6), pointing west.
  const f = [-1, -0.6].map((c) => c / Math.hypot(1, 0.6));
  const s = [heartShore(g.v), g.v];
  return { ...g, a: [s[0] - f[0] * g.back, s[1] - f[1] * g.back], f, len: g.back + g.out };
});

// Water-ice mountains (#62 stage 2) standing along the basin's west side, like Pluto's Tenzing
// and Hillary Montes: tall, blocky, pale. Each is a rounded block (`r` [long, short] metres
// half-widths, turned `turn`), `h` metres tall, with a flat, tilted top (`tilt`: metres of fall
// across it), at `t` of the way up the heart's left side (from its point to the lobe) and `out`
// heart units outside it. Kept well clear of the flight plane (the rocket's landing strip and
// where the buggy rolls out; a test checks).
const YONDER_PEAKS = [
  { t: 0.25, out: 0.14, r: [20, 13], h: 11, turn: 0.3, tilt: 2 },
  { t: 0.45, out: 0.17, r: [17, 15], h: 14, turn: -0.4, tilt: -3 },
  { t: 0.62, out: 0.14, r: [22, 13], h: 12, turn: 0.9, tilt: 2.5 },
  { t: 0.8, out: 0.18, r: [16, 12], h: 10, turn: -0.7, tilt: -2 },
  { t: 0.95, out: 0.15, r: [15, 11], h: 8, turn: 0.2, tilt: 2 },
];

function makeYonder() {
  const { fbm, noise } = makeNoise(223);
  const ax = YONDER_AXIS;
  const H = YONDER_HEART;
  const R = 170; // Yonder's radius (bodies.js), for the mountains' sizes in metres
  const lat = (x, y, z) => x * ax.x + y * ax.y + z * ax.z;
  // The mountains' blocks: a frame along the ground at each.
  const peaks = YONDER_PEAKS.map((p) => {
    const [sx, sy] = HEART_SIDE, [tx, ty] = HEART_TAN;
    // Out from the heart's left side (square to it, pointing away from the middle).
    const d = heartDir(-(tx * p.t) - sy * p.out, ty * p.t - sx * p.out);
    let e = [-d.y, d.x, 0];
    const el = Math.hypot(e[0], e[1]);
    e = e.map((v) => v / el);
    const n = [d.y * e[2] - d.z * e[1], d.z * e[0] - d.x * e[2], d.x * e[1] - d.y * e[0]];
    const k = Math.cos(p.turn), s = Math.sin(p.turn);
    const a = e.map((v, i) => (v * k + n[i] * s) / (p.r[0] / R));
    const b = n.map((v, i) => (n[i] * k - e[i] * s) / (p.r[1] / R));
    return { ...p, ...d, a, b, cos: Math.cos((Math.max(p.r[0], p.r[1]) * 1.1) / R) };
  });
  const hp = { u: 0, v: 0 };
  // Everything about the heart at a point, worked out once (the mesh asks height then colour at
  // each vertex; the buggy asks height a few times a step): `near` 0..1 close to it, `in`
  // inside, `basin` the left lobe's plain, `east` the right lobe, `sd` the (wobbled) distance to
  // its edge in heart units, `glacier` 0..1 on a glacier and `flow` metres across it from its
  // middle line, `peak` 0..1 up a mountain (`peakH` its height, m).
  const heart = { x: NaN, y: 0, z: 0, near: 0, in: 0, basin: 0, east: 0, sd: 1, eastSide: 0, glacier: 0, flow: 0, glacierH: 0, peak: 0, peakH: 0, west: 0, u: 0, v: 0 };
  const heartOf = (x, y, z) => {
    if (x === heart.x && y === heart.y && z === heart.z) return heart;
    heart.x = x; heart.y = y; heart.z = z;
    heart.near = 0; heart.in = 0; heart.basin = 0; heart.east = 0; heart.sd = 1; heart.eastSide = 0; heart.glacier = 0; heart.peak = 0; heart.peakH = 0; heart.west = 0;
    if (x * H.c.x + y * H.c.y + z * H.c.z < 0.05) return heart;
    heartAt(x, y, z, hp);
    heart.u = hp.u;
    heart.v = hp.v;
    // Like Pluto's, not a drawn heart: lopsided (the left lobe a bigger teardrop, the right one
    // smaller and a little lower) and wobbly at every scale. (`heartDist()` stays the tidy
    // shape the rest works from; this is where it's roughened.)
    const eastSide = smooth(-0.05, 0.25, hp.u);
    // (The left lobe leans out and down into a teardrop, like Sputnik Planitia.)
    const wu = hp.u < 0 ? hp.u * (0.8 + 0.12 * smooth(0.2, 0.9, hp.v)) : hp.u * 1.12;
    const wv = hp.v + 0.1 * Math.max(0, hp.u) - 0.12 * Math.min(0, hp.u);
    const sd = heartDist(wu, wv) + 0.12 * noise(x * 2.6 + 13, y * 2.6, z * 2.6) + 0.05 * noise(x * 7 + 3, y * 7 + 1, z * 7)
      + (1 - eastSide) * (0.11 * noise(x * 5.5 + 21, y * 5.5, z * 5.5 + 4) + 0.045 * noise(x * 12 + 2, y * 12 + 8, z * 12))
      + 0.01 * noise(x * 23, y * 23 + 5, z * 23);
    heart.sd = sd;
    heart.eastSide = eastSide;
    // (The heart's west: the dark lands and the mountains.)
    // (Only near the heart: far round the world the heart's frame still says "west".)
    heart.west = smooth(-0.05, -0.35, hp.u) * (1 - smooth(0.6, 1.05, hp.v)) * (1 - smooth(0.35, 0.6, sd));
    heart.near = 1 - smooth(0.1, 0.6, sd);
    if (heart.near <= 0 && heart.west <= 0) return heart;
    // Its west edge fairly sharp (the dark lands and the mountains meet it there); the right
    // lobe's edge breaks up into ragged frost fading into the ground.
    const rag = eastSide * (0.07 * noise(x * 13 + 5, y * 13, z * 13 + 2) + 0.035 * noise(x * 31, y * 31 + 9, z * 31));
    heart.in = 1 - smooth(-0.015 - 0.05 * eastSide, 0.01 + 0.07 * eastSide, sd + rag);
    // The left lobe and the point: west of the shore line (wobbled). A gentle bank.
    const shore = heartShore(hp.v) + 0.03 * noise(x * 6 + 3, y * 6 + 1, z * 6);
    heart.basin = (1 - smooth(-0.05, 0.005, sd)) * (1 - smooth(shore - 0.035, shore + 0.035, hp.u));
    heart.east = heart.in * (1 - heart.basin);
    // Glaciers: how far along (s, 0..1) and across (in widths) each tongue.
    for (const g of YONDER_GLACIERS) {
      const du = hp.u - g.a[0], dv = hp.v - g.a[1];
      const along = du * g.f[0] + dv * g.f[1];
      if (along < -0.05 || along > g.len + 0.08) continue;
      const s = along / g.len;
      // Narrow up in its valley, spreading out onto the plain, wobbling so it isn't ruler-straight.
      const w = g.w * (0.45 + 0.9 * smooth(0.1, 0.95, s)) * (1 + 0.2 * noise(x * 9, y * 9, z * 9 + 2));
      const bend = 0.25 * g.w * noise(along * 14 + g.v * 9, g.v * 3, 1.7);
      const across = (du * g.f[1] - dv * g.f[0] - bend) / w;
      // Its source fades in; its snout is a rounded lobe.
      const tip = g.len + 0.03 * (1 - across * across);
      const ends = smooth(-0.04, 0.06, along) * (1 - smooth(tip - 0.035, tip + 0.02, along));
      const k = (1 - smooth(0.35, 1.1, Math.abs(across))) * ends * heart.in;
      if (k > heart.glacier) {
        heart.glacier = k;
        heart.flow = across * w * H.size * R; // metres across, for the flow lines
        // Its surface: sliding smoothly from the uplands down to a little above the basin.
        // (Down the shore's bank, over a longer, gentler slope than the bank beside it.)
        heart.glacierH = H.east + (-H.deep + 0.25 - H.east) * smooth(g.back - 0.09, g.back + 0.05, along);
      }
    }
    // Mountains: blocks with steep round sides and flat tilted tops.
    for (const p of peaks) {
      if (x * p.x + y * p.y + z * p.z < p.cos) continue;
      const a = x * p.a[0] + y * p.a[1] + z * p.a[2], b = x * p.b[0] + y * p.b[1] + z * p.b[2];
      const q = Math.sqrt(Math.sqrt(a * a * a * a + b * b * b * b));
      const k = 1 - smooth(0.45, 1, q);
      if (k <= 0) continue;
      // Craggy: broken faces and a lumpy top (noise about 8 m across), never a smooth dome.
      const top = (p.h + p.tilt * a * 0.5) * (1 + 0.22 * noise(x * 21 + p.t * 17, y * 21, z * 21));
      const hh = top * k;
      if (hh > heart.peakH) {
        heart.peakH = hh;
        heart.peak = k;
      }
    }
    return heart;
  };
  // How much of the dark lands is here (0..1). Wide edges in noise units (#59: Perlin noise is
  // steep). Next to the heart, like Cthulhu beside Pluto's, a dark land to its west; none on it.
  const tholin = (x, y, z) => {
    const belt = 1 - smooth(0.25, 0.65, Math.abs(lat(x, y, z) + 0.12 * noise(x * 2 + 3, y * 2, z * 2)));
    let th = belt * smooth(-0.2, 0.2, noise(x * 1.4 + 7, y * 1.4, z * 1.4) + 0.06);
    const hr = heartOf(x, y, z);
    if (hr.west > 0 || hr.near > 0) {
      th = th + (1 - th) * hr.west * smooth(0.06, 0.2, hr.sd + 0.05 * noise(x * 3 + 1, y * 3, z * 3 + 4));
      th *= smooth(0.02, 0.1, hr.sd);
    }
    return th;
  };
  // Craters only in the dark lands (they're the old ground), 17 to 30 m across the rim.
  const pits = YONDER_PITS.filter((c) => tholin(c.x, c.y, c.z) > 0.6).map((c) => ({ ...c, radius: 0.1 + c.size * 0.08, deep: 1.6 + c.depth * 1.6 }));
  // Rolling hills, round-topped (a smooth step of the noise, never a crease).
  const hills = (x, y, z) => smooth(0.05, 0.55, noise(x * 3.2 + 11, y * 3.2, z * 3.2));
  return {
    pits,
    peaks,
    tholin,
    heart: heartOf,
    /** How much of the richer look's relief and fine detail goes here (0..1): little on the heart's ice. */
    richAt(x, y, z) {
      const hr = heartOf(x, y, z);
      return 1 - Math.max(0.85 * hr.basin, 0.85 * hr.glacier, 0.5 * hr.east);
    },
    /** No boulders here: the heart's smooth basin, its glaciers and the mountains' slopes. */
    bare(x, y, z) {
      const hr = heartOf(x, y, z);
      return hr.basin > 0.05 || hr.glacier > 0.05 || hr.peak > 0.02;
    },
    /** What the ground shader needs baked per vertex (#62 stage 2): the basin's cells, the glaciers' flow lines. */
    marks(x, y, z, out) {
      const hr = heartOf(x, y, z);
      out[0] = hr.near > 0 ? hr.u * H.size * R : 0;
      out[1] = hr.near > 0 ? hr.v * H.size * R : 0;
      out[2] = hr.basin * (1 - hr.glacier) * (1 - smooth(0, 0.03, hr.peak)); // (not on the mountains at its edge)
      out[3] = hr.glacier;
      out[4] = hr.glacier > 0 ? hr.flow : 0;
      return out;
    },
    height(x, y, z) {
      const th = tholin(x, y, z);
      let h = fbm(x * 1.6, y * 1.6, z * 1.6, 3) * 2 + hills(x, y, z) * (1.2 + 2.2 * th) + fbm(x * 5, y * 5, z * 5, 2) * (0.25 + 0.5 * th) + craters(pits, x, y, z, 1);
      const hr = heartOf(x, y, z);
      if (hr.near > 0) {
        h += (H.east + 0.4 * fbm(x * 4 + 2, y * 4, z * 4, 2) - h) * hr.east;
        h += (-H.deep + 0.06 * fbm(x * 6, y * 6 + 3, z * 6, 2) - h) * hr.basin;
        h += (hr.glacierH - h) * hr.glacier;
      }
      if (hr.peakH > 0) h += hr.peakH;
      return h;
    },
    color(x, y, z, h) {
      const n = fbm(x * 4, y * 4, z * 4, 3);
      const l = Math.abs(lat(x, y, z));
      // Creamy nitrogen ice, a little grey-blue in places, and faint peach tints.
      let c = mix(rgb(0xf7eee0), rgb(0xe2e4e8), smooth(-0.25, 0.3, n));
      c = mix(c, rgb(0xf0cfae), smooth(0.05, 0.4, noise(x * 2.3 + 5, y * 2.3, z * 2.3)) * 0.65 * (1 - smooth(0.4, 0.8, l)));
      // Bluish frost towards the poles.
      c = mix(c, rgb(0xe6eefa), smooth(0.55, 0.85, l) * 0.8);
      const hr = heartOf(x, y, z);
      // Round the heart: warmer, darker tan ground, so the pale heart stands out.
      // (Much darker than it looks: Ember's light over-exposes pale ground a lot, and the heart
      // must stay far brighter than its surroundings to read from space.)
      if (hr.near > 0) {
        // (Round the frosty east too, broken up, so the heart stands out from the pale plains
        // there without a drawn outline.)
        const k = hr.near * (1 - hr.in) * (1 - hr.eastSide * (0.25 + 0.35 * smooth(-0.2, 0.3, noise(x * 9 + 4, y * 9, z * 9 + 7))));
        c = mix(c, mix(rgb(0x7a4a30), rgb(0x5e3722), smooth(-0.3, 0.3, n)), k * (0.8 + 0.2 * noise(x * 5 + 9, y * 5, z * 5)));
        // A darker, redder rim where it meets the dark lands on its west (none round the east).
        c = mix(c, rgb(0x46241a), (1 - smooth(0.01, 0.07, hr.sd)) * (1 - hr.in) * 0.5 * (1 - hr.eastSide));
      }
      // The dark lands: a peach edge, then deep reddish brown.
      const th = tholin(x, y, z);
      c = mix(c, rgb(0xd49a72), smooth(0.05, 0.4, th) * 0.9);
      c = mix(c, mix(rgb(0x9a4629), rgb(0x6e2e1c), n + 0.5), smooth(0.3, 0.8, th));
      // Frost settles in the dark lands' hollows and crater floors.
      c = mix(c, rgb(0xc98e6e), smooth(0.5, 1, th) * smooth(-0.3, -1.6, h) * 0.6);
      if (hr.near > 0) {
        // The right lobe: mottled frost, bright and bluish-white patches and a few peach ones.
        const m = fbm(x * 7 + 4, y * 7, z * 7, 3);
        const east = mix(mix(rgb(0xfcfbf7), rgb(0xebf0f7), smooth(-0.12, 0.18, m)), rgb(0xf4e4d2), smooth(0.25, 0.5, noise(x * 12, y * 12 + 7, z * 12)) * 0.45);
        c = mix(c, east, hr.east);
        // The left lobe: smooth, the brightest ice on Yonder; the glaciers a touch bluer.
        c = mix(c, mix(rgb(0xfdfcf8), rgb(0xf1f4f8), n + 0.5), hr.basin);
        c = mix(c, rgb(0xb8d2f2), hr.glacier * 0.75);
      }
      // The mountains: pale blocks of water ice, bluish grey low down.
      if (hr.peak > 0) c = mix(c, mix(rgb(0x8d7468), rgb(0xf0f3f6), smooth(0.15, 0.75, hr.peak)), smooth(0, 0.2, hr.peak));
      return c;
    },
  };
}

function makeFlat(hex) {
  return { height: () => 0, color: () => rgb(hex) };
}

export function makeTerrain(kind) {
  switch (kind) {
    case 'home': return makeHome();
    case 'pebble': return makePebble();
    case 'dusty': return makeDusty();
    case 'nibble': return makeNibble();
    case 'sizzle': return makeSizzle();
    case 'frosty': return makeFrosty();
    case 'misty': return makeMisty();
    case 'ringo': return makeRingo();
    case 'tumble': return makeTumble();
    case 'flip': return makeFlip();
    case 'ducky': return makeDucky();
    case 'yonder': return makeYonder();
    default: return makeFlat(0xffd27a);
  }
}
