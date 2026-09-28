// Richer cartoon worlds (#51: Ringo, Dusty and Pebble so far): the same chunky toon look,
// with more depth, detail and motion, and cheap enough for phones. Nothing here changes
// geometry (the physics ground stays the visible mesh) or adds draw calls: it bakes shading
// into vertex colours once, and extends the worlds' toon materials with small shader snippets
// (a few value-noise lookups, no textures).
//
// A world opts in by having an entry in ROCKY_LOOK (rocky worlds) or GAS_LOOK (gas giants,
// whose bands come from GAS_BANDS in terrain.js); every other world keeps the plain toon look.
import * as THREE from 'three';
import { SPIN_AXES, GAS_BANDS, SIZZLE_VENTS, FROSTY_GLOWS, YONDER_BLADES, facingPole } from '../physics/terrain.js';
import { toonGradient } from './materials.js';

// Colours are used as raw 0..1 values, like the terrain's vertex colours (so the palettes match).
// ...or, given as [r, g, b], used as they are (RL_TINT's multipliers can be over 1).
const col = (v) => (Array.isArray(v) ? new THREE.Vector3(...v) : raw(v));
const raw = (hex) => new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

// ---- Baked relief shading (pure: tested in test/richLook.test.js) ----------------------------

/**
 * How much to brighten (> 1) or darken (< 1) each vertex's colour from the shape of the ground
 * round it. `heights` are the vertices' heights above the world's base radius, `index` the
 * triangles of a closed mesh. Each vertex is compared with the average height round it at a few
 * sizes (its neighbours, then wider and wider after more smoothing passes: about 1, 2.5 and 6
 * triangles out): below the average is a hollow (crater floors, valleys), above is a ridge or a crater's
 * rim. Scaled by how bumpy the whole world is, so one setting works for every world, then
 * softened `soften` times over the neighbours (#56) so small hollows shade as soft blobs, not
 * triangle-shaped patches. Runs once when the mesh is built (a few tens of milliseconds).
 */
export function reliefShade(heights, index, { dark = 0.3, light = 0.14, scales = [[1, 0.3], [6, 0.35], [32, 0.35]], soften = 2 } = {}) {
  const n = heights.length;
  const sum = new Float64Array(n);
  const count = new Uint16Array(n);
  // Each edge once: in a closed mesh every edge is in two triangles, once each way round, so
  // keeping only a < b lists it exactly once (half the work of listing both).
  const nb = new Uint32Array(index.length);
  let m = 0;
  for (let f = 0; f < index.length; f += 3) {
    for (let e = 0; e < 3; e++) {
      const a = index[f + e], b = index[f + ((e + 1) % 3)];
      if (a < b) { nb[m++] = a; nb[m++] = b; }
    }
  }
  for (let k = 0; k < m; k += 2) { count[nb[k]]++; count[nb[k + 1]]++; }
  let s = Float32Array.from(heights);
  const next = new Float32Array(n);
  const cav = new Float32Array(n);
  let done = 0;
  for (const [passes, weight] of scales) {
    for (; done < passes; done++) {
      sum.fill(0);
      for (let k = 0; k < m; k += 2) {
        const a = nb[k], b = nb[k + 1];
        sum[a] += s[b];
        sum[b] += s[a];
      }
      for (let i = 0; i < n; i++) next[i] = count[i] ? sum[i] / count[i] : s[i];
      s.set(next);
    }
    for (let i = 0; i < n; i++) cav[i] += weight * (heights[i] - s[i]);
  }
  // (Its strength is set before softening, so broad hollows keep their depth.)
  let rms = 0;
  for (let i = 0; i < n; i++) rms += cav[i] * cav[i];
  rms = Math.sqrt(rms / n) || 1;
  // Soften it (#56): a vertex's shade halfway to its neighbours' average, so on a coarse mesh
  // small hollows shade as soft blobs rather than triangle-shaped patches.
  for (let pass = 0; pass < soften; pass++) {
    sum.fill(0);
    for (let k = 0; k < m; k += 2) {
      const a = nb[k], b = nb[k + 1];
      sum[a] += cav[b];
      sum[b] += cav[a];
    }
    for (let i = 0; i < n; i++) cav[i] = count[i] ? 0.5 * (cav[i] + sum[i] / count[i]) : cav[i];
  }
  const shade = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = Math.tanh(cav[i] / (2 * rms)); // soft: -1 deep hollow .. 1 sharp ridge
    shade[i] = 1 + (t < 0 ? dark : light) * t;
  }
  return shade;
}

// ---- Shared GLSL -------------------------------------------------------------------------------

const NOISE = /* glsl */ `
  float rlHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  // Value noise, 0..1: eight hashes, no textures.
  float rlNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(rlHash(i), rlHash(i + vec3(1, 0, 0)), f.x), mix(rlHash(i + vec3(0, 1, 0)), rlHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(rlHash(i + vec3(0, 0, 1)), rlHash(i + vec3(1, 0, 1)), f.x), mix(rlHash(i + vec3(0, 1, 1)), rlHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
`;

// Rim and night fill, from the world's round shape (not the bumpy ground, which would light up
// every slope): `rlRadial` is the view-space direction out from the middle. The rim only shows
// from far enough out to see the world as a ball (`rlFar`).
const RIM_NIGHT = /* glsl */ `
  {
    vec3 rad = normalize(rlRadial);
    float sunK = dot(rad, rlSun);
    #ifdef RL_RIM_SURFACE
      // A world far from round (the comet): its round shape would put a rim across its middle.
      float edge = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
      float rimSun = dot(normal, rlSun);
    #else
      float edge = 1.0 - clamp(dot(rad, normalize(vViewPosition)), 0.0, 1.0);
      float rimSun = sunK;
    #endif
    // A cartoon rim: a band of sunlight hugging the lit edge, crisp inside, fading out.
    float rim = smoothstep(0.6, 0.72, edge) * (0.55 + 0.45 * smoothstep(0.72, 0.95, edge));
    rim *= smoothstep(-0.2, 0.3, rimSun) * smoothstep(1.25, 1.8, rlFar) * smoothstep(15.0, 45.0, rlHigh);
    outgoingLight += rlRimColor * rim * rlRimK;
    // Moonlight-blue fill: the ground's own colour, cooled and lifted (linear light, so modest).
    float nightK = 1.0 - smoothstep(-0.3, 0.1, sunK);
    outgoingLight += (diffuseColor.rgb * 0.75 + 0.25) * rlNightColor * rlNightK * nightK;
  }
`;

const VERT_PARS = /* glsl */ `
  uniform float rlRadius;
  varying vec3 rlObj;
  varying vec3 rlRadial;
  varying float rlFar;
  varying float rlHigh;
`;
const VERT_MAIN = /* glsl */ `
  rlObj = position;
  rlRadial = normalize(normalMatrix * position);
  // How far the camera is from the middle, in world radii (the map draws worlds bigger).
  rlFar = length((modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz) / (rlRadius * length(modelViewMatrix[0].xyz));
  // ...and how high above the ground it is in metres (on a tiny moon a buggy's camera is 2 radii out).
  rlHigh = (rlFar - 1.0) * rlRadius;
`;
const FRAG_PARS = /* glsl */ `
  uniform vec3 rlSun;
  uniform vec3 rlRimColor;
  uniform float rlRimK;
  uniform vec3 rlNightColor;
  uniform float rlNightK;
  varying vec3 rlObj;
  varying vec3 rlRadial;
  varying float rlFar;
  varying float rlHigh;
  ${NOISE}
`;

function defines(list) {
  return list.filter(([, on]) => on).map(([d]) => `#define ${d}\n`).join('');
}

// ---- Rocky worlds ------------------------------------------------------------------------------

/**
 * Ice sparkles (#54 stage 5: Frosty's): tiny glints on sunlit ice, each a crystal facet that
 * flashes when it mirrors the sun into the camera, so they twinkle as the camera moves (and a
 * little on their own). `cell` (m): the finest grid they're on (one glint spot per cell, at
 * most); further off the grid doubles so each spot stays a few pixels across (`sparkleCell()`);
 * `px` (m per pixel): over this they fade out (landed and driving: all of them; low orbit: a
 * few, faintly; the globe: none); `tilt`: how far the facets lean off the ground's (more: more
 * of them glint from any view); `sharp`: how exactly one must face the sun (0..1, higher: fewer);
 * `k`: how bright; `color` (raw 0..1, may be over 1).
 */
export const SPARKLE = { cell: 0.3, px: [0.25, 1.4], tilt: 2.2, sharp: 0.8, k: 1.2, color: [1, 1, 1] };

/**
 * The glint grid for a pixel covering `px` metres (pure; the shader does the same sums): the
 * finer cell `cell` (m), the next one up (twice it) and how much of that one to blend in, so a
 * spot always has about 20 (CSS) pixels' worth of cell (room for its little star), whatever the distance, and never pops.
 * `k`: how much of the sparkle is left at this distance (0..1).
 */
export function sparkleCell(px, look = SPARKLE, dpr = 1) {
  const L = Math.max(0, Math.log2((px * 20 * dpr) / look.cell));
  const f = Math.floor(L);
  return { cell: look.cell * 2 ** f, blend: L - f, k: 1 - smooth01(look.px[0], look.px[1], px) };
}

/**
 * Yonder's heart (#62 stage 2, `YONDER_HEART` in terrain.js): in its left lobe's smooth plain,
 * convection cells like Sputnik Planitia's, where the nitrogen ice slowly churns like a lava lamp
 * (warmer ice rises in each cell's middle, and sinks again at its edges); and flow lines along
 * its glaciers. Only in Yonder's ground shader (`#define RL_HEART`), from marks baked per vertex
 * (terrain.js `marks()`): no mesh, no draw call, no texture. `cell` (m): how wide a cell is;
 * `drift`: how far each cell's middle wanders (a share of a cell), round a loop taking `churn`
 * seconds (or a half or a third of it: the clock wraps every `churn` s, seamlessly); `trough`:
 * how wide the dark troughs between the cells are (a share of a cell; never under a pixel and a
 * half, `fwidth`, so they never shimmer) and their colour (times the ice's), `dome`: how much
 * brighter the cells' middles are; `flow` (m): how far apart the glaciers' flow lines are, and
 * `flowColor` theirs (times the ice's).
 */
export const HEART_LOOK = {
  cell: 13, drift: 0.28, churn: 600, trough: 0.06, troughColor: [0.7, 0.72, 0.8], dome: 0.07, flow: 1.6, flowColor: [0.62, 0.72, 0.92],
};

/**
 * The cells at `q` (heart plane, in cells) at `time` (s): { edge } how far from the nearest trough's
 * middle (a share of a cell, near enough: F2 - F1), `d1` from its own middle. The shader's sums
 * (the hash aside: `hash(i, j)` gives two numbers 0..1 per cell).
 */
export function cellAt(q, time, hash, look = HEART_LOOK) {
  const ix = Math.floor(q[0]), iy = Math.floor(q[1]);
  let d1 = 9, d2 = 9;
  const t = time % look.churn;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const [hx, hy] = hash(ix + i, iy + j);
      const w = (2 * Math.PI) / look.churn;
      const ox = i + 0.5 + look.drift * Math.sin(t * w * (1 + Math.floor(hy * 3)) + 6.2831853 * hx) - (q[0] - ix);
      const oy = j + 0.5 + look.drift * Math.cos(t * w * (1 + Math.floor(hx * 3)) + 6.2831853 * hy) - (q[1] - iy);
      const d = ox * ox + oy * oy;
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
  }
  return { edge: Math.sqrt(d2) - Math.sqrt(d1), d1: Math.sqrt(d1) };
}

