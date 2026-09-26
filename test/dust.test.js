import { describe, it, expect } from 'vitest';
import { createSystem } from '../src/physics/bodies.js';
import { Buggy, vec } from '../src/physics/buggy.js';
import { BUGGIES } from '../src/rocket/parts.js';
import { DUST, DustPool, BuggyDust, dustRate, dustColor, hasAir, FLAME_KIND } from '../src/physics/dust.js';
import { mulberry32 } from '../src/physics/noise.js';

const sys = createSystem();
const opts = { size: 0.5 };
const WHEELS = [[-1.2, 1], [1.2, 1], [-1.2, -1], [1.2, -1]];

/** A grain launched from the ground at `dir` with velocity (up, sideways) until it lands. */
function flight(bodyId, up, side = 0) {
  const body = sys.byId[bodyId];
  const pool = new DustPool(8);
  pool.setWorld(body);
  const d = vec.norm([0.3, 1, 0.2]);
  const r = pool.groundAt(...d) + DUST.lift;
  const t = vec.norm(vec.cross(d, [0, 0, 1]));
  const i = pool.spawn(d[0] * r, d[1] * r, d[2] * r, d[0] * up + t[0] * side, d[1] * up + t[1] * side, d[2] * up + t[2] * side, 1, 1, 1, { ...opts, life: 60 });
  let time = 0, top = 0;
  while (!pool.landed[i] && time < 30) {
    pool.step(1 / 120);
    time += 1 / 120;
    top = Math.max(top, vec.len([pool.pos[0], pool.pos[1], pool.pos[2]]) - r);
  }
  const at = [pool.pos[0], pool.pos[1], pool.pos[2]];
  return { time, top, across: Math.acos(Math.min(1, vec.dot(vec.norm(at), d))) * r };
}

