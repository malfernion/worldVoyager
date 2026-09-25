// Friendly "helpers" that fly the rocket for small hands: get to orbit, land gently,
// speed up / slow down along the path, and "take me there" transfers between worlds.
// Each helper is a generator that runs one step per animation frame.
import { propagate, elements, wrapPi } from './orbit.js';
import { predict } from './predict.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// How the speech queue treats a line (#31, src/ui/speechQueue.js). Cues in flight are
// time-critical and cut in; the first step of a lesson (the rocket waits for the player) waits
// its turn. A newer coach line replaces an older one still waiting. Safety takeovers cut in.
// Anything else waits its turn.
const CUE = { pri: 'cue', key: 'coach' };
const COACH = { key: 'coach' };
const URGENT = { pri: 'urgent' };

// The comet is far too small to aim a whole trip at, so a trip only has to pass this close;
// then Pip homes in on it (catchComet).
export const CATCH_RANGE = 8000;

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
    // Going around the same way as everything else makes later trips easy.
    if (hop.children.length && seg.el.dir !== hop.children[0].orbitDir) score += 1;
    // Park below any moons so we don't bump into them later.
    if (hop.children.some((c) => seg.el.rp > c.periapsis - c.soi * 1.5)) score += 2;
    // Bumping into a moon (or the ground) before we've braked at the low point spoils the arrival.
    if ((seg.end === 'encounter' || seg.end === 'impact') && seg.el.timeToPe !== null && seg.t1 < seg.t0 + seg.el.timeToPe + 20) score += 5;
    if (seg.el.e > 1.5) score += (seg.el.e - 1.5) * 0.5;
    score += (seg.t0 - now) / 20000;
    return score;
  }
  // Passing close to the comet is good enough: from there we home in.
  // Slowly is better (a comet racing past close to Ember is hard to catch), and never by
  // diving close to the star.
  if (hop.comet && pred.closest && pred.closest.dist < CATCH_RANGE) {
    const dive = pred.segments.some((seg) => seg.body.kind === 'star' && seg.t0 < pred.closest.t && seg.el.rp < seg.body.radius * 3);
    if (!dive) return 10 + pred.closest.dist / 1000 + pred.closest.vRel / 10 + (pred.closest.t - now) / 20000;
  }
  return pred.closest ? 1000 + pred.closest.dist / 1000 : 2000;
}

/**
 * Speed for a sideways burn at radius `r` so we leave `body`'s pull going about `vOut`
 * (relative to it). With patched conics the rocket keeps the speed it has at the edge of the
 * SOI, not the speed it would have infinitely far away; aiming for the far-away speed flung us
 * out of big Tumble far too fast (even backwards round Ember, #11). But a crawl out to the very
 * edge is slow and touchy, so we leave at least a bit briskly.
 */
function escapeBurn(body, vOut, r) {
  const edgeEsc2 = (2 * body.mu) / body.soi; // escape speed squared at the edge of the SOI
  return Math.sqrt(Math.max(vOut * vOut, edgeEsc2 / 4) + (2 * body.mu) / r - edgeEsc2);
}

/**
 * Transfer window between two worlds going round the same parent when one of them is on a
 * stretched orbit (the comet), where the round-orbit phase maths doesn't hold. Tries leaving
 * at each moment over the next `horizon` seconds on half an ellipse from where `cur` is then
 * out (or in) to where `dest` will be when we get there, and keeps the moments where they
 * meet. Of those, the best has the gentlest departure and arrival (a comet racing past close
 * to Ember is hard to catch; far out it dawdles), with a little penalty for waiting.
 * Returns { tb, vInf } (vInf: how fast to leave `cur`, relative to it).
 */
export function stretchedWindow(cur, dest, now, horizon) {
  const mu = cur.parent.mu;
  const dir = cur.orbitDir;
  const steps = 600;
  const pv = {};
  const leg = (tb) => {
    const r1 = cur.distAt(tb);
    const th1 = cur.angleAt(tb);
    // The trip time depends on how far out dest is when we arrive: settle it in a few rounds.
    let r2 = dest.distAt(tb), tH = 0;
    for (let i = 0; i < 4; i++) {
      tH = Math.PI * Math.sqrt(((r1 + r2) / 2) ** 3 / mu);
      r2 = dest.distAt(tb + tH);
    }
    const miss = wrapPi(th1 + Math.PI - dest.angleAt(tb + tH));
    return { r1, r2, th1, tH, miss };
  };
  // Speed left over leaving `body` at time t along the ellipse (tangential, going `dir` way round).
  const excess = (body, t, r, rOther, th) => {
    const v = Math.sqrt(mu * (2 / r - 2 / (r + rOther)));
    body.relVel(t, pv);
    return Math.hypot(-Math.sin(th) * dir * v - pv.x, Math.cos(th) * dir * v - pv.y);
  };
  let best = null;
  let prev = leg(now);
  for (let i = 1; i <= steps; i++) {
    const t = now + (horizon * i) / steps;
    const next = leg(t);
    // A real crossing, not the jump from +pi to -pi.
    if (Math.sign(next.miss) !== Math.sign(prev.miss) && Math.abs(next.miss - prev.miss) < Math.PI) {
      let lo = t - horizon / steps, hi = t;
      const s0 = Math.sign(prev.miss);
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2;
        if (Math.sign(leg(mid).miss) === s0) lo = mid; else hi = mid;
      }
      const tb = (lo + hi) / 2;
      const w = leg(tb);
      const vInf = excess(cur, tb, w.r1, w.r2, w.th1);
      const vArr = excess(dest, tb + w.tH, w.r2, w.r1, w.th1 + Math.PI);
      const score = vInf + vArr * 1.5 + (tb - now) * 0.01;
      if (!best || score < best.score) best = { tb, vInf, score };
    }
    prev = next;
  }
  return best;
}

/** Does this orbit loop through the path of one of `body`'s moons (other than the one we're heading for)? */
function crossesMoon(body, el, target = null) {
  return body.children.some((c) => !c.isAncestorOf(target ?? body) && el.ra > c.periapsis - c.soi && el.rp < c.apoapsis + c.soi);
}

