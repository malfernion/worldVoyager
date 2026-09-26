// The camera never changes by itself when a new world takes over (#49). Real SOI hand-offs,
// flown with 🤖 Take me there (Homestead to Pebble and back) and placed at every world's SOI
// edge, through the real FlightScene (fly(), the flight events, updateCamera() with a real
// three.js camera; nothing is drawn). Each frame we look at where the camera is from the
// rocket, which way it looks, its up, its distance and where the rocket is on screen.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FlightScene } from '../src/scenes/flight.js';
import { flightDist, flightAutoDist, handoffCarry, handoffCalm, easeCarry, HANDOFF_LOW } from '../src/ui/zoom.js';
import { mission, parkAt } from './missions.js';

globalThis.window ??= {};
Object.assign(globalThis.window, { innerWidth: 844, innerHeight: 390 });

function setup(m, mode = 'flight') {
  const s = Object.create(FlightScene.prototype);
  s.app = {
    progress: { settings: {}, has: () => true, explained: () => true, markExplained() {}, earn() {} },
    pip: () => true, afterPip() {}, audio: { play() {}, setMood() {} }, hud: { showTarget() {} },
  };
  Object.assign(s, {
    flight: m.flight, autopilot: m.ap, system: m.sys, time: 0, crashed: false, target: null, mode: 'flight', pause: null, clock: null,
    input: { left: false, right: false, go: false, fine: false }, warpIndex: 0, manualWarp: false,
    snapshots: [], snapTimer: 0, predTimer: 0, prediction: null, origin: { x: 0, y: 0 }, tmp: {}, tmp2: {}, tmp3: {}, kindAt: {},
    pan: { x: 0, y: 0 }, mapDist: 2000, zoom: 1, carry: 1, camSettle: false, soiGlow: null,
    camera: new THREE.PerspectiveCamera(50, 844 / 390, 1, 3e6), camUp: new THREE.Vector3(0, 1, 0), rocket: { height: 6 },
    drive: { active: false, cancel() {} }, showing: null, coachKey: null, coachSpent: null, coachWait: 0,
  });
  s.burst = s.discover = s.checkDiscoveries = s.checkBand = () => {};
  m.flight.on((type, d) => s.onFlightEvent(type, d));
  if (mode === 'map') s.toggleMap();
  return s;
}

/** One frame as FlightScene.update() does it (positions and camera), and what the view looks like. */
function frame(s, dt = 1 / 60) {
  s.time += dt;
  s.fly(dt);
  const f = s.flight;
  if (s.mode === 'map') {
    s.easeMap(dt);
    s.glideMap(dt);
  }
  const rw = f.worldPos({});
  if (s.mode === 'flight') {
    s.origin.x = rw.x;
    s.origin.y = rw.y;
  } else {
    const fw = s.mapFocus.worldPos(f.state.t, {});
    s.origin.x = fw.x + s.pan.x;
    s.origin.y = fw.y + s.pan.y;
  }
  s.updateCamera(dt);
  const c = s.camera;
  const rocket = new THREE.Vector3(rw.x - s.origin.x, rw.y - s.origin.y, 0);
  const dir = new THREE.Vector3();
  c.getWorldDirection(dir);
  const ndc = rocket.clone().project(c);
  return {
    body: f.state.body, dist: s.viewDist(), rel: c.position.clone().sub(rocket), dir, up: c.up.clone(),
    screen: [ndc.x, ndc.y], focus: s.mapFocus, mapDist: s.mapDist,
  };
}

/** How much the view changed from one frame to the next. */
function change(a, b) {
  return {
    dist: Math.abs(Math.log(b.dist / a.dist)),
    rel: b.rel.distanceTo(a.rel) / a.rel.length(),
    aim: a.dir.angleTo(b.dir),
    up: a.up.angleTo(b.up),
    screen: Math.hypot(b.screen[0] - a.screen[0], b.screen[1] - a.screen[1]),
  };
}

