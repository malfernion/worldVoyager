// Fast travel (#27): tap the path on the map to drop a ⏰, time speeds up until we get there,
// then the game pauses. The pure rules, then real flights through FlightScene.tapMap / fly
// (headless: a three.js camera does the projection, nothing is drawn).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  TAP_RADIUS, MIN_LEAD, CRASH_GAP, ARRIVE_LEAD, clockWindow, clockOnPath, clockAllowed, pickOnPath, travelWarp, arrived,
} from '../src/ui/fastTravel.js';
import { FlightScene, WARP_LEVELS } from '../src/scenes/flight.js';
import { MARKER_LINES } from '../src/ui/markers.js';
import { sentencesOf } from '../src/ui/speech.js';
import { mission, parkAt } from './missions.js';

const HERE = 'We\'re here! Take your time.';

describe('fast travel: picking a time on the path (#27)', () => {
  // A straight line on screen from (0, 100) to (400, 100), t from 10 to 50.
  const line = [[0, 10], [100, 20], [200, 30], [300, 40], [400, 50]].map(([x, t]) => ({ x, y: 100, t }));

  it('a tap near the line gets the time along it, interpolated', () => {
    expect(pickOnPath([line], 150, 110).t).toBeCloseTo(25);
    expect(pickOnPath([line], 0, 100).t).toBeCloseTo(10);
    expect(pickOnPath([line], 399, 95).t).toBeCloseTo(49.9);
  });

  it('a finger\'s width away counts; further off is not on the path', () => {
    expect(pickOnPath([line], 200, 100 + TAP_RADIUS - 1)).not.toBe(null);
    expect(pickOnPath([line], 200, 100 + TAP_RADIUS + 1)).toBe(null);
    expect(pickOnPath([line], 460, 100)).toBe(null);
    expect(pickOnPath([], 0, 0)).toBe(null);
  });

  it('where the path crosses itself, the nearer bit wins, else the sooner', () => {
    // A second piece crossing at (200, 100) later on, going down the screen.
    const cross = [{ x: 200, y: 0, t: 100 }, { x: 200, y: 200, t: 120 }];
    expect(pickOnPath([line, cross], 201, 100).t).toBeCloseTo(30);
    expect(pickOnPath([cross, line], 201, 100).t).toBeCloseTo(30);
    // Clearly nearer the later piece: that one.
    expect(pickOnPath([line, cross], 200, 125).t).toBeCloseTo(112.5);
  });

  it('skips bits of path that are off screen', () => {
    const gap = [line[0], line[1], null, line[3], line[4]];
    expect(pickOnPath([gap], 250, 100)).toBe(null);
    expect(pickOnPath([gap], 350, 100).t).toBeCloseTo(45);
  });

  it('refines along the true curve, which a straight piece cuts across', () => {
    // A circle of radius 200 round (0, 0), sampled coarsely; t is the angle.
    const at = (t) => ({ x: 200 * Math.cos(t), y: 200 * Math.sin(t) });
    const pts = [0, 0.5, 1, 1.5].map((t) => ({ ...at(t), t }));
    const tap = at(0.25);
    const hit = pickOnPath([pts], tap.x, tap.y, TAP_RADIUS, at);
    expect(hit.t).toBeCloseTo(0.25, 3);
    expect(hit.d).toBeLessThan(0.1);
  });
});

describe('fast travel: where a ⏰ may go, and when it goes away (#27)', () => {
  const orbit = [{ t0: 100, t1: 160, end: 'none' }];
  const crash = [{ t0: 100, t1: 130, end: 'exit' }, { t0: 130, t1: 150, end: 'impact' }];

  it('only ahead of the rocket, up to the end of the path, never right on a crash', () => {
    expect(clockWindow(orbit, 100)).toEqual([100 + MIN_LEAD, 160]);
    expect(clockWindow(crash, 100)).toEqual([100 + MIN_LEAD, 150 - CRASH_GAP]);
    expect(clockWindow([], 100)).toBe(null);
    expect(clockWindow(undefined, 100)).toBe(null);
    // About to crash: nowhere left to go.
    expect(clockWindow([{ t0: 100, t1: 104, end: 'impact' }], 100)).toBe(null);
  });

  it('keeps its time while it is still on the path, as the rocket gets closer', () => {
    expect(clockOnPath(orbit, 150, 100)).toBe(true);
    expect(clockOnPath(orbit, 150, 149.5)).toBe(true);
    // Reached or passed.
    expect(clockOnPath(orbit, 150, 150)).toBe(false);
  });

  it('goes when the path no longer gets there: a crash comes first, or we landed', () => {
    expect(clockOnPath(crash, 140, 100)).toBe(true);
    // The engine or a nudge moved the crash earlier: stop before the ground.
    expect(clockOnPath([{ t0: 100, t1: 135, end: 'impact' }], 140, 100)).toBe(false);
    expect(clockOnPath(null, 140, 100)).toBe(false);
  });

  it('only on the map, flying, while no helper is flying or coaching', () => {
    const c = { mode: 'map', crashed: false, landed: false, helper: false };
    expect(clockAllowed(c)).toBe(true);
    expect(clockAllowed({ ...c, mode: 'flight' })).toBe(false);
    expect(clockAllowed({ ...c, crashed: true })).toBe(false);
    expect(clockAllowed({ ...c, landed: true })).toBe(false);
    expect(clockAllowed({ ...c, helper: true })).toBe(false);
  });

  it('the ⏰ has one short line that says tapping it stops', () => {
    const line = MARKER_LINES.clock;
    expect(line).toMatch(/Tap it to stop/);
    for (const s of sentencesOf(line)) expect(s.split(' ').length).toBeLessThanOrEqual(10);
  });
});

