// The rocket's exhaust in the air (#60): how thick each world's air is, how much smoke that
// makes, none in a vacuum, the pool reused without allocating, each world's colour, puffs
// from the turning thrusters, thinner trails at high time speeds, and nothing in the ground.
import { describe, it, expect } from 'vitest';
import { createSystem } from '../src/physics/bodies.js';
import { EXHAUST, airOf, airAt, smokeAlpha, trailRate, warpThin, groundBlast, ExhaustPool, RocketExhaust } from '../src/physics/exhaust.js';
import { mulberry32 } from '../src/physics/noise.js';

const sys = createSystem();
const W = (id) => sys.byId[id];
const ENGINE = [{ x: 0, y: 0, scale: 1 }];

/** A rocket standing `alt` metres above the ground of `id` at angle A, pointing straight up. */
function rocketAt(id, alt, A = Math.PI / 2) {
  const body = W(id);
  const r = body.surfaceAt(A) + alt;
  return { body, x: r * Math.cos(A), y: r * Math.sin(A), vx: 0, vy: 0, angle: A, landed: false, crashed: false };
}

/** Run the exhaust for `secs` at 60 fps; `move(s, dt)` flies the rocket along. */
function run(ex, s, secs, { throttle = 1, warp = 1, move = null } = {}) {
  for (let t = 0; t < secs; t += 1 / 60) {
    if (move) move(s, 1 / 60);
    const alt = Math.hypot(s.x, s.y) - s.body.surfaceAt(Math.atan2(s.y, s.x));
    ex.update(1 / 60, s, throttle, alt, warp);
  }
}

function make(capacity) {
  const ex = new RocketExhaust(new ExhaustPool(capacity), mulberry32(60));
  ex.setRocket(ENGINE, 6);
  return ex;
}

/** The pool's live particles' colours, oldest first. */
function colours(pool) {
  const out = [];
  for (let k = 0; k < pool.count; k++) {
    const i = pool.slot(k);
    if (pool.age[i] < pool.life[i]) out.push([pool.col[i * 3], pool.col[i * 3 + 1], pool.col[i * 3 + 2]]);
  }
  return out;
}

describe('the air (#60)', () => {
  it('none on airless worlds, thick on Homestead and Misty, thin on Dusty', () => {
    for (const id of ['pebble', 'nibble', 'sizzle', 'frosty', 'flip', 'ducky']) {
      expect(airOf(W(id))).toBe(null);
      expect(airAt(W(id), 0)).toBe(0);
    }
    expect(airAt(W('homestead'), 0)).toBeCloseTo(1);
    expect(airAt(W('misty'), 0)).toBeGreaterThan(airAt(W('homestead'), 0));
    expect(airAt(W('dusty'), 0)).toBeLessThan(0.5 * airAt(W('homestead'), 0));
    // Gas giants have air too (a pale version of their colour).
    expect(airOf(W('ringo')).dens).toBe(1);
  });

  it('thins out with height, and is gone by the space line', () => {
    for (const id of ['homestead', 'dusty', 'misty']) {
      const b = W(id);
      let last = Infinity;
      for (let h = 0; h <= b.spaceLine; h += b.spaceLine / 20) {
        const a = airAt(b, h);
        expect(a).toBeLessThan(last);
        last = a;
      }
      expect(airAt(b, b.spaceLine)).toBe(0);
      expect(airAt(b, b.spaceLine * 3)).toBe(0);
    }
  });

  it('smoke: none in a vacuum, faint in thin air, solid in thick', () => {
    expect(smokeAlpha(0)).toBe(0);
    expect(smokeAlpha(EXHAUST.minAir / 2)).toBe(0);
    const dusty = smokeAlpha(airAt(W('dusty'), 0));
    const home = smokeAlpha(airAt(W('homestead'), 0));
    expect(dusty).toBeGreaterThan(0.1);
    expect(dusty).toBeLessThan(0.8 * home);
    expect(home).toBeGreaterThan(0.8);
  });

  it('trail rate: none in a vacuum or with the engine off; more with power and thicker air; thinned at warp', () => {
    expect(trailRate(0, 1)).toBe(0);
    expect(trailRate(1, 0)).toBe(0);
    expect(trailRate(1, 1)).toBeGreaterThan(trailRate(1, 0.1));
    expect(trailRate(1, 0.1)).toBeGreaterThan(0); // fine thrust (#28) still smokes a little
    expect(trailRate(1, 1)).toBeGreaterThan(trailRate(0.3, 1));
    expect(trailRate(1, 1, 1)).toBe(trailRate(1, 1));
    expect(trailRate(1, 1, 10)).toBeLessThan(trailRate(1, 1, 1));
    expect(trailRate(1, 1, 100)).toBe(0);
    expect(warpThin(1)).toBe(1);
    expect(warpThin(1000)).toBe(0);
  });

  it('the plume only hits the ground when low, pointing down and firing', () => {
    expect(groundBlast(1, 0, 1)).toBe(1);
    expect(groundBlast(1, EXHAUST.billowHigh / 2, 1)).toBeGreaterThan(0);
    expect(groundBlast(1, EXHAUST.billowHigh, 1)).toBe(0);
    expect(groundBlast(0, 0, 1)).toBe(0);
    expect(groundBlast(1, 0, 0)).toBe(0); // lying sideways
    expect(groundBlast(1, 5, 1, 2)).toBeGreaterThan(groundBlast(1, 5, 1, 1)); // big rockets blast further
  });
});

