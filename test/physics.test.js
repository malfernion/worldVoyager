import { describe, it, expect } from 'vitest';
import { propagate, elements } from '../src/physics/orbit.js';
import { createSystem } from '../src/physics/bodies.js';
import { Flight } from '../src/physics/sim.js';
import { predict } from '../src/physics/predict.js';
import { Autopilot, inStableOrbit, nextHop } from '../src/physics/autopilot.js';

// Brute-force reference integrator (RK4, tiny steps).
function rk4(mu, s, dt, steps) {
  const deriv = ([x, y, vx, vy]) => {
    const r3 = Math.hypot(x, y) ** 3;
    return [vx, vy, (-mu * x) / r3, (-mu * y) / r3];
  };
  const add = (a, b, k) => a.map((v, i) => v + b[i] * k);
  let st = [s.x, s.y, s.vx, s.vy];
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const k1 = deriv(st);
    const k2 = deriv(add(st, k1, h / 2));
    const k3 = deriv(add(st, k2, h / 2));
    const k4 = deriv(add(st, k3, h));
    st = st.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
  }
  return { x: st[0], y: st[1], vx: st[2], vy: st[3] };
}

describe('propagate', () => {
  const mu = 9e5;
  const cases = {
    circular: { x: 400, y: 0, vx: 0, vy: Math.sqrt(mu / 400) },
    elliptic: { x: 350, y: 20, vx: -5, vy: 60 },
    clockwise: { x: 0, y: 380, vx: 55, vy: 0 },
    hyperbolic: { x: 400, y: 0, vx: 10, vy: 80 },
    nearParabolic: { x: 400, y: 0, vx: 0, vy: Math.sqrt((2 * mu) / 400) },
  };
  for (const [name, s] of Object.entries(cases)) {
    it(`matches RK4 for a ${name} orbit`, () => {
      for (const dt of [0.5, 13, 90]) {
        const a = propagate(mu, s.x, s.y, s.vx, s.vy, dt);
        const b = rk4(mu, s, dt, 20000);
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.05);
        expect(Math.hypot(a.vx - b.vx, a.vy - b.vy)).toBeLessThan(0.01);
      }
    });
  }

  it('returns to start after one period', () => {
    const s = cases.elliptic;
    const el = elements(mu, s.x, s.y, s.vx, s.vy);
    const a = propagate(mu, s.x, s.y, s.vx, s.vy, el.period * 3);
    expect(Math.hypot(a.x - s.x, a.y - s.y)).toBeLessThan(1e-3);
  });

  it('computes apoapsis/periapsis and timing', () => {
    const s = cases.elliptic;
    const el = elements(mu, s.x, s.y, s.vx, s.vy);
    const atAp = propagate(mu, s.x, s.y, s.vx, s.vy, el.timeToAp);
    expect(Math.hypot(atAp.x, atAp.y)).toBeCloseTo(el.ra, 3);
    const atPe = propagate(mu, s.x, s.y, s.vx, s.vy, el.timeToPe);
    expect(Math.hypot(atPe.x, atPe.y)).toBeCloseTo(el.rp, 3);
  });
});

describe('Flight', () => {
  const stats = { accel: 18, turnRate: 1.5, safeSpeed: 8, maxTilt: 0.6 };

  it('sits on the pad until the engine is lit, then flies up and falls back', () => {
    const sys = createSystem();
    const f = new Flight(sys, stats);
    const events = [];
    f.on((type, d) => events.push({ type, ...d }));
    f.step(1, 1);
    expect(f.state.landed).toBe(true);
    f.throttle = 1;
    for (let i = 0; i < 120; i++) f.step(1 / 60, 1);
    expect(f.state.landed).toBe(false);
    expect(f.altitude).toBeGreaterThan(5);
    f.throttle = 0;
    for (let i = 0; i < 60 * 30 && !f.state.crashed && !f.state.landed; i++) f.step(1 / 60, 1);
    expect(events.map((e) => e.type)).toContain('crash');
  });

});

