// Richer cartoon worlds (#51, a trial on Ringo, Dusty and Pebble): the same chunky toon look,
// with more depth, detail and motion, and cheap enough for phones. Nothing here changes
// geometry (the physics ground stays the visible mesh) or adds draw calls: it bakes shading
// into vertex colours once, and extends the worlds' toon materials with small shader snippets
// (a few value-noise lookups, no textures).
//
// Every idea has its own switch in VISUALS, so the owner can keep some and drop others. For a
// side-by-side check in the browser: `?look=old` turns them all off, `?look=-ao,-storm` only those.
import * as THREE from 'three';
import { SPIN_AXES, GAS_BANDS } from '../physics/terrain.js';
import { toonGradient } from './materials.js';

export const VISUALS = {
  worlds: ['ringo', 'dusty', 'pebble'], // the trial's worlds; the rest keep the old look
  // Rocky worlds
  ao: true, // baked relief shading: hollows darker, ridges and rims lighter (vertex colours)
  detail: true, // per-pixel speckles and streaks, in object space, faded out when far
  slope: true, // steep faces rocky, flat ones dusty
  // Both
  rim: true, // a soft rim of sunlight round the lit edge, seen from space
  night: true, // a faint cool fill on the night side
  // Gas giants
  clouds: true, // per-pixel bands with slowly swirling, drifting turbulence
  storm: true, // a slowly turning oval storm or two
  ringShadows: true, // the rings' shadow on the planet and the planet's on the rings
  softLimb: true, // the toon light bands soften towards the planet's edge
};

// `?look=old` (all off) or `?look=-ao,-detail` (just those off).
(() => {
  let q = null;
  try { q = new URLSearchParams(globalThis.location?.search ?? '').get('look'); } catch { /* no page */ }
  if (!q) return;
  for (const k of Object.keys(VISUALS)) if (k !== 'worlds' && (q === 'old' || q.split(',').includes(`-${k}`))) VISUALS[k] = false;
})();

/** Is the richer look on for this world (any of its ideas)? */
export function richOn(id, gas) {
  if (!VISUALS.worlds.includes(id)) return false;
  return gas
    ? VISUALS.clouds || VISUALS.storm || VISUALS.ringShadows || VISUALS.softLimb || VISUALS.rim || VISUALS.night
    : VISUALS.detail || VISUALS.slope || VISUALS.rim || VISUALS.night;
}

// Colours are used as raw 0..1 values, like the terrain's vertex colours (so the palettes match).
const raw = (hex) => new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

// ---- Baked relief shading (pure: tested in test/richLook.test.js) ----------------------------

/**
 * How much to brighten (> 1) or darken (< 1) each vertex's colour from the shape of the ground
 * round it. `heights` are the vertices' heights above the world's base radius, `index` the
 * mesh's triangles. Each vertex is compared with the average height round it at a few sizes
 * (its neighbours, then wider and wider after more smoothing passes: about 1, 2.5 and 6 triangles
 * out): below the average is a hollow (crater floors, valleys), above is a ridge or a crater's
 * rim. Scaled by how bumpy the whole world is, so one setting works for every world. Runs once
 * when the mesh is built (a few tens of milliseconds).
 */
