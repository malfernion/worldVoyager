// The frontier's look (#62 stage 4): the icy-rock belt round Yonder's distance and the probe
// flying past Yonder. Where they are is src/physics/frontier.js (pure, from the game clock); this
// draws them. Only the look: nothing here is a physics body.
//
// The belt is one InstancedMesh (plus its ink) per arc of the ring (`BELT.sectors`), each drawn
// round its own middle so no rock is far from its mesh's origin (the floating origin keeps the
// mesh near the camera; nothing jitters far out), and arcs off screen are culled whole. The few
// big ones are an instance each. On the zoomed-out map, where every rock is far under a pixel,
// the belt is one draw call of dots instead. Near Yonder the rocks shrink away in the shader
// (`beltClear()`'s sums). Nothing is allocated per frame.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonGradient, toon, withOutline } from './materials.js';
import { glintTexture } from './planets.js';
import { mulberry32 } from '../physics/noise.js';
import { BELT, BIG_ROCKS, beltPlan, sectorMiddle, beltTurn, probeAt, PROBE } from '../physics/frontier.js';

/**
 * How it's drawn: rock colours (`ice` grey and bluish, `tholin` reddish-brown), the ink's
 * thickness (unit-rock space), when the rock meshes show (`meshTop`: the camera no higher over
 * the plane than this; `band`: within this much of the belt, plus 1.2 times the camera's height),
 * a floor on a rock's size on screen (`minPx` pixels across, growing at most `maxGrow` times:
 * `beltGrow()`), the map's dots (`dots`: shown from `dotsFrom` to `dotsFull` of the map camera's height, pixel
 * `dotSize`, `dotOpacity`), and the probe's glint (`glint`: its size on screen, a share of the
 * view's height; seen within `glintFar` metres; gone once the probe is `glintPx` pixels across).
 */
export const BELT_LOOK = {
  ice: [0xdde5ee, 0xbcc8d4, 0xa3afbd, 0xd0dff0], tholin: [0xc07a5a, 0xa8654c, 0xcf9270],
  ink: 0.07, meshTop: 30000, band: 3000, minPx: 5, maxGrow: 10,
  dotsFrom: 14000, dotsFull: 40000, dotSize: 2, dotOpacity: 0.4,
  glint: 0.045, glintFar: 40000, glintPx: 14,
};

/**
 * Shrinks a rock away near Yonder (BELT.clear; frontier.js `beltClear()` is the same sum). The
 * rock's middle in the scene is the model matrix times its instance's; `fcAt` is Yonder's middle
 * in the scene.
 */
