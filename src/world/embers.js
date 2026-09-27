// Embers and heat shimmer over lava (#54, stage 2: Sizzle). Small glowing sparks drift up from
// the lava pools in loose clusters and wink out, and a faint wavy heat haze wobbles over each
// pool. Soft and cartoon-like, in the clouds' style (#54): no hard shapes, nothing solid.
//
// Cheap for phones: every ember and every haze sheet of a world is one instanced billboard in
// ONE draw call, blended premultiplied (an ember's core covers a little, its glow and the haze
// only add light) with no depth write. Nothing moves on the CPU: each ember is a loop on the
// clock worked out in the vertex shader (it re-rolls where it starts every time round, from a
// small hash of its seed and the loop's number), so the pool never spawns or allocates. The
// clock is real time, like the clouds' drift, never the time warp: embers are only ambient.
// `emberAt()` is the same sums in JS, for the tests.
//
// Readability: they fade out close to the camera, and across the line of sight to the rocket
// and the buggy (`sightFade()`, the clouds' sums with a smaller pad), and far away (the globe
// view stays clean; low orbit still gets a hint of twinkling glow). By night they glow brighter.
import * as THREE from 'three';
import { mulberry32 } from '../physics/noise.js';

/**
 * How each liquid kind's sparks look (only lava). `embers`: sparks per pool, plus `perArea` per
 * square metre of lava; `clusters`: how many bubbling spots each pool's sparks crowd round (the
 * rest rise anywhere over it); `size`: a spark's glowing core radius (m); `rise`: how high it
 * gets (m; a few fly higher, `high`); `period`: seconds per loop, of which `life` (share) it
 * shows; `drift`: how far it wanders sideways as it rises (m). `sheets`: haze sheets per pool
 * (and one per `sheetEvery` metres along a flow), `haze`: their height (m); `far`: camera
 * distances (m) over which the sparks fade out, `hazeFar` the haze's. Colours: `hot` (a fresh
 * spark), `cool` (a dying one), `glow` (their halo), `heat` (the haze).
 */
export const EMBER_LOOK = {
  lava: {
    seed: 45,
    embers: 14,
    perArea: 0.05,
    clusters: [2, 4],
    size: [0.1, 0.17],
    rise: [3, 7],
    high: [0.15, 12],
    period: [2.6, 4.6],
    life: [0.6, 0.95],
    drift: 2.2,
    sheets: 2,
    sheetEvery: 14,
    haze: [3.5, 5.5],
    far: [260, 520],
    hazeFar: [90, 200],
    hot: 0xffd25a,
    cool: 0xf2441a,
    glow: 0xff8a2a,
    heat: 0xff9a4a,
  },
};

// Per sprite: centre x, y, z (the planet's frame: the middle of where it starts, at the lava's
// surface), spread (m: how far from that it may start), period (s), life (share of the period
// it shows), phase (s), seed (0..1), kind (0 a spark, 1 a haze sheet), size (m: a spark's core
// radius, a sheet's half-width), rise (m: how high a spark gets, a sheet's height), drift (m).
export const EMBER_STRIDE = 12;
const SPARK = 0, SHEET = 1;

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A small hash, 0..1 (pure; the shader has the same one): no sin(), so it's the same on phones. */
export function hash(p) {
  p = (p * 0.1031) % 1;
  if (p < 0) p += 1;
  p *= p + 33.33;
  p *= p + p;
  return p - Math.floor(p);
}

/** Up + two tangents (unit) at unit direction u: the shader builds the same ones. */
function frame(u) {
  let t1 = [-u[1], u[0], 0];
  let l = Math.hypot(t1[0], t1[1]);
  if (l < 0.05) { t1 = [1, 0, 0]; l = 1; }
  t1 = t1.map((c) => c / l);
  const t2 = [u[1] * t1[2] - u[2] * t1[1], u[2] * t1[0] - u[0] * t1[2], u[0] * t1[1] - u[1] * t1[0]];
  return [t1, t2];
}

