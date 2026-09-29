// The frontier's look (#62 stage 4): the icy-rock belt round Yonder's distance, every rock
// tumbling, and the little lander on one of the big ones. Where they are and how far they've
// turned is src/physics/frontier.js (pure, from the game clock); this draws them. Only the look:
// nothing here is a physics body.
//
// The belt is one InstancedMesh (plus its ink) per arc of the ring (`BELT.sectors`), each drawn
// round its own middle so no rock is far from its mesh's origin (the floating origin keeps the
// mesh near the camera; nothing jitters far out), and arcs off screen are culled whole. The few
// big ones are an instance each. On the zoomed-out map, where every rock is far under a pixel,
// the belt is one draw call of dots instead. Rocks close to the camera (between it and the flight
// plane) shrink away in the shader, so none hides the rocket. Each rock tumbles in the vertex shader, from its own axis, spin and
// phase (per-instance attributes) and one clock uniform, so no instance matrix is ever rewritten;
// its ink tumbles with it, and its normals turn too, so its lit side stays towards Ember. Nothing
// is allocated per frame.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonGradient, toon, withOutline } from './materials.js';
import { mulberry32 } from '../physics/noise.js';
import { BELT, BIG_ROCKS, LANDER_ROCK, ROCK_REACH, beltPlan, sectorMiddle, beltTurn, spinClock, tumbleAngle, crossers, crosserPos, crosserShown, impactor, fallPos, IMPACT } from '../physics/frontier.js';

/**
 * How it's drawn: rock colours (`ice` grey and bluish, `tholin` reddish-brown), the ink's
 * thickness (unit-rock space), when the rock meshes show (`meshTop`: the camera no higher over
 * the plane than this; `band`: within this much of the belt, plus 1.2 times the camera's height),
 * a floor on a rock's size on screen (`minPx` pixels across, growing at most `maxGrow` times and
 * never into the clear slab: `beltGrow()`), rocks near the camera shrinking away (`near`: from
 * this share of the camera's height over the plane to that, `nearFade()`), the map's dots (`dots`: shown from `dotsFrom` to `dotsFull` of the map camera's height, pixel
 * `dotSize`, `dotOpacity`), and the lander: how tall (`lander`, metres), where on its rock's
 * unit shape it stands (`landerAt`), and its light's blink (`blink`: seconds a flash).
 */
export const BELT_LOOK = {
  ice: [0xdde5ee, 0xbcc8d4, 0xa3afbd, 0xd0dff0], tholin: [0xc07a5a, 0xa8654c, 0xcf9270],
  ink: 0.07, meshTop: 30000, band: 3000, minPx: 5, maxGrow: 10, near: [0.3, 0.6],
  dotsFrom: 14000, dotsFull: 40000, dotSize: 2, dotOpacity: 0.4,
  lander: 10, landerAt: [0.25, 1, 0.35], blink: 1.4,
};

/**
 * The belt's vertex shader, on top of three.js's: each rock tumbles about its own axis (`fcAxis`,
 * `fcSpin`: turns a second and phase; `fcTime` the time since the last whole BELT.spinT, so the
 * angle keeps its precision), after its instance's shape and before the arc's turn, and so do its
 * normals; it shrinks away close to the camera (`fcNear`, metres: `nearFade()`), so a rock between
 * the camera and the flight plane never hides the rocket; and it's never smaller than a few pixels,
 * nor grown into the clear slab round the plane (`fcSlab`; `beltGrow()`).
 * `push`: the ink's thickness, pushed out along the normal first.
 */
