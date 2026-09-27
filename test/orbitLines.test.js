// Orbit lines and the path near the ground (#48). Every orbit line lies in the flight plane, so a
// world's own orbit runs through its middle (and its planet's, or the comet's, can pass through it
// too): from the buggy they showed as thin lines rising out of the ground across the sky. The real
// FlightScene's line objects and updateLines(), with a real three.js camera; nothing is drawn.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FlightScene, orbitLineDist, lineShown, LINE_CLEAR, LINE_NEAR } from '../src/scenes/flight.js';
import { mission, parkAt } from './missions.js';

globalThis.window ??= {};
Object.assign(globalThis.window, { innerWidth: 844, innerHeight: 390 });

const LANDABLE = ['homestead', 'pebble', 'dusty', 'nibble', 'sizzle', 'frosty', 'flip', 'ducky', 'misty'];

function setup(m) {
  const s = Object.create(FlightScene.prototype);
  s.app = {
    progress: { settings: {}, has: () => true, explained: () => true, markExplained() {}, earn() {} },
    pip: () => true, afterPip() {}, audio: { play() {}, setMood() {} }, hud: { showTarget() {} },
  };
  Object.assign(s, {
    flight: m.flight, autopilot: m.ap, system: m.sys, time: 0, crashed: false, target: null, mode: 'flight', pause: null, clock: null,
    input: { left: false, right: false, go: false, fine: false }, warpIndex: 0, manualWarp: false,
    snapshots: [], snapTimer: 0, predTimer: 0, prediction: null, origin: { x: 0, y: 0 }, tmp: {}, tmp2: {}, tmp3: {}, kindAt: {},
    mapAt: { x: 0, y: 0 }, mapOff: { x: 0, y: 0 }, mapGoalAt: { x: 0, y: 0 }, mapDist: 2000, zoom: 1, carry: 1, camSettle: false, soiGlow: null, highlight: null,
    camera: new THREE.PerspectiveCamera(50, 844 / 390, 1, 3e6), camUp: new THREE.Vector3(0, 1, 0), rocket: { height: 6 },
    drive: { active: false, cancel() {} }, showing: null, coachKey: null, coachSpent: null, coachWait: 0,
    scene: new THREE.Scene(), lineGroup: new THREE.Group(), segLines: [], orbitLines: new Map(), ghosts: new Map(),
  });
  s.scene.add(s.lineGroup);
  // As the constructor builds them.
  for (const b of m.sys.bodies) {
    if (!b.parent) continue;
    const pts = b.orbitPoints(720);
    const line = s.makeLine(pts, b.color, 2, 0.45);
    line.userData.pts = pts;
    s.orbitLines.set(b, line);
  }
  s.burst = s.discover = s.checkDiscoveries = s.checkBand = () => {};
  return s;
}

/** One frame's positions, camera and lines, as FlightScene.update() does them. */
function frame(s, dt = 1 / 60) {
  s.time += dt;
  s.fly(dt);
  const rw = s.flight.worldPos({});
  s.origin.x = rw.x;
  s.origin.y = rw.y;
  s.updateCamera(dt);
  s.updateLines();
}

/** Is it drawn? (visible all the way up, and not faded to nothing) */
const drawn = (o) => {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return !o.material || o.material.opacity > 0.001;
};

/** Every line-like object in the scene that would be drawn. */
const drawnLines = (s) => {
  const out = [];
  s.scene.traverse((o) => { if ((o.isLine2 || o.isLine || o.isLineSegments || o.isMesh) && drawn(o)) out.push(o); });
  return out;
};

function land(m, id, t) {
  const body = m.sys.byId[id];
  const a = body.nearestLandable(Math.PI / 2);
  m.flight.state = { body, x: 0, y: 0, vx: 0, vy: 0, angle: a, t, landed: true, landAngle: a, crashed: false, flightTime: 10 };
  m.flight.placeOnSurface();
  return body;
}

/** How close a body's orbit line passes to `near`'s middle at time t. */
function lineDist(b, near, t) {
  const w = b.parent.worldPos(t, {});
  const p = near.worldPos(t, {});
  return orbitLineDist(b, b.orbitPoints(720), p.x - w.x, p.y - w.y);
}

