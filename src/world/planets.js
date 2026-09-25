// Planet, moon and star visuals. Terrain comes from the same functions the physics uses,
// and after meshing we rebuild the physics surface from the exact mesh cross-section so
// the rocket's feet touch exactly what you see.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonGradient, glowTexture, woodTexture, toon, withOutline } from './materials.js';
import { createAmbient } from './ambient.js';
import { createForest } from './trees.js';
import { createRocks } from './rocks.js';
import { createLandmarks } from './landmarks.js';
import { SPIN_AXES, SIZZLE_VENTS, DUSTY_VOLCANO, FLIP_GEYSERS, DUCKY_JETS, OBSERVATORY } from '../physics/terrain.js';
import { discoveriesOn } from '../physics/discoveries.js';
import { friendsOn } from '../physics/friends.js';
import { mulberry32 } from '../physics/noise.js';

const DETAIL = { homestead: 64, pebble: 28, dusty: 48, nibble: 16, sizzle: 32, frosty: 36, flip: 32, ducky: 20 };

function terrainGeometry(body) {
  let geo = new THREE.IcosahedronGeometry(1, DETAIL[body.id] ?? 24);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const t = body.terrainFn;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const l = Math.hypot(x, y, z);
    x /= l; y /= l; z /= l;
    const h = t.height(x, y, z);
    const r = body.radius + h;
    pos.setXYZ(i, x * r, y * r, z * r);
    const c = t.color(x, y, z, h);
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Replace the physics surface table with the mesh's exact slice through z = 0. */
function surfaceFromMesh(body, geo) {
  const N = body.surface.length - 1;
  const table = new Float32Array(N + 1);
  const p = geo.attributes.position.array;
  const idx = geo.index.array;
  const TWO_PI = Math.PI * 2;
  const pts = [];
  for (let f = 0; f < idx.length; f += 3) {
    pts.length = 0;
    for (let e = 0; e < 3; e++) {
      const a = idx[f + e] * 3, b = idx[f + ((e + 1) % 3)] * 3;
      const za = p[a + 2], zb = p[b + 2];
      if ((za < 0) === (zb < 0)) continue;
      const t = za / (za - zb);
      pts.push(p[a] + (p[b] - p[a]) * t, p[a + 1] + (p[b + 1] - p[a + 1]) * t);
    }
    if (pts.length < 4) continue;
    const [x1, y1, x2, y2] = pts;
    let a1 = Math.atan2(y1, x1), a2 = Math.atan2(y2, x2);
    if (a2 - a1 > Math.PI) a2 -= TWO_PI;
    if (a1 - a2 > Math.PI) a1 -= TWO_PI;
    const lo = Math.min(a1, a2), hi = Math.max(a1, a2);
    const ex = x2 - x1, ey = y2 - y1;
    const cross = x1 * ey - y1 * ex;
    for (let i = Math.ceil((lo / TWO_PI) * N); i <= Math.floor((hi / TWO_PI) * N); i++) {
      const ang = (i / N) * TWO_PI;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-9) continue;
      const r = cross / denom;
      const k = ((i % N) + N) % N;
      if (r > table[k]) table[k] = r;
    }
  }
  for (let i = 0; i < N; i++) if (table[i] > 0) body.surface[i] = table[i];
  body.surface[N] = body.surface[0];
  body.updateSurfaceBounds();
}

function atmosphere(radius, color, strength = 1.2) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(color) },
      sunDir: { value: new THREE.Vector3(1, 0, 0) },
      strength: { value: strength },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vN;
      varying vec3 vP;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vP = mv.xyz;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 color;
      uniform vec3 sunDir;
      uniform float strength;
      varying vec3 vN;
      varying vec3 vP;
      void main() {
        #include <logdepthbuf_fragment>
        float rim = 1.0 - abs(dot(normalize(-vP), vN));
        float day = 0.25 + 0.75 * smoothstep(-0.3, 0.5, dot(vN, sunDir));
        float a = pow(rim, 2.6) * strength * day;
        gl_FragColor = vec4(color * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 40), mat);
  m.userData.atmosphere = true;
  return m;
}