export function reliefShade(heights, index, { dark = 0.3, light = 0.14, scales = [[1, 0.3], [6, 0.35], [32, 0.35]] } = {}) {
  const n = heights.length;
  const sum = new Float64Array(n);
  const count = new Uint16Array(n);
  // Each edge once per triangle side (a closed mesh counts every edge twice: same weights).
  const nb = new Uint32Array(index.length * 2);
  for (let f = 0; f < index.length; f += 3) {
    for (let e = 0; e < 3; e++) {
      nb[(f + e) * 2] = index[f + e];
      nb[(f + e) * 2 + 1] = index[f + ((e + 1) % 3)];
    }
  }
  for (let k = 0; k < nb.length; k += 2) { count[nb[k]]++; count[nb[k + 1]]++; }
  let s = Float32Array.from(heights);
  const next = new Float32Array(n);
  const cav = new Float32Array(n);
  let done = 0;
  for (const [passes, weight] of scales) {
    for (; done < passes; done++) {
      sum.fill(0);
      for (let k = 0; k < nb.length; k += 2) {
        const a = nb[k], b = nb[k + 1];
        sum[a] += s[b];
        sum[b] += s[a];
      }
      for (let i = 0; i < n; i++) next[i] = count[i] ? sum[i] / count[i] : s[i];
      s.set(next);
    }
    for (let i = 0; i < n; i++) cav[i] += weight * (heights[i] - s[i]);
  }
  let rms = 0;
  for (let i = 0; i < n; i++) rms += cav[i] * cav[i];
  rms = Math.sqrt(rms / n) || 1;
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
    #ifdef RL_RIM
      float edge = 1.0 - clamp(dot(rad, normalize(vViewPosition)), 0.0, 1.0);
      // A cartoon rim: a band of sunlight hugging the lit edge, crisp inside, fading out.
      float rim = smoothstep(0.6, 0.72, edge) * (0.55 + 0.45 * smoothstep(0.72, 0.95, edge));
      rim *= smoothstep(-0.2, 0.3, sunK) * smoothstep(1.25, 1.8, rlFar);
      outgoingLight += rlRimColor * rim * 0.55;
    #endif
    #ifdef RL_NIGHT
      // Moonlight-blue fill: the ground's own colour, cooled and lifted (linear light, so modest).
      float nightK = 1.0 - smoothstep(-0.3, 0.1, sunK);
      outgoingLight += (diffuseColor.rgb * 0.75 + 0.25) * rlNightColor * rlNightK * nightK;
    #endif
  }
`;

const VERT_PARS = /* glsl */ `
  uniform float rlRadius;
  varying vec3 rlObj;
  varying vec3 rlRadial;
  varying float rlFar;
`;
const VERT_MAIN = /* glsl */ `
  rlObj = position;
  rlRadial = normalize(normalMatrix * position);
  // How far the camera is from the middle, in world radii (the map draws worlds bigger).
  rlFar = length((modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz) / (rlRadius * length(modelViewMatrix[0].xyz));
`;
const FRAG_PARS = /* glsl */ `
  uniform vec3 rlSun;
  uniform vec3 rlRimColor;
  uniform vec3 rlNightColor;
  uniform float rlNightK;
  varying vec3 rlObj;
  varying vec3 rlRadial;
  varying float rlFar;
  ${NOISE}
`;

function defines(list) {
  return list.filter(([, on]) => on).map(([d]) => `#define ${d}\n`).join('');
}

// ---- Rocky worlds ------------------------------------------------------------------------------

/**
 * Each trial world's extra colours: `rock` for steep faces, `dust` for flat ground, `speck` and
 * `streak` for the fine detail, `rim` the sunlit edge, `night` the night side's fill (added, so
 * small), `ao` the baked relief's strength and `speckle` [how rare (0..1, higher: fewer), how bright]
 * the pale pebbles are (Pebble's bright regolith and ejecta).
 */
export const ROCKY_LOOK = {
  dusty: { rock: 0x7e3a22, dust: 0xe79a66, speck: 0xf6c49a, streak: 0x9a452a, rim: 0xffc890, night: 0x24388a, nightK: 0.28, ao: { dark: 0.4, light: 0.16 }, speckle: [0.8, 0.45] },
  pebble: { rock: 0x746d64, dust: 0xd9d4ca, speck: 0xfdfcf8, streak: 0x8c857b, rim: 0xfff2dc, night: 0x2a408a, nightK: 0.3, ao: { dark: 0.55, light: 0.32 }, speckle: [0.72, 0.8] },
};

/** Baked relief shading for a trial world's terrain colours (in place), if it's switched on. */
export function bakeRelief(body, heights, index, colors) {
  const look = ROCKY_LOOK[body.id];
  if (!VISUALS.ao || !look || !VISUALS.worlds.includes(body.id)) return;
  const shade = reliefShade(heights, index, look.ao);
  for (let i = 0; i < shade.length; i++) {
    for (let c = 0; c < 3; c++) colors[i * 3 + c] = Math.min(1, colors[i * 3 + c] * shade[i]);
  }
}