/**
 * The rest of Yonder's ground (#62), away from its heart, like Pluto's regions in New Horizons'
 * pictures. Only in Yonder's ground shader (`#define RL_GROUND`), from how much of each kind of
 * land each vertex is (terrain.js `landOf()`, baked by `marks()`): no mesh, no draw call, no
 * texture. The patterns are in 3D cells of the ground's own (object-space) position, so they
 * have no seams or poles anywhere round the world.
 * - `crack`: the pale frost plains are cracked into big flat polygons (no domes: the heart's
 *   churning cells are rounder, smaller and domed): `cell` (m) how wide one is, `width` how wide a
 *   crack is (a share of a cell; never under a pixel and a half, fainter as it widens, like the
 *   heart's troughs), `color` (times the ground's); some cracks are fainter than others (`faint`:
 *   the faintest's strength), and close up a finer net of cracks (`fine`: its cell, m, and how
 *   strong) shows inside the big ones.
 * - `blade`: the bladed terrain (Tartarus Dorsa): ridges `gap` m apart (terrain.js
 *   `YONDER_BLADES`), each flank lit or shaded by the sun (`flank`), frosty crests (`crest`,
 *   the colour mixed in) and dark troughs (`trough`, times the ground's), broken into snakeskin
 *   scales about `scale` m long.
 * - `pit`: the dark lands (Cthulhu) are pitted with craters of three sizes (`cells`, m: one
 *   grid each, at most one crater per cell, `rate` of the cells have one): a dark floor
 *   (`floor`), a shadow on the sun's side inside (`shadow`), a frosty rim brightest facing the sun
 *   (`rim`); and dark streaks (`streak`: [how far apart across them, m; how long, m; how dark]).
 * Each fades out once it's only a few pixels across, like the heart's cells.
 */
export const YONDER_GROUND = {
  crack: { cell: 30, width: 0.032, color: [0.64, 0.68, 0.83], faint: 0.4, fine: [7, 0.5] },
  blade: { flank: 0.35, crest: [1, 0.95, 0.93], trough: [0.62, 0.5, 0.5], scale: 16 },
  pit: { cells: [36, 15, 6], rate: [0.5, 0.55, 0.6], floor: [0.78, 0.7, 0.68], shadow: 0.6, rim: [1, 0.86, 0.76], streak: [14, 70, 0.78] },
};

/** How far each crack cell's seed may be from the cell's middle (the whole range, in cells): little enough that the shader need only look in 8 cells. */
export const CRACK_STRAY = 0.6;

/** A crater's radius (a share of its cell) and how far its middle strays from the cell's (each way): it always fits inside the cell. */
export const CRATER_FIT = { r: [0.2, 0.34], stray: 0.15 };

/**
 * How far point `p` (in cells, 3D) is from the nearest crack of the frost plains' polygons,
 * measured along the ground (`up`: the ground's unit normal): the edge between the two nearest
 * cells' seeds is a plane, which the ground cuts at a slant. The shader's sums (the hash aside:
 * `hash3(i, j, k)` gives three numbers 0..1 per cell). Also which two cells (`a`, `b`), and
 * how far the edge's plane leans off lying flat along the ground (`lean`: the shader leaves
 * out cracks under 0.3 to 0.5, which would smear into wide bands).
 */
export function crackAt(p, up, hash3, block = true) {
  let d1 = 9, d2 = 9, o1 = null, o2 = null, a = null, b = null;
  // The shader's 2 x 2 x 2 block round the point (or, block = false, all 27 round its cell: the
  // true answer, for the tests).
  const from = p.map((v) => (block ? Math.floor(v - 0.5) : Math.floor(v) - 1)), size = block ? 2 : 3;
  for (let k = 0; k < size; k++) {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const c = [from[0] + i, from[1] + j, from[2] + k];
        const h = hash3(...c);
        const o = c.map((v, m) => v + 0.5 + CRACK_STRAY * (h[m] - 0.5) - p[m]);
        const d = o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
        if (d < d1) { d2 = d1; o2 = o1; b = a; d1 = d; o1 = o; a = c; } else if (d < d2) { d2 = d; o2 = o; b = c; }
      }
    }
  }
  const e = o2.map((v, i) => v - o1[i]);
  const el = Math.hypot(...e);
  const n = e.map((v) => v / el);
  const dist = ((o1[0] + o2[0]) * n[0] + (o1[1] + o2[1]) * n[1] + (o1[2] + o2[2]) * n[2]) / 2;
  const nu = n[0] * up[0] + n[1] * up[1] + n[2] * up[2];
  const lean = Math.hypot(n[0] - nu * up[0], n[1] - nu * up[1], n[2] - nu * up[2]);
  return { dist: dist / Math.max(lean, 0.25), lean, a, b };
}

/**
 * Each rocky world's extra colours: `rock` for steep faces, `dust` for flat ground, `speck` and
 * `streak` for the fine detail, `rim` the sunlit edge, `night` the night side's fill (added, so
 * small), `ao` the baked relief's strength and `speckle` [how rare (0..1, higher: fewer), how bright]
 * the pale pebbles are (Pebble's bright regolith and ejecta). Optional: `tint` (the four colours
 * multiply the ground's own), `rimK` / `nightK` (how strong the rim and night fill are), `keep`
 * (spots left as painted), `rimSurface` (a rim from the real surface), `darken` and `ambientK`
 * (the comet's coal-dark ice). Night fills lean slate-blue on warm worlds: a pure blue over
 * orange reads mauve.
 */
export const ROCKY_LOOK = {
  dusty: { rock: 0x7e3a22, dust: 0xe79a66, speck: 0xf6c49a, streak: 0x9a452a, rim: 0xffc890, night: 0x284a66, nightK: 0.28, ao: { dark: 0.4, light: 0.16 }, speckle: [0.8, 0.45] },
  pebble: { rock: 0x746d64, dust: 0xd9d4ca, speck: 0xf4f1ea, streak: 0x8c857b, rim: 0xfff2dc, night: 0x2a408a, nightK: 0.3, ao: { dark: 0.55, light: 0.32 }, speckle: [0.8, 0.45] },
  // Worlds of many colours (#52): `tint` makes rock / dust / speck / streak multipliers of the
  // ground's own colour. Grass stays green, beaches sandy, snow white.
  homestead: {
    tint: true, rock: [0.8, 0.76, 0.72], dust: [1.05, 1.05, 0.96], speck: [1.12, 1.12, 1.05], streak: [0.9, 0.95, 0.88],
    rim: 0xfff4d8, rimK: 0.3, night: 0x24388a, nightK: 0.26, ao: { dark: 0.56, light: 0.3 }, speckle: [0.82, 0.35],
  },
  // Tiny, with a coarse mesh: gentler relief, or its big crater swallows the whole moon.
  nibble: {
    tint: true, rock: [0.8, 0.77, 0.74], dust: [1.04, 1.03, 1.0], speck: [1.18, 1.16, 1.12], streak: [0.9, 0.88, 0.86],
    rim: 0xfff0dc, night: 0x2a408a, nightK: 0.3, ao: { dark: 0.24, light: 0.14 }, speckle: [0.8, 0.4],
  },
  // The vents keep their glow (`keep`: no relief, slope or detail round them).
  sizzle: {
    tint: true, rock: [0.78, 0.66, 0.55], dust: [1.04, 1.02, 0.94], speck: [1.1, 1.1, 1.04], streak: [0.9, 0.82, 0.72],
    rim: 0xfff0a0, night: 0x284a66, nightK: 0.26, ao: { dark: 0.32, light: 0.16 }, speckle: [0.8, 0.4], keep: [[SIZZLE_VENTS, 0.07]],
  },
  // Icy blue-grey cliffs; its glowing cracks stay as they are.
  frosty: {
    tint: true, rock: [0.6, 0.74, 0.95], dust: [1.03, 1.03, 1.03], speck: [1.08, 1.08, 1.08], streak: [0.92, 0.95, 1.0],
    rim: 0xeaf8ff, night: 0x2a408a, nightK: 0.3, ao: { dark: 0.56, light: 0.3 }, speckle: [0.84, 0.35], keep: [[FROSTY_GLOWS, 0.22]],
    sparkle: SPARKLE, // (#54 stage 5) its ice glints in the sun
  },
  flip: {
    tint: true, rock: [0.84, 0.82, 0.9], dust: [1.03, 1.02, 1.03], speck: [1.08, 1.08, 1.08], streak: [0.93, 0.92, 0.96],
    rim: 0xfff0f4, night: 0x2a408a, nightK: 0.3, ao: { dark: 0.3, light: 0.14 }, speckle: [0.84, 0.35],
  },
  // The comet: two lobes, far from round, so its rim follows its real surface. Darker than
  // coal: `darken` [how dark, from, to] darkens its dusty ice but not the bright frost (by
  // brightness), and `ambientK` takes most of the sky's blue light off it.
  ducky: {
    tint: true, rock: [0.8, 0.8, 0.86], dust: [1.04, 1.04, 1.06], speck: [1.6, 1.6, 1.65], streak: [0.88, 0.88, 0.92],
    rim: 0xe8f4ff, rimSurface: true, rimK: 0.3, night: 0x2a408a, nightK: 0.1, ao: { dark: 0.34, light: 0.16 }, speckle: [0.8, 0.5],
    darken: [0.36, 0.5, 0.72], ambientK: 0.45,
  },
  // Yonder (#62), far out where Ember's light is dim and cold: a cool rim, bluish-grey slopes.
  yonder: {
    ground: YONDER_GROUND, // (#62) the rest of its ground: cracked frost plains, bladed terrain, pitted dark lands
    tint: true, rock: [0.78, 0.8, 0.9], dust: [1.03, 1.02, 1.02], speck: [1.1, 1.1, 1.12], streak: [0.9, 0.88, 0.92],
    rim: 0xdce8ff, rimK: 0.45, night: 0x2a408a, nightK: 0.3, ao: { dark: 0.5, light: 0.26 }, speckle: [0.84, 0.35],
    heart: HEART_LOOK, // (#62 stage 2) its heart's churning cells and its glaciers' flow lines
  },
  // Under its thick haze: a faint rim and night fill (the haze glows over them anyway).
  misty: {
    tint: true, rock: [0.78, 0.72, 0.66], dust: [1.05, 1.03, 0.96], speck: [1.12, 1.1, 1.04], streak: [0.88, 0.84, 0.8],
    rim: 0xffd9a0, rimK: 0.18, night: 0x2a3070, nightK: 0.1, ao: { dark: 0.46, light: 0.36 }, speckle: [0.82, 0.35],
  },
};

/**
 * Bakes a world's relief shading into its terrain colours (in place), and sets the mesh's `rich`
 * attribute: how much of the extra detail each vertex gets (0..1). It fades out below the
 * world's liquid (seabeds seen through water stay as they were; lava hides its pools anyway) and
 * round the spots in the look's `keep` list (glowing vents and cracks stay bright).
 * `dirs`: each vertex's unit direction (x, y, z, ...).
 */
