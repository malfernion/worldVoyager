// Ambient life on the worlds: Sizzle's volcano plumes, Dusty's caldera puffs, drifting dust and
// dust devils, Flip's frosty geysers, Ducky's gas jets and its comet tails.
// Every puff is a loop driven only by the clock (no spawning, no per-frame allocation), and each
// world's puffs are one instanced billboard mesh inside the planet's group, so they move and scale
// with the planet in flight, driving and the map.
import * as THREE from 'three';
import { mulberry32 } from '../physics/noise.js';
import { SIZZLE_VENTS, DUSTY_VOLCANO, FLIP_GEYSERS, DUCKY_JETS } from '../physics/terrain.js';
import { JETS } from '../physics/buggy.js';
import { DUST_DEVILS, devilAt } from '../physics/discoveries.js';
import { glowTexture, puffTexture } from './materials.js';

// Tuning knobs.
const PLUME_PUFFS = 9; // per Sizzle vent
const VENT_EMBERS = 3; // per Sizzle vent
const CALDERA_PUFFS = 10; // per Dusty burst
const CALDERA_PERIOD = 13; // seconds between Dusty bursts (some bursts are skipped)
const DUST_PUFFS = 28; // drifting dust clouds over all of Dusty
const DEVIL_PUFFS = 18; // per Dusty dust devil (#15)
const DEVIL_HEIGHT = 24; // how tall a dust devil is (m)
const GEYSER_PUFFS = 10; // per Flip geyser
const GEYSER_GLINTS = 4; // ice sparkles per Flip geyser
const JET_PUFFS = 7; // per Ducky gas jet
const JET_FIZZ = 3; // fizzy sparkles per Ducky gas jet
const DUST_TAIL = 44; // soft puffs in the comet's curved dust tail
const ION_TAIL = 30; // blue glows in its straight gas (ion) tail
const TAIL_MAX = 1400; // tail length close to Ember (m); none beyond TAIL_FAR
const TAIL_NEAR = 8000;
const TAIL_FAR = 32000;
const TAIL_MAP = 8; // the map may draw the tail up to this many times longer, like the worlds

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 offset;
  attribute vec4 tint;
  attribute vec2 shape; // size, spin
  uniform vec3 sunDir;
  uniform float lit;
  varying vec2 vUv;
  varying vec4 vTint;
  void main() {
    vec4 mv = modelViewMatrix * vec4(offset, 1.0);
    // Billboard in view space, sized in world units (follows the map-view planet scale).
    float scale = length(modelMatrix[0].xyz);
    float c = cos(shape.y), s = sin(shape.y);
    mv.xy += mat2(c, s, -s, c) * position.xy * shape.x * scale;
    vec3 n = normalize((modelViewMatrix * vec4(offset, 0.0)).xyz);
    float day = mix(1.0, 0.3 + 0.7 * smoothstep(-0.25, 0.4, dot(n, sunDir)), lit);
    vTint = vec4(tint.rgb * day, tint.a);
    vUv = uv;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`;

const FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec4 vTint;
  void main() {
    #include <logdepthbuf_fragment>
    vec4 t = texture2D(map, vUv);
    gl_FragColor = vec4(t.rgb * vTint.rgb, t.a * vTint.a);
    if (gl_FragColor.a < 0.004) discard;
    #include <colorspace_fragment>
  }`;

const quad = new THREE.PlaneGeometry(1, 1);

/** One draw call for up to `count` soft billboards living in the planet's frame. */
function billboards(count, map, sunDir, radius, { additive = false, lit = true } = {}) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  const attr = (n) => new THREE.InstancedBufferAttribute(new Float32Array(count * n), n).setUsage(THREE.DynamicDrawUsage);
  const offset = attr(3), tint = attr(4), shape = attr(2);
  geo.setAttribute('offset', offset);
  geo.setAttribute('tint', tint);
  geo.setAttribute('shape', shape);
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius);
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, sunDir: { value: sunDir }, lit: { value: lit ? 1 : 0 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.raycast = () => {};
  const o = offset.array, t = tint.array, s = shape.array;
  return {
    mesh,
    set(i, x, y, z, size, spin, col, alpha) {
      o[i * 3] = x; o[i * 3 + 1] = y; o[i * 3 + 2] = z;
      t[i * 4] = col.r; t[i * 4 + 1] = col.g; t[i * 4 + 2] = col.b; t[i * 4 + 3] = alpha;
      s[i * 2] = size; s[i * 2 + 1] = spin;
    },
    hide(i) {
      t[i * 4 + 3] = 0;
      s[i * 2] = 0;
    },
    commit() {
      offset.needsUpdate = tint.needsUpdate = shape.needsUpdate = true;
    },
  };
}

