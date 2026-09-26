// Misty (#46): Ringo's hazy moon with methane lakes, carved into its ground under one level
// (like Sizzle's lava, #45) and made of #44's liquid layer. Its orbit keeps clear of Frosty; a
// rocket touching a lake crashes; the helpers land on the ground (from all round the orbit,
// and after a whole trip there); the buggy drives through the lakes like water; laps round
// Misty can cross them; Huygens waits on the pebbles by a lake.
import { describe, it, expect } from 'vitest';
import { createSystem } from '../src/physics/bodies.js';
import { MISTY_LAKES, dirOf } from '../src/physics/terrain.js';
import { DISCOVERIES } from '../src/physics/discoveries.js';
import { Flight } from '../src/physics/sim.js';
import { predict } from '../src/physics/predict.js';
import { inStableOrbit } from '../src/physics/autopilot.js';
import { Buggy, WATER, METHANE, vec } from '../src/physics/buggy.js';
import { BUGGIES } from '../src/rocket/parts.js';
import { STICKERS, GOALS } from '../src/progress.js';
import { LOOKS } from '../src/world/liquid.js';
import { mission, parkAt, kidFlies, STATS } from './missions.js';

const sys = createSystem();
const misty = sys.byId.misty;
const R = misty.radius;
const SAMPLES = misty.surface.length - 1;
const angleOf = (i) => (i / SAMPLES) * Math.PI * 2;
const ang = (a, b) => Math.acos(Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
const KINDS = ['rover', 'truck', 'hopper'];
const HUYGENS = DISCOVERIES.find((d) => d.id === 'find-huygens');

// Every wet spot on a fixed grid (so every run is the same).
const WET = [];
for (let i = 0; i < 720; i++) {
  for (let j = 0; j < 360; j++) {
    const d = dirOf((i / 720) * Math.PI * 2, -1 + (2 * (j + 0.5)) / 360);
    if (misty.liquidDepth(d.x, d.y, d.z) > 0) WET.push(d);
  }
}
const closest = (spot) => Math.min(...WET.map((d) => ang(d, spot))) * R;

describe('Misty, Ringo\'s hazy moon (#46)', () => {
  it('goes round Ringo outside Frosty, with room between their spheres of influence', () => {
    const { ringo, frosty } = sys.byId;
    expect(misty.parent).toBe(ringo);
    expect(misty.orbitRadius - misty.soi - (frosty.orbitRadius + frosty.soi)).toBeGreaterThan(300);
    expect(misty.orbitRadius + misty.soi).toBeLessThan(ringo.soi * 0.8);
    expect(misty.haze).toBeTruthy();
  });

  it('has stickers (not goals), a journal fact and its own icons', () => {
    expect(STICKERS['visit-misty'].say).toBeTruthy();
    expect(STICKERS['land-misty']).toBeTruthy();
    expect(misty.blurb).toContain('methane');
    expect(GOALS.some((g) => g.id.endsWith('-misty'))).toBe(false);
    const icons = Object.values(STICKERS).map((s) => s.icon);
    for (const id of ['visit-misty', 'land-misty', 'find-huygens']) expect(icons.filter((x) => x === STICKERS[id].icon).length, id).toBe(1);
  });
});

describe('Misty\'s methane lakes (#46)', () => {
  it('is methane, in lakes: only the carved basins are under the level', () => {
    expect(misty.liquid).toEqual({ kind: 'methane', level: MISTY_LAKES.level });
    expect(LOOKS.methane).toBeTruthy();
    expect(MISTY_LAKES.radius).toBe(R);
    expect(WET.length / (720 * 360)).toBeGreaterThan(0.02);
    expect(WET.length / (720 * 360)).toBeLessThan(0.06);
    for (const d of WET) expect(misty.shoreDist(d.x, d.y, d.z)).toBeLessThan(0.5);
    for (const p of MISTY_LAKES.pools) {
      expect(misty.liquidDepth(p.a.x, p.a.y, p.a.z)).toBeGreaterThan(2);
      expect(misty.liquidDepth(p.a.x, p.a.y, p.a.z)).toBeLessThan(4);
    }
  });

  it('most lakes are near the poles, like Titan\'s', () => {
    const polar = WET.filter((d) => Math.abs(d.z) > 0.6).length;
    expect(polar / WET.length).toBeGreaterThan(0.75);
  });

  it('crosses the flight plane in two places, with plenty of dry ground for landing', () => {
    let wet = 0, runs = 0, was = misty.wetSample(SAMPLES - 1);
    for (let i = 0; i < SAMPLES; i++) {
      const w = misty.wetSample(i);
      if (w) wet++;
      if (w && !was) runs++;
      was = w;
      expect(misty.surface[i]).toBe(Math.max(misty.ground[i], misty.liquidTop[i]));
    }
    expect(runs).toBe(2);
    expect(wet / SAMPLES).toBeLessThan(0.08);
    for (let i = 0; i < SAMPLES; i += 4) {
      const n = misty.nearestLandable(angleOf(i));
      expect(misty.landableAt(n)).toBe(true);
      expect(Math.abs(n - angleOf(i)) * R).toBeLessThan(20);
    }
  });

  it('Huygens rests on dry pebbly ground near a lake shore, clear of the rocket\'s strip', () => {
    const s = HUYGENS.spots[0];
    expect(HUYGENS.world).toBe('misty');
    expect(closest(s)).toBeGreaterThan(8);
    expect(closest(s)).toBeLessThan(20);
    expect(misty.liquidDepth(s.x, s.y, s.z)).toBeLessThan(-2);
    const zw = s.z * R;
    expect(zw < -5 || zw > 30).toBe(true);
  });
});

describe('rockets and methane (#46)', () => {
  const wetAngle = (() => {
    for (let i = 0; i < SAMPLES; i++) if (misty.liquidTop[i] > misty.ground[i] + 1.5) return angleOf(i);
    return null;
  })();

  it('a gentle, upright touchdown on a lake is a crash, on its surface', () => {
    expect(wetAngle).not.toBe(null);
    const f = new Flight(sys, STATS);
    const r = misty.surfaceAt(wetAngle) + 0.5;
    f.state = {
      body: misty, x: r * Math.cos(wetAngle), y: r * Math.sin(wetAngle), vx: -Math.cos(wetAngle), vy: -Math.sin(wetAngle),
      angle: wetAngle, t: 0, landed: false, landAngle: 0, crashed: false, flightTime: 10,
    };
    const events = [];
    f.on((type, d) => events.push({ type, ...d }));
    for (let i = 0; i < 120 && !f.state.crashed && !f.state.landed; i++) f.step(1 / 60, 1);
    expect(f.state.crashed).toBe(true);
    expect(events.find((e) => e.type === 'crash').reason).toBe('methane');
    expect(Math.hypot(f.state.x, f.state.y)).toBeCloseTo(misty.liquidR, 1);
  });

  it('the predicted path ends (💥) on the lake', () => {
    const r = misty.liquidR + 30;
    const seg = predict({ body: misty, x: r * Math.cos(wetAngle), y: r * Math.sin(wetAngle), vx: 0, vy: 0, t: 0 }).segments[0];
    expect(seg.end).toBe('impact');
    expect(Math.hypot(seg.endState.x, seg.endState.y)).toBeCloseTo(misty.liquidR, 1);
  });
});

describe('helpers land on dry ground on Misty (#46)', () => {
  const PHASES = 48;
  const where = (m) => {
    const s = m.flight.state;
    if (s.crashed) return `crash ${m.log.filter((l) => l.startsWith('crash')).pop()}`;
    if (!s.landed) return 'flying';
    return s.body.id === 'misty' && misty.wetAt(s.landAngle) ? 'lake' : `dry ${s.body.id}`;
  };

  it('🛬 Land never ends in a lake, from all round the orbit', () => {
    const out = {};
    for (let i = 0; i < PHASES; i++) {
      const m = parkAt(mission(), 'misty', 1000 + i * 37, (i / PHASES) * Math.PI * 2);
      m.run('land');
      const w = where(m);
      out[w] = (out[w] ?? 0) + 1;
    }
    expect(out).toEqual({ 'dry misty': PHASES });
  }, 60000);

  it('a coached landing never ends in a lake, with a quick kid or a lazy one', () => {
    const out = {};
    let moved = 0;
    for (let i = 0; i < PHASES; i++) {
      const m = parkAt(mission(), 'misty', 2000 + i * 53, (i / PHASES) * Math.PI * 2 + 0.05);
      const { said } = kidFlies(m, 'land', null, { lazy: i % 3 === 0 });
      const w = where(m);
      out[w] = (out[w] ?? 0) + 1;
      if (said.some((l) => l.includes('a lake'))) moved++;
    }
    expect(out).toEqual({ 'dry misty': PHASES });
    expect(moved).toBeGreaterThan(0);
  }, 60000);

  it('a landing that would have come down in a lake is flown over to dry ground', () => {
    let best = null;
    for (let i = 0; i < SAMPLES; i++) {
      const gap = Math.abs(misty.nearestLandable(angleOf(i)) - angleOf(i));
      if (!best || gap > best.gap) best = { a: angleOf(i), gap };
    }
    for (const coach of [false, true]) {
      const m = mission();
      const r = misty.liquidR + 50;
      m.flight.state = {
        body: misty, x: r * Math.cos(best.a), y: r * Math.sin(best.a), vx: 0, vy: 0,
        angle: best.a, t: 0, landed: false, landAngle: 0, crashed: false, flightTime: 0,
      };
      const said = [];
      m.ap.on((e) => e.text && said.push(e.text));
      if (coach) kidFlies(m, 'land', null);
      else m.run('land');
      expect(where(m)).toBe('dry misty');
      if (coach) expect(said).toContain('Oops, a lake! I\'ll fly us over to dry land.');
    }
  }, 60000);

  it('🤖 Take me there from the pad to Misty, then 🛬, lands on dry ground', () => {
    for (let i = 0; i < 3; i++) {
      const m = mission();
      m.flight.resetToPad(700 + i * 1733);
      expect(m.run('goto', 'misty', 60 * 60 * 30)).toBe(true);
      expect(m.flight.state.body.id).toBe('misty');
      expect(inStableOrbit(m.flight)).toBe(true);
      expect(m.run('land')).toBe(true);
      expect(where(m)).toBe('dry misty');
    }
  }, 120000);

  it('🧭 Show me how to Misty: a pretend kid flies there from the pad and lands on dry ground', () => {
    for (let i = 0; i < 2; i++) {
      const m = mission();
      m.flight.resetToPad(900 + i * 2417);
      const trip = kidFlies(m, 'goto', 'misty');
      expect(trip.done).toBe(true);
      expect(m.flight.state.body.id).toBe('misty');
      expect(m.flight.state.crashed).toBe(false);
      if (!m.flight.state.landed) kidFlies(m, 'land', null);
      expect(where(m)).toBe('dry misty');
    }
  }, 120000);
});

describe('the buggy in Misty\'s lakes (#46)', () => {
  // Drive straight across lake p through its middle, from `out` metres beyond its shore.
  function crossing(kind, p, heading, seconds = 90) {
    const c = [p.a.x, p.a.y, p.a.z];
    const e1 = vec.norm(vec.cross(c, [0.3, 0.2, 1]));
    const e2 = vec.cross(c, e1);
    const fwd = vec.add(vec.mul(e1, Math.cos(heading)), vec.mul(e2, Math.sin(heading)));
    const back = (p.r * 1.3 + 12) / R;
    const start = vec.norm(vec.add(vec.mul(c, Math.cos(back)), vec.mul(fwd, -Math.sin(back))));
    const b = new Buggy(misty, BUGGIES[kind]);
    b.spawn(start, vec.norm(vec.sub(c, start)));
    const run = { b, deepest: -Infinity, wentIn: false, cameOut: false, stuck: 0 };
    for (let t = 0; t < seconds && !run.cameOut; t += 1 / 60) {
      b.step(1 / 60, { throttle: 1, steer: 0 });
      run.deepest = Math.max(run.deepest, b.depth);
      if (b.inWater) run.wentIn = true;
      if (b.grounded && b.speed < 0.5) run.stuck += 1 / 60;
      if (run.wentIn && !b.inWater && b.depth < -1) run.cameOut = true;
    }
    return run;
  }

  it('drives through like water, a little less floaty', () => {
    expect(METHANE.lift).toBeLessThan(WATER.lift);
    const b = new Buggy(misty, BUGGIES.rover);
    expect(b.sea).toBe(METHANE);
    expect(b.lava).toBe(false);
  });

  for (const kind of KINDS) {
    it(`the ${kind} drives into every lake, along its bed and out the other side`, () => {
      MISTY_LAKES.pools.forEach((p, pi) => {
        for (let k = 0; k < 4; k++) {
          const r = crossing(kind, p, (k / 4) * Math.PI * 2 + 0.4);
          const at = `lake ${pi}, way ${k}`;
          expect(r.wentIn, at).toBe(true);
          expect(r.deepest, at).toBeGreaterThan(0.8);
          expect(r.cameOut, at).toBe(true);
          expect(r.stuck, at).toBeLessThan(1);
        }
      });
    }, 60000);
  }

  it('is never stuck in a lake: from random spots, it always drives out', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 45; n++) {
      const d = WET[Math.floor(rand() * WET.length)];
      const u = [d.x, d.y, d.z];
      const b = new Buggy(misty, BUGGIES[KINDS[n % 3]]);
      b.spawn(u, vec.cross(u, vec.norm([rand() - 0.5, rand() - 0.5, rand() - 0.5])));
      let out = false;
      for (let t = 0; t < 90 && !out; t += 1 / 60) {
        b.step(1 / 60, { throttle: 1, steer: 0 });
        out = !b.inWater && b.depth < -1;
      }
      expect(out).toBe(true);
    }
  });

  it('round the world on Misty can cross a lake (#29)', () => {
    // A great circle through the big northern sea's middle and on over the poles.
    for (const kind of KINDS) {
      const p = MISTY_LAKES.pools[4];
      const c = [p.a.x, p.a.y, p.a.z];
      const fwd = vec.norm(vec.cross(c, [0.3, 0.2, 1]));
      const back = 40 / R;
      const start = vec.norm(vec.add(vec.mul(c, Math.cos(back)), vec.mul(fwd, -Math.sin(back))));
      const b = new Buggy(misty, BUGGIES[kind]);
      b.spawn(start, fwd);
      let wentIn = false;
      for (let t = 0; t < 600 && !b.wentRound; t += 1 / 30) {
        b.step(1 / 30, { throttle: 1, steer: 0 });
        if (b.depth > 1) wentIn = true;
      }
      expect(wentIn, kind).toBe(true);
      expect(b.wentRound, kind).toBe(true);
    }
  }, 60000);
});
