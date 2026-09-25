import { describe, it, expect } from 'vitest';
import { createSystem } from '../src/physics/bodies.js';
import { Buggy, vec, ORBIT } from '../src/physics/buggy.js';
import { BUGGIES } from '../src/rocket/parts.js';

function drive(bodyId, kind, seconds, input, setup) {
  const sys = createSystem();
  const body = sys.byId[bodyId];
  const b = new Buggy(body, BUGGIES[kind]);
  b.spawn([0, 1, 0], [1, 0, 0]);
  setup?.(b);
  let maxR = 0, minAlt = Infinity;
  const start = b.p;
  for (let i = 0; i < seconds * 60; i++) {
    b.step(1 / 60, typeof input === 'function' ? input(i, b) : input);
    maxR = Math.max(maxR, vec.len(b.p));
    minAlt = Math.min(minAlt, b.altitude);
  }
  return { b, body, maxR, minAlt, moved: vec.len(vec.sub(b.p, start)) };
}

describe('buggy', () => {
  it('sits still on the ground without input', () => {
    const { b, moved } = drive('pebble', 'rover', 3, { throttle: 0, steer: 0 });
    expect(b.grounded).toBe(true);
    expect(moved).toBeLessThan(2);
  });

  it('drives across Homestead and stays on the ground', () => {
    const { b, moved, minAlt } = drive('homestead', 'rover', 20, { throttle: 1, steer: 0 });
    expect(moved).toBeGreaterThan(60);
    expect(minAlt).toBeGreaterThan(-0.05);
    expect(b.speed).toBeLessThanOrEqual(b.topSpeed + 0.5);
  });

  it('turns when steering', () => {
    const straight = drive('pebble', 'rover', 6, { throttle: 1, steer: 0 });
    const circling = drive('pebble', 'rover', 6, { throttle: 1, steer: 1 });
    // Driving in circles keeps us close to where we started.
    expect(circling.moved).toBeLessThan(straight.moved * 0.5);
  });

  it('can drive all the way around tiny Nibble', () => {
    const { b } = drive('nibble', 'truck', 90, { throttle: 1, steer: 0 });
    expect(Math.abs(b.distance)).toBeGreaterThan(2 * Math.PI * 30);
  });

  for (const world of ['nibble', 'pebble', 'frosty', 'homestead']) {
    it(`hopper jumps on ${world} always come back down`, () => {
      const { b, body, maxR } = drive(world, 'hopper', 60, (i) => ({ throttle: 1, steer: i % 400 < 200 ? 0.3 : -0.3, jump: true }));
      expect(maxR).toBeLessThan(body.maxSurface + body.radius * 1.5);
      expect(vec.len(b.p)).toBeLessThan(body.maxSurface + body.radius);
    });
  }

  it('bumps into the parked rocket instead of driving through it', () => {
    const sys = createSystem();
    const body = sys.byId.pebble;
    const b = new Buggy(body, BUGGIES.rover);
    b.spawn([0, 1, 0], [1, 0, 0]);
    const ahead = vec.norm(vec.add([0, 1, 0], [10 / body.radius, 0, 0]));
    const rocket = vec.mul(ahead, b.groundRadius(ahead));
    b.obstacles = [{ p: rocket, r: 2.5 }];
    let closest = Infinity;
    for (let i = 0; i < 60 * 8; i++) {
      b.step(1 / 60, { throttle: 1, steer: 0 });
      const d = vec.sub(b.p, rocket);
      const u = b.up;
      closest = Math.min(closest, vec.len(vec.sub(d, vec.mul(u, vec.dot(d, u)))));
    }
    expect(closest).toBeGreaterThan(2.3);
  });

  it('is slower in the water on Homestead', () => {
    const sys = createSystem();
    const body = sys.home;
    // Find some ocean.
    let sea = null;
    for (let i = 0; i < 4000 && !sea; i++) {
      const d = vec.norm([Math.sin(i * 1.3), Math.cos(i * 0.7), Math.sin(i * 0.37)]);
      if (body.terrainFn.height(...d) <= body.terrainFn.sea + 1e-3) {
        const d2 = vec.norm(vec.add(d, [0.02, 0, 0]));
        if (body.terrainFn.height(...d2) <= body.terrainFn.sea + 1e-3) sea = d;
      }
    }
    expect(sea).not.toBeNull();
    const b = new Buggy(body, BUGGIES.rover);
    b.spawn(sea, vec.cross(sea, [0, 0, 1]));
    for (let i = 0; i < 120; i++) b.step(1 / 60, { throttle: 1, steer: 0 });
    expect(b.inWater).toBe(true);
    expect(b.speed).toBeLessThan(b.topSpeed * 0.5);
  });

  describe('the Nibble orbit secret', () => {
    // A kid: drive flat out, tap jump (a super hop), then keep tapping jump to fire the jets.
    // Taps are 3 frames long, every half second; `brakeAfter` holds reverse once that far round.
    function superHop(bodyId, { taps = 20, brakeAfter = Infinity, dir = [0, 1, 0], fwd = [1, 0, 0], seconds = 240 } = {}) {
      const sys = createSystem();
      const body = sys.byId[bodyId];
      const b = new Buggy(body, BUGGIES.hopper);
      b.spawn(dir, fwd);
      let hopAt = -1, orbitedAt = -1, landedAt = -1, maxR = 0, maxSpeed = 0, i = 0;
      for (; i < seconds * 60 && landedAt < 0; i++) {
        const k = hopAt < 0 ? i - 90 : i - hopAt - 60;
        const tap = k >= 0 && k % 30 < 3 && (hopAt < 0 || k / 30 < taps);
        const braking = b.lap > brakeAfter;
        b.step(1 / 60, { throttle: braking ? -1 : 1, steer: 0, jump: tap && !braking });
        if (b.superHop) {
          b.superHop = false;
          if (hopAt < 0) hopAt = i;
        }
        if (b.orbited) {
          b.orbited = false;
          orbitedAt = i;
        }
        maxR = Math.max(maxR, vec.len(b.p));
        if (b.orbiting) maxSpeed = Math.max(maxSpeed, b.speed);
        if (hopAt >= 0 && i > hopAt + 60 && b.grounded) landedAt = i;
      }
      return { b, body, hopAt, orbitedAt, landedAt, maxR, maxSpeed };
    }

    it('the Hopper can super hop all the way round Nibble without leaving it', () => {
      const { body, hopAt, orbitedAt, landedAt, maxR, maxSpeed } = superHop('nibble');
      expect(hopAt).toBeGreaterThan(0);
      expect(orbitedAt).toBeGreaterThan(hopAt); // a full lap without touching the ground
      expect(maxR).toBeLessThan(2 * ORBIT.maxA);
      expect(maxR).toBeLessThan(body.soi * 0.7);
      expect(maxSpeed).toBeLessThan(Math.sqrt((2 * body.mu) / body.radius) * 0.9); // well below escape
      // Stop tapping and the orbit sags back down on its own.
      expect(landedAt).toBeGreaterThan(orbitedAt);
      expect((landedAt - orbitedAt) / 60).toBeLessThan(90);
    });

    it('stays inside Nibble\'s sphere of influence however hard you tap', () => {
      for (let n = 0; n < 8; n++) {
        const a = n * 0.8, z = Math.cos(n * 1.7) * 0.6;
        const dir = [Math.cos(a) * Math.sqrt(1 - z * z), Math.sin(a) * Math.sqrt(1 - z * z), z];
        const fwd = vec.cross(dir, [0.3, 0.5, 1]);
        const { body, maxR } = superHop('nibble', { taps: 400, dir, fwd, seconds: 200 });
        expect(maxR).toBeLessThan(2 * ORBIT.maxA);
        expect(maxR).toBeLessThan(body.soi * 0.7);
      }
    });

    it('holding reverse in the air brings the Hopper back down', () => {
      const { hopAt, orbitedAt, landedAt } = superHop('nibble', { brakeAfter: 1 });
      expect(hopAt).toBeGreaterThan(0);
      expect(orbitedAt).toBe(-1);
      expect(landedAt).toBeGreaterThan(0);
    });

    it('a super hop without jets comes back down', () => {
      const { hopAt, orbitedAt, landedAt } = superHop('nibble', { taps: 0 });
      expect(hopAt).toBeGreaterThan(0);
      expect(orbitedAt).toBe(-1);
      expect((landedAt - hopAt) / 60).toBeLessThan(60);
    });

    for (const world of ['pebble', 'frosty', 'homestead', 'dusty']) {
      it(`is only on Nibble: no super hop on ${world}`, () => {
        const { b, body, hopAt, maxR } = superHop(world, { seconds: 60 });
        expect(hopAt).toBe(-1);
        expect(b.orbiting).toBe(false);
        expect(maxR).toBeLessThan(body.maxSurface + body.radius * 1.5);
      });
    }

    it('only the Hopper knows the secret', () => {
      const sys = createSystem();
      expect(new Buggy(sys.byId.nibble, BUGGIES.hopper).canOrbit).toBe(true);
      expect(new Buggy(sys.byId.nibble, BUGGIES.rover).canOrbit).toBe(false);
      expect(new Buggy(sys.byId.nibble, BUGGIES.truck).canOrbit).toBe(false);
      expect(new Buggy(sys.byId.pebble, BUGGIES.hopper).canOrbit).toBe(false);
    });
  });
});
