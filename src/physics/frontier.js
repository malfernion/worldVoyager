// The frontier (#62 stage 4): a sparse, broad, thick belt of icy rocks round Yonder's distance
// (like the Kuiper belt), every rock tumbling, a little lander resting on one of the bigger ones,
// and a handful of "crossers": small rocks on tilted orbits that really cross the flight plane now
// and then. Pure and headless: where everything is and how far it has turned, from the game clock
// (so saves, rewind and warp all agree). The belt and the lander are only the look: the sim,
// prediction and the helpers never see them. The crossers are the one exception, and only in the
// sim: one touching a flying rocket gives it a small nudge (`crosserTouch()`, never a crash), and
// one reaching Yonder or Hither ends there in a puff of ice dust (`crosserHit()`; the flight scene
// draws the puff). How it all looks is src/world/frontier.js; finding the lander is
// discoveries.js (`landerSeen()`).
import { mulberry32 } from './noise.js';

/**
 * The belt: `count` small icy rocks round Ember, from `inner` to `outer` (well inside Yonder's
 * closest, 80,000, and well outside its farthest, 140,000; just past Tumble's sphere, which ends at
 * 63,000), thickest in the middle but broad (two uniforms added: a wide soft hump, not a ring).
 * It's thick and tilted like the real one: each rock's orbit is tilted a little (`tilt`, the
 * spread of its inclination, radians) about its own line of nodes, so rocks sit at many depths,
 * above and below the flight plane, kilometres apart. Only a slab round the plane is kept clear
 * (`slab` metres either side, more than Yonder's radius plus Hither's, beyond each rock's own
 * reach): Yonder, Hither and the rocket pass through the gaps, and no world ever touches a rock.
 * They're split into `sectors` arcs, each drawn round its own middle, so no instance is ever far
 * from its mesh's origin (no float jitter far out) and whole arcs off screen are culled. The belt
 * turns slowly as one, the way Yonder goes round (its mean motion), on the game clock. `size`: a
 * rock's width, small to big.
 * Every rock tumbles about its own axis (`tumbleAngle()`): `spin` turns every `spinT` seconds of
 * game time (a whole number of turns, so the shader only needs the time since the last `spinT`
 * and never loses precision however long the game runs), the small ones fastest (`spin[1]`: about
 * 7 s a turn) and the biggest of them slowest (`spin[0]`: 90 s); the big ones slower still.
 */
export const BELT = {
  count: 6400, inner: 68000, outer: 160000, sectors: 36, tilt: 0.06, slab: 300,
  size: [18, 110], seed: 6204, spinT: 1800, spin: [20, 240],
};
/** The middle of the belt's radii (where each arc's mesh is centred). */
export const BELT_MID = (BELT.inner + BELT.outer) / 2;
/** How far a rock reaches from its middle, in its sizes (lump × stretch; tumbling included). */
export const ROCK_REACH = 0.8;

/**
 * How far a rock has tumbled at game time t (radians): `spin` whole turns every BELT.spinT
 * seconds, from `phase`. The belt's shader works out the same from the time since the last
 * whole spinT (FlightScene passes it; `spinClock()`), so change both together.
 */
export function tumbleAngle(spin, phase, t) {
  return phase + (2 * Math.PI * spin * spinClock(t)) / BELT.spinT;
}

/** The time since the last whole BELT.spinT (what the belt's shader is given). */
export function spinClock(t) {
  return ((t % BELT.spinT) + BELT.spinT) % BELT.spinT;
}

/** A random unit axis from two uniforms (deterministic with the plan's seed). */
function axisOf(u, v) {
  const z = 2 * u - 1, a = 2 * Math.PI * v, k = Math.sqrt(1 - z * z);
  return [k * Math.cos(a), k * Math.sin(a), z];
}

const unit = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};