/** Fly frames until the rocket's world changes (or `max` frames); the frames either side. */
function toHandoff(s, max = 60 * 60 * 20) {
  let prev = frame(s);
  for (let i = 0; i < max && !s.flight.state.crashed; i++) {
    const v = frame(s);
    if (v.body !== prev.body) return { before: prev, after: v };
    prev = v;
  }
  throw new Error(`no hand-off (${s.flight.state.body.id}${s.flight.state.crashed ? ', crashed' : ''})`);
}

/** The largest per-frame change over the next `n` frames. */
function worstOver(s, from, n) {
  const worst = { dist: 0, rel: 0, aim: 0, up: 0, screen: 0 };
  let prev = from;
  for (let i = 0; i < n; i++) {
    const v = frame(s);
    const c = change(prev, v);
    for (const k in worst) worst[k] = Math.max(worst[k], c[k]);
    prev = v;
  }
  return worst;
}

// Per frame (1/60 s): the easing after a hand-off is ~3% of the distance a frame at most,
// and the view's "down" turns at most 1.5 rad/s. Before #49 entering Pebble jumped 1034 m to 213 m.
const STEP = { dist: 0.04, rel: 0.06, aim: 0.03, up: 0.03 };

describe('the camera across an SOI hand-off (#49)', () => {
  it('flight view: flying into Pebble\'s space and out again, nothing jumps', () => {
    const m = parkAt(mission(), 'homestead', 0);
    const s = setup(m);
    s.zoom = 1.7; // the player's own zoom
    m.ap.start('goto', m.sys.byId.pebble);
    for (const to of ['pebble', 'homestead']) {
      if (to === 'homestead') m.ap.start('goto', m.sys.byId.homestead);
      const { before, after } = toHandoff(s);
      expect(after.body.id).toBe(to);
      const c = change(before, after);
      for (const k in STEP) expect(c[k], `${to}: ${k}`).toBeLessThan(STEP[k]);
      expect(c.screen).toBeLessThan(0.01);
      // The player's zoom survives; the hand-off's difference is in the carry, which eases back.
      expect(s.zoom).toBe(1.7);
      expect(s.carry).not.toBeCloseTo(1, 1);
      const w = worstOver(s, after, 60 * 3);
      for (const k in STEP) expect(w[k], `${to} after: ${k}`).toBeLessThan(STEP[k]);
      expect(w.screen).toBeLessThan(0.01);
    }
  });

  it('map: keeps its focus and zoom, the rocket doesn\'t jump on screen, the new world\'s label glows', () => {
    const m = parkAt(mission(), 'homestead', 0);
    const s = setup(m, 'map');
    const focus = s.mapFocus;
    const dist = s.mapDist;
    m.ap.start('goto', m.sys.byId.pebble);
    for (const to of ['pebble', 'homestead']) {
      if (to === 'homestead') m.ap.start('goto', m.sys.byId.homestead);
      const { before, after } = toHandoff(s);
      expect(after.body.id).toBe(to);
      expect(after.focus).toBe(focus);
      expect(after.mapDist).toBe(dist);
      expect(change(before, after).screen).toBeLessThan(0.01);
      expect(s.soiGlow.body.id).toBe(to);
      const w = worstOver(s, after, 60 * 3);
      expect(w.screen).toBeLessThan(0.01);
      expect(w.dist).toBe(0);
      expect(s.mapFocus).toBe(focus);
    }
    // Back in the flight view, the flight camera has settled meanwhile (it eases on the map too).
    s.toggleMap();
    expect(Math.abs(Math.log(s.carry))).toBeLessThan(0.05);
  });

  it('flight view: the map open across the hand-off, then closed, is where it would be', () => {
    const m = parkAt(mission(), 'homestead', 0);
    const s = setup(m, 'map');
    m.ap.start('goto', m.sys.byId.pebble);
    toHandoff(s);
    s.toggleMap();
    const a = frame(s);
    const w = worstOver(s, a, 60);
    for (const k in STEP) expect(w[k], k).toBeLessThan(STEP[k]);
  });

  // Every world's SOI edge, in and out, coasting and burning.
  const edges = [];
  for (const id of ['homestead', 'pebble', 'dusty', 'nibble', 'ringo', 'sizzle', 'frosty', 'misty', 'tumble', 'flip', 'ducky']) edges.push([id, 'enter'], [id, 'exit']);
  it.each(edges)('%s, %s: the camera distance, aim and up stay put', (id, kind) => {
    const m = mission();
    const body = m.sys.byId[id];
    for (const burn of [false, true]) {
      const s = setup(m);
      // Just outside (in) or inside (out) the SOI edge, moving across it at 8 m/s.
      const t = 1000;
      const inward = kind === 'enter';
      const a = 0.7;
      const r = body.soi + (inward ? 3 : -3);
      const p = body.relPos(t);
      const v = body.relVel(t);
      const ux = Math.cos(a), uy = Math.sin(a);
      const sp = inward ? -8 : 8;
      m.flight.state = inward
        ? { body: body.parent, x: p.x + ux * r, y: p.y + uy * r, vx: v.x + ux * sp, vy: v.y + uy * sp, angle: a + Math.PI, t, landed: false, landAngle: 0, crashed: false, flightTime: 10 }
        : { body, x: ux * r, y: uy * r, vx: ux * sp, vy: uy * sp, angle: a, t, landed: false, landAngle: 0, crashed: false, flightTime: 10 };
      s.input.go = burn;
      // Start the camera settled where it is.
      s.carry = 1;
      s.camUpAngle = undefined;
      const { before, after } = toHandoff(s, 60 * 10);
      expect(after.body).toBe(inward ? body : body.parent);
      const c = change(before, after);
      for (const k in STEP) expect(c[k], `${k}${burn ? ' (burning)' : ''}`).toBeLessThan(STEP[k]);
      if (burn) {
        // Mid-burn nothing settles: the distance stays where it was (apart from our own climb).
        const carry = s.carry;
        worstOver(s, after, 30);
        expect(s.carry).toBe(carry);
      } else {
        const w = worstOver(s, after, 60 * 2);
        for (const k in STEP) expect(w[k], `${k} after`).toBeLessThan(STEP[k]);
      }
    }
  });
});