// Ringo's rings are wide, bright ice. Faint rings (Tumble, like Uranus's) are a few thin grey-blue bands.
function ringTexture(faint) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 4;
  const g = c.getContext('2d');
  const rand = mulberry32(faint ? 131 : 99);
  for (let x = 0; x < 512; x++) {
    const t = x / 511;
    if (faint) {
      // Narrow ringlets with a brighter one on the outside, and a haze of dust between them.
      let a = 0.18;
      for (const [at, w, k] of [[0.08, 0.025, 0.7], [0.3, 0.02, 0.65], [0.45, 0.025, 0.7], [0.62, 0.03, 0.75], [0.9, 0.06, 0.95]]) {
        a = Math.max(a, k * Math.max(0, 1 - Math.abs(t - at) / w));
      }
      const v = 190 + Math.floor(rand() * 20);
      g.fillStyle = `rgba(${v - 20}, ${v + 10}, ${v + 30}, ${a})`;
      g.fillRect(x, 0, 1, 4);
      continue;
    }
    let a = 0.55 + 0.35 * Math.sin(t * 40 + rand() * 0.6) * Math.sin(t * 7);
    if (t > 0.58 && t < 0.63) a *= 0.12; // a Cassini-style gap
    if (t < 0.04 || t > 0.97) a *= 0.3;
    const warm = 200 + Math.floor(40 * Math.sin(t * 13));
    g.fillStyle = `rgba(${warm + 30}, ${warm}, ${warm - 50}, ${Math.max(0, Math.min(1, a))})`;
    g.fillRect(x, 0, 1, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rings(body) {
  const inner = body.radius * body.rings.inner;
  const outer = body.radius * body.rings.outer;
  const faint = !!body.rings.faint;
  const geo = new THREE.RingGeometry(inner, outer, 160, 3);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    uv.setXY(i, (r - inner) / (outer - inner), 0.5);
  }
  const mat = new THREE.MeshLambertMaterial({
    map: ringTexture(faint), transparent: true, side: THREE.DoubleSide, depthWrite: false, emissive: faint ? 0x3a4a55 : 0x3a2c1c,
  });
  const m = new THREE.Mesh(geo, mat);
  // The rings lie around the planet's equator, square to its spin axis (standing up for Tumble).
  const a = SPIN_AXES[body.id];
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(a.x, a.y, a.z).normalize());
  return m;
}

function starVisual(body) {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(body.radius, 48, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd98a }),
  );
  group.add(core);
  const glowA = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,210,120,1)', 'rgba(255,120,40,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  glowA.scale.setScalar(body.radius * 3.2);
  const glowB = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,160,80,0.6)', 'rgba(255,90,40,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  glowB.scale.setScalar(body.radius * 8);
  group.add(glowA, glowB);
  const light = new THREE.PointLight(0xfff0d8, 2.6, 0, 0);
  group.add(light);
  return { group, mesh: core, light, glows: [glowA, glowB] };
}

/** Scatter the forest over Homestead's lowlands; returns the tree list (for collisions). */
function trees(body, group) {
  const rand = mulberry32(7);
  const spots = [];
  for (let tries = 0; tries < 20000 && spots.length < 900; tries++) {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const k = Math.sqrt(1 - z * z);
    const up = new THREE.Vector3(k * Math.cos(a), k * Math.sin(a), z);
    // Keep the strip in front of the flight path clear so trees never hide the rocket.
    const zw = z * body.radius;
    if (zw > -5 && zw < 30) continue;
    const h = body.terrainFn.height(up.x, up.y, up.z);
    if (h < 0 || h > 16) continue;
    // Clear of the old observatory on its hilltop (#15).
    if (up.x * OBSERVATORY.x + up.y * OBSERVATORY.y + up.z * OBSERVATORY.z > Math.cos(0.06)) continue;
    // Sunk a little so trunks stay planted on slopes.
    spots.push({ position: up.clone().multiplyScalar(body.radius + h - 0.3), up, size: 3 + rand() * 4 });
  }
  const forest = createForest(spots, rand);
  group.add(forest.group);
  return forest.trees;
}

// Boulders on the moons: how many, how big (typical width), and in each world's colours.
const ROCKS = {
  pebble: { count: 50, size: [1, 2.4], palette: [0x9e978c, 0x857e74, 0xb8b2a6] },
  nibble: { count: 24, size: [0.8, 1.8], palette: [0x7a6857, 0x8f7c68, 0x5f5044] },
  dusty: { count: 110, size: [1.2, 3], palette: [0xa9502e, 0x8a3f25, 0xc4693c] },
  sizzle: { count: 70, size: [1, 2.4], palette: [0x5a4030, 0x3d2a1f, 0x8a6a3a] },
  frosty: { count: 80, size: [1, 2.6], palette: [0xcfe3ef, 0xa9c6d8, 0xe8f1f6, 0xb98a6c] },
  flip: { count: 60, size: [1, 2.4], palette: [0xe9dcd6, 0xc5d0da, 0xf0c9bf, 0x8e8793] },
  ducky: { count: 36, size: [0.8, 2], palette: [0x4c525c, 0x5d6470, 0x3a3f48, 0xc8d4de] },
};

