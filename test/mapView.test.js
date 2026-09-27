// The map's centre (#57): it opens on the rocket, then stays where it is (or is dragged to) in
// the Sun's frame. It never follows the world we took off from, or anything else, as worlds
// move, the floating origin moves or a new world takes over. Through the real FlightScene
// (toggleMap(), fly(), easeMap(), placeOrigin(), updateCamera()); nothing is drawn.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FlightScene } from '../src/scenes/flight.js';
import { mission, parkAt } from './missions.js';

globalThis.window ??= {};
Object.assign(globalThis.window, { innerWidth: 844, innerHeight: 390 });

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
    mapAt: { x: 0, y: 0 }, mapOff: { x: 0, y: 0 }, mapGoalAt: { x: 0, y: 0 }, mapDist: 2000, zoom: 1, carry: 1, camSettle: false, soiGlow: null,
    camera: new THREE.PerspectiveCamera(50, 844 / 390, 1, 3e6), camUp: new THREE.Vector3(0, 1, 0), rocket: { height: 6 },
    drive: { active: false, cancel() {} }, showing: null, coachKey: null, coachSpent: null, coachWait: 0,
  });
  s.burst = s.discover = s.checkDiscoveries = s.checkBand = () => {};
  m.flight.on((type, d) => s.onFlightEvent(type, d));
  return s;
}

/** One frame as FlightScene.update() does it; where a world point (the Sun by default) is on screen. */
function frame(s, dt = 1 / 60, p = { x: 0, y: 0 }) {
  s.time += dt;
  s.fly(dt);
  if (s.mode === 'map') {
    s.easeMap(dt);
    s.glideMap(dt);
  }
  const rw = s.flight.worldPos({});
  s.placeOrigin(rw);
  s.updateCamera(dt);
  return onScreen(s, p);
}

function onScreen(s, p) {
  s.camera.updateMatrixWorld();
  const ndc = new THREE.Vector3(p.x - s.origin.x, p.y - s.origin.y, 0).project(s.camera);
  return [ndc.x, ndc.y];
}

const moved = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

describe('the map view stays where it is (#57)', () => {
  it('opens centred on the rocket, landed and in orbit', () => {
    for (const orbit of [false, true]) {
      const m = mission();
      if (orbit) parkAt(m, 'homestead', 500, 1);
      const s = setup(m);
      frame(s);
      s.toggleMap();
      const rw = m.flight.worldPos({});
      frame(s, 0);
      expect(moved(onScreen(s, rw), [0, 0])).toBeLessThan(1e-6);
      // Framed on our world: the world is on screen too.
      const w = onScreen(s, m.flight.state.body.worldPos(m.flight.state.t, {}));
      expect(Math.abs(w[0])).toBeLessThan(1);
      expect(Math.abs(w[1])).toBeLessThan(1);
    }
  });

  it('after taking off from Homestead, the Sun and a dragged-to spot stay put while Homestead moves on', () => {
    const m = parkAt(mission(), 'homestead', 0);
    const s = setup(m);
    s.toggleMap();
    s.setWarpLevel(6); // ×1000: Homestead goes a long way round the Sun
    const home = m.sys.byId.homestead;
    const h0 = home.worldPos(m.flight.state.t, {});
    const sun0 = frame(s);
    const origin0 = { ...s.origin };
    for (let i = 0; i < 600; i++) {
      expect(moved(sun0, frame(s))).toBeLessThan(1e-9);
      expect(s.origin).toEqual(origin0);
    }
    const h1 = home.worldPos(m.flight.state.t, {});
    expect(Math.hypot(h1.x - h0.x, h1.y - h0.y)).toBeGreaterThan(1000);
    // Drag the map (as the HUD's one-finger pan does): it stays at the new spot.
    s.mapEase = false;
    s.mapAt.x += 3000;
    s.mapAt.y -= 1200;
    const spot = { x: s.mapAt.x + 250, y: s.mapAt.y - 90 };
    const a = frame(s, 1 / 60, spot);
    const sun1 = onScreen(s, { x: 0, y: 0 });
    for (let i = 0; i < 600; i++) {
      expect(moved(a, frame(s, 1 / 60, spot))).toBeLessThan(1e-9);
      expect(moved(sun1, onScreen(s, { x: 0, y: 0 }))).toBeLessThan(1e-9);
    }
  });

  it('stays put across SOI hand-offs (Homestead to Pebble and back)', () => {
    const m = parkAt(mission(), 'homestead', 0);
    const s = setup(m);
    s.toggleMap();
    frame(s);
    const origin0 = { ...s.origin };
    const focus = s.mapFocus;
    const dist = s.mapDist;
    const worlds = [m.flight.state.body.id];
    m.ap.start('goto', m.sys.byId.pebble);
    for (let i = 0; i < 60 * 60 * 40 && worlds.length < 3; i++) {
      frame(s);
      expect(s.origin).toEqual(origin0);
      const id = m.flight.state.body.id;
      if (id !== worlds[worlds.length - 1]) {
        worlds.push(id);
        if (id === 'pebble') m.ap.start('goto', m.sys.byId.homestead);
      }
    }
    expect(worlds).toEqual(['homestead', 'pebble', 'homestead']);
    expect(s.mapFocus).toBe(focus);
    expect(s.mapDist).toBe(dist);
  });

  it('the flight view in between doesn\'t move it; opening the map again starts at the rocket', () => {
    const m = parkAt(mission(), 'homestead', 0);
    const s = setup(m);
    s.toggleMap();
    s.mapAt.x += 5000;
    frame(s);
    const at = { ...s.mapAt };
    s.toggleMap();
    for (let i = 0; i < 300; i++) frame(s);
    expect(s.mapAt).toEqual(at);
    s.toggleMap();
    frame(s, 0);
    expect(moved(onScreen(s, m.flight.worldPos({})), [0, 0])).toBeLessThan(1e-6);
  });

  it('🎯 glides back to the rocket, then stays there', () => {
    const m = parkAt(mission(), 'homestead', 0);
    const s = setup(m);
    s.toggleMap();
    s.setWarpLevel(4);
    s.mapAt.x += 8000;
    s.findRocket();
    for (let i = 0; i < 60 * 8 && s.mapEase; i++) frame(s);
    expect(s.mapEase).toBe(false);
    const rw = m.flight.worldPos({});
    expect(Math.hypot(rw.x - s.mapAt.x, rw.y - s.mapAt.y)).toBeLessThan(3);
    const at = { ...s.mapAt };
    for (let i = 0; i < 300; i++) frame(s);
    expect(s.mapAt).toEqual(at);
  });

  it('focusing on a world centres on it once; the world then moves on across the map', () => {
    const m = parkAt(mission(), 'homestead', 0);
    const s = setup(m);
    s.toggleMap();
    s.setWarpLevel(6);
    const sizzle = m.sys.byId.sizzle;
    s.focusMapOn(sizzle);
    const p0 = frame(s, 0, sizzle.worldPos(m.flight.state.t, {}));
    expect(moved(p0, [0, 0])).toBeLessThan(1e-6);
    const at = { ...s.mapAt };
    for (let i = 0; i < 300; i++) frame(s);
    expect(s.mapAt).toEqual(at);
    expect(moved(onScreen(s, sizzle.worldPos(m.flight.state.t, {})), [0, 0])).toBeGreaterThan(0.05);
  });
});