/** When coasting from `state` first hits the ground or a moon other than `dest` (Infinity if not before `until`). */
function strayTime(state, dest, until) {
  let st = state;
  // A closed orbit is predicted one lap at a time, so look a few laps ahead.
  for (let lap = 0; lap < 20 && st.t < until; lap++) {
    const seg = predict(st, { maxSegments: 1, maxTime: until - st.t }).segments[0];
    if (seg.end === 'impact' || (seg.end === 'encounter' && seg.next !== dest)) return seg.t1;
    if (seg.end !== 'none') break;
    st = { body: seg.body, ...seg.endState, t: seg.t1 };
  }
  return Infinity;
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
    this.coach = false;
    this.cmd = { throttle: 0, angle: null };
    this.clock = 0; // real seconds, for spacing out spoken cues
    this.saidAt = -Infinity;
    this.cuedAt = -Infinity;
    this.goPower = 1; // how hard GO pushes while coaching (gentler for landings)
  }

  on(fn) {
    this.listeners.push(fn);
  }

  say(text, extra = {}) {
    if (text) this.saidAt = this.clock;
    for (const fn of this.listeners) fn({ text, ...extra });
  }

  get active() {
    return !!this.program;
  }

  /** True while the helper is actually steering (not just coaching). */
  get driving() {
    return !!this.program && !this.coach;
  }

  start(mode, target = null, { coach = false } = {}) {
    this.stop();
    this.coach = coach;
    this.coachSession = coach;
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
    this.cmd = { throttle: 0, angle: null };
    this.goPower = 1;
    if (this.flight && !this.coach) {
      this.flight.throttle = 0;
      this.flight.targetAngle = null;
    }
    this.coach = false;
    this.coachSession = false;
  }

  update(realDt) {
    if (!this.program) return;
    this.dt = realDt;
    this.clock += realDt;
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

  /** Point at `angle`; true once the rocket is close enough. Coaching is more forgiving. */
  aim(angle, tolerance = 0.3) {
    const f = this.flight;
    this.setAngle(angle);
    if (this.coach) tolerance = Math.max(tolerance * 1.8, 0.35);
    return Math.abs(wrapPi(angle - f.state.angle)) < tolerance;
  }

  // In coach mode the helper only suggests; the player does the flying.
  setThrottle(v) {
    // Kids either hold GO or they don't.
    this.cmd.throttle = this.coach ? (v >= 0.1 ? 1 : 0) : v;
    if (!this.coach) this.flight.throttle = v;
  }

  setAngle(a) {
    this.cmd.angle = a;
    if (!this.coach) this.flight.targetAngle = a;
  }

  /** Time-warp request, capped so we never zoom straight past a new world or into the ground. */
  safeWarp(want) {
    if (want <= 1) return 1;
    const f = this.flight;
    if (!this.eventCache || this.eventCache.body !== f.state.body || this.eventCache.age++ > 15) {
      const seg = predict(f.state, { maxSegments: 1, maxTime: 40000 }).segments[0];
      this.eventCache = { body: f.state.body, t: seg.end === 'none' ? Infinity : seg.t1, age: 0 };
    }
    return clamp(Math.min(want, (this.eventCache.t - f.state.t) / 3), 1, 1000);
  }

  /** Say one thing when flying for them, another when coaching. */
  tip(auto, coach, extra = {}) {
    this.say(this.coach ? coach : auto, extra);
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
        this.setThrottle(sign > 0 ? 1 : 0);
        this.setAngle(f.upAngle);
      } else {
        const ok = this.aim(this.prograde() + (sign < 0 ? Math.PI : 0), 0.25);
        this.setThrottle(ok ? 1 : 0);
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
    const fromGround = f.state.landed;
    if (this.coach && fromGround) this.say('First we fly up high. Point up and hold GO!', COACH);
    else if (!quiet) this.say('Up, up and away! Let\'s go around!');
    this.status = 'Flying up';

    // 1. Climb and tip over until the high point of our path is in space.
    while (true) {
      const s = f.state;
      if (s.body !== body) return false;
      const el = f.elements();
      const alt = f.altitude;
      if (!s.landed && alt > 2 && el.ra >= targetR) break;
      const tilt = s.landed || alt < 4 ? 0 : Math.min(1.35, 1.35 * Math.pow(alt / (targetR - body.radius), 0.6));
      this.setAngle(f.upAngle + dir * tilt);
      // Gentle on tiny moons: full power would fling us right out of their pull.
      this.setThrottle(Math.min(1, (3.5 * body.mu) / (body.radius * body.radius * f.stats.accel)));
      this.warp = 1;
      yield;
    }
    this.setThrottle(0);
    // A comet's pull is so weak that going round it is all tiny pushes, so Pip does the rest.
    if (body.comet) {
      if (this.coach && fromGround) this.say('Let go! Comets are tricky, so I\'ll steer us round.', CUE);
      const ok = yield* this.catchComet(body, null);
      if (ok && !quiet) this.say(`Hooray! We're in orbit around ${body.name}! Round and round we go!`);
      return ok;
    }
    if (this.coach && fromGround) this.say('Let go! Now we glide up to the top.', CUE);

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
      this.warp = this.safeWarp(wait > 6 ? clamp(wait / 3, 1, 25) : 1);
      yield;
    }

    // 3. Burn sideways until the path is nice and round.
    this.status = 'Going around!';
    if (this.coach) this.say(fromGround ? 'Turn sideways to the arrow and hold GO, so we go around!' : 'Follow the arrow and hold GO to make our path nice and round.', CUE);
    this.warp = 1;
    const wasCoach = this.coach;
    let guard = 0;
    while (guard++ < 60 * 40) {
      if (f.state.body !== body) {
        this.setThrottle(0);
        this.coach = wasCoach;
        return false;
      }
      const el = f.elements();
      const s = f.state;
      const r = f.radius;
      if (el.e < (this.coach ? 0.07 : 0.03) || (el.e < 1 && el.rp > r * (this.coach ? 0.95 : 0.985))) break;
      const up = f.upAngle;
      const vr = s.vx * Math.cos(up) + s.vy * Math.sin(up);
      const pitch = clamp(-vr * 0.08, -0.4, 0.6);
      const ok = this.aim(up + dir * (Math.PI / 2 - pitch));
      const need = Math.abs(Math.sqrt(body.mu / r) - Math.abs(el.h) / r) + Math.abs(vr);
      // A late LET GO on a small moon flings us right out of orbit, so Pip does the last bit.
      if (this.coach && need < f.stats.accel * 0.5) {
        this.coach = false;
        this.say(`Let go! We're going around ${body.name}!`, CUE);
      }
      this.setThrottle(ok ? clamp(need / (f.stats.accel * 0.5), 0.05, 1) : 0);
      yield;
    }
    this.setThrottle(0);
    // The player finished it themselves (Pip didn't take the last bit)?
    if (this.coach) this.say(`Let go! We're going around ${body.name}!`, CUE);
    if (wasCoach && !this.coach) f.targetAngle = null;
    this.coach = wasCoach;
    // A coached player just heard "Let go! We're going around…", which says it already.
    if (!quiet && !wasCoach) this.say(`Hooray! We're in orbit around ${body.name}! Round and round we go!`);
    return true;
  }

  *landProgram(intro = null) {
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
    if (f.stats.accel < f.localGravity * 1.05) {
      this.say('Our rocket is too weak to land here. Build one with more engines!');
      return false;
    }
    this.status = 'Landing';
    if (this.coach) return yield* this.coachLand(intro ?? `Let's land on ${body.name} together!`);
    this.say(`Let's land on ${body.name}. Nice and gentle!`);
    return yield* this.descend();
  }

  /** How we're moving compared to the ground, and how fast we'd like to be falling. */
  descent() {
    const f = this.flight;
    const s = f.state;
    const body = s.body;
    const up = f.upAngle;
    const ux = Math.cos(up), uy = Math.sin(up);
    const tx = -uy, ty = ux;
    const vr = s.vx * ux + s.vy * uy;
    const vt = s.vx * tx + s.vy * ty;
    const alt = f.altitude;
    const gSurface = body.mu / (body.minSurface * body.minSurface);
    const brake = Math.min(10, Math.max(0.5, f.stats.accel - gSurface));
    // Leave room for turning the rocket around before the brakes bite.
    const room = Math.max(alt - 2.5 - Math.abs(vr) * 0.9, 0);
    const vrDes = -(Math.sqrt(2 * brake * 0.35 * room) + 1.2);
    return { up, ux, uy, tx, ty, vr, vt, alt, g: f.localGravity, brake, vrDes };
  }

  /** Fly down on the gentle descent profile until we touch the ground. */
  *descend() {
    const f = this.flight;
    const amax = f.stats.accel;
    while (!f.state.landed) {
      if (f.state.crashed) return false;
      const { up, ux, uy, tx, ty, vr, vt, alt, g, vrDes } = this.descent();
      const k = 1.3;
      const Tx = k * ((vrDes - vr) * ux - vt * tx) + g * ux;
      const Ty = k * ((vrDes - vr) * uy - vt * ty) + g * uy;
      let rel = wrapPi(Math.atan2(Ty, Tx) - up);
      const maxTilt = alt < 6 ? 0.2 : 1.6;
      rel = clamp(rel, -maxTilt, maxTilt);
      const ang = up + rel;
      const ok = this.aim(ang, alt < 6 ? 0.5 : 0.35);
      const want = Math.hypot(Tx, Ty) / amax;
      this.setThrottle(ok ? clamp(want, 0, 1) : 0);
      // Speed through long, boring falls.
      const timeToGround = alt / Math.max(1, -vr);
      this.warp = this.safeWarp(this.cmd.throttle === 0 && Math.abs(vt) < 2 && timeToGround > 12 ? clamp(timeToGround / 6, 1, 10) : 1);
      yield;
    }
    this.setThrottle(0);
    return true;
  }

  /** How hard we'd have to brake (beyond gravity) to slow from `down` to `vLand` just above the ground. */
  brakeNeed(down, alt, vLand = 0) {
    return Math.max(0, down - vLand) ** 2 / (2 * Math.max(alt - 0.3, 0.1));
  }

  /** Call out HOLD / LET GO: never over a longer line Pip just said, and not too often. */
  cue(text) {
    if (this.clock - this.saidAt < 3 || this.clock - this.cuedAt < 1.5) return;
    const at = this.saidAt;
    this.say(text, CUE);
    this.saidAt = at; // short cues shouldn't hold back the next one
    this.cuedAt = this.clock;
  }

  /** Which way to push to stop drifting sideways, tipped up enough to only sink slowly meanwhile. */
  sidewaysAngle(d) {
    const lift = Math.max(0, 1.3 * (-1 - d.vr) + d.g);
    return d.up + clamp(Math.atan2(-d.vt, lift), -1.6, 1.6);
  }

  /** Tiny sideways stops are too quick for small thumbs, so Pip does them. */
  *stopSideways(line) {
    const f = this.flight;
    const wasCoach = this.coach;
    this.coach = false;
    this.say(line, CUE);
    this.warp = 1;
    for (let guard = 0; guard < 60 * 20 && !f.state.landed && !f.state.crashed; guard++) {
      const d = this.descent();
      if (Math.abs(d.vt) < 0.5) break;
      const ang = this.sidewaysAngle(d);
      const side = Math.abs(Math.sin(ang - d.up)) * f.stats.accel;
      this.setThrottle(this.aim(ang, 0.15) ? clamp(Math.abs(d.vt) / (side * 0.3 + 1e-6), 0.05, 1) : 0);
      yield;
    }
    this.setThrottle(0);
    f.targetAngle = null;
    this.coach = wasCoach;
  }

  /**
   * Coached landing for binary GO presses: first stop going sideways, then point up and
   * hold GO whenever we're falling too fast to stop gently before the ground.
   */
  *coachLand(intro) {
    const f = this.flight;
    const body = f.state.body;
    const amax = f.stats.accel;
    // Kids react late, so cues look this far ahead (seconds).
    const lead = 0.3;
    // On the way down GO gives a gentle push (about twice our weight), so a tap on a big
    // engine or a tiny moon doesn't fling us back up.
    const gSurface = body.mu / (body.minSurface * body.minSurface);
    const power = Math.min(1, (2.2 * gSurface) / amax);
    // Aim to touch down at a third of the speed the legs can take.
    const vLand = f.stats.safeSpeed * 0.3;
    // Lines kept as plain sentences so the voice recorder can find them.
    const pointUp = 'Now point up at the arrow. I\'ll tell you when to hold GO!';
    const stopSide = 'First, point along the arrow and hold GO to stop going sideways.';
    const tinyPush = 'I\'ll do this tiny push for you!';
    let d = this.descent();
    // Only long sideways stops (a second or more of GO) are left to the player.
    let sideways = Math.abs(d.vt) > amax;
    if (sideways) {
      this.say(`${intro} ${stopSide}`, COACH);
    } else if (Math.abs(d.vt) > 1.5) {
      yield* this.stopSideways(`${intro} ${tinyPush}`);
      this.say(pointUp, CUE);
    } else {
      this.say(`${intro} ${pointUp}`, COACH);
    }
    let hold = false;
    let flipAt = -Infinity;
    let steady = false;
    while (!f.state.landed) {
      if (f.state.crashed) return false;
      d = this.descent();
      const down = -d.vr;
      const need = this.brakeNeed(down, d.alt, vLand);
      // Just dropping from here would still be a gentle bump? Then no more GO.
      const drop = Math.sqrt(Math.max(0, down) ** 2 + 2 * d.g * Math.max(0, d.alt)) < f.stats.safeSpeed * 0.6;
      // Too fast to trust to small hands (with room to spare for Pip)?
      if (d.alt > 3 && !drop && this.brakeNeed(down, d.alt - 1.2, f.stats.safeSpeed * 0.5) > (amax - gSurface) * 0.6) {
        // Safety first: if it's gone badly, Pip lands the last bit (like the other takeovers).
        this.coach = false;
        this.goPower = 1;
        this.say('Whoa, too fast! I\'ll catch us this time.', URGENT);
        // Brake hard first, then the Land helper finishes gently.
        for (let e = d; !f.state.landed && !f.state.crashed && -e.vr > vLand; e = this.descent()) {
          this.setThrottle(this.aim(e.up + clamp(-e.vt * 0.2, -0.2, 0.2), 0.3) ? 1 : 0);
          this.warp = 1;
          yield;
        }
        const ok = yield* this.descend();
        this.coach = true;
        if (ok) this.say('Phew, we\'re down! Next time, hold GO a little sooner.');
        return ok;
      }
      // 1. Stop going sideways: point along the arrow (backwards) and hold GO.
      if (sideways) {
        this.warp = 1;
        // Called a little early so a late "let go" still leaves us nearly still.
        if (Math.abs(d.vt) > amax * 0.15) {
          this.setThrottle(this.aim(this.sidewaysAngle(d), 0.35) ? 1 : 0);
          yield;
          continue;
        }
        sideways = false;
        this.say(`Let go! ${pointUp}`, CUE);
      }
      // Still drifting a lot? Pip tidies that up while there's room.
      if (Math.abs(d.vt) > 4 && d.alt > 10) {
        yield* this.stopSideways(tinyPush);
        continue;
      }
      // 2. Straight down. Falling fast? GO quietly pushes harder, so a HOLD always has enough oomph.
      // For the last few metres it's just "keep holding": GO then sets the engine for a
      // gentle touchdown.
      const final = d.alt < 5;
      this.goPower = final
        ? clamp((need * 2 + d.g * 0.9) / amax, 0.05, 1)
        : Math.max(power, Math.min(1, (need * 1.3 + d.g) / amax));
      const brake = Math.max(0.5, amax * power - gSurface);
      // Lean a little to cancel leftover drift (and stand up straight near the ground).
      const lim = d.alt < 6 ? 0.12 : 0.3;
      const ang = d.up + clamp(-d.vt * 0.2, -lim, lim);
      // Keeping straight is fiddly, so once the player has pointed up (and always near the
      // ground) Pip steadies the rocket and hides the arrow; the player does HOLD / LET GO.
      const off = Math.abs(wrapPi(ang - f.state.angle));
      steady = d.alt < 8 || off < (steady ? 0.5 : 0.25);
      const ok = steady ? off < 0.35 : this.aim(ang, 0.35);
      if (steady) {
        this.cmd.angle = null;
        f.targetAngle = ang;
      }
      // How much braking we might need by the time the player reacts (as if falling freely:
      // HOLD a little early, LET GO a little late).
      const ahead = this.brakeNeed(down + d.g * lead, d.alt, vLand);
      // HOLD when stopping gently needs 40% of our (gentle) brakes, LET GO below 15%.
      // A HOLD lasts at least half a second so small hands can keep up.
      const was = hold;
      const since = this.clock - flipAt;
      if (!hold && !drop && down > 0 && (final || (ahead > brake * 0.4 && (since > 0.3 || ahead > brake * 0.6)))) hold = true;
      // Never keep holding while going up, or we'd bounce about above the ground.
      else if (hold && (down < 0 || drop || (!final && since > 0.5 && ahead < brake * 0.15))) hold = false;
      if (hold !== was) {
        flipAt = this.clock;
        this.cue(hold ? 'Hold GO!' : 'Let go!');
      }
      this.setThrottle(hold && ok ? 1 : 0);
      // Speed up long falls, but slow back down well before the next HOLD.
      const vHold = vLand + Math.sqrt(0.8 * brake * Math.max(d.alt - 0.3, 0));
      const tCue = (vHold - down) / (2 * d.g);
      this.warp = this.safeWarp(!hold && f.throttle === 0 && tCue > 4 ? clamp(tCue / 4, 1, 8) : 1);
      yield;
    }
    this.goPower = 1;
    this.setThrottle(0);
    this.say('You landed all by yourself! Great flying!');
    return true;
  }

  *gotoProgram(target) {
    const f = this.flight;
    if (!target || target.kind === 'star') return false;
    this.say(`Let's fly to ${target.name}!`);
    let legs = 0;
    // Enough tries for the longest route (Flip to Nibble: up, across, down) with a few retries.
    while (legs++ < 12) {
      const cur = f.state.body;
      // A loop through a moon's path isn't a safe place to wait (or to stop).
      if ((!inStableOrbit(f) || crossesMoon(cur, f.elements(), target)) && cur.kind !== 'star') {
        // Arrived somewhere on a fast pass (or still on the ground)? Settle into orbit first.
        if (!f.state.landed) {
          const el = f.elements();
          if (el.e >= 1 || el.ra > cur.soi * 0.9 || crossesMoon(cur, el, target)) yield* this.capture(cur, false, target);
        }
        if (f.state.body !== cur) continue;
        if (!inStableOrbit(f)) {
          this.status = 'Getting into orbit';
          const ok = yield* this.orbitProgram(true);
          // Rounded off right at the edge of a tiny moon's pull? Go round again to move closer.
          if (!ok || f.state.body !== cur || !inStableOrbit(f)) continue;
        }
      }
      if (cur === target) {
        if (this.coach && target.solid) {
          // Carry straight on: now the player lands it too.
          this.mode = 'land';
          return yield* this.landProgram(`You flew to ${target.name} all by yourself! Now let's land together.`);
        }
        this.tip(`We made it to ${target.name}! Tap the landing button to land!`,
          `You flew to ${target.name} all by yourself! To land, point up and hold GO to slow down. Or tap the landing button.`, { arrived: target });
        return true;
      }
      const hop = nextHop(cur, target);
      if (hop.body.comet && cur === hop.body.parent && this.cometGap(hop.body) < CATCH_RANGE) {
        yield* this.catchComet(hop.body);
        continue;
      }
      if (hop.kind === 'down' && f.elements().dir !== hop.body.orbitDir) {
        yield* this.flipOrbit(hop.body);
        continue;
      }
      // A coached player lets go a moment late: plan from the orbit we really end up in.
      for (let i = 0; i < 60 && f.throttle > 0; i++) {
        this.setThrottle(0);
        yield;
      }
      if (f.state.body !== cur) continue;
      if (!inStableOrbit(f)) {
        // Already on the way out? That's where an "up" hop goes anyway.
        if (hop.kind === 'up' && f.elements().e >= 1) yield* this.coastTo(hop.body);
        continue;
      }
      const plan = yield* this.planLeg(hop);
      if (!plan) {
        this.say(`Hmm, I can't find a path to ${hop.body.name} right now. Let's try again in a moment!`);
        return false;
      }
      const burned = yield* this.waitAndBurn(plan);
      if (!burned) continue;
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
    this.setThrottle(0);
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
      const r1 = el0.a, r2 = dest.distAt(now);
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
    } else if (hop.kind === 'sibling' && (cur.ecc || dest.ecc)) {
      // To or from the comet: its stretched orbit needs a window search of its own.
      // Look ahead long enough for the two to line up again (a bit more than the synodic period).
      const synodic = 1 / Math.abs(1 / cur.orbitalPeriod - 1 / dest.orbitalPeriod);
      const w = stretchedWindow(cur, dest, now, Math.max(cur.orbitalPeriod, dest.orbitalPeriod, synodic * 1.2));
      if (!w) return null;
      dvGuess = escapeBurn(cur, w.vInf, rPark) - vPark;
      window0 = w.tb;
      span = T;
      maxSegments = 3;
    } else if (hop.kind === 'sibling') {
      const P = cur.parent;
      const r1 = cur.orbitRadius, r2 = dest.orbitRadius;
      const tH = Math.PI * Math.sqrt(((r1 + r2) / 2) ** 3 / P.mu);
      const vInf = Math.abs(Math.sqrt(P.mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1));
      dvGuess = escapeBurn(cur, vInf, rPark) - vPark;
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
      dvGuess = escapeBurn(cur, vInf, rPark) - vPark;
      window0 = now + lead + T / 2;
    }
    // Signed: negative means brake (drop inward) instead of speeding up.
    if (Math.abs(dvGuess) < 1) dvGuess = dvGuess < 0 ? -1 : 1;

    // Only try burns that are still in the future, and before our orbit bumps into a moon
    // (after an "up" hop we're often still sharing the moon's path).
    const tStart = Math.max(now + lead, window0 - span / 2);
    const safeUntil = strayTime(f.state, dest, Math.max(tStart + span, now + lead + Math.max(span, T) * 1.5) + T * 0.1) - 10;
    const evalCandidate = (tb, dv) => {
      if (tb + Math.abs(dv) / f.stats.accel > safeUntil) return Infinity;
      const s = propagate(cur.mu, f.state.x, f.state.y, f.state.vx, f.state.vy, tb - now);
      const v = Math.hypot(s.vx, s.vy);
      const st = { body: cur, x: s.x, y: s.y, vx: s.vx * (1 + dv / v), vy: s.vy * (1 + dv / v), t: tb };
      const pred = predict(st, { target: dest, maxSegments, maxTime: 40000 });
      return arrivalScore(pred, dest, tb);
    };

    let best = { score: Infinity, tb: 0, dv: 0 };
    let work = 0; // yield every so often so the game keeps animating while we think
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
        if (++work % 3 === 0) {
          yield;
        }
      }
      if (best.score < 1000) break;
    }
    // Refine around the best guess.
    let stepT = span / nT, stepV = (Math.abs(dvGuess) * 0.45) / (nV - 1);
    for (let round = 0; round < 3; round++) {
      stepT /= 2;
      stepV /= 2;
      const centre = best;
      for (let a = -2; a <= 2; a++) {
        for (let b = -2; b <= 2; b++) {
          const tb = centre.tb + a * stepT;
          const dv = centre.dv + b * stepV;
          if (tb < now + 2 || dv * dvGuess <= 0) continue;
          const score = evalCandidate(tb, dv);
          if (score < best.score) best = { score, tb, dv };
        }
        if (++work % 3 === 0) {
          yield;
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
    const dir = plan.dv < 0 ? Math.PI : 0;
    const dvAbs = Math.abs(plan.dv);
    const burnT = dvAbs / f.stats.accel;
    const start = plan.tb - burnT / 2;
    this.status = 'Waiting for the right moment';
    if (this.coach) this.say(`See the fire on the map? When we get there, point along the arrow and hold GO!`, COACH);
    const home = f.state.body;
    while (f.state.t < start) {
      if (f.state.body !== home) return false;
      const wait = start - f.state.t;
      this.aim(this.prograde() + dir);
      if (this.coach) this.status = `🔥 Burn in ${Math.ceil(wait)}s`;
      this.warp = this.safeWarp(wait > 5 ? clamp(wait / 2.5, 1, 1000) : 1);
      yield;
    }
    this.status = 'Blast off!';
    this.tip('Now! Full power!', 'Now! Hold GO!', this.coach ? CUE : {});
    this.warp = 1;
    const dv0 = f.dvUsed;
    const hopBody = plan.hop.body;
    let checked = 0;
    while (true) {
      const ok = this.aim(this.prograde() + dir, 0.2);
      this.setThrottle(ok ? 1 : 0);
      const used = f.dvUsed - dv0;
      if (this.coach && f.state.t > plan.tb + 20 && used < dvAbs * 0.3) {
        this.say('Oh! We missed the moment. Let\'s find the next one.');
        this.marker = null;
        return false;
      }
      if (this.coach) {
        // Kids let go a moment late, so call "stop" a little early: check where we'd be
        // after another ~0.3 s of burning.
        if (used >= dvAbs * 0.5) {
          const extra = f.stats.accel * 0.2;
          const a = f.state.angle;
          const ahead = { ...f.state, vx: f.state.vx + Math.cos(a) * extra, vy: f.state.vy + Math.sin(a) * extra };
          const pred = predict(ahead, { target: hopBody, maxSegments: 3, maxTime: 40000 });
          if (arrivalScore(pred, hopBody, f.state.t) < 1000 || used > dvAbs * 1.25) break;
        }
      } else if (used >= dvAbs * 0.97) {
        // Close the loop: stop as soon as the prediction reaches our goal.
        if (checked++ % 3 === 0) {
          const pred = predict(f.state, { target: hopBody, maxSegments: 3, maxTime: 40000 });
          if (arrivalScore(pred, hopBody, f.state.t) < 1000 || used > dvAbs * 1.25) break;
        }
      }
      yield;
    }
    this.setThrottle(0);
    if (this.coach) this.say(`Let go! We're on our way to ${hopBody.name}!`, CUE);
    this.marker = null;
    return true;
  }

  *coastTo(dest) {
    const f = this.flight;
    this.status = `Flying to ${dest.name}`;
    let corrections = 0;
    let lastCheck = -Infinity;
    let frames = 0;
    let engineOff = 0;
    let pred = null;
    let lastBody = f.state.body;
    while (f.state.body !== dest) {
      if (f.state.crashed) return false;
      const s = f.state;
      if (dest.comet && s.body === dest.parent && this.cometGap(dest) < CATCH_RANGE) return yield* this.catchComet(dest);
      if (s.body !== lastBody) {
        lastBody = s.body;
        lastCheck = -Infinity;
      }
      // Only judge the path once the engine has been off for a moment (a coached player
      // lets go a little late, and flickers GO while turning).
      engineOff = f.throttle === 0 ? engineOff + 1 : 0;
      if (++frames - lastCheck > 24 && engineOff > 20) {
        lastCheck = frames;
        pred = predict(s, { target: dest, maxSegments: 3, maxTime: 40000 });
        const score = arrivalScore(pred, dest, s.t);
        const first = pred.segments[0];
        const stray = first.end === 'impact' || (first.end === 'encounter' && first.next !== dest);
        const leftHome = !first.closed || stray || s.body.parent === dest || dest.parent === s.body;
        // Still going round and round at home? The push fell a little short: top it up if
        // that's a small push, otherwise plan the whole thing again.
        // Heading close enough to the comet? We'll home in when we get there.
        const good = dest.comet ? score < 1000 : score <= 0.8;
        if (!good && corrections < 6 && (leftHome || score >= 1000)) {
          corrections++;
          const fix = yield* this.planCorrection(dest, score);
          if (!leftHome && !(fix && fix.dv < f.stats.accel && fix.score < 1000)) return false;
          if (fix) yield* this.burnVector(fix);
          this.status = `Flying to ${dest.name}`;
          lastCheck = -Infinity;
          continue;
        }
        if (score >= 1000 && corrections >= 6) return false;
      }
      this.aim(this.prograde());
      const next = pred ? pred.segments[0].t1 - s.t : 10;
      this.warp = this.safeWarp(next > 4 ? clamp(next / 3, 1, 1000) : 1);
      yield;
    }
    return true;
  }

  *planCorrection(dest, baseScore) {
    const f = this.flight;
    this.status = 'Fixing our path';
    this.warp = 1;
    const s = f.state;
    // Plan the push a little ahead, but sooner if something is about to happen.
    const first = predict(s, { maxSegments: 1, maxTime: 40000 }).segments[0];
    const lead = clamp((first.t1 - s.t) * 0.15, 0.3, 3);
    const tb = s.t + lead;
    const at = propagate(s.body.mu, s.x, s.y, s.vx, s.vy, lead);
    const pro = Math.atan2(at.vy, at.vx);
    let best = { score: baseScore * 0.8, dir: 0, dv: 0 };
    let work = 0; // yield every so often so the game keeps animating while we think
    const mags = [0.3, 0.7, 1.5, 3, 6, 12, 20, 32];
    for (let i = 0; i < 16; i++) {
      const dir = pro + (i / 16) * Math.PI * 2;
      for (const dv of mags) {
        const st = { body: s.body, x: at.x, y: at.y, vx: at.vx + dv * Math.cos(dir), vy: at.vy + dv * Math.sin(dir), t: tb };
        const score = arrivalScore(predict(st, { target: dest, maxSegments: 3, maxTime: 40000 }), dest, tb);
        if (score < best.score) best = { score, dir, dv };
      }
      if (++work % 3 === 0) {
        yield;
      }
    }
    return best.dv > 0 ? { angle: best.dir, dv: best.dv, score: best.score } : null;
  }

  *burnVector({ angle, dv }) {
    const f = this.flight;
    this.status = 'Little push';
    // Tiny nudges are too fiddly for small thumbs, so Pip always does these.
    const wasCoach = this.coach;
    if (wasCoach) {
      this.coach = false;
      this.say('I\'ll do this tiny push for you!', CUE);
    }
    let guard = 0;
    while (!this.aim(angle, 0.1) && guard++ < 400) {
      this.setThrottle(0);
      yield;
    }
    const dv0 = f.dvUsed;
    const body = f.state.body;
    while (f.dvUsed - dv0 < dv && f.state.body === body) {
      this.setThrottle(clamp((dv - (f.dvUsed - dv0)) / (f.stats.accel / 60), 0.05, 1));
      this.aim(angle, 0.1);
      yield;
    }
    this.setThrottle(0);
    f.targetAngle = null;
    this.coach = wasCoach;
  }

  *capture(body, announce = true, target = null) {
    const f = this.flight;
    if (body.comet) return yield* this.catchComet(body);
    this.status = `Arriving at ${body.name}`;
    // Chatter: usually Pip is still saying the welcome for this world.
    if (announce) this.say(`We're at ${body.name}!`, { visiting: body, pri: 'chatter' });
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
      // Safety first: Pip steers this bit even when coaching.
      const wasCoach = this.coach;
      if (wasCoach) {
        this.coach = false;
        this.say('Whoa, too low! I\'ll steer us away from the ground!', URGENT);
      }
      while (el.rp < want * 0.95 && f.state.body === body && !f.state.landed) {
        const up = f.upAngle;
        const ok = this.aim(up + el.dir * (Math.PI / 2), 0.25);
        this.setThrottle(ok ? 1 : 0);
        this.warp = 1;
        yield;
        el = f.elements();
      }
      this.setThrottle(0);
      f.targetAngle = null;
      this.coach = wasCoach;
    }

    // Wait for the lowest point, then brake.
    this.status = 'Waiting to slow down';
    let fixes = 0;
    for (let frames = 1; f.state.body === body; frames++) {
      el = f.elements();
      if (el.timeToPe === null) break;
      // A moon drifting into our way before the low point? Steer round it while there's time.
      if (frames % 30 === 0 && fixes < 3) {
        const seg = predict(f.state, { maxSegments: 1, maxTime: 40000 }).segments[0];
        if (seg.end === 'encounter' && seg.t1 < f.state.t + el.timeToPe + 20) {
          fixes++;
          const score = arrivalScore(predict(f.state, { maxSegments: 2, maxTime: 40000 }), body, f.state.t);
          const fix = yield* this.planCorrection(body, score);
          if (fix) yield* this.burnVector(fix);
          this.status = 'Waiting to slow down';
          continue;
        }
      }
      const vPe = Math.abs(el.h) / el.rp;
      const burnT = Math.max(0, vPe - Math.sqrt(body.mu / el.rp)) / f.stats.accel;
      const wait = el.timeToPe - burnT / 2;
      if (wait < 0.3 || (el.e < 1 && el.timeToPe > el.period * 0.9)) break;
      // Already heading out of this world's pull? Brake right now.
      const vr = (f.state.x * f.state.vx + f.state.y * f.state.vy) / f.radius;
      if (vr > 0 && el.ra > body.soi * 0.9) break;
      this.aim(this.prograde() + Math.PI);
      this.warp = this.safeWarp(wait > 5 ? clamp(wait / 3, 1, 1000) : 1);
      yield;
    }
    this.status = 'Slowing down';
    // Push against the difference between our velocity and a round orbit's right here:
    // straight backwards at the low point, and never a dead stop if we brake anywhere else.
    // `low` = the low point we'd like, with the high point right here (default: round).
    const roundOff = (low = f.radius) => {
      const s = f.state, r = f.radius, dir = f.elements().dir;
      const v = Math.sqrt((2 * body.mu * low) / (r * (r + low)));
      const dx = (-s.y / r) * dir * v - s.vx, dy = (s.x / r) * dir * v - s.vy;
      return { angle: Math.atan2(dy, dx), err: Math.hypot(dx, dy) };
    };
    // Small hands let go late, and on a tiny moon that's enough to fall out of the sky,
    // so Pip does the last little bit of braking (or all of it, if it's only a tap).
    const wasCoach = this.coach;
    const tiny = () => roundOff().err < f.stats.accel * 0.5;
    // Right in a moon's path (just climbed out of it)? Don't go round here: drop lower straight away.
    const inMoonPath = body.children.some((c) => !c.isAncestorOf(target ?? body) && f.radius > c.periapsis - c.soi * 1.5 && f.radius < c.apoapsis + c.soi * 1.5);
    if (inMoonPath) {
      // Pip's "Moving closer" below does it all.
    } else if (this.coach && tiny()) {
      this.coach = false;
      this.say('I\'ll do this tiny push for you!', CUE);
    } else {
      this.tip('Slow down, rocket!', 'Point backwards to the arrow and hold GO to slow down, or we\'ll zoom right past!', this.coach ? CUE : {});
    }
    this.warp = 1;
    for (let guard = 0; !inMoonPath && guard < 60 * 60 && f.state.body === body && !f.state.landed; guard++) {
      const { angle, err } = roundOff();
      if (f.elements().e < 0.03 || err < 0.1) break;
      if (this.coach && err < f.stats.accel * 0.5) {
        this.coach = false;
        this.say(`Let go! We're going around ${body.name}!`, CUE);
      }
      const ok = this.aim(angle, 0.25);
      this.setThrottle(ok ? clamp(err / (f.stats.accel * 0.3), 0.1, 1) : 0);
      yield;
    }
    this.setThrottle(0);
    if (this.coach && !inMoonPath && f.state.body === body) this.say(`Let go! We're going around ${body.name}!`, CUE);

    // Parked way up high, at the edge of this world's pull, or across a moon's path? Drop down
    // to a cosy orbit (lower the low point, then round it off). Pip does this bit even when
    // coaching: there's no good cue for it.
    this.coach = false;
    el = f.elements();
    if (f.state.body === body && (inMoonPath || (el.e < 1 && (el.rp > want * 1.6 || el.ra > body.soi * 0.8 || crossesMoon(body, el, target))))) {
      this.status = 'Moving closer';
      if (el.e > 0.1 && !inMoonPath) yield* this.coastToApsis('ap');
      // Gently, so a tiny moon's slow orbits don't overshoot into the ground.
      const gentle = (err) => clamp(err / (f.stats.accel * 0.3), 0.05, 1);
      // Make this the high point of a path whose low point is where we'd like to be.
      for (let guard = 0; guard < 60 * 60 && f.state.body === body && f.radius > want; guard++) {
        const { angle, err } = roundOff(want);
        if (err < 0.1) break;
        this.setThrottle(this.aim(angle, 0.25) ? gentle(err) : 0);
        yield;
      }
      this.setThrottle(0);
      yield* this.coastToApsis('pe');
      for (let guard = 0; guard < 60 * 60 && f.state.body === body && f.elements().e > 0.03; guard++) {
        const { angle, err } = roundOff();
        if (err < 0.1) break;
        this.setThrottle(this.aim(angle, 0.25) ? gentle(err) : 0);
        yield;
      }
      this.setThrottle(0);
    }
    if (wasCoach) f.targetAngle = null;
    this.coach = wasCoach;
    return true;
  }

  /** How far we are from the comet (from its middle). */
  cometGap(comet) {
    const s = this.flight.state;
    if (s.body === comet) return Math.hypot(s.x, s.y);
    const p = comet.relPos(s.t, this.tmpP ??= {});
    return Math.hypot(s.x - p.x, s.y - p.y);
  }

  /**
   * Catch the comet (#13). It's tiny and, close to Ember, fast, so instead of aiming the whole
   * trip at it, once we're near Pip flies at where it really is (like docking): in towards a
   * cosy height around it, never faster than we could stop, then going round it at orbit
   * speed. Closed-loop, so it works from any near miss, in Ember's space or the comet's.
   * Pip always flies this bit: it's lots of tiny pushes.
   */
  *catchComet(comet, line = 'Comets are tricky to catch! I\'ll steer us in.') {
    const f = this.flight;
    const wasCoach = this.coach;
    this.coach = false;
    this.status = `Catching ${comet.name}`;
    if (line) this.say(line);
    const R = parkingRadius(comet);
    const cp = {}, cv = {};
    let ok = false;
    for (let guard = 0; guard < 60 * 60 * 10; guard++) {
      const s = f.state;
      if (s.crashed || s.landed || (s.body !== comet && s.body !== comet.parent)) break;
      // Where we are and how we're moving compared to the comet.
      let px = s.x, py = s.y, vx = s.vx, vy = s.vy;
      if (s.body !== comet) {
        comet.relPos(s.t, cp);
        comet.relVel(s.t, cv);
        px -= cp.x; py -= cp.y; vx -= cv.x; vy -= cv.y;
      }
      const d = Math.hypot(px, py);
      const ux = px / d, uy = py / d;
      // Go round whichever way we're already going round it.
      const dir = px * vy - py * vx >= 0 ? 1 : -1;
      const gap = d - R;
      // Nice and round: the duck's lumps stick up a long way.
      if (s.body === comet && Math.abs(gap) < R * 0.15 && inStableOrbit(f) && f.elements().e < 0.05) {
        ok = true;
        break;
      }
      // In (or out) towards the cosy height, never faster than we could stop in time...
      const brake = f.stats.accel * 0.25;
      const vIn = Math.min(30, Math.sqrt(2 * brake * Math.abs(gap)), Math.abs(gap) / 12 + 0.2);
      // ...and, once close, going round at orbit speed.
      const near = clamp(1 - gap / (R * 3), 0, 1);
      const vRound = near * Math.sqrt(comet.mu / d) * dir;
      const ex = -ux * Math.sign(gap) * vIn - uy * vRound - vx;
      const ey = -uy * Math.sign(gap) * vIn + ux * vRound - vy;
      const err = Math.hypot(ex, ey);
      if (err > (gap < R ? 0.08 : 0.25)) {
        const aimed = this.aim(Math.atan2(ey, ex), 0.15);
        this.setThrottle(aimed ? clamp(err / (f.stats.accel * 0.3), 0.05, 1) : 0);
        this.warp = 1;
      } else {
        this.setThrottle(0);
        this.aim(Math.atan2(-uy, -ux));
        // Coasting in: speed through the long bit, slowing down for the end.
        this.warp = this.safeWarp(clamp(Math.abs(gap) / (vIn * 10), 1, 30));
      }
      yield;
    }
    this.setThrottle(0);
    f.targetAngle = null;
    this.coach = wasCoach;
    return ok;
  }

  /** Turn a backwards orbit around so we travel the same way as the moons. */
  *flipOrbit(moon) {
    const f = this.flight;
    const body = f.state.body;
    const wasCoach = this.coach;
    this.coach = false;
    this.status = 'Turning around';
    this.say(`We're going around the wrong way! ${moon.name} goes the other way. I'll turn us around.`);
    const want = moon.orbitDir;
    for (let guard = 0; guard < 60 * 60 && f.state.body === body; guard++) {
      const s = f.state;
      const r = f.radius;
      const vc = Math.sqrt(body.mu / r);
      // Desired: a round orbit going the moons' way.
      const tx = (-s.y / r) * want, ty = (s.x / r) * want;
      const dx = tx * vc - s.vx, dy = ty * vc - s.vy;
      const err = Math.hypot(dx, dy);
      if (err < 1.5) break;
      // Halfway through we're barely going round at all, so lean up to hold our height (a low
      // orbit used to drop right into the ground while turning round).
      const g = body.mu / (r * r);
      const ax = (dx / err) * f.stats.accel + (s.x / r) * g, ay = (dy / err) * f.stats.accel + (s.y / r) * g;
      const ok = this.aim(Math.atan2(ay, ax), 0.2);
      this.setThrottle(ok ? clamp(err / (f.stats.accel * 0.3), 0.1, 1) : 0);
      this.warp = 1;
      yield;
    }
    this.setThrottle(0);
    f.targetAngle = null;
    this.coach = wasCoach;
  }

  *coastToApsis(which) {
    const f = this.flight;
    const body = f.state.body;
    while (f.state.body === body) {
      const el = f.elements();
      const wait = which === 'ap' ? el.timeToAp : el.timeToPe;
      if (wait === null || wait < 0.5 || wait > el.period - 1) break;
      this.aim(this.prograde() + Math.PI);
      this.warp = this.safeWarp(wait > 5 ? clamp(wait / 3, 1, 1000) : 1);
      yield;
    }
    this.warp = 1;
  }
}