// A few bigger ones, for interest, like the Kuiper belt's named worlds: `kind` snowman (two lobes
// stuck together, like Arrokoth), egg (stretched, like Haumea) or round (like Makemake); `a` the
// angle round Ember (at t = 0), `r` from Ember, `z` above (+) or below (-) the flight plane,
// `size` its width (metres; the egg is twice as long, the snowman 1.4 times: `BIG_REACH`), `tint`
// 0 pale ice, 1 reddish tholin, and how it tumbles: `axis`, `spin` (turns per BELT.spinT: 2 to 5
// minutes a turn), `phase`. All smaller than Hither, so none looks like a world.
// The one with `lander` carries the little lander (src/world/frontier.js): a smaller round rock
// (so the lander shows), just below the clear slab (so flying over it shows the lander, and it can
// never touch the rocket), placed just outside the far end of the loop Yonder makes as seen from
// the turning belt (its orbit is stretched, the belt turns at its average speed), so once every
// Yonder year Yonder comes by within about 4.5 km of it and lingers there (tested). It tumbles
// about an axis near the flight plane, so the lander comes over the top to face the cameras.
export const BIG_ROCKS = [
  { kind: 'snowman', a: 0.4, r: 104000, z: -900, size: 110, tint: 1, axis: [0.3, 0.8, 0.52], spin: 12, phase: 0.3 },
  { kind: 'round', a: 1.3, r: 125000, z: 2600, size: 130, tint: 0, axis: [-0.6, 0.2, 0.77], spin: 6, phase: 1.1 },
  { kind: 'egg', a: 2.2, r: 92000, z: -1800, size: 80, tint: 0, axis: [0.1, -0.2, 0.97], spin: 15, phase: 2.0 },
  { kind: 'snowman', a: 3.0, r: 118000, z: 1400, size: 95, tint: 1, axis: [0.9, 0.3, 0.3], spin: 10, phase: 0.7 },
  { kind: 'round', a: 2.588, r: 108000, z: -355, size: 60, tint: 1, axis: [0.8, 0.55, 0.2], spin: 8, phase: 0, lander: true },
  { kind: 'egg', a: 4.8, r: 135000, z: -3200, size: 75, tint: 0, axis: [-0.2, 0.9, 0.39], spin: 14, phase: 2.9 },
  { kind: 'snowman', a: 5.6, r: 84000, z: 700, size: 100, tint: 1, axis: [0.5, 0.5, 0.71], spin: 9, phase: 4.1 },
];
for (const b of BIG_ROCKS) b.axis = unit(b.axis);

/** How far each big kind reaches across, in its `size`s. */
export const BIG_REACH = { round: 1.2, egg: 2.0, snowman: 1.4 };

/** The big rock the lander rests on. */
export const LANDER_ROCK = BIG_ROCKS.find((b) => b.lander);

/** Which arc of the belt an angle round Ember (radians) is in. */
export function sectorOf(a) {
  const n = BELT.sectors;
  const u = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return Math.min(n - 1, Math.floor((u / (2 * Math.PI)) * n));
}

let plan = null;
/**
 * Where every small rock is at t = 0 (world coordinates round Ember), deterministic (a fixed
 * seed): { x, y, z, a, r, size, stretch: [sx, sy, sz], turn: [qx, qy, qz, qw], tint (0..1: pale
 * ice to reddish tholin), shade, sector, and its tumble: axis: [x, y, z], spin (whole turns per
 * BELT.spinT), phase }. Made once and shared.
 */
export function beltPlan() {
  if (plan) return plan;
  const rand = mulberry32(BELT.seed);
  const rocks = [];
  for (let i = 0; i < BELT.count; i++) {
    // Broad: two uniforms added, from inner to outer exactly.
    const r = BELT.inner + (BELT.outer - BELT.inner) * ((rand() + rand()) / 2);
    const a = rand() * Math.PI * 2;
    const u = rand();
    const size = BELT.size[0] + (BELT.size[1] - BELT.size[0]) * u * u * u;
    // Its tilted orbit: a small inclination (a bell curve, three uniforms added) about its own
    // line of nodes; then the clear slab round the flight plane, beyond its own reach.
    const incl = BELT.tilt * (rand() + rand() + rand() - 1.5) / 0.5;
    const node = rand() * Math.PI * 2;
    const z0 = r * Math.sin(incl) * Math.sin(a - node);
    const z = (z0 < 0 ? -1 : 1) * (Math.abs(z0) + BELT.slab + size * ROCK_REACH);
    const stretch = [0.75 + rand() * 0.6, 0.6 + rand() * 0.45, 0.75 + rand() * 0.5];
    // A random turn (a unit quaternion, uniform).
    const u1 = rand(), u2 = rand() * Math.PI * 2, u3 = rand() * Math.PI * 2;
    const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
    const turn = [s1 * Math.sin(u2), s1 * Math.cos(u2), s2 * Math.sin(u3), s2 * Math.cos(u3)];
    // About a third reddish-brown tholin, the rest grey and bluish ice.
    const tint = rand() < 0.35 ? 0.6 + rand() * 0.4 : rand() * 0.3;
    const shade = rand();
    // Its tumble: a random axis; the smaller, the faster (with a little scatter), whole turns.
    const axis = axisOf(rand(), rand());
    const f = (size - BELT.size[0]) / (BELT.size[1] - BELT.size[0]);
    const spin = Math.max(BELT.spin[0], Math.round(BELT.spin[1] + (BELT.spin[0] - BELT.spin[1]) * Math.sqrt(f) * (0.8 + 0.4 * rand())));
    const phase = rand() * Math.PI * 2;
    rocks.push({ x: r * Math.cos(a), y: r * Math.sin(a), z, a, r, size, stretch, turn, tint, shade, sector: sectorOf(a), axis, spin, phase });
  }
  plan = rocks;
  return plan;
}

