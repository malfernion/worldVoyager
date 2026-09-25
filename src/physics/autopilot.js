// Friendly "helpers" that fly the rocket for small hands: get to orbit, land gently,
// speed up / slow down along the path, and "take me there" transfers between worlds.
// Each helper is a generator that runs one step per animation frame.
import { propagate, elements, wrapPi } from './orbit.js';
import { predict } from './predict.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function parkingRadius(body) {
  const floor = body.solid ? body.maxSurface : body.radius;
  return floor + body.spaceLine * 1.3;
}

export function inStableOrbit(flight) {
  const s = flight.state;
  if (s.landed || s.crashed) return false;
  const el = flight.elements();
  const b = s.body;
  if (b.kind === 'star') return el.e < 1 && el.rp > b.radius * 2;
  const floor = b.solid ? b.maxSurface : b.radius;
  return el.e < 1 && el.rp > floor + b.spaceLine * 0.4 && el.ra < b.soi * 0.9;
}

/** Which body to head for next on the way from `cur` to `target`. */
export function nextHop(cur, target) {
  if (cur === target) return null;
  if (target === cur.parent) return { body: target, kind: 'up' };
  const childTowards = (parent) => {
    for (let b = target; b; b = b.parent) if (b.parent === parent) return b;
    return null;
  };
  if (cur.isAncestorOf(target)) return { body: childTowards(cur), kind: 'down' };
  if (cur.parent && cur.parent.isAncestorOf(target)) return { body: childTowards(cur.parent), kind: 'sibling' };
  return { body: cur.parent, kind: 'up' };
}

function arrivalScore(pred, hop, now) {
  for (const seg of pred.segments) {
    if (seg.body !== hop) continue;
    const want = parkingRadius(hop);
    const floor = hop.solid ? hop.maxSurface : hop.radius;
    let score = Math.abs(seg.el.rp - want) / hop.radius;
    if (seg.el.rp < floor + hop.spaceLine * 0.3) score += 2 + (floor - seg.el.rp) / hop.radius;
    // Arriving already past the low point (or far too fast) makes capture hard.
    if (seg.el.timeToPe === null) score += 3;
    // Park below any moons so we don't bump into them later.
    for (const c of hop.children) if (seg.el.rp > c.orbitRadius - c.soi * 1.5) score += 2;
    // Bumping into a moon (or the ground) before the low point spoils the arrival.
    else if (seg.end !== 'none' && seg.end !== 'exit' && seg.t0 + seg.el.timeToPe > seg.t1) score += 3;
    if (seg.el.e > 1.5) score += (seg.el.e - 1.5) * 0.5;
    score += (seg.t0 - now) / 20000;
    return score;
  }
  return pred.closest ? 1000 + pred.closest.dist / 1000 : 2000;
}

export class Autopilot {
  constructor(flight) {
    this.flight = flight;
    this.program = null;
    this.mode = null;
    this.warp = null;
    this.target = null;
    this.status = '';
    this.marker = null; // { body, x, y } planned burn point for the map
    this.listeners = [];
  }

  on(fn) {
    this.listeners.push(fn);
  }

  say(text, extra = {}) {
    for (const fn of this.listeners) fn({ text, ...extra });
  }

  get active() {
    return !!this.program;
  }

  start(mode, target = null) {
    this.stop();
    this.mode = mode;
    this.target = target;
    const programs = {
      orbit: () => this.orbitProgram(),
      land: () => this.landProgram(),
      faster: () => this.holdProgram(1),
      slower: () => this.holdProgram(-1),
      goto: () => this.gotoProgram(target),
    };
    this.program = programs[mode]();
  }

  stop() {
    this.program = null;
    this.mode = null;
    this.warp = null;
    this.marker = null;
    this.status = '';
    if (this.flight) {
      this.flight.throttle = 0;
      this.flight.targetAngle = null;
    }
  }

  update(realDt) {
    if (!this.program) return;
    this.dt = realDt;
    if (this.flight.state.crashed) {
      this.stop();
      return;
    }
    const r = this.program.next();
    if (r.done) {
      const mode = this.mode;
      this.stop();
      this.say('', { done: mode, ok: r.value !== false });
    }
  }

  // ---- steering helpers -------------------------------------------------

