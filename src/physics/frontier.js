// The frontier (#62 stage 4): the icy-rock belt round Yonder's distance (like the Kuiper belt) and
// a New Horizons-style probe flying past Yonder. Pure and headless: where everything is, from the
// game clock (so saves, rewind and warp all agree). Neither is a physics body: the sim, prediction
// and the helpers never see them, so they can never crash the rocket or bend a path. How they
// look is src/world/frontier.js; finding the probe is discoveries.js (`probeSeen()`).
import { mulberry32 } from './noise.js';

/**
 * The belt: `count` small icy rocks in a ring round Ember, `inner` to `outer` from it (Yonder's
 * closest and farthest), thickest round `mid` (Yonder's average), all a little behind the flight
 * plane (`zNear` to `zFar` below it: never in front of the rocket, and deeper than Yonder's or
 * Hither's radius, so no rock is ever inside a world). They're split into `sectors` arcs, each
 * drawn round its own middle, so no instance is ever far from its mesh's origin (no float jitter
 * far out) and whole arcs off screen are culled. The ring turns slowly as one, the way Yonder goes
 * round (its mean motion), on the game clock. `size`: a rock's width, small to big.
 * Near Yonder the rocks shrink away (`clear`, metres from its middle: gone inside the first, full
 * size past the second): out of the way of Yonder, Hither and the probe's pass.
 */
export const BELT = {
  count: 4800, inner: 80000, outer: 140000, mid: 110000, sectors: 36,
  zNear: 250, zFar: 1800, size: [12, 64], seed: 6204, clear: [2200, 3400],
};

// A few bigger ones, for interest, like the Kuiper belt's named worlds: `kind` snowman (two lobes
// stuck together, like Arrokoth), egg (stretched and spinning, like Haumea) or round (like
// Makemake); `a` the angle round Ember (at t = 0), `r` from Ember, `z` behind the plane, `size`
// its width (metres), `tint` 0 pale ice, 1 reddish tholin.
export const BIG_ROCKS = [
  { kind: 'snowman', a: 0.4, r: 104000, z: -520, size: 150, tint: 1 },
  { kind: 'round', a: 1.3, r: 118000, z: -900, size: 220, tint: 0 },
  { kind: 'egg', a: 2.2, r: 97000, z: -650, size: 200, tint: 0 },
  { kind: 'snowman', a: 3.0, r: 113000, z: -480, size: 130, tint: 1 },
  { kind: 'round', a: 3.9, r: 124000, z: -1100, size: 180, tint: 1 },
  { kind: 'egg', a: 4.8, r: 108000, z: -700, size: 170, tint: 0 },
  { kind: 'snowman', a: 5.6, r: 92000, z: -560, size: 140, tint: 1 },
];

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
 * ice to reddish tholin), shade, sector }. Made once and shared.
 */
export function beltPlan() {
  if (plan) return plan;
  const rand = mulberry32(BELT.seed);
  const half = (BELT.outer - BELT.inner) / 2;
  const rocks = [];
  for (let i = 0; i < BELT.count; i++) {
    // Thickest in the middle: three uniforms added (a soft hump), from inner to outer exactly.
    const r = BELT.mid + half * ((rand() + rand() + rand() - 1.5) / 1.5);
    const a = rand() * Math.PI * 2;
    const k = rand();
    const z = -(BELT.zNear + (BELT.zFar - BELT.zNear) * k * k);
    const u = rand();
    const size = BELT.size[0] + (BELT.size[1] - BELT.size[0]) * u * u * u;
    const stretch = [0.75 + rand() * 0.6, 0.6 + rand() * 0.45, 0.75 + rand() * 0.5];
    // A random turn (a unit quaternion, uniform).
    const u1 = rand(), u2 = rand() * Math.PI * 2, u3 = rand() * Math.PI * 2;
    const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
    const turn = [s1 * Math.sin(u2), s1 * Math.cos(u2), s2 * Math.sin(u3), s2 * Math.cos(u3)];
    // About a third reddish-brown tholin, the rest grey and bluish ice.
    const tint = rand() < 0.35 ? 0.6 + rand() * 0.4 : rand() * 0.3;
    rocks.push({ x: r * Math.cos(a), y: r * Math.sin(a), z, a, r, size, stretch, turn, tint, shade: rand(), sector: sectorOf(a) });
  }
  plan = rocks;
  return plan;
}

