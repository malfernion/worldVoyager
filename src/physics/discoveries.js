// Discoveries (#15): little secrets tucked round the solar system, each a real bit of space
// science. Where they are and what finds them lives here (pure and headless, so it's tested);
// how they look is src/world/landmarks.js, and their stickers, Pip's facts and the sticker
// book's hints are in src/progress.js (STICKERS, keyed by the same ids).
//
// Ways to find one:
//   near   the buggy comes within `reach` metres of a spot (or the rocket lands that close)
//   park   the same, but stopped
//   night  parked by a spot that's on the night side (Ember below the horizon)
//   inside the buggy (or a landing) inside a big round area: `angle` radians from the spot
//   devil  the buggy drives through one of Dusty's wandering dust devils
//   gap    the rocket crosses Ringo's ring plane between the clouds and the rings
//   flare  the rocket is close to Ember while it flares
import { dirOf, OBSERVATORY, NIBBLE_CRATER, FROSTY_GLOWS, SIZZLE_VENTS, FLIP_GEYSERS, SPIN_AXES } from './terrain.js';

const biggest = (list) => list.reduce((a, b) => (b.size > a.size ? b : a));
const unit = (x, y, z) => {
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
};

// Sizzle's biggest vent, where the tallest plume rises.
export const BIG_VENT = biggest(SIZZLE_VENTS);

// A little way down each of Flip's dark streaks (the dust the geysers' wind blew away).
export const FLIP_STREAKS = FLIP_GEYSERS.map((v) => unit(v.x + v.wind.x * 0.2, v.y + v.wind.y * 0.2, v.z + v.wind.z * 0.2));

// Dusty's dust devils: each wanders round a small circle (`wander` radians) on the plains at
// `speed` radians a second (about 1.5 m/s: easy to catch), on the scene clock, which the
// visuals and the finding both use.
export const DUST_DEVILS = [
  { home: dirOf(5.3, 0.35), wander: 0.09, speed: 0.007, phase: 0 },
  { home: dirOf(0.8, 0.4), wander: 0.08, speed: -0.008, phase: 2 },
  { home: dirOf(0.3, -0.3), wander: 0.1, speed: 0.006, phase: 4 },
  { home: dirOf(4.3, 0.45), wander: 0.08, speed: -0.007, phase: 1 },
];

// Ember's solar flares: every `period` seconds (flight time, so time warp speeds them up)
// a flare rises and fades for `last` seconds. Seen from within `reach` × Ember's radius.
export const FLARE = { period: 150, last: 50, reach: 6 };

export const DISCOVERIES = [
  { id: 'find-observatory', world: 'homestead', find: 'near', spots: [OBSERVATORY], reach: 9 },
  { id: 'find-footprints', world: 'pebble', find: 'near', spots: [dirOf(4.0, -0.35)], reach: 7 },
  { id: 'find-mirror', world: 'pebble', find: 'park', spots: [dirOf(1.0, 0.4)], reach: 5 },
  { id: 'find-rover', world: 'dusty', find: 'near', spots: [dirOf(4.5, -0.3)], reach: 7 },
  { id: 'find-dust-devil', world: 'dusty', find: 'devil', reach: 5 },
  { id: 'find-crater', world: 'nibble', find: 'inside', spots: [NIBBLE_CRATER], angle: NIBBLE_CRATER.radius * 0.8 },
  { id: 'find-ring-gap', world: 'ringo', find: 'gap' },
  { id: 'find-plume', world: 'sizzle', find: 'near', spots: [BIG_VENT], reach: 9 },
  { id: 'find-ocean', world: 'frosty', find: 'night', spots: FROSTY_GLOWS, reach: 6 },
  // Huygens (#46): on the pebbly ground by the big lake that crosses Misty's flight plane, just
  // behind the plane (clear of the rocket's strip), about 12 m from the shore.
  { id: 'find-huygens', world: 'misty', find: 'near', spots: [dirOf(2.64, -0.12)], reach: 6 },
  { id: 'find-flare', world: 'ember', find: 'flare' },
  { id: 'find-streak', world: 'flip', find: 'near', spots: FLIP_STREAKS, reach: 8 },
  { id: 'find-philae', world: 'ducky', find: 'near', spots: [dirOf(1.8, -0.5)], reach: 6 },
];