function beltShader(shader, uniforms, push = 0) {
  shader.uniforms.fcNear = uniforms.fcNear;
  shader.uniforms.fcSlab = uniforms.fcSlab;
  shader.uniforms.fcGrow = uniforms.fcGrow;
  shader.uniforms.fcTime = uniforms.fcTime;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
uniform vec2 fcNear;
uniform float fcSlab;
uniform vec3 fcGrow;
uniform float fcTime;
attribute vec3 fcAxis;
attribute vec2 fcSpin;
vec3 fcTurn(vec3 v) {
  float a = fcSpin.y + fcSpin.x * fcTime;
  float c = cos(a), s = sin(a);
  return v * c + cross(fcAxis, v) * s + fcAxis * dot(fcAxis, v) * (1.0 - c);
}`)
    .replace('#include <defaultnormal_vertex>', `vec3 transformedNormal = objectNormal;
  mat3 fcIm = mat3(instanceMatrix);
  transformedNormal /= vec3(dot(fcIm[0], fcIm[0]), dot(fcIm[1], fcIm[1]), dot(fcIm[2], fcIm[2]));
  transformedNormal = normalMatrix * fcTurn(fcIm * transformedNormal);`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
${push ? `transformed += normalize(normal) * ${push.toFixed(3)};` : ''}
  vec4 fcMid = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float fcDist = length(fcMid.xyz - cameraPosition);
  transformed *= smoothstep(fcNear.x, fcNear.y, fcDist);
  // Never smaller on screen than a few pixels (beltGrow()): far off, a speck, not nothing; but
  // never grown into the clear slab round the flight plane.
  float fcSize = length(instanceMatrix[0].xyz) * length(modelMatrix[0].xyz);
  float fcSlabGrow = max(1.0, (abs(fcMid.z) - fcSlab) / (${ROCK_REACH.toFixed(2)} * fcSize));
  transformed *= clamp(fcGrow.x * fcDist * fcGrow.y / fcSize, 1.0, min(fcGrow.z, fcSlabGrow));`)
    .replace('#include <project_vertex>', `vec3 fcC = instanceMatrix[3].xyz;
  vec4 mvPosition = vec4(fcC + fcTurn((instanceMatrix * vec4(transformed, 1.0)).xyz - fcC), 1.0);
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;`);
}

function beltMaterials() {
  const uniforms = {
    fcNear: { value: new THREE.Vector2(0, 0) }, fcSlab: { value: BELT.slab },
    // (the smallest size on screen in pixels, metres per pixel per metre away, the most it grows)
    fcGrow: { value: new THREE.Vector3(BELT_LOOK.minPx, 0.002, BELT_LOOK.maxGrow) },
    fcTime: { value: 0 },
  };
  // A little light of its own, so the side away from far-off Ember still reads against the dark sky.
  const rock = toon(0xffffff, { emissive: 0x1e2533 });
  rock.onBeforeCompile = (s) => beltShader(s, uniforms);
  rock.customProgramCacheKey = () => 'belt-rock';
  const ink = new THREE.MeshBasicMaterial({ color: 0x2a1d17, side: THREE.BackSide });
  ink.onBeforeCompile = (s) => beltShader(s, uniforms, BELT_LOOK.ink);
  ink.customProgramCacheKey = () => 'belt-ink';
  return { rock, ink, uniforms };
}

/** A lumpy low-poly rock (unit size), faceted, and the smooth-normalled copy its ink needs. */
function lump(seed, detail = 0, squash = 1) {
  let g = new THREE.IcosahedronGeometry(0.5, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const rand = mulberry32(seed);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = 0.78 + rand() * 0.4;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * squash, pos.getZ(i) * k);
  }
  return g;
}

function faceted(g) {
  const f = g.toNonIndexed();
  f.computeVertexNormals();
  const ink = g.clone();
  ink.computeVertexNormals();
  return { geo: f, ink };
}

/** Two lumps stuck together, like Arrokoth (the snowman New Horizons flew past in 2019). */
function snowman() {
  const a = lump(31, 1, 0.8), b = lump(32, 1, 0.85);
  a.scale(1, 1, 1).translate(-0.28, 0, 0);
  b.scale(0.72, 0.72, 0.72).translate(0.36, 0.02, 0);
  // One shell for the ink: merge the two (their overlap is hidden inside).
  const pa = a.attributes.position.array, pb = b.attributes.position.array;
  const ia = a.index.array, ib = b.index.array;
  const pos = new Float32Array(pa.length + pb.length);
  pos.set(pa, 0);
  pos.set(pb, pa.length);
  const idx = new Uint32Array(ia.length + ib.length);
  idx.set(ia, 0);
  const off = pa.length / 3;
  for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + off;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

let kit = null;
function frontierKit() {
  if (kit) return kit;
  const mats = beltMaterials();
  kit = {
    ...mats,
    small: faceted(lump(62, 0)),
    round: faceted(lump(63, 1)),
    egg: faceted((() => { const g = lump(64, 1); g.scale(1.7, 0.8, 0.9); return g; })()),
    snowman: faceted(snowman()),
  };
  return kit;
}

const col = new THREE.Color();
function rockColour(tint, shade, out = col) {
  const L = BELT_LOOK;
  if (tint > 0.5) out.set(L.tholin[Math.floor(shade * L.tholin.length) % L.tholin.length]);
  else out.set(L.ice[Math.floor(shade * L.ice.length) % L.ice.length]);
  return out.offsetHSL(0, 0, (shade - 0.5) * 0.08);
}

/** A geometry sharing `g`'s vertices, with its own tumble attributes (per instance). */
function withTumble(g, axis, spin) {
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) out.setAttribute(name, g.attributes[name]);
  if (g.index) out.setIndex(g.index);
  out.boundingSphere = g.boundingSphere;
  out.setAttribute('fcAxis', axis);
  out.setAttribute('fcSpin', spin);
  return out;
}

