// The little solar system. Distances are "game metres": planets are Outer-Wilds small,
// orbits are compressed, but everything obeys real two-body gravity (patched conics).
import { makeTerrain } from './terrain.js';

export const BODY_DEFS = [
  {
    id: 'ember', name: 'Ember', kind: 'star', radius: 1500, gravity: 44.4, soi: Infinity, spaceLine: 3000,
    color: 0xffc35a, icon: '☀️',
    blurb: 'Ember is our star. It is a giant ball of glowing hot gas, just like the Sun. Too hot to land on!',
  },
  {
    id: 'homestead', name: 'Homestead', parent: 'ember', orbitRadius: 12000, phase: -0.45,
    radius: 300, gravity: 10, soi: 2400, spaceLine: 70, terrain: 'home', atmosphere: 0x9fd4ff,
    color: 0x6fa045, icon: '🏡', water: true,
    blurb: 'Homestead is home! Trees, oceans and a cosy campfire. It is like our Earth.',
  },
  {
    id: 'pebble', name: 'Pebble', parent: 'homestead', orbitRadius: 1400, phase: 0.6,
    radius: 80, gravity: 2, soi: 300, spaceLine: 20, terrain: 'pebble',
    color: 0xb8b2a6, icon: '🌕',
    blurb: 'Pebble is Homestead\'s moon, covered in craters, just like our Moon. Astronauts walked on the real Moon!',
  },
  {
    id: 'dusty', name: 'Dusty', parent: 'ember', orbitRadius: 20000, phase: 2.5,
    radius: 220, gravity: 6, soi: 2400, spaceLine: 50, terrain: 'dusty', atmosphere: 0xffb088,
    color: 0xd0703f, icon: '🔴',
    blurb: 'Dusty is a red, rusty planet like Mars. Mars has the biggest volcano in the whole solar system!',
  },
  {
    id: 'nibble', name: 'Nibble', parent: 'dusty', orbitRadius: 950, phase: 4.0,
    radius: 30, gravity: 0.9, soi: 170, spaceLine: 15, terrain: 'nibble',
    color: 0x8f7c68, icon: '🥔',
    blurb: 'Nibble is a tiny lumpy moon shaped like a potato, just like Phobos, a moon of Mars.',
  },
  {
    id: 'ringo', name: 'Ringo', parent: 'ember', orbitRadius: 34000, phase: 0.2,
    radius: 1200, gravity: 8, soi: 9000, spaceLine: 250, terrain: 'ringo', gas: true, atmosphere: 0xffe2b0,
    rings: { inner: 1.45, outer: 2.25 },
    color: 0xd9b77e, icon: '🪐',
    blurb: 'Ringo is a giant ball of gas with beautiful rings, like Saturn. Saturn is so light it could float in a giant bathtub!',
  },
  {
    id: 'sizzle', name: 'Sizzle', parent: 'ringo', orbitRadius: 2900, phase: 1.0,
    radius: 110, gravity: 3.5, soi: 420, spaceLine: 25, terrain: 'sizzle',
    color: 0xf0cf4a, icon: '🌋',
    blurb: 'Sizzle is covered in volcanoes, just like Io, a moon of Jupiter. Io has more volcanoes than anywhere else!',
  },
  {
    id: 'frosty', name: 'Frosty', parent: 'ringo', orbitRadius: 4400, phase: 3.3,
    radius: 140, gravity: 3, soi: 650, spaceLine: 30, terrain: 'frosty',
    color: 0xdbe9f2, icon: '❄️',
    blurb: 'Frosty is an icy moon like Europa, a moon of Jupiter. Under Europa\'s ice there is a huge hidden ocean!',
  },
  {
    // The longest trip. Tipped on its side like Uranus: only the look (mesh, bands, rings);
    // the flight stays in the z = 0 plane.
    id: 'tumble', name: 'Tumble', parent: 'ember', orbitRadius: 56000, phase: 2.9,
    radius: 900, gravity: 7, soi: 7000, spaceLine: 180, terrain: 'tumble', gas: true, atmosphere: 0xb8f4ee,
    rings: { inner: 1.5, outer: 1.95, faint: true },
    color: 0x9fdcd6, icon: '🔵',
    blurb: 'Tumble is an icy blue giant, like Uranus. Uranus is tipped over on its side, so it rolls around the Sun like a ball!',
  },
  {
    // Goes round the wrong way (counter-clockwise), like Triton around Neptune.
    id: 'flip', name: 'Flip', parent: 'tumble', orbitRadius: 3000, phase: 2.0, retrograde: true,
    radius: 120, gravity: 2.5, soi: 420, spaceLine: 25, terrain: 'flip',
    color: 0xe6d3cc, icon: '🔄',
    blurb: 'Flip goes around Tumble the wrong way, just like Triton, a moon of Neptune. Triton has icy geysers that shoot up really high!',
  },
];

