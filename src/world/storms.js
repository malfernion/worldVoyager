// Dust storms (#54, stage 3: Dusty). One or two regional storms, like Mars's: from space a broad,
// soft, dusty-orange patch with a billowing front edge, drifting slowly round the world; down in
// one the air thickens (the sky's dusty tint and a hazy distance: FlightScene.updateHaze() with
// `SKY_LOOK.dusty.storm`) and streams of dust blow across near the ground.
//
// Cheap for phones, and nothing new where it can be helped:
// - From space, a storm is drawn by the clouds' own layer (clouds.js, `createCloudLayer()`): its
//   cells are clouds of soft sprites in one draw call, faded near the camera and veiled over the
//   rocket and buggy by the same `cloudFade()`, the sprites' overdraw capped by the same
//   `spriteFade()`. The layer turns as one about z (the drift), on the real clock.
// - Where the storms are is pure (`stormAt()`: a few multiplies per storm), so the haze asks it
//   once a frame about the camera.
// - The blowing dust is one instanced billboard mesh round what the camera follows (`createStreams()`),
//   each streak a loop worked out in the vertex shader (as Sizzle's embers are): the CPU only
//   moves the wind's offset each frame. Hidden (no draw call) outside a storm.
import * as THREE from 'three';
import { mulberry32 } from '../physics/noise.js';
import { PUFF_STRIDE, createCloudLayer } from './clouds.js';

/**
 * Each world's dust storms (only Dusty). `drift`: how fast they go round (rad/s about z, real
 * time: eastwards, the way the clouds go). `storms`: each one's middle at time 0 (`lon`, and `z`
 * as a share of the radius), its half-length along the drift and half-width across it (m),
 * `tilt` (rad, off the drift) and how lumpy its edge is (`lumps`). `cell`: metres between its
 * cells (each a cloud of the layer); `alt`: their bases (m above the radius: most hills stay
 * under them; the volcano pokes through, like Olympus Mons above Mars's storms). Colours as the
 * clouds'. `streams`: the blowing dust near the ground: how many streaks and puffs, the box
 * round what the camera follows they're in (m), the wind (m/s) and its gusts, their sizes (m),
 * how high they fly (m), how long each lasts (s), and their colours.
 */
export const STORM_LOOK = {
  dusty: {
    seed: 26,
    drift: 0.002,
    storms: [
      { lon: 0.9, z: 0.78, size: [135, 90], tilt: 0.3, lumps: [0.16, 0.1] },
      { lon: -2.4, z: -0.08, size: [100, 72], tilt: -0.15, lumps: [0.14, 0.12] },
    ],
    cell: 24,
    alt: 11,
    lit: 0xfbe0a8,
    shade: 0xd8a468,
    night: 0x3e3448,
    opacity: 1,
    ragged: 1,
    shadow: 0,
    streams: {
      streaks: 380,
      puffs: 36,
      box: 56,
      wind: 9,
      gust: [0, 6],
      streak: [0.14, 0.28],
      stretch: [8, 14],
      puff: [1.6, 3],
      high: [0.6, 7],
      puffHigh: [0.8, 4],
      life: [1.6, 3.2],
      lit: 0xffe4c0,
      shade: 0xc49270,
    },
  },
};

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Each storm's frame at time 0, worked out once per look (pure): middle `c` (unit), `e` the way
// it's stretched (along the drift, tilted), `n` across, its half-sizes, the lumps' phases.
const shapes = new Map();
export function stormShapes(look) {
  let out = shapes.get(look);
  if (out) return out;
  const rand = mulberry32(look.seed * 3 + 1);
  out = look.storms.map((st) => {
    const k = Math.sqrt(1 - st.z * st.z);
    const c = [k * Math.cos(st.lon), k * Math.sin(st.lon), st.z];
    // East (the drift) and north there, turned by the tilt.
    const east = [-Math.sin(st.lon), Math.cos(st.lon), 0];
    const north = [c[1] * east[2] - c[2] * east[1], c[2] * east[0] - c[0] * east[2], c[0] * east[1] - c[1] * east[0]];
    const ct = Math.cos(st.tilt), sn = Math.sin(st.tilt);
    const e = east.map((v, i) => v * ct + north[i] * sn);
    const n = north.map((v, i) => v * ct - east[i] * sn);
    return { c, e, n, A: st.size[0], B: st.size[1], lumps: st.lumps, ph: [rand() * 6.28, rand() * 6.28] };
  });
  shapes.set(look, out);
  return out;
}

