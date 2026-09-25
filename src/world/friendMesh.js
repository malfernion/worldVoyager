// Pip's friends (#16): small, round cartoon critters in Pip's style (a round body, two dark
// eyes, an antenna with a bobble), each with something of their own and their instrument.
// Cheap: each friend is one merged vertex-coloured mesh plus its ink, and one waving arm.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, withOutline } from './materials.js';

const DARK = 0x2a1d17;
let mat = null;
const material = () => (mat ??= toon(0xffffff, { vertexColors: true }));

const sphere = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0, r1, h, n = 10) => new THREE.CylinderGeometry(r0, r1, h, n);

/** Collects coloured parts in one local frame, then merges them. */
function merged(parts) {
  const geos = parts.map(([geo, color, o = {}]) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(o.x ?? 0, o.y ?? 0, o.z ?? 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0)),
      new THREE.Vector3(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1),
    ));
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  return withOutline(new THREE.Mesh(mergeGeometries(geos), material()), 0.035);
}

// Everyone's body, eyes and antenna (like Pip), in `color`. `eyes` squashes them (sleepy).
function critter(color, { eyes = 1, r = 0.62 } = {}) {
  const out = [[sphere(r, 18, 12), color, { y: r * 1.05, sy: 1.1 }]];
  for (const x of [-0.22, 0.22]) out.push([sphere(0.1, 8, 6), DARK, { x: x * r / 0.62, y: r * 1.2, z: r * 0.9, sy: eyes }]);
  out.push([cyl(0.025, 0.025, 0.4, 5), DARK, { y: r * 2.3 + 0.1 }]);
  out.push([sphere(0.09, 8, 6), 0xff7a4a, { y: r * 2.3 + 0.33 }]);
  return out;
}

