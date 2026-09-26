// Liquids (#44): Homestead's seas. The terrain keeps a real seabed under the water; the rocket's
// surface is the water's (touching it is a splash crash); the helpers only ever land on dry
// land; the buggy drives down along the seabed and back out; old saves keep Splashdown!.
import { describe, it, expect } from 'vitest';
import { createSystem, LAUNCH_ANGLE } from '../src/physics/bodies.js';
import { seabedDepth, OBSERVATORY, dirOf } from '../src/physics/terrain.js';
import { Flight } from '../src/physics/sim.js';
import { predict } from '../src/physics/predict.js';
import { Buggy, WorldLap, vec } from '../src/physics/buggy.js';
import { DustPool, BuggyDust } from '../src/physics/dust.js';
import { BUGGIES } from '../src/rocket/parts.js';
import { Progress, STICKERS } from '../src/progress.js';
import { mission, parkAt, kidFlies, STATS } from './missions.js';

const sys = createSystem();
const home = sys.home;
const SAMPLES = home.surface.length - 1;
const angleOf = (i) => (i / SAMPLES) * Math.PI * 2;

// The deepest bit of sea (a fixed grid search, so every run is the same).
function deepest(body) {
  let best = null;
  for (let i = 0; i < 400; i++) {
    for (let j = 0; j < 200; j++) {
      const z = -1 + (2 * (j + 0.5)) / 200;
      const d = dirOf((i / 400) * Math.PI * 2, z);
      const depth = body.liquidDepth(d.x, d.y, d.z);
      if (!best || depth > best.depth) best = { dir: [d.x, d.y, d.z], depth };
    }
  }
  return best;
}
const DEEP = deepest(home);

describe('the liquid layer (#44)', () => {
  it('Homestead has water, Sizzle has lava (#45); the other worlds have no liquid', () => {
    expect(home.liquid).toEqual({ kind: 'water', level: -1.5 });
    expect(home.liquidR).toBe(home.radius - 1.5);
    expect(sys.byId.sizzle.liquid.kind).toBe('lava');
    for (const b of sys.bodies) if (b !== home && b.id !== 'sizzle') expect(b.liquid).toBe(null);
  });

  it('the seabed is gentle by the shore and deeper further out', () => {
    expect(seabedDepth(0)).toBe(0);
    let last = 0;
    for (let d = 0.5; d < 12; d += 0.5) {
      const s = seabedDepth(d);
      expect(s).toBeGreaterThan(last);
      last = s;
    }
    // Shallower than the raw shape near the coast (gentle beaches)...
    expect(seabedDepth(1)).toBeLessThan(0.8);
    // ...and seas several metres deep in the middle.
    expect(DEEP.depth).toBeGreaterThan(5);
    expect(DEEP.depth).toBeLessThan(12);
    // The terrain itself is no longer flat at sea level.
    const d = DEEP.dir;
    expect(home.terrainFn.height(...d)).toBeLessThan(home.liquid.level - 5);
  });

  it('the launch pad, the observatory and the campfire are on dry land', () => {
    expect(home.liquidDepth(0, 1, 0)).toBeLessThan(-2);
    expect(home.liquidDepth(OBSERVATORY.x, OBSERVATORY.y, OBSERVATORY.z)).toBeLessThan(-2);
    expect(home.landableAt(LAUNCH_ANGLE)).toBe(true);
    expect(home.wetAt(LAUNCH_ANGLE)).toBe(false);
  });

  it('along the flight plane the rocket touches the higher of the ground and the water', () => {
    let wet = 0;
    for (let i = 0; i <= SAMPLES; i++) {
      expect(home.surface[i]).toBe(Math.max(home.ground[i], home.liquidTop[i]));
      if (home.liquidTop[i] > home.ground[i]) {
        wet++;
        expect(home.surface[i]).toBeCloseTo(home.liquidR, 4);
      }
    }
    // Some sea crosses the flight plane (the rocket can splash into it).
    expect(wet).toBeGreaterThan(SAMPLES * 0.02);
    expect(home.minSurface).toBeCloseTo(home.liquidR, 4);
    // Other worlds: the surface is just the ground, and nowhere is wet.
    const pebble = sys.byId.pebble;
    for (let i = 0; i < SAMPLES; i += 7) {
      expect(pebble.surface[i]).toBe(pebble.ground[i]);
      expect(pebble.wetAt(angleOf(i))).toBe(false);
    }
  });

  it('landable spots are dry with room either side, and there is always one nearby', () => {
    for (let i = 0; i < SAMPLES; i++) {
      const a = angleOf(i);
      if (home.landableAt(a)) {
        for (const off of [-3.5, 0, 3.5]) expect(home.wetAt(a + off / home.radius)).toBe(false);
      }
      const n = home.nearestLandable(a);
      expect(n).not.toBe(null);
      expect(home.landableAt(n)).toBe(true);
      // The seas on the flight plane are under 100 m across.
      expect(Math.abs(n - a) * home.radius).toBeLessThan(60);
    }
  });
});