describe('predict', () => {
  it('finds an encounter with Pebble after a Hohmann-style burn', () => {
    const sys = createSystem();
    const home = sys.home;
    const pebble = sys.byId.pebble;
    const r1 = 400;
    const v1 = Math.sqrt(home.mu / r1);
    const r2 = pebble.orbitRadius;
    const dv = v1 * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
    const tH = Math.PI * Math.sqrt(((r1 + r2) / 2) ** 3 / home.mu);
    // Clockwise orbit: burn point is opposite where Pebble will be after tH.
    let found = false;
    for (let t = 0; t < pebble.orbitalPeriod && !found; t += 5) {
      const arrive = pebble.angleAt(t + tH);
      const burnAng = arrive - Math.PI;
      const x = r1 * Math.cos(burnAng), y = r1 * Math.sin(burnAng);
      const tx = Math.sin(burnAng), ty = -Math.cos(burnAng); // clockwise tangent
      const s = { body: home, x, y, vx: tx * (v1 + dv), vy: ty * (v1 + dv), t };
      const pred = predict(s, { target: pebble });
      if (pred.segments.some((seg) => seg.body === pebble)) found = true;
    }
    expect(found).toBe(true);
  });

  it('detects escape from Homestead into Ember orbit', () => {
    const sys = createSystem();
    const s = { body: sys.home, x: 400, y: 0, vx: 0, vy: -80, t: 0 };
    const pred = predict(s);
    expect(pred.segments[0].end).toBe('exit');
    expect(pred.segments[1].body.id).toBe('ember');
  });
});

function mission(stats) {
  const sys = createSystem();
  const flight = new Flight(sys, stats);
  const ap = new Autopilot(flight);
  const log = [];
  flight.on((type, d) => log.push(`${type}:${d.body?.id ?? d.to?.id ?? ''}${d.reason ? ':' + d.reason : ''}`));
  const run = (mode, target, maxFrames = 60 * 60 * 10) => {
    ap.start(mode, target && sys.byId[target]);
    for (let i = 0; i < maxFrames && ap.active; i++) {
      ap.update(1 / 60);
      flight.step(1 / 60, ap.warp ?? 1);
      if (flight.state.crashed) break;
    }
    return !ap.active;
  };
  return { sys, flight, ap, log, run };
}

describe('helpers', () => {
  const stats = { accel: 17, turnRate: 1.6, safeSpeed: 8, maxTilt: 0.6 };

  it('routes between worlds', () => {
    const sys = createSystem();
    const b = sys.byId;
    expect(nextHop(b.homestead, b.pebble)).toMatchObject({ body: b.pebble, kind: 'down' });
    expect(nextHop(b.pebble, b.dusty)).toMatchObject({ body: b.homestead, kind: 'up' });
    expect(nextHop(b.homestead, b.frosty)).toMatchObject({ body: b.ringo, kind: 'sibling' });
    expect(nextHop(b.sizzle, b.frosty)).toMatchObject({ body: b.frosty, kind: 'sibling' });
    expect(nextHop(b.pebble, b.homestead)).toMatchObject({ body: b.homestead, kind: 'up' });
  });

  it('flies from the pad into orbit, then lands again', () => {
    const m = mission(stats);
    expect(m.run('orbit')).toBe(true);
    expect(inStableOrbit(m.flight)).toBe(true);
    expect(m.run('land')).toBe(true);
    expect(m.flight.state.landed).toBe(true);
    expect(m.log).toContain('landed:homestead');
  });

  for (const target of ['pebble', 'dusty', 'frosty', 'nibble']) {
    it(`takes the rocket from the pad to ${target} and lands`, () => {
      const m = mission(stats);
      expect(m.run('goto', target, 60 * 60 * 30)).toBe(true);
      expect(m.flight.state.body.id).toBe(target);
      expect(inStableOrbit(m.flight)).toBe(true);
      expect(m.run('land')).toBe(true);
      expect(m.log).toContain(`landed:${target}`);
    }, 60000);
  }

  it('comes home from Pebble', () => {
    const m = mission(stats);
    m.run('goto', 'pebble', 60 * 60 * 30);
    expect(m.run('goto', 'homestead', 60 * 60 * 30)).toBe(true);
    expect(m.flight.state.body.id).toBe('homestead');
    expect(m.run('land')).toBe(true);
    expect(m.flight.state.landed).toBe(true);
  }, 60000);
});