/** How far out a storm's edge is at angle `th` round it (1: the plain ellipse); lumpy. */
export function stormEdge(sh, th) {
  return 1 + sh.lumps[0] * Math.sin(3 * th + sh.ph[0]) + sh.lumps[1] * Math.sin(5 * th + sh.ph[1]);
}

// Where unit direction (x, y, z) (the storm's own frame) is in storm `sh`: `u` metres along it
// (the front edge is at +u), `v` across, and `q` how far out (1: its edge). Into `out`.
function place(sh, x, y, z, R, out) {
  const cd = Math.max(-1, Math.min(1, x * sh.c[0] + y * sh.c[1] + z * sh.c[2]));
  const d = Math.acos(cd);
  const tx = x - sh.c[0] * cd, ty = y - sh.c[1] * cd, tz = z - sh.c[2] * cd;
  const tl = Math.hypot(tx, ty, tz) || 1;
  const s = (d * R) / tl;
  out.u = (tx * sh.e[0] + ty * sh.e[1] + tz * sh.e[2]) * s;
  out.v = (tx * sh.n[0] + ty * sh.n[1] + tz * sh.n[2]) * s;
  const a = out.u / sh.A, b = out.v / sh.B;
  out.q = Math.hypot(a, b) / stormEdge(sh, Math.atan2(b, a));
  // Far round the back of the world it's no storm (the flat map above breaks down there).
  if (d > 2) out.q = Infinity;
  return out;
}

// Inside a storm: full dust up to this far out (share of the way to its edge), none past the next.
export const INSIDE = [0.55, 1.0];
const spot = { u: 0, v: 0, q: 0 };

/**
 * How deep in a dust storm unit direction (x, y, z) is (0 clear .. 1 right inside), `time`
 * seconds (real time) on (pure; nothing allocated). The planet's frame: the storms have turned
 * `time * look.drift` about z.
 */
export function stormAt(look, R, x, y, z, time) {
  const a = time * look.drift, c = Math.cos(a), s = Math.sin(a);
  // Back into the storms' own frame.
  const px = x * c + y * s, py = -x * s + y * c;
  let k = 0;
  for (const sh of stormShapes(look)) {
    place(sh, px, py, z, R, spot);
    k = Math.max(k, 1 - smooth(INSIDE[0], INSIDE[1], spot.q));
  }
  return k;
}

// A storm coming: from its edge (q = 1) out to this far (q, shares of the way to its edge) it
// shows as a bank of dust on the horizon (FlightScene.updateHaze(), the sky dome's `bank`).
export const APPROACH = 2.6;

/**
 * The storm nearest to coming over the horizon at unit direction (x, y, z), `time` s on (pure;
 * nothing allocated). Into `out`: `k` (0: none near .. 1: at its edge), `x, y, z` the way to
 * its middle along the ground (unit, planet frame), `w` the cosine of how wide it looks
 * (half-angle), `h` how high its bank towers (as the sine of its angle above the horizon).
 */
export function stormNear(look, R, x, y, z, time, out) {
  const a = time * look.drift, c = Math.cos(a), s = Math.sin(a);
  const px = x * c + y * s, py = -x * s + y * c;
  out.k = 0;
  for (const sh of stormShapes(look)) {
    place(sh, px, py, z, R, spot);
    const k = 1 - smooth(INSIDE[1], APPROACH, spot.q);
    if (k <= out.k) continue;
    out.k = k;
    // Its middle now (turned by the drift), along the ground from here.
    const mx = sh.c[0] * c - sh.c[1] * s, my = sh.c[0] * s + sh.c[1] * c, mz = sh.c[2];
    const dot = mx * x + my * y + mz * z;
    let tx = mx - x * dot, ty = my - y * dot, tz = mz - z * dot;
    const tl = Math.hypot(tx, ty, tz) || 1;
    out.x = tx / tl; out.y = ty / tl; out.z = tz / tl;
    const D = Math.acos(Math.max(-1, Math.min(1, dot))) * R, S = (sh.A + sh.B) / 2;
    out.w = Math.cos(Math.max(0.5, Math.min(1.5, 1.4 * Math.atan(S / Math.max(D - 0.5 * S, 1)))));
    out.h = 0.07 + 0.13 * k;
  }
  return out;
}

