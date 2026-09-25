// Builds a chunky, cartoon 3D rocket from a design (stack of parts, top to bottom).
import * as THREE from 'three';
import { PARTS, PAINTS } from './parts.js';
import { toon, withOutline, woodTexture } from '../world/materials.js';

const matCache = new Map();
function paintMat(paint) {
  if (matCache.has(paint)) return matCache.get(paint);
  const hex = PAINTS.find((p) => p.id === paint)?.hex ?? 0xffffff;
  const m = paint === 'wood' ? toon(0xffffff, { map: woodTexture() }) : toon(hex);
  matCache.set(paint, m);
  return m;
}
matCache.set('_metal', toon(0x4d4f5c));
matCache.set('_brass', toon(0xd9a441));
matCache.set('_dark', toon(0x2e2a33));
const glass = new THREE.MeshToonMaterial({ color: 0x9fe3ff, emissive: 0x2a6f8a, gradientMap: null });
const dome = new THREE.MeshPhongMaterial({ color: 0xbfefff, transparent: true, opacity: 0.35, shininess: 90, depthWrite: false });

function mesh(geo, mat, outline = true) {
  const m = new THREE.Mesh(geo, mat);
  if (outline) withOutline(m, 0.05);
  return m;
}

function lathe(points, segs = 28) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segs);
}

function stripe(y, r, mat) {
  const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 8, 32), mat);
  t.rotation.x = Math.PI / 2;
  t.position.y = y;
  return t;
}

const builders = {
  nose(p) {
    const g = new THREE.Group();
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push([Math.max(0.001, Math.pow(Math.cos((t * Math.PI) / 2), 0.75)), t * 1.5]);
    }
    g.add(mesh(lathe(pts), paintMat(p.paint)));
    const tip = mesh(new THREE.SphereGeometry(0.13, 12, 8), matCache.get('_brass'));
    tip.position.y = 1.5;
    g.add(tip);
    return g;
  },
  capsule(p) {
    const g = new THREE.Group();
    g.add(mesh(lathe([[1, 0], [1, 0.25], [0.62, 1.6], [0.5, 1.75], [0.3, 1.9], [0.001, 1.9]]), paintMat(p.paint)));
    const slope = Math.atan2(0.38, 1.35);
    const win = new THREE.Group();
    const pane = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), glass);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.07, 8, 24), matCache.get('_brass'));
    win.add(pane, rim);
    win.position.set(0, 0.95, 0.83);
    win.rotation.x = -slope;
    g.add(win);
    g.add(stripe(0.12, 1.0, matCache.get('_dark')));
    return g;
  },
  bubble(p) {
    const g = new THREE.Group();
    g.add(mesh(lathe([[1, 0], [1, 0.5], [0.94, 0.72], [0.001, 0.72]]), paintMat(p.paint)));
    // Pip, our little pilot.
    const pip = new THREE.Group();
    const body = mesh(new THREE.SphereGeometry(0.38, 20, 14), toon(0xffc987));
    body.scale.y = 1.1;
    pip.add(body);
    for (const x of [-0.13, 0.13]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), matCache.get('_dark'));
      eye.position.set(x, 0.08, 0.33);
      pip.add(eye);
    }
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3), matCache.get('_dark'));
    ant.position.y = 0.5;
    const bob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), toon(0xff7a4a));
    bob.position.y = 0.66;
    pip.add(ant, bob);
    pip.position.y = 1.1;
    pip.userData.pip = true;
    g.add(pip);
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.93, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), dome);
    d.position.y = 0.72;
    d.renderOrder = 2;
    g.add(d);
    const ring = stripe(0.72, 0.95, matCache.get('_brass'));
    g.add(ring);
    return g;
  },
  tube(p) {
    const g = new THREE.Group();
    const c = mesh(new THREE.CylinderGeometry(1, 1, 2, 28), paintMat(p.paint));
    c.position.y = 1;
    g.add(c, stripe(0.25, 1.0, matCache.get('_dark')), stripe(1.75, 1.0, matCache.get('_dark')));
    return g;
  },
  bigtube(p) {
    const g = new THREE.Group();
    const c = mesh(new THREE.CylinderGeometry(1, 1, 3.2, 28), paintMat(p.paint));
    c.position.y = 1.6;
    g.add(c, stripe(0.25, 1.0, matCache.get('_dark')), stripe(2.95, 1.0, matCache.get('_dark')));
    const s = stripe(1.6, 1.02, paintMat(p.paint === 'cream' ? 'red' : 'cream'));
    s.scale.set(1, 1, 3);
    g.add(s);
    return g;
  },
  garage(p) {
    const g = new THREE.Group();
    const h = PARTS.garage.height;
    const c = mesh(new THREE.CylinderGeometry(1, 1, h, 28), paintMat(p.paint));
    c.position.y = h / 2;
    g.add(c, stripe(0.2, 1.0, matCache.get('_dark')), stripe(h - 0.2, 1.0, matCache.get('_dark')));
    // A roll-up door facing the camera, with a ramp folded up behind it.
    const frame = mesh(new THREE.BoxGeometry(1.5, 1.55, 0.16), matCache.get('_dark'));
    frame.position.set(0, 1.1, 0.93);
    g.add(frame);
    const door = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.24, 0.08), matCache.get(i % 2 ? '_brass' : '_metal'));
      slat.position.y = 0.45 + i * 0.27;
      door.add(slat);
    }
    door.position.set(0, 0, 1.03);
    door.userData.door = true;
    g.add(door);
    const ramp = new THREE.Group();
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 1.6), matCache.get('_metal'));
    plank.position.set(0, 0, 0.8);
    ramp.add(plank);
    ramp.position.set(0, 0.35, 1.02);
    ramp.rotation.x = -Math.PI / 2;
    ramp.visible = false;
    ramp.userData.ramp = true;
    g.add(ramp);
    return g;
  },
  engine(p) {
    return engineGroup(p, 1);
  },
  bigengine(p) {
    return engineGroup(p, 1.3);
  },
};

