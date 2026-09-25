// The discoveries' landmarks (#15): an old observatory, footprints and a flag, a laser mirror,
// a sleeping rover, a little comet lander, Frosty's glowing cracks and Ember's solar flares.
// Where they are and what finds them is src/physics/discoveries.js.
// Cheap on purpose: each world's still parts are merged into one vertex-coloured mesh (plus its
// ink outline, plus one un-inked mesh for flat things like footprints), all sharing one material;
// only the few moving or glowing bits are separate.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, withOutline, glowTexture } from './materials.js';
import { DISCOVERY_BY_ID, groundPoint, sunDirection, isNight, flareAt, flareNumber } from '../physics/discoveries.js';
import { FROSTY_GLOWS } from '../physics/terrain.js';
import { mulberry32 } from '../physics/noise.js';

let shared = null;
function mats() {
  if (!shared) {
    shared = {
      solid: toon(0xffffff, { vertexColors: true }),
      glow: (inner, outer) => new THREE.SpriteMaterial({ map: glowTexture(inner, outer), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    };
  }
  return shared;
}

const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);

/** A frame standing on the ground at `dir`: +y up, +z towards `toward` (any rough direction). */
function frameAt(body, dir, { lift = 0, spin = 0 } = {}) {
  const up = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
  const pos = V(groundPoint(body, dir, lift));
  // A level-ish forward: "north" (+z) where we can, spun round up by `spin`.
  const ref = Math.abs(up.z) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const fwd = ref.sub(up.clone().multiplyScalar(ref.dot(up))).normalize().applyAxisAngle(up, spin);
  const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
  return new THREE.Matrix4().makeBasis(right, up, fwd).setPosition(pos);
}

/** Collects coloured parts in the world's frame, then merges them into one mesh. */
class Kit {
  constructor() {
    this.inked = [];
    this.plain = [];
    this.obstacles = [];
    this.m = new THREE.Matrix4();
  }

  /** Add geometry `geo` (in the frame `frame`, then moved by x, y, z and rotations) in `color`. */
  add(geo, color, frame, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, ink = true } = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(s, s, s),
    );
    g.applyMatrix4(this.m.multiplyMatrices(frame, local));
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (ink ? this.inked : this.plain).push(g);
  }

  /** Something the buggy bumps into, at `dir` (radius r, height h). */
  solid(body, dir, r, h) {
    const up = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    this.obstacles.push({ position: V(groundPoint(body, dir)), up, radius: r, height: h });
  }

  build(group) {
    const { solid } = mats();
    if (this.inked.length) {
      const mesh = new THREE.Mesh(mergeGeometries(this.inked), solid);
      mesh.name = 'landmarks';
      group.add(withOutline(mesh, 0.05));
    }
    if (this.plain.length) group.add(new THREE.Mesh(mergeGeometries(this.plain), solid));
  }
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
const cyl = (r0, r1, h, n = 10) => new THREE.CylinderGeometry(r0, r1, h, n).translate(0, h / 2, 0);

// A spot `east` and `north` metres away from `dir` over the ground (small distances).
function offset(body, dir, east, north) {
  const up = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
  const ref = Math.abs(up.z) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const n = ref.sub(up.clone().multiplyScalar(ref.dot(up))).normalize();
  const e = new THREE.Vector3().crossVectors(up, n);
  const p = up.addScaledVector(e, east / body.radius).addScaledVector(n, north / body.radius).normalize();
  return { x: p.x, y: p.y, z: p.z };
}

// ---- the landmarks ----------------------------------------------------------------------------