describe('coach mode', () => {
  const stats = { accel: 17, turnRate: 1.6, safeSpeed: 8, maxTilt: 0.6 };
  const noLegs = { accel: 17, turnRate: 1.6, safeSpeed: 6, maxTilt: 0.45 };
  const rescue = 'Whoa, too fast! I\'ll catch us this time.';

  // A pretend kid: turns toward the arrow with the turn buttons, holds GO when told,
  // and reacts a few frames late. `lazy` kids stop pressing GO once they're told to point up.
  function kidFlies(m, mode, target, { lag = 8, lazy = false, maxFrames = 60 * 60 * 40 } = {}) {
    const { flight, ap, sys } = m;
    const said = [];
    ap.on((e) => e.text && said.push(e.text));
    ap.start(mode, target && sys.byId[target], { coach: true });
    const queue = [];
    let presses = 0;
    let wasGo = false;
    for (let i = 0; i < maxFrames && ap.active && !flight.state.crashed; i++) {
      ap.update(1 / 60);
      // Touched down: the game ignores a still-held GO until it's let go.
      if (!ap.active) break;
      const { angle, throttle } = ap.cmd;
      let turn = 0;
      if (angle !== null && !flight.state.landed) {
        const d = Math.atan2(Math.sin(angle - flight.state.angle), Math.cos(angle - flight.state.angle));
        turn = Math.abs(d) < 0.05 ? 0 : Math.sign(d);
      }
      const giveUp = lazy && said.some((t) => t.includes('point up'));
      queue.push({ turn, go: throttle > 0.5 && !giveUp });
      const act = queue.length > lag ? queue.shift() : { turn: 0, go: false };
      if (!ap.driving) {
        flight.turn = act.turn;
        flight.throttle = act.go ? ap.goPower : 0;
        if (act.go && !wasGo) presses++;
        wasGo = act.go;
      } else {
        flight.turn = 0;
        queue.length = 0;
      }
      flight.step(1 / 60, flight.throttle > 0 ? 1 : ap.warp ?? 1);
    }
    return { flight, ap, said, presses, done: !ap.active };
  }

  it('talks a player from the pad all the way to Pebble, then down onto it', () => {
    const { flight, done, said } = kidFlies(mission(stats), 'goto', 'pebble');
    expect(flight.state.crashed).toBe(false);
    expect(done).toBe(true);
    expect(flight.state.body.id).toBe('pebble');
    expect(flight.state.landed).toBe(true);
    expect(said.some((t) => t.includes('Now let\'s land together.'))).toBe(true);
  }, 60000);

  it('talks a player to Dusty and lands', () => {
    const { flight, done } = kidFlies(mission(stats), 'goto', 'dusty');
    expect(flight.state.crashed).toBe(false);
    expect(done).toBe(true);
    expect(flight.state.body.id).toBe('dusty');
    expect(flight.state.landed).toBe(true);
  }, 60000);

  // Coached landings from orbit, flown only from the arrow and the HOLD / LET GO cues.
  const fromOrbit = (st, world) => {
    const m = mission(st);
    if (world === 'homestead') m.run('orbit');
    else m.run('goto', world, 60 * 60 * 30);
    expect(m.flight.state.body.id).toBe(world);
    expect(inStableOrbit(m.flight)).toBe(true);
    return m;
  };
  const cases = [
    ['homestead', stats, {}],
    ['homestead', noLegs, {}],
    ['homestead', noLegs, { lag: 20 }],
    ['pebble', stats, {}],
    ['pebble', noLegs, {}],
    ['pebble', noLegs, { lag: 30 }],
    ['dusty', noLegs, { lag: 15 }],
  ];
  for (const [world, st, opts] of cases) {
    const what = `${st === noLegs ? 'without legs' : 'with legs'}, ${opts.lag ?? 8}-frame lag`;
    it(`coaches a landing on ${world} from orbit (${what})`, () => {
      const { flight, done, said, presses } = kidFlies(fromOrbit(st, world), 'land', null, opts);
      expect(flight.state.crashed).toBe(false);
      expect(done).toBe(true);
      expect(flight.state.landed).toBe(true);
      expect(flight.state.body.id).toBe(world);
      expect(said).not.toContain(rescue);
      expect(said).toContain('You landed all by yourself! Great flying!');
      expect(presses).toBeGreaterThan(0);
      // Pulses a small child can follow, not a flicker.
      expect(presses).toBeLessThan(20);
    }, 60000);
  }

  it('Pip catches a player who stops braking', () => {
    const { flight, said } = kidFlies(fromOrbit(noLegs, 'homestead'), 'land', null, { lazy: true });
    expect(flight.state.crashed).toBe(false);
    expect(flight.state.landed).toBe(true);
    expect(said).toContain(rescue);
  }, 60000);
});