// Spots where rocks stay clear, because plumes and puffs rise there.
const HOT = { sizzle: SIZZLE_VENTS, dusty: [DUSTY_VOLCANO], flip: FLIP_GEYSERS, ducky: DUCKY_JETS };

/** Scatter boulders over a moon; returns the rock list (for collisions). */
function rocks(body, group) {
  const def = ROCKS[body.id];
  const rand = mulberry32(body.radius * 7 + def.count);
  // Lava vents, geysers, Dusty's caldera and the discoveries' landmarks (#15) stay clear.
  const hot = [...(HOT[body.id] ?? []), ...discoveriesOn(body).flatMap((d) => d.spots ?? [])];
  // And friends' campfires (#16), by at least 8 m even on tiny Nibble.
  const camps = friendsOn(body).map((f) => f.spot);
  const campCos = Math.cos(Math.max(0.12, 8 / body.radius));
  const spots = [];
  for (let tries = 0; tries < 5000 && spots.length < def.count; tries++) {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const k = Math.sqrt(1 - z * z);
    const up = new THREE.Vector3(k * Math.cos(a), k * Math.sin(a), z);
    // Like the trees, keep the strip in front of the flight path clear (rocks are low, so a
    // narrower strip is enough, which leaves room on tiny Nibble).
    const zw = z * body.radius;
    if (zw > -4 && zw < 16) continue;
    if (hot.some((v) => up.x * v.x + up.y * v.y + up.z * v.z > Math.cos(0.12))) continue;
    if (camps.some((v) => up.x * v.x + up.y * v.y + up.z * v.z > campCos)) continue;
    const h = body.terrainFn.height(up.x, up.y, up.z);
    const size = def.size[0] + rand() * (def.size[1] - def.size[0]);
    spots.push({ position: up.clone().multiplyScalar(body.radius + h - 0.1), up, size });
  }
  const field = createRocks(spots, rand, def.palette);
  group.add(field.group);
  return field.rocks;
}

/** The little village around the launch pad: pad, wooden tower, cabin and campfire. */
function launchSite(body, group) {
  const site = new THREE.Group();
  const r = body.surfaceAt(Math.PI / 2);
  site.position.set(0, r, 0);
  group.add(site);
  const wood = toon(0xffffff, { map: woodTexture() });
  const dark = toon(0x5c3d24);

  const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 0.8, 20), wood);
  pad.position.y = -0.38;
  site.add(withOutline(pad, 0.06));

  // Scaffold tower (a bit behind the rocket).
  const tower = new THREE.Group();
  const H = 15;
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, H, 0.35), dark);
    post.position.set(x * 1.1, H / 2, z * 1.1);
    tower.add(withOutline(post, 0.05));
  }
  for (let y = 2; y < H; y += 2.6) {
    for (const rot of [0, Math.PI / 2]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.22, 0.22), wood);
      beam.position.y = y;
      beam.rotation.y = rot;
      beam.position.x = rot ? 1.1 : 0;
      beam.position.z = rot ? 0 : 1.1;
      tower.add(beam);
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.2, 0.16), dark);
      brace.position.set(rot ? 1.1 : 0, y + 1.3, rot ? 0 : 1.1);
      brace.rotation[rot ? 'x' : 'z'] = 0.8;
      tower.add(brace);
    }
  }
  const arm = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 0.3), wood);
  arm.position.set(1.9, H - 3, 0);
  tower.add(arm);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd36b }));
  lamp.position.set(0, H + 0.4, 0);
  tower.add(lamp);
  tower.position.set(-7, 0, -5);
  site.add(tower);

  // Log cabin.
  const cabin = new THREE.Group();
  const walls = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 4.5), wood);
  walls.position.y = 1.6;
  const roofShape = new THREE.Shape([new THREE.Vector2(-3.6, 0), new THREE.Vector2(3.6, 0), new THREE.Vector2(0, 2.4)]);
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: 5.2, bevelEnabled: false }), toon(0x9c3b2e));
  roof.position.set(0, 3.2, -2.6);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2), dark);
  door.position.set(0, 1, 2.26);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.9), new THREE.MeshBasicMaterial({ color: 0xffc766 }));
  win.position.set(1.9, 1.8, 2.26);
  cabin.add(withOutline(walls, 0.06), withOutline(roof, 0.06), door, win);
  cabin.position.set(-16, -0.4, -9);
  cabin.rotation.y = 0.3;
  site.add(cabin);

  // Campfire with logs to sit on.
  const fire = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.6, 6), dark);
    log.rotation.z = Math.PI / 2 - 0.5;
    log.rotation.y = (i / 5) * Math.PI * 2;
    log.position.y = 0.3;
    fire.add(log);
  }
  for (let i = 0; i < 8; i++) {
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3), toon(0x8d8a86));
    const a = (i / 8) * Math.PI * 2;
    stone.position.set(Math.cos(a) * 1.1, 0.1, Math.sin(a) * 1.1);
    fire.add(stone);
  }
  const flames = [];
  for (const [s, c, y] of [[2.4, 'rgba(255,140,40,1)', 0.9], [1.5, 'rgba(255,220,120,1)', 0.7]]) {
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(c, 'rgba(255,80,20,0)'), blending: THREE.AdditiveBlending, depthWrite: false }));
    f.scale.set(s, s * 1.4, 1);
    f.position.y = y;
    fire.add(f);
    flames.push(f);
  }
  const fireLight = new THREE.PointLight(0xff9a4a, 30, 30, 1.6);
  fireLight.position.y = 1.5;
  fire.add(fireLight);
  for (const a of [0.4, 2.2]) {
    const bench = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.4, 8), wood);
    bench.rotation.z = Math.PI / 2;
    bench.rotation.y = a;
    bench.position.set(Math.cos(a) * 2.6, 0.3, -Math.sin(a) * 2.6);
    fire.add(bench);
  }
  fire.position.set(8, 0, 1.5);
  site.add(fire);

  return {
    update(time) {
      const k = 1 + Math.sin(time * 13) * 0.08 + Math.sin(time * 7.3) * 0.08;
      flames[0].scale.set(2.4 * k, 3.4 * (2 - k), 1);
      flames[1].scale.set(1.5 * (2 - k), 2.1 * k, 1);
      fireLight.intensity = 26 + 8 * Math.sin(time * 17) * Math.sin(time * 5);
    },
  };
}