describe('orbit lines near the ground (#48)', () => {
  it('measures how close an orbit line passes, circles and the comet\'s ellipse', () => {
    const m = mission();
    const pebble = m.sys.byId.pebble;
    expect(orbitLineDist(pebble, null, 1400, 0)).toBeCloseTo(0);
    expect(orbitLineDist(pebble, null, 0, 1500)).toBeCloseTo(100);
    // The comet: against a fine sampling of its ellipse.
    const ducky = m.sys.byId.ducky;
    const fine = ducky.orbitPoints(20000);
    for (const [x, y] of [[0, 12000], [-20000, 5000], [30000, -30000], [100, 100]]) {
      let best = Infinity;
      for (let i = 0; i < fine.length; i += 3) best = Math.min(best, Math.hypot(fine[i] - x, fine[i + 1] - y));
      expect(orbitLineDist(ducky, ducky.orbitPoints(720), x, y)).toBeCloseTo(best, 0);
    }
  });

  it('a line through the world fades out close up, and shows from far away', () => {
    expect(lineShown(0, 30, 10)).toBe(0);
    expect(lineShown(LINE_CLEAR[0] * 10, 30, 10)).toBe(0);
    expect(lineShown(LINE_CLEAR[1] * 10, 30, 10)).toBe(1);
    expect(lineShown(0, LINE_NEAR[1] * 10, 10)).toBe(1);
    expect(lineShown(0, (LINE_NEAR[0] + LINE_NEAR[1]) * 5, 10)).toBeCloseTo(0.5);
  });

  it('nothing from the flight or map views is drawn while driving', () => {
    const m = parkAt(mission(), 'homestead', 0);
    const s = setup(m);
    for (let i = 0; i < 20; i++) frame(s);
    expect(s.segLines.filter(drawn).length).toBeGreaterThan(0); // the path, in orbit
    s.showGhost(m.sys.byId.pebble, 0, 0);
    s.mode = 'drive';
    s.updateLines();
    expect(drawnLines(s)).toEqual([]);
    // And back in the flight view they're there again.
    s.mode = 'flight';
    frame(s);
    expect(s.segLines.filter(drawn).length).toBeGreaterThan(0);
    expect([...s.orbitLines.values()].filter(drawn).length).toBeGreaterThan(5);
  });

  it('landed on every world, no orbit line drawn in the flight view goes through its ground', () => {
    // Many times over a long span: moons go round their planet (whose orbit passes by them) and
    // the comet's ellipse sweeps past the planets.
    for (const id of LANDABLE) {
      const m = mission();
      let hidden = 0;
      for (let k = 0; k < 60; k++) {
        const t = k * 997;
        const near = land(m, id, t);
        const s = setup(m);
        frame(s);
        frame(s);
        expect(s.orbitLines.get(near).visible, `${id}'s own orbit at t=${t}`).toBe(false);
        for (const [b, line] of s.orbitLines) {
          const d = lineDist(b, near, t);
          if (d < LINE_CLEAR[0] * near.radius) {
            expect(drawn(line), `${b.id}'s orbit through ${id} at t=${t}`).toBe(false);
            if (b !== near) hidden++;
          } else if (d > LINE_CLEAR[1] * near.radius) {
            expect(drawn(line), `${b.id}'s orbit, clear of ${id}`).toBe(true);
          }
        }
      }
      // Moons meet their planet's orbit line now and then (Nibble, Flip: straight through).
      if (id === 'nibble' || id === 'flip') expect(hidden, id).toBeGreaterThan(0);
    }
  });

  it('from far out and on the map, every orbit line shows', () => {
    const m = mission();
    const near = land(m, 'flip', 0);
    const s = setup(m);
    s.zoom = 1000; // the flight camera's furthest
    frame(s);
    expect(s.orbitLines.get(near).visible).toBe(true);
    expect([...s.orbitLines.values()].every(drawn)).toBe(true);
    s.zoom = 1;
    frame(s);
    expect(s.orbitLines.get(near).visible).toBe(false);
    s.mode = 'map';
    s.mapFocus = near;
    s.updateLines();
    expect([...s.orbitLines.values()].every(drawn)).toBe(true);
  });
});