export function bakeRelief(body, geo, heights, dirs, colors) {
  const look = ROCKY_LOOK[body.id];
  if (!look) return;
  const n = heights.length;
  const rich = new Float32Array(n).fill(1);
  const level = body.liquid?.level;
  const keep = look.keep ?? [];
  const richAt = body.terrainFn?.richAt;
  for (let i = 0; i < n; i++) {
    let w = 1;
    if (level !== undefined) w = smooth01(level - 1, level + 1.5, heights[i]);
    const x = dirs[i * 3], y = dirs[i * 3 + 1], z = dirs[i * 3 + 2];
    for (const [spots, r] of keep) {
      for (const v of spots) {
        const a = Math.acos(Math.min(1, x * v.x + y * v.y + z * v.z));
        if (a < r * 1.6) w = Math.min(w, smooth01(r, r * 1.6, a));
      }
    }
    // (Smooth ice left smooth: Yonder's heart, #62 stage 2.)
    if (richAt) w = Math.min(w, richAt(x, y, z));
    rich[i] = w;
  }
  const shade = reliefShade(heights, geo.index.array, look.ao);
  for (let i = 0; i < n; i++) {
    const k = 1 + (shade[i] - 1) * rich[i];
    for (let c = 0; c < 3; c++) colors[i * 3 + c] = Math.min(1, colors[i * 3 + c] * k);
  }
  geo.setAttribute('rich', new THREE.BufferAttribute(rich, 1));
}

const smooth01 = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Extends a rocky world's toon terrain material with per-pixel detail, slope colours, rim and
 * night fill. `sunDir`: the world's view-space sun direction, shared (the flight scene updates it).
 */
export function richRocky(mat, body, sunDir) {
  const look = ROCKY_LOOK[body.id];
  if (!look) return mat;
  const uniforms = {
    rlSun: { value: sunDir },
    rlRadius: { value: body.radius },
    rlRimColor: { value: raw(look.rim) },
    rlRimK: { value: look.rimK ?? 0.55 },
    rlNightColor: { value: raw(look.night) },
    rlNightK: { value: look.nightK },
    rlRock: { value: col(look.rock) },
    rlDust: { value: col(look.dust) },
    rlSpeck: { value: col(look.speck) },
    rlStreak: { value: col(look.streak) },
    rlSpeckAt: { value: look.speckle[0] },
    rlSpeckK: { value: look.speckle[1] },
    rlDarken: { value: new THREE.Vector3(...(look.darken ?? [1, 0, 1])) },
    rlAmbientK: { value: look.ambientK ?? 1 },
  };
  const sp = look.sparkle;
  if (sp) {
    Object.assign(uniforms, {
      rlTime: { value: 0 },
      rlSparkle: { value: new THREE.Vector4(sp.cell, sp.tilt, sp.px[0], sp.px[1]) },
      rlSparkK: { value: new THREE.Vector3(...sp.color).multiplyScalar(sp.k) },
      rlSparkSharp: { value: sp.sharp },
      // Sized in CSS pixels, so they're as big on a phone's sharp screen (the renderer's ratio, main.js).
      rlSparkDpr: { value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1 },
    });
    // Its glints' own twinkle runs on the clock (planets.js calls this with the other updates).
    mat.userData.richUpdate = (time) => { uniforms.rlTime.value = time % 1000; };
  }
  const hl = look.heart;
  if (hl) {
    Object.assign(uniforms, {
      rlTime: { value: 0 },
      rlCell: { value: new THREE.Vector4(hl.cell, hl.drift, (2 * Math.PI) / hl.churn, hl.trough) },
      rlTrough: { value: new THREE.Vector3(...hl.troughColor) },
      rlDome: { value: hl.dome },
      rlFlowGap: { value: hl.flow },
      rlFlowC: { value: new THREE.Vector3(...hl.flowColor) },
    });
    // The cells churn on the real clock, wrapping where every loop comes round (no jump).
    mat.userData.richUpdate = (time) => { uniforms.rlTime.value = time % hl.churn; };
  }
  const gr = look.ground;
  if (gr) {
    const { crack: c, blade: b, pit: p } = gr;
    const ax = SPIN_AXES[body.id];
    Object.assign(uniforms, {
      rlCrack: { value: new THREE.Vector4(c.cell, c.width, c.faint, c.fine[1]) },
      rlCrackFine: { value: c.fine[0] },
      rlCrackStray: { value: CRACK_STRAY },
      rlCrackC: { value: new THREE.Vector3(...c.color) },
      rlBlade: { value: new THREE.Vector3(YONDER_BLADES.gap, b.scale, b.flank) },
      rlBladeCrest: { value: new THREE.Vector3(...b.crest) },
      rlBladeTrough: { value: new THREE.Vector3(...b.trough) },
      rlPitCell: { value: new THREE.Vector3(...p.cells) },
      rlPitRate: { value: new THREE.Vector3(...p.rate) },
      rlPitFit: { value: new THREE.Vector3(CRATER_FIT.r[0], CRATER_FIT.r[1] - CRATER_FIT.r[0], CRATER_FIT.stray) },
      rlPitFloor: { value: new THREE.Vector3(...p.floor) },
      rlPitShadow: { value: p.shadow },
      rlPitRim: { value: new THREE.Vector3(...p.rim) },
      rlPitAxis: { value: new THREE.Vector3(ax.x, ax.y, ax.z) },
      rlPitStreak: { value: new THREE.Vector3(...p.streak) },
    });
  }
  const defs = defines([['RL_TINT', !!look.tint], ['RL_RIM_SURFACE', !!look.rimSurface], ['RL_SPARKLE', !!sp], ['RL_HEART', !!hl], ['RL_GROUND', !!gr]]);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = defs + VERT_PARS + 'attribute float rich;\nvarying float rlRich;\nvarying float rlLevel;\n' + (hl ? HEART_VERT_PARS : '') + (gr ? GROUND_VERT_PARS : '')
      + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}\nrlRich = rich;\nrlLevel = abs(dot(normalize(normal), normalize(position)));${hl ? HEART_VERT : ''}${gr ? GROUND_VERT : ''}`);
    shader.fragmentShader = defs + FRAG_PARS + /* glsl */ `
      varying float rlRich;
      varying float rlLevel;
      uniform vec3 rlRock;
      uniform vec3 rlDust;
      uniform vec3 rlSpeck;
      uniform vec3 rlStreak;
      uniform float rlSpeckAt;
      uniform float rlSpeckK;
      uniform vec3 rlDarken;
      uniform float rlAmbientK;
    ` + (sp ? SPARKLE_PARS : '') + (hl ? HEART_PARS : '') + (gr ? GROUND_PARS : '') + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n${ROCKY_COLOR}${hl ? HEART_MAIN : ''}${gr ? GROUND_MAIN : ''}`)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= rlAmbientK;')
      .replace('#include <opaque_fragment>', `${RIM_NIGHT}\n${sp ? SPARKLE_MAIN + '\n' : ''}#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `rich-rocky:${defs}`;
  return mat;
}

// Object space (metres), so the detail is stuck to the ground wherever the world is drawn.
// `rlRich` (baked per vertex) fades it all out where it mustn't go: under a sea, on glowing vents.
// With RL_TINT (worlds of many colours) the extra colours multiply the ground's own colour, so
// grass stays green and snow white; otherwise they're the colours themselves (Dusty, Pebble).
const ROCKY_COLOR = /* glsl */ `
  {
    diffuseColor.rgb *= mix(rlDarken.x, 1.0, smoothstep(rlDarken.y, rlDarken.z, dot(diffuseColor.rgb, vec3(0.333))));
    #ifdef RL_TINT
      vec3 base = diffuseColor.rgb;
      vec3 rockC = base * rlRock, dustC = base * rlDust, speckC = min(base * rlSpeck, 1.0), streakC = base * rlStreak;
    #else
      vec3 rockC = rlRock, dustC = rlDust, speckC = rlSpeck, streakC = rlStreak;
    #endif
    // The ground's slope from the smooth vertex normals, blended across each triangle (#56:
    // each triangle's own slope made jagged, triangle-shaped rock patches in small craters).
    float level = rlLevel;
    float steep = 1.0 - smoothstep(0.84, 0.92, level);
    diffuseColor.rgb = mix(diffuseColor.rgb, rockC, steep * 0.72 * rlRich);
    diffuseColor.rgb = mix(diffuseColor.rgb, dustC, smoothstep(0.93, 0.975, level) * 0.22 * rlRich);
    // How many metres one pixel covers: detail finer than a few pixels fades out (no grain from far).
    float px = length(fwidth(rlObj));
    // Wind streaks: long blotches (stretched along one axis), two tones with crisp edges.
    float sn = rlNoise(rlObj * vec3(0.03, 0.11, 0.11) + 3.1);
    float streakK = (1.0 - smoothstep(0.8, 2.5, px)) * rlRich;
    diffuseColor.rgb = mix(diffuseColor.rgb, streakC, smoothstep(0.6, 0.64, sn) * 0.3 * streakK);
    diffuseColor.rgb = mix(diffuseColor.rgb, dustC, (1.0 - smoothstep(0.34, 0.38, sn)) * 0.1 * streakK);
    // Speckles: little pale pebbles and dark pits, about a metre across.
    float fn = rlNoise(rlObj * 1.7);
    float speckK = (1.0 - smoothstep(0.06, 0.25, px)) * rlRich;
    diffuseColor.rgb = mix(diffuseColor.rgb, speckC, smoothstep(rlSpeckAt, rlSpeckAt + 0.02, fn) * rlSpeckK * speckK);
    diffuseColor.rgb = mix(diffuseColor.rgb, rockC, (1.0 - smoothstep(0.17, 0.19, fn)) * 0.3 * speckK);
    // Mixing in the extra colours greys things a little: win the colour back (bright for kids).
    diffuseColor.rgb = max(mix(vec3(dot(diffuseColor.rgb, vec3(0.333))), diffuseColor.rgb, 1.15), 0.0);
  }
`;

// Yonder's heart (#62 stage 2, only with RL_HEART; HEART_LOOK, `cellAt()` is its sums): in the
// basin, cells round middles that slowly wander (a lava lamp's churn), each a little domed
// (brighter in the middle), with dark troughs between; along the glaciers, flow lines. Both
// antialiased with fwidth, at least a pixel and a half wide (fainter as they widen), and faded
// out once a cell or a line gap is only a few pixels across. (The smooth ice gets little of the
// speckles and streaks: its `rich` is low, terrain.js `richAt()`.)
const HEART_VERT_PARS = /* glsl */ `
  attribute vec4 heartMark;
  attribute float heartFlow;
  varying vec4 rlMark;
  varying float rlFlow;
`;
const HEART_VERT = /* glsl */ `
  rlMark = heartMark;
  rlFlow = heartFlow;
`;
const HEART_PARS = /* glsl */ `
  uniform float rlTime;
  uniform vec4 rlCell; // cell (m), drift, the churn's speed (rad/s), trough
  uniform vec3 rlTrough;
  uniform float rlDome;
  uniform float rlFlowGap;
  uniform vec3 rlFlowC;
  varying vec4 rlMark;
  varying float rlFlow;
`;
const HEART_MAIN = /* glsl */ `
  {
    if (rlMark.z > 0.01) {
      vec2 q = rlMark.xy / rlCell.x;
      float pc = length(fwidth(q)); // cells per pixel
      float seen = 1.0 - smoothstep(0.12, 0.3, pc);
      if (seen > 0.0) {
        vec2 i0 = floor(q), f0 = q - i0;
        float d1 = 9.0, d2 = 9.0;
        for (int j = -1; j <= 1; j++) {
          for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec3 hc = vec3(i0 + g, 3.7);
            vec2 h = vec2(rlHash(hc), rlHash(hc + 19.1));
            vec2 o = g + 0.5 + rlCell.y * vec2(
              sin(rlTime * rlCell.z * (1.0 + floor(h.y * 3.0)) + 6.2831853 * h.x),
              cos(rlTime * rlCell.z * (1.0 + floor(h.x * 3.0)) + 6.2831853 * h.y)) - f0;
            float d = dot(o, o);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
          }
        }
        d1 = sqrt(d1);
        float edge = sqrt(d2) - d1;
        float w = max(rlCell.w, 1.5 * pc);
        float trough = (1.0 - smoothstep(0.35 * w, w, edge)) * (rlCell.w / w);
        float k = rlMark.z * seen;
        diffuseColor.rgb *= 1.0 + rlDome * (1.0 - smoothstep(0.0, 0.7, d1)) * k;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * rlTrough, trough * k);
      }
    }
    if (rlMark.w > 0.01) {
      float f = rlFlow / rlFlowGap;
      float pf = fwidth(f);
      float seen = 1.0 - smoothstep(0.15, 0.35, pf);
      // Broken up along the flow a little, so they read as streaks rather than ruled lines.
      float streak = smoothstep(0.3, 0.55, rlNoise(vec3(rlFlow * 0.7, rlObj.x * 0.15 + rlObj.y * 0.15, rlObj.z * 0.15)));
      float dd = abs(f - floor(f + 0.5));
      float w = max(0.12, 1.5 * pf);
      float line = (1.0 - smoothstep(0.4 * w, w, dd)) * (0.12 / w);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * rlFlowC, line * streak * seen * rlMark.w);
    }
  }
