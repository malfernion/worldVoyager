// Rocket flight simulation: patched-conic gravity, thrust, sphere-of-influence hand-offs,
// landing and (cartoon) crashing. Frame of reference is always the current SOI body.
import { propagate, elements } from './orbit.js';
import { LAUNCH_ANGLE } from './bodies.js';

const MAX_STEP_DIST = 15;
const THRUST_STEP = 1 / 120;
// Nothing real gets this far from the body it's orbiting (the whole system is ~130 km across).
const MAX_RADIUS = 1e7;

/** Coasting conserves orbital energy; a propagation that doesn't is a numerical blow-up (#30). */
function keplerOk(mu, a, b) {
  if (!(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.vx) && Number.isFinite(b.vy))) return false;
  const ra = Math.hypot(a.x, a.y), rb = Math.hypot(b.x, b.y);
  const va2 = a.vx * a.vx + a.vy * a.vy, vb2 = b.vx * b.vx + b.vy * b.vy;
  const drift = Math.abs(vb2 / 2 - mu / rb - (va2 / 2 - mu / ra));
  return drift <= 1e-3 * (va2 + vb2 + mu / ra + mu / rb);
}

/** Plain leapfrog under point gravity: slow but can't blow up; the fallback when Kepler fails. */
export function leapfrog(mu, a, h, out = {}) {
  const n = Math.min(4000, Math.max(8, Math.ceil(Math.abs(h) / 0.002)));
  const dt = h / n;
  let { x, y, vx, vy } = a;
  let r3 = Math.hypot(x, y) ** 3;
  vx -= (mu * x / r3) * dt / 2; vy -= (mu * y / r3) * dt / 2;
  for (let i = 0; i < n; i++) {
    x += vx * dt; y += vy * dt;
    r3 = Math.hypot(x, y) ** 3;
    const k = i === n - 1 ? dt / 2 : dt;
    vx -= (mu * x / r3) * k; vy -= (mu * y / r3) * k;
  }
  out.x = x; out.y = y; out.vx = vx; out.vy = vy;
  return out;
}

function stateOk(s) {
  return Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.vx) && Number.isFinite(s.vy)
    && Number.isFinite(s.t) && Math.hypot(s.x, s.y) < MAX_RADIUS;
}

export class Flight {
  constructor(system, stats) {
    this.system = system;
    this.stats = stats; // { accel, turnRate, safeSpeed, maxTilt }
    this.listeners = [];
    this.throttle = 0;
    this.turn = 0; // -1..1 manual turn input
    this.targetAngle = null; // autopilot steering target (world angle), or null
    this.dvUsed = 0; // total speed change from the engine, used by the helpers
    this.lastGood = {}; // state before the current substep, to fall back to (#30)
    this.resetToPad(0);
  }

  on(fn) {
    this.listeners.push(fn);
  }

  emit(type, data = {}) {
    for (const fn of this.listeners) fn(type, data);
  }

  resetToPad(t = this.state?.t ?? 0) {
    const home = this.system.home;
    this.state = {
      body: home, x: 0, y: 0, vx: 0, vy: 0,
      angle: LAUNCH_ANGLE, t,
      landed: true, landAngle: LAUNCH_ANGLE, crashed: false,
      flightTime: 0,
    };
    this.placeOnSurface();
    this.throttle = 0;
  }

  placeOnSurface() {
    const s = this.state;
    const r = s.body.surfaceAt(s.landAngle);
    s.x = r * Math.cos(s.landAngle);
    s.y = r * Math.sin(s.landAngle);
    s.vx = 0; s.vy = 0;
  }

  snapshot() {
    const s = this.state;
    return { ...s, bodyId: s.body.id };
  }

  restore(snap) {
    this.state = { ...snap, body: this.system.byId[snap.bodyId], crashed: false };
    this.throttle = 0;
    this.turn = 0;
  }

  get altitude() {
    const s = this.state;
    return Math.hypot(s.x, s.y) - s.body.surfaceAt(Math.atan2(s.y, s.x));
  }

  get radius() {
    return Math.hypot(this.state.x, this.state.y);
  }

  get speed() {
    return Math.hypot(this.state.vx, this.state.vy);
  }

  get localGravity() {
    const r = this.radius;
    return this.state.body.mu / (r * r);
  }

  /** Radial angle (straight "up") at the rocket's position. */
  get upAngle() {
    return Math.atan2(this.state.y, this.state.x);
  }

  elements() {
    const s = this.state;
    return elements(s.body.mu, s.x, s.y, s.vx, s.vy);
  }

  step(realDt, warp) {
    const s = this.state;
    if (s.crashed) return;

    // Steering happens in real time so warp never makes the rocket spin wildly.
    if (!s.landed) {
      const rate = this.stats.turnRate;
      if (this.turn !== 0) {
        s.angle += this.turn * rate * realDt;
      } else if (this.targetAngle !== null) {
        let d = Math.atan2(Math.sin(this.targetAngle - s.angle), Math.cos(this.targetAngle - s.angle));
        const maxTurn = rate * 1.6 * realDt;
        s.angle += Math.max(-maxTurn, Math.min(maxTurn, d));
      }
    }

    let remaining = realDt * warp;
    let guard = 0;
    while (remaining > 1e-9 && guard++ < 4000) {
      if (s.crashed) return;
      if (s.landed) {
        const liftoff = this.throttle * this.stats.accel > this.localGravity * 1.02;
        if (!liftoff) {
          s.t += remaining;
          return;
        }
        this.liftOff();
      }
      const speed = Math.hypot(s.vx, s.vy);
      let h = remaining;
      if (this.throttle > 0) h = Math.min(h, THRUST_STEP);
      if (speed > 0) h = Math.min(h, MAX_STEP_DIST / speed);
      h = Math.max(h, 1e-4);
      // Never commit a broken state: keep the last good one and skip the rest of this frame.
      Object.assign(this.lastGood, s);
      if (!this.substep(h) || !stateOk(s)) {
        Object.assign(s, this.lastGood);
        return;
      }
      remaining -= h;
    }
  }