/**
 * Where every spark and haze sheet goes (pure, seeded). `pools`: a world's pool list
 * (`makePools().list`: middle line a..b, unit directions, `r` m to the shore); `R`: the lava
 * surface's radius (m). Every spark starts within `spread` of its centre, and that disc lies
 * well inside the pool (at most 0.65 of the way out to its shore, which only wobbles 20% in),
 * so they always rise out of the lava. Returns a Float32Array, EMBER_STRIDE numbers each.
 */
export function emberPlan(look, pools, R) {
  const rand = mulberry32(look.seed);
  const between = ([a, b]) => a + rand() * (b - a);
  const out = [];
  const on = (p, t) => {
    // A point on the pool's middle line (unit).
    const q = [0, 1, 2].map((i) => { const k = 'xyz'[i]; return p.a[k] + (p.b[k] - p.a[k]) * t; });
    const l = Math.hypot(...q);
    return q.map((c) => c / l);
  };
  const off = (u, du, dv) => {
    // u moved du, dv metres along its tangents (back onto the sphere).
    const [t1, t2] = frame(u);
    const q = u.map((c, i) => c + (t1[i] * du + t2[i] * dv) / R);
    const l = Math.hypot(...q);
    return q.map((c) => c / l);
  };
  pools.forEach((p) => {
    const len = p.len ?? 0;
    const area = Math.PI * p.r * p.r + 2 * p.r * len;
    const safe = p.r * 0.65; // never further than this from the middle line
    const spots = [];
    const nc = Math.round(between(look.clusters));
    for (let c = 0; c < nc; c++) {
      const u = on(p, rand());
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * safe * 0.6;
      spots.push({ u: off(u, Math.cos(a) * d, Math.sin(a) * d), spread: Math.min(safe - d, p.r * 0.2) });
    }
    const n = Math.round(look.embers + look.perArea * area);
    for (let i = 0; i < n; i++) {
      // Two in three crowd round a bubbling spot; the rest anywhere over the pool.
      const s = rand() < 0.66 ? spots[i % nc] : { u: on(p, rand()), spread: safe };
      const period = between(look.period);
      const high = rand() < look.high[0];
      out.push(...s.u.map((c) => c * R), s.spread, period, between(look.life), rand() * period * 7, rand(),
        SPARK, between(look.size), high ? look.high[1] * (0.8 + rand() * 0.4) : between(look.rise), look.drift * (0.5 + rand()));
    }
    // The haze: a couple of sheets over a round pool, more along a flow.
    const sheets = look.sheets + Math.floor(len / look.sheetEvery);
    for (let i = 0; i < sheets; i++) {
      const u = on(p, sheets > 1 ? (i + 0.5) / sheets : 0.5);
      const w = Math.min(p.r * 0.75, (p.r + len / sheets) * 0.55);
      const a = rand() * Math.PI * 2, d = rand() * p.r * 0.2;
      out.push(...off(u, Math.cos(a) * d, Math.sin(a) * d).map((c) => c * R), 0, between([5, 8]), 1, rand() * 50, rand(),
        SHEET, w * (0.9 + rand() * 0.3), between(look.haze), 0);
    }
  });
  return Float32Array.from(out);
}

/**
 * Where spark `i` of `plan` is at `time` (s, real time), pure; the vertex shader does the same
 * sums. `out`: { x, y, z (planet frame), age (0..1 through its life; -1 while it's resting),
 * alpha (0..1, before the view's fades), size (m) }.
 */