`;

// The rest of Yonder's ground (#62, only with RL_GROUND; YONDER_GROUND, `crackAt()` is the
// cracks' sums). `rlGround`: how much of it is cracked frost plain, pitted dark land and bladed
// terrain (baked per vertex, 0 on the heart, its rim, glaciers and mountains, so the heart's own
// look is untouched), and metres across the blades. 3D cells of the ground's own position, so
// no seams or poles; every edge antialiased with fwidth and at least a pixel and a half wide,
// and each pattern faded out once it's only a few pixels across. `rlSunO`: the sun in the
// world's own frame, for the craters' shadows.
const GROUND_VERT_PARS = /* glsl */ `
  attribute vec4 groundMark;
  attribute float groundAlong;
  uniform vec3 rlSun;
  varying vec4 rlGround;
  varying float rlBladeAlong;
  varying vec3 rlSunO;
`;
const GROUND_VERT = /* glsl */ `
  rlGround = groundMark;
  rlBladeAlong = groundAlong;
  rlSunO = normalize(transpose(mat3(modelViewMatrix)) * rlSun);
`;
const GROUND_PARS = /* glsl */ `
  uniform vec4 rlCrack; // big cell (m), width (cells), the faintest cracks' strength, the fine net's strength
  uniform float rlCrackFine; // the fine net's cell (m)
  uniform float rlCrackStray; // how far a cell's seed may be from its middle (the whole range, cells)
  uniform vec3 rlCrackC;
  uniform vec3 rlBlade; // gap (m), scales (m), how much lighter / darker the flanks facing / away from the sun
  uniform vec3 rlBladeCrest;
  uniform vec3 rlBladeTrough;
  uniform vec3 rlPitCell;
  uniform vec3 rlPitRate;
  uniform vec3 rlPitFit; // smallest radius, the spread of radii, stray (shares of a cell)
  uniform vec3 rlPitFloor;
  uniform float rlPitShadow;
  uniform vec3 rlPitRim;
  uniform vec3 rlPitAxis; // the streaks run along it
  uniform vec3 rlPitStreak; // across (m), along (m), how dark
  varying vec4 rlGround;
  varying float rlBladeAlong;
  varying vec3 rlSunO;
  // Three numbers 0..1 per cell (no sin(): steady on phones).
  vec3 rlHash3(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  // The frost plains' cracks at p (cells): .x how far to the nearest along the ground (cells),
  // .y how strong that crack is (one number per pair of cells), .z 0 where the edge between the
  // cells lies almost flat along the ground (it would smear into a wide band: left out).
  // up: the ground's unit normal.
  vec3 rlCracks(vec3 p, vec3 up) {
    // (Each cell's seed strays only a little from its middle (CRACK_STRAY), so the two nearest
    // are all but always among the 2 x 2 x 2 cells nearest the point: 8 lookups, not 27.)
    vec3 i0 = floor(p), f0 = p - i0;
    vec3 b0 = i0 + step(0.5, f0) - 1.0; // the block's first cell
    float d1 = 9.0, d2 = 9.0;
    vec3 o1 = vec3(0.0), o2 = vec3(0.0), c1 = vec3(0.0), c2 = vec3(0.0);
    for (int k = 0; k <= 1; k++) {
      for (int j = 0; j <= 1; j++) {
        for (int i = 0; i <= 1; i++) {
          vec3 c = b0 + vec3(float(i), float(j), float(k));
          vec3 o = c + 0.5 + rlCrackStray * (rlHash3(c) - 0.5) - p;
          float d = dot(o, o);
          if (d < d1) { d2 = d1; o2 = o1; c2 = c1; d1 = d; o1 = o; c1 = c; }
          else if (d < d2) { d2 = d; o2 = o; c2 = c; }
        }
      }
    }
    vec3 n = normalize(o2 - o1);
    float lean = length(n - dot(n, up) * up);
    return vec3(dot(0.5 * (o1 + o2), n) / max(lean, 0.25), rlHash(c1 + c2 + 5.3), smoothstep(0.3, 0.5, lean));
  }
  // A crater in the grid of cells 'cell' m wide, if this cell has one (rate): .x how far out
  // (0 its middle, 1 its rim), .y the same from a middle shifted away from the sun (outside 1:
  // in the shadow), .z its radius on the ground (m), .w 1 if there is one.
  vec4 rlCrater(float cell, float rate, float seed, vec3 up, vec3 sunT) {
    vec3 p = rlObj / cell;
    vec3 id = floor(p);
    vec3 h = rlHash3(id + seed);
    if (h.x > rate) return vec4(9.0, 9.0, 0.0, 0.0);
    // (It fits inside its cell, so one cell's lookup is enough: never cut off.)
    vec3 q = p - (id + 0.5 + (rlHash3(id + seed + 7.1) - 0.5) * 2.0 * rlPitFit.z);
    float r = rlPitFit.x + rlPitFit.y * h.y;
    float dn = dot(q, up);
    float a2 = r * r - dn * dn;
    // (A crater is a ball cut by the ground: too small a slice would be a speck.)
    if (a2 < 0.2 * r * r) return vec4(9.0, 9.0, 0.0, 0.0);
    float a = sqrt(a2);
    vec3 qt = (q - dn * up) / a;
    return vec4(length(qt), length(qt + 0.45 * sunT), a * cell, 1.0);
  }
`;

const GROUND_MAIN = /* glsl */ `
  {
    vec3 up = normalize(rlObj);
    float gpx = length(fwidth(rlObj)); // metres per pixel
    // The frost plains' cracks: big polygons, and close up a finer net inside them.
    if (rlGround.x > 0.01) {
      float pc = gpx / rlCrack.x; // cells per pixel
      float seen = 1.0 - smoothstep(0.1, 0.25, pc);
      if (seen > 0.0) {
        vec3 c = rlCracks(rlObj / rlCrack.x, up);
        float w = max(rlCrack.y, 1.5 * pc);
        float line = (1.0 - smoothstep(0.35 * w, w, c.x)) * (rlCrack.y / w) * c.z;
        float k = rlGround.x * seen * mix(rlCrack.z, 1.0, smoothstep(0.3, 0.6, c.y));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * rlCrackC, line * k);
        float pf = gpx / rlCrackFine;
        // (Only close up: from further off it would look like the heart's cells.)
        float fseen = 1.0 - smoothstep(0.03, 0.06, pf);
        if (fseen > 0.0) {
          vec3 f = rlCracks(rlObj / rlCrackFine + 17.0, up);
          float fw = max(rlCrack.y * 1.2, 1.5 * pf);
          float fl = (1.0 - smoothstep(0.35 * fw, fw, f.x)) * (rlCrack.y * 1.2 / fw) * smoothstep(0.35, 0.55, f.y) * f.z;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * rlCrackC, fl * rlGround.x * fseen * rlCrack.w);
        }
      }
    }
    // The bladed terrain: ridges across rlGround.w (crests where it's half a gap on), the flank
    // facing the sun lit and the other shaded (which way across grows along the ground, in view
    // space: least squares on the pixel's steps), frosty crests, dark troughs; each ridge broken
    // along its length (rlBladeAlong) into scales, staggered from its neighbours': snakeskin.
    if (rlGround.z > 0.01) {
      float f = rlGround.w / rlBlade.x;
      float pf = fwidth(f);
      float seen = 1.0 - smoothstep(0.15, 0.35, pf);
      if (seen > 0.0) {
        vec3 jx = dFdx(vViewPosition), jy = dFdy(vViewPosition);
        float sx = dFdx(rlGround.w), sy = dFdy(rlGround.w);
        float a = dot(jx, jx), b = dot(jx, jy), c = dot(jy, jy);
        vec3 g = ((c * sx - b * sy) * jx + (a * sy - b * sx) * jy) / max(a * c - b * b, 1e-12);
        // (vViewPosition points from the ground to the camera: g is minus the way across grows,
        // the way the rising flank faces.)
        float lit = clamp(dot(normalize(g + 1e-9), rlSun) * 3.0, -1.0, 1.0);
        float fr = fract(f);
        float side = clamp((1.0 - 4.0 * abs(fract(f + 0.25) - 0.5)) / (4.0 * max(pf, 1e-4)), -1.0, 1.0); // 1 on the rising flank
        float dc = abs(fr - 0.5), dt = 0.5 - dc;
        float cw = max(0.035, 1.5 * pf);
        float crest = (1.0 - smoothstep(0.4 * cw, cw, dc)) * (0.035 / cw);
        float trough = (1.0 - smoothstep(0.4 * cw, cw, dt)) * (0.035 / cw);
        // This ridge's scales: its own length and stagger, a short gap between each.
        vec3 rh = rlHash3(vec3(floor(f), 3.1, 7.7));
        float ta = rlBladeAlong / (rlBlade.y * (0.75 + 0.6 * rh.y)) + rh.x;
        float seg = fract(ta);
        float dash = clamp(min(seg - 0.16, 1.0 - seg) / max(fwidth(ta), 1e-4) + 0.5, 0.0, 1.0);
        float k = rlGround.z * seen;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * rlBladeTrough, trough * k);
        k *= dash;
        diffuseColor.rgb *= 1.0 + side * lit * rlBlade.z * k;
        diffuseColor.rgb = mix(diffuseColor.rgb, rlBladeCrest, crest * 0.2 * k);
      }
    }
    // The dark lands: dark streaks, then craters of three sizes (big first, small on top).
    if (rlGround.y > 0.01) {
      vec3 ax = rlPitAxis;
      float along = dot(rlObj, ax);
      float sn = rlNoise((rlObj - along * ax) / rlPitStreak.x + along * ax / rlPitStreak.y + 9.1);
      float sseen = 1.0 - smoothstep(0.15, 0.35, gpx / rlPitStreak.x);
      diffuseColor.rgb *= 1.0 - (1.0 - rlPitStreak.z) * smoothstep(0.6, 0.64, sn) * rlGround.y * sseen;
      vec3 sunT = rlSunO - dot(rlSunO, up) * up;
      for (int i = 0; i < 3; i++) {
        float cell = i == 0 ? rlPitCell.x : i == 1 ? rlPitCell.y : rlPitCell.z;
        float rate = i == 0 ? rlPitRate.x : i == 1 ? rlPitRate.y : rlPitRate.z;
        vec4 cr = rlCrater(cell, rate, 31.7 * float(i + 1), up, sunT);
        if (cr.w <= 0.0) continue;
        float pw = gpx / cr.z; // radii per pixel
        float seen = 1.0 - smoothstep(0.18, 0.35, pw);
        if (seen <= 0.0 || cr.x > 1.4) continue;
        float e = max(pw, 0.04);
        float inside = 1.0 - smoothstep(1.0 - e, 1.0 + e, cr.x);
        float rim = inside * smoothstep(0.8 - e, 0.8 + e, cr.x);
        float shade = inside * smoothstep(1.0 - e, 1.0 + e, cr.y);
        float k = rlGround.y * seen;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * rlPitFloor, (inside - rim) * k);
        diffuseColor.rgb = mix(diffuseColor.rgb, min(diffuseColor.rgb * 1.6 + 0.08, 1.0) * rlPitRim, rim * (1.0 - shade) * 0.75 * k);
        diffuseColor.rgb *= 1.0 - (1.0 - rlPitShadow) * shade * k;
        // A faint pale ring of thrown-out frost just outside.
        diffuseColor.rgb *= 1.0 + 0.08 * (1.0 - inside) * (1.0 - smoothstep(1.0, 1.35, cr.x)) * k;
      }
    }
  }
