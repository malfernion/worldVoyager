// Headless flights shared by the tests and the stress sweep (tools/stress.mjs):
// the autopilot flying on its own, and a pretend kid following the coach cues.
import { createSystem } from '../src/physics/bodies.js';
import { Flight } from '../src/physics/sim.js';
import { Autopilot, inStableOrbit, parkingRadius } from '../src/physics/autopilot.js';

export const STATS = { accel: 17, turnRate: 1.6, safeSpeed: 8, maxTilt: 0.6 };
export const WORLDS = ['homestead', 'pebble', 'dusty', 'nibble', 'ringo', 'sizzle', 'frosty'];

export function mission(stats = STATS) {
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

/** Put the rocket in a round parking orbit around `world` at time `t`, going the moons' way. */
export function parkAt(m, world, t, angle = 0) {
  const body = m.sys.byId[world];
  const r = parkingRadius(body);
  const v = Math.sqrt(body.mu / r);
  // Clockwise, like every moon (angularSpeed < 0).
  m.flight.state = {
    body, x: r * Math.cos(angle), y: r * Math.sin(angle), vx: v * Math.sin(angle), vy: -v * Math.cos(angle),
    angle: angle - Math.PI / 2, t, landed: false, landAngle: 0, crashed: false, flightTime: 0,
  };
  return m;
}

// A pretend kid: turns toward the arrow with the turn buttons, holds GO when told,
// and reacts a few frames late. `lazy` kids stop pressing GO once they're told to point up.
export function kidFlies(m, mode, target, { lag = 8, lazy = false, maxFrames = 60 * 60 * 40 } = {}) {
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

/**
 * Fly "take me there" from wherever the rocket is to `to` (the pretend kid flies if `coach`).
 * Returns { ok, kind, strays, detail } where kind is one of:
 * ok, moon-crash (hit a world we weren't aiming for), ground-crash, no-path, gave-up, timeout.
 * `strays` counts visits to worlds that aren't on the route (near misses that didn't crash).
 */
export function flyTo(m, to, coach, { maxFrames = 60 * 60 * 40 } = {}) {
  const { sys, flight, ap, log } = m;
  const from = flight.state.body;
  const logStart = log.length;
  const said = [];
  const listen = (e) => e.text && said.push(e.text);
  ap.on(listen);
  const target = sys.byId[to];
  if (coach) kidFlies(m, 'goto', to, { maxFrames });
  else m.run('goto', to, maxFrames);
  ap.listeners = ap.listeners.filter((fn) => fn !== listen);
  const route = new Set([...from.lineage(), ...target.lineage()]);
  const events = log.slice(logStart);
  const strays = events.filter((l) => l.startsWith('soi:') && !route.has(sys.byId[l.split(':')[1]])).length;
  const s = flight.state;
  let kind;
  if (s.crashed) kind = route.has(s.body) ? 'ground-crash' : 'moon-crash';
  else if (ap.active) kind = 'timeout';
  else if (s.body === target && (s.landed || inStableOrbit(flight))) kind = 'ok';
  else if (said.some((l) => l.includes('can\'t find a path'))) kind = 'no-path';
  else kind = 'gave-up';
  const crash = events.filter((l) => l.startsWith('crash')).pop();
  return { ok: kind === 'ok', kind, strays, detail: crash ?? s.body.id };
}

/** One trip from a parking orbit around `from` to `to`, starting at time `t`. */
export function gotoTrip(from, to, t, coach, opts) {
  return flyTo(parkAt(mission(), from, t, t * 0.37), to, coach, opts);
}

/** A long trip from the launch pad through several worlds in a row; stops at the first failure. */
export function tour(worlds, t, coach, opts) {
  const m = mission();
  m.flight.resetToPad(t);
  let r = null;
  let strays = 0;
  for (const to of worlds) {
    r = { ...flyTo(m, to, coach, opts), to };
    strays += r.strays;
    if (!r.ok) break;
  }
  return { ...r, strays };
}