function engineGroup(p, s) {
  const g = new THREE.Group();
  const h = PARTS[p.type].height;
  const mount = mesh(lathe([[0.001, h], [1, h], [1, h - 0.15], [0.62 * s, h - 0.5]]), paintMat(p.paint));
  const bell = mesh(lathe([[0.36 * s, h - 0.45], [0.42 * s, h - 0.62], [0.62 * s, (h - 0.5) * 0.4], [0.82 * s, 0], [0.7 * s, 0.02], [0.3 * s, h - 0.6]]), matCache.get('_metal'));
  g.add(mount, bell);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.6 * s, 20), new THREE.MeshBasicMaterial({ color: 0xff9a3c }));
  glow.rotation.x = Math.PI / 2;
  glow.position.y = 0.05;
  g.add(glow);
  g.userData.engine = { x: 0, y: 0, scale: s };
  return g;
}

const radialBuilders = {
  fins(r, part) {
    const g = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.95, -0.45);
    shape.lineTo(1.0, 0.15);
    shape.quadraticCurveTo(0.4, 0.6, 0, 1.5);
    shape.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
    geo.translate(0, 0, -0.07);
    for (let k = 0; k < 4; k++) {
      const f = mesh(geo, paintMat(r.paint));
      const a = (k * Math.PI) / 2;
      const holder = new THREE.Group();
      holder.rotation.y = a;
      f.position.set(0.95, 0.05, 0);
      holder.add(f);
      g.add(holder);
    }
    return g;
  },
  legs(r, part) {
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const holder = new THREE.Group();
      holder.rotation.y = Math.PI / 4 + (k * Math.PI) / 2;
      const top = new THREE.Vector3(0.9, 1.1, 0);
      const foot = new THREE.Vector3(1.7, -1.05, 0);
      const len = top.distanceTo(foot);
      const strut = mesh(new THREE.CylinderGeometry(0.1, 0.12, len, 8), paintMat(r.paint));
      strut.position.copy(top).add(foot).multiplyScalar(0.5);
      strut.rotation.z = Math.atan2(foot.x - top.x, top.y - foot.y);
      const pad = mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.14, 12), matCache.get('_metal'));
      pad.position.copy(foot).add(new THREE.Vector3(0, 0.02, 0));
      const brace = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 6), matCache.get('_metal'));
      brace.position.set(1.15, -0.1, 0);
      brace.rotation.z = -0.9;
      holder.add(strut, pad, brace);
      g.add(holder);
    }
    return g;
  },
  boosters(r, part) {
    const g = new THREE.Group();
    const h = Math.max(1.6, part.height * 0.95);
    g.userData.engines = [];
    for (const side of [-1, 1]) {
      const b = new THREE.Group();
      const body = mesh(new THREE.CylinderGeometry(0.45, 0.45, h, 18), paintMat(r.paint));
      body.position.y = h / 2 + 0.35;
      const cone = mesh(lathe([[0.45, 0], [0.3, 0.4], [0.001, 0.62]], 18), paintMat('cream'));
      cone.position.y = h + 0.35;
      const noz = mesh(lathe([[0.2, 0.36], [0.4, 0], [0.3, 0.02], [0.15, 0.3]], 14), matCache.get('_metal'));
      const strut = mesh(new THREE.BoxGeometry(0.5, 0.18, 0.18), matCache.get('_metal'));
      strut.position.set(-side * 0.45, h * 0.6, 0);
      b.add(body, cone, noz, strut);
      b.position.set(side * 1.5, -0.35, 0);
      g.add(b);
      g.userData.engines.push({ x: side * 1.5, y: -0.35, scale: 0.55 });
    }
    return g;
  },
  lights(r, part) {
    const g = new THREE.Group();
    const cols = [0xffd36b, 0xff8a5c, 0x9fe8ff, 0xfff4c2];
    g.userData.lights = [];
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: cols[i % cols.length] }));
      m.position.set(Math.cos(a) * 1.05, part.height * 0.5 + Math.sin(a * 2) * 0.25, Math.sin(a) * 1.05);
      g.add(m);
      g.userData.lights.push(m);
    }
    return g;
  },
};

