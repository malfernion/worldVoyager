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

// Bowl-with-a-rim crater profile. d = angular distance / crater radius.
function craterProfile(d) {
  if (d > 1.6) return 0;
  if (d < 1) return (d * d - 1) + 0.35 * smooth(0.6, 1, d);
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
// `bank` (metres up per metre out) until it meets the natural ground.
export function makePools(defs, radius, level, seed) {
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
  // Distance (m, along the ground, near enough) from p to a pool's middle line, and its shore's
  // distance from that line there.
  const measure = (p, x, y, z) => {
    let t = 0;
    if (p.ab2 > 0) t = Math.max(0, Math.min(1, ((x - p.a.x) * p.ab[0] + (y - p.a.y) * p.ab[1] + (z - p.a.z) * p.ab[2]) / p.ab2));
    const qx = p.a.x + p.ab[0] * t, qy = p.a.y + p.ab[1] * t, qz = p.a.z + p.ab[2] * t;
    const d = Math.hypot(x - qx, y - qy, z - qz) * radius;
    const shore = p.r * (1 + 0.2 * noise(x * 7 + p.seed, y * 7, z * 7));
    return { d, shore };
  };
  return {
    list,
    level,
    /** The ground at (x, y, z) with the pools carved into it: `h` is the natural height there. */
    carve(x, y, z, h) {
      for (const p of list) {
        if (x * p.mid.x + y * p.mid.y + z * p.mid.z < p.cos) continue;
        const { d, shore } = measure(p, x, y, z);
        if (d > shore + (h - level) / p.bank) continue;
        const s = d / shore;
        const bowl = s < 1 ? level - p.deep * (1 - s * s) : level + (d - shore) * p.bank;
        if (bowl < h) h = bowl;
      }
      return h;
    },
    /** How far (m) the nearest pool's shore is from (x, y, z): negative in a pool, Infinity far away. */
    shoreDist(x, y, z) {
      let best = Infinity;
      for (const p of list) {
        if (x * p.mid.x + y * p.mid.y + z * p.mid.z < p.cos) continue;
        const { d, shore } = measure(p, x, y, z);
        best = Math.min(best, d - shore);
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

// Sizzle's lava (#45): pools and short flows at the feet of the volcanoes, below one lava level
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
    { a: dirOf(1.04, 0.38), r: 9, deep: 2.5, bank: 0.35 }, // in view of Toasty's camp
    { a: dirOf(1.12, 0.64), b: dirOf(1.3, 0.72), r: 7, deep: 2, bank: 0.35 }, // a flow north of it
    { a: dirOf(2.72, 0.56), b: dirOf(2.52, 0.68), r: 8, deep: 2.2, bank: 0.35 }, // below the biggest volcano
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

/** Spin axis of each gas giant (bands, rings and the slow spin of the mesh). */
export const SPIN_AXES = { ringo: RINGO_AXIS, tumble: TUMBLE_AXIS };

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

const makeRingo = () => makeBanded(RINGO_AXIS, [0xf1e3c2, 0xd9b77e, 0xe9d2a2, 0xc28d5a, 0xf3e7cb, 0xb87a4e, 0xe4c58f], 79);

// Ice giants are nearly plain, so only faint pale stripes.
const makeTumble = () => makeBanded(TUMBLE_AXIS, [0x8fd8d2, 0x7fcfcb, 0x9fe0da, 0x76c6c4, 0x8ad4d0, 0xa9e6e0], 83, { warp: 0.15, stripes: 1.2 });

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
    case 'ringo': return makeRingo();
    case 'tumble': return makeTumble();
    case 'flip': return makeFlip();
    case 'ducky': return makeDucky();
    default: return makeFlat(0xffd27a);
  }
}