/**
 * One instanced mesh (plus ink sharing its matrices and tumbles) of `n` rocks of one shape. Its
 * tumbles (`tumble(j, axis, spin, phase)`) are per-instance attributes the shader reads.
 */
function instanced(shape, n) {
  const k = frontierKit();
  const axis = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const spin = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
  const mesh = new THREE.InstancedMesh(withTumble(shape.geo, axis, spin), k.rock, n);
  const ink = new THREE.InstancedMesh(withTumble(shape.ink, axis, spin), k.ink, n);
  mesh.userData.tumble = (j, ax, turns, phase) => {
    axis.setXYZ(j, ax[0], ax[1], ax[2]);
    spin.setXY(j, (2 * Math.PI * turns) / BELT.spinT, phase);
  };
  ink.instanceMatrix = mesh.instanceMatrix;
  ink.userData.isOutline = true;
  ink.raycast = () => {};
  mesh.add(ink);
  return mesh;
}

/**
 * How much a rock `size` metres across, `dist` metres from the camera, is grown so it's never
 * under `minPx` pixels across (at most `maxGrow` times). `perPx`: metres per pixel per metre away
 * (2 tan(fov / 2) / the screen's height). The belt's shader works out the same.
 */
export function beltGrow(size, dist, perPx, z = Infinity, L = BELT_LOOK) {
  const slab = Math.max(1, (Math.abs(z) - BELT.slab) / (ROCK_REACH * size));
  return Math.max(1, Math.min((L.minPx * dist * perPx) / size, L.maxGrow, slab));
}

/**
 * How much of a rock `dist` metres from the camera is drawn (0..1), with the camera `camHeight`
 * over the flight plane: rocks right by the camera (so between it and the plane) shrink away. The
 * belt's shader works out the same (its `fcNear`).
 */