// What makes each friend them, and their instrument (in front of them, facing +z).
const LOOKS = {
  // Mossy, the sleepy moon-hermit: a nightcap, droopy eyes, a harmonica at the mouth.
  mossy: {
    color: 0xa9c9a0,
    parts: () => [
      ...critter(0xa9c9a0, { eyes: 0.4 }),
      [cyl(0, 0.45, 0.9, 12), 0x6a7fd0, { y: 1.55, rz: 0.5, x: -0.2 }],
      [sphere(0.13, 8, 6), 0xffffff, { y: 1.85, x: -0.6 }],
      [box(0.5, 0.12, 0.14), 0xc9c9d6, { y: 0.52, z: 0.62 }],
    ],
  },
  // Bolt, the rover-mechanic: goggles pushed up, a hand drum between the knees.
  bolt: {
    color: 0xf0a060,
    parts: () => [
      ...critter(0xf0a060),
      [box(1.1, 0.12, 0.2), 0x4a3a33, { y: 1.12, z: 0.46 }],
      [cyl(0.14, 0.14, 0.1, 10), 0x6ad0ff, { y: 1.12, z: 0.56, x: -0.2, rx: Math.PI / 2 }],
      [cyl(0.14, 0.14, 0.1, 10), 0x6ad0ff, { y: 1.12, z: 0.56, x: 0.2, rx: Math.PI / 2 }],
      [cyl(0.3, 0.2, 0.55, 12), 0xb57a45, { y: 0.28, z: 0.75 }],
      [cyl(0.31, 0.31, 0.04, 12), 0xf1e3c8, { y: 0.57, z: 0.75 }],
    ],
  },
  // Crumb, the tiny critter who fits the tiny moon: big round ears, a kalimba.
  crumb: {
    color: 0xf3b3c8,
    r: 0.45,
    parts: () => [
      ...critter(0xf3b3c8, { r: 0.45 }),
      [sphere(0.24, 10, 8), 0xf7c8d8, { x: -0.38, y: 0.95, sz: 0.4 }],
      [sphere(0.24, 10, 8), 0xf7c8d8, { x: 0.38, y: 0.95, sz: 0.4 }],
      [box(0.42, 0.08, 0.3), 0x9c6b3e, { y: 0.4, z: 0.5, rx: -0.5 }],
      ...[-0.12, -0.04, 0.04, 0.12].map((x, i) => [box(0.035, 0.03, 0.2 - Math.abs(i - 1.5) * 0.03), 0xe6e6e6, { x, y: 0.46, z: 0.5, rx: -0.5 }]),
    ],
  },
  // Toasty, the lava-watcher who likes it warm: sunglasses, a big double bass.
  toasty: {
    color: 0xff8a5c,
    parts: () => [
      ...critter(0xff8a5c),
      [box(0.62, 0.14, 0.08), DARK, { y: 0.75, z: 0.58 }],
      [sphere(0.4, 12, 8), 0x8a4a22, { x: 0.55, y: 0.55, z: 0.5, sx: 0.8, sy: 1.3, sz: 0.35 }],
      [box(0.1, 1.2, 0.08), 0x4a2a14, { x: 0.55, y: 1.45, z: 0.5 }],
      [box(0.03, 1.6, 0.01), 0xe6e6e6, { x: 0.55, y: 1.1, z: 0.65 }],
    ],
  },
  // Flurry, the ice-fisher: a bobble hat, a tin whistle.
  flurry: {
    color: 0xbfe3ff,
    parts: () => [
      ...critter(0xbfe3ff),
      [new THREE.SphereGeometry(0.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xe8584a, { y: 1.08 }],
      [sphere(0.16, 8, 6), 0xffffff, { y: 1.72 }],
      [cyl(0.035, 0.035, 0.6, 6), 0xdfe6ee, { y: 0.5, z: 0.72, rx: 1.1 }],
    ],
  },
};

/**
 * A friend ('mossy', 'bolt', 'crumb', 'toasty', 'flurry'). Returns { group, update(time, how) }:
 * how is 'play' (bobbing along, tapping), 'wave' (waving hello and hopping) or 'party' (Full Band).
 * group's +y is up and +z is where they face.
 */
export function buildFriend(name, scale = 1) {
  const look = LOOKS[name];
  const group = new THREE.Group();
  const bob = new THREE.Group();
  group.add(bob);
  bob.add(merged(look.parts()));
  const r = look.r ?? 0.62;
  // One arm, on the left, to wave with (pivot at the shoulder).
  const arm = new THREE.Group();
  arm.position.set(-r * 0.95, r * 1.05, 0.05);
  const armMesh = merged([[cyl(0.08, 0.07, 0.5, 6), look.color, { y: -0.2 }], [sphere(0.12, 8, 6), look.color, { y: -0.45 }]]);
  arm.add(armMesh);
  bob.add(arm);
  group.scale.setScalar(scale);
  const phase = name.length * 1.7;
  return {
    group,
    update(time, how = 'play') {
      const t = time + phase;
      if (how === 'wave') {
        bob.position.y = Math.abs(Math.sin(t * 5)) * 0.35;
        arm.rotation.z = -2.4 + Math.sin(t * 9) * 0.5;
        bob.rotation.y = Math.sin(t * 2) * 0.2;
      } else if (how === 'party') {
        bob.position.y = Math.abs(Math.sin(t * 4.5)) * 0.25;
        arm.rotation.z = -1.8 + Math.sin(t * 9) * 0.6;
        bob.rotation.y = Math.sin(t * 1.5) * 0.3;
      } else {
        // Playing along: a gentle bob to the campfire song, the arm keeping time.
        bob.position.y = Math.abs(Math.sin(t * 2.3)) * 0.06;
        arm.rotation.z = -0.3 + Math.sin(t * 4.6) * 0.25;
        bob.rotation.y = Math.sin(t * 0.7) * 0.15;
      }
    },
  };
}

/** Which look a friend id ('friend-mossy') uses. */
export const lookOf = (id) => id.replace('friend-', '');