export const DISCOVERY_BY_ID = Object.fromEntries(DISCOVERIES.map((d) => [d.id, d]));

/** The discoveries on one world. */
export function discoveriesOn(body) {
  return DISCOVERIES.filter((d) => d.world === body.id);
}

/** The point on the ground straight "up" `dir` (in the world's own frame), `lift` above it. */
export function groundPoint(body, dir, lift = 0, out = [0, 0, 0]) {
  const t = body.terrainFn;
  const r = body.radius + (t ? t.height(dir.x, dir.y, dir.z) : 0) + lift;
  out[0] = dir.x * r; out[1] = dir.y * r; out[2] = dir.z * r;
  return out;
}

/** Which way Ember is from a world, in the world's frame (x, y; flat in the flight plane). */
const tmpW = {};
export function sunDirection(body, t, out = { x: 1, y: 0, z: 0 }) {
  const w = body.worldPos(t, tmpW);
  const l = Math.hypot(w.x, w.y) || 1;
  out.x = -w.x / l; out.y = -w.y / l; out.z = 0;
  return out;
}

/** Is Ember below the horizon at `dir`? */
export function isNight(dir, toSun) {
  return dir.x * toSun.x + dir.y * toSun.y + dir.z * toSun.z < -0.05;
}

/** Where dust devil `i` is at scene time `time` (a unit direction on Dusty). */
export function devilAt(i, time, out = { x: 0, y: 0, z: 0 }) {
  const d = DUST_DEVILS[i];
  const h = d.home;
  // Two tangents at home, then a small circle round it.
  let e = { x: -h.y, y: h.x, z: 0 };
  const el = Math.hypot(e.x, e.y) || 1;
  e = { x: e.x / el, y: e.y / el, z: 0 };
  const n = { x: h.y * e.z - h.z * e.y, y: h.z * e.x - h.x * e.z, z: h.x * e.y - h.y * e.x };
  const a = d.phase + d.speed * time / d.wander;
  const c = Math.cos(a) * d.wander, s = Math.sin(a) * d.wander;
  const x = h.x + e.x * c + n.x * s, y = h.y + e.y * c + n.y * s, z = h.z + e.z * c + n.z * s;
  const l = Math.hypot(x, y, z);
  out.x = x / l; out.y = y / l; out.z = z / l;
  return out;
}

const tmpDir = { x: 0, y: 0, z: 0 };
const tmpP = [0, 0, 0];

const vecLen = (a) => Math.hypot(a[0], a[1], a[2]);
const tmpU = { x: 0, y: 0, z: 0 };
function unitOf(p) {
  const l = vecLen(p) || 1;
  tmpU.x = p[0] / l; tmpU.y = p[1] / l; tmpU.z = p[2] / l;
  return tmpU;
}

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Within `reach` of the landmark at `dir`, measured over the ground (so a volcano's slope or a
 * crack's depth doesn't count against us), and not flying high above it.
 */
function close(body, p, dir, reach) {
  const r = vecLen(p);
  const g = vecLen(groundPoint(body, dir, 0, tmpP));
  return angleTo(p, dir) * g < reach && Math.abs(r - g) < 8;
}

function angleTo(p, dir) {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return Math.acos(Math.min(1, (p[0] * dir.x + p[1] * dir.y + p[2] * dir.z) / l));
}

/**
 * Does something at `p` (world frame, on or near the ground) find discovery `d`?
 * who: { p, stopped, time, toSun, landing } (landing: it's the rocket touching down).
 */