export function nearFade(dist, camHeight, L = BELT_LOOK) {
  const a = L.near[0] * camHeight, b = L.near[1] * camHeight;
  const k = Math.max(0, Math.min(1, (dist - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

/**
 * The belt: `arcs` (one instanced mesh each, round its middle at t = 0), the big ones (`big`, an
 * instance each) and the map's dots (`dots`). update() places them for a frame.
 */
export function createBelt(system) {
  crossers(system); // (the crossers' orbits are set from the worlds' once)
  const group = new THREE.Group();
  group.name = 'belt';
  const rocks = beltPlan();
  const k = frontierKit();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const arcs = [];
  for (let i = 0; i < BELT.sectors; i++) {
    const mid = sectorMiddle(i);
    const mine = rocks.filter((r) => r.sector === i);
    const mesh = instanced(k.small, mine.length);
    mine.forEach((r, j) => {
      q.set(...r.turn);
      p.set(r.x - mid.x, r.y - mid.y, r.z);
      s.set(r.size * r.stretch[0], r.size * r.stretch[1], r.size * r.stretch[2]);
      mesh.setMatrixAt(j, m.compose(p, q, s));
      mesh.setColorAt(j, rockColour(r.tint, r.shade));
      mesh.userData.tumble(j, r.axis, r.spin, r.phase);
    });
    mesh.computeBoundingSphere();
    mesh.children[0].computeBoundingSphere();
    mesh.userData.mid = mid;
    group.add(mesh);
    arcs.push(mesh);
  }
  const big = BIG_ROCKS.map((b, i) => {
    const mesh = instanced(k[b.kind], 1);
    q.setFromEuler(new THREE.Euler(0.4 + i, 0.9 * i, 0.3 * i));
    mesh.setMatrixAt(0, m.compose(p.set(0, 0, 0), q, s.setScalar(b.size)));
    mesh.setColorAt(0, rockColour(b.tint ? 1 : 0, (i * 0.37) % 1));
    mesh.userData.tumble(0, b.axis, b.spin, b.phase);
    mesh.userData.base = q.clone(); // (its shape's turn, before the tumble: the lander needs it)
    mesh.computeBoundingSphere();
    mesh.children[0].computeBoundingSphere();
    mesh.userData.at = { x: b.r * Math.cos(b.a), y: b.r * Math.sin(b.a), z: b.z };
    group.add(mesh);
    return mesh;
  });

  // The map's dots: every rock (the big ones a little brighter), round Ember.
  const n = rocks.length + BIG_ROCKS.length;
  const pos = new Float32Array(n * 3), cols = new Float32Array(n * 3);
  rocks.forEach((r, i) => {
    pos.set([r.x, r.y, r.z], i * 3);
    rockColour(r.tint, r.shade).multiplyScalar(0.8).toArray(cols, i * 3);
  });
  BIG_ROCKS.forEach((b, i) => {
    const j = rocks.length + i;
    pos.set([b.r * Math.cos(b.a), b.r * Math.sin(b.a), b.z], j * 3);
    rockColour(b.tint ? 1 : 0, 0.5).toArray(cols, j * 3);
  });
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const dots = new THREE.Points(dg, new THREE.PointsMaterial({
    size: BELT_LOOK.dotSize, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false,
  }));
  dots.frustumCulled = false;
  dots.visible = false;
  dots.name = 'belt-dots';

  // The crossers (#62 stage 4): an instance each, placed from their own orbits every frame.
  const cross = crossers(null).map((c, i) => {
    const mesh = instanced(k.small, 1);
    q.setFromEuler(new THREE.Euler(1.1 * i, 0.7 + i, 0.4 * i));
    mesh.setMatrixAt(0, m.compose(p.set(0, 0, 0), q, s.set(c.size, c.size * 0.8, c.size * 0.9)));
    mesh.setColorAt(0, rockColour(c.tint, (i * 0.29) % 1));
    mesh.userData.tumble(0, c.axis, c.spin, c.phase);
    mesh.computeBoundingSphere();
    mesh.children[0].computeBoundingSphere();
    group.add(mesh);
    return mesh;
  });

  // The falls onto Yonder and Hither (#62 stage 4, IMPACT): a few pooled rocks (never more than
  // two falling at once), each given its fall's size every frame.
  const falls = [0, 1, 2].map((i) => {
    const mesh = instanced(k.small, 1);
    q.setFromEuler(new THREE.Euler(0.3 + i, 1.2 * i, 0.5));
    mesh.setMatrixAt(0, m.compose(p.set(0, 0, 0), q, s.set(1, 0.8, 0.9)));
    mesh.setColorAt(0, rockColour(i === 1 ? 1 : 0, 0.3 + 0.2 * i));
    mesh.userData.tumble(0, [0.6, 0.64, 0.48], 80 + 20 * i, i);
    mesh.computeBoundingSphere();
    mesh.children[0].computeBoundingSphere();
    mesh.frustumCulled = false; // (its size changes: the unit bounds wouldn't do)
    mesh.children[0].frustumCulled = false;
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  });

  return { group, arcs, big, cross, falls, dots, uniforms: k.uniforms };
}

/**
 * The little lander (like MASCOT on Ryugu, or Philae): a white box body with dark blue solar
 * panels on its sides, three splayed gold legs with round feet, a little antenna with a ball on
 * top and a red light that blinks. About `BELT_LOOK.lander` metres tall (its rock is 60 m across),
 * ink on every closed part. Its feet are at its origin, "up" along +y.
 */
export function createLander() {
  const group = new THREE.Group();
  group.name = 'lander';
  const h = BELT_LOOK.lander / 7; // designed 7 m tall
  const white = toon(0xf2f0ea), panel = toon(0x2d4f9e), gold = toon(0xe8b54a), grey = toon(0x8f98a6);
  const add = (geo, mat, x, y, z, ink = 0.12) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x * h, y * h, z * h);
    mesh.scale.setScalar(h);
    if (ink) withOutline(mesh, ink);
    group.add(mesh);
    return mesh;
  };
  // Legs: from under the body out and down to round feet on the ground.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const leg = add(new THREE.CylinderGeometry(0.16, 0.16, 3.1, 6), gold, Math.cos(a) * 1.35, 1.3, Math.sin(a) * 1.35, 0.06);
    leg.rotation.set(0, -a, 0.75);
    leg.rotation.order = 'YZX';
    add(new THREE.CylinderGeometry(0.5, 0.55, 0.2, 10), gold, Math.cos(a) * 2.35, 0.1, Math.sin(a) * 2.35, 0.06);
  }
  add(new THREE.BoxGeometry(3.2, 2.2, 3.2), white, 0, 3.4, 0);
  // Solar panels on the four sides (thin boxes, just proud of the body).
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const p = add(new THREE.BoxGeometry(2.6, 1.7, 0.12), panel, Math.sin(a) * 1.63, 3.4, Math.cos(a) * 1.63, 0.05);
    p.rotation.y = a;
  }
  add(new THREE.BoxGeometry(2.4, 0.3, 2.4), grey, 0, 4.65, 0, 0.06); // a lid
  add(new THREE.CylinderGeometry(0.09, 0.09, 1.8, 6), grey, 0.7, 5.6, -0.6, 0.04);
  add(new THREE.SphereGeometry(0.3, 10, 8), white, 0.7, 6.55, -0.6, 0.05);
  // The light: red, blinking (drawn bright, no lighting, so it shows on the dark side too).
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.28 * h, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
  light.position.set(-0.9 * h, 4.95 * h, 0.9 * h);
  group.add(light);
  group.visible = false;
  return { group, light };
}