export function createBodyVisual(body) {
  const group = new THREE.Group();
  group.name = body.id;
  const out = { body, group, updates: [] };

  if (body.kind === 'star') {
    const s = starVisual(body);
    group.add(s.group);
    out.mesh = s.mesh;
    out.light = s.light;
    out.landmarks = createLandmarks(body); // solar flares
    group.add(out.landmarks.group);
    return out;
  }

  let mesh;
  if (body.gas) {
    const geo = new THREE.SphereGeometry(body.radius, 128, 80);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / body.radius, y = pos.getY(i) / body.radius, z = pos.getZ(i) / body.radius;
      const c = body.terrainFn.color(x, y, z, 0);
      colors.set(c, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() }));
    const a = SPIN_AXES[body.id];
    const axis = new THREE.Vector3(a.x, a.y, a.z).normalize();
    out.updates.push((time) => mesh.quaternion.setFromAxisAngle(axis, time * 0.01));
    if (body.rings) group.add(rings(body));
  } else {
    const geo = terrainGeometry(body);
    surfaceFromMesh(body, geo);
    mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient(), flatShading: true }));
    if (body.id === 'homestead') {
      out.trees = trees(body, group);
      const site = launchSite(body, group);
      out.updates.push((time) => site.update(time));
    }
    if (ROCKS[body.id]) out.rocks = rocks(body, group);
    // Discoveries (#15): the observatory, footprints, mirror, rover, lander, glowing cracks;
    // and Pip's friends' campfires (#16).
    out.landmarks = createLandmarks(body);
    if (out.landmarks) group.add(out.landmarks.group);
  }
  group.add(mesh);
  out.mesh = mesh;

  // Plumes, puffs and dust. The flight scene keeps out.sunDir pointing at the sun (view space).
  out.sunDir = new THREE.Vector3(1, 0, 0);
  // The comet's tails need to know where the sun is in the world (placeBodies keeps it fresh).
  if (body.comet) out.env = { toSun: new THREE.Vector3(1, 0, 0), dist: Infinity, back: new THREE.Vector3(1, 0, 0), scale: 1 };
  const ambient = createAmbient(body, out.sunDir, out.env);
  if (ambient) {
    group.add(...ambient.meshes);
    out.updates.push(ambient.update);
  }

  if (body.atmosphere) {
    const atm = atmosphere(body.radius * (body.gas ? 1.06 : 1.14), body.atmosphere, body.gas ? 1.0 : 1.4);
    group.add(atm);
    out.atmosphere = atm;
  }
  return out;
}

