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

function makeHome() {
  const { fbm, noise } = makeNoise(11);
  const sea = -1.5;
  const raw = (x, y, z) => {
    const n = fbm(x * 2.2, y * 2.2, z * 2.2, 5);
    const m = Math.max(0, fbm(x * 1.1 + 7, y * 1.1, z * 1.1, 3) - 0.1) * 70;
    return n * 20 + m + 3;
  };
  return {
    sea,
    height(x, y, z) {
      let h = raw(x, y, z);
      const d = Math.acos(Math.min(1, x * LAUNCH_DIR.x + y * LAUNCH_DIR.y + z * LAUNCH_DIR.z));
      h = h + (2.5 - h) * (1 - smooth(0.035, 0.12, d));
      return Math.max(h, sea);
    },
    color(x, y, z, h) {
      if (h <= sea + 0.01) {
        const deep = raw(x, y, z);
        return mix(rgb(0x3f93b8), rgb(0x245a8a), smooth(-2, -14, deep));
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

function makeNibble() {
  const { fbm } = makeNoise(41);
  const list = randomDirs(17, 10).map((c) => ({ ...c, radius: 0.2 + c.size * 0.35, deep: 1.5 + c.depth * 2 }));
  return {
    height(x, y, z) {
      // A lumpy potato, stretched along one axis.
      const stretch = 1 + 0.35 * x * x - 0.12 * z * z;
      return 30 * (stretch - 1) + fbm(x * 1.4, y * 1.4, z * 1.4, 4) * 10 + craters(list, x, y, z, 1);
    },
    color(x, y, z, h) {
      const n = fbm(x * 5, y * 5, z * 5, 3);
      return mix(mix(rgb(0x8f7c68), rgb(0x6f5f50), n + 0.5), rgb(0xb5a28a), smooth(6, 12, h));
    },
  };
}

// Sizzle's volcano vents. Exported so the plumes rise from exactly these spots.
export const SIZZLE_VENTS = randomDirs(8, 7);

function makeSizzle() {
  const { fbm, noise } = makeNoise(53);
  const vents = SIZZLE_VENTS;
  return {
    height(x, y, z) {
      let h = fbm(x * 2.8, y * 2.8, z * 2.8, 4) * 5;
      for (const v of vents) {
        const d = Math.acos(Math.min(1, x * v.x + y * v.y + z * v.z));
        if (d < 0.3) h += (1 - smooth(0, 0.3, d)) * 12 - (1 - smooth(0.02, 0.06, d)) * 5;
      }
      return h;
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
      return c;
    },
  };
}

function makeFrosty() {
  const { fbm, noise } = makeNoise(67);
  const crack = (x, y, z) => {
    const a = 1 - Math.abs(noise(x * 3.1, y * 3.1, z * 3.1));
    const b = 1 - Math.abs(noise(x * 5.3 + 11, y * 5.3, z * 5.3));
    return Math.max(smooth(0.93, 0.99, a), smooth(0.95, 0.995, b) * 0.8);
  };
  return {
    height(x, y, z) {
      return fbm(x * 2, y * 2, z * 2, 4) * 3 + crack(x, y, z) * 1.5;
    },
    color(x, y, z, h) {
      let c = mix(rgb(0xeef4f7), rgb(0xc7dcea), smooth(-0.2, 0.3, fbm(x * 4, y * 4, z * 4, 3)));
      c = mix(c, rgb(0xd8b08c), smooth(0.2, 0.45, noise(x * 2 + 3, y * 2, z * 2)) * 0.6);
      c = mix(c, rgb(0xa9553a), crack(x, y, z));
      return c;
    },
  };
}

// Ringo's clouds are banded around a tilted spin axis so both map and flight views show stripes.
export const RINGO_AXIS = (() => {
  const t = 0.6;
  return { x: 0.25, y: Math.sin(t), z: Math.cos(t) };
})();

function makeRingo() {
  const { fbm } = makeNoise(79);
  const ax = RINGO_AXIS;
  const al = Math.hypot(ax.x, ax.y, ax.z);
  const bands = [0xf1e3c2, 0xd9b77e, 0xe9d2a2, 0xc28d5a, 0xf3e7cb, 0xb87a4e, 0xe4c58f];
  return {
    height() {
      return 0;
    },
    color(x, y, z) {
      const lat = (x * ax.x + y * ax.y + z * ax.z) / al;
      const warp = fbm(x * 3, y * 3, z * 3, 4) * 0.25;
      const f = (lat + warp + 1) * 0.5 * (bands.length - 1) * 1.6;
      const i = Math.floor(f);
      const a = rgb(bands[((i % bands.length) + bands.length) % bands.length]);
      const b = rgb(bands[(((i + 1) % bands.length) + bands.length) % bands.length]);
      return mix(a, b, smooth(0.35, 0.65, f - i));
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
    default: return makeFlat(0xffd27a);
  }
}
