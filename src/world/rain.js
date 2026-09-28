// Methane rain (#54, stage 4: Misty). Like Titan's: now and then a shower drifts across the moon,
// a patch of pale rain clouds with faint grey shafts of rain hanging under them; down in one the
// orange sky dims and closes in a little, and big, slow drops drift down round what the camera
// follows, making soft rings where they land on the methane lakes. Gentle, not a downpour.
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
// - The drops and the rings on the lakes are one instanced billboard mesh round what the camera
//   follows (`createRain()`), each a loop in the vertex shader on the real clock (as Sizzle's
//   embers are): no CPU work per drop. The rings lie flat at the lakes' level, which is below
//   all of Misty's dry ground (terrain.js), so the ground hides every ring that isn't on a lake;
//   nothing needs to know where the lakes are. Hidden (no draw call) outside a shower.
import * as THREE from 'three';
import { mulberry32 } from '../physics/noise.js';
import { createCloudLayer } from './clouds.js';
import { stormShapes, stormEdge, stormAt } from './storms.js';

/**
 * Each world's rain showers (only Misty). Shaped as STORM_LOOK's entries (the showers are in
 * `storms`, so storms.js's shapes and `stormAt()` serve both): `drift` (rad/s about z, real
 * time), each shower's middle at time 0 (`lon`, `z` a share of the radius), half-length and
 * half-width (m), `tilt` and `lumps`. `cell`: metres between its clouds; `alt`: their bases (m
 * above the radius; under the space line). Colours as the clouds'. `shafts`: the rain shafts
 * under the clouds (how many per cloud, their half-width in m, how dense). `rain`: the drops
 * round what the camera follows: how many drops and rings, the box they're in (m), how high they
 * start (m above the ground there), how long a drop takes to fall (s) and a ring to spread,
 * their sizes (m: a drop's half-width and its length over that, a ring's radius), the slant
 * (m/s along the drift), and their colours.
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
    rain: {
      drops: 560,
      rings: 110,
      box: 36,
      top: 14,
      fall: [5.5, 7.5],
      ringLife: [1.1, 1.7],
      drop: [0.04, 0.06],
      length: [3.5, 5],
      ring: [0.5, 0.9],
      slant: 0.5,
      lit: 0xfff1d6,
      shade: 0xb89a80,
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

// The drops and rings (see createRain()). Per particle: where it is in the box (x, y, z: 0..1)
// and a seed (0..1; also which drops are left in a light shower); kind (0 a drop, 1 a ring),
// size (m: a drop's half-width, a ring's radius), a drop's length over its width, life (s).
export const RAIN_STRIDE = 8;
export const DROP = 0, RING = 1;

/** The rain's drops and rings (pure, seeded): RAIN_STRIDE numbers each. */
export function rainPlan(look) {
  const r = look.rain;
  const rand = mulberry32(look.seed + 7);
  const between = ([a, b]) => a + rand() * (b - a);
  const out = [];
  for (let i = 0; i < r.drops + r.rings; i++) {
    const ring = i >= r.drops;
    out.push(rand(), rand(), rand(), rand(), ring ? RING : DROP, ring ? between(r.ring) : between(r.drop),
      ring ? 1 : between(r.length), ring ? between(r.ringLife) : between(r.fall));
  }
  return Float32Array.from(out);
}

/**
 * A drop's (or ring's) loop, as the vertex shader works it out (pure, for the tests): at `time`
 * (s, real), with its `seed` and `life`, how far through its life it is (`age`, 0..1) and which
 * time round (`cycle`: each time round it starts somewhere else). A drop falls from `top` metres
 * above the ground straight down at a steady speed through its life.
 */
export function dropAt(seed, life, time, out = {}) {
  const u = time / life + seed * 17;
  out.cycle = Math.floor(u);
  out.age = u - out.cycle;
  return out;
}

/** How high a drop is at `age` (m above the ground under the camera's focus): `top` down to `floor` (< 0). */
export const dropHeight = (top, floor, age) => top + (floor - top) * age;

/** How many of the drops a shower `strength` (0..1) leaves: drop with `seed` is shown this much (0..1). */
export const dropShown = (seed, strength) => Math.max(0, Math.min(1, (strength - seed * 0.85) * 8));

