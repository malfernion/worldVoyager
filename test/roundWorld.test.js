// Driving all the way round the world (#29): the lap counter on its own, then the real buggy
// physics driven round (and not round) Pebble and Nibble, then saving.
import { describe, it, expect, beforeEach } from 'vitest';
import { createSystem } from '../src/physics/bodies.js';
import { Buggy, WorldLap, vec, ROUND } from '../src/physics/buggy.js';
import { BUGGIES } from '../src/rocket/parts.js';
import { Progress, STICKERS } from '../src/progress.js';

const TAU = 2 * Math.PI;

// A tiny seeded random, so every run drives the same way.
const random = (seed) => {
  let s = seed * 7919 + 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
};
const randomDir = (rand) => {
  const z = rand() * 2 - 1, a = rand() * TAU, k = Math.sqrt(1 - z * z);
  return [k * Math.cos(a), k * Math.sin(a), z];
};

describe('the lap counter (#29)', () => {
  // Walk a path of unit vectors, facing `f` at the start; count the laps.
  function laps(points, f) {
    const lap = new WorldLap();
    let n = 0;
    for (const u of points) if (lap.update(u, f)) n++;
    return { n, lap };
  }
  // Points round a circle `radius` radians from its middle `c`, starting at angle `from`.
  function circle(c, radius, turns, from = 0, steps = 2000) {
    const e1 = vec.norm(vec.cross(c, Math.abs(c[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const e2 = vec.cross(c, e1);
    const out = [];
    for (let i = 0; i <= turns * steps; i++) {
      const a = from + (i / steps) * TAU;
      const side = vec.add(vec.mul(e1, Math.cos(a)), vec.mul(e2, Math.sin(a)));
      out.push(vec.add(vec.mul(c, Math.cos(radius)), vec.mul(side, Math.sin(radius))));
    }
    return out;
  }

  it('counts once per time round any great circle, whichever way we were facing', () => {
    const rand = random(1);
    for (let k = 0; k < 60; k++) {
      const pole = randomDir(rand);
      const path = circle(pole, Math.PI / 2, 3.02, rand() * TAU);
      // Facing along the way round, or anywhere at all (e.g. after landing from a super hop).
      const along = vec.sub(path[1], path[0]);
      expect(laps(path, k % 2 ? along : randomDir(rand)).n).toBe(3);
    }
  });

  it('never counts going there and back along it', () => {
    const rand = random(2);
    for (let k = 0; k < 40; k++) {
      const pole = randomDir(rand);
      const start = rand() * TAU;
      const there = circle(pole, Math.PI / 2, 0.97, start);
      const back = [...there].reverse();
      const path = [...there, ...back, ...there, ...back];
      expect(laps(path, vec.sub(there[1], there[0])).n).toBe(0);
    }
  });

  it('little circles never count, however many times round', () => {
    const rand = random(3);
    for (const radius of [0.05, 0.2, 0.4, 0.6, 0.8]) {
      for (let k = 0; k < 10; k++) {
        expect(laps(circle(randomDir(rand), radius, 5), randomDir(rand)).n).toBe(0);
      }
    }
  });

  it('only very big circles count, nearly as big as the world', () => {
    // A circle 70° from its middle is like driving round the Earth through Canada.
    const { n } = laps(circle([0, 0, 1], 1.22, 3), [1, 0, 0]);
    expect(n).toBeGreaterThan(1);
    expect(ROUND.far).toBeGreaterThan(0.5);
  });
});

describe('driving round the world (#29)', () => {
  const sys = createSystem();

  // Drive a buggy with `kid(t, b, home)` giving the input each frame; returns when (if) it went round.
  function drive(world, kind, seconds, kid) {
    const body = sys.byId[world];
    const b = new Buggy(body, BUGGIES[kind]);
    b.spawn([0, 1, 0], [0, 0, 1]);
    const home = b.up;
    let at = -1, most = 0, far = 1, travelled = 0, last = home, halfwayFar = null;
    for (let i = 0; i < seconds * 60 && at < 0; i++) {
      b.step(1 / 60, kid(i / 60, b, home));
      const u = b.up;
      travelled += Math.acos(Math.min(1, vec.dot(u, last)));
      last = u;
      if (halfwayFar === null && b.round.progress >= 0.5) halfwayFar = vec.dot(u, home);
      most = Math.max(most, b.round.progress);
      far = Math.min(far, vec.dot(u, home));
      if (b.wentRound) at = i / 60;
    }
    return { b, at, most, far, travelled, halfwayFar };
  }

  // Steer towards home (as the rocket compass shows), a wide turn to face it first.
  const towards = (b, target) => {
    const u = b.up;
    const d = vec.sub(target, vec.mul(u, vec.dot(target, u)));
    const side = vec.dot(vec.cross(b.f, d), u);
    return vec.dot(b.f, d) < 0.98 * vec.len(d) ? Math.sign(side) || 1 : 0;
  };

  it('every world with ground to drive on can be driven round', () => {
    const worlds = sys.bodies.filter((b) => b.solid && b.kind !== 'star').map((b) => b.id);
    expect(worlds).toEqual(expect.arrayContaining(['homestead', 'pebble', 'dusty', 'nibble', 'sizzle', 'frosty', 'flip', 'ducky']));
    for (const world of worlds) expect(drive(world, 'rover', 400, () => ({ throttle: 1, steer: 0 })).at, world).toBeGreaterThan(0);
  });

  for (const world of ['pebble', 'nibble']) {
    for (const kind of ['rover', 'truck', 'hopper']) {
      it(`straight ahead goes all the way round ${world} in the ${kind}`, () => {
        const { at, travelled, halfwayFar } = drive(world, kind, 240, () => ({ throttle: 1, steer: 0 }));
        expect(at).toBeGreaterThan(0);
        expect(travelled).toBeGreaterThan(ROUND.far * TAU);
        expect(halfwayFar).toBeLessThan(-0.8); // halfway is the far side of the world
      });
    }

    it(`wobbly steering still goes round ${world}`, () => {
      for (const kind of ['rover', 'hopper']) {
        for (let seed = 1; seed <= 6; seed++) {
          // Taps left and right, 0.2-0.7 s each, every 1-3 s: never quite straight.
          const rand = random(seed);
          let steer = 0, until = 0, way = 1;
          const { at } = drive(world, kind, 600, (t) => {
            if (t >= until) {
              if (steer) {
                steer = 0;
                until = t + 1 + rand() * 2;
              } else {
                way = -way;
                steer = way;
                until = t + 0.2 + rand() * 0.5;
              }
            }
            return { throttle: 1, steer };
          });
          expect(at, `${kind}, seed ${seed}`).toBeGreaterThan(0);
        }
      }
    });

    it(`driving there and back on ${world} never counts, even from nearly all the way round`, () => {
      for (const how of [0.3, 0.5, 0.75, 0.92]) {
        // Reversing back to the rocket (until it's as close as it gets), then off again; over and over.
        let out = true, closest = -1;
        const reversing = drive(world, 'rover', 600, (t, b, home) => {
          const d = vec.dot(b.up, home);
          if (out && b.round.progress > how) {
            out = false;
            closest = -1;
          }
          if (!out && d > 0.9 && d < closest - 1e-4) out = true;
          closest = Math.max(closest, d);
          return { throttle: out ? 1 : -1, steer: 0 };
        });
        expect(reversing.at, `reversing from ${how}`).toBe(-1);
        expect(reversing.most).toBeGreaterThan(how);
        // Turning round and following our tracks back to the rocket.
        let leg = 'out', was = null;
        const tracks = [];
        const turning = drive(world, 'rover', 600, (t, b) => {
          if (leg === 'out') {
            if (!tracks.length || vec.dot(b.up, tracks.at(-1)) < 0.9995) tracks.push(b.up);
            if (b.round.progress > how) {
              leg = 'turn';
              was = b.f;
            }
          }
          if (leg === 'turn' && vec.dot(b.f, was) < -0.9) leg = 'back';
          while (leg === 'back' && tracks.length && vec.dot(b.up, tracks.at(-1)) > 0.998) tracks.pop();
          if (leg === 'back' && !tracks.length) leg = 'away';
          // Then head back out the way we first went.
          if (leg === 'away' && vec.dot(b.f, [0, 0, 1]) > 0.95) leg = 'out';
          const steer = leg === 'out' ? 0 : leg === 'back' ? towards(b, tracks.at(-1)) : 1;
          return { throttle: 1, steer };
        });
        expect(turning.at, `turning back from ${how}`).toBe(-1);
        expect(turning.most).toBeGreaterThan(how);
      }
    });

    it(`going round in circles on ${world} never counts`, () => {
      for (const steer of [1, 0.5, 0.25]) {
        const { at } = drive(world, 'rover', 600, () => ({ throttle: 1, steer }));
        expect(at, `steering ${steer}`).toBe(-1);
      }
    });
  }

  it('orbiting Nibble in a super hop doesn\'t count as driving round it', () => {
    const b = new Buggy(sys.byId.nibble, BUGGIES.hopper);
    b.spawn([0, 1, 0], [0, 0, 1]);
    let orbited = false, landed = -1, most = 0;
    for (let i = 0; i < 240 * 60 && landed < 0; i++) {
      const t = i / 60;
      // Full speed, then jump and hold it until we've been all the way round in orbit.
      b.step(1 / 60, { throttle: 1, steer: 0, jump: t > 1 && !orbited });
      orbited ||= !!b.orbited;
      if (b.orbiting) most = Math.max(most, b.round.progress);
      expect(b.wentRound).toBeFalsy();
      if (orbited && b.grounded) landed = i;
    }
    expect(orbited).toBe(true);
    expect(landed).toBeGreaterThan(0);
    expect(most).toBe(0);
    // Driving on from where we came down, it counts from there.
    for (let i = 0; i < 240 * 60 && !b.wentRound; i++) b.step(1 / 60, { throttle: 1, steer: 0 });
    expect(b.wentRound).toBe(true);
  });
});

describe('saving worlds driven round (#29)', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    };
  });

  it('one sticker for the first time, and a tick for each world', () => {
    expect(STICKERS['round-world'].icon).toBe('🌍');
    const p = new Progress();
    expect(p.wentRound('pebble')).toBe(true);
    expect(p.earn('round-world')).toBe(true);
    expect(p.wentRound('pebble')).toBe(false);
    expect(p.wentRound('nibble')).toBe(true);
    expect(p.earn('round-world')).toBe(false);
    const again = new Progress();
    expect(again.has('round-world')).toBe(true);
    expect(Object.keys(again.rounds).sort()).toEqual(['nibble', 'pebble']);
  });

  it('an older save (before #29) still loads, with no worlds driven round', () => {
    store.set('worldVoyager.v1', JSON.stringify({ done: { space: 1, drive: 2 }, design: { stack: [] }, settings: {}, markers: { rocket: true } }));
    const p = new Progress();
    expect(p.has('drive') && p.explained('rocket')).toBe(true);
    expect(p.rounds).toEqual({});
    p.wentRound('dusty');
    expect(new Progress().rounds.dusty).toBeGreaterThan(0);
  });

  it('a brand new adventure forgets them', () => {
    const p = new Progress();
    p.wentRound('pebble');
    p.reset();
    expect(p.rounds).toEqual({});
    expect(new Progress().rounds).toEqual({});
  });
});