/** The middle of sector `i` (world coordinates at t = 0, on the belt's middle radius). */
export function sectorMiddle(i, out = { x: 0, y: 0 }) {
  const a = ((i + 0.5) / BELT.sectors) * Math.PI * 2;
  out.x = BELT_MID * Math.cos(a);
  out.y = BELT_MID * Math.sin(a);
  return out;
}

/** How far round the belt has turned by game time t (radians; Yonder's mean motion, clockwise). */
export function beltTurn(system, t) {
  return system.byId.yonder.angularSpeed * t;
}

/**
 * The lander's rock at game time t: where its middle is (world coordinates: the belt turned, plus
 * its z) and how far it has tumbled (`angle` about `axis`), into `out`. The lander itself sits on
 * its ground (src/world/frontier.js works out where; `landerSeen()` in discoveries.js finds it).
 */
export function landerRockAt(system, t, out = {}) {
  const b = LANDER_ROCK;
  const a = b.a + beltTurn(system, t);
  out.x = b.r * Math.cos(a);
  out.y = b.r * Math.sin(a);
  out.z = b.z;
  out.angle = tumbleAngle(b.spin, b.phase, t);
  out.axis = b.axis;
  return out;
}

// ---- The crossers: the odd real collision, not a dodging game ------------------------------------
//
// A handful of small rocks on their own tilted, round orbits round Ember (clockwise, like
// everything), each crossing the flight plane twice a lap at its two nodes (fixed points: `R` from
// Ember along `node`, and opposite). `incl` its tilt, `rate` its angular speed (Kepler's for its
// radius, from Ember's pull), `u0` how far along from its node it is at t = 0. Two are set up to
// meet a world: one in a 3:2 beat with Yonder (like the real Plutinos with Neptune: three of its
// laps to Yonder's two), crossing the plane exactly where Yonder is as it heads out past that
// distance in its first year (about t = 3,800), and so again every two Yonder years; one crossing
// where Hither is at `CROSS.meetHither` (once; after that only by chance). The rest (`count` in
// all) cross in empty space. A crosser that reaches a world is gone, in a puff
// of ice dust, until the far point of that lap (a quarter lap later, far off the plane).
// `size`: its width; `bump`: the nudge a rocket gets from one (m/s); `rocket`: the rocket's reach.
export const CROSS = { count: 20, meetHither: 12000, incl: 0.25, bump: 2.5, rocket: 4 };

const tmpA = { x: 0, y: 0 }, tmpB = { x: 0, y: 0 };

/** A world's position round Ember at time t, into `out` (no allocation; worlds are one or two deep). */
export function worldOf(body, t, out) {
  out.x = 0; out.y = 0;
  for (let b = body; b.parent; b = b.parent) {
    b.relPos(t, tmpA);
    out.x += tmpA.x; out.y += tmpA.y;
  }
  return out;
}

let crossCache = null;
/**
 * The crossers for this solar system (made once: the orbits of the worlds never change). Each:
 * { id, R, node, incl, rate, u0, size, tint, axis, spin, phase }.
 */