export function emberAt(plan, i, time, out = {}) {
  const k = i * EMBER_STRIDE;
  const cx = plan[k], cy = plan[k + 1], cz = plan[k + 2], spread = plan[k + 3];
  const period = plan[k + 4], life = plan[k + 5], phase = plan[k + 6], seed = plan[k + 7];
  const size = plan[k + 9], rise = plan[k + 10], drift = plan[k + 11];
  const u = (time + phase) / period;
  const cycle = Math.floor(u);
  const age = (u - cycle) / life;
  const R = Math.hypot(cx, cy, cz);
  const up = [cx / R, cy / R, cz / R];
  const [t1, t2] = frame(up);
  // Each time round: a new start in its disc, a new way to drift.
  const n = cycle + seed * 1000;
  const h1 = hash(n * 1.37 + 0.11), h2 = hash(n * 2.71 + 0.53), h3 = hash(n * 0.83 + 0.97);
  const ang = h1 * 6.2832, d = Math.sqrt(h2) * spread;
  const wa = h3 * 6.2832;
  const a = Math.min(age, 1);
  // Up fast then slowing, drifting off and wobbling a little as it goes.
  const hgt = 0.2 + rise * a * (2 - a);
  const wob = 0.3 * Math.sin(time * 2.7 + seed * 40) * a;
  const du = Math.cos(ang) * d + (Math.cos(wa) * drift + wob) * a;
  const dv = Math.sin(ang) * d + (Math.sin(wa) * drift) * a;
  out.x = cx + t1[0] * du + t2[0] * dv + up[0] * hgt;
  out.y = cy + t1[1] * du + t2[1] * dv + up[1] * hgt;
  out.z = cz + t1[2] * du + t2[2] * dv + up[2] * hgt;
  out.age = age > 1 ? -1 : age;
  out.alpha = age > 1 ? 0 : smooth(0, 0.06, age) * (1 - smooth(0.55, 1, age));
  out.size = size * (1 - 0.5 * a);
  return out;
}

// What's left of a sprite between the camera and something we must see.
export const SIGHT_VEIL = 0.1;
export const SIGHT_PAD = 3;

/**
 * How much of a sprite shows for what's behind it (0..1), pure: the clouds' `cloudFade()` line
 * of sight test with a small pad, and no "near the camera" part (see nearFade). Sprite at
 * (px, py, pz) with reach r; camera (ex, ey, ez); `foci` n points (x, y, z packed).
 */
export function sightFade(px, py, pz, r, ex, ey, ez, foci, n, pad = SIGHT_PAD) {
  const dx = px - ex, dy = py - ey, dz = pz - ez;
  let k = 1;
  for (let i = 0; i < n; i++) {
    const vx = foci[i * 3] - ex, vy = foci[i * 3 + 1] - ey, vz = foci[i * 3 + 2] - ez;
    const len = Math.hypot(vx, vy, vz) || 1;
    const along = (dx * vx + dy * vy + dz * vz) / len;
    if (along > len + r) continue; // behind it
    const t = Math.max(0, Math.min(len, along));
    const off = Math.hypot(ex + (vx * t) / len - px, ey + (vy * t) / len - py, ez + (vz * t) / len - pz);
    k = Math.min(k, SIGHT_VEIL + (1 - SIGHT_VEIL) * smooth(r * 0.5, r + pad, off));
  }
  return k;
}

/**
 * How much of a sprite shows for how far it is from the camera (0..1), pure: gone right in
 * front of the lens (never a big blob on screen), and far away (`far`, m: from low orbit only
 * a hint, from the globe nothing).
 */
