// Lava on Sizzle (#45): pools carved into the ground under one lava level (#44's liquid layer),
// kept clear of Sizzle's landmarks; a rocket touching lava crashes; the helpers only land on
// solid ground; the buggy is stopped at the shore (never in the lava, never stuck), a hop
// over it is popped back to the shore, and laps round Sizzle still go round the pools.
import { describe, it, expect } from 'vitest';
import { createSystem } from '../src/physics/bodies.js';
import { SIZZLE_LAVA, SIZZLE_VENTS, dirOf } from '../src/physics/terrain.js';
import { DISCOVERIES } from '../src/physics/discoveries.js';
import { FRIENDS, REACH } from '../src/physics/friends.js';
import { Flight } from '../src/physics/sim.js';
import { predict } from '../src/physics/predict.js';
import { Buggy, LAVA, vec } from '../src/physics/buggy.js';
import { BUGGIES } from '../src/rocket/parts.js';
import { mission, parkAt, kidFlies, STATS } from './missions.js';

const sys = createSystem();
const sizzle = sys.byId.sizzle;
const R = sizzle.radius;
const SAMPLES = sizzle.surface.length - 1;
const angleOf = (i) => (i / SAMPLES) * Math.PI * 2;
const ang = (a, b) => Math.acos(Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
const KINDS = ['rover', 'truck', 'hopper'];

// Every wet spot on a fixed grid (so every run is the same).
const WET = [];
for (let i = 0; i < 720; i++) {
  for (let j = 0; j < 360; j++) {
    const d = dirOf((i / 720) * Math.PI * 2, -1 + (2 * (j + 0.5)) / 360);
    if (sizzle.liquidDepth(d.x, d.y, d.z) > 0) WET.push(d);
  }
}
const closest = (spot) => Math.min(...WET.map((d) => ang(d, spot))) * R;

describe('Sizzle\'s lava pools (#45)', () => {
  it('is lava, in pools: only the carved basins are under the level', () => {
    expect(sizzle.liquid).toEqual({ kind: 'lava', level: SIZZLE_LAVA.level });
    expect(SIZZLE_LAVA.radius).toBe(R);
    // Some lava, but most of Sizzle is solid ground.
    expect(WET.length / (720 * 360)).toBeGreaterThan(0.01);
    expect(WET.length / (720 * 360)).toBeLessThan(0.04);
    // Every wet spot is in a pool, and every pool has lava in it, up to 2-3 m deep.
    for (const d of WET) expect(sizzle.shoreDist(d.x, d.y, d.z)).toBeLessThan(0.5);
    for (const p of SIZZLE_LAVA.pools) {
      expect(sizzle.liquidDepth(p.a.x, p.a.y, p.a.z)).toBeGreaterThan(1.5);
      expect(sizzle.liquidDepth(p.a.x, p.a.y, p.a.z)).toBeLessThan(3);
    }
  });

  it('keeps clear of the vents, the biggest plume, Toasty\'s camp and the pole-to-pole lap', () => {
    for (const v of SIZZLE_VENTS) expect(closest(v)).toBeGreaterThan(28);
    for (const d of DISCOVERIES.filter((x) => x.world === 'sizzle')) for (const s of d.spots) expect(closest(s), d.id).toBeGreaterThan(30);
    for (const f of FRIENDS.filter((x) => x.world === 'sizzle')) {
      expect(closest(f.spot), f.id).toBeGreaterThan(15);
      // A rocket can land on the flight plane right by the camp (and say hello).
      const a = Math.atan2(f.spot.y, f.spot.x);
      for (let da = -REACH.landing / R; da <= REACH.landing / R; da += 1 / R) expect(sizzle.landableAt(a + da)).toBe(true);
    }
    // The great circle x = 0 (through the flight plane's top and both poles, where the buggy
    // tests drive round): no lava within 10 m of it.
    for (const d of WET) expect(Math.abs(Math.asin(d.x)) * R).toBeGreaterThan(10);
  });

  it('crosses the flight plane in two places, with plenty of solid ground for landing', () => {
    let wet = 0, runs = 0, was = sizzle.wetSample(SAMPLES - 1);
    for (let i = 0; i < SAMPLES; i++) {
      const w = sizzle.wetSample(i);
      if (w) wet++;
      if (w && !was) runs++;
      was = w;
      expect(sizzle.surface[i]).toBe(Math.max(sizzle.ground[i], sizzle.liquidTop[i]));
    }
    expect(runs).toBe(2);
    expect(wet / SAMPLES).toBeLessThan(0.08);
    for (let i = 0; i < SAMPLES; i += 4) {
      const n = sizzle.nearestLandable(angleOf(i));
      expect(sizzle.landableAt(n)).toBe(true);
      expect(Math.abs(n - angleOf(i)) * R).toBeLessThan(20);
    }
  });
});

describe('rockets and lava (#45)', () => {
  const wetAngle = (() => {
    for (let i = 0; i < SAMPLES; i++) if (sizzle.liquidTop[i] > sizzle.ground[i] + 1.5) return angleOf(i);
    return null;
  })();

  it('a gentle, upright touchdown on lava is a crash, on its surface', () => {
    expect(wetAngle).not.toBe(null);
    const f = new Flight(sys, STATS);
    const r = sizzle.surfaceAt(wetAngle) + 0.5;
    f.state = {
      body: sizzle, x: r * Math.cos(wetAngle), y: r * Math.sin(wetAngle), vx: -Math.cos(wetAngle), vy: -Math.sin(wetAngle),
      angle: wetAngle, t: 0, landed: false, landAngle: 0, crashed: false, flightTime: 10,
    };
    const events = [];
    f.on((type, d) => events.push({ type, ...d }));
    for (let i = 0; i < 120 && !f.state.crashed && !f.state.landed; i++) f.step(1 / 60, 1);
    expect(f.state.crashed).toBe(true);
    expect(events.find((e) => e.type === 'crash').reason).toBe('lava');
    expect(Math.hypot(f.state.x, f.state.y)).toBeCloseTo(sizzle.liquidR, 1);
  });

  it('the predicted path ends (💥) on the lava', () => {
    const r = sizzle.liquidR + 30;
    const seg = predict({ body: sizzle, x: r * Math.cos(wetAngle), y: r * Math.sin(wetAngle), vx: 0, vy: 0, t: 0 }).segments[0];
    expect(seg.end).toBe('impact');
    expect(Math.hypot(seg.endState.x, seg.endState.y)).toBeCloseTo(sizzle.liquidR, 1);
  });
});

describe('helpers land on solid ground on Sizzle (#45)', () => {
  const PHASES = 48;
  const where = (m) => {
    const s = m.flight.state;
    return s.crashed ? `crash ${m.log.filter((l) => l.startsWith('crash')).pop()}` : s.landed ? (sizzle.wetAt(s.landAngle) ? 'lava' : 'dry') : 'flying';
  };

  it('🛬 Land never ends in lava, from all round the orbit', () => {
    const out = {};
    for (let i = 0; i < PHASES; i++) {
      const m = parkAt(mission(), 'sizzle', 1000 + i * 37, (i / PHASES) * Math.PI * 2);
      m.run('land');
      const w = where(m);
      out[w] = (out[w] ?? 0) + 1;
    }
    expect(out).toEqual({ dry: PHASES });
  }, 60000);

  it('a coached landing never ends in lava, with a quick kid or a lazy one', () => {
    const out = {};
    let moved = 0;
    for (let i = 0; i < PHASES; i++) {
      const m = parkAt(mission(), 'sizzle', 2000 + i * 53, (i / PHASES) * Math.PI * 2 + 0.05);
      const { said } = kidFlies(m, 'land', null, { lazy: i % 3 === 0 });
      const w = where(m);
      out[w] = (out[w] ?? 0) + 1;
      if (said.some((l) => l.includes('lava'))) moved++;
    }
    expect(out).toEqual({ dry: PHASES });
    // (Some of them were heading for lava, and Pip flew them over.)
    expect(moved).toBeGreaterThan(0);
  }, 60000);

  it('a landing that would have come down in lava is flown over to solid ground', () => {
    // Start right above the widest lava on the flight plane, still, a little way up.
    let best = null;
    for (let i = 0; i < SAMPLES; i++) {
      const gap = Math.abs(sizzle.nearestLandable(angleOf(i)) - angleOf(i));
      if (!best || gap > best.gap) best = { a: angleOf(i), gap };
    }
    for (const coach of [false, true]) {
      const m = mission();
      const r = sizzle.liquidR + 50;
      m.flight.state = {
        body: sizzle, x: r * Math.cos(best.a), y: r * Math.sin(best.a), vx: 0, vy: 0,
        angle: best.a, t: 0, landed: false, landAngle: 0, crashed: false, flightTime: 0,
      };
      const said = [];
      m.ap.on((e) => e.text && said.push(e.text));
      if (coach) kidFlies(m, 'land', null);
      else m.run('land');
      expect(where(m)).toBe('dry');
      if (coach) expect(said).toContain('Oops, lava! I\'ll fly us over to solid ground.');
    }
  }, 60000);
});

describe('the buggy at the lava\'s edge (#45)', () => {
  // A start `out` metres beyond pool p's shore, on the side `q` (radians round it), facing its middle.
  const approach = (p, q, out = 16) => {
    const c = [p.a.x, p.a.y, p.a.z];
    const e1 = vec.norm(vec.cross(c, [0.3, 0.2, 1]));
    const e2 = vec.cross(c, e1);
    const dir = vec.add(vec.mul(e1, Math.cos(q)), vec.mul(e2, Math.sin(q)));
    const back = (p.r + out) / R;
    const start = vec.norm(vec.add(vec.mul(c, Math.cos(back)), vec.mul(dir, Math.sin(back))));
    return { start, fwd: vec.norm(vec.sub(c, start)), dry: sizzle.shoreDist(...start) > 10 };
  };
  const inLava = (b) => sizzle.liquidDepth(...b.up) > 0 && vec.len(b.p) < sizzle.liquidR + b.kind.ride - 1e-3;
  // Drive with `input` for `secs`; how far it went, and whether it was ever in the lava.
  const drive = (b, secs, input, run) => {
    let path = 0;
    for (let t = 0; t < secs; t += 1 / 60) {
      const p = b.p;
      b.step(1 / 60, input(t));
      path += vec.len(vec.sub(b.p, p));
      if (inLava(b)) run.inside++;
      run.closest = Math.min(run.closest, sizzle.shoreDist(...b.up));
      run.sizzled = Math.max(run.sizzled, b.sizzled);
      b.sizzled = 0;
    }
    return path;
  };

  for (const kind of KINDS) {
    it(`the ${kind} driven straight at every pool, from every side, stops at the shore and gets away`, () => {
      let tried = 0;
      SIZZLE_LAVA.pools.forEach((p, pi) => {
        for (let k = 0; k < 16; k++) {
          const a = approach(p, (k / 16) * Math.PI * 2);
          if (!a.dry) continue;
          tried++;
          const at = `pool ${pi}, side ${k}`;
          const go = () => {
            const b = new Buggy(sizzle, BUGGIES[kind]);
            b.spawn(a.start, a.fwd);
            const run = { inside: 0, closest: Infinity, sizzled: 0 };
            drive(b, 10, () => ({ throttle: 1, steer: 0 }), run);
            return { b, run };
          };
          // Stopped at the edge: right up to it, never in, and Pip had something to say.
          const { b, run } = go();
          expect(run.inside, at).toBe(0);
          expect(run.closest, at).toBeLessThan(LAVA.edge + 0.5);
          expect(run.closest, at).toBeGreaterThan(LAVA.edge - 0.3);
          expect(run.sizzled, at).toBeGreaterThan(0.3);
          // Never stuck: holding GO and steering drives away along the shore...
          expect(drive(b, 8, () => ({ throttle: 1, steer: k % 2 ? 1 : -1 }), run), at).toBeGreaterThan(15);
          expect(run.inside, at).toBe(0);
          // ...and so does backing up (away, or along the shore if it had turned to slide along it).
          const again = go();
          expect(drive(again.b, 4, () => ({ throttle: -1, steer: 0 }), again.run), at).toBeGreaterThan(5);
          expect(again.run.inside, at).toBe(0);
        }
      });
      expect(tried).toBeGreaterThan(80);
    }, 60000);
  }

  it('a hop or the Hopper\'s jets never land it in lava: it\'s popped back to the shore', () => {
    let over = 0;
    SIZZLE_LAVA.pools.forEach((p, pi) => {
      for (let k = 0; k < 16; k++) {
        const a = approach(p, (k / 16) * Math.PI * 2);
        if (!a.dry) continue;
        for (const hold of [false, true]) {
          const b = new Buggy(sizzle, BUGGIES.hopper);
          b.spawn(a.start, a.fwd);
          const run = { inside: 0, closest: Infinity, sizzled: 0 };
          let jumpAt = -1, wasOver = false;
          drive(b, 25, (t) => {
            if (jumpAt < 0 && sizzle.shoreDist(...b.up) < LAVA.slow + 1) jumpAt = t;
            if (sizzle.liquidDepth(...b.up) > 0) wasOver = true;
            return { throttle: t < 12 ? 1 : 0, steer: 0, jump: jumpAt >= 0 && t - jumpAt < (hold ? 1.5 : 0.05) };
          }, run);
          const at = `pool ${pi}, side ${k}, ${hold ? 'jets' : 'hop'}`;
          if (wasOver) over++;
          expect(run.inside, at).toBe(0);
          // Back on solid ground, by the shore at the nearest.
          expect(b.grounded, at).toBe(true);
          expect(sizzle.shoreDist(...b.up), at).toBeGreaterThan(LAVA.edge - 0.5);
        }
      }
    });
    // (Plenty of them did fly out over the lava.)
    expect(over).toBeGreaterThan(40);
  }, 60000);

  it('a buggy put down in lava (it can\'t drive there) comes straight out', () => {
    for (const p of SIZZLE_LAVA.pools) {
      const b = new Buggy(sizzle, BUGGIES.rover);
      b.spawn([p.a.x, p.a.y, p.a.z], vec.cross([p.a.x, p.a.y, p.a.z], [0, 0, 1]));
      const run = { inside: 0, closest: Infinity, sizzled: 0 };
      drive(b, 12, () => ({ throttle: 0, steer: 0 }), run);
      expect(run.inside).toBe(0);
      expect(sizzle.liquidDepth(...b.up)).toBeLessThan(0);
      expect(b.grounded).toBe(true);
    }
  });

  it('never wades: no drag, no floating, no spray by the lava', () => {
    const b = new Buggy(sizzle, BUGGIES.rover);
    const p = SIZZLE_LAVA.pools[0];
    b.soak(sizzle.liquidR - 1, [p.a.x, p.a.y, p.a.z]);
    expect(b.inWater).toBe(false);
    expect(b.wet).toBe(0);
  });

  it('round the world on Sizzle still works, steering round the pools (#29)', () => {
    // A pretend kid heads round a great circle that crosses lava; stopped by it, they steer
    // left for a moment (still holding GO), then head on round again.
    for (const kind of KINDS) {
      for (const axis of [[0, 0, 1], vec.norm([0.2, -0.5, 0.8])]) {
        const start = vec.norm(vec.cross(axis, [1, 0, 0]));
        const b = new Buggy(sizzle, BUGGIES[kind]);
        b.spawn(start, vec.cross(axis, start));
        let dodge = 0, hits = 0, t = 0;
        for (; t < 600 && !b.wentRound; t += 1 / 60) {
          const u = b.up;
          const want = vec.norm(vec.cross(axis, u));
          if (b.sizzled > 0.3) {
            dodge = 1.5;
            hits++;
          }
          b.sizzled = 0;
          let steer = 1;
          if (dodge > 0) dodge -= 1 / 60;
          else steer = vec.dot(b.f, want) > 0.97 ? 0 : Math.sign(vec.dot(vec.cross(b.f, want), u)) || 1;
          b.step(1 / 60, { throttle: 1, steer });
          expect(inLava(b)).toBe(false);
        }
        expect(b.wentRound, `${kind} round ${axis}`).toBe(true);
        if (axis[2] === 1) expect(hits, kind).toBeGreaterThan(0); // the equator does cross lava
      }
    }
  }, 60000);
});