`;

// Ice sparkles (#54 stage 5, only with RL_SPARKLE). One glint spot per grid cell, at a random
// point in it (3D cells: the ground only passes near some of the spots, which scatters them); a
// spot glints when its facet (the ground's normal tilted at random, wobbling a little in time)
// mirrors the sun into the camera: the half-vector test, so they flash as the view moves. A
// spot is at most a pixel and a half across and at most an eighth of its cell (pin-pricks up
// close). The grid doubles with distance (sparkleCell()). View space throughout.
const SPARKLE_PARS = /* glsl */ `
  uniform float rlTime;
  uniform vec4 rlSparkle; // cell, tilt, px fade
  uniform vec3 rlSparkK;
  uniform float rlSparkSharp;
  uniform float rlSparkDpr;
  // One cell's glint at this pixel, a little four-pointed star (in pixels: (jx, jy) are the
  // metres one pixel steps across the ground): .x all of it, .y its core, .z its hue (0..1).
  vec3 rlGlint(vec3 pos, float cell, vec3 jx, vec3 jy, vec3 H, vec3 N) {
    vec3 g = pos / cell;
    vec3 id = floor(g);
    vec3 h = vec3(rlHash(id), rlHash(id + 19.19), rlHash(id + 47.31));
    vec3 o = (id + 0.5 + (h - 0.5) * 0.4 - g) * cell; // to its spot (m)
    // ...in pixels across the screen (least squares on the ground's plane), and off the ground.
    float a = dot(jx, jx), b = dot(jx, jy), c = dot(jy, jy);
    vec2 r = vec2(dot(jx, o), dot(jy, o));
    vec2 sp = vec2(c * r.x - b * r.y, a * r.y - b * r.x) / max(a * c - b * b, 1e-12);
    float off = length(o - sp.x * jx - sp.y * jy) / sqrt(max(a, c));
    sp /= rlSparkDpr;
    // The ground passes near only some of the spots (within a couple of pixels).
    float on = 1.0 - smoothstep(1.5, 3.0, off / rlSparkDpr);
    if (on <= 0.0) return vec3(0.0);
    vec3 lean = vec3(rlHash(id + 7.7), rlHash(id + 3.13), rlHash(id + 11.37)) - 0.5;
    lean += 0.12 * sin(rlTime * (0.7 + 1.6 * h) + h * 40.0);
    vec3 f = normalize(N + rlSparkle.y * lean);
    // A facet either mirrors the sun at us or not (a narrow edge, so it flashes on and off).
    float flash = smoothstep(rlSparkSharp, rlSparkSharp + 0.025, dot(f, H));
    if (flash <= 0.0) return vec3(0.0);
    vec2 q = abs(sp);
    float core = exp(-dot(sp, sp) * 0.3);
    float rays = exp(-q.x * 0.2 - q.y * q.y * 1.5) + exp(-q.y * 0.2 - q.x * q.x * 1.5);
    return vec3(on * flash * min(core + rays, 1.0), on * flash * core, h.z);
  }
`;
const SPARKLE_MAIN = /* glsl */ `
  {
    vec3 jx = dFdx(rlObj), jy = dFdy(rlObj);
    float px = length(jx + jy) * 0.7071;
    // Sunlit ice only: not the night side, not the tan patches, red or glowing cracks (their
    // colours are too dark: ice is the palest ground; rlRich is 0 all round the glowing cracks).
    float lit = smoothstep(0.0, 0.2, dot(normal, rlSun)) * smoothstep(-0.05, 0.15, dot(normalize(rlRadial), rlSun));
    float ice = smoothstep(0.6, 0.8, dot(diffuseColor.rgb, vec3(0.333)));
    float k = lit * ice * (1.0 - smoothstep(rlSparkle.z, rlSparkle.w, px));
    if (k > 0.001) {
      vec3 H = normalize(rlSun + normalize(vViewPosition));
      float L = max(0.0, log2(px * 20.0 * rlSparkDpr / rlSparkle.x));
      float fl = floor(L), bl = L - fl;
      float cell = rlSparkle.x * exp2(fl);
      vec3 g1 = rlGlint(rlObj, cell, jx, jy, H, normal) * vec3(1.0 - bl, 1.0 - bl, 1.0);
      vec3 g2 = rlGlint(rlObj + 71.3, cell * 2.0, jx, jy, H, normal) * vec3(bl, bl, 1.0);
      vec3 g = g1.x > g2.x ? g1 : g2;
      // Icy colours, like light through ice crystals: cyan, ice blue, a little lilac and gold.
      vec3 hue = g.z < 0.45 ? vec3(0.25, 0.85, 1.0) : g.z < 0.75 ? vec3(0.4, 0.6, 1.0) : g.z < 0.9 ? vec3(0.75, 0.55, 1.0) : vec3(1.0, 0.8, 0.3);
      // (On sunlit ice, nearly white already, it's the colour that shows; the core is brighter.)
      outgoingLight = mix(outgoingLight, mix(hue, vec3(0.85, 1.0, 1.0), g.y) * rlSparkK * (1.0 + 0.4 * g.y), clamp(g.x * k, 0.0, 1.0));
    }
  }
