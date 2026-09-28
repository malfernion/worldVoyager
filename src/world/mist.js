// Frosty's crack mist (#54, stage 5). Frosty is airless, like Europa and Enceladus: no weather,
// no clouds. What it has is its glowing cracks (FROSTY_GLOWS), where the ocean under the ice
// breathes out: a thin vapour that frosts as it leaves. So the "mist" is soft pale wisps seeping
// out of each crack, hugging the ground along it and curling slowly away. By night they show
// (moonlit pale blue, lit cyan from below by the crack's glow); by day only faint wisps.
// (Tall Enceladus-style plumes were tried: standing up behind a landed rocket they read as its
// smoke, and from orbit as grey blobs floating off the edge. Left out.)
//
// Cheap for phones, the embers' way (embers.js): every wisp of a world is one instanced
// billboard in ONE draw call (premultiplied, no depth write), each a loop on the real clock
// worked out in the vertex shader (it re-rolls where it starts every time round), so there's no
// CPU work per frame beyond a few uniforms, and nothing allocated. `mistAt()` is the same sums
// in JS for the tests.
//
// Readability: they fade near the lens and when big on screen (the clouds' NEAR / BIG:
// `mistFade()`), across the line of sight to the rocket and the buggy (the embers' `sightFade()`,
// fed from FlightScene.updateClouds()), and far off (gone from orbit).
import * as THREE from 'three';
import { mulberry32 } from '../physics/noise.js';
import { FROSTY_GLOWS } from '../physics/terrain.js';
import { hash, SIGHT_VEIL, SIGHT_PAD } from './embers.js';
import { NEAR, BIG, noiseTexture } from './clouds.js';

/**
 * Each world's crack mist (only Frosty's). `cracks`: where (a list of { x, y, z, t }: the crack's
 * middle, a unit direction, and the way it runs); `len` how far along it either way the wisps
 * come out (planet radii: the groove is full to 0.1, gone by 0.18); `side` (m) how far across it.
 * `wisps` per crack, `size` (m, radius as they leave), `grow` (times, by the end), `rise` (m),
 * `drift` (m, how far they wander off the crack), `period` (s per loop), `life` (share of it
 * shown), `flat` (how squashed they're drawn, seen side-on). `day`: how much shows in full sun
 * (1 at night); `far` (m): camera distances over which they fade out. Colours: `lit` (sunlit),
 * `shade`, `night` (moonlit), `glow` (the crack's light on them, near the ground, at night);
 * `glowUp` (m): how high that light reaches.
 */
export const MIST_LOOK = {
  frosty: {
    seed: 54,
    cracks: FROSTY_GLOWS,
    len: 0.12,
    side: 1.2,
    wisps: 40,
    size: [1.8, 3.2],
    grow: 2.4,
    rise: [0.4, 1.6],
    drift: [2.5, 6],
    period: [9, 16],
    life: [0.75, 0.95],
    flat: 0.4,
    day: 0.1,
    far: [180, 360],
    lit: 0xf4f9ff,
    shade: 0xa9bfd6,
    night: 0x9cb8d8,
    glow: 0x74e4ff,
    glowUp: 2.5,
  },
};

// Per wisp: centre x, y, z (planet frame: on the crack's middle line, at the ground), spread
// along (m); the crack's way t (unit), spread across (m); period (s), life (share), phase (s),
// seed (0..1); size (m), rise (m), drift (m), grow (times).
export const MIST_STRIDE = 16;

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How much of the mist shows for the sun's height where it is (cosine: 1 overhead, -1 midnight). */
export function mistStrength(cosSun, look) {
  const night = 1 - smooth(-0.2, 0.25, cosSun);
  return look.day + (1 - look.day) * night;
}

/**
 * Where every wisp goes (pure, seeded). `ground(x, y, z)`: the ground's radius (m) under a unit
 * direction; `R`: the world's radius. The wisps are spread evenly along each crack (within `len`
 * either way of its middle), each wandering its own stretch of it and `side` across. The centre
 * sits on the highest ground out to most of the way it drifts (so a wisp never starts in the ice,
 * or drifts into a bank beside the crack).
 * Returns a Float32Array, MIST_STRIDE numbers each.
 */