// Homestead: a little wooden observatory on a hilltop, its telescope poking out of the dome.
// Once found, the telescope swings round to point at Ringo.
function observatory(body, kit, group, out) {
  const at = DISCOVERY_BY_ID['find-observatory'].spots[0];
  const f = frameAt(body, at, { lift: -0.3, spin: 0.6 });
  kit.add(cyl(2.7, 2.9, 3.4, 12), 0xc99a63, f); // wooden walls
  kit.add(new THREE.SphereGeometry(2.9, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xe9e2d0, f, { y: 3.4 }); // the dome
  kit.add(box(1.1, 2, 0.3), 0x5c3d24, f, { z: 2.75 }); // door
  kit.add(box(3.4, 0.25, 3.4), 0x8a6a48, f, { y: -0.05, ry: 0.4, ink: false }); // a porch of planks
  kit.add(cyl(0.12, 0.12, 2.2, 6), 0x5c3d24, f, { x: 3.6, z: 1.2 }); // a signpost...
  kit.add(box(1.2, 0.6, 0.12), 0xd9b27a, f, { x: 3.6, y: 1.6, z: 1.2 }); // ...with a star painted on it
  kit.add(new THREE.OctahedronGeometry(0.22), 0xffd166, f, { x: 3.6, y: 1.9, z: 1.3 });
  kit.solid(body, at, 3.1, 6.5);

  // The telescope: a brass tube on a pivot at the top of the dome.
  const scope = new THREE.Group();
  const tube = new THREE.Mesh(cyl(0.38, 0.5, 3.6, 12).translate(0, -1, 0), toon(0xc28a3a));
  const lens = new THREE.Mesh(cyl(0.52, 0.52, 0.3, 12).translate(0, 2.55, 0), toon(0x2e2a33));
  scope.add(withOutline(tube, 0.05), lens);
  const pivot = new THREE.Vector3(0, 5.6, 0).applyMatrix4(f);
  scope.position.copy(pivot);
  group.add(scope);
  const up = new THREE.Vector3(at.x, at.y, at.z).normalize();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const want = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const home = body;
  const ringo = rootOf(body).children.find((b) => b.id === 'ringo');
  const a = {}, b = {};
  let last = null;
  out.push((time, t, ctx) => {
    const dt = last === null ? 1 : Math.min(0.1, Math.max(0, time - last));
    last = time;
    if (ctx.found('find-observatory') && ringo) {
      // Point at Ringo (lifted a little if it's below the horizon, so it still looks up).
      ringo.worldPos(t, a);
      home.worldPos(t, b);
      want.set(a.x - b.x, a.y - b.y, 0).normalize();
      const e = want.dot(up);
      if (e < 0.35) want.addScaledVector(up, 0.35 - e).normalize();
    } else {
      // Idly sweeping the sky.
      const s = time * 0.15;
      want.set(Math.cos(s), 0.9, Math.sin(s)).normalize();
      want.transformDirection(f);
    }
    q.setFromUnitVectors(yAxis, want);
    scope.quaternion.slerp(q, 1 - Math.exp(-dt * 1.2));
  });
}

function rootOf(body) {
  let b = body;
  while (b.parent) b = b.parent;
  return b;
}

// Pebble: an earlier explorer's little lander base, a flag, and footprints between them.
function footprints(body, kit) {
  const at = DISCOVERY_BY_ID['find-footprints'].spots[0];
  const f = frameAt(body, at, { spin: 1.1 });
  kit.add(cyl(0.05, 0.05, 2.8, 6), 0xdedede, f); // flag pole
  kit.add(box(1.3, 0.8, 0.05), 0xf08a3c, f, { x: 0.68, y: 1.95 }); // a bright orange flag
  kit.add(box(1.3, 0.2, 0.06), 0xfff3d2, f, { x: 0.68, y: 2.2 }); // with a cream stripe
  kit.solid(body, at, 0.3, 2.8);
  // The lander's base, a few steps away: a gold box on four legs.
  const base = offset(body, at, -1.5, -7);
  const fb = frameAt(body, base, { lift: -0.1, spin: 0.3 });
  kit.add(box(1.8, 0.8, 1.8), 0xd9a441, fb, { y: 0.7 });
  for (const [x, z] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) {
    kit.add(cyl(0.07, 0.07, 1.1, 6), 0x9a9aa2, fb, { x, z, rz: x * 0.25, rx: -z * 0.25 });
    kit.add(cyl(0.25, 0.25, 0.06, 8), 0x9a9aa2, fb, { x: x * 1.2, z: z * 1.2 });
  }
  kit.solid(body, base, 1.5, 1.6);
  // Footprints wandering from the lander to the flag (left, right, left...).
  const step = new THREE.CylinderGeometry(0.13, 0.15, 0.04, 8).scale(0.75, 1, 1.4);
  const n = 16;
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const e = -1.5 * (1 - k) + Math.sin(k * 5) * 1.2 + (i % 2 ? 0.2 : -0.2);
    const no = -7 * (1 - k) + 0.3;
    const d = offset(body, at, e, no - 0.5);
    const heading = Math.atan2(1.5 + Math.cos(k * 5) * 6, 7);
    kit.add(step, 0x6f6960, frameAt(body, d, { lift: -0.01, spin: heading }), { ink: false });
  }
}