  aim(angle, tolerance = 0.3) {
    const f = this.flight;
    f.targetAngle = angle;
    return Math.abs(wrapPi(angle - f.state.angle)) < tolerance;
  }

  prograde() {
    const s = this.flight.state;
    return Math.atan2(s.vy, s.vx);
  }

  // ---- programs --------------------------------------------------------

  *holdProgram(sign) {
    const f = this.flight;
    this.warp = 1;
    while (true) {
      const s = f.state;
      if (s.landed || f.speed < 1) {
        f.throttle = sign > 0 ? 1 : 0;
        f.targetAngle = f.upAngle;
      } else {
        const ok = this.aim(this.prograde() + (sign < 0 ? Math.PI : 0), 0.25);
        f.throttle = ok ? 1 : 0;
      }
      yield;
    }
  }

  *orbitProgram(quiet = false) {
    const f = this.flight;
    const body = f.state.body;
    if (inStableOrbit(f)) {
      if (!quiet) this.say(`We're already going around ${body.name}!`);
      return true;
    }
    if (body.kind === 'star') return false;
    const targetR = parkingRadius(body);
    let dir = -1;
    if (!f.state.landed && f.speed > 5) dir = f.elements().dir;
    if (!quiet) this.say('Up, up and away! Let\'s go around!');
    this.status = 'Flying up';

    // 1. Climb and tip over until the high point of our path is in space.
    while (true) {
      const s = f.state;
      if (s.body !== body) return false;
      const el = f.elements();
      const alt = f.altitude;
      if (!s.landed && alt > 2 && el.ra >= targetR) break;
      const tilt = s.landed || alt < 4 ? 0 : Math.min(1.35, 1.35 * Math.pow(alt / (targetR - body.radius), 0.6));
      f.targetAngle = f.upAngle + dir * tilt;
      // Gentle on tiny moons: full power would fling us right out of their pull.
      f.throttle = Math.min(1, (3.5 * body.mu) / (body.radius * body.radius * f.stats.accel));
      this.warp = 1;
      yield;
    }
    f.throttle = 0;

    // 2. Coast up to the high point.
    this.status = 'Coasting to the top';
    while (true) {
      if (f.state.body !== body) return false;
      const el = f.elements();
      const s = f.state;
      const up = f.upAngle;
      const vr = (s.vx * Math.cos(up) + s.vy * Math.sin(up));
      this.aim(up + dir * (Math.PI / 2));
      if (el.timeToAp === null || vr < 0) break;
      const vAp = Math.abs(el.h) / el.ra;
      const burnT = Math.max(0, Math.sqrt(body.mu / el.ra) - vAp) / f.stats.accel;
      const wait = el.timeToAp - burnT / 2;
      if (wait < 0.3) break;
      this.warp = wait > 6 ? clamp(wait / 3, 1, 25) : 1;
      yield;
    }

    // 3. Burn sideways until the path is nice and round.
    this.status = 'Going around!';
    this.warp = 1;
    let guard = 0;
    while (guard++ < 60 * 40) {
      if (f.state.body !== body) {
        f.throttle = 0;
        return false;
      }
      const el = f.elements();
      const s = f.state;
      const r = f.radius;
      if (el.e < 0.03 || (el.e < 1 && el.rp > r * 0.985)) break;
      const up = f.upAngle;
      const vr = s.vx * Math.cos(up) + s.vy * Math.sin(up);
      const pitch = clamp(-vr * 0.08, -0.4, 0.6);
      const ok = this.aim(up + dir * (Math.PI / 2 - pitch));
      const need = Math.abs(Math.sqrt(body.mu / r) - Math.abs(el.h) / r) + Math.abs(vr);
      f.throttle = ok ? clamp(need / (f.stats.accel * 0.5), 0.05, 1) : 0;
      yield;
    }
    f.throttle = 0;
    if (!quiet) this.say(`Hooray! We're in orbit around ${body.name}! Round and round we go!`);
    return true;
  }