/** The middle of sector `i` (world coordinates at t = 0, on the belt's middle radius). */
export function sectorMiddle(i, out = { x: 0, y: 0 }) {
  const a = ((i + 0.5) / BELT.sectors) * Math.PI * 2;
  out.x = BELT.mid * Math.cos(a);
  out.y = BELT.mid * Math.sin(a);
  return out;
}

/** How far round the belt has turned by game time t (radians; Yonder's mean motion, clockwise). */
export function beltTurn(system, t) {
  return system.byId.yonder.angularSpeed * t;
}

/**
 * A rock's size near Yonder (0: gone, 1: full), `d` metres from Yonder's middle in the plane. The
 * belt's shader works out the same (src/world/frontier.js); change both together.
 */
export function beltClear(d) {
  const [a, b] = BELT.clear;
  const k = Math.max(0, Math.min(1, (d - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

/**
 * The probe (like New Horizons): every `period` game seconds it flies past Yonder on a straight
 * line (in Yonder's frame), from `reach` metres before its closest to `reach` after, passing
 * `pass` metres from Yonder's middle (2.2 of Yonder's radii over the ground, well inside its SOI
 * and far from Hither: the pass is always on the side away from where Hither is at the closest,
 * which is Yonder's heart side, as New Horizons' was), `z` behind the flight plane (never in front
 * of the rocket). It heads away from Ember, like the real one leaving the Sun behind. It fades in
 * and out at the ends of each pass (`fade`, a share of `reach`), far from anything, so its jump
 * back to the start is never seen. `radius`: about half its size (metres), for seeing it.
 * Speed: 2 × reach / period = 40 m/s, about three times as fast as a low orbit round Yonder.
 */
export const PROBE = { period: 400, reach: 8000, pass: 550, z: -40, fade: 0.15, radius: 6 };

const tmpY = { x: 0, y: 0 }, tmpH = { x: 0, y: 0 };
/**
 * Where the probe is at game time t: { x, y, z } world coordinates, `k` how much it's shown
 * (0..1: it fades in and out at the ends of a pass), `hx`, `hy` which way it's heading (unit),
 * `sx`, `sy` Yonder's middle (world), `lap` which pass this is, `s` metres along the pass (0 at
 * its closest). Pure: the same t always gives the same place. Into `out`, no allocation.
 */
export function probeAt(system, t, out = {}) {
  const yonder = system.byId.yonder, hither = system.byId.hither;
  const P = PROBE.period;
  const lap = Math.floor(t / P);
  const mid = (lap + 0.5) * P;
  // The pass's line is fixed by where Yonder and Hither are at its closest (mid).
  const h = hither.relPos(mid, tmpH);
  const hl = Math.hypot(h.x, h.y) || 1;
  const vx = -h.x / hl, vy = -h.y / hl; // away from Hither: the side the probe passes
  const w = yonder.relPos(mid, tmpY); // (Yonder goes round Ember itself: relPos is where it is, without worldPos's scratch object)
  const wl = Math.hypot(w.x, w.y) || 1;
  // Along the line, the way that heads away from Ember.
  let ux = -vy, uy = vx;
  if (ux * w.x + uy * w.y < 0) { ux = -ux; uy = -uy; }
  const s = ((t - mid) / P) * 2 * PROBE.reach;
  const ox = vx * PROBE.pass + ux * s, oy = vy * PROBE.pass + uy * s;
  yonder.relPos(t, tmpY);
  out.x = tmpY.x + ox;
  out.y = tmpY.y + oy;
  out.z = PROBE.z;
  out.sx = tmpY.x;
  out.sy = tmpY.y;
  out.hx = ux;
  out.hy = uy;
  out.lap = lap;
  out.s = s;
  const edge = 1 - Math.abs(s) / PROBE.reach; // 1 at the closest, 0 at the ends
  const f = Math.max(0, Math.min(1, edge / PROBE.fade));
  out.k = f * f * (3 - 2 * f);
  out.out = wl; // Yonder's distance from Ember then (for the tests)
  return out;
}
