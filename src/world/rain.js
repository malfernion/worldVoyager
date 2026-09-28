// Methane rain (#54, stage 4: Misty). Like Titan's: now and then a shower drifts across the moon,
// a patch of pale rain clouds with faint grey shafts of rain hanging under them; down in one the
// orange sky dims and closes in a little, and big, slow drops drift down round what the camera
// follows: soft splashes and damp spots where they land on the ground, spreading rings on the
// methane lakes, and the patter of rain (audio.js `setRain()`, `rainVolume()`). Gentle, not a
// downpour.
//
// It has the same shape as Dusty's dust storms (storms.js), so the flight scene treats both the
// same way (`v.storms`: FlightScene.updateHaze() / updateClouds() / updateStorms()):
// - Where the showers are is `stormAt()` (pure; the showers are regions like the storms, drifting
//   round on the real clock), and down in one the sky only goes through updateHaze() with
//   `SKY_LOOK.misty.storm`: the fog is still counted from what the camera follows.
// - From space and from low down, a shower is a cloud layer of its own (clouds.js,
//   `createCloudLayer()`: one draw call, faded near the camera and veiled over the rocket and
//   buggy by `cloudFade()`, overdraw capped by `spriteFade()`): its clouds, and under them rain
//   shafts, sprites drawn out straight down (so from above they're only faint smudges).
// - The drops are one instanced billboard mesh round what the camera follows (`createRain()`),
//   each a loop in the vertex shader on the real clock (as Sizzle's embers are): no CPU work per
//   drop. Each falls onto a spot, then the same instance lies flat there as its splash (a crown
//   of spray and a damp spot) or, on a lake, its ring. Where it lands comes from the drawn
//   ground's height, baked once at load from the terrain mesh into a small cube map
//   (`groundFaces()`), so splashes lie on the ground, never floating or sunk. Hidden (no draw
//   call) outside a shower.
import * as THREE from 'three';
import { mulberry32 } from '../physics/noise.js';
import { createCloudLayer, cubeDir } from './clouds.js';
import { stormShapes, stormEdge, stormAt } from './storms.js';

/**
 * Each world's rain showers (only Misty). Shaped as STORM_LOOK's entries (the showers are in
 * `storms`, so storms.js's shapes and `stormAt()` serve both): `drift` (rad/s about z, real
 * time), each shower's middle at time 0 (`lon`, `z` a share of the radius), half-length and
 * half-width (m), `tilt` and `lumps`. `cell`: metres between its clouds; `alt`: their bases (m
 * above the radius; under the space line). Colours as the clouds'. `shafts`: the rain shafts
 * under the clouds (how many per cloud, their half-width in m, how dense). `seen`: the camera's
 * heights (m) over which the clouds, and the shafts, fade out as it climbs. `rain`: the drops
 * round what the camera follows: how many, the box they're in (m), how high they start and how
 * far below the ground there they may still land (m), how fast they fall (m/s), their sizes (m:
 * a drop's half-width and its length over that), a ring's radius on a lake and how long it
 * spreads (s), a splash's radius on the ground and how long it lasts (its damp spot drying), the
 * slant (m/s along the drift), and their colours (`damp`: the wet spot's).
 */
export const RAIN_LOOK = {
  misty: {
    seed: 46,
    drift: 0.003,
    storms: [
      { lon: 2.0, z: -0.04, size: [62, 48], tilt: 0.25, lumps: [0.14, 0.1] }, // across the flight plane
      { lon: -0.9, z: -0.1, size: [54, 40], tilt: -0.2, lumps: [0.12, 0.12] }, // across it too
      { lon: 0.5, z: 0.55, size: [58, 38], tilt: 0.35, lumps: [0.15, 0.1] }, // on the face, north
      { lon: 3.9, z: 0.42, size: [46, 32], tilt: -0.3, lumps: [0.13, 0.1] },
      { lon: 1.3, z: -0.5, size: [50, 34], tilt: 0.1, lumps: [0.12, 0.12] }, // on the face, south
    ],
    cell: 17,
    alt: 22,
    lit: 0xf0cf9e,
    shade: 0x9e7c62,
    night: 0x3c3038,
    opacity: 0.75,
    ragged: 1,
    limbRound: 0.25,
    shadow: 0,
    shafts: { count: 2, size: [2.2, 3.4], dens: 0.2 },
    seen: { clouds: [120, 190], shafts: [60, 110] },
    rain: {
      drops: 640,
      box: 36,
      top: 14,
      below: 10,
      speed: [2.6, 3.4],
      drop: [0.04, 0.06],
      length: [3.5, 5],
      ring: [0.5, 0.9],
      ringLife: 1.4,
      splash: [0.2, 0.34],
      splashLife: 2.6,
      slant: 0.5,
      lit: 0xfff1d6,
      shade: 0xb89a80,
      damp: 0x4a2a14,
    },
  },
};

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How deep in a shower unit direction (x, y, z) is (0 dry .. 1 raining), `time` s on (pure). */
export const showerAt = (look, R, x, y, z, time) => stormAt(look, R, x, y, z, time);