export function crossers(system) {
  if (crossCache) return crossCache;
  const ember = system.byId.ember, yonder = system.byId.yonder, hither = system.byId.hither;
  const kepler = (R) => -Math.sqrt(ember.mu / R ** 3);
  // A crosser through world position p at time t: its node there, descending (coming down from
  // the cameras' side, so a hit shows from orbit).
  const through = (id, p, t, rate, extra) => {
    const R = Math.hypot(p.x, p.y);
    return { id, R, node: Math.atan2(p.y, p.x), incl: CROSS.incl, rate: rate ?? kepler(R), u0: -(rate ?? kepler(R)) * t, ...extra };
  };
  // 3:2 with Yonder: three laps to its two, so its radius is Yonder's average times (2/3)^(2/3),
  // on Yonder's path where Yonder is that far from Ember (heading out after its closest).
  const P = yonder.orbitalPeriod;
  const Ra = yonder.orbitRadius * (2 / 3) ** (2 / 3);
  let t1 = 0;
  for (let t = 0, last = null; t < P; t += 1) {
    const d = Math.hypot(yonder.relPos(t, tmpA).x, tmpA.y) - Ra;
    if (last !== null && last < 0 && d >= 0 && t > 0) { t1 = t; break; }
    last = d;
  }
  // (Refine to where Yonder is exactly Ra out, so the beat is exact.)
  let lo = t1 - 1, hi = t1;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (Math.hypot(yonder.relPos(mid, tmpA).x, tmpA.y) < Ra) lo = mid; else hi = mid;
  }
  t1 = hi;
  const pa = { ...yonder.relPos(t1, {}) };
  const list = [
    through(0, pa, t1, (-3 / 2) * (2 * Math.PI) / P, { size: 26, tint: 0.2 }),
    through(1, worldOf(hither, CROSS.meetHither, {}), CROSS.meetHither, undefined, { size: 22, tint: 0.8 }),
  ];
  // The rest cross in empty belt (fixed seeds).
  const rand = mulberry32(6262);
  for (let i = 2; i < CROSS.count; i++) {
    const R = 76000 + rand() * 70000, node = rand() * Math.PI * 2, rate = kepler(R);
    list.push({ id: i, R, node, incl: 0.12 + rand() * 0.2, rate, u0: rand() * Math.PI * 2, size: 16 + rand() * 12, tint: rand() });
  }
  for (const c of list) {
    c.meetsYonder = c.id === 0 ? t1 : null;
    c.axis = axisOf(rand(), rand());
    c.spin = 40 + Math.floor(rand() * 60);
    c.phase = rand() * Math.PI * 2;
  }
  crossCache = list;
  return list;
}

/** How far along its orbit (radians from its node) crosser c is at time t. */
const along = (c, t) => c.u0 + c.rate * t;

/** Crosser c's place and velocity at time t (world coordinates round Ember), into `out`. */
export function crosserPos(c, t, out = {}) {
  const u = along(c, t);
  const cn = Math.cos(c.node), sn = Math.sin(c.node), ci = Math.cos(c.incl), si = Math.sin(c.incl);
  const cu = Math.cos(u), su = Math.sin(u);
  // Node direction N = (cn, sn, 0); across it in the tilted plane M = (-sn ci, cn ci, si).
  out.x = c.R * (cu * cn - su * sn * ci);
  out.y = c.R * (cu * sn + su * cn * ci);
  out.z = c.R * su * si;
  const w = c.R * c.rate;
  out.vx = w * (-su * cn - cu * sn * ci);
  out.vy = w * (-su * sn + cu * cn * ci);
  out.vz = w * cu * si;
  return out;
}

/** The k-th time crosser c passes through the flight plane (u = kπ; k counts down as it goes). */
export function passTime(c, k) {
  return (k * Math.PI - c.u0) / c.rate;
}

/** Which plane crossing crosser c most recently made by time t (its k). */
function lastPass(c, t) {
  return Math.ceil(along(c, t) / Math.PI);
}

const hitMemo = new Map();
const tmpP = { x: 0, y: 0, z: 0 }, tmpW = { x: 0, y: 0 };
/**
 * Did crosser c reach Yonder or Hither on its k-th plane crossing? { t (the moment it touched),
 * body, x, y, z (where, round that world's middle, in the flight's frame: not turned with its
 * ground) } or null. Pure (worked out once per crossing and remembered).
 */