/**
 * Where on the lander's rock (in the rock mesh's own frame: its shape turned and scaled, before
 * the tumble) the lander stands, and which way is up there: a ray down onto the unit rock's facets
 * along `BELT_LOOK.landerAt`, into { at: Vector3, up: Vector3 }.
 */
function landerSpot(rockMesh, size) {
  const shape = frontierKit()[LANDER_ROCK.kind].geo;
  const d = new THREE.Vector3(...BELT_LOOK.landerAt).normalize();
  const ray = new THREE.Raycaster(d.clone().multiplyScalar(2), d.clone().negate());
  const hit = ray.intersectObject(new THREE.Mesh(shape, new THREE.MeshBasicMaterial()), false)[0];
  const base = rockMesh.userData.base;
  const at = hit.point.clone().multiplyScalar(size).applyQuaternion(base);
  const up = hit.face.normal.clone().applyQuaternion(base).normalize();
  return { at, up };
}

/**
 * Are the belt's rock meshes drawn? Not while driving; only with the camera low enough over the
 * plane (`camHeight`) and near the ring (`rho`: its distance from Ember in the plane). So from
 * the start (Homestead, 12,000 out) and anywhere inside Tumble's orbit they're never drawn.
 */
export function beltShown(mode, camHeight, rho, L = BELT_LOOK) {
  const reach = L.band + 1.2 * camHeight; // (about how far the view reaches sideways from that height)
  return mode !== 'drive' && camHeight < L.meshTop && rho > BELT.inner - reach && rho < BELT.outer + reach;
}

/** How much the map's dots show (0..1): only on the map, zoomed out. */
export function dotsShown(mode, camHeight, L = BELT_LOOK) {
  return mode === 'map' ? Math.max(0, Math.min(1, (camHeight - L.dotsFrom) / (L.dotsFull - L.dotsFrom))) : 0;
}

/**
 * The frontier for the flight scene: the belt and the lander, placed each frame by `update()`.
 * `lander.up` is the lander's "up" in the scene after the last update (for seeing it).
 */