describe('rockets and water (#44)', () => {
  const gentleDrop = (angle, speed = 1) => {
    const f = new Flight(sys, STATS);
    const r = home.surfaceAt(angle) + 0.5;
    f.state = {
      body: home, x: r * Math.cos(angle), y: r * Math.sin(angle), vx: -speed * Math.cos(angle), vy: -speed * Math.sin(angle),
      angle, t: 0, landed: false, landAngle: 0, crashed: false, flightTime: 10,
    };
    const events = [];
    f.on((type, d) => events.push({ type, ...d }));
    for (let i = 0; i < 120 && !f.state.landed && !f.state.crashed; i++) f.step(1 / 60, 1);
    return { f, events };
  };
  const wetAngle = (() => {
    for (let i = 0; i < SAMPLES; i++) if (home.liquidTop[i] > home.ground[i] + 1) return angleOf(i);
    return null;
  })();

  it('a gentle, upright touchdown on water is a splash crash', () => {
    expect(wetAngle).not.toBe(null);
    const { f, events } = gentleDrop(wetAngle);
    expect(f.state.crashed).toBe(true);
    expect(events.find((e) => e.type === 'crash').reason).toBe('water');
    expect(events.some((e) => e.type === 'landed')).toBe(false);
    // It hit the water's surface, not the seabed below it.
    expect(Math.hypot(f.state.x, f.state.y)).toBeCloseTo(home.liquidR, 1);
  });

  it('the same touchdown on dry land is a landing', () => {
    const { f, events } = gentleDrop(LAUNCH_ANGLE);
    expect(f.state.landed).toBe(true);
    expect(events.some((e) => e.type === 'crash')).toBe(false);
  });

  it('the predicted path ends (💥) at the water, not the seabed', () => {
    const r = home.liquidR + 40;
    const state = { body: home, x: r * Math.cos(wetAngle), y: r * Math.sin(wetAngle), vx: 0, vy: 0, t: 0 };
    const seg = predict(state).segments[0];
    expect(seg.end).toBe('impact');
    expect(Math.hypot(seg.endState.x, seg.endState.y)).toBeCloseTo(home.liquidR, 1);
  });

  it('Splashdown! is earned by that crash now, and old saves keep it', () => {
    expect(STICKERS.splash.icon).toBe('🌊');
    expect(STICKERS.splash.say).toContain('Rockets can\'t float');
    const store = new Map();
    globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
    store.set('worldVoyager.v1', JSON.stringify({ done: { space: 1, orbit: 2, 'land-homestead': 3, splash: 4 } }));
    const p = new Progress();
    expect(p.has('splash')).toBe(true);
    expect(p.currentGoal.id).toBe('visit-pebble');
  });
});