/**
 * Where every cell and sprite of the storms goes (pure, seeded), as cloudPlan() returns it:
 * `clouds` (one per cell: centre, reach `r`, `base`, `storm` its storm's index, `edge` how far
 * out it is, `front` whether it's in the billowing front) and `puffs` (PUFF_STRIDE numbers per
 * sprite, far-to-near for the +z cameras). Cells lie on a jittered grid inside each storm's
 * lumpy edge. In the front (the leading edge, +u) they're tall billowing clumps; inside, a low,
 * flat, streaky haze; the trailing edge frays into long thin streaks.
 */
export function stormPlan(look, R) {
  const rand = mulberry32(look.seed);
  const clouds = [];
  const puffs = [];
  stormShapes(look).forEach((sh, si) => {
    const step = look.cell;
    const nu = Math.ceil((sh.A * 1.3) / step), nv = Math.ceil((sh.B * 1.3) / step);
    for (let i = -nu; i <= nu; i++) {
      for (let j = -nv; j <= nv; j++) {
        // A jittered grid in (u, v), rows offset, so it doesn't look like one.
        const u = (i + (j & 1) * 0.5 + (rand() - 0.5) * 0.6) * step;
        const v = (j + (rand() - 0.5) * 0.6) * step * 0.87;
        const a = u / sh.A, b = v / sh.B;
        const q = Math.hypot(a, b) / stormEdge(sh, Math.atan2(b, a));
        if (q > 0.97) continue;
        // The cell's middle on the ground: from the storm's middle, turned along (u, v).
        const d = Math.hypot(u, v) / R;
        const t = d > 1e-6 ? sh.e.map((c, m) => (c * u + sh.n[m] * v) / (d * R)) : sh.e;
        const up = sh.c.map((c, m) => c * Math.cos(d) + t[m] * Math.sin(d));
        const front = a > 0.1 && q > 0.55;
        const trail = a < -0.2 && q > 0.72;
        const base = R + look.alt;
        // Along the drift there (east), tilted as the storm is.
        let e = [-up[1], up[0], 0];
        const el = Math.hypot(e[0], e[1]) || 1;
        e = e.map((c) => c / el);
        const nx = [up[1] * e[2] - up[2] * e[1], up[2] * e[0] - up[0] * e[2], up[0] * e[1] - up[1] * e[0]];
        const centre = up.map((c) => c * base);
        const ci = clouds.length;
        // Thinner towards the edge (the storm fades out softly all round, except its front).
        const edgeK = front ? 1 : 1 - 0.55 * smooth(0.5, 0.97, q);
        // The front is a wall of dust towering over the rest (so it shows over the horizon as it
        // comes: this world is small, and its horizon near), tallest right at the edge.
        const H = front ? (16 + 18 * smooth(0.55, 0.9, q)) * (0.8 + rand() * 0.4) : trail ? 3 : 6 + rand() * 3;
        const heart = up.map((c) => c * H * 0.35);
        let reach = 0;
        const put = (du, dv, lift, size, dens, stretch) => {
          const off = [0, 1, 2].map((m) => e[m] * du + nx[m] * dv + up[m] * lift);
          const p = off.map((c, m) => centre[m] + c);
          const nv2 = off.map((c, m) => c - heart[m]);
          const nl = Math.hypot(...nv2) || 1;
          reach = Math.max(reach, Math.hypot(...off) + size * stretch);
          puffs.push([p[0], p[1], p[2], size, lift, ci, rand(), nv2[0] / nl, nv2[1] / nl, nv2[2] / nl, dens, Math.min(1, Math.max(0, lift / H)), e[0], e[1], e[2], stretch]);
        };
        if (front) {
          // A billowing wall of blowing dust: sprites drawn out along the wind (streaky, ragged,
          // not round bubbles), stacked up high over the haze behind it.
          const count = 9 + Math.floor(rand() * 2);
          for (let k = 0; k < count; k++) {
            const du = (rand() + rand() - 1) * step * 0.6, dv = (rand() + rand() - 1) * step * 0.6;
            const mid = Math.max(0, 1 - (Math.hypot(du, dv) / (step * 0.7)) ** 2);
            const size = step * (0.45 + 0.2 * mid + rand() * 0.12);
            // Stacked up the wall: from its foot to the top of its dome.
            const lift = Math.max(size * 0.3, Math.min(((k + rand()) / count) * H * (0.5 + 0.5 * mid), H + 2 - size * 0.6));
            put(du * 1.5, dv * 0.8, lift, size * 0.66, 0.5 + 0.35 * mid, 2.7);
          }
        } else if (trail) {
          // Frayed streaks at the back, drawn out along the wind.
          const count = 3 + Math.floor(rand() * 2);
          for (let k = 0; k < count; k++) {
            put((rand() - 0.5) * step, (rand() - 0.5) * step * 0.8, 1.5 + rand() * 2, step * (0.24 + rand() * 0.1), 0.4 * edgeK, 2.6);
          }
        } else {
          // The body of the storm: a low, flat haze, a little streaky along the wind.
          const count = 3 + Math.floor(rand() * 2);
          for (let k = 0; k < count; k++) {
            const size = step * (0.6 + rand() * 0.2);
            put((rand() - 0.5) * step, (rand() - 0.5) * step * 0.9, size * 0.3 + rand() * H * 0.5, size, (0.6 + rand() * 0.25) * edgeK, 1.5);
          }
        }
        clouds.push({ x: centre[0], y: centre[1], z: centre[2], r: reach, base, storm: si, edge: q, front, wisp: false });
      }
    }
  });
  puffs.sort((a, b) => a[2] - b[2]);
  return { clouds, puffs: Float32Array.from(puffs.flat()) };
}