/**
 * Build the rocket. Returns { group, parts, engines, lights, height, bottom }.
 * The group's origin is the lowest point of the rocket (where it touches the ground).
 */
export function buildRocket(design) {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);
  const parts = [];
  const engines = [];
  const lights = [];
  let y = 0;
  let minY = 0;
  for (let i = design.stack.length - 1; i >= 0; i--) {
    const p = design.stack[i];
    const def = PARTS[p.type];
    const g = builders[p.type](p);
    g.position.y = y;
    g.userData.partIndex = i;
    inner.add(g);
    if (g.userData.engine) engines.push({ x: 0, y, scale: g.userData.engine.scale });
    if (p.radial) {
      const r = radialBuilders[p.radial.type](p.radial, def);
      r.userData.partIndex = i;
      r.userData.radial = true;
      g.add(r);
      for (const e of r.userData.engines || []) engines.push({ x: e.x, y: y + e.y, scale: e.scale });
      if (r.userData.lights) lights.push(...r.userData.lights);
      if (p.radial.type === 'legs') minY = Math.min(minY, y - 1.12);
      if (p.radial.type === 'boosters') minY = Math.min(minY, y - 0.35);
    }
    parts.push({ index: i, y0: y, y1: y + def.height, group: g });
    y += def.height;
  }
  inner.position.y = -minY;
  for (const part of parts) {
    part.y0 -= minY;
    part.y1 -= minY;
  }
  for (const e of engines) e.y -= minY;
  return { group, inner, parts, engines, lights, height: y - minY };
}

/** Which stack part (index) a raycast hit belongs to. */
export function partIndexOf(object) {
  for (let o = object; o; o = o.parent) {
    if (o.userData.partIndex !== undefined) return o.userData.partIndex;
  }
  return -1;
}