describe('fast travel: how fast time goes (#27)', () => {
  const dt = 1 / 60;

  it('as fast as the levels go when far, stepping down as the ⏰ comes closer', () => {
    expect(travelWarp(5000, dt, WARP_LEVELS)).toEqual({ index: 6, warp: 1000 });
    expect(travelWarp(1000 * ARRIVE_LEAD, dt, WARP_LEVELS).index).toBe(6);
    expect(travelWarp(1000 * ARRIVE_LEAD - 1, dt, WARP_LEVELS).index).toBe(5);
    expect(travelWarp(12, dt, WARP_LEVELS).index).toBe(3);
    expect(travelWarp(0.5, dt, WARP_LEVELS)).toEqual({ index: 0, warp: 1 });
  });

  it('the last frame steps exactly onto the moment, never past it', () => {
    const tw = travelWarp(0.004, dt, WARP_LEVELS);
    expect(tw.warp * dt).toBeCloseTo(0.004, 12);
    expect(travelWarp(0, dt, WARP_LEVELS).warp).toBe(0);
    expect(travelWarp(-1, dt, WARP_LEVELS).warp).toBe(0);
  });

  it('gets there at top speed, slows down for a few seconds, and lands on the moment', () => {
    for (const far of [30, 3000, 30000]) {
      let left = far, frames = 0;
      while (!arrived(left) && frames < 10000) {
        left -= travelWarp(left, dt, WARP_LEVELS).warp * dt;
        frames++;
      }
      expect(Math.abs(left)).toBeLessThan(1e-6);
      expect(frames * dt).toBeLessThan(far / WARP_LEVELS.at(-1) + 5);
    }
  });
});

// ---- real flights ---------------------------------------------------------------------------

globalThis.window ??= {};
Object.assign(globalThis.window, { innerWidth: 844, innerHeight: 390 });

/** A flight scene with what fly() and tapMap() need, and the map centred on the world we're at. */
function setup(m) {
  const heard = [];
  const explained = new Set();
  const s = Object.create(FlightScene.prototype);
  s.app = {
    progress: { settings: {}, has: () => false, explained: (k) => explained.has(k), markExplained: (k) => explained.add(k) },
    pip: (text) => (heard.push(text), true),
    afterPip() {},
    audio: { play() {} },
  };
  Object.assign(s, {
    flight: m.flight, autopilot: m.ap, time: 0, crashed: false, target: null, mode: 'map', pause: null, clock: null,
    input: { left: false, right: false, go: false, fine: false }, warpIndex: 0, manualWarp: false,
    snapshots: [], snapTimer: 0, predTimer: 0, prediction: null, origin: { x: 0, y: 0 }, tmp3: {}, kindAt: {}, pan: { x: 0, y: 0 }, mapDist: 2000,
    camera: new THREE.PerspectiveCamera(50, 844 / 390, 1, 3e6),
  });
  const look = () => {
    const w = m.flight.state.body.worldPos(m.flight.state.t, {});
    s.origin.x = w.x;
    s.origin.y = w.y;
    s.camera.position.set(0, 0, 2000);
    s.camera.lookAt(0, 0, 0);
    s.camera.updateProjectionMatrix();
    s.camera.updateMatrixWorld();
  };
  const run = (seconds, stop = () => false) => {
    let n = 0;
    for (; n < seconds * 60 && !stop(); n++) {
      s.fly(1 / 60);
      look();
    }
    return n / 60;
  };
  look();
  s.fly(1 / 60);
  return { s, heard, explained, run, look, flight: m.flight, ap: m.ap };
}

const inOrbit = () => parkAt(mission(), 'homestead', 0);