export function createFrontier(system) {
  const belt = createBelt(system);
  const lander = createLander();
  const crossList = crossers(system), at = { x: 0, y: 0, z: 0 };
  const fall = { hit: {} };
  const rock = belt.big[BIG_ROCKS.indexOf(LANDER_ROCK)];
  const spot = landerSpot(rock, LANDER_ROCK.size);
  const Y = new THREE.Vector3(0, 1, 0);
  const stand = new THREE.Quaternion().setFromUnitVectors(Y, spot.up);
  const tumble = new THREE.Quaternion(), qz = new THREE.Quaternion(), ax = new THREE.Vector3(...LANDER_ROCK.axis);
  const Z = new THREE.Vector3(0, 0, 1), off = new THREE.Vector3();
  lander.up = new THREE.Vector3();
  const L = BELT_LOOK;
  return {
    belt, lander, rock, spot, system,
    /**
     * Place it all for a frame. ctx: { t (game time), time (the scene's clock), origin, camera,
     * mode ('flight' / 'map' / 'drive'), camWorld ({ x, y }: the camera over the plane, world
     * coordinates), camHeight (how high over the plane), yonder (Yonder's visual group, or null),
     * viewH (the screen's height in pixels) }.
     */
    update(ctx) {
      const { t, origin, mode } = ctx;
      // The belt: meshes when the camera is low enough and near the ring; the map's dots far out.
      const turn = beltTurn(system, t);
      const c = Math.cos(turn), s = Math.sin(turn);
      const meshes = beltShown(mode, ctx.camHeight, Math.hypot(ctx.camWorld.x, ctx.camWorld.y));
      belt.group.visible = meshes;
      lander.group.visible = meshes;
      if (meshes) {
        for (const a of belt.arcs) {
          const m = a.userData.mid;
          a.position.set(c * m.x - s * m.y - origin.x, s * m.x + c * m.y - origin.y, 0);
          a.rotation.z = turn;
        }
        for (const b of belt.big) {
          const m = b.userData.at;
          b.position.set(c * m.x - s * m.y - origin.x, s * m.x + c * m.y - origin.y, m.z);
          b.rotation.z = turn;
        }
        belt.uniforms.fcTime.value = spinClock(t);
        belt.uniforms.fcGrow.value.y = (2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov / 2))) / ctx.viewH;
        belt.uniforms.fcNear.value.set(L.near[0] * ctx.camHeight, L.near[1] * ctx.camHeight);
        // The crossers: where their own orbits have them, unless one is gone after reaching a world.
        for (let i = 0; i < crossList.length; i++) {
          const m = belt.cross[i];
          crosserPos(crossList[i], t, at);
          m.position.set(at.x - origin.x, at.y - origin.y, at.z);
          m.visible = crosserShown(system, crossList[i], t);
        }
        // The falls: the ones coming down now, each in the mesh of its slot.
        for (const m of belt.falls) m.visible = false;
        for (let kk = Math.floor(t / IMPACT.gap) - 1; kk <= Math.floor(t / IMPACT.gap) + 1; kk++) {
          if (!fallPos(impactor(system, kk, fall), t, at)) continue;
          const m = belt.falls[((kk % 3) + 3) % 3];
          m.visible = true;
          m.position.set(at.x - origin.x, at.y - origin.y, at.z);
          m.scale.setScalar(fall.size);
        }
        // The lander rides its rock: the rock's place, the belt's turn, then its tumble (the same
        // sums as the shader's), then where it stands on the rock.
        tumble.setFromAxisAngle(ax, tumbleAngle(LANDER_ROCK.spin, LANDER_ROCK.phase, t));
        qz.setFromAxisAngle(Z, turn).multiply(tumble);
        off.copy(spot.at).applyQuaternion(qz);
        lander.group.position.copy(rock.position).add(off);
        lander.group.quaternion.copy(qz).multiply(stand);
        lander.up.copy(spot.up).applyQuaternion(qz);
        lander.light.visible = (ctx.time % L.blink) < 0.35 * L.blink;
      }
      const dots = dotsShown(mode, ctx.camHeight);
      belt.dots.visible = dots > 0;
      if (dots > 0) {
        belt.dots.position.set(-origin.x, -origin.y, 0);
        belt.dots.rotation.z = turn;
        belt.dots.material.opacity = dots * L.dotOpacity;
      }
    },
  };
}