/** Up + two tangents at a spot on the sphere. */
function basis(d) {
  const up = new THREE.Vector3(d.x, d.y, d.z).normalize();
  const t1 = new THREE.Vector3(0, 0, 1).cross(up);
  if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0).cross(up);
  t1.normalize();
  return { up, t1, t2: up.clone().cross(t1) };
}

const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const tmpCol = new THREE.Color();

// Rises fast then slows and spreads sideways, like an Io umbrella plume.
function drawPuff(p, a, time, bb, i) {
  const e = 1 - (1 - a) * (1 - a);
  const side = Math.pow(a, 1.6);
  const x = p.x + p.ux * p.rise * e + p.dx * side;
  const y = p.y + p.uy * p.rise * e + p.dy * side;
  const z = p.z + p.uz * p.rise * e + p.dz * side;
  const alpha = p.alpha * smooth(0, 0.1, a) * (1 - smooth(0.55, 1, a));
  tmpCol.copy(p.c0).lerp(p.c1, Math.min(1, a * 1.8));
  bb.set(i, x, y, z, p.s0 + (p.s1 - p.s0) * e, p.spin + a * p.spinRate, tmpCol, alpha);
}

// A hop up and back down.
function drawEmber(p, a, time, bb, i) {
  const h = 4 * p.rise * a * (1 - a);
  const x = p.x + p.ux * h + p.dx * a, y = p.y + p.uy * h + p.dy * a, z = p.z + p.uz * h + p.dz * a;
  bb.set(i, x, y, z, p.s0 * (1 - 0.5 * a), 0, p.c0, 1 - smooth(0.6, 1, a));
}

// The steady, breathing glow in a vent.
function drawGlow(p, a, time, bb, i) {
  const k = 1 + 0.12 * Math.sin(time * 2.3 + p.seed) + 0.06 * Math.sin(time * 7.1 + p.seed * 3);
  bb.set(i, p.x, p.y, p.z, p.s0 * k, 0, p.c0, 0.85);
}

// Skims along the ground, fading in and out.
function drawDust(p, a, time, bb, i) {
  let x = p.x + p.dx * a, y = p.y + p.dy * a, z = p.z + p.dz * a;
  const k = p.r / Math.hypot(x, y, z);
  x *= k; y *= k; z *= k;
  const alpha = p.alpha * Math.sin(Math.PI * a);
  bb.set(i, x, y, z, p.s0 + (p.s1 - p.s0) * a, p.spin + a * p.spinRate, p.c0, alpha);
}

/** Clock-driven particle loops. Each slot respawns (re-rolls its randomness) once per period. */
function loops(bb) {
  const list = [];
  return {
    add(p) {
      p.cycle = null;
      list.push(p);
    },
    update(time) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const u = (time + p.phase) / p.period;
        const cycle = Math.floor(u);
        if (cycle !== p.cycle) {
          p.cycle = cycle;
          if (p.spawn) p.spawn(p, mulberry32(p.seed * 7919 + cycle * 104729), cycle);
        }
        const a = ((u - cycle) * p.period) / p.life;
        if (a >= 1 || p.skip) bb.hide(i);
        else p.draw(p, a, time, bb, i);
      }
      bb.commit();
    },
  };
}