describe('helpers land on dry land (#44)', () => {
  // From all round a parking orbit (so every sea on the flight plane passes underneath).
  const PHASES = 48;
  const where = (m) => {
    const s = m.flight.state;
    return s.crashed ? `crash ${m.log.filter((l) => l.startsWith('crash')).pop()}` : s.landed ? (home.wetAt(s.landAngle) ? 'wet' : 'dry') : 'flying';
  };

  it('🛬 Land never ends in the water', () => {
    const out = {};
    for (let i = 0; i < PHASES; i++) {
      const m = parkAt(mission(), 'homestead', 1000 + i * 37, (i / PHASES) * Math.PI * 2);
      m.run('land');
      const w = where(m);
      out[w] = (out[w] ?? 0) + 1;
    }
    expect(out).toEqual({ dry: PHASES });
  }, 60000);

  it('a coached landing never ends in the water, with a quick kid or a lazy one', () => {
    const out = {};
    for (let i = 0; i < PHASES; i++) {
      const m = parkAt(mission(), 'homestead', 2000 + i * 53, (i / PHASES) * Math.PI * 2 + 0.05);
      const { said } = kidFlies(m, 'land', null, { lazy: i % 3 === 0 });
      const w = where(m);
      out[w] = (out[w] ?? 0) + 1;
      // Pip only mentions the water when she had to move us.
      if (said.some((l) => l.includes('water'))) expect(w).toBe('dry');
    }
    expect(out).toEqual({ dry: PHASES });
  }, 60000);

  it('a landing that would have come down in the sea is flown over to the land', () => {
    // Start right above the widest sea on the flight plane, still, a little way up.
    let best = null;
    for (let i = 0; i < SAMPLES; i++) {
      const n = home.nearestLandable(angleOf(i));
      const gap = Math.abs(n - angleOf(i));
      if (!best || gap > best.gap) best = { a: angleOf(i), gap };
    }
    for (const coach of [false, true]) {
      const m = mission();
      const r = home.liquidR + 60;
      m.flight.state = {
        body: home, x: r * Math.cos(best.a), y: r * Math.sin(best.a), vx: 0, vy: 0,
        angle: best.a, t: 0, landed: false, landAngle: 0, crashed: false, flightTime: 0,
      };
      const said = [];
      m.ap.on((e) => e.text && said.push(e.text));
      if (coach) kidFlies(m, 'land', null);
      else m.run('land');
      expect(where(m)).toBe('dry');
      expect(home.landableAt(m.flight.state.landAngle)).toBe(true);
      if (coach) expect(said).toContain('Oops, water! I\'ll fly us over to dry land.');
    }
  }, 60000);

  it('🤖 Take me there home from the pad, and 🧭 Show me how, land on dry land', () => {
    for (const coach of [false, true]) {
      for (let i = 0; i < 3; i++) {
        const m = mission();
        m.flight.resetToPad(500 + i * 911);
        if (coach) kidFlies(m, 'goto', 'homestead');
        else m.run('goto', 'homestead');
        expect(where(m)).toBe('dry');
      }
    }
  }, 60000);
});