`;

// ---- Gas giants --------------------------------------------------------------------------------

/**
 * Tumble's hexagon (#55), Saturn's six-sided polar storm: a crisp jet-stream band round the
 * pole (`size`: its flat sides' distance from the pole, `width`: the band's, both seen from
 * straight above the pole, in planet radii), with a little vortex (`eye`) in the middle.
 * Colours: the band, its pale core, inside the hexagon, and the vortex's rim, body and eye.
 * `turn` is how fast the vortex swirls; the hexagon turns with the planet.
 */
export const HEXAGON = {
  size: 0.213, width: 0.037, eye: 0.06, turn: 0.12, // two-thirds of the first try, on the owner's ask
  colors: { band: 0x0f3f8a, core: 0xa8f0ff, inside: 0x3a88c4, rim: 0x0a2656, body: 0x1f5aa8, eye: 0xeafcff },
  glow: 0x8fe8ff, // its jet glows softly on the night side, like an aurora
};

/**
 * Each gas giant's cloud look: storms (latitude `lat` along the spin axis, -1..1, longitude `lon`,
 * size across and up in radians, colours from the rim in to the eye, and how fast they turn),
 * how much its bands drift (`drift`, radians), its rim colour, and optionally a polar `hexagon`
 * (#55). Generic over the axis and palette, so another gas giant (Tumble) opts in with an entry here.
 *
 * #54 stage 6: `streaks`, a few bright clouds riding in the bands (Uranus's bright methane-ice
 * clouds, Saturn's white spots): each at latitude `lat` (as the storms' `lat`), starting at
 * longitude `lon`, `len` long and `wid` wide (radians along the band, and in `lat` across it),
 * travelling round with its band `turns` times in CLOUD_WRAP seconds of cloud time (the sign is
 * its jet's, see `jetAt()`), `k` how bright, `bend` how far its tail sweeps across the band
 * (in widths). A short one (`len` a few `wid`) is a bright spot. `streakColor`: their colour.
 * `haze`: the high-altitude haze at the limb (see LIMB_HAZE).
 */
export const GAS_LOOK = {
  ringo: {
    storms: [
      { lat: 0.2, lon: 4.3, size: [0.3, 0.17], colors: [0x9a5230, 0xd9743e, 0xf6e3c0], turn: 0.08 },
      { lat: 0.5, lon: 5.8, size: [0.12, 0.075], colors: [0xc28d5a, 0xf7eedb, 0xfffaf0], turn: -0.12 },
    ],
    drift: 0.35,
    rim: 0xfff0cc,
    night: 0x1c2250,
    nightK: 0.12,
    // Saturn's white spots and streaks, clear of the storms' latitudes (0.0 to 0.6) and the cap.
    streaks: [
      { lat: 0.68, lon: 1.0, len: 0.9, wid: 0.04, turns: 1, k: 0.85, bend: 0.8 },
      { lat: 0.73, lon: 3.3, len: 0.2, wid: 0.035, turns: 1, k: 0.95, bend: 0 },
      { lat: 0.78, lon: 5.2, len: 0.7, wid: 0.03, turns: -1, k: 0.75, bend: -0.6 },
      { lat: -0.12, lon: 2.2, len: 0.8, wid: 0.035, turns: -1, k: 0.8, bend: 0.5 },
      { lat: 0.64, lon: 4.6, len: 0.18, wid: 0.03, turns: 1, k: 0.9, bend: 0 },
    ],
    streakColor: 0xfffbf0,
    haze: { color: 0xffe6b0, veil: [0.45, 0.5, 0.5], hug: [0.03, 1.1], layer: [1.045, 0.005, 1.0] },
  },
  // Tipped on its side, pale blue-green, with a dark Neptune-style spot (#52) and, like
  // Saturn's, a six-sided jet stream round the pole the cameras see (#55).
  tumble: {
    storms: [{ lat: 0.2, lon: 3.6, size: [0.2, 0.12], colors: [0x2f5f86, 0x3f7fa8, 0x8fcfe0], turn: 0.1 }],
    hexagon: HEXAGON,
    drift: 0.2,
    rim: 0xe0fffb,
    rimK: 0.18,
    night: 0x162a50,
    nightK: 0.12,
    // Uranus's bright methane-ice clouds: mostly at mid-latitudes on the side the cameras see,
    // between the dark spot (0.04 to 0.36) and the hexagon (from about 0.96).
    streaks: [
      { lat: 0.45, lon: 0.0, len: 0.9, wid: 0.04, turns: -1, k: 0.95, bend: 0.7 },
      { lat: 0.62, lon: 1.05, len: 0.2, wid: 0.035, turns: -1, k: 1, bend: 0 },
      { lat: 0.52, lon: 2.1, len: 0.75, wid: 0.034, turns: 1, k: 0.9, bend: -0.6 },
      { lat: 0.7, lon: 3.15, len: 0.6, wid: 0.03, turns: 1, k: 0.85, bend: 0.5 },
      { lat: 0.42, lon: 4.2, len: 0.18, wid: 0.034, turns: -1, k: 0.95, bend: 0 },
      { lat: 0.58, lon: 5.25, len: 0.8, wid: 0.036, turns: -1, k: 0.9, bend: -0.5 },
    ],
    streakColor: 0xc4f2ff, // (cool, so it still reads white under Ember's warm light)
    haze: { color: 0xa8e8ff, veil: [0.45, 0.5, 0.5], hug: [0.03, 1.1], layer: [1.045, 0.005, 1.0] },
  },
};

/**
 * The high-altitude haze at a gas giant's limb (#54 stage 6), all in units of the planet's
 * radius, counted by how close a line of sight passes to its middle (`s`: 1 at the cloud tops'
 * edge). On the disc (the planet's own shader) a pale `veil` from `s` = `veil[0]` out to the
 * limb, strongest there: `veil[1]` of the haze's colour laid over the clouds, which it washes
 * out by `veil[2]` of that (features fade into the haze towards the edge; never over the
 * hexagon). Just off the limb (the glowing shell's shader) the haze `hug`s the cloud tops,
 * fading out within `hug[0]` radii from `hug[1]`, and a thin detached `layer` stands clear of
 * it, [middle, half-width, brightness]: the shell's own glow shows in the gap between. All
 * sunlit (`hazeDay()`). `limbHazeAt()` / `veilAt()` are the shaders' sums: change both together.
 */
export function hazeDay(sunK) {
  return 0.08 + 0.92 * smooth(-0.25, 0.35, sunK);
}

/** The disc's veil at `s` (0..1 out to the limb): how much haze is laid over the clouds there. */
export function veilAt(haze, s) {
  const t = smooth(haze.veil[0], 1, s);
  return t * t * haze.veil[1];
}

/** The haze's light just off the limb at `s` (> 1), before the sun (`hazeDay()`): { hug, layer }. */
export function limbHazeAt(haze, s, px = 0) {
  const hug = s < 1 ? 0 : haze.hug[1] * (1 - smooth(1, 1 + haze.hug[0], s));
  const [at, w0, k] = haze.layer;
  const w = Math.max(w0, 1.5 * px);
  const layer = (1 - smooth(0, 1, Math.abs(s - at) / w)) * (w0 / w) * k;
  return { hug, layer };
}

/**
 * Pluto's thin blue haze, in layers (#62 stage 2: Yonder's; New Horizons' backlit picture): a thin
 * blue ring round the world's edge, only seen from space. Yonder has no air for the rocket's
 * exhaust (#60, `airOf()`): this is only the look, a shell of its own (planets.js
 * `hazeLayers()`), not an `atmosphere`. All in the world's radii, counted by how close a line of
 * sight passes to its middle (`s`: 1 at the ground). `shell`: the shell's radius; `hug`: a soft
 * glow hugging the ground, gone `hug[0]` out, as bright as `hug[1]`; `layers`: thin detached
 * layers above it, [middle, half-width, brightness], each widened to a pixel and a half with
 * `fwidth` (and dimmed as much) so it never shimmers. Lit where the sun reaches it
 * (`hazeDay()`), `front` bright from the front and side, and up to `front + back` looking
 * towards the sun past the world, or seen from behind it (backlit: the haze scatters light
 * forwards, `backPow` how tightly; the game's cameras all look down on the flight plane, so the
 * rocket on the night side, low down, is the backlit view). It fades out as the camera comes down within `near` [gone, full] radii of the middle
 * (down there its layers would be seen side-on, as big arcs across the sky). `blueHazeAt()` is
 * the shader's sums: change both together.
 */
export const HAZE_LAYERS = {
  yonder: {
    shell: 1.13, color: 0x5aa8ff, hug: [0.022, 0.7],
    // (Two soft, faint layers: four crisp ones read as bold concentric rings from close by. And
    // only from well out: gone within 2.5 radii, full from 5, so a hop or a low orbit doesn't
    // look through them side-on.)
    layers: [[1.03, 0.004, 0.32], [1.06, 0.004, 0.18]],
    front: 0.35, back: 2.2, backPow: 2, near: [2.5, 5],
  },
};

/**
 * The haze's brightness `s` world radii out (`px`: radii one pixel covers there), before the sun,
 * and how much the sun's direction brings out (`g`: the larger of the cosines between the way to
 * the sun and the line of sight, or the way from the camera to the world's middle; 1 looking
 * straight at it past the world, or from right behind the world).
 */
export function blueHazeAt(look, s, px = 0, g = 0) {
  const [hw, hk] = look.hug;
  let a = hk * smooth(0.985, 1, s) * (1 - smooth(1, 1 + hw, s));
  for (const [at, w0, k] of look.layers) {
    const w = Math.max(w0, 1.5 * px);
    a += (1 - smooth(0, 1, Math.abs(s - at) / w)) * (w0 / w) * k;
  }
  return a * (look.front + look.back * Math.max(0, g) ** look.backPow);
}

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Which way at latitude `lat` (the shader's `jet`: its sign is the drift's). */
export function jetAt(lat) {
  return Math.sin(lat * 9) * 0.6 + Math.sin(lat * 23 + 1.3) * 0.4;
}

// The cloud clock wraps round every CLOUD_WRAP seconds (the shader's gTime); a streak goes round
// a whole number of times in that, so it never jumps when the clock wraps.
export const CLOUD_WRAP = 10000;

/** A streak's speed round its band (radians per second of cloud time). */
export const streakSpeed = (st) => (st.turns * 2 * Math.PI) / CLOUD_WRAP;

/** Where a streak's middle is at cloud time `time` (s): its longitude in the drifting bands' frame (pure). */
export function streakLon(st, time) {
  const l = st.lon + streakSpeed(st) * (time % CLOUD_WRAP);
  return ((l % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * The farthest a streak reaches along the spin axis (its `lat` range, bend and the bands'
 * waves included), for keeping them clear of the hexagon and the storms: [min, max].
 */
export function streakReach(st) {
  const across = st.wid * (STREAK_REACH + Math.abs(st.bend) * 2);
  return [st.lat - across, st.lat + across];
}
// How many widths out a streak's feathered edge reaches (the shader stops there).
export const STREAK_REACH = 3;
// At most this many streaks per planet (the shader's arrays).
export const MAX_STREAKS = 6;

// The cloud clock follows game time (time warp speeds the clouds up) but never faster than
// MAX_RATE times real time, so at ×1000 they stream by instead of strobing.
const MAX_RATE = 20;
// The bands drift back and forth over DRIFT_PERIOD seconds of cloud time (so, unlike steady
// drift, their shear never builds up into stripes finer than a pixel).
const DRIFT_PERIOD = 900;

/**
 * A gas giant's toon material with per-pixel clouds, storms, ring shadows, soft limb, rim and
 * night fill. Returns { material, update(time, t) }, or null (no GAS_LOOK: the plain vertex-coloured bands).
 */
export function gasMaterial(body, sunDir) {
  const look = GAS_LOOK[body.id];
  const bands = GAS_BANDS[body.id];
  if (!look || !bands) return null;
  const a = SPIN_AXES[body.id];
  const axis = new THREE.Vector3(a.x, a.y, a.z).normalize();
  // A frame round the axis, for placing storms.
  const e1 = new THREE.Vector3(1, 0, 0).addScaledVector(axis, -axis.x).normalize();
  const e2 = new THREE.Vector3().crossVectors(axis, e1);
  const storms = look.storms.slice(0, 2);
  const stormU = [];
  for (let i = 0; i < 2; i++) {
    const s = storms[i];
    const on = !!s;
    const c = new THREE.Vector3();
    const east = new THREE.Vector3(), north = new THREE.Vector3();
    if (s) {
      const k = Math.sqrt(1 - s.lat * s.lat);
      c.copy(axis).multiplyScalar(s.lat).addScaledVector(e1, k * Math.cos(s.lon)).addScaledVector(e2, k * Math.sin(s.lon));
      north.copy(axis).addScaledVector(c, -c.dot(axis)).normalize();
      east.crossVectors(north, c);
      east.multiplyScalar(1 / s.size[0]);
      north.multiplyScalar(1 / s.size[1]);
    }
    stormU.push({
      c: { value: c }, east: { value: east }, north: { value: north },
      col0: { value: raw(s?.colors[0] ?? 0) }, col1: { value: raw(s?.colors[1] ?? 0) }, col2: { value: raw(s?.colors[2] ?? 0) },
      turn: { value: s?.turn ?? 0 }, on: { value: on ? 1 : 0 },
    });
  }
  // The hexagon (#55): a frame round the pole the cameras see.
  const hex = look.hexagon;
  const hexU = {};
  if (hex) {
    const f = facingPole(axis);
    const pole = new THREE.Vector3(f.x, f.y, f.z);
    const h1 = new THREE.Vector3(1, 0, 0).addScaledVector(pole, -pole.x).normalize();
    const hc = hex.colors;
    Object.assign(hexU, {
      gHexPole: { value: pole },
      gHexE1: { value: h1 },
      gHexE2: { value: new THREE.Vector3().crossVectors(pole, h1) },
      gHexSize: { value: new THREE.Vector3(hex.size, hex.width, hex.eye) },
      gHexTurn: { value: hex.turn },
      gHexBand: { value: raw(hc.band) }, gHexCore: { value: raw(hc.core) }, gHexIn: { value: raw(hc.inside) },
      gHexRim: { value: raw(hc.rim) }, gHexBody: { value: raw(hc.body) }, gHexEye: { value: raw(hc.eye) },
      gHexGlowC: { value: raw(hex.glow) },
    });
  }
  // Bright cloud streaks riding in the bands (#54 stage 6).
  const streaks = (look.streaks ?? []).slice(0, MAX_STREAKS);
  const streakA = [], streakB = [];
  for (let i = 0; i < MAX_STREAKS; i++) {
    const st = streaks[i];
    streakA.push(st ? new THREE.Vector4(st.lat, st.lon, st.len / 2, st.wid) : new THREE.Vector4());
    streakB.push(st ? new THREE.Vector4(streakSpeed(st), st.k, st.bend, 0) : new THREE.Vector4());
  }
  const haze = look.haze;
  const palette = [];
  for (let i = 0; i < 8; i++) palette.push(raw(bands.bands[i % bands.bands.length]));
  const r = body.rings;
  const uniforms = {
    rlSun: { value: sunDir },
    rlRadius: { value: body.radius },
    rlRimColor: { value: raw(look.rim) },
    rlRimK: { value: look.rimK ?? 0.55 },
    rlNightColor: { value: raw(look.night) },
    rlNightK: { value: look.nightK },
    gAxis: { value: axis },
    gE1: { value: e1 },
    gE2: { value: e2 },
    gBands: { value: palette },
    gCount: { value: bands.bands.length },
    gStripes: { value: bands.stripes },
    gTime: { value: 0 },
    gDrift: { value: 0 },
    gRing: { value: new THREE.Vector2(r ? r.inner : 0, r ? r.outer : 0) }, // in planet radii
    gStorm0C: stormU[0].c, gStorm0E: stormU[0].east, gStorm0N: stormU[0].north,
    gStorm0A: stormU[0].col0, gStorm0B: stormU[0].col1, gStorm0D: stormU[0].col2, gStorm0T: stormU[0].turn, gStorm0On: stormU[0].on,
    gStorm1C: stormU[1].c, gStorm1E: stormU[1].east, gStorm1N: stormU[1].north,
    gStorm1A: stormU[1].col0, gStorm1B: stormU[1].col1, gStorm1D: stormU[1].col2, gStorm1T: stormU[1].turn, gStorm1On: stormU[1].on,
    ...hexU,
    gStreakA: { value: streakA },
    gStreakB: { value: streakB },
    gStreakN: { value: streaks.length },
    gStreakC: { value: raw(look.streakColor ?? 0xffffff) },
    gHazeC: { value: raw(haze?.color ?? 0) },
    gHazeV: { value: new THREE.Vector3(...(haze?.veil ?? [1, 0, 0])) },
  };
  const defs = defines([
    ['RL_STORM', storms.length > 0], // (faint rings, like Tumble's, cast no shadow worth drawing)
    ['RL_RINGSHADOW', !!r && !r.faint],
    ['RL_HEX', !!hex],
    ['RL_STREAK', streaks.length > 0],
    ['RL_HAZE', !!haze],
  ]);
  const mat = new THREE.MeshToonMaterial({ gradientMap: toonGradient() });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = defs + VERT_PARS + /* glsl */ `
      uniform vec3 rlSun;
      varying vec3 gSunObj;
    ` + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}
      // The sun's direction in the planet's own (spinning) frame, for the ring shadow.
      gSunObj = normalize(rlSun * mat3(modelViewMatrix));`);
    let frag = shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = gasColor(normalize(rlObj));`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${RING_SHADOW_ON_PLANET}`)
      .replace('#include <opaque_fragment>', `${RIM_NIGHT}\n${HEX_GLOW}\n${LIMB_VEIL}\n#include <opaque_fragment>`);
    frag = frag.replace('#include <gradientmap_pars_fragment>', SOFT_GRADIENT)
      .replace('#include <lights_toon_fragment>', 'rlViewDir = normalize(vViewPosition);\n#include <lights_toon_fragment>');
    shader.fragmentShader = defs + FRAG_PARS + GAS_PARS + frag;
  };
  mat.customProgramCacheKey = () => `rich-gas:${defs}`;

  let clock = 0, lastTime = null, lastT = null;
  return {
    material: mat,
    update(time, t = time) {
      if (lastTime !== null) {
        const real = Math.max(0, time - lastTime);
        let game = t - lastT;
        if (!(game >= 0)) game = real; // rewound or no game clock
        clock += Math.min(game, real * MAX_RATE);
      }
      lastTime = time;
      lastT = t;
      uniforms.gTime.value = clock % 10000;
      uniforms.gDrift.value = look.drift * Math.sin((clock / DRIFT_PERIOD) * Math.PI * 2);
    },
  };
}