export function finds(d, body, who) {
  const { p } = who;
  switch (d.find) {
    case 'near':
    case 'park':
    case 'night':
      if (d.find !== 'near' && !who.stopped) return false;
      for (const s of d.spots) {
        if (d.find === 'night' && !isNight(s, who.toSun)) continue;
        if (close(body, p, s, d.reach + (who.landing ? 2 : 0))) return true;
      }
      return false;
    case 'inside': {
      // On the ground in there (flying over it, like the Hopper's orbit, doesn't count).
      const r = Math.hypot(p[0], p[1], p[2]);
      return d.spots.some((s) => angleTo(p, s) < d.angle && r - vecLen(groundPoint(body, unitOf(p), 0, tmpP)) < 4);
    }
    case 'devil': {
      if (who.landing) return false;
      for (let i = 0; i < DUST_DEVILS.length; i++) {
        devilAt(i, who.time, tmpDir);
        const g = groundPoint(body, tmpDir, 0, tmpP);
        // Drive through it: close sideways, and not flying high over the top.
        const r = Math.hypot(p[0], p[1], p[2]);
        const side = Math.sin(angleTo(p, tmpDir)) * r;
        if (side < d.reach && r - Math.hypot(g[0], g[1], g[2]) < 6) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

/**
 * The buggy's turn: which not-yet-found discovery on this world does it find? (id or null)
 * buggy: { p, speed, grounded }; ctx: { time (scene clock), toSun, has(id) }.
 */
export function buggyFinds(body, buggy, ctx) {
  const who = { p: buggy.p, stopped: buggy.grounded && buggy.speed < 1, time: ctx.time, toSun: ctx.toSun, landing: false };
  for (const d of DISCOVERIES) {
    if (d.world === body.id && !ctx.has(d.id) && finds(d, body, who)) return d.id;
  }
  return null;
}

/** The rocket touched down at planar angle `angle`: did it land by (or in) a discovery? */
export function landingFinds(body, angle, ctx) {
  const r = body.surfaceAt(angle);
  const who = { p: [Math.cos(angle) * r, Math.sin(angle) * r, 0], stopped: true, time: ctx.time, toSun: ctx.toSun, landing: true };
  for (const d of DISCOVERIES) {
    if (d.world === body.id && !ctx.has(d.id) && finds(d, body, who)) return d.id;
  }
  return null;
}

/**
 * The on-planet compass: where the secrets still to find on this world are right now, as
 * [{ id, p: [x, y, z], icon }]. Other kinds of target (#16) can be added to the same list.
 * Night-only spots only count while it's night there; dust devils are where they are now.
 */
export function discoveryTargets(body, ctx, out = []) {
  out.length = 0;
  for (const d of DISCOVERIES) {
    if (d.world !== body.id || ctx.has(d.id)) continue;
    if (d.find === 'devil') {
      for (let i = 0; i < DUST_DEVILS.length; i++) out.push({ id: d.id, p: groundPoint(body, devilAt(i, ctx.time)), icon: '✨' });
    } else if (d.spots) {
      for (const s of d.spots) {
        if (d.find === 'night' && !isNight(s, ctx.toSun)) continue;
        out.push({ id: d.id, p: groundPoint(body, s), icon: '✨' });
      }
    }
  }
  return out;
}

/** The closest target to `p` (or null), with its distance. */
export function nearestTarget(targets, p) {
  let best = null, bestD = Infinity;
  for (const t of targets) {
    const d = dist3(t.p, p);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best ? { target: best, dist: bestD } : null;
}

/**
 * Did the rocket just cross Ringo's ring plane in the gap between its clouds and the inner
 * edge of the rings (like Cassini's dives)? Positions are in Ringo's frame, a frame apart.
 * The flight is in the z = 0 plane, so the ring plane meets it along a line through the middle.
 */
export function ringGapCrossed(body, x0, y0, x1, y1) {
  const a = SPIN_AXES[body.id];
  if (!a || !body.rings || body.rings.faint) return false;
  const s0 = x0 * a.x + y0 * a.y, s1 = x1 * a.x + y1 * a.y;
  if (s0 === s1 || (s0 < 0) === (s1 < 0)) return false;
  // Where it crossed: between the two radii (a whole chord would cut the corner at high warp).
  const k = Math.abs(s0) / (Math.abs(s0) + Math.abs(s1));
  const r = Math.hypot(x0, y0) * (1 - k) + Math.hypot(x1, y1) * k;
  return r > body.radius && r < body.radius * body.rings.inner;
}

/** How strongly Ember is flaring at flight time t (0 = not at all, 1 = at its biggest). */
export function flareAt(t) {
  const u = ((t % FLARE.period) + FLARE.period) % FLARE.period;
  return u < FLARE.last ? Math.sin((Math.PI * u) / FLARE.last) : 0;
}

/** Which flare this is (so the visual can pick where it rises). */
export function flareNumber(t) {
  return Math.floor(t / FLARE.period);
}

/** Is the rocket (flight state) close to Ember while it flares, and still in one piece? */
export function flareSeen(state) {
  const b = state.body;
  return b.kind === 'star' && !state.crashed && Math.hypot(state.x, state.y) < b.radius * FLARE.reach && flareAt(state.t) > 0.3;
}