function clearShader(shader, uniforms, push = 0) {
  shader.uniforms.fcAt = uniforms.fcAt;
  shader.uniforms.fcClear = uniforms.fcClear;
  shader.uniforms.fcGrow = uniforms.fcGrow;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform vec3 fcAt;\nuniform vec2 fcClear;\nuniform vec3 fcGrow;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
${push ? `transformed += normalize(normal) * ${push.toFixed(3)};` : ''}
#ifdef USE_INSTANCING
  vec4 fcMid = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
#else
  vec4 fcMid = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
#endif
  transformed *= smoothstep(fcClear.x, fcClear.y, length(fcMid.xy - fcAt.xy));
  // Never smaller on screen than a few pixels (beltGrow()): far off, a speck, not nothing.
#ifdef USE_INSTANCING
  float fcSize = length(instanceMatrix[0].xyz) * length(modelMatrix[0].xyz);
#else
  float fcSize = length(modelMatrix[0].xyz);
#endif
  float fcDist = length(fcMid.xyz - cameraPosition);
  transformed *= clamp(fcGrow.x * fcDist * fcGrow.y / fcSize, 1.0, fcGrow.z);`);
}

function beltMaterials() {
  const uniforms = {
    fcAt: { value: new THREE.Vector3(1e9, 1e9, 0) }, fcClear: { value: new THREE.Vector2(...BELT.clear) },
    // (the smallest size on screen in pixels, metres per pixel per metre away, the most it grows)
    fcGrow: { value: new THREE.Vector3(BELT_LOOK.minPx, 0.002, BELT_LOOK.maxGrow) },
  };
  // A little light of its own, so the side away from far-off Ember still reads against the dark sky.
  const rock = toon(0xffffff, { emissive: 0x1e2533 });
  rock.onBeforeCompile = (s) => clearShader(s, uniforms);
  rock.customProgramCacheKey = () => 'belt-rock';
  const ink = new THREE.MeshBasicMaterial({ color: 0x2a1d17, side: THREE.BackSide });
  ink.onBeforeCompile = (s) => clearShader(s, uniforms, BELT_LOOK.ink);
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

/** One instanced mesh (plus ink sharing its matrices) of `n` rocks of one shape. */
function instanced(shape, n) {
  const k = frontierKit();
  const mesh = new THREE.InstancedMesh(shape.geo, k.rock, n);
  const ink = new THREE.InstancedMesh(shape.ink, k.ink, n);
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
export function beltGrow(size, dist, perPx, L = BELT_LOOK) {
  return Math.min(L.maxGrow, Math.max(1, (L.minPx * dist * perPx) / size));
}

/**
 * The belt: `arcs` (one instanced mesh each, round its middle at t = 0), the big ones (`big`, an
 * instance each) and the map's dots (`dots`). update() places them for a frame.
 */
export function createBelt() {
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

  return { group, arcs, big, dots, uniforms: k.uniforms };
}

/**
 * The probe, like New Horizons: a gold, triangular body, a big white dish (closed underneath, so
 * its ink has no hole), the little feed on the dish, and the dark power stick with fins out of
 * one corner. About 12 m across (the rocket is about 6 m tall): a cartoon, big enough to see.
 * Its dish is along +z in `turn`; a glint (a steady size on screen) shows it as a moving star
 * from further away.
 */
export function createProbe() {
  const group = new THREE.Group();
  group.name = 'probe';
  const turn = new THREE.Group();
  group.add(turn);
  const gold = toon(0xf5c85a), white = toon(0xf4f1ea), dark = toon(0x3b3d4a), grey = toon(0x9aa3ae);
  const add = (geo, mat, x, y, z, ink = 0.22) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (ink) withOutline(mesh, ink);
    turn.add(mesh);
    return mesh;
  };
  // The body: a thick triangle (three sides), flat faces for the toon look.
  const body = new THREE.CylinderGeometry(3.2, 3.2, 2.2, 3, 1);
  body.rotateX(Math.PI / 2);
  add(body, gold, 0, 0, 0);
  // A box of instruments on one side.
  add(new THREE.BoxGeometry(1.8, 1.4, 1.6), grey, -1.2, -1.6, 0.2, 0.1);
  // The dish: a wide shallow cone, open side facing out (+z), closed at the back.
  const dish = new THREE.CylinderGeometry(2.7, 0.9, 1.1, 24, 1);
  dish.rotateX(Math.PI / 2);
  add(dish, white, 0.4, 0.3, 1.65);
  add(new THREE.CylinderGeometry(0.16, 0.16, 1.5, 8), grey, 0.4, 0.3, 2.8, 0.06).rotation.x = Math.PI / 2;
  add(new THREE.SphereGeometry(0.35, 10, 8), white, 0.4, 0.3, 3.55, 0.08);
  // The power stick (an RTG), out of one corner, with fins.
  const stick = add(new THREE.CylinderGeometry(0.55, 0.55, 4.2, 10), dark, 3.9, 1.9, -0.2);
  stick.rotation.z = -Math.PI / 3;
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.4, 1.8), dark);
    fin.rotation.y = (i * Math.PI) / 4;
    stick.add(fin);
  }

  const glint = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glintTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: false, opacity: 0,
  }));
  glint.scale.setScalar(BELT_LOOK.glint);
  glint.visible = false;
  group.add(glint);
  group.visible = false;
  return { group, turn, glint };
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
 * The frontier for the flight scene: the belt and the probe, placed each frame by `update()`.
 * Also keeps where the probe is (`probe.at`, probeAt()'s answer) for finding it.
 */
export function createFrontier(system) {
  const belt = createBelt();
  const probe = createProbe();
  const at = {};
  const tmp = { x: 0, y: 0 };
  const zAxis = new THREE.Vector3(0, 0, 1), aim = new THREE.Vector3();
  const L = BELT_LOOK;
  return {
    belt, probe, at, system,
    /**
     * Place it all for a frame. ctx: { t (game time), time (the scene's clock), origin, camera,
     * mode ('flight' / 'map' / 'drive'), camWorld ({ x, y }: the camera over the plane, world
     * coordinates), camHeight (how high over the plane), yonder (Yonder's visual group, or null),
     * viewH (the screen's height in pixels) }.
     */
    update(ctx) {
      const { t, origin, mode } = ctx;
      const drive = mode === 'drive';
      // The belt: meshes when the camera is low enough and near the ring; the map's dots far out.
      const turn = beltTurn(system, t);
      const c = Math.cos(turn), s = Math.sin(turn);
      const meshes = beltShown(mode, ctx.camHeight, Math.hypot(ctx.camWorld.x, ctx.camWorld.y));
      belt.group.visible = meshes;
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
        belt.uniforms.fcGrow.value.y = (2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov / 2))) / ctx.viewH;
        const y = ctx.yonder;
        if (y) belt.uniforms.fcAt.value.set(y.position.x, y.position.y, 0);
        else belt.uniforms.fcAt.value.set(1e9, 1e9, 0);
      }
      const dots = dotsShown(mode, ctx.camHeight);
      belt.dots.visible = dots > 0;
      if (dots > 0) {
        belt.dots.position.set(-origin.x, -origin.y, 0);
        belt.dots.rotation.z = turn;
        belt.dots.material.opacity = dots * L.dotOpacity;
      }

      // The probe: where the pass has it now; hidden while driving and when far from the camera.
      const p = probeAt(system, t, at);
      const g = probe.group;
      const far = Math.hypot(p.x - ctx.camWorld.x, p.y - ctx.camWorld.y, ctx.camHeight - p.z);
      g.visible = !drive && p.k > 0.001 && far < L.glintFar;
      if (!g.visible) return;
      g.position.set(p.x - origin.x, p.y - origin.y, p.z);
      g.scale.setScalar(p.k);
      // The dish faces back towards Ember (home), tipped up to the cameras so its round face shows,
      // and the probe turns slowly about it.
      tmp.x = -p.x; tmp.y = -p.y;
      const l = Math.hypot(tmp.x, tmp.y) || 1;
      aim.set((tmp.x / l) * 0.6, (tmp.y / l) * 0.6, 0.8).normalize();
      probe.turn.quaternion.setFromUnitVectors(zAxis, aim);
      probe.turn.rotateZ(ctx.time * 0.15);
      // The glint: a twinkling star while it's small on screen, gone as the probe grows.
      const px = (PROBE.radius * 2 * ctx.viewH) / (2 * Math.max(far, 1) * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov / 2)));
      const gl = Math.max(0, Math.min(1, 1 - (px - L.glintPx * 0.4) / (L.glintPx * 0.6))) * p.k;
      probe.glint.visible = gl > 0.01;
      probe.glint.material.opacity = gl * (0.75 + 0.25 * Math.sin(ctx.time * 5.3));
    },
  };
}
