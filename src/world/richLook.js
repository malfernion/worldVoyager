// Richer cartoon worlds (#51: Ringo, Dusty and Pebble so far): the same chunky toon look,
// with more depth, detail and motion, and cheap enough for phones. Nothing here changes
// geometry (the physics ground stays the visible mesh) or adds draw calls: it bakes shading
// into vertex colours once, and extends the worlds' toon materials with small shader snippets
// (a few value-noise lookups, no textures).
//
// A world opts in by having an entry in ROCKY_LOOK (rocky worlds) or GAS_LOOK (gas giants,
// whose bands come from GAS_BANDS in terrain.js); every other world keeps the plain toon look.
import * as THREE from 'three';
import { SPIN_AXES, GAS_BANDS, SIZZLE_VENTS, FROSTY_GLOWS, facingPole } from '../physics/terrain.js';
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
  const defs = defines([['RL_TINT', !!look.tint], ['RL_RIM_SURFACE', !!look.rimSurface]]);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = defs + VERT_PARS + 'attribute float rich;\nvarying float rlRich;\nvarying float rlLevel;\n'
      + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}\nrlRich = rich;\nrlLevel = abs(dot(normalize(normal), normalize(position)));`);
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
    ` + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n${ROCKY_COLOR}`)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= rlAmbientK;')
      .replace('#include <opaque_fragment>', `${RIM_NIGHT}\n#include <opaque_fragment>`);
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

// ---- Gas giants --------------------------------------------------------------------------------

/**
 * Tumble's hexagon (#55), Saturn's six-sided polar storm: a crisp jet-stream band round the
 * pole (`size`: its flat sides' distance from the pole, `width`: the band's, both seen from
 * straight above the pole, in planet radii), with a little vortex (`eye`) in the middle.
 * Colours: the band, its pale core, inside the hexagon, and the vortex's rim, body and eye.
 * `turn` is how fast the vortex swirls; the hexagon turns with the planet.
 */
export const HEXAGON = {
  size: 0.32, width: 0.055, eye: 0.09, turn: 0.12,
  colors: { band: 0x0f3f8a, core: 0xa8f0ff, inside: 0x3a88c4, rim: 0x0a2656, body: 0x1f5aa8, eye: 0xeafcff },
  glow: 0x8fe8ff, // its jet glows softly on the night side, like an aurora
};

/**
 * Each gas giant's cloud look: storms (latitude `lat` along the spin axis, -1..1, longitude `lon`,
 * size across and up in radians, colours from the rim in to the eye, and how fast they turn),
 * how much its bands drift (`drift`, radians), its rim colour, and optionally a polar `hexagon`
 * (#55). Generic over the axis and palette, so another gas giant (Tumble) opts in with an entry here.
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
  },
};

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
  };
  const defs = defines([
    ['RL_STORM', storms.length > 0], // (faint rings, like Tumble's, cast no shadow worth drawing)
    ['RL_RINGSHADOW', !!r && !r.faint],
    ['RL_HEX', !!hex],
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
      .replace('#include <opaque_fragment>', `${RIM_NIGHT}\n${HEX_GLOW}\n#include <opaque_fragment>`);
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