export function mistPlan(look, ground, R) {
  const rand = mulberry32(look.seed);
  const between = ([a, b]) => a + rand() * (b - a);
  const out = [];
  const point = (g, along, across) => {
    // (along, across) metres from the crack's middle, back onto the unit sphere.
    const s = [g.y * g.t.z - g.z * g.t.y, g.z * g.t.x - g.x * g.t.z, g.x * g.t.y - g.y * g.t.x];
    const q = [g.x + (g.t.x * along + s[0] * across) / R, g.y + (g.t.y * along + s[1] * across) / R, g.z + (g.t.z * along + s[2] * across) / R];
    const l = Math.hypot(...q);
    return q.map((c) => c / l);
  };
  // The highest ground it can drift over: its stretch, out to either side as far as it goes.
  const high = (g, along, spread, across) => {
    let h = 0;
    for (const da of [-1, 0, 1]) for (const ds of [-1, -0.5, -0.2, 0, 0.2, 0.5, 1]) h = Math.max(h, ground(...point(g, along + da * spread, ds * across)));
    return h;
  };
  const L = look.len * R, n = look.wisps;
  for (const g of look.cracks) {
    for (let i = 0; i < n; i++) {
      const along = L * (((i + 0.2 + rand() * 0.6) / n) * 2 - 1);
      const spread = (L / n) * 1.2;
      const u = point(g, along, 0);
      const r = high(g, along, spread, look.side + look.drift[1] * 0.6);
      const period = between(look.period);
      out.push(u[0] * r, u[1] * r, u[2] * r, spread, g.t.x, g.t.y, g.t.z, look.side,
        period, between(look.life), rand() * period * 7, rand(),
        between(look.size), between(look.rise), between(look.drift), look.grow);
    }
  }
  return Float32Array.from(out);
}

/**
 * Where wisp `i` of `plan` is at `time` (s, real time), pure; the vertex shader does the same
 * sums. `out`: { x, y, z (planet frame), age (0..1 through its life; -1 while resting), alpha
 * (0..1, before the view's fades and the day's), size (m, its radius), lift (m above its centre) }.
 */
export function mistAt(plan, i, time, out = {}) {
  const k = i * MIST_STRIDE;
  const cx = plan[k], cy = plan[k + 1], cz = plan[k + 2], spread = plan[k + 3];
  const tx = plan[k + 4], ty = plan[k + 5], tz = plan[k + 6], across = plan[k + 7];
  const period = plan[k + 8], life = plan[k + 9], phase = plan[k + 10], seed = plan[k + 11];
  const size = plan[k + 12], rise = plan[k + 13], drift = plan[k + 14], grow = plan[k + 15];
  const R = Math.hypot(cx, cy, cz);
  const up = [cx / R, cy / R, cz / R];
  const s = [up[1] * tz - up[2] * ty, up[2] * tx - up[0] * tz, up[0] * ty - up[1] * tx];
  const u = (time + phase) / period;
  const cycle = Math.floor(u);
  const age = (u - cycle) / life;
  const a = Math.min(age, 1);
  // Each time round: a new start on its stretch, a new side to drift off to and a new curl.
  const n = cycle + seed * 1000;
  const h1 = hash(n * 1.37 + 0.11), h2 = hash(n * 2.71 + 0.53), h3 = hash(n * 0.83 + 0.97);
  const du0 = (h1 * 2 - 1) * spread, dv0 = (h2 * 2 - 1) * across;
  // Off the crack to one side, slowing, curling round as it goes (a lazy loop, bigger with age).
  const way = h2 < 0.5 ? -1 : 1;
  const curl = h3 * 6.2832 + a * 2.6 * way;
  const cr = 0.35 * drift * a;
  const ease = 1 - (1 - a) * (1 - a);
  const du = du0 + Math.cos(curl) * cr + (h3 - 0.5) * 0.4 * drift * ease;
  const dv = dv0 + way * drift * ease + Math.sin(curl) * cr;
  // Its bottom edge starts about on the ground; it lifts a little, and spreads.
  const lift = 0.3 * size + rise * ease;
  out.x = cx + tx * du + s[0] * dv + up[0] * lift;
  out.y = cy + ty * du + s[1] * dv + up[1] * lift;
  out.z = cz + tz * du + s[2] * dv + up[2] * lift;
  out.age = age > 1 ? -1 : age;
  out.alpha = age > 1 ? 0 : smooth(0, 0.2, age) * (1 - smooth(0.55, 1, age));
  out.size = size * (1 + (grow - 1) * a);
  out.lift = lift;
  return out;
}

/**
 * How much of a sprite shows for how far it is from the camera (0..1), pure: gone right in front
 * of the lens and when big on screen (the clouds' NEAR and BIG: a soft sprite filling the screen
 * is only a blur and costs overdraw), and far away (`far`, m). `focal`: the projection's y scale.
 */