function place(p, b, r) {
  p.x = b.up.x * r; p.y = b.up.y * r; p.z = b.up.z * r;
  p.ux = b.up.x; p.uy = b.up.y; p.uz = b.up.z;
  return p;
}

function tangent(p, b, angle, len) {
  const c = Math.cos(angle) * len, s = Math.sin(angle) * len;
  p.dx = b.t1.x * c + b.t2.x * s;
  p.dy = b.t1.y * c + b.t2.y * s;
  p.dz = b.t1.z * c + b.t2.z * s;
}

function sizzle(body, sunDir) {
  const n = SIZZLE_VENTS.length;
  const radius = body.radius * 1.7;
  const puffs = billboards(n * PLUME_PUFFS, puffTexture(), sunDir, radius);
  const glows = billboards(n * (1 + VENT_EMBERS), glowTexture('rgba(255,210,120,1)', 'rgba(255,80,20,0)'), sunDir, radius, { additive: true, lit: false });
  const smoke = loops(puffs);
  const lava = loops(glows);
  const hot = new THREE.Color(0xff8a3d);
  const sulfur = new THREE.Color(0xf6d65e);
  const cream = new THREE.Color(0xfff3d2);
  const ember = new THREE.Color(0xffb04a);
  const vent = new THREE.Color(0xff6a2a);
  SIZZLE_VENTS.forEach((v, k) => {
    const b = basis(v);
    const r = body.radius + body.terrainFn.height(b.up.x, b.up.y, b.up.z);
    const height = 16 + v.size * 22;
    const life = 6 + v.size * 2;
    const lean = v.depth * Math.PI * 2; // each plume drifts its own way
    for (let i = 0; i < PLUME_PUFFS; i++) {
      smoke.add(place({
        draw: drawPuff, seed: k * 100 + i, period: life, life, phase: (i / PLUME_PUFFS) * life + k * 1.7,
        s0: 2.5, c0: hot, c1: sulfur.clone(),
        spawn(p, rand) {
          p.rise = height * (0.85 + rand() * 0.3);
          p.s1 = (6 + rand() * 4) * (0.7 + v.size * 0.6);
          p.alpha = 0.8 + rand() * 0.15;
          p.spin = rand() * 6;
          p.spinRate = (rand() - 0.5) * 1.5;
          p.c1.copy(sulfur).lerp(cream, rand());
          // Spread out in a random direction, nudged downwind.
          const a = rand() * Math.PI * 2, s = height * (0.15 + rand() * 0.3);
          const w = height * 0.3;
          const c = Math.cos(a) * s + Math.cos(lean) * w, d = Math.sin(a) * s + Math.sin(lean) * w;
          tangent(p, b, Math.atan2(d, c), Math.hypot(c, d));
        },
      }, b, r - 1));
    }
    lava.add(place({ draw: drawGlow, seed: k, period: 1e6, life: 1e6, phase: 0, s0: 6 + v.size * 4, c0: vent }, b, r + 0.5));
    for (let i = 0; i < VENT_EMBERS; i++) {
      lava.add(place({
        draw: drawEmber, seed: k * 10 + i, period: 2.2 + ((k + i) % 3) * 0.7, life: 1.4, phase: i * 0.9 + k, c0: ember,
        spawn(p, rand) {
          p.rise = 4 + v.size * 6 + rand() * 3;
          p.s0 = 1.2 + rand() * 0.8;
          tangent(p, b, rand() * Math.PI * 2, 1 + rand() * 3);
        },
      }, b, r));
    }
  });
  return {
    meshes: [puffs.mesh, glows.mesh],
    update(time) {
      smoke.update(time);
      lava.update(time);
    },
  };
}

