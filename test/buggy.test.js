import { describe, it, expect } from 'vitest';
import { createSystem } from '../src/physics/bodies.js';
import { Buggy, vec } from '../src/physics/buggy.js';
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
});