/**
 * Where every cloud and shaft of the showers goes (pure, seeded), as cloudPlan() returns it:
 * `clouds` (one per cell: centre, reach `r`, `base`, `storm` its shower's index, `edge`) and
 * `puffs` (PUFF_STRIDE numbers per sprite, far-to-near for the +z cameras). Cells lie on a
 * jittered grid inside each shower's lumpy edge: a low, flat, soft cloud, and under the ones well
 * inside it, shafts of rain: a few faint sprites drawn out straight down to the ground.
 */
export function showerPlan(look, R) {
  const rand = mulberry32(look.seed);
  const between = ([a, b]) => a + rand() * (b - a);
  const clouds = [];
  const puffs = [];
  stormShapes(look).forEach((sh, si) => {
    const step = look.cell;
    const nu = Math.ceil((sh.A * 1.2) / step), nv = Math.ceil((sh.B * 1.2) / step);
    for (let i = -nu; i <= nu; i++) {
      for (let j = -nv; j <= nv; j++) {
        const u = (i + (j & 1) * 0.5 + (rand() - 0.5) * 0.6) * step;
        const v = (j + (rand() - 0.5) * 0.6) * step * 0.87;
        const a = u / sh.A, b = v / sh.B;
        const q = Math.hypot(a, b) / stormEdge(sh, Math.atan2(b, a));
        if (q > 0.95) continue;
        const d = Math.hypot(u, v) / R;
        const t = d > 1e-6 ? sh.e.map((c, m) => (c * u + sh.n[m] * v) / (d * R)) : sh.e;
        const up = sh.c.map((c, m) => c * Math.cos(d) + t[m] * Math.sin(d));
        const base = R + look.alt;
        let e = [-up[1], up[0], 0];
        const el = Math.hypot(e[0], e[1]) || 1;
        e = e.map((c) => c / el);
        const nx = [up[1] * e[2] - up[2] * e[1], up[2] * e[0] - up[0] * e[2], up[0] * e[1] - up[1] * e[0]];
        const centre = up.map((c) => c * base);
        const ci = clouds.length;
        // Thinner towards the edge, all round.
        const edgeK = 1 - 0.6 * smooth(0.45, 0.95, q);
        const H = 5 + rand() * 3;
        const heart = up.map((c) => c * H * 0.35);
        let reach = 0;
        let mid = centre, core = heart, idx = ci;
        const put = (du, dv, lift, size, dens, stretch, dir, h) => {
          const off = [0, 1, 2].map((m) => e[m] * du + nx[m] * dv + up[m] * lift);
          const p = off.map((c, m) => mid[m] + c);
          const nv2 = off.map((c, m) => c - core[m]);
          const nl = Math.hypot(...nv2) || 1;
          reach = Math.max(reach, Math.hypot(...off) + size * stretch);
          puffs.push([p[0], p[1], p[2], size, lift, idx, rand(), nv2[0] / nl, nv2[1] / nl, nv2[2] / nl, dens, h, dir[0], dir[1], dir[2], stretch]);
        };
        // The cloud: a few soft, flat sprites, a little drawn out along the drift.
        const count = 3 + Math.floor(rand() * 2);
        for (let k = 0; k < count; k++) {
          const size = step * (0.5 + rand() * 0.2);
          const lift = size * 0.3 + rand() * H * 0.5;
          put((rand() - 0.5) * step, (rand() - 0.5) * step * 0.9, lift, size, (0.5 + rand() * 0.25) * edgeK, 1.4, e, Math.min(1, lift / H));
        }
        clouds.push({ x: centre[0], y: centre[1], z: centre[2], r: reach, base, storm: si, edge: q, front: false, wisp: false });
        // The rain shafts under it (well inside the shower): faint, drawn out straight down from
        // the cloud's base to the ground. A cloud of their own, based on the ground (so they fade
        // on their own, and the layer's shader doesn't thin them out as below a cloud's base).
        if (q < 0.75) {
          const sf = look.shafts;
          const half = look.alt / 2;
          mid = up.map((c) => c * R);
          core = up.map((c) => c * half);
          idx = clouds.length;
          reach = 0;
          for (let k = 0; k < sf.count; k++) {
            const size = between(sf.size);
            put((rand() - 0.5) * step * 0.8, (rand() - 0.5) * step * 0.7, half, size, sf.dens * edgeK * (0.7 + rand() * 0.5), half / size, up, 0.15);
          }
          clouds.push({ x: mid[0], y: mid[1], z: mid[2], r: reach, base: R, storm: si, edge: q, front: false, wisp: false, shaft: true });
        }
      }
    }
  });
  puffs.sort((a, b) => a[2] - b[2]);
  return { clouds, puffs: Float32Array.from(puffs.flat()) };
}