// A dust devil: puffs spiral up a funnel that widens towards the top. `devils` holds where each
// devil is this frame (base point and its up/tangents), worked out once per frame in dusty().
function drawDevil(p, a, time, bb, i) {
  const d = p.devils[p.k];
  const h = a * DEVIL_HEIGHT;
  const w = 0.5 + a * a * 6; // a funnel, wide at the top
  const th = p.spin + time * (3.2 - a * 1.5);
  const c = Math.cos(th) * w, s = Math.sin(th) * w;
  const x = d.x + d.ux * h + d.t1x * c + d.t2x * s;
  const y = d.y + d.uy * h + d.t1y * c + d.t2y * s;
  const z = d.z + d.uz * h + d.t1z * c + d.t2z * s;
  const alpha = p.alpha * smooth(0, 0.15, a) * (1 - smooth(0.7, 1, a));
  bb.set(i, x, y, z, 1.2 + a * 3.5, p.spin + time, p.c0, alpha);
}

function dusty(body, sunDir) {
  const count = CALDERA_PUFFS + DUST_PUFFS;
  const puffs = billboards(count, puffTexture(), sunDir, body.radius * 1.4);
  const all = loops(puffs);
  const t = body.terrainFn;

  const b = basis(DUSTY_VOLCANO);
  const r = body.radius + t.height(b.up.x, b.up.y, b.up.z) + 2;
  const ash = new THREE.Color(0x5e4640);
  const pale = new THREE.Color(0xd9b49a);
  for (let i = 0; i < CALDERA_PUFFS; i++) {
    all.add(place({
      draw: drawPuff, seed: 500 + i, period: CALDERA_PERIOD, life: 7.5, phase: -i * 0.22, s0: 4, c0: ash, c1: pale,
      spawn(p, rand, cycle) {
        // Every puff of a burst shares the cycle, so this skips whole bursts at once.
        p.skip = mulberry32(cycle * 31 + 7)() < 0.3;
        p.rise = 24 + rand() * 12;
        p.s1 = 13 + rand() * 7;
        p.alpha = 0.7;
        p.spin = rand() * 6;
        p.spinRate = (rand() - 0.5) * 1.2;
        tangent(p, b, 0.8 + (rand() - 0.5) * 2, 8 + rand() * 14);
      },
    }, b, r));
  }

  const dust = new THREE.Color(0xeab089);
  const avoid = Math.cos(0.6);
  for (let i = 0; i < DUST_PUFFS; i++) {
    const period = 14 + (i % 5) * 1.5;
    all.add({
      draw: drawDust, seed: 900 + i, period, life: period, phase: (i / DUST_PUFFS) * period * 3, c0: dust,
      spawn(p, rand) {
        let x, y, z;
        do {
          z = rand() * 2 - 1;
          const a = rand() * Math.PI * 2, s = Math.sqrt(1 - z * z);
          x = s * Math.cos(a); y = s * Math.sin(a);
        } while (x * DUSTY_VOLCANO.x + y * DUSTY_VOLCANO.y + z * DUSTY_VOLCANO.z > avoid);
        p.r = body.radius + Math.max(0, t.height(x, y, z)) + 3;
        p.x = x * p.r; p.y = y * p.r; p.z = z * p.r;
        // A steady breeze blowing round the planet's z axis.
        const wl = Math.hypot(x, y) || 1, len = 30 + rand() * 25;
        p.dx = (-y / wl) * len; p.dy = (x / wl) * len; p.dz = (rand() - 0.5) * 10;
        p.s0 = 10 + rand() * 8;
        p.s1 = p.s0 * 1.4;
        p.alpha = 0.18 + rand() * 0.1;
        p.spin = rand() * 6;
        p.spinRate = (rand() - 0.5) * 0.6;
      },
    });
  }

  // Dust devils (#15) wander the plains (devilAt in discoveries.js, which also finds them).
  // Their own mesh, unshaded, so they still show on the night side where they're hunted too.
  const devilBB = billboards(DUST_DEVILS.length * DEVIL_PUFFS, puffTexture(), sunDir, body.radius * 1.4, { lit: false });
  const swirls = loops(devilBB);
  const devils = DUST_DEVILS.map(() => ({}));
  const dir = { x: 0, y: 0, z: 0 };
  const swirl = new THREE.Color(0xf0cda6);
  DUST_DEVILS.forEach((_, k) => {
    for (let i = 0; i < DEVIL_PUFFS; i++) {
      const life = 2.4;
      swirls.add({
        draw: drawDevil, devils, k, seed: 1200 + k * 50 + i, period: life, life, phase: (i / DEVIL_PUFFS) * life, c0: swirl,
        spawn(p, rand) {
          p.spin = rand() * Math.PI * 2;
          p.alpha = 0.55 + rand() * 0.2;
        },
      });
    }
  });
  const placeDevils = (time) => {
    for (let k = 0; k < devils.length; k++) {
      devilAt(k, time, dir);
      const d = devils[k];
      const r = body.radius + t.height(dir.x, dir.y, dir.z) - 0.5;
      d.x = dir.x * r; d.y = dir.y * r; d.z = dir.z * r;
      d.ux = dir.x; d.uy = dir.y; d.uz = dir.z;
      // Tangents (z × up, then up × that).
      let ax = -dir.y, ay = dir.x;
      const l = Math.hypot(ax, ay) || 1;
      ax /= l; ay /= l;
      d.t1x = ax; d.t1y = ay; d.t1z = 0;
      d.t2x = -dir.z * ay; d.t2y = dir.z * ax; d.t2z = dir.x * ay - dir.y * ax;
    }
  };
  return {
    meshes: [puffs.mesh, devilBB.mesh],
    update(time) {
      all.update(time);
      placeDevils(time);
      swirls.update(time);
    },
  };
}

