// Pip's friends (#16, redesigned in #43): little space travellers in the Outer Wilds mood.
// Each wears a padded space suit with a backpack (and Pip's antenna and bobble on top of it),
// has taken their helmet off by the campfire (it sits by their boots), and holds their
// instrument in both hands. Faces and hats keep who they were: sleepy Mossy's nightcap,
// Bolt's goggles, Crumb's big ears, Toasty's sunglasses, Flurry's bobble hat and scarf.
// Cheap: one merged vertex-coloured body (instrument and helmet included) plus two arms,
// each with its ink (6 draw calls), and a hidden waving arm swapped in to say hello.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, withOutline } from './materials.js';

const DARK = 0x2a1d17;
const WHITE = 0xffffff;
const METAL = 0x9aa3ad;
const BOOT = 0x4a3a33;
let mat = null;
const material = () => (mat ??= toon(0xffffff, { vertexColors: true }));

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const sphere = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0, r1, h, n = 12) => new THREE.CylinderGeometry(r0, r1, h, n);
const capsule = (r, len, n = 12) => new THREE.CapsuleGeometry(r, len, 4, n);
const torus = (r, tube, arc = Math.PI * 2) => new THREE.TorusGeometry(r, tube, 6, 16, arc);
// Closed profiles (they start and end on the axis), so ink outlines don't show through an opening.
const lathe = (pts, n = 18) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), n);

/** A part from `a` to `b` (a cylinder or capsule made along +y, turned to point from a to b). */
function between(geoOfLength, a, b) {
  const d = b.clone().sub(a);
  const geo = geoOfLength(d.length());
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
  geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geo;
}

/** Collects coloured parts in one local frame, then merges them (with ink). */
function merged(parts, ink = 0.03) {
  const geos = parts.map(([geo, color, o = {}]) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    g.applyMatrix4(new THREE.Matrix4().compose(
      V(o.x ?? 0, o.y ?? 0, o.z ?? 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0)),
      V(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1),
    ));
    if (o.m) g.applyMatrix4(o.m); // then into a sub-frame (e.g. a leaning double bass)
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  return withOutline(new THREE.Mesh(mergeGeometries(geos), material()), ink);
}

// Sizes, in the friend's own frame: feet on y = 0, facing +z, their left hand towards +x.
const SHOULDER = V(0.37, 1.1, 0);
const UPPER = 0.36, LOWER = 0.36;
const HEAD = { y: 1.47, r: 0.3 };

/**
 * Where the elbow goes for a hand at `hand` (two-bone reach from the shoulder, elbow bending
 * down and out). Returns { elbow, hand } with the hand pulled in if it's out of reach.
 */
function reach(shoulder, hand, side) {
  const d = hand.clone().sub(shoulder);
  const dist = Math.min(d.length(), UPPER + LOWER - 0.01);
  const dir = d.normalize();
  const pole = V(side * 0.8, -1, -0.4);
  pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  const a = (UPPER * UPPER - LOWER * LOWER + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, UPPER * UPPER - a * a));
  return {
    elbow: shoulder.clone().addScaledVector(dir, a).addScaledVector(pole, h),
    hand: shoulder.clone().addScaledVector(dir, dist),
  };
}

/** An arm (in the shoulder's frame) reaching for `hand` (in the friend's frame). */
function armParts(look, side, hand) {
  const s = V(SHOULDER.x * side, SHOULDER.y, SHOULDER.z);
  const { elbow, hand: h } = reach(s, hand, side);
  const e = elbow.sub(s), w = h.sub(s), o = V(0, 0, 0);
  const cuff = w.clone().lerp(e, 0.22);
  return [
    [between((l) => capsule(0.095, l), o, e), look.suit],
    [sphere(0.1, 12, 10), look.trim, { x: e.x, y: e.y, z: e.z }], // elbow pad
    [between((l) => capsule(0.085, l), e, w), look.suit],
    [between((l) => cyl(0.1, 0.1, l), cuff, cuff.clone().lerp(w, 0.35)), look.trim], // cuff
    [sphere(0.105, 12, 10), look.glove, { x: w.x, y: w.y, z: w.z, sz: 1.15 }], // glove
  ];
}