// (The same small hash as the embers', no sin(): the same on phones.)
const VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  attribute vec4 spot; // x, y, z in the box (0..1), seed
  attribute vec4 shape; // kind, size, length, life
  uniform float time;
  uniform float box;
  uniform float groundR;
  uniform float floorR;
  uniform float top;
  uniform float strength;
  uniform float slant;
  uniform float px;
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
  void main() {
    float scale = length(modelMatrix[0].xyz);
    // Its loop (see dropAt()): each time round somewhere else in the box.
    float u = time / shape.w + spot.w * 17.0;
    float cycle = floor(u);
    float age = u - cycle;
    float n = cycle + spot.w * 1000.0;
    vec3 jit = vec3(hash11(n * 1.37 + 0.11), hash11(n * 2.71 + 0.53), hash11(n * 0.83 + 0.97));
    // Anchored to the ground, wrapped into the box round what the camera follows, laid along
    // the ground there.
    vec3 rel = mod(fract(spot.xyz + jit) * box - focus, box) - 0.5 * box;
    rel -= up * dot(rel, up);
    bool ring = shape.x > 0.5;
    vec3 p;
    float s = shape.y * scale;
    vec3 upP;
    if (ring) {
      // Flat on the lakes' level (under the ground everywhere else, which hides it).
      upP = normalize(focus + rel);
      p = upP * floorR;
    } else {
      // Falling straight down (a little slanted along the drift) from above the ground here,
      // on down to the lakes' level: the ground hides it where it lands.
      float h = top + (floorR - groundR - top) * age;
      upP = normalize(focus + rel + wind * (slant * age * shape.w));
      p = upP * (groundR + h);
    }
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    float depth = -mvPosition.z;
    float pr = projectionMatrix[1][1] / max(depth, 1e-3);
    // In a light shower only some of them; softly gone towards the box's sides (never a wall of
    // rain ending) and near the lens.
    float alpha = clamp((strength - spot.w * 0.85) * 8.0, 0.0, 1.0);
    alpha *= 1.0 - smoothstep(0.3 * box, 0.5 * box, length(rel));
    alpha *= smoothstep(0.8, 2.5, depth);
    alpha *= ring ? 1.0 - smoothstep(0.6, 1.0, age) : smoothstep(0.0, 0.06, age);
    alpha *= sight((modelMatrix * vec4(p, 1.0)).xyz, ring ? s : s * shape.z + 0.3);
    vec3 upV = normalize((modelViewMatrix * vec4(upP, 0.0)).xyz);
    vDay = smoothstep(-0.3, 0.3, dot(upV, sunDir));
    vUv = position.xy * 2.0;
    vKind = shape.x;
    vAge = age;
    vec2 c = position.xy * 2.0;
    if (ring) {
      // A flat ring in the ground's plane.
      vec3 t1 = normalize(cross(upP, abs(upP.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
      vec3 t2 = cross(upP, t1);
      mvPosition = modelViewMatrix * vec4(p + (t1 * c.x + t2 * c.y) * s, 1.0);
    } else {
      // Never thinner than about a pixel (fainter instead: no shimmering threads far away).
      float sMin = px / pr;
      if (s < sMin) { alpha *= s / sMin; s = sMin; }
      // Drawn out along the way it falls, as far as that shows from here.
      vec3 dv = upV;
      float dl = length(dv.xy);
      if (dl > 0.001) {
        vec2 d2 = dv.xy / dl;
        c += d2 * dot(c, d2) * (shape.z - 1.0) * dl;
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
  varying vec2 vUv;
  varying float vAlpha;
  varying float vKind;
  varying float vDay;
  varying float vAge;
  void main() {
    #include <logdepthbuf_fragment>
    float r2 = dot(vUv, vUv);
    if (r2 > 1.0) discard;
    float a;
    if (vKind > 0.5) {
      // Two soft rings spreading out, the second a little behind.
      float r = sqrt(r2);
      float r1 = 0.15 + 0.85 * vAge;
      float w = 0.09 + 0.1 * vAge;
      a = exp(-pow((r - r1) / w, 2.0)) + 0.5 * exp(-pow((r - r1 + 0.35) / w, 2.0)) * step(0.35, r1);
      a *= 0.55 * vAlpha;
    } else {
      // A fat, soft drop.
      float f = (1.0 - r2) * (1.0 - r2);
      a = 0.6 * f * vAlpha;
    }
    a *= mix(0.4, 1.0, vDay);
    if (a < 0.003) discard;
    vec3 c = mix(shadeColor, litColor, vDay) * mix(0.3, 1.0, vDay);
    gl_FragColor = vec4(c, a);
    #include <fog_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb *= gl_FragColor.a; // premultiplied
  }`;

const quad = new THREE.PlaneGeometry(1, 1);

/**
 * The drops and rings near the ground in a shower: one instanced billboard mesh (one draw call),
 * in the world's group. `floorR`: the lakes' level (m from the middle). Returns { mesh, count,
 * plan, set(...) (as the storms' blowing dust: see createStreams()), fade(foci, n) }.
 */
export function createRain(look, floorR, sunDir) {
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
  const uniforms = {
    time: { value: 0 },
    box: { value: r.box },
    groundR: { value: 0 },
    floorR: { value: floorR + 0.04 },
    top: { value: r.top },
    strength: { value: 0 },
    slant: { value: r.slant },
    px: { value: 0.005 },
    focus: { value: new THREE.Vector3() },
    up: { value: new THREE.Vector3(0, 0, 1) },
    wind: { value: new THREE.Vector3(1, 0, 0) },
    sunDir: { value: sunDir },
    foci: { value: foci },
    nFoci: { value: 0 },
    litColor: { value: new THREE.Color(r.lit) },
    shadeColor: { value: new THREE.Color(r.shade) },
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
export function createShowers(body, sunDir) {
  const look = RAIN_LOOK[body.id];
  if (!look) return null;
  const layer = createCloudLayer(look, showerPlan(look, body.radius), body.radius, sunDir, 'showers');
  const streams = createRain(look, body.liquidR || body.radius - 5, sunDir);
  return {
    look,
    layer,
    streams,
    colours: { lit: new THREE.Color(look.lit), shade: new THREE.Color(look.shade) },
    at: (x, y, z, time) => showerAt(look, body.radius, x, y, z, time),
    near: (x, y, z, time, out) => { out.k = 0; return out; },
  };
}