describe('fast travel in flight (#27)', () => {
  it('in orbit: tap half an orbit ahead, travel there, pause', () => {
    const t = setup(inOrbit());
    const { s, flight } = t;
    const period = flight.elements().period;
    const t0 = flight.state.t;
    const goal = t0 + period / 2;
    // Tap a few pixels off the path, where it will be half an orbit from now.
    const frames = s.segmentFrames();
    const p = s.screenAt(frames, goal);
    expect(s.tapMap(p.x + 6, p.y - 4)).toBe(true);
    expect(s.clock.t).toBeCloseTo(goal, -1);
    const at = s.clock.t;
    // The first time, Pip says what the ⏰ does.
    expect(t.heard).toEqual([MARKER_LINES.clock]);
    const took = t.run(60, () => !!s.pause);
    expect(s.pause?.why).toBe('arrived');
    expect(Math.abs(flight.state.t - at)).toBeLessThan(1e-4);
    // Much quicker than flying there at normal speed.
    expect(took).toBeLessThan(period / 4);
    expect(s.clock).toBe(null);
    expect(s.warpIndex).toBe(0);
    expect(t.heard.at(-1)).toBe(HERE);
    // Paused: nothing moves until the child does something.
    const still = flight.state.t;
    t.run(20);
    expect(flight.state.t).toBe(still);
    expect(s.pause?.why).toBe('arrived');
    // Turning carries on.
    s.input.left = true;
    t.run(0.5);
    s.input.left = false;
    expect(s.pause).toBe(null);
    expect(flight.state.t).toBeGreaterThan(still);
    // A second time Pip doesn't explain it again.
    const q = s.screenAt(s.segmentFrames(), flight.state.t + period / 3);
    expect(s.tapMap(q.x, q.y)).toBe(true);
    expect(t.heard.at(-1)).toBe(HERE);
  });

  it('a tap off the path drops nothing; right by the rocket means once round', () => {
    const t = setup(inOrbit());
    const { s, flight } = t;
    // The middle of the world (the orbit is round it, far from there on screen).
    expect(s.tapMap(422, 195)).toBe(false);
    expect(s.clock).toBe(null);
    // Where the rocket is now: the path only gets back there after a whole orbit.
    const period = flight.elements().period;
    const p = s.screenAt(s.segmentFrames(), flight.state.t + 0.1);
    expect(s.tapMap(p.x, p.y)).toBe(true);
    expect(s.clock.t - flight.state.t).toBeGreaterThan(period * 0.95);
  });

  it('a later tap moves the ⏰; tapping the ⏰ takes it away', () => {
    const t = setup(inOrbit());
    const { s, flight } = t;
    const period = flight.elements().period;
    const at = (k) => s.screenAt(s.segmentFrames(), flight.state.t + period * k);
    const a = at(0.3);
    s.tapMap(a.x, a.y);
    const first = s.clock.t;
    const b = at(0.7);
    s.tapMap(b.x, b.y);
    expect(s.clock.t).toBeGreaterThan(first + period * 0.3);
    s.tapClock();
    expect(s.clock).toBe(null);
    expect(s.warpIndex).toBe(0);
  });

  it('GO takes over: travel stops and the ⏰ goes', () => {
    const t = setup(inOrbit());
    const { s, flight } = t;
    const p = s.screenAt(s.segmentFrames(), flight.state.t + flight.elements().period / 2);
    s.tapMap(p.x, p.y);
    t.run(0.5);
    expect(s.warpIndex).toBeGreaterThan(0);
    s.input.go = true;
    t.run(0.2);
    s.input.go = false;
    expect(s.clock).toBe(null);
    expect(s.warpIndex).toBe(0);
  });

  it('the time buttons take the clock back, from the speed it was at', () => {
    const t = setup(inOrbit());
    const { s, flight } = t;
    s.app.audio.play = () => {};
    const p = s.screenAt(s.segmentFrames(), flight.state.t + flight.elements().period / 2);
    s.tapMap(p.x, p.y);
    t.run(0.3);
    const level = s.warpIndex;
    s.setWarp(-1);
    expect(s.clock).toBe(null);
    expect(s.warpIndex).toBe(level - 1);
  });

  it('no ⏰ while a helper flies; starting a helper takes it away', () => {
    const t = setup(inOrbit());
    const { s, flight, ap } = t;
    const p = () => s.screenAt(s.segmentFrames(), flight.state.t + flight.elements().period / 2);
    s.tapMap(p().x, p().y);
    expect(s.clock).not.toBe(null);
    s.helper('land');
    expect(s.clock).toBe(null);
    expect(ap.active).toBe(true);
    const q = p();
    expect(s.tapMap(q.x, q.y)).toBe(false);
    expect(s.clock).toBe(null);
  });

  it('never travels through a crash: the ⏰ goes when the ground now comes first', () => {
    const t = setup(inOrbit());
    const { s, flight } = t;
    const period = flight.elements().period;
    const p = s.screenAt(s.segmentFrames(), flight.state.t + period * 0.8);
    s.tapMap(p.x, p.y);
    // Brake hard (as a burn would), so the path now hits the ground before the ⏰.
    const st = flight.state;
    st.vx *= 0.6;
    st.vy *= 0.6;
    s.predTimer = 0;
    t.run(0.1);
    expect(s.prediction.segments.at(-1).end).toBe('impact');
    expect(s.clock).toBe(null);
    expect(s.warpIndex).toBe(0);
    expect(flight.state.crashed).toBe(false);
  });
});