// A suit, a backpack with Pip's antenna, a face, a helmet by the boots. `look` has the colours.
function traveller(look) {
  const { suit, trim, skin } = look;
  const pad = new THREE.Color(suit).multiplyScalar(0.8).getHex(); // knee pads: a shade darker than the suit
  const out = [];
  // Boots, legs and knee pads.
  for (const x of [-0.17, 0.17]) {
    out.push([sphere(0.16, 16, 10), BOOT, { x, y: 0.09, z: 0.05, sy: 0.62, sz: 1.35 }]);
    out.push([cyl(0.13, 0.12, 0.1), trim, { x, y: 0.2 }]);
    out.push([capsule(0.125, 0.34), suit, { x, y: 0.43 }]);
    out.push([sphere(0.07, 10, 8), pad, { x, y: 0.42, z: 0.11, sz: 0.5 }]);
  }
  // Body: a padded barrel, a belt with a buckle, a chest panel with three buttons, shoulder pads.
  out.push([lathe([[0, 0.55], [0.3, 0.57], [0.35, 0.72], [0.36, 0.95], [0.32, 1.13], [0.2, 1.22], [0, 1.22]]), suit]);
  out.push([torus(0.34, 0.045), trim, { y: 0.66, rx: Math.PI / 2 }]);
  out.push([box(0.12, 0.09, 0.05), METAL, { y: 0.66, z: 0.37 }]);
  out.push([box(0.24, 0.15, 0.06), trim, { y: 0.95, z: 0.33 }]);
  [0xff6b5a, 0xffd34a, 0x6ad07a].forEach((c, i) => out.push([sphere(0.025, 8, 6), c, { x: -0.07 + i * 0.07, y: 0.95, z: 0.37 }]));
  for (const x of [-SHOULDER.x, SHOULDER.x]) out.push([sphere(0.14, 14, 10), trim, { x, y: SHOULDER.y, sy: 0.85 }]);
  // The helmet's collar ring (the helmet is off).
  out.push([torus(0.22, 0.055), METAL, { y: 1.2, rx: Math.PI / 2 }]);
  // Backpack: a padded pack, two tanks, and Pip's antenna with its bobble.
  out.push([box(0.5, 0.56, 0.22), look.pack ?? trim, { y: 0.93, z: -0.36 }]);
  for (const x of [-0.14, 0.14]) {
    out.push([capsule(0.085, 0.4), METAL, { x, y: 0.93, z: -0.52 }]);
  }
  out.push([cyl(0.022, 0.022, 0.5, 6), DARK, { x: 0.18, y: 1.45, z: -0.4 }]);
  out.push([sphere(0.07, 10, 8), 0xff7a4a, { x: 0.18, y: 1.72, z: -0.4 }]);
  // Head: a round face with big dark eyes (a white twinkle in each) and a small smile.
  out.push([sphere(HEAD.r, 18, 14), skin, { y: HEAD.y, sy: 1.05 }]);
  const eyes = look.eyes ?? 1;
  for (const x of [-0.11, 0.11]) {
    out.push([sphere(0.07, 12, 10), DARK, { x, y: HEAD.y + 0.04, z: 0.25, sy: 1.25 * eyes, sz: 0.6 }]);
    if (eyes > 0.6) out.push([sphere(0.022, 6, 5), WHITE, { x: x + 0.025, y: HEAD.y + 0.08, z: 0.29 }]);
  }
  if (look.smile !== false) out.push([torus(0.06, 0.013, Math.PI), DARK, { y: HEAD.y - 0.1, z: 0.27, rz: Math.PI, rx: -0.3 }]);
  // The helmet, set down by their boots, looking off to the side: a round shell, a wide
  // visor wrapped round its front (not a round one: that looked like an eyeball), a
  // highlight, a collar ring and a little lamp on top.
  const hx = -0.64, hy = 0.25, hz = 0.26, hr = 0.26;
  const h = new THREE.Matrix4().compose(V(hx, hy, hz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.9, 0)), V(1, 1, 1));
  out.push([sphere(hr, 18, 14), look.helmet ?? 0xe8e4da, { m: h }]);
  out.push([new THREE.SphereGeometry(hr * 1.03, 18, 10, Math.PI / 2 - 0.95, 1.9, 0.95, 0.9), look.visor ?? 0x44617f, { m: h }]);
  out.push([box(0.14, 0.025, 0.02), WHITE, { m: h, x: -0.06, y: 0.08, z: 0.235, rz: 0.35 }]);
  out.push([torus(hr * 0.8, 0.045), METAL, { m: h, y: -hr * 0.62, rx: Math.PI / 2 }]);
  out.push([cyl(0.04, 0.05, 0.06, 10), METAL, { m: h, y: hr * 0.98 }]);
  out.push([sphere(0.035, 8, 6), 0xffd34a, { m: h, y: hr * 1.08 }]);
  return out;
}