export function mistFade(size, depth, focal, far) {
  const rs = (size * focal) / Math.max(depth, 1e-3);
  return smooth(size * NEAR[0], size * NEAR[1], depth) * (1 - smooth(BIG[0], BIG[1], rs)) * (1 - smooth(far[0], far[1], depth));
}

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec4 centre; // xyz (planet frame), spread along
  attribute vec4 way; // the crack's way (unit), spread across
  attribute vec4 timing; // period, life, phase, seed
  attribute vec4 shape; // size, rise, drift, grow
  uniform float time;
  uniform float day;
  uniform float flatK;
  uniform float glowUp;
  uniform vec3 sunDir;
  uniform vec3 foci[3];
  uniform int nFoci;
  uniform vec2 far;
  varying vec2 vUv;
  varying vec2 vNoise;
  varying float vAlpha;
  varying float vDay;
  varying float vGlow;
  varying float vLow;
  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }
  float sight(vec3 p, float r) {
    float k = 1.0;
    vec3 d = p - cameraPosition;
    for (int i = 0; i < 3; i++) {
      if (i >= nFoci) break;
      vec3 v = foci[i] - cameraPosition;
      float len = max(length(v), 1e-3);
      float along = dot(d, v) / len;
      if (along > len + r) continue;
      float t = clamp(along, 0.0, len);
      float off = length(cameraPosition + v * (t / len) - p);
      k = min(k, ${SIGHT_VEIL.toFixed(2)} + ${(1 - SIGHT_VEIL).toFixed(2)} * smoothstep(r * 0.5, r + ${SIGHT_PAD.toFixed(1)}, off));
    }
    return k;
  }
  void main() {
    float scale = length(modelMatrix[0].xyz);
    vec3 up = normalize(centre.xyz);
    vec3 side = cross(up, way.xyz);
    // Its loop (see mistAt()).
    float u = (time + timing.z) / timing.x;
    float cycle = floor(u);
    float age = (u - cycle) / timing.y;
    float a = min(age, 1.0);
    float n = cycle + timing.w * 1000.0;
    float h1 = hash11(n * 1.37 + 0.11), h2 = hash11(n * 2.71 + 0.53), h3 = hash11(n * 0.83 + 0.97);
    float du0 = (h1 * 2.0 - 1.0) * centre.w, dv0 = (h2 * 2.0 - 1.0) * way.w;
    float dir = h2 < 0.5 ? -1.0 : 1.0;
    float curl = h3 * 6.2832 + a * 2.6 * dir;
    float cr = 0.35 * shape.z * a;
    float ease = 1.0 - (1.0 - a) * (1.0 - a);
    float du = du0 + cos(curl) * cr + (h3 - 0.5) * 0.4 * shape.z * ease;
    float dv = dv0 + dir * shape.z * ease + sin(curl) * cr;
    float lift = 0.3 * shape.x + shape.y * ease;
    vec3 p = centre.xyz + way.xyz * du + side * dv + up * lift;
    float alpha = age > 1.0 ? 0.0 : smoothstep(0.0, 0.2, age) * (1.0 - smoothstep(0.55, 1.0, age));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    float s = shape.x * (1.0 + (shape.w - 1.0) * a) * scale;
    // Near the lens, big on screen and far off: gone (see mistFade()).
    alpha *= smoothstep(s * ${NEAR[0].toFixed(2)}, s * ${NEAR[1].toFixed(2)}, depth)
      * (1.0 - smoothstep(${BIG[0].toFixed(2)}, ${BIG[1].toFixed(2)}, s * projectionMatrix[1][1] / max(depth, 1e-3)))
      * (1.0 - smoothstep(far.x, far.y, depth / scale));
    // Day or night where it is (see mistStrength()).
    vec3 upV = normalize((modelViewMatrix * vec4(up, 0.0)).xyz);
    float night = 1.0 - smoothstep(-0.2, 0.25, dot(upV, sunDir));
    alpha *= day + (1.0 - day) * night;
    alpha *= sight((modelMatrix * vec4(p, 1.0)).xyz, s);
    vDay = 1.0 - night;
    // The crack's light on it, from below: only near the ground, only at night.
    vGlow = night * (1.0 - smoothstep(0.0, glowUp, shape.y * ease));
    // Lying flat along the ground (squashed along the screen's "up", as far as that shows).
    vec2 c = position.xy * 2.0;
    vec2 q = c;
    float dl = length(upV.xy);
    vLow = 0.0;
    if (dl > 0.001) {
      vec2 d2 = upV.xy / dl;
      q += d2 * dot(q, d2) * (flatK - 1.0) * dl;
      // How far down the sprite this corner is, seen side-on (its soft bottom fades out, so where
      // it dips into a bank of ice there's no hard edge).
      vLow = -dot(c, d2) * dl;
    }
    mv.xy += q * s;
    // Its bit of the noise tile, turning slowly (the wisp curls), its own spot.
    float r = timing.w * 6.2832 + dir * a * 1.2;
    vUv = c;
    vNoise = mat2(cos(r), sin(r), -sin(r), cos(r)) * c * 0.36 + vec2(timing.w * 13.0 + h1, timing.w * 29.0 + h3);
    vAlpha = alpha;
    gl_Position = projectionMatrix * mv;
    if (alpha < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    #include <logdepthbuf_vertex>
  }`;

const FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D noiseMap;
  uniform vec3 litColor;
  uniform vec3 shadeColor;
  uniform vec3 nightColor;
  uniform vec3 glowColor;
  uniform float opacity;
  varying vec2 vUv;
  varying vec2 vNoise;
  varying float vAlpha;
  varying float vDay;
  varying float vGlow;
  varying float vLow;
  void main() {
    #include <logdepthbuf_fragment>
    float r2 = dot(vUv, vUv);
    if (r2 > 1.0) discard;
    // Soft, and eaten well into by the noise: feathered wisps, never a round ball.
    float nz = texture2D(noiseMap, vNoise).r;
    float rr = min(1.0, r2 * (0.4 + 1.8 * nz));
    float fall = (1.0 - rr) * (1.0 - rr);
    float d = fall * (0.05 + 1.5 * nz * nz) - 0.1;
    float a = smoothstep(0.0, 0.8, d) * vAlpha * opacity * (1.0 - smoothstep(0.1, 0.8, vLow));
    if (a < 0.003) discard;
    // Flat light: sunlit white by day with a touch of shade in the thin bits, moonlit pale blue
    // by night, and the crack's cyan glow near the ground.
    vec3 c = mix(nightColor, mix(shadeColor, litColor, 0.4 + 0.6 * nz), vDay);
    c = mix(c, glowColor, vGlow * 0.4);
    // Mostly light added (it shows on the dark night ice), some cover (and on the bright day ice).
    gl_FragColor = vec4(c * a * (1.0 + 0.3 * vGlow), a * mix(0.45, 0.7, vDay));
    #include <colorspace_fragment>
  }`;

const quad = new THREE.PlaneGeometry(1, 1);

/**
 * A world's crack mist, or null if it has none. `sunDir`: its view-space sun direction (the
 * flight scene keeps it fresh). Returns { mesh, plan, count, update(time), fade(foci, n) }: `fade`
 * takes the points (scene coordinates) the mist must never hide.
 */
export function createMist(body, sunDir) {
  const look = MIST_LOOK[body.id];
  if (!look) return null;
  const t = body.terrainFn;
  const ground = (x, y, z) => body.radius + (t ? t.height(x, y, z) : 0);
  const plan = mistPlan(look, ground, body.radius);
  const count = plan.length / MIST_STRIDE;
  const attrs = ['centre', 'way', 'timing', 'shape'].map(() => new Float32Array(count * 4));
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < 4; j++) attrs[j].set(plan.subarray(i * MIST_STRIDE + j * 4, i * MIST_STRIDE + j * 4 + 4), i * 4);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  ['centre', 'way', 'timing', 'shape'].forEach((name, j) => geo.setAttribute(name, new THREE.InstancedBufferAttribute(attrs[j], 4)));
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), body.radius + 20);
  const foci = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const uniforms = {
    time: { value: 0 },
    flatK: { value: look.flat },
    day: { value: look.day },
    glowUp: { value: look.glowUp },
    sunDir: { value: sunDir },
    foci: { value: foci },
    nFoci: { value: 0 },
    far: { value: new THREE.Vector2(...look.far) },
    noiseMap: { value: noiseTexture() },
    litColor: { value: new THREE.Color(look.lit) },
    shadeColor: { value: new THREE.Color(look.shade) },
    nightColor: { value: new THREE.Color(look.night) },
    glowColor: { value: new THREE.Color(look.glow) },
    opacity: { value: 0.4 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'mist';
  mesh.raycast = () => {};
  mesh.renderOrder = 1;
  return {
    mesh,
    plan,
    count,
    uniforms,
    update(time) {
      uniforms.time.value = time;
    },
    fade(pts, n) {
      const m = Math.min(n, foci.length);
      for (let i = 0; i < m; i++) foci[i].set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
      uniforms.nFoci.value = m;
    },
  };
}