  liftOff() {
    const s = this.state;
    s.landed = false;
    s.flightTime = 0;
    const up = s.landAngle;
    const r = s.body.surfaceAt(up) + 0.05;
    s.x = r * Math.cos(up);
    s.y = r * Math.sin(up);
    s.vx = 0; s.vy = 0;
    this.emit('liftoff', { body: s.body });
  }

  substep(h) {
    const s = this.state;
    const mu = s.body.mu;
    const a = this.throttle * this.stats.accel;
    const ax = a * Math.cos(s.angle);
    const ay = a * Math.sin(s.angle);
    const start = { x: s.x, y: s.y, vx: s.vx + ax * h * 0.5, vy: s.vy + ay * h * 0.5 };
    let out = propagate(mu, start.x, start.y, start.vx, start.vy, h);
    // Should never happen since #30, but if Kepler breaks, integrate this bit by hand so the
    // rocket keeps flying instead of freezing.
    if (!keplerOk(mu, start, out)) out = leapfrog(mu, start, h, out);
    if (!keplerOk(mu, start, out)) return false;
    out.vx += ax * h * 0.5;
    out.vy += ay * h * 0.5;
    s.x = out.x; s.y = out.y; s.vx = out.vx; s.vy = out.vy;
    s.t += h;
    s.flightTime += h;
    this.dvUsed += a * h;

    const r = Math.hypot(s.x, s.y);
    if (r <= s.body.maxSurface + 0.01) {
      const ground = s.body.surfaceAt(Math.atan2(s.y, s.x));
      if (r <= ground) {
        // Find the moment of touchdown within this substep.
        let lo = 0, hi = h;
        const tmp = {};
        for (let i = 0; i < 20; i++) {
          const mid = (lo + hi) / 2;
          propagate(mu, start.x, start.y, start.vx, start.vy, mid, tmp);
          const g = s.body.surfaceAt(Math.atan2(tmp.y, tmp.x));
          if (Math.hypot(tmp.x, tmp.y) <= g) hi = mid; else lo = mid;
        }
        propagate(mu, start.x, start.y, start.vx, start.vy, hi, tmp);
        s.t += hi - h;
        s.x = tmp.x; s.y = tmp.y; s.vx = tmp.vx; s.vy = tmp.vy;
        this.touchdown();
        return true;
      }
    }
    this.checkSoi();
    return true;
  }

  touchdown() {
    const s = this.state;
    const body = s.body;
    const up = Math.atan2(s.y, s.x);
    const speed = Math.hypot(s.vx, s.vy);
    const tilt = Math.abs(Math.atan2(Math.sin(s.angle - up), Math.cos(s.angle - up)));

    if (body.kind === 'star') return this.crash('star', speed);
    if (body.gas) return this.crash('gas', speed);
    // Rockets can't float (#44): touching a sea (or lava, or a methane lake) is a splash crash.
    if (body.wetAt(up)) return this.crash(body.liquid.kind, speed);

    const gentle = speed < this.stats.safeSpeed;
    const upright = tilt < this.stats.maxTilt || speed < 1.5;
    if (gentle && upright) {
      s.landed = true;
      this.throttle = 0;
      s.landAngle = up;
      s.angle = up;
      this.placeOnSurface();
      this.emit('landed', { body, speed, afterFlight: s.flightTime > 3 });
    } else {
      this.crash(gentle ? 'tipped' : 'fast', speed);
    }
  }

  crash(reason, speed) {
    const s = this.state;
    s.crashed = true;
    this.throttle = 0;
    this.emit('crash', { body: s.body, reason, speed });
  }

  checkSoi() {
    const s = this.state;
    const body = s.body;
    const r = Math.hypot(s.x, s.y);
    if (body.parent && r > body.soi) {
      const p = body.relPos(s.t);
      const v = body.relVel(s.t);
      s.x += p.x; s.y += p.y; s.vx += v.x; s.vy += v.y;
      s.body = body.parent;
      this.emit('soi', { from: body, to: body.parent, kind: 'exit' });
      return;
    }
    for (const c of body.children) {
      const p = c.relPos(s.t);
      const dx = s.x - p.x, dy = s.y - p.y;
      if (dx * dx + dy * dy < c.soi * c.soi) {
        const v = c.relVel(s.t);
        s.x = dx; s.y = dy; s.vx -= v.x; s.vy -= v.y;
        s.body = c;
        this.emit('soi', { from: body, to: c, kind: 'enter' });
        return;
      }
    }
  }

  /** Rocket position in the sun-centred world frame. */
  worldPos(out = {}) {
    const s = this.state;
    s.body.worldPos(s.t, out);
    out.x += s.x;
    out.y += s.y;
    return out;
  }
}