// The drops (see createRain()). Per drop: where it lands in the box (x, y, z: 0..1) and a seed
// (0..1; also which drops are left in a light shower); its half-width (m), its length over that,
// how fast it falls (m/s) and the size of its splash (m).
export const RAIN_STRIDE = 8;

/** The rain's drops (pure, seeded): RAIN_STRIDE numbers each. */
export function rainPlan(look) {
  const r = look.rain;
  const rand = mulberry32(look.seed + 7);
  const between = ([a, b]) => a + rand() * (b - a);
  const out = [];
  for (let i = 0; i < r.drops; i++) out.push(rand(), rand(), rand(), rand(), between(r.drop), between(r.length), between(r.speed), between(r.splash));
  return Float32Array.from(out);
}

/**
 * How long one time round a drop's loop takes (s): falling from `top` metres above the ground
 * under what the camera follows down to at most `below` metres under it, then its splash (or ring).
 */
export const dropLife = (look, speed) => (look.rain.top + look.rain.below) / speed + Math.max(look.rain.splashLife, look.rain.ringLife);

/**
 * A drop's loop, as the vertex shader works it out (pure, for the tests). `seed` and `speed` are
 * the drop's; `time` (s, real); `groundR` the ground's radius under what the camera follows, and
 * `landR` the radius where this drop lands (the ground there, from the baked ground: or the
 * lakes' level, `floorR`, over a lake). Into `out`: `cycle` (which time round: each time round it
 * lands somewhere else), `age` (0..1 of its loop), `lake` (it lands on a lake: a ring), `phase`
 * ('fall', 'land' or 'gone': landed long ago, waiting for its next time round), `r` (its radius
 * while falling, or where its splash lies) and `sAge` (0..1 of the splash).
 */
export function dropLoop(look, seed, speed, time, groundR, ground, floorR, out = {}) {
  const r = look.rain;
  const life = dropLife(look, speed);
  const u = time / life + seed * 17;
  out.cycle = Math.floor(u);
  out.age = u - out.cycle;
  const t = out.age * life;
  out.lake = ground < floorR;
  const landR = Math.max(ground, floorR);
  const top = groundR + r.top;
  const tLand = Math.max(0, top - landR) / speed;
  // (Something deeper than `below` isn't reached: that drop just ends there.)
  const tEnd = r.top + r.below;
  if (t < tLand && speed * t < tEnd) {
    out.phase = 'fall';
    out.r = top - speed * t;
    out.sAge = 0;
    return out;
  }
  const sAge = (t - tLand) / (out.lake ? r.ringLife : r.splashLife);
  out.phase = speed * tLand <= tEnd && sAge < 1 ? 'land' : 'gone';
  out.r = landR;
  out.sAge = Math.max(0, Math.min(1, sAge));
  return out;
}

/**
 * The rain's sound (audio.js `setRain()`): full `low` metres up or lower, gone by `top` (it's
 * quieter than the view: the drops round you are what you hear), and softer from the rocket's
 * view than from the buggy's (`rocket`).
 */
export const RAIN_SOUND = { low: 15, top: 60, rocket: 0.6 };

/**
 * How loud the rain is (0..1, pure): `depth` how deep in a shower the camera is (showerAt(),
 * 0..1), `height` the camera's metres above the world's radius, `driving` whether we're in the
 * buggy. Nothing in space, in the map or on a world without rain: the flight scene passes 0.
 */