// Pebble: a laser mirror, a tilted panel of little glass cubes. It glints; once found, a laser
// flickers up to it from far away.
function mirror(body, kit, group, out) {
  const at = DISCOVERY_BY_ID['find-mirror'].spots[0];
  const f = frameAt(body, at, { spin: 2.2 });
  kit.add(box(0.2, 0.5, 0.2), 0x8d8a86, f, { z: -0.3 });
  kit.add(box(1.6, 0.12, 1.3), 0xb9b4aa, f, { y: 0.45, rx: -0.5 });
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      kit.add(box(0.3, 0.1, 0.3), 0xdff4ff, f, { x: -0.54 + i * 0.36, y: 0.52 + (j - 1) * 0.17, z: (j - 1) * 0.33, rx: -0.5, ink: false });
    }
  }
  const glint = new THREE.Sprite(mats().glow('rgba(240,252,255,1)', 'rgba(160,220,255,0)'));
  glint.position.copy(new THREE.Vector3(0, 0.9, 0).applyMatrix4(f));
  group.add(glint);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 400, 6, 1, true).translate(0, 200, 0),
    new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  beam.applyMatrix4(frameAt(body, at, { lift: 0.5 }));
  beam.visible = false;
  group.add(beam);
  out.push((time, t, ctx) => {
    const found = ctx.found('find-mirror');
    // A twinkle every couple of seconds catches the eye.
    const tw = Math.max(0, Math.sin(time * 2.6)) ** 6;
    glint.scale.setScalar(1 + tw * 3.5);
    glint.material.opacity = 0.35 + tw * 0.65;
    beam.visible = found && Math.sin(time * 1.3) > -0.2;
    beam.material.opacity = 0.35 + 0.25 * Math.sin(time * 23);
  });
}

// Dusty: an old rover asleep in the dust, its solar panels dusty. Once found, a light blinks.
function rover(body, kit, group, out) {
  const at = DISCOVERY_BY_ID['find-rover'].spots[0];
  const f = frameAt(body, at, { lift: -0.1, spin: 0.9 });
  const S = { s: 1.3 };
  const k = (geo, color, o = {}) => kit.add(geo, color, f, { ...o, x: (o.x ?? 0) * 1.3, y: (o.y ?? 0) * 1.3, z: (o.z ?? 0) * 1.3, ...S });
  k(box(1.4, 0.55, 1.1), 0xcfb49a, { y: 0.55 }); // body, dusted orange
  k(box(1.2, 0.06, 2.1), 0x8a6a58, { y: 1.12 }); // the dusty solar panel deck
  k(box(0.9, 0.05, 0.8), 0x8a6a58, { x: 1.05, y: 1.1, rz: -0.12 }); // and its wings
  k(box(0.9, 0.05, 0.8), 0x8a6a58, { x: -1.05, y: 1.1, rz: 0.12 });
  k(cyl(0.06, 0.06, 0.9, 6), 0x9a9aa2, { y: 1.1, z: 0.45 }); // camera mast...
  k(box(0.45, 0.25, 0.25), 0xe9e2d0, { y: 1.95, z: 0.45, rx: 0.35 }); // ...with a sleepy, drooping head
  for (const x of [-0.8, 0.8]) {
    for (const z of [-0.5, 0, 0.5]) k(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 10).rotateZ(Math.PI / 2).translate(0, 0.22, 0), 0x3a3336, { x, z });
  }
  kit.solid(body, at, 1.7, 2.8);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7dff9a }));
  light.position.copy(new THREE.Vector3(0.18 * 1.3, 2.18 * 1.3, 0.62 * 1.3).applyMatrix4(f));
  light.visible = false;
  group.add(light);
  out.push((time, t, ctx) => {
    light.visible = ctx.found('find-rover') && (time % 1.6) < 0.8;
  });
}