// Triton-style geysers: a thin frosty column shoots straight up, then the wind drags its top
// sideways (the same way as the dark streak it leaves on the ground, see FLIP_GEYSERS).
function flip(body, sunDir) {
  const n = FLIP_GEYSERS.length;
  const radius = body.radius * 1.8;
  const puffs = billboards(n * GEYSER_PUFFS, puffTexture(), sunDir, radius);
  const glints = billboards(n * GEYSER_GLINTS, glowTexture('rgba(235,250,255,1)', 'rgba(150,210,255,0)'), sunDir, radius, { additive: true, lit: false });
  const frost = loops(puffs);
  const ice = loops(glints);
  const white = new THREE.Color(0xf4fbff);
  const blue = new THREE.Color(0xc4dcec);
  const grey = new THREE.Color(0x9d98a6);
  const sparkle = new THREE.Color(0xd8f0ff);
  FLIP_GEYSERS.forEach((v, k) => {
    const b = basis(v);
    const r = body.radius + body.terrainFn.height(b.up.x, b.up.y, b.up.z);
    const height = 22 + v.size * 24;
    const life = 5 + v.size * 2;
    for (let i = 0; i < GEYSER_PUFFS; i++) {
      frost.add(place({
        draw: drawPuff, seed: 2000 + k * 100 + i, period: life, life, phase: (i / GEYSER_PUFFS) * life + k * 1.3,
        s0: 1.4, c0: white, c1: blue.clone(),
        spawn(p, rand) {
          p.rise = height * (0.85 + rand() * 0.3);
          p.s1 = (4 + rand() * 3) * (0.7 + v.size * 0.5);
          p.alpha = 0.75 + rand() * 0.2;
          p.spin = rand() * 6;
          p.spinRate = (rand() - 0.5) * 1.2;
          // Some puffs carry dark dust, like Triton's plumes.
          p.c1.copy(blue).lerp(grey, rand() ** 3 * 0.7);
          // Blown downwind, with a little spread.
          const a = v.lean + (rand() - 0.5) * 0.6;
          tangent(p, b, a, height * (0.5 + rand() * 0.4));
        },
      }, b, r - 0.5));
    }
    for (let i = 0; i < GEYSER_GLINTS; i++) {
      ice.add(place({
        draw: drawEmber, seed: 3000 + k * 10 + i, period: 1.8 + ((k + i) % 3) * 0.5, life: 1.3, phase: i * 0.7 + k, c0: sparkle,
        spawn(p, rand) {
          p.rise = 5 + v.size * 6 + rand() * 4;
          p.s0 = 0.9 + rand() * 0.7;
          tangent(p, b, rand() * Math.PI * 2, 1 + rand() * 2.5);
        },
      }, b, r));
    }
  });
  return {
    meshes: [puffs.mesh, glints.mesh],
    update(time) {
      frost.update(time);
      ice.update(time);
    },
  };
}