const SURFACE_SAMPLES = 2048;

export class Body {
  constructor(def) {
    Object.assign(this, def);
    this.mu = def.gravity * def.radius * def.radius;
    this.parentId = def.parent || null;
    this.parent = null;
    this.children = [];
    // Which way it goes around its parent on screen: -1 clockwise (almost everything),
    // +1 counter-clockwise for a backwards moon.
    this.orbitDir = def.retrograde ? 1 : -1;
    this.terrainFn = def.kind === 'star' ? null : makeTerrain(def.terrain);
    this.solid = !def.gas && def.kind !== 'star';
    this.surface = new Float32Array(SURFACE_SAMPLES + 1);
    this.maxSurface = def.radius;
    this.minSurface = def.radius;
    this.setSurfaceFromFn();
  }

  /** Sample the terrain along the orbital plane (z = 0) to build the physics surface. */
  setSurfaceFromFn() {
    for (let i = 0; i <= SURFACE_SAMPLES; i++) {
      const a = (i / SURFACE_SAMPLES) * Math.PI * 2;
      const h = this.terrainFn ? this.terrainFn.height(Math.cos(a), Math.sin(a), 0) : 0;
      this.surface[i] = this.radius + h;
    }
    this.updateSurfaceBounds();
  }

  updateSurfaceBounds() {
    let lo = Infinity, hi = 0;
    for (const r of this.surface) {
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
    this.minSurface = lo;
    this.maxSurface = hi;
  }

  /** Radius of the ground at a planar angle. */
  surfaceAt(angle) {
    let f = (angle / (Math.PI * 2)) % 1;
    if (f < 0) f += 1;
    const x = f * SURFACE_SAMPLES;
    const i = Math.floor(x);
    const t = x - i;
    return this.surface[i] * (1 - t) + this.surface[Math.min(i + 1, SURFACE_SAMPLES)] * t;
  }

  /** Orbital angular speed around the parent (negative = clockwise on screen, positive = backwards). */
  get angularSpeed() {
    if (!this.parent) return 0;
    return this.orbitDir * Math.sqrt(this.parent.mu / this.orbitRadius ** 3);
  }

  get orbitalPeriod() {
    return this.parent ? (Math.PI * 2) / Math.abs(this.angularSpeed) : Infinity;
  }

  angleAt(t) {
    return this.phase + this.angularSpeed * t;
  }

  /** Position relative to parent at time t. */
  relPos(t, out = {}) {
    if (!this.parent) {
      out.x = 0; out.y = 0;
      return out;
    }
    const a = this.angleAt(t);
    out.x = this.orbitRadius * Math.cos(a);
    out.y = this.orbitRadius * Math.sin(a);
    return out;
  }

  relVel(t, out = {}) {
    if (!this.parent) {
      out.x = 0; out.y = 0;
      return out;
    }
    const a = this.angleAt(t);
    const w = this.angularSpeed * this.orbitRadius;
    out.x = -w * Math.sin(a);
    out.y = w * Math.cos(a);
    return out;
  }

  worldPos(t, out = {}) {
    out.x = 0; out.y = 0;
    let b = this;
    const tmp = {};
    while (b.parent) {
      b.relPos(t, tmp);
      out.x += tmp.x;
      out.y += tmp.y;
      b = b.parent;
    }
    return out;
  }

  worldVel(t, out = {}) {
    out.x = 0; out.y = 0;
    let b = this;
    const tmp = {};
    while (b.parent) {
      b.relVel(t, tmp);
      out.x += tmp.x;
      out.y += tmp.y;
      b = b.parent;
    }
    return out;
  }

  /** Ancestors from this body up to the root (inclusive of this). */
  lineage() {
    const out = [];
    for (let b = this; b; b = b.parent) out.push(b);
    return out;
  }

  isAncestorOf(other) {
    for (let b = other; b; b = b.parent) if (b === this) return true;
    return false;
  }
}

export function createSystem() {
  const bodies = BODY_DEFS.map((d) => new Body(d));
  const byId = Object.fromEntries(bodies.map((b) => [b.id, b]));
  for (const b of bodies) {
    if (b.parentId) {
      b.parent = byId[b.parentId];
      b.parent.children.push(b);
    }
  }
  return { bodies, byId, root: byId.ember, home: byId.homestead };
}

export const LAUNCH_ANGLE = Math.PI / 2;