// Toon light for a big round planet: the shared 4-step gradient (materials.js) cut hard lines
// right across it (its step at half-lit was the vertical stripe), so here the day side is one
// flat tone, with a soft terminator and one soft step into the night; both soften more
// towards the limb, so the planet looks round rather than sliced.
// (vViewPosition is declared after this chunk, so main() copies it into rlViewDir first.)
const SOFT_GRADIENT = /* glsl */ `
  vec3 rlViewDir = vec3(0.0, 0.0, 1.0);
  vec3 getGradientIrradiance(vec3 normal, vec3 lightDirection) {
    float d = dot(normal, lightDirection);
    float limb = 1.0 - clamp(dot(normal, rlViewDir), 0.0, 1.0);
    float w = mix(0.08, 0.25, limb * limb);
    float g = 60.0 / 255.0;
    g += (55.0 / 255.0) * smoothstep(-0.5 - w, -0.5 + w, d);
    g += (140.0 / 255.0) * smoothstep(-0.05 - w, 0.15 + w, d);
    return vec3(g);
  }
`;

const GAS_PARS = /* glsl */ `
  uniform vec3 gAxis, gE1, gE2;
  uniform vec3 gBands[8];
  uniform int gCount;
  uniform float gStripes;
  uniform float gTime;
  uniform float gDrift;
  uniform vec2 gRing;
  #ifdef RL_STREAK
    uniform vec4 gStreakA[${MAX_STREAKS}], gStreakB[${MAX_STREAKS}];
    uniform int gStreakN;
    uniform vec3 gStreakC;
    // Bright cloud streaks (#54 stage 6), in the drifting bands' frame: each travels round its
    // band (A: lat, lon, half its length, width; B: speed, brightness, bend). Along it, it fades
    // in and out at the ends and thins towards them; across it, a soft profile eaten into by the
    // noise, so the edges are feathered wisps. Its middle bows across the band by \`bend\` widths.
    vec3 gStreaks(vec3 p, float lat, float lon, vec3 c) {
      for (int i = 0; i < ${MAX_STREAKS}; i++) {
        if (i >= gStreakN) break;
        vec4 A = gStreakA[i];
        vec4 B = gStreakB[i];
        float dl = mod(lon - A.y - B.x * gTime + 3.14159265, 6.2831853) - 3.14159265;
        float t = dl / A.z;
        if (abs(t) > 1.0) continue;
        float w = A.w * (1.0 - 0.45 * abs(t));
        float across = (lat - A.x - B.z * A.w * t * t) / w;
        if (abs(across) > ${STREAK_REACH}.0) continue;
        float n = rlNoise(p * 26.0 + vec3(0.0, 0.0, gTime * 0.003));
        float k = exp(-across * across * 1.6) * (1.0 - smoothstep(0.5, 1.0, abs(t)));
        c = mix(c, gStreakC, smoothstep(0.12, 0.7, k + (n - 0.5) * 0.55) * B.y);
      }
      return c;
    }
  #endif
  #ifdef RL_HAZE
    uniform vec3 gHazeC, gHazeV;
  #endif
  uniform vec3 gStorm0C, gStorm0E, gStorm0N, gStorm0A, gStorm0B, gStorm0D;
  uniform float gStorm0T, gStorm0On;
  uniform vec3 gStorm1C, gStorm1E, gStorm1N, gStorm1A, gStorm1B, gStorm1D;
  uniform float gStorm1T, gStorm1On;
  varying vec3 gSunObj;
  #ifdef RL_HEX
    uniform vec3 gHexPole, gHexE1, gHexE2, gHexSize;
    uniform float gHexTurn;
    uniform vec3 gHexBand, gHexCore, gHexIn, gHexRim, gHexBody, gHexEye, gHexGlowC;
  #endif
  float gHexGlow = 0.0; // how much of the hexagon's jet is here (for its night glow)

  vec3 gBand(float i) {
    return gBands[int(mod(i, float(gCount)))];
  }

  // A storm: an oval of rings (dark rim, coloured body, pale eye) with two spiral arms turning
  // slowly round it. Returns the colour mixed over c.
  vec3 gStorm(vec3 p, vec3 c, vec3 sc, vec3 se, vec3 sn, vec3 ca, vec3 cb, vec3 cd, float turn, float on) {
    if (on < 0.5 || dot(p, sc) < 0.5) return c;
    vec3 d = p - sc;
    vec2 q = vec2(dot(d, se), dot(d, sn));
    float r = length(q);
    if (r > 1.35) return c;
    float ang = atan(q.y, q.x);
    float arm = sin(ang * 2.0 - r * 6.0 + gTime * turn);
    float rr = r + arm * 0.12 * smoothstep(0.15, 0.7, r);
    vec3 s = mix(cd, cb, smoothstep(0.26, 0.31, rr));
    // Swirl lines winding in towards the eye.
    float swirl = sin(ang * 3.0 + r * 11.0 - gTime * turn * 1.5);
    s = mix(s, mix(cb, cd, 0.5), smoothstep(0.8, 0.9, swirl) * smoothstep(0.35, 0.45, rr) * (1.0 - smoothstep(0.7, 0.78, rr)));
    s = mix(s, ca, smoothstep(0.8, 0.86, rr));
    // A pale wake that trails off into the band.
    float edge = 1.0 - smoothstep(0.94, 1.0, rr);
    vec3 wake = mix(c, cd, 0.35 * (1.0 - smoothstep(1.05, 1.35, r)) * (0.5 + 0.5 * arm));
    return mix(wake, s, edge);
  }

  #ifdef RL_HEX
  // Tumble's hexagon (#55), like Saturn's: a jet stream round the pole with six straight
  // sides (a hexagon in q, the point seen from straight above the pole), a pale core streaming
  // along it, and a little vortex swirling in the middle. Edges are antialiased by their
  // on-screen size (fwidth), so they stay crisp near and far without shimmering.
  vec3 gHex(vec3 p, vec3 c) {
    if (dot(p, gHexPole) < 0.5) return c; // (well clear of the hexagon, so its derivatives are fine)
    vec2 q = vec2(dot(p, gHexE1), dot(p, gHexE2));
    float h = max(abs(q.x), max(abs(0.5 * q.x + 0.8660254 * q.y), abs(-0.5 * q.x + 0.8660254 * q.y)));
    float R = gHexSize.x, W = gHexSize.y;
    float aa = max(fwidth(h), 0.0015);
    float d = h - R;
    // Inside the hexagon: a calmer, deeper blue than the pale cap round it.
    c = mix(c, gHexIn, 1.0 - smoothstep(-W - aa, -W + aa, d));
    // The band, with a dark edge and a pale core streaming round (dashes along the sides).
    float band = 1.0 - smoothstep(W - aa, W + aa, abs(d));
    float ang = atan(q.y, q.x);
    float flow = 0.5 + 0.5 * sin(ang * 12.0 - gTime * 0.05 + d * 40.0);
    vec3 b = mix(gHexRim, gHexBand, 1.0 - smoothstep(W * 0.78 - aa, W * 0.78 + aa, abs(d)));
    float core = 1.0 - smoothstep(W * 0.28 - aa, W * 0.28 + aa, abs(d));
    b = mix(b, gHexCore, core * (0.55 + 0.45 * smoothstep(0.35, 0.65, flow)));
    c = mix(c, b, band);
    gHexGlow = band * (0.6 + 0.4 * core);
    // The vortex in the middle: dark rim, two spiral arms turning, a pale eye. (Derivatives
    // are taken outside the branch: they're undefined where neighbouring pixels branch apart.)
    float r = length(q) / gHexSize.z;
    float arm = sin(ang * 2.0 - r * 7.0 + gTime * gHexTurn);
    float aw = fwidth(arm) + 0.12;
    float ra = max(fwidth(r), 0.02);
    if (r < 1.3) {
      vec3 v = mix(gHexBody, mix(gHexBody, gHexEye, 0.55), smoothstep(-aw, aw, arm) * smoothstep(0.3, 0.45, r));
      v = mix(gHexEye, v, smoothstep(0.28 - ra, 0.28 + ra, r));
      v = mix(v, gHexRim, smoothstep(0.84 - ra, 0.84 + ra, r));
      c = mix(c, v, 1.0 - smoothstep(1.0 - ra, 1.0 + ra, r));
      gHexGlow = max(gHexGlow, 0.5 * (1.0 - smoothstep(0.28 - ra, 0.28 + ra, r)));
    }
    return c;
  }
  #endif

  vec3 gasColor(vec3 p) {
    vec3 p0 = p; // (the hexagon doesn't drift with the bands: it stays crisp)
    float lat = dot(p, gAxis);
    // Neighbouring bands drift at different speeds (jets): turn p round the axis by a
    // latitude-dependent angle.
    float jet = sin(lat * 9.0) * 0.6 + sin(lat * 23.0 + 1.3) * 0.4;
    float ang = jet * gDrift;
    float cs = cos(ang), sn = sin(ang);
    p = p * cs + cross(gAxis, p) * sn + gAxis * lat * (1.0 - cs);
    float lon = atan(dot(p, gE2), dot(p, gE1));
    float pole = abs(lat);
    float bandLat = 2.0 / (float(gCount - 1) * gStripes); // one band's width in lat
    float lat2 = lat;
    // Gentle waves along the band edges (calmer towards the poles), slowly rolling.
    lat2 += bandLat * (0.12 * sin(lon * 7.0 + lat * 13.0 + gTime * 0.006) + 0.06 * sin(lon * 13.0 - lat * 29.0 - gTime * 0.004)) * (1.0 - pole * pole);
    float f = (lat2 + 1.0) * 0.5 * float(gCount - 1) * gStripes;
    float fl = floor(f);
    float fr = f - fl;
    vec3 a = gBand(fl);
    vec3 b = gBand(fl + 1.0);
    // Crisp band edges (bands meet where fr = 0.5).
    vec3 c = mix(a, b, smoothstep(0.47, 0.53, fr));
    // Cartoon curls where two bands meet: a few per edge (N cells round the planet, some
    // empty), each a little spiral of both bands' colours, turning slowly.
    float N = 11.0;
    float u = (lon / 6.2831853 + 0.5) * N;
    float cell = floor(u);
    float h = fract(sin(fl * 12.9898 + mod(cell, N) * 78.233) * 43758.5453);
    float h2 = fract(h * 91.7);
    float du = (u - cell - 0.5 - (h2 - 0.5) * 0.4) * 6.2831853 * sqrt(max(0.0, 1.0 - lat * lat)) / N / (bandLat * 0.5);
    float dv = (fr - 0.5) * 2.0; // in half-bands
    float r = length(vec2(du, dv));
    float R = 0.8 + 0.35 * h2;
    if (h < 0.5 && r < R && pole < 0.75) {
      float dir = h < 0.25 ? 1.0 : -1.0;
      float spiral = fract(dir * atan(dv, du) / 6.2831853 + r / R * 0.85 - gTime * 0.004 * dir);
      vec3 curl = mix(a, b, smoothstep(0.46, 0.54, spiral));
      c = mix(c, curl, 1.0 - smoothstep(R - 0.08, R, r));
    }
    // Faint pale streaks running along the bands.
    float st = rlNoise((p + gAxis * (lat * 7.0)) * 4.0 + vec3(0.0, 0.0, gTime * 0.002));
    c = mix(c, vec3(1.0, 0.98, 0.93), smoothstep(0.68, 0.71, st) * 0.18 * (1.0 - pole));
    // A soft polar cap: calm, pale, a little of the first band's colour.
    c = mix(c, mix(gBand(0.0), vec3(1.0, 0.97, 0.9), 0.35), smoothstep(0.86, 0.95, pole) * 0.75);
    // A little more colour than the vertex bands had (kids like it bright).
    c = mix(vec3(dot(c, vec3(0.333))), c, 1.25);
    #ifdef RL_STREAK
      c = gStreaks(p, lat, lon, c);
    #endif
    #ifdef RL_HEX
      c = gHex(p0, c);
    #endif
    #ifdef RL_STORM
      c = gStorm(p, c, gStorm0C, gStorm0E, gStorm0N, gStorm0A, gStorm0B, gStorm0D, gStorm0T, gStorm0On);
      c = gStorm(p, c, gStorm1C, gStorm1E, gStorm1N, gStorm1A, gStorm1B, gStorm1D, gStorm1T, gStorm1On);
    #endif
    return clamp(c, 0.0, 1.0);
  }

  // How much the rings block the sun at p (unit sphere; the rings are in radii too).
  float gRingDensity(float r) {
    float t = (r - gRing.x) / (gRing.y - gRing.x);
    if (t < 0.0 || t > 1.0) return 0.0;
    float soft = smoothstep(0.0, 0.3, t) * (1.0 - smoothstep(0.7, 1.0, t)); // a wide, soft falloff
    // Broadly like the rings' texture (planets.js ringTexture), smoothed so the shadow reads
    // as a shadow, not as rings: denser middle, the Cassini-style gap, faint edges.
    float a = 0.8 + 0.15 * sin(t * 9.0 + 0.5);
    a *= 1.0 - 0.85 * smoothstep(0.565, 0.585, t) * (1.0 - smoothstep(0.625, 0.645, t));
    a *= mix(0.35, 1.0, smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.94, 1.0, t)));
    return clamp(a * soft, 0.0, 1.0);
  }
`;