export function nearFade(size, depth, far) {
  return smooth(size * 3, size * 8, depth) * (1 - smooth(far[0], far[1], depth));
}

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec4 centre; // xyz (planet frame), spread
  attribute vec4 timing; // period, life, phase, seed
  attribute vec4 shape; // kind, size, rise, drift
  uniform float time;
  uniform vec3 sunDir;
  uniform vec3 foci[3];
  uniform int nFoci;
  uniform vec2 far;
  uniform vec2 hazeFar;
  uniform vec3 hotColor;
  uniform vec3 coolColor;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vAlpha;
  varying float vKind;
  varying float vNight;
  varying float vSeed;
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
    vec3 t1 = vec3(-up.y, up.x, 0.0);
    if (length(t1) < 0.05) t1 = vec3(1.0, 0.0, 0.0);
    t1 = normalize(t1);
    vec3 t2 = cross(up, t1);
    vec3 upV = normalize((modelViewMatrix * vec4(up, 0.0)).xyz);
    vNight = 1.0 - smoothstep(-0.25, 0.3, dot(upV, sunDir));
    vUv = position.xy * 2.0;
    vKind = shape.x;
    vSeed = timing.w;
    vec3 p;
    float size, alpha;
    vec4 mv;
    if (shape.x < 0.5) {
      // A spark (see emberAt()).
      float u = (time + timing.z) / timing.x;
      float cycle = floor(u);
      float age = (u - cycle) / timing.y;
      float n = cycle + timing.w * 1000.0;
      float ang = hash11(n * 1.37 + 0.11) * 6.2832, d = sqrt(hash11(n * 2.71 + 0.53)) * centre.w;
      float wa = hash11(n * 0.83 + 0.97) * 6.2832;
      float a = min(age, 1.0);
      float hgt = 0.2 + shape.z * a * (2.0 - a);
      float wob = 0.3 * sin(time * 2.7 + timing.w * 40.0) * a;
      float du = cos(ang) * d + (cos(wa) * shape.w + wob) * a;
      float dv = sin(ang) * d + sin(wa) * shape.w * a;
      p = centre.xyz + t1 * du + t2 * dv + up * hgt;
      alpha = age > 1.0 ? 0.0 : smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.55, 1.0, age));
      // A twinkle, and hot to cool as it rises.
      alpha *= 0.7 + 0.3 * sin(time * (9.0 + 8.0 * timing.w) + timing.w * 60.0);
      vCol = mix(hotColor, coolColor, smoothstep(0.1, 0.9, a));
      size = shape.y * (1.0 - 0.5 * a) * scale;
      mv = modelViewMatrix * vec4(p, 1.0);
      float depth = -mv.z;
      // Close to the lens: gone (see nearFade()); far off: a hint of twinkling light, not dots.
      alpha *= smoothstep(size * 3.0, size * 8.0, depth) * (1.0 - smoothstep(far.x, far.y, depth / scale));
      // Never smaller than about a pixel: further off, a spark grows dimmer instead.
      float s = max(size, depth * 0.0025);
      alpha *= size / s;
      // The glow round it: three core radii.
      mv.xy += position.xy * s * 6.0;
      size = s;
    } else {
      // A haze sheet: stands up over the pool, turned to face the camera round its up.
      p = centre.xyz + up * 0.3;
      mv = modelViewMatrix * vec4(p, 1.0);
      vec3 toCam = normalize(-mv.xyz);
      vec3 side = cross(upV, toCam);
      float sl = length(side);
      side = sl > 1e-3 ? side / sl : vec3(1.0, 0.0, 0.0);
      float w = shape.y * scale, h = shape.z * scale;
      mv.xyz += side * position.x * 2.0 * w + upV * (position.y + 0.5) * h;
      float depth = -mv.z;
      // Seen from above it's only a sliver: fade it (and from orbit, and close up).
      alpha = smoothstep(0.35, 0.8, sl) * (1.0 - smoothstep(hazeFar.x, hazeFar.y, depth / scale))
        * smoothstep(w * 0.5, w * 1.6, depth);
      vCol = vec3(1.0);
      size = max(w, h);
    }
    alpha *= sight((modelMatrix * vec4(p, 1.0)).xyz, size);
    vAlpha = alpha;
    gl_Position = projectionMatrix * mv;
    if (alpha < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    #include <logdepthbuf_vertex>
  }`;

const FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float time;
  uniform vec3 glowColor;
  uniform vec3 heatColor;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vAlpha;
  varying float vKind;
  varying float vNight;
  varying float vSeed;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 c;
    float cover;
    if (vKind < 0.5) {
      // A spark: a small hot core that covers a little (so it shows on the bright ground by
      // day) in a soft glow that only adds light (brighter by night).
      float r2 = dot(vUv, vUv);
      if (r2 > 1.0) discard;
      float r = sqrt(r2) * 3.0; // in core radii
      float core = 1.0 - smoothstep(0.55, 1.0, r);
      float glow = exp(-r2 * 7.0) * (1.0 - r2) * mix(0.4, 0.95, vNight);
      c = vCol * core + glowColor * glow;
      cover = core * 0.85;
    } else {
      // Heat haze: a faint warm glow thinning upwards, crossed by soft wavy streaks that rise
      // and wobble (a cartoon's heat squiggles); a soft oval, no edges, thin at the base.
      float x = vUv.x, y = vUv.y * 0.5 + 0.5;
      float e = x * x + (y - 0.4) * (y - 0.4) * 5.0;
      float edge = (1.0 - smoothstep(0.1, 1.0, e)) * smoothstep(0.0, 0.25, y);
      float wx = x * 3.2 + 0.3 * sin(y * 9.0 - time * 2.3 + vSeed * 30.0) + 0.12 * sin(y * 17.0 - time * 3.7 + vSeed * 11.0);
      float streak = pow(0.5 + 0.5 * cos(wx * 3.1416 + vSeed * 7.0), 12.0);
      float blobs = smoothstep(-0.2, 1.0, sin(y * 10.0 - time * 2.9 + x * 2.0 + vSeed * 17.0));
      float haze = edge * (0.05 * (1.0 - y) + 0.45 * streak * blobs);
      c = heatColor * haze * mix(0.45, 0.55, vNight);
      cover = 0.0;
    }
    gl_FragColor = vec4(c * vAlpha, cover * vAlpha);
    if (max(gl_FragColor.r, gl_FragColor.a) < 0.002) discard;
    #include <colorspace_fragment>
  }`;