describe('the rocket\'s exhaust (#60)', () => {
  it('in a vacuum: no smoke, only dust near the ground, and nothing at all higher up', () => {
    const ex = make(400);
    const s = rocketAt('pebble', 2);
    run(ex, s, 1);
    // Dust only: the ground's grey, falling back (gravity), and never a trail up in the sky.
    expect(ex.pool.count).toBeGreaterThan(0);
    for (let k = 0; k < ex.pool.count; k++) expect(ex.pool.grav[ex.pool.slot(k)]).toBe(1);
    const high = make(400);
    run(high, rocketAt('pebble', 40), 2);
    expect(high.pool.count).toBe(0);
  });

  it('in air: a trail left behind in the sky, fading out as the air thins', () => {
    const count = (alt) => {
      const ex = make(2000);
      run(ex, rocketAt('homestead', alt), 2);
      return ex.pool.count;
    };
    const low = count(25), mid = count(45), top = count(W('homestead').spaceLine + 5);
    expect(low).toBeGreaterThan(20);
    expect(mid).toBeLessThan(low);
    expect(top).toBe(0);
    // The trail stays where it was made: climbing, the puffs are left below the rocket.
    const ex = make(400);
    const s = rocketAt('homestead', 25);
    run(ex, s, 2, { move: (st, dt) => { st.y += 15 * dt; st.vy = 15; } });
    let below = 0;
    for (let k = 0; k < ex.pool.count; k++) if (ex.pool.pos[ex.pool.slot(k) * 3 + 1] < s.y - 10) below++;
    expect(below).toBeGreaterThan(ex.pool.count / 3);
  });

  it('each world\'s colour: white steam on Homestead, dusty orange on Dusty, murky orange on Misty', () => {
    const tint = (id) => {
      const ex = make(400);
      run(ex, rocketAt(id, 30), 1);
      const c = colours(ex.pool);
      expect(c.length).toBeGreaterThan(3);
      return c.reduce((a, x) => a.map((v, i) => v + x[i] / c.length), [0, 0, 0]);
    };
    const home = tint('homestead'), dusty = tint('dusty'), misty = tint('misty');
    expect(Math.min(...home)).toBeGreaterThan(0.9);
    expect(Math.max(...home) - Math.min(...home)).toBeLessThan(0.05);
    for (const c of [dusty, misty]) {
      expect(c[0]).toBeGreaterThan(c[1]);
      expect(c[1]).toBeGreaterThan(c[2]);
    }
    // Misty's murkier: a duller orange than Dusty's.
    const sat = (c) => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
    expect(sat(misty)).toBeLessThan(sat(dusty));
  });

  it('lift-off: billows roll out along the ground both ways, never into it', () => {
    const ex = make(400);
    const s = rocketAt('homestead', 0.3);
    run(ex, s, 3);
    const b = W('homestead');
    const up = Math.atan2(s.y, s.x);
    let left = 0, right = 0;
    for (let k = 0; k < ex.pool.count; k++) {
      const i = ex.pool.slot(k);
      const x = ex.pool.pos[i * 3], y = ex.pool.pos[i * 3 + 1];
      const a = Math.atan2(y, x);
      expect(Math.hypot(x, y)).toBeGreaterThanOrEqual(b.surfaceAt(a));
      if (a - up > 0.01) left++;
      if (up - a > 0.01) right++;
    }
    expect(left).toBeGreaterThan(4);
    expect(right).toBeGreaterThan(4);
  });

  it('touchdown: a burst of billows in air, of dust in a vacuum', () => {
    const ex = make(400);
    const s = rocketAt('homestead', 0);
    s.landed = true;
    ex.touchdown(s, 3);
    expect(ex.pool.count).toBeGreaterThan(8);
    const vac = make(400);
    const p = rocketAt('pebble', 0);
    vac.touchdown(p, 3);
    expect(vac.pool.count).toBeGreaterThan(3);
    for (let k = 0; k < vac.pool.count; k++) expect(vac.pool.grav[vac.pool.slot(k)]).toBe(1);
  });

  it('turning in air: puffs from the thrusters at the nose and the tail; in a vacuum none', () => {
    const turn = (id) => {
      const ex = make(400);
      const s = rocketAt(id, 10);
      run(ex, s, 1, { throttle: 0, move: (st, dt) => { st.angle += 1.5 * dt; } });
      return ex;
    };
    const home = turn('homestead');
    expect(home.pool.count).toBeGreaterThan(5);
    expect(turn('pebble').pool.count).toBe(0);
    // Not while standing still (no turning) with the engine off.
    const still = make(400);
    run(still, rocketAt('homestead', 30), 1, { throttle: 0 });
    expect(still.pool.count).toBe(0);
  });

  it('at high time speeds the trail thins out (no absurd trails), and is gone at ×100', () => {
    const at = (warp) => {
      const ex = make(4000);
      const s = rocketAt('homestead', 30);
      run(ex, s, 1, { warp, move: (st, dt) => { st.y += 20 * warp * dt * 0.01; } });
      return ex.pool.count;
    };
    expect(at(10)).toBeLessThan(at(1));
    expect(at(100)).toBe(0);
  });

  it('the pool: fixed size, reuses the oldest slot when full, and never allocates', () => {
    const pool = new ExhaustPool(16);
    pool.setWorld(W('homestead'));
    const arrays = [pool.pos, pool.vel, pool.col, pool.age, pool.life];
    const o = { size: 1, grow: 2, life: 10, alpha: 1, drag: 1, rise: 0, grav: 0, spin: 0, seed: 0 };
    const r = W('homestead').radius + 50;
    for (let n = 0; n < 40; n++) pool.spawn(r, n, 0, 0, 0, 0, 1, 1, 1, o);
    expect(pool.count).toBe(16);
    // The 16 newest are the ones left, oldest first.
    for (let k = 0; k < 16; k++) expect(pool.pos[pool.slot(k) * 3 + 1]).toBe(24 + k);
    pool.step(1 / 60);
    arrays.forEach((a, i) => expect([pool.pos, pool.vel, pool.col, pool.age, pool.life][i]).toBe(a));
    // Done ones make room; a new world clears it.
    for (let t = 0; t < 11; t += 0.5) pool.step(0.5);
    expect(pool.count).toBe(0);
    pool.spawn(r, 0, 0, 0, 0, 0, 1, 1, 1, o);
    pool.setWorld(W('dusty'));
    expect(pool.count).toBe(0);
  });

  it('a long burn in thick air stays within the pool (the oldest go first)', () => {
    const ex = make(EXHAUST.capacity);
    const s = rocketAt('misty', 0.3);
    run(ex, s, 20);
    expect(ex.pool.count).toBeLessThanOrEqual(EXHAUST.capacity);
  });

  it('a rewind or a jump doesn\'t draw a trail joining the two places', () => {
    const ex = make(2000);
    const s = rocketAt('homestead', 25);
    run(ex, s, 0.5);
    s.y += 50; // a jump
    ex.reset();
    const before = ex.pool.count;
    run(ex, s, 1 / 60);
    for (let k = before; k < ex.pool.count; k++) expect(ex.pool.pos[ex.pool.slot(k) * 3 + 1]).toBeGreaterThan(s.y - 10);
  });
});