export function crosserHit(system, c, k) {
  const key = c.id * 1e9 + k;
  if (hitMemo.has(key)) return hitMemo.get(key);
  let hit = null;
  const tk = passTime(c, k);
  const vz = Math.abs(c.R * c.rate * Math.sin(c.incl));
  for (const body of [system.byId.yonder, system.byId.hither]) {
    const reach = body.radius + (c.size * ROCK_REACH);
    crosserPos(c, tk, tmpP);
    worldOf(body, tk, tmpW);
    // Only if the world is anywhere near where it crosses (both move a few tens of m/s).
    if (Math.hypot(tmpP.x - tmpW.x, tmpP.y - tmpW.y) > reach + 80 * (reach / vz + 30)) continue;
    const span = reach / vz + 30;
    const gap = (t) => {
      crosserPos(c, t, tmpP);
      worldOf(body, t, tmpW);
      return Math.hypot(tmpP.x - tmpW.x, tmpP.y - tmpW.y, tmpP.z) - reach;
    };
    for (let t = tk - span; t < tk + span; t += 0.25) {
      if (gap(t) > 0) continue;
      let lo = t - 0.25, hi = t;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (gap(mid) > 0) lo = mid; else hi = mid;
      }
      if (!hit || hi < hit.t) {
        crosserPos(c, hi, tmpP);
        worldOf(body, hi, tmpW);
        const dx = tmpP.x - tmpW.x, dy = tmpP.y - tmpW.y, dz = tmpP.z, l = Math.hypot(dx, dy, dz);
        hit = { t: hi, body, x: (dx / l) * body.radius, y: (dy / l) * body.radius, z: (dz / l) * body.radius, crosser: c.id };
      }
      break;
    }
  }
  hitMemo.set(key, hit);
  return hit;
}

/**
 * Is crosser c there at time t, or gone after reaching a world (from the moment it touched until
 * the far point of that lap, a quarter lap after the crossing)?
 */
export function crosserShown(system, c, t) {
  const k = lastPass(c, t);
  for (const kk of [k, k - 1]) {
    const hit = crosserHit(system, c, kk);
    if (hit && t >= hit.t && t < passTime(c, kk - 0.5)) return false;
  }
  return true;
}

/**
 * Every rock reaching Yonder or Hither between game times t0 and t1 (t0 < t, t <= t1): the falls
 * (about one every IMPACT.gap) and the crossers', each passed to `fn(hit)` (a fall's `hit` is
 * reused: copy it to keep it): for the flight scene's puffs of ice dust. Only looks at the falls
 * and crossings in that window.
 */
export function crosserHitsBetween(system, t0, t1, fn) {
  if (!(t1 > t0)) return;
  // The falls onto Yonder and Hither (below): one about every IMPACT.gap.
  for (let k = Math.floor(t0 / IMPACT.gap) - 1; k <= Math.floor(t1 / IMPACT.gap) + 1; k++) {
    const f = impactor(system, k, fallTmp);
    if (f.t > t0 && f.t <= t1) fn(f.hit);
  }
  for (const c of crossers(system)) {
    const k0 = lastPass(c, t0), k1 = lastPass(c, t1);
    // Crossings from just before t0 (a hit can come a little before its crossing) to just after t1.
    for (let k = k0 + 1; k >= k1 - 1; k--) {
      const hit = crosserHit(system, c, k);
      if (hit && hit.t > t0 && hit.t <= t1) fn(hit);
    }
  }
}

const touchP = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }, touchW = { x: 0, y: 0 };
/**
 * Does a crosser touch the rocket at (x, y) in `body`'s space at time t? Returns the crossing's
 * key (one nudge per crossing) and, in `out`, the nudge's direction (unit, in the flight plane:
 * away from the rock), or -1. Cheap unless a crosser is right at the plane: its height first.
 */