// The high-altitude haze on the disc (#54 stage 6, `veilAt()`): towards the limb a sunlit
// veil of the haze's colour is laid over the clouds, washing them out a little (never over the
// hexagon). Just off the limb, the glowing shell adds the rest (planets.js `atmosphere()`).
const LIMB_VEIL = /* glsl */ `
  #ifdef RL_HAZE
  {
    vec3 rad = normalize(rlRadial);
    float ndv = clamp(dot(rad, normalize(vViewPosition)), 0.0, 1.0);
    float t = smoothstep(gHazeV.x, 1.0, sqrt(max(0.0, 1.0 - ndv * ndv)));
    float v = t * t * gHazeV.y;
    #ifdef RL_HEX
      v *= 1.0 - smoothstep(0.9, 0.96, dot(normalize(rlObj), gHexPole));
    #endif
    float day = 0.08 + 0.92 * smoothstep(-0.25, 0.35, dot(rad, rlSun));
    outgoingLight = mix(outgoingLight, outgoingLight * (1.0 - gHazeV.z) + gHazeC * day, v);
  }
  #endif
`;

// The hexagon's jet glows softly on the night side (#55; Saturn's and Uranus's poles have
// auroras), so it still shows when Tumble's pole is turned away from Ember.
const HEX_GLOW = /* glsl */ `
  #ifdef RL_HEX
  {
    float dark = 1.0 - smoothstep(-0.3, 0.1, dot(normalize(rlRadial), rlSun));
    outgoingLight += gHexGlowC * gHexGlow * dark * 0.22;
  }
  #endif
`;

// The rings' shadow on the planet: follow the sun's ray from here to the ring plane.
const RING_SHADOW_ON_PLANET = /* glsl */ `
  #ifdef RL_RINGSHADOW
  {
    vec3 p = normalize(rlObj);
    float up = dot(gSunObj, gAxis);
    float s = -dot(p, gAxis) / (abs(up) < 1e-3 ? 1e-3 : up);
    if (s > 0.0) {
      // A gentle hint of shadow (a heavy one looked ham-fisted): at most about a third of the
      // sunlight, fading in softly over the rings' width and near the terminator.
      float sh = gRingDensity(length(p + gSunObj * s)) * smoothstep(0.0, 0.35, dot(p, gSunObj));
      reflectedLight.directDiffuse *= 1.0 - 0.32 * sh * sh;
    }
  }
  #endif
`;

/** The planet's shadow on its rings (patches the rings' Lambert material). */
export function ringShadow(mat, body, sunDir) {
  if (!GAS_LOOK[body.id]) return;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rlSun = { value: sunDir };
    shader.uniforms.rlRadius = { value: body.radius };
    shader.vertexShader = /* glsl */ `
      uniform vec3 rlSun;
      varying vec3 rlObj;
      varying vec3 rlSunObj;
    ` + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      rlObj = position;
      rlSunObj = normalize(rlSun * mat3(modelViewMatrix));`);
    shader.fragmentShader = /* glsl */ `
      uniform float rlRadius;
      varying vec3 rlObj;
      varying vec3 rlSunObj;
    ` + shader.fragmentShader.replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
      {
        // Does the ray towards the sun pass through the planet? Soft at the shadow's edge.
        float b = dot(rlObj, rlSunObj);
        float c = dot(rlObj, rlObj) - rlRadius * rlRadius;
        float miss = (b * b - c) / (rlRadius * rlRadius);
        float sh = b < 0.0 ? smoothstep(0.0, 0.03, miss) : 0.0;
        reflectedLight.directDiffuse *= 1.0 - 0.85 * sh;
        totalEmissiveRadiance *= 1.0 - 0.45 * sh;
      }`);
  };
  mat.customProgramCacheKey = () => 'rich-ring-shadow';
}

// ---- The star ------------------------------------------------------------------------------

/**
 * Ember's surface (#53): soft granules, a little brighter and darker than its colour, slowly
 * boiling (two noise lookups, only on the star's own pixels), and a gentle darkening at its
 * edge. Patches its plain material; returns the per-frame update (real time: the sun boils at
 * the same pace whatever the time warp).
 */
export function starShimmer(mat, body) {
  const uniforms = { rlTime: { value: 0 }, rlRadius: { value: body.radius } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 rlObj;\nvarying vec3 rlN;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      rlObj = position;
      rlN = normalize(normalMatrix * normal);`);
    shader.fragmentShader = `uniform float rlTime;\nuniform float rlRadius;\nvarying vec3 rlObj;\nvarying vec3 rlN;\n${NOISE}`
      + shader.fragmentShader.replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
      {
        vec3 q = rlObj / rlRadius * 14.0;
        // (The second octave is turned, so value noise's grid never lines up into squares.)
        mat3 turn = mat3(0.48, -0.6, 0.64, 0.8, 0.6, 0.0, -0.36, 0.52, 0.77);
        float g = rlNoise(q + vec3(0.0, 0.0, rlTime * 0.05)) * 0.6 + rlNoise(turn * q * 2.3 - vec3(rlTime * 0.04, 0.0, 0.0)) * 0.4;
        diffuseColor.rgb *= 0.95 + 0.1 * g;
        // Limb darkening: towards the edge, deeper orange.
        float mu = clamp(abs(rlN.z), 0.0, 1.0);
        diffuseColor.rgb *= mix(vec3(0.95, 0.72, 0.5), vec3(1.0), smoothstep(0.0, 0.6, mu));
      }`);
  };
  mat.customProgramCacheKey = () => 'rich-star';
  return (time) => { uniforms.rlTime.value = time % 10000; };
}