export function rainVolume(depth, height, driving) {
  const h = 1 - smooth(RAIN_SOUND.low, RAIN_SOUND.top, height);
  return Math.max(0, Math.min(1, depth)) * h * (driving ? 1 : RAIN_SOUND.rocket);
}

/** How many of the drops a shower `strength` (0..1) leaves: drop with `seed` is shown this much (0..1). */
export const dropShown = (seed, strength) => Math.max(0, Math.min(1, (strength - seed * 0.85) * 8));

// The ground's height all round (for the splashes: they must lie on the drawn ground, not float
// or sink). The terrain mesh, seen from the world's middle, into a small cube map of how far out
// it is (m from the radius): each texel's ray from the middle through the triangle it meets, so
// it is the drawn mesh's own surface (flat triangles and all), not the smooth terrain function it
// was built from. Baked once at load (pure: a small rasteriser, about 400k texels).
export const GROUND_N = 256;

// (Face and texel coordinates of a direction, the inverse of clouds.js's cubeDir().)
function faceOf(x, y, z, out) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (ax >= ay && ax >= az) { out.f = x > 0 ? 0 : 1; out.s = x > 0 ? -z / ax : z / ax; out.t = -y / ax; }
  else if (ay >= az) { out.f = y > 0 ? 2 : 3; out.s = x / ay; out.t = y > 0 ? z / ay : -z / ay; }
  else { out.f = z > 0 ? 4 : 5; out.s = z > 0 ? x / az : -x / az; out.t = -y / az; }
  return out;
}
// Texel coordinates of a direction on face f (cubeDir()'s inverse), if it's on that face's side.
function onFace(f, x, y, z, n, out, i) {
  const a = f === 0 ? x : f === 1 ? -x : f === 2 ? y : f === 3 ? -y : f === 4 ? z : -z;
  if (a <= 1e-6) return false;
  let s, t;
  if (f === 0) { s = -z; t = -y; } else if (f === 1) { s = z; t = -y; } else if (f === 2) { s = x; t = z; } else if (f === 3) { s = x; t = -z; } else if (f === 4) { s = x; t = -y; } else { s = -x; t = -y; }
  out[i * 2] = ((s / a + 1) / 2) * n - 0.5;
  out[i * 2 + 1] = ((t / a + 1) / 2) * n - 0.5;
  return true;
}

/**
 * The drawn ground's height (m above `R`) along each texel of an `n` × `n` cube map (WebGL's
 * face order, cubeDir()'s texel directions), from the mesh's positions and index (pure).
 */
export function groundFaces(pos, index, R, n = GROUND_N) {
  const faces = Array.from({ length: 6 }, () => new Float32Array(n * n).fill(NaN));
  const tri = index ? index.length / 3 : pos.length / 9;
  const tc = new Float64Array(6);
  // Each texel's direction (not normalised: cubeDir()'s before its divide) is (1, -t, -s) etc.
  const dirOf = (f, x, y, d) => {
    const sc = ((x + 0.5) / n) * 2 - 1, t = ((y + 0.5) / n) * 2 - 1;
    if (f === 0) { d[0] = 1; d[1] = -t; d[2] = -sc; } else if (f === 1) { d[0] = -1; d[1] = -t; d[2] = sc; } else if (f === 2) { d[0] = sc; d[1] = 1; d[2] = t; } else if (f === 3) { d[0] = sc; d[1] = -1; d[2] = -t; } else if (f === 4) { d[0] = sc; d[1] = -t; d[2] = 1; } else { d[0] = -sc; d[1] = -t; d[2] = -1; }
  };
  const d = [0, 0, 0];
  for (let k = 0; k < tri; k++) {
    const a = (index ? index[k * 3] : k * 3) * 3, b = (index ? index[k * 3 + 1] : k * 3 + 1) * 3, c = (index ? index[k * 3 + 2] : k * 3 + 2) * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const e1x = pos[b] - ax, e1y = pos[b + 1] - ay, e1z = pos[b + 2] - az;
    const e2x = pos[c] - ax, e2y = pos[c + 1] - ay, e2z = pos[c + 2] - az;
    for (let f = 0; f < 6; f++) {
      if (!onFace(f, ax, ay, az, n, tc, 0) || !onFace(f, pos[b], pos[b + 1], pos[b + 2], n, tc, 1) || !onFace(f, pos[c], pos[c + 1], pos[c + 2], n, tc, 2)) continue;
      const x0 = Math.max(0, Math.ceil(Math.min(tc[0], tc[2], tc[4]) - 1e-6)), x1 = Math.min(n - 1, Math.floor(Math.max(tc[0], tc[2], tc[4]) + 1e-6));
      const y0 = Math.max(0, Math.ceil(Math.min(tc[1], tc[3], tc[5]) - 1e-6)), y1 = Math.min(n - 1, Math.floor(Math.max(tc[1], tc[3], tc[5]) + 1e-6));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          dirOf(f, x, y, d);
          // Möller–Trumbore: the ray from the middle along d through this triangle.
          const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-12) continue;
          const inv = 1 / det;
          const u = (-ax * px - ay * py - az * pz) * inv;
          if (u < -1e-5 || u > 1 + 1e-5) continue;
          const qx = -ay * e1z + az * e1y, qy = -az * e1x + ax * e1z, qz = -ax * e1y + ay * e1x;
          const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
          if (v < -1e-5 || u + v > 1 + 1e-5) continue;
          const r = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (r > 0) faces[f][y * n + x] = r * Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) - R;
        }
      }
    }
  }
  // (Any texel missed on a seam takes its neighbour's.)
  for (const face of faces) {
    for (let i = 0; i < face.length; i++) {
      if (!Number.isNaN(face[i])) continue;
      for (const j of [i - 1, i + 1, i - n, i + n]) if (j >= 0 && j < face.length && !Number.isNaN(face[j])) { face[i] = face[j]; break; }
    }
  }
  return faces;
}