describe('buggy dust (#26)', () => {
  it('throws no dust when crawling, more the faster we go, and lots when skidding', () => {
    expect(dustRate(0)).toBe(0);
    expect(dustRate(DUST.crawl)).toBe(0);
    expect(dustRate(1.1, 0, 0.5)).toBe(0);
    const slow = dustRate(3), fast = dustRate(10);
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow * 2);
    // Sliding sideways or speeding up / braking hard throws more than just rolling.
    expect(dustRate(5, 3)).toBeGreaterThan(dustRate(5) * 1.5);
    expect(dustRate(5, 0, 6)).toBeGreaterThan(dustRate(5) * 1.5);
    expect(dustRate(100, 100, 100)).toBe(DUST.maxRate);
  });

  it('falls with the world\'s gravity: slow arcs on Pebble, a quick drop on Homestead', () => {
    const pebble = flight('pebble', 2);
    const home = flight('homestead', 2);
    const nibble = flight('nibble', 2);
    // Straight up and back down takes 2v/g: 2 s on Pebble (g = 2), under 0.4 s on Homestead.
    expect(pebble.time).toBeGreaterThan(1.9);
    expect(pebble.time).toBeLessThan(2.1);
    expect(home.time).toBeLessThan(0.45);
    expect(pebble.time).toBeGreaterThan(home.time * 5);
    // Nibble is tinier still: the slowest of all.
    expect(nibble.time).toBeGreaterThan(pebble.time * 1.8);
  });

  it('flies clean ballistic arcs without air, and slows down where there is air', () => {
    expect(hasAir(sys.byId.homestead)).toBe(true);
    expect(hasAir(sys.byId.dusty)).toBe(true);
    expect(hasAir(sys.byId.pebble)).toBe(false);
    expect(hasAir(sys.byId.nibble)).toBe(false);
    // On Pebble a 45° throw lands about v²/g away (4 m/s: 8 m) and peaks at v²/4g (2 m).
    const v = 4 / Math.SQRT2;
    const pebble = flight('pebble', v, v);
    // (A little further: the ground curves away and gravity weakens higher up, on little Pebble.)
    expect(pebble.across).toBeGreaterThan(8 * 0.9);
    expect(pebble.across).toBeLessThan(8 * 1.25);
    expect(pebble.top).toBeGreaterThan(1.8);
    // Dusty's air (g = 6) holds it back: shorter than the airless throw (16/6 = 2.7 m).
    const dusty = flight('dusty', v, v);
    expect(dusty.across).toBeLessThan((16 / 6) * 0.8);
  });

  it('never goes into the ground', () => {
    for (const id of ['dusty', 'pebble', 'homestead', 'nibble']) {
      const body = sys.byId[id];
      const pool = new DustPool(300);
      pool.setWorld(body);
      const rand = mulberry32(7);
      const d = vec.norm([1, 0.4, -0.3]);
      const t1 = vec.norm(vec.cross(d, [0, 0, 1])), t2 = vec.cross(d, t1);
      for (let k = 0; k < 300; k++) {
        const a = rand() * 20 - 10, b = rand() * 20 - 10;
        const p = vec.norm(vec.add(d, vec.add(vec.mul(t1, a / body.radius), vec.mul(t2, b / body.radius))));
        const r = pool.groundAt(...p) + rand() * 2;
        // Some thrown down into the ground, some sideways over hills, some up.
        const v = [(rand() - 0.5) * 12, (rand() - 0.5) * 12, (rand() - 0.5) * 12];
        pool.spawn(p[0] * r, p[1] * r, p[2] * r, v[0], v[1], v[2], 1, 1, 1, { size: 0.5, life: 3 });
      }
      let lowest = Infinity;
      for (let s = 0; s < 240; s++) {
        pool.step(1 / 60);
        for (let n = 0; n < pool.count; n++) {
          const i = pool.live[n];
          const x = pool.pos[i * 3], y = pool.pos[i * 3 + 1], z = pool.pos[i * 3 + 2];
          lowest = Math.min(lowest, Math.hypot(x, y, z) - pool.groundAt(x, y, z));
        }
      }
      expect(lowest, id).toBeGreaterThanOrEqual(-0.02);
    }
  });

  it('reuses a fixed pool: no new arrays, full means none made, dead slots come back', () => {
    const pool = new DustPool(16);
    pool.setWorld(sys.byId.pebble);
    const arrays = [pool.pos, pool.vel, pool.col, pool.age, pool.live, pool.free];
    const r = sys.byId.pebble.radius + 20;
    for (let k = 0; k < 16; k++) expect(pool.spawn(r, 0, 0, 0, 1, 0, 1, 1, 1, { size: 0.5, life: 0.5 })).toBeGreaterThanOrEqual(0);
    expect(pool.spawn(r, 0, 0, 0, 1, 0, 1, 1, 1, opts)).toBe(-1);
    expect(pool.count).toBe(16);
    for (let s = 0; s < 40; s++) pool.step(1 / 60);
    expect(pool.count).toBe(0);
    const seen = new Set();
    for (let k = 0; k < 16; k++) seen.add(pool.spawn(r, 0, 0, 0, 1, 0, 1, 1, 1, opts));
    expect(seen.size).toBe(16);
    expect([...seen].every((i) => i >= 0 && i < 16)).toBe(true);
    // A long drive keeps using the same arrays.
    const b = new Buggy(sys.byId.dusty, BUGGIES.rover);
    b.spawn([0, 1, 0], [1, 0, 0]);
    const big = new DustPool();
    const dust = new BuggyDust(big, b, WHEELS, [], mulberry32(3));
    const bigArrays = [big.pos, big.vel, big.col, big.live, big.free];
    for (let s = 0; s < 600; s++) {
      const input = { throttle: 1, steer: s % 200 < 100 ? 1 : -1 };
      b.step(1 / 60, input);
      dust.update(1 / 60, input);
      big.step(1 / 60);
      expect(big.count).toBeLessThanOrEqual(big.capacity);
    }
    expect(big.count).toBeGreaterThan(0);
    expect([big.pos, big.vel, big.col, big.live, big.free].every((a, k) => a === bigArrays[k])).toBe(true);
    expect([pool.pos, pool.vel, pool.col, pool.age, pool.live, pool.free].every((a, k) => a === arrays[k])).toBe(true);
  });

  it('takes its colour from the terrain under it', () => {
    const out = {};
    for (const id of ['pebble', 'dusty', 'frosty']) {
      const body = sys.byId[id];
      for (let k = 0; k < 20; k++) {
        const d = vec.norm([Math.sin(k * 1.7), Math.cos(k * 2.3), Math.sin(k * 0.9)]);
        dustColor(body, ...d, out);
        if (out.water) continue;
        const h = body.terrainFn.height(...d);
        const c = body.terrainFn.color(...d, h);
        // The ground's own colour, a little paler.
        for (const [dust, ground] of [[out.r, c[0]], [out.g, c[1]], [out.b, c[2]]]) {
          expect(dust).toBeGreaterThanOrEqual(ground - 1e-6);
          expect(dust).toBeLessThanOrEqual(ground + (1 - ground) * 0.61);
        }
      }
    }
    // Dusty's dust is rusty red; Pebble's is grey.
    dustColor(sys.byId.dusty, 0, 1, 0, out);
    expect(out.r).toBeGreaterThan(out.g + 0.1);
    expect(out.g).toBeGreaterThan(out.b);
    dustColor(sys.byId.pebble, 0, 1, 0, out);
    expect(Math.abs(out.r - out.b)).toBeLessThan(0.1);
    // Homestead's grass throws up earthy, greenish dust.
    const home = sys.byId.homestead;
    dustColor(home, 0, 1, 0, out);
    expect(out.water).toBe(false);
    expect(out.g).toBeGreaterThan(out.b);
    expect(out.r).toBeGreaterThan(0.4);
    // Its seas splash blue-white.
    let wet = null;
    for (let k = 0; k < 400 && !wet; k++) {
      const d = vec.norm([Math.sin(k * 1.3), Math.cos(k * 0.7), Math.sin(k * 2.9)]);
      if (home.liquidDepth(...d) > 0) wet = d;
    }
    expect(wet).not.toBeNull();
    dustColor(home, ...wet, out);
    expect(out.water).toBe(true);
    expect(out.b).toBeGreaterThanOrEqual(out.r);
  });

  describe('from a real buggy', () => {
    function run(bodyId, kind, seconds, input, jets = []) {
      const b = new Buggy(sys.byId[bodyId], BUGGIES[kind]);
      b.spawn([0, 1, 0], [1, 0, 0]);
      const pool = new DustPool();
      const dust = new BuggyDust(pool, b, WHEELS, jets, mulberry32(11));
      let made = 0, landings = 0, airborneMade = 0, flames = 0;
      for (let s = 0; s < seconds * 60; s++) {
        const inp = typeof input === 'function' ? input(s) : input;
        b.step(1 / 60, inp);
        const before = pool.count;
        const grounded = b.grounded;
        dust.update(1 / 60, inp);
        if (b.jumped) {
          b.jumped = false;
          dust.takeOff(b.superHop);
        }
        if (dust.landing > 0) landings++;
        made += pool.count - before;
        if (!grounded && dust.landing === 0) airborneMade += pool.count - before;
        for (let n = 0; n < pool.count; n++) if (pool.kind[pool.live[n]] === FLAME_KIND) flames++;
        pool.step(1 / 60);
      }
      return { b, pool, made, landings, airborneMade, flames };
    }

    it('makes no dust standing still, and plenty driving flat out', () => {
      expect(run('pebble', 'rover', 3, { throttle: 0, steer: 0 }).made).toBe(0);
      const fast = run('homestead', 'rover', 4, { throttle: 1, steer: 0 });
      expect(fast.made).toBeGreaterThan(40);
    });

    it('makes more dust skidding round a bend than rolling straight', () => {
      const straight = run('dusty', 'rover', 4, { throttle: 1, steer: 0 });
      const turning = run('frosty', 'rover', 4, (s) => ({ throttle: 1, steer: s > 120 ? 1 : 0 }));
      const frostyStraight = run('frosty', 'rover', 4, { throttle: 1, steer: 0 });
      expect(turning.made).toBeGreaterThan(frostyStraight.made);
      expect(straight.made).toBeGreaterThan(0);
    });

    it('the Hopper\'s jump bursts out a ring of dust, jets flash, and the landing thumps', () => {
      const jets = [[-0.55, -0.3, -1], [0.55, -0.3, -1]];
      // One hop on Pebble: tap jump once, from standing still (holding it would boost, #40).
      const hop = run('pebble', 'hopper', 5, (s) => ({ throttle: 0, steer: 0, jump: s < 3 }), jets);
      expect(hop.landings).toBeGreaterThanOrEqual(1);
      expect(hop.made).toBeGreaterThan(16 + 4);
      expect(hop.flames).toBeGreaterThan(0);
    });
  });
});
