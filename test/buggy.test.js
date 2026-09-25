import { describe, it, expect } from 'vitest';
import { createSystem } from '../src/physics/bodies.js';
import { Buggy, ObstacleGrid, vec, ORBIT, JETS } from '../src/physics/buggy.js';
import { DUCKY_JETS } from '../src/physics/terrain.js';
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

  describe('Ducky\'s gas jets (#13)', () => {
    const sys = createSystem();
    const ducky = sys.byId.ducky;

    it('every jet pushes every buggy up, and it always floats back down', () => {
      for (const kind of ['rover', 'truck', 'hopper']) {
        for (const [k, v] of DUCKY_JETS.entries()) {
          const b = new Buggy(ducky, BUGGIES[kind]);
          b.spawn([v.x + 0.01, v.y, v.z + 0.01], [0, 0, 1]);
          let top = 0, airborne = false, down = -1, fizzed = false;
          for (let i = 0; i < 60 * 60 && down < 0; i++) {
            b.step(1 / 60, { throttle: 0, steer: 0, jump: false });
            fizzed ||= b.fizz > 0.5;
            top = Math.max(top, b.altitude);
            // Never faster than 75% of circular speed, so never into orbit.
            expect(b.speed).toBeLessThanOrEqual(Math.sqrt(ducky.mu / vec.len(b.p)) * 0.75 + 1e-6);
            if (b.altitude > 1) airborne = true;
            if (airborne && b.grounded) down = i;
          }
          expect(fizzed, `${kind} on jet ${k}`).toBe(true);
          expect(top, `${kind} on jet ${k}`).toBeGreaterThan(2);
          expect(top).toBeLessThan(JETS.height * 4);
          expect(down, `${kind} on jet ${k} came down`).toBeGreaterThan(0);
        }
      }
    });

    it('driving and jumping all over Ducky for five minutes never leaves it', () => {
      for (const kind of ['rover', 'truck', 'hopper']) {
        const { b, body, maxR } = drive('ducky', kind, 300, (i) => ({ throttle: 1, steer: Math.sin(i / 300) * 0.6, jump: true }));
        expect(maxR).toBeLessThan(body.maxSurface + body.radius);
        expect(maxR).toBeLessThan(body.soi * 0.5);
        expect(b.orbiting).toBe(false);
      }
    });

    it('only Ducky has them', () => {
      expect(new Buggy(ducky, BUGGIES.rover).vents).toBe(DUCKY_JETS);
      for (const id of ['homestead', 'nibble', 'flip', 'sizzle']) expect(new Buggy(sys.byId[id], BUGGIES.rover).vents).toBe(null);
    });
  });

  it('bumps into the parked rocket instead of driving through it', () => {
    const sys = createSystem();
    const body = sys.byId.pebble;
    const b = new Buggy(body, BUGGIES.rover);
    b.spawn([0, 1, 0], [1, 0, 0]);
    const ahead = vec.norm(vec.add([0, 1, 0], [10 / body.radius, 0, 0]));
    const rocket = vec.mul(ahead, b.groundRadius(ahead));
    b.obstacles = [{ p: rocket, r: 1.4 }]; // + the rover's reach (1.1)
    let closest = Infinity;
    for (let i = 0; i < 60 * 8; i++) {
      b.step(1 / 60, { throttle: 1, steer: 0 });
      const d = vec.sub(b.p, rocket);
      const u = b.up;
      closest = Math.min(closest, vec.len(vec.sub(d, vec.mul(u, vec.dot(d, u)))));
    }
    expect(closest).toBeGreaterThan(2.3);
  });

  describe('trees and rocks', () => {
    // Spawn at the top of the world facing +x, with an obstacle `ahead` metres down the road
    // and `aside` metres to the left or right of it.
    function course(bodyId, kind, { ahead = 14, aside = 0, r = 0.35, h = 5 } = {}) {
      const sys = createSystem();
      const body = sys.byId[bodyId];
      const b = new Buggy(body, BUGGIES[kind]);
      b.spawn([0, 1, 0], [1, 0, 0]);
      const dir = vec.norm([ahead / body.radius, 1, aside / body.radius]);
      const o = { p: vec.mul(dir, b.groundRadius(dir) - 0.3), up: dir, r, h };
      b.grid = new ObstacleGrid([o]);
      const gap = () => {
        const d = vec.sub(b.p, o.p);
        const u = b.up;
        return vec.len(vec.sub(d, vec.mul(u, vec.dot(d, u))));
      };
      const run = (seconds, input) => {
        let closest = Infinity, bump = 0;
        for (let i = 0; i < seconds * 60; i++) {
          b.step(1 / 60, input);
          closest = Math.min(closest, gap());
          bump = Math.max(bump, b.bumped);
          b.bumped = 0;
        }
        return { closest, bump };
      };
      return { b, o, gap, run };
    }

    it('driving straight into a tree stops the buggy', () => {
      const { b, o, run } = course('homestead', 'rover');
      const { closest, bump } = run(6, { throttle: 1, steer: 0 });
      expect(closest).toBeGreaterThan(o.r + b.kind.reach - 0.1);
      expect(bump).toBeGreaterThan(2);
      expect(b.p[0]).toBeLessThan(o.p[0]); // still on this side of it
    });

    it('a glancing hit slides off past the tree', () => {
      const { b, o, run } = course('homestead', 'rover', { aside: 0.8 });
      const { closest, bump } = run(6, { throttle: 1, steer: 0 });
      expect(closest).toBeGreaterThan(o.r + b.kind.reach - 0.1);
      expect(bump).toBeGreaterThan(0);
      expect(b.p[0]).toBeGreaterThan(o.p[0] + 10); // carried on past it
    });

    it('can always back away from a tree', () => {
      const { b, gap, run } = course('homestead', 'truck');
      run(6, { throttle: 1, steer: 0 });
      const stuck = gap();
      run(3, { throttle: -1, steer: 0.5 });
      expect(gap()).toBeGreaterThan(stuck + 4);
      // ...and then drive off round it.
      const before = b.p[0];
      run(4, { throttle: 1, steer: 1 });
      expect(Math.abs(b.p[0] - before) + Math.abs(b.p[2])).toBeGreaterThan(3);
    });

    it('the Hopper can jump over a bush', () => {
      const { b, o, run } = course('homestead', 'hopper', { ahead: 16, r: 0.8, h: 1.2 });
      const { closest } = run(4, (() => {
        let i = 0;
        return { get throttle() { return 1; }, steer: 0, get jump() { return i++ > 0 && Math.abs(b.p[0] - o.p[0]) < 7; } };
      })());
      expect(closest).toBeLessThan(0.8 + b.kind.reach);
      expect(b.p[0]).toBeGreaterThan(o.p[0]);
    });

    for (const world of ['pebble', 'nibble', 'dusty', 'sizzle', 'frosty']) {
      // A big boulder, so crests on the bumpier moons can't just fly us over it.
      it(`a rock on ${world} blocks the buggy`, () => {
        const { b, o, run } = course(world, 'rover', { ahead: 8, r: 0.8, h: 2.5 });
        const { closest, bump } = run(6, { throttle: 1, steer: 0 });
        expect(closest).toBeGreaterThan(o.r + b.kind.reach - 0.1);
        expect(bump).toBeGreaterThan(0.5);
      });
    }

    it('the lookup finds every nearby tree and not the far ones', () => {
      const sys = createSystem();
      const body = sys.home;
      const R = body.radius;
      let seed = 1;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const randDir = () => {
        const z = rand() * 2 - 1, a = rand() * Math.PI * 2, k = Math.sqrt(1 - z * z);
        return [k * Math.cos(a), k * Math.sin(a), z];
      };
      const list = [];
      for (let i = 0; i < 900; i++) {
        const d = randDir();
        const h = 3 + rand() * 6;
        list.push({ p: vec.mul(d, R + body.terrainFn.height(...d)), r: 0.2 + rand() * 0.3, h });
      }
      const grid = new ObstacleGrid(list);
      const rover = BUGGIES.rover;
      let seen = 0, most = 0;
      for (let q = 0; q < 400; q++) {
        // Query near a real tree half the time, so there's something to find.
        const base = q % 2 ? list[q].p : vec.mul(randDir(), R + 1);
        const p = vec.add(base, [rand() * 4 - 2, rand() * 4 - 2, rand() * 4 - 2]);
        const u = vec.norm(p);
        const found = grid.near(p);
        most = Math.max(most, found.length);
        for (const o of list) {
          const d = vec.sub(p, o.p);
          const above = vec.dot(d, u);
          const side = vec.len(vec.sub(d, vec.mul(u, above)));
          if (above <= o.h && side < o.r + rover.reach) {
            seen++;
            expect(found).toContain(o);
          }
        }
      }
      expect(seen).toBeGreaterThan(50);
      expect(most).toBeLessThan(40); // a handful, not all 900
    });
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
    // Start points all over Nibble, heading off in different directions.
    const STARTS = [0, 1, 2, 3, 4, 5].map((n) => {
      const a = n * 1.1, z = Math.cos(n * 1.7) * 0.7;
      const dir = [Math.cos(a) * Math.sqrt(1 - z * z), Math.sin(a) * Math.sqrt(1 - z * z), z];
      return { dir, fwd: vec.cross(dir, [0.3, 0.5, 1]) };
    });

    // A kid who's been told the trick: hold GO, then after a second press jump and either
    // hold it (`hold`) or tap it about once a second, each tap 0.1-0.25 s, give or take 0.3 s.
    // They let go once round (or after `taps` taps), and hold reverse once `brakeAfter` round.
    function superHop(bodyId, { hold = false, letGo = true, taps = Infinity, brakeAfter = Infinity, dir = [0, 1, 0], fwd = [1, 0, 0], seconds = 240, seed = 1 } = {}) {
      const sys = createSystem();
      const body = sys.byId[bodyId];
      const b = new Buggy(body, BUGGIES.hopper);
      b.spawn(dir, fwd);
      let rnd = seed;
      const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
      let hopAt = -1, orbitedAt = -1, landedAt = -1, maxR = 0, maxSpeed = 0, lowest = Infinity, i = 0;
      let tapped = 0, nextTap = 1, tapEnd = 0;
      for (; i < seconds * 60 && landedAt < 0; i++) {
        const t = i / 60;
        if (t >= nextTap) {
          tapped++;
          tapEnd = t + 0.1 + rand() * 0.15;
          nextTap = t + 0.7 + rand() * 0.6;
        }
        const done = (letGo && orbitedAt >= 0) || tapped > taps;
        const braking = b.lap > brakeAfter;
        const jump = !done && !braking && t >= 1 && (hold || t < tapEnd);
        b.step(1 / 60, { throttle: braking ? -1 : 1, steer: 0, jump });
        if (b.superHop) {
          b.superHop = false;
          if (orbitedAt < 0) hopAt = i; // the hop that went round (a bumpy first try can re-hop)
        }
        if (b.orbited) {
          b.orbited = false;
          if (orbitedAt < 0) orbitedAt = i;
        }
        maxR = Math.max(maxR, vec.len(b.p));
        if (b.orbiting) maxSpeed = Math.max(maxSpeed, b.speed);
        if (b.orbiting && b.lap > 1 && orbitedAt < 0) lowest = Math.min(lowest, b.altitude);
        if (hopAt >= 0 && i > hopAt + 60 && b.grounded && (done || braking)) landedAt = i;
      }
      const lapTime = orbitedAt >= 0 ? (orbitedAt - hopAt) / 60 : -1;
      return { b, body, hopAt, orbitedAt, landedAt, lapTime, maxR, maxSpeed, lowest, tapped };
    }

    // A real orbit at ORBIT.height takes this long; the lap can't be quicker without leaving real physics.
    const period = (body) => 2 * Math.PI * Math.sqrt(ORBIT.height ** 3 / body.mu);

    it('holding jump after a super hop goes all the way round, then sags back down', () => {
      STARTS.forEach(({ dir, fwd }, n) => {
        const { body, hopAt, orbitedAt, landedAt, maxR, maxSpeed, lowest } = superHop('nibble', { hold: true, dir, fwd, seed: n + 1 });
        expect(hopAt).toBeGreaterThan(0);
        expect(orbitedAt).toBeGreaterThan(hopAt); // a full lap without touching the ground
        expect(lowest).toBeGreaterThan(0);
        expect(maxR).toBeLessThan(ORBIT.height + 3); // low and round
        expect(maxSpeed).toBeLessThan(Math.sqrt((2 * body.mu) / body.radius) * 0.9); // well below escape
        // Let go and the orbit sags back down on its own.
        expect(landedAt).toBeGreaterThan(orbitedAt);
        expect((landedAt - orbitedAt) / 60).toBeLessThan(90);
      });
    });

    it('tapping jump about once a second goes all the way round', () => {
      STARTS.forEach(({ dir, fwd }, n) => {
        // Tapping all the way round, or giving up after 20 taps (it was about 64 taps before).
        for (const taps of [Infinity, 20]) {
          const { hopAt, orbitedAt } = superHop('nibble', { dir, fwd, taps, seed: n + 7 });
          expect(hopAt).toBeGreaterThan(0);
          expect(orbitedAt).toBeGreaterThan(hopAt);
        }
      });
    });

    it('a lap takes about as long as a real orbit just above the lumps', () => {
      for (const hold of [true, false]) {
        const { body, lapTime } = superHop('nibble', { hold });
        expect(ORBIT.height).toBeGreaterThan(body.maxSurface + 1); // clears Nibble's highest lumps
        expect(lapTime).toBeGreaterThan(period(body) * 0.85);
        expect(lapTime).toBeLessThan(period(body) * 1.1); // about 70 s (it was 75+ from higher up)
      }
    });

    it('stays inside Nibble\'s sphere of influence however long you hold or tap', () => {
      for (let n = 0; n < 8; n++) {
        const a = n * 0.8, z = Math.cos(n * 1.7) * 0.6;
        const dir = [Math.cos(a) * Math.sqrt(1 - z * z), Math.sin(a) * Math.sqrt(1 - z * z), z];
        const fwd = vec.cross(dir, [0.3, 0.5, 1]);
        for (const hold of [true, false]) {
          // Never letting go.
          const { body, maxR } = superHop('nibble', { hold, dir, fwd, seconds: 200, seed: n + 3, letGo: false });
          expect(maxR).toBeLessThan(2 * ORBIT.maxA);
          expect(maxR).toBeLessThan(body.soi * 0.6);
        }
      }
    });

    it('holding reverse in the air brings the Hopper back down', () => {
      for (const hold of [true, false]) {
        const { hopAt, orbitedAt, landedAt } = superHop('nibble', { hold, brakeAfter: 1 });
        expect(hopAt).toBeGreaterThan(0);
        expect(orbitedAt).toBe(-1);
        expect(landedAt).toBeGreaterThan(0);
      }
    });

    it('a super hop without jets comes back down', () => {
      const { hopAt, orbitedAt, landedAt } = superHop('nibble', { taps: 1 });
      expect(hopAt).toBeGreaterThan(0);
      expect(orbitedAt).toBe(-1);
      expect((landedAt - hopAt) / 60).toBeLessThan(60);
    });

    it('a slow jump on Nibble is just a jump', () => {
      const sys = createSystem();
      const b = new Buggy(sys.byId.nibble, BUGGIES.hopper);
      b.spawn([0, 1, 0], [1, 0, 0]);
      let hopped = false, maxR = 0;
      for (let i = 0; i < 60 * 20; i++) {
        // Creeping along below the trigger speed, holding jump.
        b.step(1 / 60, { throttle: b.speed < b.topSpeed * ORBIT.trigger * 0.8 ? 1 : 0, steer: 0, jump: true });
        hopped ||= !!b.superHop;
        maxR = Math.max(maxR, vec.len(b.p));
      }
      expect(hopped).toBe(false);
      expect(maxR).toBeLessThan(sys.byId.nibble.maxSurface + 15);
    });

    for (const world of ['pebble', 'frosty', 'homestead', 'dusty']) {
      it(`is only on Nibble: no super hop on ${world}`, () => {
        for (const hold of [true, false]) {
          const { b, body, hopAt, maxR } = superHop(world, { hold, seconds: 60 });
          expect(hopAt).toBe(-1);
          expect(b.orbiting).toBe(false);
          expect(maxR).toBeLessThan(body.maxSurface + body.radius * 1.5);
        }
      });
    }

    it('only the Hopper knows the secret', () => {
      const sys = createSystem();
      expect(new Buggy(sys.byId.nibble, BUGGIES.hopper).canOrbit).toBe(true);
      expect(new Buggy(sys.byId.nibble, BUGGIES.rover).canOrbit).toBe(false);
      expect(new Buggy(sys.byId.nibble, BUGGIES.truck).canOrbit).toBe(false);
      expect(new Buggy(sys.byId.pebble, BUGGIES.hopper).canOrbit).toBe(false);
      // Other buggies holding jump flat out on Nibble stay on (or near) the ground.
      for (const kind of ['rover', 'truck']) {
        const { maxR } = drive('nibble', kind, 60, { throttle: 1, steer: 0, jump: true });
        expect(maxR).toBeLessThan(sys.byId.nibble.maxSurface + 5);
      }
    });
  });
});
