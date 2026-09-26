import { describe, it, expect } from 'vitest';
import { propagate, elements, anomalyOf, pointAt } from '../src/physics/orbit.js';
import { createSystem } from '../src/physics/bodies.js';
import { Flight, leapfrog } from '../src/physics/sim.js';
import { predict, segmentPoints, nearRadial, radialApex } from '../src/physics/predict.js';
import { inStableOrbit, nextHop, stretchedWindow, CATCH_RANGE } from '../src/physics/autopilot.js';
import { SYSTEM_EXTENT } from '../src/ui/zoom.js';
import { mission, kidFlies, parkAt } from './missions.js';

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

describe('launching straight up from Nibble (#30)', () => {
  const stats = { accel: 17, turnRate: 1.6, safeSpeed: 8, maxTilt: 0.6 };

  it('propagates a short hop on a near-radial escape path', () => {
    // Blasting up off tiny Nibble: already faster than escape speed, almost no sideways speed.
    // The hyperbolic starting guess came out negative here and the solver ran off to ~1e33.
    const mu = 810;
    const s = { x: 53.646990604999935, y: 0, vx: 8.09986217405996, vy: -0.0014434105630828289 };
    for (const dt of [1 / 120, 0.25, 1.9218821012702823, 30]) {
      const a = propagate(mu, s.x, s.y, s.vx, s.vy, dt);
      const b = rk4(mu, s, dt, 20000);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.01);
      expect(Math.hypot(a.vx - b.vx, a.vy - b.vy)).toBeLessThan(0.001);
    }
  });

  it('flies up and away without being flung out of the solar system', () => {
    const sys = createSystem();
    const f = new Flight(sys, stats);
    const nibble = sys.byId.nibble;
    const up = Math.PI / 2;
    f.state = { body: nibble, x: 0, y: 0, vx: 0, vy: 0, angle: up, t: 0, landed: true, landAngle: up, crashed: false, flightTime: 0 };
    f.placeOnSurface();
    f.throttle = 1;
    const w = {};
    for (let i = 0; i < 400; i++) {
      if (i === 60) f.throttle = 0;
      f.step(1 / 60, 1);
      f.worldPos(w);
      expect(Math.hypot(w.x, w.y)).toBeLessThan(40000);
    }
    expect(f.state.crashed).toBe(false);
  });

  it('has a hand-integrated fallback that agrees with Kepler', () => {
    // Used if propagate() ever fails its energy check, so the rocket keeps flying.
    const mu = 810;
    for (const st of [{ x: 53.646990604999935, y: 0, vx: 8.09986217405996, vy: -0.0014434105630828289 },
      { x: 60, y: 10, vx: -1, vy: 3.5 }]) {
      for (const dt of [1 / 120, 0.25]) {
        const a = leapfrog(mu, st, dt);
        const b = propagate(mu, st.x, st.y, st.vx, st.vy, dt);
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-4);
        expect(Math.hypot(a.vx - b.vx, a.vy - b.vy)).toBeLessThan(1e-4);
      }
    }
  });

  it('keeps the last good state if a step would break', () => {
    const sys = createSystem();
    const f = new Flight(sys, stats);
    f.throttle = 1;
    for (let i = 0; i < 60; i++) f.step(1 / 60, 1);
    const before = { ...f.state };
    f.substep = function () { this.state.x = NaN; return true; };
    f.step(1 / 60, 1);
    expect(f.state).toEqual(before);
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

describe('drawing the predicted path (#19)', () => {
  // Launch from the ground at angle `ang`, `tilt` radians off vertical.
  const launch = (tilt, speed = 40, ang = 0.7) => {
    const sys = createSystem();
    const home = sys.home;
    const r = home.surfaceAt(ang) + 1;
    const d = ang - tilt;
    return { home, state: { body: home, x: r * Math.cos(ang), y: r * Math.sin(ang), vx: speed * Math.cos(d), vy: speed * Math.sin(d), t: 0 } };
  };
  const radii = (pts) => {
    const out = [];
    for (let k = 0; k < pts.length; k += 2) out.push(Math.hypot(pts[k], pts[k + 1]));
    return out;
  };
  // Every drawn point should lie on the real path: match a brute-force integration in time.
  const onPath = (s, seg, pts) => {
    let worst = 0;
    for (let k = 0; k < pts.length; k += 2) {
      let best = Infinity;
      for (let i = 0; i <= 400; i++) {
        const q = propagate(s.body.mu, s.x, s.y, s.vx, s.vy, ((seg.t1 - seg.t0) * i) / 400);
        best = Math.min(best, Math.hypot(q.x - pts[k], q.y - pts[k + 1]));
      }
      worst = Math.max(worst, best);
    }
    return worst;
  };

  it('draws a straight-up launch as an up-and-down line with its apex', () => {
    const { home, state } = launch(0);
    const seg = predict(state).segments[0];
    expect(seg.end).toBe('impact');
    expect(nearRadial(seg)).toBe(true);
    const pts = segmentPoints(seg, 200);
    const r = radii(pts);
    // Not collapsed onto the centre: every point is at or above the ground.
    expect(Math.min(...r)).toBeGreaterThan(home.radius * 0.9);
    const apex = radialApex(seg);
    const rTop = Math.hypot(apex.x, apex.y);
    // Energy says how high it climbs: v^2/2 - mu/r0 = -mu/rTop.
    const r0 = Math.hypot(state.x, state.y);
    const expected = home.mu / (home.mu / r0 - (state.vx ** 2 + state.vy ** 2) / 2);
    expect(rTop).toBeCloseTo(expected, 1);
    expect(Math.max(...r)).toBeGreaterThan(rTop - 1);
    expect(rTop - r0).toBeGreaterThan(50);
    // Points are spread along the path, not bunched: consecutive radii step smoothly.
    expect(new Set(r.map((v) => Math.round(v))).size).toBeGreaterThan(50);
    // Straight up, straight down: every point stays on the launch line.
    for (let k = 0; k < pts.length; k += 2) {
      expect(Math.abs(Math.atan2(pts[k + 1], pts[k]) - 0.7)).toBeLessThan(1e-3);
    }
    expect(apex.t).toBeGreaterThan(0);
    expect(apex.t).toBeLessThan(seg.t1 - seg.t0);
  });

  it('draws a slightly tilted launch along the real curve', () => {
    for (const tilt of [0.01, 0.05, 0.2]) {
      const { state } = launch(tilt);
      const seg = predict(state).segments[0];
      const pts = segmentPoints(seg, 200);
      expect(onPath(state, seg, pts)).toBeLessThan(2);
      expect(Math.max(...radii(pts)) - Math.hypot(state.x, state.y)).toBeGreaterThan(40);
    }
  });

  it('draws the same curve on either side of the near-radial threshold', () => {
    // Sweep the tilt through the switch between time and angle sampling: the apex stays put.
    let prevTop = null;
    for (let tilt = 0; tilt <= 0.6; tilt += 0.01) {
      const { state } = launch(tilt, 50);
      const seg = predict(state).segments[0];
      const pts = segmentPoints(seg, 200);
      expect(onPath(state, seg, pts)).toBeLessThan(3);
      const top = Math.max(...radii(pts));
      if (prevTop !== null) expect(Math.abs(top - prevTop)).toBeLessThan(3);
      prevTop = top;
      // The ▲ marker (found in time or from the conic, as flight.js does) sits at the top.
      const ap = nearRadial(seg) ? radialApex(seg) : pointAt(seg.el, Math.PI);
      expect(Math.hypot(ap.x, ap.y)).toBeCloseTo(seg.el.ra, 0);
    }
  });

  it('still draws normal orbits by angle', () => {
    const sys = createSystem();
    const home = sys.home;
    const r = 400, v = Math.sqrt(home.mu / r) * 1.1;
    const seg = predict({ body: home, x: r, y: 0, vx: 0, vy: v, t: 0 }).segments[0];
    expect(seg.closed).toBe(true);
    expect(nearRadial(seg)).toBe(false);
    const pts = segmentPoints(seg, 100);
    // Evenly spaced in true anomaly, as before.
    const nu0 = anomalyOf(seg.el, r, 0);
    for (const i of [0, 25, 50, 75]) {
      const q = pointAt(seg.el, nu0 + (Math.PI * 2 * i) / 100);
      expect(pts[i * 2]).toBeCloseTo(q.x, 6);
      expect(pts[i * 2 + 1]).toBeCloseTo(q.y, 6);
    }
  });
});

describe('Flip, the backwards moon (#11)', () => {
  const sys = createSystem();
  const { flip, tumble, frosty } = sys.byId;

  it('goes around Tumble the other way from everything else', () => {
    expect(flip.orbitDir).toBe(1);
    expect(flip.angularSpeed).toBeGreaterThan(0);
    for (const b of sys.bodies) if (b.parent && b !== flip) expect(b.angularSpeed).toBeLessThan(0);
    // Same speed a normal moon would have there, just the other way.
    expect(flip.angularSpeed).toBeCloseTo(Math.sqrt(tumble.mu / flip.orbitRadius ** 3), 12);
  });

  it('its velocity matches how its position changes', () => {
    for (const b of [flip, frosty]) {
      for (const t of [0, 123.4, 5000]) {
        const a = b.relPos(t - 0.01), c = b.relPos(t + 0.01), v = b.relVel(t);
        expect((c.x - a.x) / 0.02).toBeCloseTo(v.x, 3);
        expect((c.y - a.y) / 0.02).toBeCloseTo(v.y, 3);
        // Counter-clockwise has positive angular momentum.
        const p = b.relPos(t);
        expect(Math.sign(p.x * v.y - p.y * v.x)).toBe(b.orbitDir);
      }
    }
  });

  it('keeps the rocket\'s real velocity across the hand-off into its SOI', () => {
    const f = new Flight(sys, { accel: 17, turnRate: 1.6, safeSpeed: 8, maxTilt: 0.6 });
    const t = 777;
    const p = flip.relPos(t), v = flip.relVel(t);
    const d = flip.soi + 0.5;
    // Just outside Flip's SOI, keeping up with it and drifting in.
    f.state = { body: tumble, x: p.x + d, y: p.y, vx: v.x - 3, vy: v.y, angle: 0, t, landed: false, landAngle: 0, crashed: false, flightTime: 0 };
    const vBefore = { x: f.state.vx + tumble.worldVel(t).x, y: f.state.vy + tumble.worldVel(t).y };
    while (f.state.body === tumble && f.state.t < t + 5) f.step(1 / 60, 1);
    expect(f.state.body).toBe(flip);
    const w = flip.worldVel(f.state.t);
    // Gravity only nudges it a little in that moment; a wrong-way hand-off would be ~80 m/s off.
    expect(Math.hypot(f.state.vx + w.x - vBefore.x, f.state.vy + w.y - vBefore.y)).toBeLessThan(1);
    // And it's handed over right at the edge of Flip's SOI.
    expect(Math.hypot(f.state.x, f.state.y)).toBeCloseTo(flip.soi, -1);
  });

  it('the predictor meets it where it really is', () => {
    const s = { body: tumble, t: 50 };
    // Drop from a round orbit just outside Flip's path, going Flip's way.
    const r = flip.orbitRadius + flip.soi * 3;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const v = Math.sqrt(tumble.mu / r) * 0.93;
      Object.assign(s, { x: r * Math.cos(a), y: r * Math.sin(a), vx: -v * Math.sin(a), vy: v * Math.cos(a) });
      const seg = predict(s, { maxSegments: 2 }).segments.find((g) => g.body === flip);
      if (!seg) continue;
      // The hand-off point is on the edge of Flip's SOI.
      expect(Math.hypot(seg.start.x, seg.start.y)).toBeCloseTo(flip.soi, -1);
      return;
    }
    throw new Error('never met Flip');
  });

  it('routes to it through Tumble', () => {
    expect(nextHop(sys.byId.homestead, flip)).toMatchObject({ body: tumble, kind: 'sibling' });
    expect(nextHop(tumble, flip)).toMatchObject({ body: flip, kind: 'down' });
    expect(nextHop(flip, sys.byId.sizzle)).toMatchObject({ body: tumble, kind: 'up' });
  });
});

describe('Ducky, the comet on a stretched orbit (#13)', () => {
  const sys = createSystem();
  const { ducky, ember, homestead } = sys.byId;
  const stats = { accel: 17, turnRate: 1.6, safeSpeed: 8, maxTilt: 0.6 };

  it('swoops in close to Ember and out beyond Ringo, and stays inside the system', () => {
    let lo = Infinity, hi = 0;
    for (let t = 0; t < ducky.orbitalPeriod; t += 2) {
      const r = ducky.distAt(t);
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
    expect(lo).toBeCloseTo(ducky.periapsis, -1);
    expect(hi).toBeCloseTo(ducky.apoapsis, -1);
    // Well clear of Ember (and its "too close" zone), inside Homestead's orbit...
    expect(ducky.periapsis - ducky.soi).toBeGreaterThan(ember.radius * 3);
    expect(ducky.periapsis).toBeLessThan(homestead.orbitRadius);
    // ...and out past Ringo, but not off the edge of the map.
    expect(ducky.apoapsis).toBeGreaterThan(sys.byId.ringo.orbitRadius);
    expect(ducky.apoapsis + ducky.soi).toBeLessThanOrEqual(SYSTEM_EXTENT);
    // Comes round again within a play session (with time warp).
    expect(ducky.orbitalPeriod / 60).toBeGreaterThan(20);
    expect(ducky.orbitalPeriod / 60).toBeLessThan(60);
  });

  it('follows real Kepler motion (the quick solve agrees with full propagation)', () => {
    for (const t0 of [0, 400, 1234.5, 9000]) {
      const p = ducky.relPos(t0), v = ducky.relVel(t0);
      for (const dt of [1, 60, 700, 2000]) {
        const q = propagate(ember.mu, p.x, p.y, v.x, v.y, dt);
        const k = ducky.relPos(t0 + dt), w = ducky.relVel(t0 + dt);
        expect(Math.hypot(q.x - k.x, q.y - k.y)).toBeLessThan(0.01);
        expect(Math.hypot(q.vx - w.x, q.vy - w.y)).toBeLessThan(1e-4);
      }
      // Clockwise, like the planets, and much faster close in than far out.
      expect(Math.sign(p.x * v.y - p.y * v.x)).toBe(ducky.orbitDir);
    }
    const speed = (r) => Math.sqrt(ember.mu * (2 / r - 1 / ducky.orbitRadius));
    expect(speed(ducky.periapsis) / speed(ducky.apoapsis)).toBeGreaterThan(5);
  });

  it('the predictor doesn\'t step over its tiny SOI', () => {
    // Heading at it from 3 km away, fast, aiming 100 m to one side.
    for (const t of [100, 900, 1700]) {
      const p = ducky.relPos(t), v = ducky.relVel(t);
      const s = { body: ember, t, x: p.x + 3000, y: p.y + 100, vx: v.x - 60, vy: v.y };
      const seg = predict(s, { maxSegments: 1 }).segments[0];
      expect(seg.end).toBe('encounter');
      expect(seg.next).toBe(ducky);
    }
  });

  it('finds transfer windows to and from it', () => {
    for (const t of [0, 1500, 4000]) {
      const to = stretchedWindow(homestead, ducky, t, 3 * ducky.orbitalPeriod);
      const from = stretchedWindow(ducky, sys.byId.dusty, t, 3 * ducky.orbitalPeriod);
      for (const w of [to, from]) {
        expect(w.tb).toBeGreaterThan(t);
        expect(w.vInf).toBeGreaterThan(0);
        expect(w.vInf).toBeLessThan(100);
      }
    }
  });

  it('autopilot: takes the rocket from the pad to Ducky, lands, then flies home', () => {
    const m = mission(stats);
    const said = [];
    m.ap.on((e) => e.text && said.push(e.text));
    expect(m.run('goto', 'ducky', 60 * 60 * 30)).toBe(true);
    expect(m.flight.state.body.id).toBe('ducky');
    expect(inStableOrbit(m.flight)).toBe(true);
    // The trip only has to pass near it; then Pip homes in.
    expect(said).toContain('Comets are tricky to catch! I\'ll steer us in.');
    expect(m.run('land')).toBe(true);
    expect(m.log).toContain('landed:ducky');
    expect(m.run('goto', 'homestead', 60 * 60 * 30)).toBe(true);
    expect(m.flight.state.body.id).toBe('homestead');
  }, 60000);

  it('coach: talks a player out to Ducky from a Homestead orbit, and down onto it', () => {
    for (const t of [2000, 5500]) {
      const m = parkAt(mission(stats), 'homestead', t);
      const { flight, done } = kidFlies(m, 'goto', 'ducky');
      expect(flight.state.crashed).toBe(false);
      expect(done).toBe(true);
      expect(flight.state.body.id).toBe('ducky');
      expect(flight.state.landed).toBe(true);
    }
  }, 60000);

  it('homes in from a near miss in Ember\'s space', () => {
    const m = mission(stats);
    const t = 700;
    const { ducky, ember } = m.sys.byId;
    const p = ducky.relPos(t), v = ducky.relVel(t);
    // Drifting past a few km away, 40 m/s off its speed.
    m.flight.state = {
      body: ember, x: p.x + CATCH_RANGE * 0.6, y: p.y - 2000, vx: v.x + 25, vy: v.y - 30,
      angle: 0, t, landed: false, landAngle: 0, crashed: false, flightTime: 0,
    };
    expect(m.run('goto', 'ducky', 60 * 60 * 20)).toBe(true);
    expect(m.flight.state.body.id).toBe('ducky');
    expect(inStableOrbit(m.flight)).toBe(true);
  }, 60000);
});

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

  for (const target of ['pebble', 'dusty', 'frosty', 'nibble', 'flip']) {
    it(`takes the rocket from the pad to ${target} and lands`, () => {
      const m = mission(stats);
      expect(m.run('goto', target, 60 * 60 * 30)).toBe(true);
      expect(m.flight.state.body.id).toBe(target);
      expect(inStableOrbit(m.flight)).toBe(true);
      expect(m.run('land')).toBe(true);
      expect(m.log).toContain(`landed:${target}`);
    }, 60000);
  }

  it('flies to Tumble, the farthest world, and goes round it Flip\'s way', () => {
    const m = mission(stats);
    expect(m.run('goto', 'tumble', 60 * 60 * 30)).toBe(true);
    expect(m.flight.state.body.id).toBe('tumble');
    expect(inStableOrbit(m.flight)).toBe(true);
    // Arriving the backwards way round makes the hop down to Flip easy.
    expect(m.flight.elements().dir).toBe(m.sys.byId.flip.orbitDir);
  }, 60000);

  it('turns round before dropping down to Flip if we\'re going the wrong way', () => {
    const m = parkAt(mission(stats), 'tumble', 3000);
    const s = m.flight.state;
    // Mirror the parking orbit so we go clockwise, like every other moon.
    s.vx = -s.vx; s.vy = -s.vy; s.angle += Math.PI;
    expect(m.flight.elements().dir).toBe(-1);
    const said = [];
    m.ap.on((e) => e.text && said.push(e.text));
    expect(m.run('goto', 'flip', 60 * 60 * 30)).toBe(true);
    expect(said).toContain('We\'re going around the wrong way! Flip goes the other way. I\'ll turn us around.');
    expect(m.flight.state.body.id).toBe('flip');
    expect(inStableOrbit(m.flight)).toBe(true);
    expect(m.run('land')).toBe(true);
    expect(m.log).toContain('landed:flip');
  }, 60000);

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

  it('talks a player from the pad all the way to Pebble, then down onto it', () => {
    const { flight, done, said } = kidFlies(mission(stats), 'goto', 'pebble');
    expect(flight.state.crashed).toBe(false);
    expect(done).toBe(true);
    expect(flight.state.body.id).toBe('pebble');
    expect(flight.state.landed).toBe(true);
    expect(said.some((t) => t.includes('Now let\'s land together.'))).toBe(true);
  }, 60000);

  it('talks a player all the way to Flip, the backwards moon, and down onto it', () => {
    const { flight, done, said } = kidFlies(mission(stats), 'goto', 'flip');
    expect(flight.state.crashed).toBe(false);
    expect(done).toBe(true);
    expect(flight.state.body.id).toBe('flip');
    expect(flight.state.landed).toBe(true);
    expect(said).toContain('Let go! We\'re on our way to Tumble!');
    expect(said).toContain('You landed all by yourself! Great flying!');
  }, 60000);

  it('talks a player to Tumble, the farthest world', () => {
    const { flight, done } = kidFlies(mission(stats), 'goto', 'tumble');
    expect(flight.state.crashed).toBe(false);
    expect(done).toBe(true);
    expect(flight.state.body.id).toBe('tumble');
    expect(inStableOrbit(flight)).toBe(true);
  }, 60000);

  it('talks a player to Dusty and lands', () => {
    const { flight, done } = kidFlies(mission(stats), 'goto', 'dusty');
    expect(flight.state.crashed).toBe(false);
    expect(done).toBe(true);
    expect(flight.state.body.id).toBe('dusty');
    expect(flight.state.landed).toBe(true);
  }, 60000);

  // The 🌀 Orbit helper with the coach switched on: launch to orbit, flown by the kid.
  const orbitCases = [
    ['homestead', stats, {}],
    ['homestead', stats, { lag: 20 }],
    ['homestead', noLegs, { lag: 15 }],
    ['pebble', stats, {}],
    ['pebble', stats, { lag: 20 }],
  ];
  for (const [world, st, opts] of orbitCases) {
    it(`coaches a launch from ${world} into orbit (${opts.lag ?? 8}-frame lag)`, () => {
      const m = mission(st);
      if (world !== 'homestead') {
        m.run('goto', world, 60 * 60 * 30);
        expect(m.run('land')).toBe(true);
        expect(m.flight.state.landed).toBe(true);
      }
      const { flight, done, said, presses } = kidFlies(m, 'orbit', null, opts);
      expect(flight.state.crashed).toBe(false);
      expect(done).toBe(true);
      expect(flight.state.body.id).toBe(world);
      expect(inStableOrbit(flight)).toBe(true);
      expect(said).toContain('First we fly up high. Point up and hold GO!');
      expect(said.some((t) => t.startsWith('Let go! We\'re going around'))).toBe(true);
      expect(presses).toBeGreaterThan(0);
      // Still going round a while later: the late LET GO didn't leave us on a bad path.
      for (let i = 0; i < 60 * 60; i++) flight.step(1 / 60, 10);
      expect(flight.state.crashed).toBe(false);
      expect(inStableOrbit(flight)).toBe(true);
    }, 60000);
  }

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

describe('fine thrust (#28)', () => {
  it('Shift fires the engine at a tenth of the power, including the coach\'s gentler GO', async () => {
    const { goThrottle, FINE_THRUST } = await import('../src/scenes/flight.js');
    expect(FINE_THRUST).toBe(0.1);
    expect(goThrottle(1, false)).toBe(1);
    expect(goThrottle(1, true)).toBeCloseTo(0.1);
    expect(goThrottle(0.5, true)).toBeCloseTo(0.05);
  });
});