// The instruments, held in front (in the friend's frame), and where each hand goes.
const INSTRUMENTS = {
  // A harmonica at the mouth, both hands cupped round it.
  harmonica: {
    hands: { left: V(0.22, 1.32, 0.3), right: V(-0.22, 1.32, 0.3) },
    parts: () => [
      [box(0.34, 0.1, 0.12), 0xc9c9d6, { y: 1.37, z: 0.34 }],
      [box(0.36, 0.035, 0.13), 0x8f8fa3, { y: 1.42, z: 0.34 }],
      [box(0.36, 0.035, 0.13), 0x8f8fa3, { y: 1.32, z: 0.34 }],
      ...[-0.12, -0.06, 0, 0.06, 0.12].map((x) => [box(0.03, 0.03, 0.02), DARK, { x, y: 1.37, z: 0.405 }]),
    ],
  },
  // A hand drum (a djembe) on a strap at the waist, both hands on the skin.
  drum: {
    hands: { left: V(0.13, 0.9, 0.42), right: V(-0.13, 0.9, 0.42) },
    parts: () => [
      [lathe([[0, 0], [0.12, 0], [0.1, 0.14], [0.08, 0.26], [0.2, 0.42], [0.23, 0.52], [0, 0.52]]), 0xb57a45, { y: 0.33, z: 0.42 }],
      [cyl(0.235, 0.235, 0.04, 20), 0xf1e3c8, { y: 0.86, z: 0.42 }],
      [torus(0.232, 0.018), 0x6b4424, { y: 0.84, z: 0.42, rx: Math.PI / 2 }],
      [torus(0.2, 0.014), 0x6b4424, { y: 0.66, z: 0.42, rx: Math.PI / 2 }],
      [between((l) => cyl(0.02, 0.02, l, 5), V(0.2, 0.84, 0.42), V(0.3, 1.1, 0.05)), 0x6b4424], // strap
    ],
  },
  // A kalimba (thumb piano) held at the chest, thumbs on the tines.
  kalimba: {
    hands: { left: V(0.19, 1.0, 0.4), right: V(-0.19, 1.0, 0.4) },
    parts: () => [
      [box(0.38, 0.07, 0.28), 0x9c6b3e, { y: 1.0, z: 0.42, rx: -0.7 }],
      [cyl(0.05, 0.05, 0.075, 12), DARK, { y: 0.97, z: 0.46, rx: -0.7 }],
      [box(0.32, 0.03, 0.03), METAL, { y: 1.06, z: 0.37, rx: -0.7 }],
      ...[-0.12, -0.08, -0.04, 0, 0.04, 0.08, 0.12].map((x, i) => [box(0.022, 0.022, 0.2 - Math.abs(i - 3) * 0.025), 0xe6e6e6, { x, y: 1.03, z: 0.45, rx: -0.7 }]),
    ],
  },
  // A double bass stood beside them: the left hand up the neck, the right plucking.
  bass: {
    hands: { left: V(0.3, 1.38, 0.42), right: V(0.02, 0.84, 0.5) },
    parts: () => {
      // Its own frame: standing on the ground in front of them, leaning in a little.
      const m = new THREE.Matrix4().compose(V(0.18, 0, 0.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.12)), V(1, 1, 1));
      const at = (x, y, z, more = {}) => ({ ...more, x, y, z, m });
      return [
        [sphere(0.3, 18, 12), 0x8a4a22, at(0, 0.5, 0, { sy: 1.15, sz: 0.4 })],
        [sphere(0.22, 18, 12), 0x8a4a22, at(0, 0.92, 0, { sy: 1.1, sz: 0.38 })],
        [box(0.08, 0.95, 0.07), 0x3a2414, at(0, 1.45, 0.02)],
        [sphere(0.07, 10, 8), 0x3a2414, at(0, 1.95, 0.02)],
        [box(0.06, 0.25, 0.04), 0x3a2414, at(0, 0.62, 0.14)], // bridge
        ...[-0.09, 0.09].map((x) => [box(0.025, 0.18, 0.02), DARK, at(x, 0.62, 0.12, { rz: x * 2 })]), // f-holes
        ...[-0.03, -0.01, 0.01, 0.03].map((x) => [box(0.008, 1.3, 0.008), 0xe6e6e6, at(x, 1.15, 0.09)]),
        [cyl(0.015, 0.015, 0.2, 5), METAL, at(0, 0.08, 0)], // end pin
      ];
    },
  },
  // A tin whistle at the mouth, both hands along it.
  whistle: {
    hands: { left: V(0.05, 1.18, 0.5), right: V(-0.04, 1.08, 0.6) },
    parts: () => [
      [between((l) => cyl(0.028, 0.028, l, 10), V(0, 1.36, 0.3), V(0, 1.0, 0.68)), 0xdfe6ee],
      [between((l) => cyl(0.03, 0.03, l, 10), V(0, 1.36, 0.3), V(0, 1.3, 0.36)), 0x2e4a7a], // mouthpiece
      ...[0.5, 0.6, 0.7, 0.8].map((k) => [sphere(0.012, 6, 5), DARK, { x: 0, y: 1.36 - 0.36 * k + 0.028, z: 0.3 + 0.38 * k + 0.02 }]),
    ],
  },
};