const quad = new THREE.PlaneGeometry(1, 1);

/**
 * A world's embers and heat haze, or null if it has no lava. `sunDir`: its view-space sun
 * direction (the flight scene keeps it fresh). Returns { mesh, update(time), fade(foci, n),
 * count }: `fade` takes the points (scene coordinates) the sparks must never hide.
 */
export function createEmbers(body, sunDir) {
  const look = EMBER_LOOK[body.liquid?.kind];
  const pools = body.terrainFn?.pools?.list;
  if (!look || !pools?.length) return null;
  const plan = emberPlan(look, pools, body.liquidR);
  const count = plan.length / EMBER_STRIDE;
  const centre = new Float32Array(count * 4), timing = new Float32Array(count * 4), shape = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const k = i * EMBER_STRIDE;
    centre.set(plan.subarray(k, k + 4), i * 4);
    timing.set(plan.subarray(k + 4, k + 8), i * 4);
    shape.set(plan.subarray(k + 8, k + 12), i * 4);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('centre', new THREE.InstancedBufferAttribute(centre, 4));
  geo.setAttribute('timing', new THREE.InstancedBufferAttribute(timing, 4));
  geo.setAttribute('shape', new THREE.InstancedBufferAttribute(shape, 4));
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), body.radius + look.high[1] + 5);
  const foci = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const uniforms = {
    time: { value: 0 },
    sunDir: { value: sunDir },
    foci: { value: foci },
    nFoci: { value: 0 },
    far: { value: new THREE.Vector2(...look.far) },
    hazeFar: { value: new THREE.Vector2(...look.hazeFar) },
    hotColor: { value: new THREE.Color(look.hot) },
    coolColor: { value: new THREE.Color(look.cool) },
    glowColor: { value: new THREE.Color(look.glow) },
    heatColor: { value: new THREE.Color(look.heat) },
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
  mesh.name = 'embers';
  mesh.raycast = () => {};
  // After the lava and the clouds' soft sprites (it's all light and small sparks).
  mesh.renderOrder = 1;
  return {
    mesh,
    plan,
    count,
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