describe('the buggy in the sea (#44)', () => {
  // Drive straight at the deepest spot from 60 m away, and on out the other side.
  function crossing(kind, heading, seconds = 90) {
    const c = DEEP.dir;
    const e1 = vec.norm(vec.cross(c, [0, 0, 1]));
    const e2 = vec.cross(c, e1);
    const fwd = vec.add(vec.mul(e1, Math.cos(heading)), vec.mul(e2, Math.sin(heading)));
    const back = 60 / home.radius;
    const start = vec.norm(vec.add(vec.mul(c, Math.cos(back)), vec.mul(fwd, -Math.sin(back))));
    const b = new Buggy(home, BUGGIES[kind]);
    b.spawn(start, fwd);
    const run = { b, deepest: -Infinity, wentIn: false, cameOut: false, stuck: 0, topUnder: 0 };
    for (let t = 0; t < seconds && !run.cameOut; t += 1 / 60) {
      b.step(1 / 60, { throttle: 1, steer: 0 });
      run.deepest = Math.max(run.deepest, b.depth);
      if (b.inWater) run.wentIn = true;
      if (b.depth > 2) run.topUnder = Math.max(run.topUnder, b.speed);
      if (b.grounded && b.speed < 0.5) run.stuck += 1 / 60;
      if (run.wentIn && !b.inWater && b.depth < -2) run.cameOut = true;
    }
    return run;
  }

  for (const kind of ['rover', 'truck', 'hopper']) {
    it(`the ${kind} drives down the beach, along the deep seabed and out again`, () => {
      for (let k = 0; k < 8; k++) {
        const r = crossing(kind, (k / 8) * Math.PI * 2 + 0.3);
        expect(r.wentIn).toBe(true);
        expect(r.deepest).toBeGreaterThan(3);
        expect(r.cameOut).toBe(true);
        expect(r.stuck).toBeLessThan(1);
        // Slower under water, but still going.
        expect(r.topUnder).toBeLessThan(r.b.topSpeed * 0.8);
        expect(r.topUnder).toBeGreaterThan(1.5);
      }
    });
  }

  it('is never stuck anywhere in a sea: from random spots, it always drives out', () => {
    let seed = 5;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 60; n++) {
      let d;
      do {
        const p = dirOf(rand() * Math.PI * 2, rand() * 2 - 1);
        d = [p.x, p.y, p.z];
      } while (home.liquidDepth(...d) < 0.5);
      const b = new Buggy(home, BUGGIES[['rover', 'truck', 'hopper'][n % 3]]);
      b.spawn(d, vec.cross(d, vec.norm([rand() - 0.5, rand() - 0.5, rand() - 0.5])));
      let out = false;
      for (let t = 0; t < 90 && !out; t += 1 / 60) {
        b.step(1 / 60, { throttle: 1, steer: 0 });
        out = !b.inWater && b.depth < -1;
      }
      expect(out).toBe(true);
    }
  });

  it('floats a little under water: hops go higher and come back down', () => {
    const hop = (dir) => {
      const b = new Buggy(home, BUGGIES.hopper);
      b.spawn(dir, vec.cross(dir, [0, 0, 1]));
      for (let i = 0; i < 30; i++) b.step(1 / 60, { throttle: 0, steer: 0 });
      let high = 0;
      let landed = false;
      for (let i = 0; i < 60 * 8 && !landed; i++) {
        b.step(1 / 60, { throttle: 0, steer: 0, jump: i < 3 });
        high = Math.max(high, b.altitude);
        if (i > 20 && b.grounded) landed = true;
      }
      return { high, landed, b };
    };
    const dry = hop([0, 1, 0]);
    const wet = hop(DEEP.dir);
    expect(wet.b.depth).toBeGreaterThan(3);
    expect(wet.landed).toBe(true);
    expect(wet.high).toBeGreaterThan(dry.high);
  });

  it('bubbles under water, a splash going in', () => {
    const pool = new DustPool();
    // Start on the beach: 60 m back from the deepest spot, the first way round that's dry there.
    const c = DEEP.dir;
    const e1 = vec.norm(vec.cross(c, [0, 0, 1]));
    const e2 = vec.cross(c, e1);
    let fwd, start;
    for (let k = 0; k < 16; k++) {
      fwd = vec.add(vec.mul(e1, Math.cos(k * 0.4)), vec.mul(e2, Math.sin(k * 0.4)));
      const back = 60 / home.radius;
      start = vec.norm(vec.add(vec.mul(c, Math.cos(back)), vec.mul(fwd, -Math.sin(back))));
      if (home.liquidDepth(...start) < -1) break;
    }
    expect(home.liquidDepth(...start)).toBeLessThan(-1);
    const b = new Buggy(home, BUGGIES.rover);
    b.spawn(start, fwd);
    let seed = 1;
    const dust = new BuggyDust(pool, b, [[-0.8, 0.9], [0.8, 0.9], [-0.8, -0.9], [0.8, -0.9]], [], () => (seed = (seed * 16807) % 2147483647) / 2147483647);
    let splashed = 0, bubbles = 0;
    for (let t = 0; t < 30 && b.depth < 3; t += 1 / 60) {
      b.step(1 / 60, { throttle: 1, steer: 0 });
      dust.update(1 / 60, { throttle: 1 });
      pool.step(1 / 60);
      if (dust.splashed) splashed++;
      if (b.depth > 1) for (let n = 0; n < pool.count; n++) if (pool.float[pool.live[n]] === 1) bubbles++;
      // Nothing ever ends up above the surface as a bubble, or under it as spray.
      for (let n = 0; n < pool.count; n++) {
        const i = pool.live[n];
        const r = Math.hypot(pool.pos[i * 3], pool.pos[i * 3 + 1], pool.pos[i * 3 + 2]);
        if (pool.float[i] === 1) expect(r).toBeLessThanOrEqual(home.liquidR + 1e-6);
      }
    }
    expect(splashed).toBeGreaterThan(0);
    expect(bubbles).toBeGreaterThan(0);
  });

  it('a lap round the world can cross a sea (#29)', () => {
    // A great circle through the deepest sea, driven by the Hopper (quickest), no obstacles.
    const c = DEEP.dir;
    const fwd = vec.norm(vec.cross(c, [0.3, 0.2, 1]));
    const back = 40 / home.radius;
    const start = vec.norm(vec.add(vec.mul(c, Math.cos(back)), vec.mul(fwd, -Math.sin(back))));
    const b = new Buggy(home, BUGGIES.hopper);
    b.spawn(start, fwd);
    let wentIn = false;
    for (let t = 0; t < 400 && !b.wentRound; t += 1 / 30) {
      b.step(1 / 30, { throttle: 1, steer: 0 });
      if (b.depth > 2) wentIn = true;
    }
    expect(wentIn).toBe(true);
    expect(b.wentRound).toBe(true);
    expect(new WorldLap().progress).toBe(0);
  }, 30000);
});