// Ducky: Philae the little lander, tipped over in a shady hollow by a big dark boulder.
function philae(body, kit) {
  const at = DISCOVERY_BY_ID['find-philae'].spots[0];
  const f = frameAt(body, at, { lift: -0.1, spin: 0.5 });
  kit.add(box(1, 0.8, 1), 0x9fa6b2, f, { y: 0.55, rz: 0.35, x: 0.2 }); // body, tipped over
  kit.add(box(1.02, 0.5, 0.05), 0x2a3f6e, f, { y: 0.7, z: 0.52, rz: 0.35, x: 0.2 }); // solar panels
  kit.add(box(0.05, 0.5, 1.02), 0x2a3f6e, f, { y: 0.8, x: -0.3, rz: 0.35 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    kit.add(cyl(0.05, 0.05, 1, 6), 0xcfd3da, f, { x: Math.cos(a) * 0.5, z: Math.sin(a) * 0.5, rz: 0.9 * Math.cos(a) + 0.35, rx: -0.9 * Math.sin(a) });
  }
  kit.add(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 5).translate(0, 1.3, 0), 0xcfd3da, f, { rz: 0.35 }); // antenna
  kit.solid(body, at, 1, 1.5);
  // The boulder that keeps it in the shade.
  const rock = offset(body, at, -3, 0.5);
  kit.add(new THREE.IcosahedronGeometry(2.6, 0).scale(1, 1.2, 0.9), 0x3a3f48, frameAt(body, rock, { lift: 0.5, spin: 0.2 }), { y: 0.6 });
  kit.solid(body, rock, 2.3, 3.4);
}

// Frosty: a faint blue glow deep in each of the fresh cracks, only at night.
function oceanGlow(body, group, out) {
  const glows = FROSTY_GLOWS.map((g) => {
    const s = new THREE.Sprite(mats().glow('rgba(140,230,255,1)', 'rgba(40,120,255,0)'));
    s.position.copy(V(groundPoint(body, g, 0.4)));
    s.scale.setScalar(7);
    group.add(s);
    return { g, s, k: 0 };
  });
  const toSun = { x: 1, y: 0, z: 0 };
  out.push((time, t) => {
    sunDirection(body, t, toSun);
    for (const [i, o] of glows.entries()) {
      const want = isNight(o.g, toSun) ? 1 : 0;
      o.k += (want - o.k) * 0.05;
      o.s.visible = o.k > 0.02;
      o.s.material.opacity = o.k * (0.55 + 0.25 * Math.sin(time * 1.7 + i * 2));
    }
  });
}

// Ember: now and then a flare, a loop of glowing gas arching up off the surface. It rises on the
// side facing the rocket when the rocket is in Ember's space (ctx.aim), so it can be seen.
function flares(body, group, out) {
  const R = body.radius;
  const H = R * 1.1, W = R * 0.3; // big, so it shows from out where it counts (FLARE.reach)
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const u = (i / 24) * Math.PI;
    pts.push(new THREE.Vector3(H * Math.sin(u) - 30, W * Math.cos(u), 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const mat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  const loop = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 120, 8), mat(0xff7a2a, 0.6));
  const inner = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 50, 8), mat(0xfff0a0, 0.9));
  loop.add(outer, inner);
  const glow = new THREE.Sprite(mats().glow('rgba(255,210,120,1)', 'rgba(255,90,30,0)'));
  glow.position.set(H * 0.6, 0, 0);
  glow.scale.setScalar(H * 1.6);
  loop.add(glow);
  loop.visible = false;
  group.add(loop);
  let number = null, aim = 0;
  out.push((time, t, ctx) => {
    const k = flareAt(t);
    loop.visible = k > 0.01;
    if (!loop.visible) return;
    const n = flareNumber(t);
    if (n !== number) {
      number = n;
      aim = ctx.aim ?? mulberry32(n * 977 + 13)() * Math.PI * 2;
    }
    const a = aim + Math.sin(time * 0.3) * 0.01;
    loop.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    loop.rotation.z = a;
    loop.scale.setScalar(0.35 + 0.65 * k);
    outer.material.opacity = 0.6 * k;
    inner.material.opacity = 0.9 * k;
    glow.material.opacity = 0.7 * k;
  });
}

/**
 * The landmarks on one world, or null: { group, obstacles, update(time, t, ctx) }, where time is
 * the scene clock, t the flight time and ctx { found(id), aim }. obstacles are
 * [{ position, up, radius, height }] like the rocks, for the buggy to bump into.
 */
export function createLandmarks(body) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const kit = new Kit();
  const updates = [];
  switch (body.id) {
    case 'homestead': observatory(body, kit, group, updates); break;
    case 'pebble': footprints(body, kit); mirror(body, kit, group, updates); break;
    case 'dusty': rover(body, kit, group, updates); break;
    case 'ducky': philae(body, kit); break;
    case 'frosty': oceanGlow(body, group, updates); break;
    case 'ember': flares(body, group, updates); break;
    default: return null;
  }
  kit.build(group);
  return {
    group,
    obstacles: kit.obstacles,
    update(time, t, ctx) {
      for (const u of updates) u(time, t, ctx);
    },
  };
}