// Ducky, the comet (#13): gas fizzing out of little vents (they push the buggy, see JETS in
// buggy.js), and two tails that grow as it swoops in close to Ember and always point away
// from it: a curved, creamy dust tail lagging behind, and a straight, blue gas tail.
// `env` is kept fresh by the flight scene: which way the sun is, how far, which way we're
// going, and the map's scale-up of the planet.
function ducky(body, sunDir, env) {
  const n = DUCKY_JETS.length;
  const radius = body.radius * 1.8;
  const puffs = billboards(n * JET_PUFFS, puffTexture(), sunDir, radius);
  const fizz = billboards(n * JET_FIZZ, glowTexture('rgba(240,252,255,1)', 'rgba(160,220,255,0)'), sunDir, radius, { additive: true, lit: false });
  const gas = loops(puffs);
  const bubbles = loops(fizz);
  const white = new THREE.Color(0xf6fbff);
  const pale = new THREE.Color(0xc9d8e6);
  const spark = new THREE.Color(0xe2f6ff);
  DUCKY_JETS.forEach((v, k) => {
    const b = basis(v);
    const r = body.radius + body.terrainFn.height(b.up.x, b.up.y, b.up.z);
    // About as high as the jet pushes the buggy, and a bit more.
    const height = JETS.height * (1.2 + v.size * 0.6);
    const life = 2.2 + v.size;
    for (let i = 0; i < JET_PUFFS; i++) {
      gas.add(place({
        draw: drawPuff, seed: 4000 + k * 100 + i, period: life, life, phase: (i / JET_PUFFS) * life + k * 0.9,
        s0: 0.8, c0: white, c1: pale,
        spawn(p, rand) {
          p.rise = height * (0.8 + rand() * 0.4);
          p.s1 = (2.5 + rand() * 2) * (0.7 + v.size * 0.5);
          p.alpha = 0.55 + rand() * 0.25;
          p.spin = rand() * 6;
          p.spinRate = (rand() - 0.5) * 2;
          tangent(p, b, rand() * Math.PI * 2, height * (0.1 + rand() * 0.25));
        },
      }, b, r - 0.3));
    }
    for (let i = 0; i < JET_FIZZ; i++) {
      bubbles.add(place({
        draw: drawEmber, seed: 5000 + k * 10 + i, period: 0.9 + ((k + i) % 3) * 0.3, life: 0.8, phase: i * 0.37 + k * 0.5, c0: spark,
        spawn(p, rand) {
          p.rise = 2 + rand() * 3;
          p.s0 = 0.5 + rand() * 0.5;
          tangent(p, b, rand() * Math.PI * 2, 0.5 + rand() * 2.5);
        },
      }, b, r));
    }
  });

  // The tails. Each puff drifts from the nucleus out along the tail; where "along" points is
  // read from env every frame, so the tails swing round as the comet goes round Ember.
  const reach = TAIL_MAX * TAIL_MAP * 1.2;
  const dustBB = billboards(DUST_TAIL, glowTexture('rgba(255,250,235,1)', 'rgba(255,240,215,0)'), sunDir, reach, { lit: false });
  const ionBB = billboards(ION_TAIL + 1, glowTexture('rgba(190,230,255,1)', 'rgba(90,160,255,0)'), sunDir, reach, { additive: true, lit: false });
  const dust = loops(dustBB);
  const ion = loops(ionBB);
  const cream = new THREE.Color(0xfff2d8);
  const blue = new THREE.Color(0x8fd0ff);
  const coma = new THREE.Color(0xd8f0ff);
  const tail = { len: 0, k: 1 }; // this frame's tail length and map shrink factor
  // Away from the sun, plus `bend` of the way we came from (the dust tail lags behind), at a.
  const along = (p, a, bend, bb, i, size, col, alpha) => {
    const L = tail.len * tail.k; // in the planet's (map-scaled) frame
    const ax = -env.toSun.x, ay = -env.toSun.y;
    const back = bend * a * a;
    const dx = ax + env.back.x * back, dy = ay + env.back.y * back;
    // Sideways spread (in the plane and towards the camera) grows down the tail.
    const w = (0.04 + 0.1 * a) * L * p.spread;
    bb.set(i, dx * a * L - ay * w * p.side, dy * a * L + ax * w * p.side, w * p.lift, size * L, p.spin, col, alpha);
  };
  const drawDustTail = (p, a, time, bb, i) => {
    along(p, a, 0.35, bb, i, 0.05 + 0.18 * a, cream, p.alpha * smooth(0, 0.08, a) * (1 - smooth(0.4, 1, a)));
  };
  const drawIonTail = (p, a, time, bb, i) => {
    along(p, a, 0, bb, i, 0.03 + 0.08 * a, blue, p.alpha * smooth(0, 0.05, a) * (1 - smooth(0.5, 1, a)));
  };
  const spawnTail = (p, rand) => {
    p.side = rand() * 2 - 1;
    p.lift = (rand() * 2 - 1) * 0.6;
    p.spread = 0.5 + rand();
    p.alpha = 0.4 + rand() * 0.25;
    p.spin = rand() * 6;
  };
  for (let i = 0; i < DUST_TAIL; i++) {
    dust.add({ draw: drawDustTail, spawn: spawnTail, seed: 6000 + i, period: 9, life: 9, phase: (i / DUST_TAIL) * 9 });
  }
  for (let i = 0; i < ION_TAIL; i++) {
    ion.add({ draw: drawIonTail, spawn: spawnTail, seed: 7000 + i, period: 5, life: 5, phase: (i / ION_TAIL) * 5 });
  }
  // The coma: a soft glow of gas around the nucleus while it's active.
  ion.add({
    seed: 1, period: 1e6, life: 1e6, phase: 0,
    draw(p, a, time, bb, i) {
      const act = tail.len / TAIL_MAX;
      bb.set(i, 0, 0, 0, body.radius * (3 + 5 * act) * (1 + 0.05 * Math.sin(time * 1.7)), 0, coma, 0.15 + 0.35 * act);
    },
  });
  return {
    meshes: [puffs.mesh, fizz.mesh, dustBB.mesh, ionBB.mesh],
    update(time) {
      gas.update(time);
      bubbles.update(time);
      // Grows as the comet warms up near Ember: nothing far out, longest at the closest point.
      tail.len = TAIL_MAX * smooth(TAIL_FAR, TAIL_NEAR, env.dist) ** 1.5;
      tail.k = Math.min(env.scale, TAIL_MAP) / env.scale;
      const on = tail.len > 1;
      dustBB.mesh.visible = ionBB.mesh.visible = on;
      if (!on) return;
      dust.update(time);
      ion.update(time);
    },
  };
}

/**
 * Ambient effects for a world, or null. `sunDir` is a shared view-space vector the scene keeps
 * fresh; `env` (the comet's) is where the sun is in the world, and how far, for the tails.
 */
export function createAmbient(body, sunDir, env) {
  if (body.id === 'sizzle') return sizzle(body, sunDir);
  if (body.id === 'dusty') return dusty(body, sunDir);
  if (body.id === 'flip') return flip(body, sunDir);
  if (body.id === 'ducky') return ducky(body, sunDir, env);
  return null;
}