  *landProgram() {
    const f = this.flight;
    const body = f.state.body;
    if (f.state.landed) return true;
    if (body.gas) {
      this.say(`${body.name} is made of clouds, there's no ground to land on! Let's visit one of its moons.`);
      return false;
    }
    if (body.kind === 'star') {
      this.say('Ember is way too hot to land on!');
      return false;
    }
    const amax = f.stats.accel;
    if (amax < f.localGravity * 1.05) {
      this.say('Our rocket is too weak to land here. Build one with more engines!');
      return false;
    }
    this.say(`Let's land on ${body.name}. Nice and gentle!`);
    this.status = 'Landing';
    while (!f.state.landed) {
      if (f.state.crashed) return false;
      const s = f.state;
      const up = f.upAngle;
      const ux = Math.cos(up), uy = Math.sin(up);
      const tx = -uy, ty = ux;
      const vr = s.vx * ux + s.vy * uy;
      const vt = s.vx * tx + s.vy * ty;
      const alt = f.altitude;
      const g = f.localGravity;
      const gSurface = body.mu / (body.minSurface * body.minSurface);
      const brake = Math.min(10, Math.max(0.5, amax - gSurface));
      // Leave room for turning the rocket around before the brakes bite.
      const room = Math.max(alt - 2.5 - Math.abs(vr) * 0.9, 0);
      const vrDes = -(Math.sqrt(2 * brake * 0.35 * room) + 1.2);
      const k = 1.3;
      const Tx = k * ((vrDes - vr) * ux - vt * tx) + g * ux;
      const Ty = k * ((vrDes - vr) * uy - vt * ty) + g * uy;
      let rel = wrapPi(Math.atan2(Ty, Tx) - up);
      const maxTilt = alt < 6 ? 0.2 : 1.6;
      rel = clamp(rel, -maxTilt, maxTilt);
      const ang = up + rel;
      const ok = this.aim(ang, alt < 6 ? 0.5 : 0.35);
      const want = Math.hypot(Tx, Ty) / amax;
      f.throttle = ok ? clamp(want, 0, 1) : 0;
      // Speed through long, boring falls.
      const timeToGround = alt / Math.max(1, -vr);
      this.warp = f.throttle === 0 && Math.abs(vt) < 2 && timeToGround > 12 ? clamp(timeToGround / 6, 1, 10) : 1;
      yield;
    }
    f.throttle = 0;
    return true;
  }

  *gotoProgram(target) {
    const f = this.flight;
    if (!target || target.kind === 'star') return false;
    this.say(`Let's fly to ${target.name}!`);
    let legs = 0;
    while (legs++ < 8) {
      const cur = f.state.body;
      if (!inStableOrbit(f) && cur.kind !== 'star') {
        // Arrived somewhere on a fast pass (or still on the ground)? Settle into orbit first.
        if (!f.state.landed) {
          const el = f.elements();
          if (el.e >= 1 || el.ra > cur.soi * 0.9) yield* this.capture(cur);
        }
        if (f.state.body !== cur) continue;
        if (!inStableOrbit(f)) {
          this.status = 'Getting into orbit';
          const ok = yield* this.orbitProgram(true);
          if (!ok || f.state.body !== cur) continue;
        }
      }
      if (cur === target) {
        this.say(`We made it to ${target.name}! Tap the landing button to land!`, { arrived: target });
        return true;
      }
      const hop = nextHop(cur, target);
      const plan = yield* this.planLeg(hop);
      if (!plan) {
        this.say(`Hmm, I can't find a path to ${hop.body.name} right now. Let's try again in a moment!`);
        return false;
      }
      yield* this.waitAndBurn(plan);
      const arrived = yield* this.coastTo(hop.body);
      if (!arrived && f.state.body === cur) this.say('Oops, we missed! Let me try again.');
    }
    return false;
  }

