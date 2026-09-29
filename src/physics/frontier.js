// The frontier (#62 stage 4): the icy-rock belt round Yonder's distance (like the Kuiper belt),
// every rock tumbling, and a little lander resting on one of the bigger ones. Pure and headless:
// where everything is and how far it has turned, from the game clock (so saves, rewind and warp
// all agree). None of it is a physics body: the sim, prediction and the helpers never see it, so
// it can never crash the rocket or bend a path. How it looks is src/world/frontier.js; finding the
// lander is discoveries.js (`landerSeen()`).
import { mulberry32 } from './noise.js';

/**
 * The belt: `count` small icy rocks in a ring round Ember, `inner` to `outer` from it (Yonder's
 * closest and farthest), thickest round `mid` (Yonder's average), all a little behind the flight
 * plane (`zNear` to `zFar` below it, plus most of their size: all of each rock is behind
 * the flight plane by more than their own size, so never in front of the rocket). They're split into `sectors` arcs, each
 * drawn round its own middle, so no instance is ever far from its mesh's origin (no float jitter
 * far out) and whole arcs off screen are culled. The ring turns slowly as one, the way Yonder goes
 * round (its mean motion), on the game clock. `size`: a rock's width, small to big.
 * Near Yonder the rocks shrink away (`clear`, metres from its middle: gone inside the first, full
 * size past the second): out of the way of Yonder and Hither (1,600 out, radius 85), so no rock
 * is ever drawn inside a world (no other world comes within 20,000 of the belt).
 * Every rock tumbles about its own axis (`tumbleAngle()`): `spin` turns every `spinT` seconds of
 * game time (a whole number of turns, so the shader only needs the time since the last `spinT`
 * and never loses precision however long the game runs), the small ones fastest (`spin[1]`: about
 * 7 s a turn) and the biggest of them slowest (`spin[0]`: 90 s); the big ones slower still.
 */
export const BELT = {
  count: 7000, inner: 80000, outer: 140000, mid: 110000, sectors: 36,
  zNear: 15, zFar: 700, size: [18, 110], seed: 6204, clear: [2200, 3400],
  spinT: 1800, spin: [20, 240],
};

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

/** A random unit axis from three uniforms (deterministic with the plan's seed). */
function axisOf(u, v) {
  const z = 2 * u - 1, a = 2 * Math.PI * v, k = Math.sqrt(1 - z * z);
  return [k * Math.cos(a), k * Math.sin(a), z];
}

// A few bigger ones, for interest, like the Kuiper belt's named worlds: `kind` snowman (two lobes
// stuck together, like Arrokoth), egg (stretched and spinning, like Haumea) or round (like
// Makemake); `a` the angle round Ember (at t = 0), `r` from Ember, `z` behind the plane, `size`
// its width (metres; the egg is twice as long, the snowman 1.4 times: `BIG_REACH`), `tint` 0 pale
// ice, 1 reddish tholin, and how it tumbles: `axis`, `spin` (turns per BELT.spinT: 2 to 5
// minutes a turn), `phase`. All smaller than Hither, so none looks like a world.
// The one with `lander` carries the little lander (src/world/frontier.js): a smaller round rock
// (so the lander shows) placed just outside the far end of the loop Yonder makes as seen from the
// turning belt (its orbit is stretched, the belt turns at its average speed), so once every
// Yonder year Yonder comes by within about 4.5 km of it and lingers there (tested).
export const BIG_ROCKS = [
  { kind: 'snowman', a: 0.4, r: 104000, z: -100, size: 110, tint: 1, axis: [0.3, 0.8, 0.52], spin: 12, phase: 0.3 },
  { kind: 'round', a: 1.3, r: 118000, z: -100, size: 130, tint: 0, axis: [-0.6, 0.2, 0.77], spin: 6, phase: 1.1 },
  { kind: 'egg', a: 2.2, r: 97000, z: -100, size: 80, tint: 0, axis: [0.1, -0.2, 0.97], spin: 15, phase: 2.0 },
  { kind: 'snowman', a: 3.0, r: 113000, z: -90, size: 95, tint: 1, axis: [0.9, 0.3, 0.3], spin: 10, phase: 0.7 },
  { kind: 'round', a: 2.588, r: 108000, z: -70, size: 60, tint: 1, axis: [0.35, -0.5, 0.79], spin: 8, phase: 0, lander: true },
  { kind: 'egg', a: 4.8, r: 108000, z: -95, size: 75, tint: 0, axis: [-0.2, 0.9, 0.39], spin: 14, phase: 2.9 },
  { kind: 'snowman', a: 5.6, r: 92000, z: -95, size: 100, tint: 1, axis: [0.5, 0.5, 0.71], spin: 9, phase: 4.1 },
];
for (const b of BIG_ROCKS) {
  const l = Math.hypot(...b.axis);
  b.axis = b.axis.map((x) => x / l);
}

/** The big rock the lander rests on. */
export const LANDER_ROCK = BIG_ROCKS.find((b) => b.lander);

/** How far each big kind reaches across, in its `size`s. */
export const BIG_REACH = { round: 1.2, egg: 2.0, snowman: 1.4 };

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
  const half = (BELT.outer - BELT.inner) / 2;
  const rocks = [];
  for (let i = 0; i < BELT.count; i++) {
    // Thickest in the middle: three uniforms added (a soft hump), from inner to outer exactly.
    const r = BELT.mid + half * ((rand() + rand() + rand() - 1.5) / 1.5);
    const a = rand() * Math.PI * 2;
    const k = rand();
    const u = rand();
    const size = BELT.size[0] + (BELT.size[1] - BELT.size[0]) * u * u * u;
    const z = -(BELT.zNear + size * 0.8 + (BELT.zFar - BELT.zNear) * k * k);
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
