// Pip's friends, the space band (#16): five little critters camped by campfires on five worlds,
// each playing an instrument. Find them all to bring the band together at Homestead's campfire.
// Where they are, what counts as saying hello, and how loud each one's part is from where you
// are live here (pure and headless, so it's tested). How they look: src/world/landmarks.js and
// src/world/friendMesh.js; how they sound: the friends' parts in src/audio/audio.js; their
// stickers and Pip's lines: src/progress.js (STICKERS, keyed by the same ids).
//
// Pip is the band's banjo player and is always with us, so the sequencer's banjo is Pip's part.
import { dirOf } from './terrain.js';
import { groundPoint } from './discoveries.js';

// `spot` is where the campfire is (the friend sits beside it). Each one is about 17 m in front
// of the flight plane (towards the camera), clear of the discoveries, vents and dust devils, on
// gentle ground: close enough to land next to, and its glow shows on the world's face from
// low orbit. `part` is their part in the music (src/audio/audio.js).
export const FRIENDS = [
  { id: 'friend-mossy', world: 'pebble', part: 'harmonica', spot: dirOf(2.6, 0.217) },
  { id: 'friend-bolt', world: 'dusty', part: 'drum', spot: dirOf(5.9, 0.079) },
  { id: 'friend-crumb', world: 'nibble', part: 'kalimba', spot: dirOf(1.6, 0.65) },
  { id: 'friend-toasty', world: 'sizzle', part: 'bass', spot: dirOf(0.9, 0.158) },
  { id: 'friend-flurry', world: 'frosty', part: 'whistle', spot: dirOf(1.2, 0.125) },
];

export const FRIEND_BY_ID = Object.fromEntries(FRIENDS.map((f) => [f.id, f]));
export const FULL_BAND = 'full-band';

// Saying hello: the buggy within `buggy` metres of a campfire (over the ground), or the rocket
// landing within `landing` metres (the campfires sit about 17 m in front of the flight plane).
export const REACH = { buggy: 8, landing: 28 };

// How loud a friend's part is (#16), as a gain from 0 to 1 and a brightness (0 muffled .. 1
// clear; the part's low-pass filter follows it).
//   On their world's ground (landed or driving): `quiet` far away, rising to 1 from `far` metres
//   away to `near` (the square of how far along you are: about 0.65 at 40 m, 0.35 at 80 m), and
//   getting less muffled as it does.
//   Flying in their world's space: `quiet` (you hear them drifting in from orbit), swelling a
//   little, to at most `orbit` and still muffled, as you pass over the campfire.
//   At home (on Homestead, or in the workshop): every friend found plays at `home`, all clear;
//   `party` for a while after the Full Band gets together.
//   Anywhere else: silent.
export const HEAR = { near: 8, far: 160, quiet: 0.12, orbit: 0.3, home: 0.55, party: 0.85, solo: 1 };

// The Homestead campfire, by the launch pad (src/world/planets.js launchSite: 8 m to the side,
// 1.5 m towards the camera, on the flat pad ground). Found friends sit round it.
export const HOME_CAMPFIRE = { x: 8, z: 1.5 };

const tmpP = [0, 0, 0];
/** Where a friend's campfire is on their world (world frame, a little above the ground). */
export function campfireAt(body, f, out = [0, 0, 0]) {
  return groundPoint(body, f.spot, 0.5, out);
}

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * How loud friend `f` is from `where`: { body, p: [x, y, z] (world frame of body, or null),
 * ground (landed or driving, not flying), home, party, solo (a friend id) }.
 * found: have we said hello yet? Writes { gain, bright }.
 */
export function friendLevel(f, where, found, out = { gain: 0, bright: 0 }) {
  out.gain = 0;
  out.bright = 0;
  if (where.body && where.body.id === f.world && where.p) {
    const d = dist3(where.p, campfireAt(where.body, f, tmpP));
    // Falls away quickly at first, then gently: clearly louder with every few metres closer.
    const u = 1 - Math.min(1, Math.max(0, (d - HEAR.near) / (HEAR.far - HEAR.near)));
    const k = u * u;
    const top = where.ground ? 1 : HEAR.orbit;
    out.gain = HEAR.quiet + (top - HEAR.quiet) * k;
    out.bright = where.ground ? k : k * 0.2;
  }
  if (found && where.home) {
    const g = where.party ? HEAR.party : HEAR.home;
    if (g > out.gain) out.gain = g;
    out.bright = 1;
  }
  if (found && where.solo === f.id) {
    out.gain = HEAR.solo;
    out.bright = 1;
  }
  return out;
}

/** Every friend's level at once, into `out` (an array kept by the caller: no allocation). */
export function friendLevels(where, has, out) {
  for (let i = 0; i < FRIENDS.length; i++) {
    out[i] ??= { part: FRIENDS[i].part, gain: 0, bright: 0 };
    friendLevel(FRIENDS[i], where, has(FRIENDS[i].id), out[i]);
  }
  return out;
}

/** The friends on one world. */
export function friendsOn(body) {
  return FRIENDS.filter((f) => f.world === body.id);
}

function angleTo(p, dir) {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return Math.acos(Math.min(1, (p[0] * dir.x + p[1] * dir.y + p[2] * dir.z) / l));
}

/** Within `reach` metres of a campfire over the ground, and not flying high above it. */
function nearFire(body, p, f, reach) {
  const q = groundPoint(body, f.spot, 0, tmpP);
  const g = Math.hypot(q[0], q[1], q[2]);
  return angleTo(p, f.spot) * g < reach && Math.abs(Math.hypot(p[0], p[1], p[2]) - g) < 8;
}

/** The buggy at `p` (world frame): which friend not met yet does it say hello to? (id or null) */
export function buggyMeets(body, p, has) {
  for (const f of FRIENDS) {
    if (f.world === body.id && !has(f.id) && nearFire(body, p, f, REACH.buggy)) return f.id;
  }
  return null;
}

/** The rocket touched down at planar angle `angle`: right next to a friend? (id or null) */
export function landingMeets(body, angle, has) {
  const r = body.surfaceAt(angle);
  const p = [Math.cos(angle) * r, Math.sin(angle) * r, 0];
  for (const f of FRIENDS) {
    if (f.world === body.id && !has(f.id) && nearFire(body, p, f, REACH.landing)) return f.id;
  }
  return null;
}

/**
 * The on-planet compass (#15): friends still to meet on this world join the discoveries'
 * targets with a 🎵. Appends to `out` (call discoveryTargets() first, which clears it).
 */
export function friendTargets(body, has, out = []) {
  for (const f of FRIENDS) {
    if (f.world === body.id && !has(f.id)) out.push({ id: f.id, p: campfireAt(body, f), icon: '🎵' });
  }
  return out;
}

/** Has everyone in the band been found? */
export function allFound(has) {
  return FRIENDS.every((f) => has(f.id));
}

/** How many friends have been found. */
export function foundCount(has) {
  return FRIENDS.filter((f) => has(f.id)).length;
}

/** The Homestead campfire's position (world frame of Homestead: the pad is straight up, +y). */
export function homeCampfire(home, out = [0, 0, 0]) {
  const r = home.surfaceAt(Math.PI / 2);
  out[0] = HOME_CAMPFIRE.x;
  out[1] = r;
  out[2] = HOME_CAMPFIRE.z;
  return out;
}

/**
 * Full Band (#16): everyone found, the sticker not yet earned, and we're back on Homestead's
 * ground (landed or driving, anywhere: the band is playing at the campfire by the pad).
 */
export function fullBandReady(has, onHomeGround) {
  return onHomeGround && !has(FULL_BAND) && allFound(has);
}