export function crosserTouch(system, body, x, y, t, out) {
  const list = crossers(system);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const reach = c.size * ROCK_REACH + CROSS.rocket;
    if (Math.abs(c.R * Math.sin(along(c, t)) * Math.sin(c.incl)) > reach) continue;
    crosserPos(c, t, touchP);
    worldOf(body, t, touchW);
    const dx = touchW.x + x - touchP.x, dy = touchW.y + y - touchP.y;
    if (Math.hypot(dx, dy, touchP.z) > reach) continue;
    if (!crosserShown(system, c, t)) continue;
    const l = Math.hypot(dx, dy);
    if (l > 1e-6) {
      out.x = dx / l; out.y = dy / l;
    } else {
      const v = Math.hypot(touchP.vx, touchP.vy) || 1;
      out.x = -touchP.vy / v; out.y = touchP.vx / v;
    }
    return c.id * 1e9 + Math.round(along(c, t) / Math.PI); // (its nearest crossing: one nudge each)
  }
  return -1;
}

// ---- The falls: a rock landing on Yonder (or now and then Hither) about every ten minutes -------
//
// The owner wanted Yonder's impacts about every ten minutes of game time, far more often than any
// orbit round Ember could line up. So the falls are slots on the game clock: fall k lands at about
// k × `gap` (give or take `jitter`, so the gaps are 7 to 13 minutes), a small rock seen coming down
// out of the belt for the last `lead` seconds, on a straight line in its world's (not turning)
// frame, from high above the flight plane, at `speed` m/s, onto a spot on the side the cameras see
// (`lat`: its height up the world, as a share of the radius, from lat[0] to lat[1], so never on the
// landing strip by the flight plane, and the rock never reaches the plane: a rocket, landed or
// flying, and the buggy are never touched; the puff is only the look). About one in `hither` lands
// on Hither instead. Pure: each fall comes from a hash of k.
export const IMPACT = { gap: 600, jitter: 90, lead: 240, speed: [12, 20], lat: [0.55, 0.95], hither: 8, size: [14, 26] };

/** A number in [0, 1) from integers k and i (a small integer hash: no allocation, the same every time). */
function hash(k, i) {
  let h = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fallTmp = { hit: {} };
/**
 * Fall k, into `out`: { k, t (the moment it lands), body, nx, ny, nz (the spot, a unit direction
 * from the world's middle, in the flight's frame), ux, uy, uz (which way it came from, unit),
 * speed, size, hit (as crosserHit()'s: { t, body, x, y, z, crosser: 'fall' }) }.
 */
export function impactor(system, k, out = { hit: {} }) {
  const I = IMPACT;
  out.k = k;
  out.t = (k + 0.5) * I.gap + (hash(k, 1) - 0.5) * 2 * I.jitter;
  out.body = hash(k, 2) * I.hither < 1 ? system.byId.hither : system.byId.yonder;
  const z = I.lat[0] + (I.lat[1] - I.lat[0]) * hash(k, 3), a = 2 * Math.PI * hash(k, 4), h = Math.sqrt(1 - z * z);
  out.nx = h * Math.cos(a); out.ny = h * Math.sin(a); out.nz = z;
  // Coming down steeply from above, leaning out over the spot a little and a little sideways.
  const b = 2 * Math.PI * hash(k, 5);
  let ux = out.nx * 0.5 + 0.3 * Math.cos(b), uy = out.ny * 0.5 + 0.3 * Math.sin(b), uz = out.nz * 0.5 + 0.8;
  const l = Math.hypot(ux, uy, uz);
  out.ux = ux / l; out.uy = uy / l; out.uz = uz / l;
  out.speed = I.speed[0] + (I.speed[1] - I.speed[0]) * hash(k, 6);
  out.size = I.size[0] + (I.size[1] - I.size[0]) * hash(k, 7);
  const R = out.body.radius;
  const hit = out.hit;
  hit.t = out.t; hit.body = out.body; hit.x = out.nx * R; hit.y = out.ny * R; hit.z = out.nz * R; hit.crosser = 'fall';
  return out;
}

const fallW = { x: 0, y: 0 };
/**
 * Where fall `f` (impactor()'s) is at time t (world coordinates round Ember, into `out`), or null
 * if it isn't there (before its last `lead` seconds, or landed).
 */
export function fallPos(f, t, out) {
  if (t < f.t - IMPACT.lead || t >= f.t) return null;
  worldOf(f.body, t, fallW);
  const r = f.body.radius + f.size * ROCK_REACH, s = f.speed * (f.t - t);
  out.x = fallW.x + f.nx * r + f.ux * s;
  out.y = fallW.y + f.ny * r + f.uy * s;
  out.z = f.nz * r + f.uz * s;
  return out;
}