  /** Search burn times and sizes for a path that reaches hop.body at a nice height. */
  *planLeg(hop) {
    const f = this.flight;
    this.status = 'Thinking...';
    this.warp = 1;
    f.throttle = 0;
    const cur = f.state.body;
    const now = f.state.t;
    const el0 = f.elements();
    const rPark = Math.hypot(f.state.x, f.state.y);
    const vPark = Math.hypot(f.state.vx, f.state.vy);
    const T = el0.period;
    const dest = hop.body;
    let window0 = now + 4;
    let span = T;
    let dvGuess;
    let maxSegments = 2;
    const lead = Math.min(8, T * 0.1);

    if (hop.kind === 'down') {
      const r1 = el0.a, r2 = dest.orbitRadius;
      const tH = Math.PI * Math.sqrt(((r1 + r2) / 2) ** 3 / cur.mu);
      dvGuess = Math.sqrt(cur.mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
      const nR = (2 * Math.PI / T) * el0.dir;
      const thetaR = Math.atan2(f.state.y, f.state.x);
      const g0 = wrapPi(thetaR + el0.dir * Math.PI - dest.angleAt(now + tH));
      const k = nR - dest.angularSpeed;
      let dt = -g0 / k;
      while (dt < lead) dt += Math.abs((2 * Math.PI) / k);
      window0 = now + dt;
      span = T * 0.35;
    } else if (hop.kind === 'sibling') {
      const P = cur.parent;
      const r1 = cur.orbitRadius, r2 = dest.orbitRadius;
      const tH = Math.PI * Math.sqrt(((r1 + r2) / 2) ** 3 / P.mu);
      const vInf = Math.abs(Math.sqrt(P.mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1));
      dvGuess = Math.sqrt(vInf * vInf + (2 * cur.mu) / rPark) - vPark;
      const f0 = wrapPi(cur.angleAt(now) + Math.PI - dest.angleAt(now + tH));
      const k = cur.angularSpeed - dest.angularSpeed;
      let dt = -f0 / k;
      while (dt < 0) dt += Math.abs((2 * Math.PI) / k);
      window0 = now + dt;
      span = T;
      maxSegments = 3;
    } else {
      const P = dest;
      const rC = cur.orbitRadius;
      const rpWant = parkingRadius(P);
      const vApo = Math.sqrt((2 * P.mu * rpWant) / (rC * (rC + rpWant)));
      const vInf = Math.abs(Math.sqrt(P.mu / rC) - vApo);
      dvGuess = Math.sqrt(vInf * vInf + (2 * cur.mu) / rPark) - vPark;
      window0 = now + lead + T / 2;
    }
    dvGuess = Math.max(dvGuess, 1);

    // Only try burns that are still in the future.
    const tStart = Math.max(now + lead, window0 - span / 2);
    const evalCandidate = (tb, dv) => {
      const s = propagate(cur.mu, f.state.x, f.state.y, f.state.vx, f.state.vy, tb - now);
      const v = Math.hypot(s.vx, s.vy);
      const st = { body: cur, x: s.x, y: s.y, vx: s.vx * (1 + dv / v), vy: s.vy * (1 + dv / v), t: tb };
      const pred = predict(st, { target: dest, maxSegments, maxTime: 40000 });
      return arrivalScore(pred, dest, tb);
    };

    let best = { score: Infinity, tb: 0, dv: 0 };
    let budget = performance.now();
    const nT = 36, nV = 10;
    // First a focused search around the expected window; if that misses, look wider.
    for (const [from, width, dvLo, dvSpan] of [[tStart, span, 0.85, 0.45], [now + lead, Math.max(span, T) * 1.5, 0.6, 1.2]]) {
      for (let i = 0; i < nT; i++) {
        const tb = from + (width * i) / nT;
        for (let j = 0; j < nV; j++) {
          const dv = dvGuess * (dvLo + (dvSpan * j) / (nV - 1));
          const score = evalCandidate(tb, dv);
          if (score < best.score) best = { score, tb, dv };
        }
        if (performance.now() - budget > 12) {
          yield;
          budget = performance.now();
        }
      }
      if (best.score < 1000) break;
    }
    // Refine around the best guess.
    let stepT = span / nT, stepV = (dvGuess * 0.45) / (nV - 1);
    for (let round = 0; round < 3; round++) {
      stepT /= 2;
      stepV /= 2;
      const centre = best;
      for (let a = -2; a <= 2; a++) {
        for (let b = -2; b <= 2; b++) {
          const tb = centre.tb + a * stepT;
          const dv = centre.dv + b * stepV;
          if (tb < now + 2 || dv <= 0) continue;
          const score = evalCandidate(tb, dv);
          if (score < best.score) best = { score, tb, dv };
        }
        if (performance.now() - budget > 12) {
          yield;
          budget = performance.now();
        }
      }
    }
    if (best.score >= 1000) return null;
    const at = propagate(cur.mu, f.state.x, f.state.y, f.state.vx, f.state.vy, best.tb - now);
    this.marker = { body: cur, x: at.x, y: at.y };
    return { ...best, hop };
  }

  *waitAndBurn(plan) {
    const f = this.flight;
    const burnT = plan.dv / f.stats.accel;
    const start = plan.tb - burnT / 2;
    this.status = 'Waiting for the right moment';
    while (f.state.t < start) {
      const wait = start - f.state.t;
      this.aim(this.prograde());
      this.warp = wait > 5 ? clamp(wait / 2.5, 1, 1000) : 1;
      yield;
    }
    this.status = 'Blast off!';
    this.say('Now! Full power!');
    this.warp = 1;
    const dv0 = f.dvUsed;
    const hopBody = plan.hop.body;
    let checked = 0;
    while (true) {
      const ok = this.aim(this.prograde(), 0.2);
      f.throttle = ok ? 1 : 0;
      const used = f.dvUsed - dv0;
      if (used >= plan.dv * 0.97) {
        // Close the loop: stop as soon as the prediction reaches our goal.
        if (checked++ % 3 === 0) {
          const pred = predict(f.state, { target: hopBody, maxSegments: 3, maxTime: 40000 });
          if (arrivalScore(pred, hopBody, f.state.t) < 1000 || used > plan.dv * 1.25) break;
        }
      }
      yield;
    }
    f.throttle = 0;
    this.marker = null;
  }

  *coastTo(dest) {
    const f = this.flight;
    this.status = `Flying to ${dest.name}`;
    let corrections = 0;
    let lastCheck = -Infinity;
    let pred = null;
    let lastBody = f.state.body;
    while (f.state.body !== dest) {
      if (f.state.crashed) return false;
      const s = f.state;
      if (s.body !== lastBody) {
        lastBody = s.body;
        lastCheck = -Infinity;
      }
      if (performance.now() - lastCheck > 400) {
        lastCheck = performance.now();
        pred = predict(s, { target: dest, maxSegments: 3, maxTime: 40000 });
        const score = arrivalScore(pred, dest, s.t);
        const leftHome = !pred.segments[0].closed || s.body.parent === dest || dest.parent === s.body;
        if (score > 0.8 && corrections < 3 && leftHome) {
          corrections++;
          const fix = yield* this.planCorrection(dest, score);
          if (fix) yield* this.burnVector(fix);
          this.status = `Flying to ${dest.name}`;
          lastCheck = -Infinity;
          continue;
        }
        if (score >= 1000 && corrections >= 3) return false;
      }
      this.aim(this.prograde());
      const next = pred ? pred.segments[0].t1 - s.t : 10;
      this.warp = next > 4 ? clamp(next / 3, 1, 1000) : 1;
      yield;
    }
    return true;
  }

  *planCorrection(dest, baseScore) {
    const f = this.flight;
    this.status = 'Fixing our path';
    this.warp = 1;
    const s = f.state;
    const tb = s.t + 3;
    const at = propagate(s.body.mu, s.x, s.y, s.vx, s.vy, 3);
    const pro = Math.atan2(at.vy, at.vx);
    let best = { score: baseScore * 0.8, dir: 0, dv: 0 };
    let budget = performance.now();
    const mags = [0.3, 0.7, 1.5, 3, 6, 12, 20, 32];
    for (let i = 0; i < 16; i++) {
      const dir = pro + (i / 16) * Math.PI * 2;
      for (const dv of mags) {
        const st = { body: s.body, x: at.x, y: at.y, vx: at.vx + dv * Math.cos(dir), vy: at.vy + dv * Math.sin(dir), t: tb };
        const score = arrivalScore(predict(st, { target: dest, maxSegments: 3, maxTime: 40000 }), dest, tb);
        if (score < best.score) best = { score, dir, dv };
      }
      if (performance.now() - budget > 12) {
        yield;
        budget = performance.now();
      }
    }
    return best.dv > 0 ? { angle: best.dir, dv: best.dv } : null;
  }

  *burnVector({ angle, dv }) {
    const f = this.flight;
    this.status = 'Little push';
    let guard = 0;
    while (!this.aim(angle, 0.1) && guard++ < 400) {
      f.throttle = 0;
      yield;
    }
    const dv0 = f.dvUsed;
    const body = f.state.body;
    while (f.dvUsed - dv0 < dv && f.state.body === body) {
      f.throttle = clamp((dv - (f.dvUsed - dv0)) / (f.stats.accel / 60) , 0.05, 1);
      this.aim(angle, 0.1);
      yield;
    }
    f.throttle = 0;
  }

  *capture(body) {
    const f = this.flight;
    this.status = `Arriving at ${body.name}`;
    this.say(`We're at ${body.name}!`, { visiting: body });
    const floor = body.solid ? body.maxSurface : body.radius;
    const want = parkingRadius(body);

    // Heading for a moon or a bad height? Nudge the path first.
    for (let tries = 0; tries < 2 && f.state.body === body && f.elements().e >= 1; tries++) {
      const score = arrivalScore(predict(f.state, { maxSegments: 2, maxTime: 40000 }), body, f.state.t);
      if (score < 0.8) break;
      const fix = yield* this.planCorrection(body, score);
      if (!fix) break;
      yield* this.burnVector(fix);
    }

    // Too low? Push sideways to swing wide of the ground.
    let el = f.elements();
    if (el.rp < floor + body.spaceLine * 0.5) {
      this.status = 'Steering away from the ground';
      while (el.rp < want * 0.95 && f.state.body === body && !f.state.landed) {
        const up = f.upAngle;
        const ok = this.aim(up + el.dir * (Math.PI / 2), 0.25);
        f.throttle = ok ? 1 : 0;
        this.warp = 1;
        yield;
        el = f.elements();
      }
      f.throttle = 0;
    }

    // Wait for the lowest point, then brake.
    this.status = 'Waiting to slow down';
    while (f.state.body === body) {
      el = f.elements();
      if (el.timeToPe === null) break;
      const vPe = Math.abs(el.h) / el.rp;
      const burnT = Math.max(0, vPe - Math.sqrt(body.mu / el.rp)) / f.stats.accel;
      const wait = el.timeToPe - burnT / 2;
      if (wait < 0.3 || (el.e < 1 && el.timeToPe > el.period * 0.9)) break;
      // Already heading out of this world's pull? Brake right now.
      const vr = (f.state.x * f.state.vx + f.state.y * f.state.vy) / f.radius;
      if (vr > 0 && el.ra > body.soi * 0.9) break;
      this.aim(this.prograde() + Math.PI);
      this.warp = wait > 5 ? clamp(wait / 3, 1, 1000) : 1;
      yield;
    }
    this.status = 'Slowing down';
    this.say('Slow down, rocket!');
    this.warp = 1;
    let guard = 0;
    let prevE = Infinity;
    // Brake until the path is round (stop if it starts getting less round again).
    while (guard++ < 60 * 60 && f.state.body === body && !f.state.landed) {
      el = f.elements();
      if (el.e < 0.03 || (el.e < 0.3 && el.e > prevE + 1e-5)) break;
      prevE = el.e;
      const ok = this.aim(this.prograde() + Math.PI, 0.25);
      f.throttle = ok ? 1 : 0;
      yield;
    }
    f.throttle = 0;

    // Parked way up high? Drop down to a cosy orbit (lower the low point, then round it off).
    el = f.elements();
    if (f.state.body === body && el.e < 1 && el.rp > want * 1.6) {
      this.status = 'Moving closer';
      if (el.e > 0.1) yield* this.coastToApsis('ap');
      while (f.state.body === body && f.elements().rp > want) {
        f.throttle = this.aim(this.prograde() + Math.PI, 0.25) ? 1 : 0;
        yield;
      }
      f.throttle = 0;
      yield* this.coastToApsis('pe');
      while (f.state.body === body && f.elements().e > 0.05) {
        f.throttle = this.aim(this.prograde() + Math.PI, 0.25) ? 1 : 0;
        yield;
      }
      f.throttle = 0;
    }
    return true;
  }

  *coastToApsis(which) {
    const f = this.flight;
    const body = f.state.body;
    while (f.state.body === body) {
      const el = f.elements();
      const wait = which === 'ap' ? el.timeToAp : el.timeToPe;
      if (wait === null || wait < 0.5 || wait > el.period - 1) break;
      this.aim(this.prograde() + Math.PI);
      this.warp = wait > 5 ? clamp(wait / 3, 1, 1000) : 1;
      yield;
    }
    this.warp = 1;
  }
}