// The blowing dust (see createStreams()). Per sprite: where it is in the box (x, y, z: 0..1)
// and a seed; kind (0 a streak, 1 a puff), size (m: a streak's half-width, a puff's radius),
// how far it's drawn out (along the wind), life (s); height (m), gust (m/s).
export const STREAM_STRIDE = 10;
const STREAK = 0, PUFF = 1;

/** The blowing dust's particles (pure, seeded): STREAM_STRIDE numbers each. */
export function streamPlan(look) {
  const s = look.streams;
  const rand = mulberry32(look.seed + 5);
  const between = ([a, b]) => a + rand() * (b - a);
  const out = [];
  for (let i = 0; i < s.streaks + s.puffs; i++) {
    const puff = i >= s.streaks;
    // Streaks mostly low down (where the dust is thickest), a few higher.
    const r = rand();
    const high = puff ? between(s.puffHigh) : s.high[0] + (s.high[1] - s.high[0]) * r;
    out.push(rand(), rand(), rand(), rand(), puff ? PUFF : STREAK, puff ? between(s.puff) : between(s.streak),
      puff ? 1.8 : between(s.stretch), between(s.life) * (puff ? 1.6 : 1), high, between(s.gust));
  }
  return Float32Array.from(out);
}

// (The same small hash as the embers', no sin(): the same on phones.)
const VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  attribute vec4 spot; // x, y, z in the box (0..1), seed
  attribute vec4 shape; // kind, size, stretch, life
  attribute vec2 fly; // height, gust
  uniform float time;
  uniform float box;
  uniform float groundR;
  uniform float strength;
  uniform vec3 focus;
  uniform vec3 up;
  uniform vec3 wind;
  uniform vec3 offset;
  uniform vec3 sunDir;
  uniform vec3 foci[3];
  uniform int nFoci;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vKind;
  varying float vDay;
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
      k = min(k, 0.1 + 0.9 * smoothstep(r * 0.5, r + 2.0, off));
    }
    return k;
  }
  void main() {
    float scale = length(modelMatrix[0].xyz);
    // Its loop: blown along for its life, then it starts again somewhere else in the box.
    float u = time / shape.w + spot.w * 17.0;
    float cycle = floor(u);
    float age = u - cycle;
    float n = cycle + spot.w * 1000.0;
    vec3 jit = vec3(hash11(n * 1.37 + 0.11), hash11(n * 2.71 + 0.53), hash11(n * 0.83 + 0.97));
    // Anchored to the ground (the wind's offset carries it, not the camera), wrapped into the
    // box round what the camera follows, and laid along the ground there.
    vec3 q = fract(spot.xyz + jit) * box + offset + wind * (fly.y * age * shape.w);
    vec3 rel = mod(q - focus, box) - 0.5 * box;
    rel -= up * dot(rel, up);
    float hgt = fly.x * (shape.x > 0.5 ? 1.0 : 0.8 + 0.4 * hash11(n * 3.1 + 0.2));
    vec3 p = normalize(focus + rel) * (groundR + hgt);
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    float depth = -mvPosition.z;
    float s = shape.y * scale;
    float len = s * shape.z;
    float alpha = smoothstep(0.0, 0.2, age) * (1.0 - smoothstep(0.6, 1.0, age));
    // Softly gone towards the box's sides (never a wall of dust ending), and near the lens.
    alpha *= 1.0 - smoothstep(0.3 * box, 0.5 * box, length(rel));
    alpha *= smoothstep(1.5, 4.0, depth);
    // Never big on screen (overdraw; a puff right in front of the lens is only a blur): a
    // puff's size, a streak's width and (more loosely) its length.
    float pr = projectionMatrix[1][1] / max(depth, 1e-3);
    alpha *= shape.x > 0.5 ? 1.0 - smoothstep(0.16, 0.32, s * pr) : (1.0 - smoothstep(0.04, 0.09, s * pr)) * (1.0 - smoothstep(0.5, 1.0, len * pr));
    alpha *= sight((modelMatrix * vec4(p, 1.0)).xyz, max(len, s));
    alpha *= strength;
    vec3 upV = normalize((modelViewMatrix * vec4(up, 0.0)).xyz);
    vDay = smoothstep(-0.3, 0.3, dot(upV, sunDir));
    vUv = position.xy * 2.0;
    vKind = shape.x;
    // Drawn out along the wind, as far as that shows from here.
    vec2 c = position.xy * 2.0;
    vec3 dv = (modelViewMatrix * vec4(wind, 0.0)).xyz;
    float dl = length(dv.xy);
    if (dl > 0.001) {
      vec2 d2 = dv.xy / dl;
      c += d2 * dot(c, d2) * (shape.z - 1.0) * dl;
    }
    mvPosition.xy += c * s;
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
  void main() {
    #include <logdepthbuf_fragment>
    float r2 = dot(vUv, vUv);
    if (r2 > 1.0) discard;
    float f = (1.0 - r2) * (1.0 - r2);
    // A streak: a thin soft line of dust; a puff: a faint soft ball.
    float a = vAlpha * (vKind > 0.5 ? 0.28 * f : 0.75 * f);
    a *= mix(0.35, 1.0, vDay);
    if (a < 0.003) discard;
    vec3 c = mix(shadeColor, litColor, vDay) * mix(0.25, 1.0, vDay);
    gl_FragColor = vec4(c, a);
    #include <fog_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb *= gl_FragColor.a; // premultiplied
  }`;

const quad = new THREE.PlaneGeometry(1, 1);

/**
 * The blowing dust near the ground in a storm: one instanced billboard mesh (one draw call),
 * in the world's group. Returns { mesh, count, set(...) (see below), fade(foci, n) }.
 */
export function createStreams(look, sunDir) {
  const s = look.streams;
  const plan = streamPlan(look);
  const count = plan.length / STREAM_STRIDE;
  const spot = new Float32Array(count * 4), shape = new Float32Array(count * 4), fly = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const k = i * STREAM_STRIDE;
    spot.set(plan.subarray(k, k + 4), i * 4);
    shape.set(plan.subarray(k + 4, k + 8), i * 4);
    fly.set(plan.subarray(k + 8, k + 10), i * 2);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('spot', new THREE.InstancedBufferAttribute(spot, 4));
  geo.setAttribute('shape', new THREE.InstancedBufferAttribute(shape, 4));
  geo.setAttribute('fly', new THREE.InstancedBufferAttribute(fly, 2));
  geo.instanceCount = count;
  const bound = new THREE.Sphere(new THREE.Vector3(), s.box);
  geo.boundingSphere = bound;
  const foci = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const uniforms = {
    time: { value: 0 },
    box: { value: s.box },
    groundR: { value: 0 },
    strength: { value: 0 },
    focus: { value: new THREE.Vector3() },
    up: { value: new THREE.Vector3(0, 0, 1) },
    wind: { value: new THREE.Vector3(1, 0, 0) },
    offset: { value: new THREE.Vector3() },
    sunDir: { value: sunDir },
    foci: { value: foci },
    nFoci: { value: 0 },
    litColor: { value: new THREE.Color(s.lit) },
    shadeColor: { value: new THREE.Color(s.shade) },
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
  mesh.name = 'dust-streams';
  mesh.raycast = () => {};
  mesh.renderOrder = 1;
  mesh.visible = false;
  const u = mesh.material.uniforms;
  return {
    mesh,
    count,
    plan,
    /**
     * This frame's dust: `strength` (0..1: none hides it), where it blows round (the planet's
     * frame: the unit direction `dx, dy, dz` of what the camera follows, and the ground's
     * radius `groundR` there), `time` (s, real) and `dt` (s) to carry the dust on the wind.
     */
    set(strength, dx, dy, dz, groundR, time, dt) {
      mesh.visible = strength > 0.005;
      u.strength.value = strength;
      if (!mesh.visible) return;
      u.time.value = time % 1000; // (the loops don't care; keeps the shader's floats small)
      u.groundR.value = groundR;
      u.up.value.set(dx, dy, dz);
      u.focus.value.set(dx * groundR, dy * groundR, dz * groundR);
      bound.center.copy(u.focus.value);
      // The wind blows the way the storms drift (east); near the poles, any way along the ground.
      let wx = -dy, wy = dx, wz = 0;
      let wl = Math.hypot(wx, wy);
      if (wl < 0.05) { wx = 1 - dx * dx; wy = -dx * dy; wz = -dx * dz; wl = Math.hypot(wx, wy, wz) || 1; }
      u.wind.value.set(wx / wl, wy / wl, wz / wl);
      // The dust carried on it: the box repeats every `box` metres along x, y and z, so the
      // offset can wrap there without a jump.
      const o = u.offset.value, b = s.box, k = s.wind * dt;
      o.set(((o.x + u.wind.value.x * k) % b + b) % b, ((o.y + u.wind.value.y * k) % b + b) % b, ((o.z + u.wind.value.z * k) % b + b) % b);
    },
    fade(pts, n) {
      const m = Math.min(n, foci.length);
      for (let i = 0; i < m; i++) foci[i].set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
      u.nFoci.value = m;
    },
  };
}

/**
 * A world's dust storms, or null if it has none. Returns { look, layer (a cloud layer:
 * mesh, update(time), fade(...)), streams (see createStreams()), colours, at(x, y, z, time) (how
 * deep in a storm a unit direction is: stormAt()), near(x, y, z, time, out) (stormNear()) }.
 */
export function createStorms(body, sunDir) {
  const look = STORM_LOOK[body.id];
  if (!look) return null;
  const layer = createCloudLayer(look, stormPlan(look, body.radius), body.radius, sunDir, 'storms');
  const streams = createStreams(look, sunDir);
  return {
    look,
    layer,
    streams,
    colours: { lit: new THREE.Color(look.lit), shade: new THREE.Color(look.shade) },
    at: (x, y, z, time) => stormAt(look, body.radius, x, y, z, time),
    near: (x, y, z, time, out) => stormNear(look, body.radius, x, y, z, time, out),
  };
}