/**
 * Extends a trial world's toon terrain material with per-pixel detail, slope colours, rim and
 * night fill. `sunDir`: the world's view-space sun direction, shared (the flight scene updates it).
 */
export function richRocky(mat, body, sunDir) {
  const look = ROCKY_LOOK[body.id];
  if (!look || !richOn(body.id, false)) return mat;
  const defs = defines([['RL_DETAIL', VISUALS.detail], ['RL_SLOPE', VISUALS.slope], ['RL_RIM', VISUALS.rim], ['RL_NIGHT', VISUALS.night]]);
  const uniforms = {
    rlSun: { value: sunDir },
    rlRadius: { value: body.radius },
    rlRimColor: { value: raw(look.rim) },
    rlNightColor: { value: raw(look.night) },
    rlNightK: { value: look.nightK },
    rlRock: { value: raw(look.rock) },
    rlDust: { value: raw(look.dust) },
    rlSpeck: { value: raw(look.speck) },
    rlStreak: { value: raw(look.streak) },
    rlSpeckAt: { value: look.speckle[0] },
    rlSpeckK: { value: look.speckle[1] },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = defs + VERT_PARS + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = defs + FRAG_PARS + /* glsl */ `
      uniform vec3 rlRock;
      uniform vec3 rlDust;
      uniform vec3 rlSpeck;
      uniform vec3 rlStreak;
      uniform float rlSpeckAt;
      uniform float rlSpeckK;
    ` + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n${ROCKY_COLOR}`)
      .replace('#include <opaque_fragment>', `${RIM_NIGHT}\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `rich-rocky:${defs}`;
  return mat;
}

// Object space (metres), so the detail is stuck to the ground wherever the world is drawn.
const ROCKY_COLOR = /* glsl */ `
  {
    #ifdef RL_SLOPE
      // Each triangle's own slope (from screen derivatives), so the colour keeps the facets.
      vec3 faceN = normalize(cross(dFdx(rlObj), dFdy(rlObj)));
      float level = abs(dot(faceN, normalize(rlObj)));
      float steep = 1.0 - smoothstep(0.84, 0.87, level);
      diffuseColor.rgb = mix(diffuseColor.rgb, rlRock, steep * 0.72);
      diffuseColor.rgb = mix(diffuseColor.rgb, rlDust, smoothstep(0.93, 0.975, level) * 0.22);
    #endif
    #ifdef RL_DETAIL
      // How many metres one pixel covers: detail finer than a few pixels fades out (no grain from far).
      float px = length(fwidth(rlObj));
      // Wind streaks: long blotches (stretched along one axis), two tones with crisp edges.
      float sn = rlNoise(rlObj * vec3(0.03, 0.11, 0.11) + 3.1);
      float streakK = (1.0 - smoothstep(0.8, 2.5, px));
      diffuseColor.rgb = mix(diffuseColor.rgb, rlStreak, smoothstep(0.6, 0.64, sn) * 0.3 * streakK);
      diffuseColor.rgb = mix(diffuseColor.rgb, rlDust, (1.0 - smoothstep(0.34, 0.38, sn)) * 0.1 * streakK);
      // Speckles: little pale pebbles and dark pits, about a metre across.
      float fn = rlNoise(rlObj * 1.7);
      float speckK = 1.0 - smoothstep(0.06, 0.25, px);
      diffuseColor.rgb = mix(diffuseColor.rgb, rlSpeck, smoothstep(rlSpeckAt, rlSpeckAt + 0.02, fn) * rlSpeckK * speckK);
      diffuseColor.rgb = mix(diffuseColor.rgb, rlRock, (1.0 - smoothstep(0.17, 0.19, fn)) * 0.3 * speckK);
    #endif
    // Mixing in the extra colours greys things a little: win the colour back (bright for kids).
    diffuseColor.rgb = max(mix(vec3(dot(diffuseColor.rgb, vec3(0.333))), diffuseColor.rgb, 1.15), 0.0);
  }
`;

// ---- Gas giants --------------------------------------------------------------------------------

/**
 * Each gas giant's cloud look: storms (latitude `lat` along the spin axis, -1..1, longitude `lon`,
 * size across and up in radians, colours from the rim in to the eye, and how fast they turn),
 * how much its bands drift (`drift`, radians) and its rim colour. Generic over the axis and
 * palette so Tumble can use it later; only Ringo is in the trial (VISUALS.worlds).
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
  tumble: {
    storms: [{ lat: -0.3, lon: 1.2, size: [0.16, 0.09], colors: [0x6cbcbc, 0xc9f2ee, 0xf2fffd], turn: 0.1 }],
    drift: 0.2,
    rim: 0xe0fffb,
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
 * night fill. Returns { material, update(time, t) }, or null to keep the old vertex-coloured one.
 */
export function gasMaterial(body, sunDir) {
  const look = GAS_LOOK[body.id];
  const bands = GAS_BANDS[body.id];
  if (!look || !bands || !richOn(body.id, true)) return null;
  const a = SPIN_AXES[body.id];
  const axis = new THREE.Vector3(a.x, a.y, a.z).normalize();
  // A frame round the axis, for placing storms.
  const e1 = new THREE.Vector3(1, 0, 0).addScaledVector(axis, -axis.x).normalize();
  const e2 = new THREE.Vector3().crossVectors(axis, e1);
  const storms = look.storms.slice(0, 2);
  const stormU = [];
  for (let i = 0; i < 2; i++) {
    const s = storms[i];
    const on = !!s && VISUALS.storm;
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
  const palette = [];
  for (let i = 0; i < 8; i++) palette.push(raw(bands.bands[i % bands.bands.length]));
  const r = body.rings;
  const uniforms = {
    rlSun: { value: sunDir },
    rlRadius: { value: body.radius },
    rlRimColor: { value: raw(look.rim) },
    rlNightColor: { value: raw(look.night) },
    rlNightK: { value: look.nightK },
    gAxis: { value: axis },
    gE1: { value: e1 },
    gE2: { value: e2 },
    gBands: { value: palette },
    gCount: { value: bands.bands.length },
    gStripes: { value: bands.stripes },
    gWarp: { value: bands.warp },
    gTime: { value: 0 },
    gDrift: { value: 0 },
    gRing: { value: new THREE.Vector2(r ? r.inner : 0, r ? r.outer : 0) }, // in planet radii
    gStorm0C: stormU[0].c, gStorm0E: stormU[0].east, gStorm0N: stormU[0].north,
    gStorm0A: stormU[0].col0, gStorm0B: stormU[0].col1, gStorm0D: stormU[0].col2, gStorm0T: stormU[0].turn, gStorm0On: stormU[0].on,
    gStorm1C: stormU[1].c, gStorm1E: stormU[1].east, gStorm1N: stormU[1].north,
    gStorm1A: stormU[1].col0, gStorm1B: stormU[1].col1, gStorm1D: stormU[1].col2, gStorm1T: stormU[1].turn, gStorm1On: stormU[1].on,
  };
  const defs = defines([
    ['RL_CLOUDS', VISUALS.clouds], ['RL_STORM', VISUALS.storm && storms.length > 0],
    ['RL_RINGSHADOW', VISUALS.ringShadows && !!r && !r.faint], ['RL_SOFTLIMB', VISUALS.softLimb],
    ['RL_RIM', VISUALS.rim], ['RL_NIGHT', VISUALS.night],
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
      .replace('#include <opaque_fragment>', `${RIM_NIGHT}\n#include <opaque_fragment>`);
    if (VISUALS.softLimb) {
      frag = frag.replace('#include <gradientmap_pars_fragment>', SOFT_GRADIENT)
        .replace('#include <lights_toon_fragment>', 'rlViewDir = normalize(vViewPosition);\n#include <lights_toon_fragment>');
    }
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
  uniform float gWarp;
  uniform float gTime;
  uniform float gDrift;
  uniform vec2 gRing;
  uniform vec3 gStorm0C, gStorm0E, gStorm0N, gStorm0A, gStorm0B, gStorm0D;
  uniform float gStorm0T, gStorm0On;
  uniform vec3 gStorm1C, gStorm1E, gStorm1N, gStorm1A, gStorm1B, gStorm1D;
  uniform float gStorm1T, gStorm1On;
  varying vec3 gSunObj;

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

  vec3 gasColor(vec3 p) {
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
    #ifdef RL_CLOUDS
      // Gentle waves along the band edges (calmer towards the poles), slowly rolling.
      lat2 += bandLat * (0.12 * sin(lon * 7.0 + lat * 13.0 + gTime * 0.006) + 0.06 * sin(lon * 13.0 - lat * 29.0 - gTime * 0.004)) * (1.0 - pole * pole);
    #else
      lat2 += (rlNoise(p * 3.0) - 0.5) * gWarp;
    #endif
    float f = (lat2 + 1.0) * 0.5 * float(gCount - 1) * gStripes;
    float fl = floor(f);
    float fr = f - fl;
    vec3 a = gBand(fl);
    vec3 b = gBand(fl + 1.0);
    // Crisp band edges (bands meet where fr = 0.5).
    vec3 c = mix(a, b, smoothstep(0.47, 0.53, fr));
    #ifdef RL_CLOUDS
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
    #endif
    // A soft polar cap: calm, pale, a little of the first band's colour.
    c = mix(c, mix(gBand(0.0), vec3(1.0, 0.97, 0.9), 0.35), smoothstep(0.86, 0.95, pole) * 0.75);
    // A little more colour than the vertex bands had (kids like it bright).
    c = mix(vec3(dot(c, vec3(0.333))), c, 1.25);
    #ifdef RL_STORM
      c = gStorm(p, c, gStorm0C, gStorm0E, gStorm0N, gStorm0A, gStorm0B, gStorm0D, gStorm0T, gStorm0On);
      c = gStorm(p, c, gStorm1C, gStorm1E, gStorm1N, gStorm1A, gStorm1B, gStorm1D, gStorm1T, gStorm1On);
    #endif
    return clamp(c, 0.0, 1.0);
  }

  // How much the rings block the sun at p (unit sphere; the rings are in radii too).
  float gRingDensity(float r) {
    float t = (r - gRing.x) / (gRing.y - gRing.x);
    if (t < -0.03 || t > 1.03) return 0.0;
    float soft = smoothstep(-0.03, 0.02, t) * (1.0 - smoothstep(0.98, 1.03, t)); // soft outer edges
    // Broadly like the rings' texture (planets.js ringTexture), smoothed so the shadow reads
    // as a shadow, not as rings: denser middle, the Cassini-style gap, faint edges.
    float a = 0.8 + 0.15 * sin(t * 9.0 + 0.5);
    a *= 1.0 - 0.85 * smoothstep(0.565, 0.585, t) * (1.0 - smoothstep(0.625, 0.645, t));
    a *= mix(0.35, 1.0, smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.94, 1.0, t)));
    return clamp(a * soft, 0.0, 1.0);
  }
`;

// The rings' shadow on the planet: follow the sun's ray from here to the ring plane.
const RING_SHADOW_ON_PLANET = /* glsl */ `
  #ifdef RL_RINGSHADOW
  {
    vec3 p = normalize(rlObj);
    float up = dot(gSunObj, gAxis);
    float s = -dot(p, gAxis) / (abs(up) < 1e-3 ? 1e-3 : up);
    if (s > 0.0) {
      // A real shadow: most of the sunlight gone, a touch of the sky light too (only where the
      // sun shines, so the night side is untouched), warm-dark rather than grey.
      float sh = gRingDensity(length(p + gSunObj * s)) * smoothstep(-0.05, 0.15, dot(p, gSunObj));
      reflectedLight.directDiffuse *= 1.0 - 0.82 * sh;
      reflectedLight.indirectDiffuse *= 1.0 - 0.3 * sh;
    }
  }
  #endif
`;

/** The planet's shadow on its rings (patches the rings' Lambert material). */
export function ringShadow(mat, body, sunDir) {
  if (!VISUALS.ringShadows || !VISUALS.worlds.includes(body.id)) return;
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