// Who's who: suit colours, face and hat, instrument.
const LOOKS = {
  // Mossy, the sleepy moon-hermit: a patched olive suit, droopy eyes, a nightcap.
  mossy: {
    suit: 0x7d8f5a, trim: 0xd9c9a0, glove: 0xd9c9a0, skin: 0xa9c9a0, eyes: 0.4, instrument: 'harmonica', smile: false,
    extras: () => [
      [cyl(0, 0.3, 0.6, 16), 0x6a7fd0, { y: 1.8, x: -0.1, rz: 0.55 }],
      [cyl(0.31, 0.31, 0.08, 16), 0xe8e4da, { y: 1.68 }],
      [sphere(0.09, 10, 8), WHITE, { y: 1.97, x: -0.38 }],
      [box(0.13, 0.13, 0.03), 0xb07a4a, { x: 0.17, y: 0.46, z: 0.12, rz: 0.2 }], // a patch on the knee
    ],
  },
  // Bolt, the rover-mechanic: teal overalls, goggles pushed up, a spanner in the belt.
  bolt: {
    suit: 0x3f7f8c, trim: 0xf0a060, glove: 0x4a3a33, skin: 0xf0a060, pack: 0x2e5f69, instrument: 'drum',
    extras: () => [
      [torus(0.29, 0.035), 0x4a3a33, { y: HEAD.y + 0.14, rx: Math.PI / 2 - 0.25 }],
      ...[-0.1, 0.1].map((x) => [cyl(0.075, 0.075, 0.07, 14), 0x6ad0ff, { x, y: HEAD.y + 0.2, z: 0.22, rx: Math.PI / 2 - 0.5 }]),
      [box(0.05, 0.28, 0.03), METAL, { x: 0.28, y: 0.6, z: 0.3, rz: 0.3 }],
    ],
  },
  // Crumb, the tiny traveller who fits the tiny moon: a mustard suit, big round ears.
  crumb: {
    suit: 0xe0b040, trim: 0xa0642c, glove: 0xf7f0e0, skin: 0xf3b3c8, instrument: 'kalimba', scale: 0.8,
    extras: () => [
      ...[-1, 1].map((s) => [sphere(0.17, 14, 10), 0xf3b3c8, { x: s * 0.3, y: HEAD.y + 0.2, sz: 0.45, rz: -s * 0.3 }]),
      ...[-1, 1].map((s) => [sphere(0.1, 12, 8), 0xf7d0dc, { x: s * 0.31, y: HEAD.y + 0.2, z: 0.05, sz: 0.3, rz: -s * 0.3 }]),
    ],
  },
  // Toasty, the lava-watcher who likes it warm: a silver heat suit, sunglasses, a gold visor.
  toasty: {
    suit: 0xb8bcc4, trim: 0xd9483b, glove: 0xd9483b, skin: 0xff8a5c, visor: 0xd9a53a, instrument: 'bass',
    extras: () => [
      ...[-0.11, 0.11].map((x) => [box(0.17, 0.11, 0.05), DARK, { x, y: HEAD.y + 0.04, z: 0.27 }]),
      [box(0.08, 0.03, 0.04), DARK, { y: HEAD.y + 0.06, z: 0.29 }],
      [torus(0.36, 0.03), 0xd9483b, { y: 0.9, rx: Math.PI / 2 }], // a stripe round the suit
    ],
  },
  // Flurry, the ice-fisher: a padded white suit, a bobble hat and a red scarf.
  flurry: {
    suit: 0xe6eef7, trim: 0x2e4a7a, glove: 0xe8584a, skin: 0xbfe3ff, instrument: 'whistle',
    extras: () => [
      [new THREE.SphereGeometry(0.32, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xe8584a, { y: HEAD.y + 0.02 }],
      [cyl(0.33, 0.33, 0.08, 18), WHITE, { y: HEAD.y + 0.04 }],
      [sphere(0.1, 10, 8), WHITE, { y: HEAD.y + 0.36 }],
      [torus(0.22, 0.07), 0xe8584a, { y: 1.22, rx: Math.PI / 2 }],
      [box(0.1, 0.3, 0.05), 0xe8584a, { x: 0.12, y: 1.05, z: 0.3, rz: 0.15 }], // the scarf's end
    ],
  },
};

/**
 * A friend ('mossy', 'bolt', 'crumb', 'toasty', 'flurry'). Returns { group, update(time, how) }:
 * how is 'play' (playing along), 'wave' (waving hello and hopping) or 'party' (Full Band).
 * group's +y is up and +z is where they face.
 */
export function buildFriend(name, scale = 1) {
  const look = LOOKS[name];
  const inst = INSTRUMENTS[look.instrument];
  const group = new THREE.Group();
  const bob = new THREE.Group();
  group.add(bob);
  bob.add(merged([...traveller(look), ...inst.parts(), ...look.extras()]));
  // Both arms hold the instrument (pivots at the shoulders). The right one (-x) waves hello:
  // a second, raised arm is swapped in for that.
  const arm = (side, hand) => {
    const g = new THREE.Group();
    g.position.set(SHOULDER.x * side, SHOULDER.y, SHOULDER.z);
    g.add(merged(armParts(look, side, hand)));
    bob.add(g);
    return g;
  };
  const left = arm(1, inst.hands.left);
  const right = arm(-1, inst.hands.right);
  const wave = arm(-1, V(-0.62, 1.72, 0.12));
  wave.visible = false;
  group.scale.setScalar(scale * (look.scale ?? 1));
  const phase = name.length * 1.7;
  const beat = look.instrument === 'drum' || look.instrument === 'kalimba';
  return {
    group,
    update(time, how = 'play') {
      const t = time + phase;
      const hello = how !== 'play';
      wave.visible = hello;
      right.visible = !hello;
      if (how === 'wave') {
        bob.position.y = Math.abs(Math.sin(t * 5)) * 0.3;
        wave.rotation.z = Math.sin(t * 9) * 0.35;
        bob.rotation.y = Math.sin(t * 2) * 0.2;
        bob.rotation.z = 0;
      } else if (how === 'party') {
        bob.position.y = Math.abs(Math.sin(t * 4.5)) * 0.25;
        wave.rotation.z = Math.sin(t * 9) * 0.45;
        bob.rotation.y = Math.sin(t * 1.5) * 0.3;
        bob.rotation.z = Math.sin(t * 2.25) * 0.08;
      } else {
        // Playing along: a gentle bob and sway to the campfire song, hands keeping time.
        bob.position.y = Math.abs(Math.sin(t * 2.3)) * 0.04;
        bob.rotation.y = Math.sin(t * 0.7) * 0.12;
        bob.rotation.z = Math.sin(t * 1.15) * 0.04;
        const k = Math.sin(t * 4.6);
        if (beat) {
          left.rotation.x = Math.max(0, k) * -0.14;
          right.rotation.x = Math.max(0, -k) * -0.14;
        } else {
          right.rotation.x = k * 0.06;
          left.rotation.x = -k * 0.03;
        }
      }
    },
  };
}

/** Which look a friend id ('friend-mossy') uses. */
export const lookOf = (id) => id.replace('friend-', '');
