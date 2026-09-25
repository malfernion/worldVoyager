// Chunky cartoon buggies. Built facing +z with +y up; the origin sits `ride` metres above
// the ground (the same point the buggy physics tracks).
import * as THREE from 'three';
import { BUGGIES, PAINTS } from './parts.js';
import { toon, withOutline } from '../world/materials.js';

const hexOf = (paint) => PAINTS.find((p) => p.id === paint)?.hex ?? 0xe8743b;
const DARK = 0x2e2a33;
const METAL = 0x6b6d78;
const CREAM = 0xf1e4c8;

function roundedBox(w, h, d, r = 0.2) {
  const shape = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + d - r);
  shape.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  shape.lineTo(x + r, y + d);
  shape.quadraticCurveTo(x, y + d, x, y + d - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -h / 2, 0);
  return geo;
}

function mesh(geo, color, outline = true) {
  const m = new THREE.Mesh(geo, toon(color));
  if (outline) withOutline(m, 0.04);
  return m;
}

function wheel(radius, width, hubColor) {
  const spin = new THREE.Group();
  const tyre = mesh(new THREE.CylinderGeometry(radius, radius, width, 20), DARK);
  tyre.rotation.z = Math.PI / 2;
  const hub = mesh(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, width + 0.04, 12), hubColor, false);
  hub.rotation.z = Math.PI / 2;
  // Chunky treads so you can see the wheel turning.
  for (let i = 0; i < 8; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(width * 1.02, radius * 0.18, radius * 0.25), toon(0x1c1a20));
    const a = (i / 8) * Math.PI * 2;
    t.position.set(0, Math.cos(a) * radius, Math.sin(a) * radius);
    t.rotation.x = -a;
    spin.add(t);
  }
  spin.add(tyre, hub);
  return spin;
}

function pip(scale = 1) {
  const g = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(0.34, 18, 12), 0xffc987);
  body.scale.y = 1.1;
  g.add(body);
  for (const x of [-0.12, 0.12]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), toon(DARK));
    eye.position.set(x, 0.08, 0.3);
    g.add(eye);
  }
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.28), toon(DARK));
  ant.position.y = 0.46;
  const bob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), toon(0xff7a4a));
  bob.position.y = 0.62;
  g.add(ant, bob);
  g.scale.setScalar(scale);
  return g;
}

function flag(color) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6), toon(METAL));
  pole.position.y = 0.8;
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.38), new THREE.MeshToonMaterial({ color, side: THREE.DoubleSide }));
  cloth.position.set(0, 1.4, -0.3);
  cloth.rotation.y = Math.PI / 2;
  g.add(pole, cloth);
  g.userData.cloth = cloth;
  return g;
}

function headlights(z, y, spread) {
  const g = new THREE.Group();
  for (const x of [-spread, spread]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1b0 }));
    l.position.set(x, y, z);
    g.add(l);
  }
  return g;
}

const builders = {
  rover(color) {
    const g = new THREE.Group();
    const chassis = mesh(roundedBox(2.0, 0.55, 3.0, 0.35), color);
    chassis.position.y = 0.25;
    const nose = mesh(roundedBox(1.6, 0.35, 0.8, 0.25), CREAM);
    nose.position.set(0, 0.62, 1.05);
    const seat = mesh(new THREE.BoxGeometry(1.0, 0.5, 0.35), 0x8c5a3a);
    seat.position.set(0, 0.75, -0.55);
    const p = pip(1);
    p.position.set(0, 0.95, -0.25);
    // Roll cage.
    const cage = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.07, 8, 20, Math.PI), toon(METAL));
    cage.position.set(0, 0.5, -0.45);
    const f = flag(0xffd166);
    f.position.set(-0.75, 0.5, -1.2);
    g.add(chassis, nose, seat, p, cage, f, headlights(1.55, 0.4, 0.6));
    return { g, wheelY: -0.2, wheelX: 1.2, wheelZ: 1.0, width: 0.45, pip: p, flag: f };
  },
  truck(color) {
    const g = new THREE.Group();
    const chassis = mesh(roundedBox(1.9, 0.8, 2.7, 0.3), color);
    chassis.position.y = 0.55;
    const cab = mesh(roundedBox(1.5, 0.75, 1.3, 0.25), color);
    cab.position.set(0, 1.3, -0.25);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.5), new THREE.MeshToonMaterial({ color: 0x9fe3ff, emissive: 0x2a6f8a }));
    glass.position.set(0, 1.35, 0.42);
    glass.rotation.x = -0.2;
    const p = pip(0.9);
    p.position.set(0, 1.35, -0.2);
    const bar = mesh(new THREE.BoxGeometry(2.0, 0.18, 0.3), METAL);
    bar.position.set(0, 0.35, 1.45);
    for (const x of [-1.0, 1.0]) {
      for (const z of [-1.1, 1.1]) {
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.8), toon(0xe6b43c));
        strut.position.set(x * 0.85, 0.35, z);
        strut.rotation.z = x * 0.6;
        g.add(strut);
      }
    }
    g.add(chassis, cab, glass, p, bar, headlights(1.4, 0.7, 0.55));
    return { g, wheelY: -0.3, wheelX: 1.4, wheelZ: 1.1, width: 0.75, pip: p };
  },
  hopper(color) {
    const g = new THREE.Group();
    const pod = mesh(new THREE.SphereGeometry(1, 24, 16), color);
    pod.scale.set(1.0, 0.55, 1.35);
    pod.position.y = 0.3;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshPhongMaterial({ color: 0xbfefff, transparent: true, opacity: 0.35, shininess: 90, depthWrite: false }),
    );
    dome.position.set(0, 0.68, 0.1);
    const p = pip(0.85);
    p.position.set(0, 0.75, 0.1);
    const jets = [];
    for (const x of [-0.55, 0.55]) {
      const jet = mesh(new THREE.CylinderGeometry(0.16, 0.28, 0.45, 12), METAL);
      jet.position.set(x, 0.0, -1.0);
      g.add(jet);
      jets.push([x, -0.3, -1.0]);
    }
    const fin = mesh(new THREE.BoxGeometry(0.1, 0.6, 0.6), CREAM);
    fin.position.set(0, 0.85, -0.95);
    g.add(pod, dome, p, fin, headlights(1.3, 0.3, 0.4));
    return { g, wheelY: -0.18, wheelX: 0.95, wheelZ: 0.85, width: 0.32, pip: p, jets };
  },
};

/** Returns { group, wheels: [{ spin, steer }], radius, jets, pip, flag }. */
export function buildBuggy(kind, paint) {
  const def = BUGGIES[kind] || BUGGIES.rover;
  const color = hexOf(paint);
  const b = builders[kind in builders ? kind : 'rover'](color);
  const wheels = [];
  for (const z of [b.wheelZ, -b.wheelZ]) {
    for (const x of [-b.wheelX, b.wheelX]) {
      const steer = new THREE.Group();
      steer.position.set(x, b.wheelY, z);
      const spin = wheel(def.wheel, b.width, z > 0 ? CREAM : color);
      steer.add(spin);
      b.g.add(steer);
      wheels.push({ spin, steer: z > 0 ? steer : null });
    }
  }
  const group = new THREE.Group();
  group.add(b.g);
  return { group, wheels, radius: def.wheel, jets: b.jets || [], pip: b.pip, flag: b.flag };
}