describe('the hand-off carry (#49)', () => {
  it('keeps the camera distance where it was, and the player\'s zoom multiplier', () => {
    for (const [oldAlt, newAlt] of [[1200, 220], [220, 900], [2100, 30000], [50, 400]]) {
      for (const zoom of [0.2, 1, 3]) {
        const carry = handoffCarry(1, flightAutoDist(oldAlt), flightAutoDist(newAlt));
        expect(flightDist(flightAutoDist(newAlt) * carry, zoom)).toBeCloseTo(flightDist(flightAutoDist(oldAlt), zoom), 6);
      }
    }
  });

  it('never settles mid-burn or close to the ground; settles in about two seconds when calm', () => {
    expect(handoffCalm(1, 500, false)).toBe(0);
    expect(handoffCalm(0, HANDOFF_LOW - 1, false)).toBe(0);
    expect(handoffCalm(0, 0, true)).toBe(1);
    expect(handoffCalm(0, 60, false)).toBeLessThan(handoffCalm(0, 300, false));
    expect(easeCarry(4, 1 / 60, 0)).toBe(4);
    let c = 4.8;
    let t = 0;
    for (; c !== 1 && t < 10; t += 1 / 60) c = easeCarry(c, 1 / 60, 1);
    expect(t).toBeGreaterThan(1.5);
    expect(t).toBeLessThan(6);
    // After 2 s it's nearly there.
    c = 4.8;
    for (let i = 0; i < 120; i++) c = easeCarry(c, 1 / 60, 1);
    expect(Math.abs(Math.log(c))).toBeLessThan(0.1);
  });
});