/** The baked ground's height (m above the radius) at unit direction (x, y, z), as the GPU samples it (bilinear). */
const spotF = { f: 0, s: 0, t: 0 };
export function groundSample(faces, n, x, y, z) {
  faceOf(x, y, z, spotF);
  const face = faces[spotF.f];
  const fx = Math.max(0, Math.min(n - 1, ((spotF.s + 1) / 2) * n - 0.5)), fy = Math.max(0, Math.min(n - 1, ((spotF.t + 1) / 2) * n - 0.5));
  const x0 = Math.min(n - 2, Math.floor(fx)), y0 = Math.min(n - 2, Math.floor(fy));
  const u = fx - x0, v = fy - y0;
  const at = (i, j) => face[j * n + i];
  return (at(x0, y0) * (1 - u) + at(x0 + 1, y0) * u) * (1 - v) + (at(x0, y0 + 1) * (1 - u) + at(x0 + 1, y0 + 1) * u) * v;
}

function groundMap(faces, n) {
  const tex = new THREE.CubeTexture(faces.map((f) => {
    const half = new Uint16Array(f.length);
    for (let i = 0; i < f.length; i++) half[i] = THREE.DataUtils.toHalfFloat(f[i]);
    const t = new THREE.DataTexture(half, n, n, THREE.RedFormat, THREE.HalfFloatType);
    t.needsUpdate = true;
    return t;
  }), undefined, undefined, undefined, THREE.LinearFilter, THREE.LinearFilter, THREE.RedFormat, THREE.HalfFloatType);
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// (The same small hash as the embers', no sin(): the same on phones.)
const VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  attribute vec4 spot; // x, y, z in the box (0..1), seed
  attribute vec4 shape; // half-width, length, speed, splash size
  uniform float time;
  uniform float box;
  uniform float groundR;
  uniform float radius;
  uniform float floorR;
  uniform float top;
  uniform float below;
  uniform float splashLife;
  uniform float ringLife;
  uniform vec2 ringSize;
  uniform float strength;
  uniform float slant;
  uniform float px;
  uniform samplerCube groundMap;
  uniform vec3 focus;
  uniform vec3 up;
  uniform vec3 wind;
  uniform vec3 sunDir;
  uniform vec3 foci[3];
  uniform int nFoci;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vKind;
  varying float vDay;
  varying float vAge;
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
      k = min(k, 0.1 + 0.9 * smoothstep(r * 0.5, r + 1.5, off));
    }
    return k;
  }
  // The drawn ground's radius at a direction (the baked cube map: m above the radius).
  float groundAt(vec3 d) { return radius + texture(groundMap, d).r; }
  void main() {
    float scale = length(modelMatrix[0].xyz);
    float speed = shape.z;
    // Its loop (see dropLoop()): each time round it lands somewhere else in the box.
    float life = (top + below) / speed + max(splashLife, ringLife);
    float u = time / life + spot.w * 17.0;
    float cycle = floor(u);
    float age = u - cycle;
    float n = cycle + spot.w * 1000.0;
    vec3 jit = vec3(hash11(n * 1.37 + 0.11), hash11(n * 2.71 + 0.53), hash11(n * 0.83 + 0.97));
    // Where it lands: anchored to the ground, wrapped into the box round what the camera
    // follows, laid along the ground there; and the drawn ground's height there (or a lake's).
    vec3 rel = mod(fract(spot.xyz + jit) * box - focus, box) - 0.5 * box;
    rel -= up * dot(rel, up);
    vec3 land = normalize(focus + rel);
    float g = groundAt(land);
    bool lake = g < floorR;
    float landR = max(g, floorR);
    float rTop = groundR + top;
    float t = age * life;
    float tLand = max(0.0, rTop - landR) / speed;
    bool reached = speed * tLand <= top + below;
    float s = shape.x * scale;
    vec3 p;
    vec3 upP = land;
    float kind;
    float sAge = 0.0;
    float alpha = 1.0;
    if (t < tLand && speed * t < top + below) {
      // Falling straight down (a little slanted along the drift) onto that spot.
      kind = 0.0;
      upP = normalize(focus + rel + wind * (slant * (t - tLand)));
      p = upP * (rTop - speed * t);
      alpha = smoothstep(0.0, 0.06, age);
    } else {
      // Landed: a ring spreading on a lake, or a splash and a damp spot on the ground.
      kind = lake ? 1.0 : 2.0;
      sAge = (t - tLand) / (lake ? ringLife : splashLife);
      if (!reached || sAge > 1.0) alpha = 0.0;
      p = land * (landR + 0.02);
      s = (lake ? mix(ringSize.x, ringSize.y, hash11(n * 5.3 + 0.7)) : shape.w) * scale;
    }
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    float depth = -mvPosition.z;
    float pr = projectionMatrix[1][1] / max(depth, 1e-3);
    // In a light shower only some of them; softly gone towards the box's sides (never a wall of
    // rain ending) and near the lens.
    alpha *= clamp((strength - spot.w * 0.85) * 8.0, 0.0, 1.0);
    alpha *= 1.0 - smoothstep(0.3 * box, 0.5 * box, length(rel));
    alpha *= smoothstep(0.8, 2.5, depth);
    alpha *= sight((modelMatrix * vec4(p, 1.0)).xyz, kind > 0.5 ? s : s * shape.y + 0.3);
    vec3 upV = normalize((modelViewMatrix * vec4(upP, 0.0)).xyz);
    vDay = smoothstep(-0.3, 0.3, dot(upV, sunDir));
    vUv = position.xy * 2.0;
    vKind = kind;
    vAge = sAge;
    vec2 c = position.xy * 2.0;
    if (kind > 0.5) {
      // Flat on the ground (tilted with its slope, from the baked ground either side) or the lake.
      vec3 t1 = normalize(cross(upP, abs(upP.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
      vec3 t2 = cross(upP, t1);
      if (!lake) {
        float e = 0.4;
        float g1 = groundAt(normalize(p + t1 * e)) - g, g2 = groundAt(normalize(p + t2 * e)) - g;
        t1 = normalize(t1 + upP * (g1 / e));
        t2 = normalize(t2 + upP * (g2 / e));
      }
      mvPosition = modelViewMatrix * vec4(p + (t1 * c.x + t2 * c.y) * s, 1.0);
      // (A hair towards the camera: never lost in the ground between the baked texels.)
      mvPosition.xyz += normalize(-mvPosition.xyz) * 0.06;
    } else {
      // Never thinner than about a pixel (fainter instead: no shimmering threads far away).
      float sMin = px / pr;
      if (s < sMin) { alpha *= s / sMin; s = sMin; }
      // Drawn out along the way it falls, as far as that shows from here.
      vec3 dv = upV;
      float dl = length(dv.xy);
      if (dl > 0.001) {
        vec2 d2 = dv.xy / dl;
        c += d2 * dot(c, d2) * (shape.y - 1.0) * dl;
      }
      mvPosition.xy += c * s;
      // (Never big on screen: a drop right by the lens is only a blur.)
      alpha *= 1.0 - smoothstep(0.03, 0.06, s * pr);
    }
    vAlpha = alpha;
    gl_Position = projectionMatrix * mvPosition;
    if (alpha < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }`;

const FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 litColor;
  uniform vec3 shadeColor;
  uniform vec3 dampColor;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vKind;
  varying float vDay;
  varying float vAge;
  void main() {
    #include <logdepthbuf_fragment>
    float r2 = dot(vUv, vUv);
    if (r2 > 1.0) discard;
    vec3 lit = mix(shadeColor, litColor, vDay) * mix(0.3, 1.0, vDay);
    vec3 c = lit;
    float a;
    if (vKind > 1.5) {
      // A splash on the ground: a quick little crown of spray spreading out, and a soft damp spot
      // that darkens the ground and slowly dries.
      float r = sqrt(r2);
      float cr = 0.2 + 0.7 * smoothstep(0.0, 0.25, vAge);
      float crown = exp(-pow((r - cr) / 0.14, 2.0)) * (1.0 - smoothstep(0.08, 0.3, vAge)) * 0.6;
      float damp = (1.0 - r2) * (1.0 - r2) * smoothstep(0.0, 0.08, vAge) * (1.0 - smoothstep(0.35, 1.0, vAge)) * 0.4;
      a = crown + damp * (1.0 - crown);
      c = (lit * crown + dampColor * damp * (1.0 - crown)) / max(a, 1e-3);
      a *= vAlpha;
    } else if (vKind > 0.5) {
      // Two soft rings spreading out on a lake, the second a little behind.
      float r = sqrt(r2);
      float r1 = 0.15 + 0.85 * vAge;
      float w = 0.09 + 0.1 * vAge;
      a = exp(-pow((r - r1) / w, 2.0)) + 0.5 * exp(-pow((r - r1 + 0.35) / w, 2.0)) * step(0.35, r1);
      a *= 0.45 * vAlpha;
    } else {
      // A fat, soft drop.
      float f = (1.0 - r2) * (1.0 - r2);
      a = 0.6 * f * vAlpha;
    }
    a *= mix(0.4, 1.0, vDay);
    if (a < 0.003) discard;
    gl_FragColor = vec4(c, a);
    #include <fog_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb *= gl_FragColor.a; // premultiplied
  }`;

const quad = new THREE.PlaneGeometry(1, 1);

/**
 * The drops, their splashes on the ground and their rings on the lakes near the ground in a
 * shower: one instanced billboard mesh (one draw call), in the world's group. `floorR`: the lakes'
 * level (m from the middle); `ground`: { faces, n } the baked ground (groundFaces()), or null for
 * a flat ground at the world's radius. Returns { mesh, count, plan, set(...) (as the storms'
 * blowing dust: see createStreams()), fade(foci, n) }.
 */
export function createRain(look, radius, floorR, sunDir, ground = null) {
  const r = look.rain;
  const plan = rainPlan(look);
  const count = plan.length / RAIN_STRIDE;
  const spot = new Float32Array(count * 4), shape = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    spot.set(plan.subarray(i * RAIN_STRIDE, i * RAIN_STRIDE + 4), i * 4);
    shape.set(plan.subarray(i * RAIN_STRIDE + 4, i * RAIN_STRIDE + 8), i * 4);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('spot', new THREE.InstancedBufferAttribute(spot, 4));
  geo.setAttribute('shape', new THREE.InstancedBufferAttribute(shape, 4));
  geo.instanceCount = count;
  const bound = new THREE.Sphere(new THREE.Vector3(), r.box + r.top);
  geo.boundingSphere = bound;
  const foci = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const faces = ground?.faces ?? Array.from({ length: 6 }, () => new Float32Array(4));
  const uniforms = {
    time: { value: 0 },
    box: { value: r.box },
    groundR: { value: 0 },
    radius: { value: radius },
    floorR: { value: floorR + 0.04 },
    top: { value: r.top },
    below: { value: r.below },
    splashLife: { value: r.splashLife },
    ringLife: { value: r.ringLife },
    ringSize: { value: new THREE.Vector2(...r.ring) },
    strength: { value: 0 },
    slant: { value: r.slant },
    px: { value: 0.005 },
    groundMap: { value: groundMap(faces, ground?.n ?? 2) },
    focus: { value: new THREE.Vector3() },
    up: { value: new THREE.Vector3(0, 0, 1) },
    wind: { value: new THREE.Vector3(1, 0, 0) },
    sunDir: { value: sunDir },
    foci: { value: foci },
    nFoci: { value: 0 },
    litColor: { value: new THREE.Color(r.lit) },
    shadeColor: { value: new THREE.Color(r.shade) },
    dampColor: { value: new THREE.Color(r.damp) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'rain';
  mesh.raycast = () => {};
  mesh.renderOrder = 2; // after the lakes (renderOrder 1), so the rings show on them
  mesh.visible = false;
  const u = mesh.material.uniforms;
  // About a pixel, in the shader's units (2 / the drawing buffer's height).
  const size = new THREE.Vector2();
  mesh.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(size);
    u.px.value = 2 / Math.max(1, size.y);
  };
  return {
    mesh,
    count,
    plan,
    /**
     * This frame's rain: `strength` (0..1: none hides it), where (the planet's frame: the unit
     * direction `dx, dy, dz` of what the camera follows, the ground's radius `groundR` there),
     * `time` (s, real). (`dt` unused: the drops aren't carried.)
     */
    set(strength, dx, dy, dz, groundR, time) {
      mesh.visible = strength > 0.005;
      u.strength.value = strength;
      if (!mesh.visible) return;
      u.time.value = time % 1000; // (the loops don't care; keeps the shader's floats small)
      u.groundR.value = groundR;
      u.up.value.set(dx, dy, dz);
      u.focus.value.set(dx * groundR, dy * groundR, dz * groundR);
      bound.center.copy(u.focus.value);
      // The slant: the way the showers drift (east); near the poles, any way along the ground.
      let wx = -dy, wy = dx, wz = 0;
      let wl = Math.hypot(wx, wy);
      if (wl < 0.05) { wx = 1 - dx * dx; wy = -dx * dy; wz = -dx * dz; wl = Math.hypot(wx, wy, wz) || 1; }
      u.wind.value.set(wx / wl, wy / wl, wz / wl);
    },
    fade(pts, n) {
      const m = Math.min(n, foci.length);
      for (let i = 0; i < m; i++) foci[i].set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
      u.nFoci.value = m;
    },
  };
}

/**
 * A world's rain showers, or null if it has none. The same shape as createStorms() returns (so
 * the flight scene handles both alike): { look, layer (the showers' clouds and shafts: a cloud
 * layer), streams (the drops and rings: createRain()), colours, at() (showerAt()), near() (no
 * bank on the horizon for rain: the haze hides the distance anyway) }.
 */
export function createShowers(body, sunDir, groundGeo = null) {
  const look = RAIN_LOOK[body.id];
  if (!look) return null;
  const layer = createCloudLayer(look, showerPlan(look, body.radius), body.radius, sunDir, 'showers');
  // The drawn ground, baked for the splashes (without the mesh, as in the tests: flat).
  const pos = groundGeo?.attributes.position.array;
  const ground = pos ? { faces: groundFaces(pos, groundGeo.index?.array, body.radius), n: GROUND_N } : null;
  const streams = createRain(look, body.radius, body.liquidR || body.radius - 5, sunDir, ground);
  // A shower is weather seen from low down: its clouds fade out as the camera climbs away (the
  // globe from space keeps its haze bands clean, and there's no draw call), its shafts sooner.
  const fade = layer.fade;
  const shafts = layer.clouds.map((c) => !!c.shaft);
  layer.fade = (cam, foci, n, group, near) => {
    fade(cam, foci, n, group, near);
    const g = group.position, sc = group.scale.x || 1;
    const alt = Math.hypot(cam.x - g.x, cam.y - g.y, cam.z - g.z) / sc - body.radius;
    const kc = 1 - smooth(look.seen.clouds[0], look.seen.clouds[1], alt), ks = 1 - smooth(look.seen.shafts[0], look.seen.shafts[1], alt);
    const f = layer.fades;
    for (let i = 0; i < f.length; i++) f[i] *= shafts[i] ? ks : kc;
    // (Up in space, no draw call at all.)
    layer.mesh.visible = kc > 0;
  };
  return {
    look,
    layer,
    streams,
    colours: { lit: new THREE.Color(look.lit), shade: new THREE.Color(look.shade) },
    at: (x, y, z, time) => showerAt(look, body.radius, x, y, z, time),
    near: (x, y, z, time, out) => { out.k = 0; return out; },
  };
}
