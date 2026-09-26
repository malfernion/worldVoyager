// Buggy driving: arcade car physics over the full 3D globe of one world.
// Positions are in the world's own frame (the same frame the rocket uses, but with z).
// Gravity is real (pulls toward the centre, so hills and jumps behave), and top speed is
// kept below orbit speed so every jump comes back down.
// The one secret exception: a super hop lets the Hopper orbit tiny Nibble (see ORBIT).
import { DUCKY_JETS } from './terrain.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Rotate v around unit axis k by angle a (Rodrigues). */
const rotate = (v, k, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
};

export const vec = { add, sub, mul, dot, cross, len, norm, rotate };

const STEP = 1 / 120;

// Driving through a sea (#44): the buggy drives along the seabed at any depth. The deeper in
// it is (0 with the wheels just wet, 1 all under), the more the water drags it back, holds it
// up (floaty hops) and slows its motor. The buoyancy stays well under its weight, so it never
// floats off, and it can still climb every beach and seabed slope back out.
export const WATER = {
  cap: 0.5, // top speed, times the land top speed, all under
  accel: 0.65, // motor, times the land one, all under
  lift: 0.45, // buoyancy, as a fraction of gravity, all under
  drag: 0.6, // extra drag (1/s) on every way of moving, all under
  stop: 1.5, // rolling to a stop without GO (1/s; 0.5 on land)
  deep: 1.4, // metres of water over the wheels' bottom that counts as all under
};

// The Nibble orbit secret: going fast, a jump on Nibble is a super hop that leaps forward
// at nearly orbit speed; then holding jump (or tapping it) fires the jets, which steer
// gently towards a round, low orbit until we're falling all the way round.
// Speeds in m/s, accelerations in m/s².
export const ORBIT = {
  world: 'nibble',
  trigger: 0.75, // a jump (tap or held) from this fraction of top speed is a super hop
  hopAhead: 0.75, // super hop: this many times the local circular speed, level with the horizon...
  hopUp: 1.5, // ...plus this much off the ground (a big hop on its own, not quite an orbit)
  // Jets: while jump is held (or for `tap` seconds after each tap) they push, at most `thrust`,
  // towards a round orbit at `height` from the middle: circular speed sideways, climbing or
  // sinking at most `climb`. Nibble's lumps reach about 44, so 46 just clears them.
  height: 46,
  thrust: 0.6,
  climb: 1.5,
  tap: 0.6,
  brake: 2.5, // holding reverse in the air fires them backwards to come down
  // Energy cap: the orbit's semi-major axis never passes maxA, so the highest point (at most
  // 2 × maxA = 100) stays far inside Nibble's sphere of influence (170).
  maxA: 50,
  sag: 0.01, // after a full lap, with the jets off, the orbit slowly sags back down
};

// The Hopper's jets on any world: holding jump in the air fires them for a short boost,
// forwards and a little up, refilled on landing. The air speed cap still applies, so a
// boost can never reach orbit (only the Nibble super hop can).
export const BOOST = {
  time: 1.2, // seconds of jets per hop
  push: 2.5, // forwards, m/s²
  lift: 1.3, // upwards, as a fraction of the world's gravity (a bit more than cancels it)
  wait: 0.35, // held from the ground, the jets start once the jump's cooldown (0.6 s) is down to this: a tap stays a hop
};

// Ducky's gas jets (#13): driving over a vent, the fizzing gas pushes the buggy up and off to
// the side. The push fades out `height` metres above the ground and the airborne speed cap
// still holds (Ducky's gravity is tiny, but 75% of circular speed can never climb higher
// than about 1.4 × the distance from the middle), so the buggy always floats back down.
export const JETS = {
  reach: 0.16, // how far from a vent it pushes (radians round the comet: about 7 m)
  height: 6, // fades out this high above the ground (m)
  push: 2.6, // upwards, right over the vent, in times the local gravity (0.35-1 m/s² on lumpy Ducky)
  side: 0.5, // and this much of it outwards, away from the vent
};
const JET_COS = Math.cos(JETS.reach);

// Driving all the way round the world (#29). Like a real trip round the Earth, it's the angle
// swept round an axis, crossing every line of longitude and coming back. Only the net angle
// counts, so wobbles are fine and driving back and forth (or halfway and back) adds up to
// nothing. We watch three axes at once, square to each other, set where we set off: one is
// square to the way we're facing, so driving "that way" goes round its equator; and any great
// circle keeps well clear of at least one axis's poles (at least 35°), so turning off onto
// some other way round still counts. Near an axis's pole (`cap`) that axis starts
// again. A lap must also cross that axis's equator and be most of the way round in distance
// (`far`), so going round in circles never counts, unless the circle is nearly as big as the world.
export const ROUND = {
  cap: 0.85, // |sin latitude| above this (within about 32° of a pole) starts that axis again
  far: 0.8, // a lap is at least this many times the distance round the equator
};

export class WorldLap {
  constructor() {
    this.axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    this.angle = [0, 0, 0]; // net radians round each axis (either sign)
    this.dist = [0, 0, 0]; // radians travelled while counting round each axis
    this.sides = [0, 0, 0]; // which sides of each axis's equator we've been on (bits: 1 north, 2 south)
    this.last = [0, 0, 0];
    this.reset();
  }

  /** Forget the lap; the next update sets off from wherever we are then. */
  reset() {
    this.started = false;
    this.angle.fill(0);
    this.dist.fill(0);
    this.sides.fill(0);
  }

  /** How far round, 0..1 (the best of the three). */
  get progress() {
    const a = this.angle;
    return Math.min(1, Math.max(Math.abs(a[0]), Math.abs(a[1]), Math.abs(a[2])) / (2 * Math.PI));
  }

  /**
   * Follow the buggy: u is the unit vector from the world's middle, f the way it faces.
   * True when it has just been all the way round (then the next lap starts from here).
   */
  update(u, f) {
    const last = this.last;
    if (!this.started) {
      this.started = true;
      const fw = norm(sub(f, mul(u, dot(f, u))));
      this.axes = [u.slice(), fw, cross(u, fw)];
      last[0] = u[0];
      last[1] = u[1];
      last[2] = u[2];
      return false;
    }
    const step = Math.acos(Math.min(1, dot(last, u)));
    let round = false;
    for (let i = 0; i < 3; i++) {
      const a = this.axes[i];
      const la = dot(last, a), ua = dot(u, a);
      if (Math.abs(ua) > ROUND.cap) {
        this.angle[i] = 0;
        this.dist[i] = 0;
        this.sides[i] = 0;
        continue;
      }
      // The signed angle between the two positions, seen from above this axis's pole.
      this.angle[i] += Math.atan2(dot(cross(last, u), a), dot(last, u) - la * ua);
      this.dist[i] += step;
      this.sides[i] |= ua >= 0 ? 1 : 2;
      if (Math.abs(this.angle[i]) >= 2 * Math.PI && this.sides[i] === 3 && this.dist[i] >= ROUND.far * 2 * Math.PI) round = true;
    }
    last[0] = u[0];
    last[1] = u[1];
    last[2] = u[2];
    if (round) this.reset();
    return round;
  }
}

// Driving back into the rocket (#37). The rocket is solid all round (an obstacle at its foot,
// see DriveMode.deploy), but a box in front of its open garage door takes the buggy in:
// the box covers the lowered ramp (its end is about 2.5 m out, where the buggy would bonk)
// and a generous apron beyond it. The buggy must be on the ground (not hopping or orbiting),
// facing the door (so passing by, or bumping the rocket's side or back, never counts) and not
// driving away; any speed, even stopped, is fine for small drivers.
export const GARAGE = {
  near: 0.5, // the box starts this far in front of the rocket's middle (m)...
  far: 6.5, // ...and reaches this far out (the buggy rolls out to 6 m)
  side: 3, // and this far to either side (the door is 1.3 m wide)
  facing: 0.5, // facing the door within 60°: cos of the angle between forward and "into the door"
  away: 0.5, // backing out of it faster than this (m/s) doesn't count
  ground: 0.5, // wheels at most this high above the ground (m)
  lead: 7, // close by but not in front, the compass leads round to this far in front of the door
  close: 30, // "close by" (m)
};

/**
 * Where p is in front of the garage: `along` (metres out from the rocket through the door; < 0
 * behind it) and `side` (metres to the side), measured flat along the ground at the rocket.
 * foot: the rocket's foot; door: the unit direction the door faces (square to the foot's up).
 */
export function garageSpot(p, foot, door) {
  const u = norm(foot);
  let d = sub(p, foot);
  d = sub(d, mul(u, dot(d, u)));
  const along = dot(d, door);
  return { along, side: len(sub(d, mul(door, along))) };
}

/** Is p in the box in front of the garage door (position only)? */
export function inGarageZone(p, foot, door) {
  const { along, side } = garageSpot(p, foot, door);
  return along >= GARAGE.near && along <= GARAGE.far && side <= GARAGE.side;
}

/**
 * Should this buggy drive into the garage? b: { p, v, f, altitude, orbiting } (a Buggy fits).
 * Pure: whether it has left the box since rolling out is the `Garage` below.
 */
export function atGarage(b, foot, door) {
  if (b.orbiting || b.altitude > GARAGE.ground) return false;
  if (!inGarageZone(b.p, foot, door)) return false;
  return -dot(b.f, door) >= GARAGE.facing && dot(b.v, door) <= GARAGE.away;
}

/**
 * The garage of one parked rocket. The buggy rolls out right in front of the door, so it only
 * counts once the buggy has been outside the box: `update(buggy)` is true on the step it
 * drives in.
 */
export class Garage {
  constructor(foot, door) {
    this.foot = foot;
    this.door = door;
    this.armed = false;
  }

  update(b) {
    if (!this.armed) {
      this.armed = !inGarageZone(b.p, this.foot, this.door);
      return false;
    }
    return atGarage(b, this.foot, this.door);
  }
}

/**
 * Where the compass home points: the rocket, but close by and not in front of the door it
 * points at a spot out in front, so it leads round to the door rather than into the back.
 */
export function homeAim(p, foot, door) {
  const { along } = garageSpot(p, foot, door);
  if (along >= GARAGE.near || len(sub(p, foot)) > GARAGE.close) return foot;
  return add(foot, mul(door, GARAGE.lead));
}

/**
 * Which way to drive from p to reach target, along the ground (#41): the start of the great
 * circle between them, a unit vector level with the ground at p. A straight line to a target
 * well round the world runs through it, so compasses use this instead. Right on the far
 * side every way is as good, so `fallback` (e.g. straight ahead) is used.
 */
export function groundHeading(p, target, fallback) {
  const u = norm(p);
  const d = sub(target, p);
  const t = sub(d, mul(u, dot(d, u)));
  // Nearly opposite: t is tiny and points anywhere. Use the fallback, kept level.
  if (len(t) < 1e-6 * len(d) + 1e-9) {
    const f = sub(fallback, mul(u, dot(fallback, u)));
    return len(f) > 1e-9 ? norm(f) : norm(cross(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  }
  return norm(t);
}

// Trees and rocks: bucketed into a coarse 3D grid once per world, so each substep only looks
// at the few cells around the buggy instead of ~900 trees.
export class ObstacleGrid {
  /** list: [{ p: [x,y,z], r, h }] (r: its own radius, h: how tall it is above p). */
  constructor(list) {
    this.list = list;
    // A cell must span the farthest anything can touch us from: our reach (≤ 2) + r + h.
    this.cell = Math.max(4, ...list.map((o) => o.r + (o.h || 0) + 2));
    this.cells = new Map();
    for (const o of list) {
      const k = this.key(o.p);
      if (!this.cells.has(k)) this.cells.set(k, []);
      this.cells.get(k).push(o);
    }
    this.found = [];
  }

  key(p) {
    const c = this.cell;
    return this.keyOf(Math.floor(p[0] / c), Math.floor(p[1] / c), Math.floor(p[2] / c));
  }

  keyOf(i, j, k) {
    return (i + 1024) * 4194304 + (j + 1024) * 2048 + (k + 1024);
  }

  /** Everything in the 27 cells around p (reuses one array: don't keep it). */
  near(p) {
    const out = this.found;
    out.length = 0;
    const c = this.cell;
    const i = Math.floor(p[0] / c), j = Math.floor(p[1] / c), k = Math.floor(p[2] / c);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (let e = -1; e <= 1; e++) {
          const cell = this.cells.get(this.keyOf(i + a, j + b, k + e));
          if (cell) for (const o of cell) out.push(o);
        }
      }
    }
    return out;
  }
}

export class Buggy {
  constructor(body, kind) {
    this.body = body;
    this.kind = kind;
    this.p = [body.radius, 0, 0];
    this.v = [0, 0, 0];
    this.f = [0, 1, 0]; // forward (kept tangent to the ground)
    this.n = [1, 0, 0]; // ground normal under the wheels
    this.grounded = true;
    this.inWater = false; // wheels in a liquid (#44)
    this.wet = 0; // how deep in: 0 dry .. 1 all under
    this.depth = -Infinity; // metres of liquid above the buggy's middle (negative: above the surface)
    this.distance = 0; // for spinning the wheels
    this.speed = 0;
    this.jumpCooldown = 0;
    this.jumpWasDown = false;
    this.orbiting = false; // in a super hop (the Nibble secret)
    this.jets = false; // the Hopper's jets are firing (a boost, or in a super hop)
    this.jetTime = 0; // a tap keeps the jets going this much longer (s)
    this.airFuel = 0; // seconds of boost left in this hop (the Hopper's jets, see BOOST)
    this.hopSpeed = 0; // forward speed as we last left the ground
    this.boosting = false; // jets on since this press (held jump keeps them going)
    this.lap = 0; // how far round the world we've flown since the super hop (radians)
    this.round = new WorldLap(); // how far round the world we've driven (#29)
    this.obstacles = []; // [{ p: [x,y,z], r, top }] e.g. the parked rocket (r: its own radius, top: its height)
    this.grid = null; // ObstacleGrid of the world's trees or rocks
    this.bumped = 0; // hardest bump since the scene last looked (m/s), and what we hit
    this.bumpedInto = null;
    this.vents = body.comet ? DUCKY_JETS : null; // gas jets that push us around
    this.fizz = 0; // how hard a jet pushed us in the last step (0..1), for the puffs
  }

  /** Top speed on this world: the buggy's own limit, but always well below orbit speed. */
  get topSpeed() {
    const orbit = Math.sqrt(this.body.mu / this.body.radius);
    return Math.min(this.kind.maxSpeed, orbit * 0.7);
  }

  /** Only the Hopper on Nibble knows the secret. */
  get canOrbit() {
    return !!this.kind.superHop && this.body.id === ORBIT.world;
  }

  groundRadius(dir) {
    const t = this.body.terrainFn;
    return this.body.radius + (t ? t.height(dir[0], dir[1], dir[2]) : 0);
  }

  /** Is there liquid over the ground at direction `dir` (#44)? */
  isWater(dir) {
    return this.body.liquidDepth(dir[0], dir[1], dir[2]) > 0;
  }

  /** How deep in the liquid we are at radius r in direction u: sets depth, wet and inWater. */
  soak(r, u) {
    const body = this.body;
    if (!body.liquid || !this.isWater(u)) {
      this.depth = -Infinity;
      this.wet = 0;
      this.inWater = false;
      return;
    }
    this.depth = body.liquidR - r;
    const overWheels = this.depth + this.kind.ride; // above the bottom of the wheels
    this.wet = Math.max(0, Math.min(1, overWheels / WATER.deep));
    this.inWater = overWheels > 0.05;
  }

  /** Ground normal from the terrain around `dir`, using forward `f` for the sample axes. */
  normalAt(dir, f) {
    const e1 = norm(sub(f, mul(dir, dot(f, dir))));
    const e2 = cross(dir, e1);
    const d = 0.8 / this.body.radius;
    const at = (o) => {
      const q = norm(add(dir, o));
      return mul(q, this.groundRadius(q));
    };
    const a = at(mul(e1, d)), b = at(mul(e1, -d)), c = at(mul(e2, d)), e = at(mul(e2, -d));
    let n = norm(cross(sub(a, b), sub(c, e)));
    if (dot(n, dir) < 0) n = mul(n, -1);
    return n;
  }

  /** Put the buggy on the ground at direction `dir`, facing along `forward`. */
  spawn(dir, forward) {
    dir = norm(dir);
    this.p = mul(dir, this.groundRadius(dir) + this.kind.ride);
    this.f = norm(sub(forward, mul(dir, dot(forward, dir))));
    this.n = this.normalAt(dir, this.f);
    this.v = [0, 0, 0];
    this.grounded = true;
    this.round.reset();
  }

  get up() {
    return norm(this.p);
  }

  get altitude() {
    const u = this.up;
    return len(this.p) - this.groundRadius(u) - this.kind.ride;
  }

  /** input: { throttle: -1..1, steer: -1..1 (positive = left), jump: bool } */
  step(dt, input) {
    // A fresh press fires a burst of jets (holding jump keeps them going).
    const press = !!input.jump && !this.jumpWasDown;
    this.jumpWasDown = !!input.jump;
    let left = Math.min(dt, 0.1);
    let first = true;
    while (left > 1e-6) {
      const h = Math.min(STEP, left);
      this.substep(h, input, first && press);
      first = false;
      left -= h;
    }
    this.speed = len(this.v);
    // Driving round the world (#29). Ordinary jumps and gas jets count, but not the Nibble
    // orbit secret (that's flying, with its own sticker): start again wherever we come down.
    if (this.orbiting) this.round.reset();
    else if (this.round.update(this.up, this.f)) this.wentRound = true;
  }

  substep(h, input, press) {
    const k = this.kind;
    const body = this.body;
    let r = len(this.p);
    let u = mul(this.p, 1 / r);
    this.f = norm(sub(this.f, mul(u, dot(this.f, u))));
    const g = body.mu / (r * r);
    this.jumpCooldown = Math.max(0, this.jumpCooldown - h);

    // Gravity always pulls toward the middle of the world (a little less under water: it holds us up).
    this.soak(r, u);
    const w = this.wet;
    this.v = add(this.v, mul(u, -g * (1 - WATER.lift * w) * h));
    if (w > 0) this.v = mul(this.v, Math.exp(-WATER.drag * w * h));

    const ground = this.groundRadius(u) + k.ride;
    // Just after a super hop we're still touching the ground; don't let the tyres grab us back.
    this.grounded = r <= ground + 0.08 && !(this.orbiting && this.jumpCooldown > 0.4);
    if (this.grounded) {
      this.flying = false;
      this.orbiting = false;
    }
    // Gas jets: a fizzy push up and outwards (this counts as flying, so sticky tyres let go).
    this.fizz = 0;
    if (this.vents) {
      for (const v of this.vents) {
        const c = u[0] * v.x + u[1] * v.y + u[2] * v.z;
        if (c < JET_COS) continue;
        const k = (1 - Math.acos(Math.min(1, c)) / JETS.reach) * (1 - Math.min(1, Math.max(0, (r - ground) / JETS.height)));
        if (k <= 0) continue;
        const out = [u[0] - v.x * c, u[1] - v.y * c, u[2] - v.z * c];
        const side = len(out) > 1e-6 ? norm(out) : this.f;
        this.v = add(this.v, mul(add(u, mul(side, JETS.side)), JETS.push * g * k * h));
        this.fizz = Math.max(this.fizz, k);
        if (k > 0.1) this.flying = true;
      }
    }
    // Sticky tyres: on low-gravity moons, don't float off every little bump (real jumps still fly).
    if (!this.grounded && !this.flying && r - ground < 2.5) this.v = add(this.v, mul(u, -Math.max(0, 5 - g) * h));

    if (this.grounded) {
      const n = this.normalAt(u, this.f);
      this.n = n;
      // Hit the ground: bounce a little (monster trucks bounce a lot), otherwise stick.
      let vn = dot(this.v, n);
      if (vn < 0) {
        const bounce = this.inWater ? 0 : vn < -2 ? k.bounce : 0;
        this.v = sub(this.v, mul(n, vn * (1 + bounce)));
        vn = dot(this.v, n);
      }
      const fg = norm(sub(this.f, mul(n, dot(this.f, n))));
      const sg = cross(n, fg);
      let vf = dot(this.v, fg);
      let vs = dot(this.v, sg);

      let cap = this.topSpeed * (1 - (1 - WATER.cap) * w);
      const slope = 1 - dot(n, u);
      const accel = k.accel * (1 + (k.climb || 0) * Math.min(1, slope * 6)) * (1 - (1 - WATER.accel) * w);
      if (input.throttle) {
        const target = input.throttle > 0 ? cap : -cap * 0.5;
        const want = target - vf;
        vf += Math.sign(want) * Math.min(Math.abs(want), accel * h);
      } else {
        vf *= Math.exp(-(this.inWater ? WATER.stop : 0.5) * h); // gently roll to a stop
      }
      if (Math.abs(vf) > cap) vf = Math.sign(vf) * cap;
      // Tyres stop sideways sliding (ice is slippery!).
      const grip = k.grip * (body.id === 'frosty' ? 0.25 : 1);
      vs *= Math.exp(-grip * h);
      this.v = add(add(mul(fg, vf), mul(sg, vs)), mul(n, vn));

      // Steering turns more the faster we roll (and backwards when reversing).
      const roll = Math.min(1, Math.abs(vf) / 2) * Math.sign(vf || 1);
      if (input.steer) this.f = rotate(this.f, n, input.steer * k.turn * h * roll);

      this.airFuel = BOOST.time;
      this.hopSpeed = vf;
      const hop = press || (input.jump && this.jumpCooldown === 0);
      if (hop && this.canOrbit && vf > this.topSpeed * ORBIT.trigger && !this.inWater) {
        // Super hop: going fast, so leap sideways nearly fast enough to fall around Nibble.
        // Level with the horizon (not the slope, so hills don't fling us sky-high), but
        // always leaving the ground (so an uphill doesn't catch us straight away).
        const ahead = Math.sqrt(body.mu / r) * ORBIT.hopAhead;
        this.v = add(mul(this.f, ahead), mul(u, ORBIT.hopUp));
        const off = dot(this.v, n);
        if (off < ORBIT.hopUp) this.v = add(this.v, mul(n, ORBIT.hopUp - off));
        this.jumpCooldown = 0.6;
        this.flying = true;
        this.orbiting = true;
        this.lap = 0;
        this.jumped = true;
        this.superHop = true;
      } else if (input.jump && k.jump && this.jumpCooldown === 0) {
        this.v = add(this.v, mul(n, k.jump));
        this.jumpCooldown = 0.6;
        this.flying = true;
        this.jumped = true;
      }
      this.distance += vf * h;
    }

    this.braking = false;
    this.jets = false;
    if (!input.jump || this.grounded) this.boosting = false;
    if (!this.grounded && !this.orbiting && k.superHop && input.jump) {
      if (this.canOrbit && this.hopSpeed > this.topSpeed * ORBIT.trigger && this.jumpCooldown === 0) {
        // Flying fast off a bump on Nibble (it's lumpy: we're in the air half the time), jump
        // still works: the same super hop as from the ground.
        const ahead = Math.sqrt(body.mu / r) * ORBIT.hopAhead;
        this.v = add(mul(this.f, ahead), mul(u, Math.max(dot(this.v, u), ORBIT.hopUp)));
        this.jumpCooldown = 0.6;
        this.flying = true;
        this.orbiting = true;
        this.lap = 0;
        this.jumped = true;
        this.superHop = true;
      } else if (this.airFuel > 0 && (press || this.jumpCooldown <= BOOST.wait || this.boosting)) {
        // Boost: forwards and a little up, until this hop's jets run out. Held from a jump on
        // the ground, the jets wait a moment (BOOST.wait), so a tap stays an ordinary hop.
        if (press) this.puffed = true;
        this.boosting = true;
        this.jets = true;
        this.flying = true;
        this.airFuel -= h;
        this.v = add(this.v, add(mul(this.f, BOOST.push * h), mul(u, BOOST.lift * g * h)));
      }
    }
    if (this.orbiting) {
      // Jets: hold jump (or tap it) to steer towards a round orbit; hold reverse to come down.
      if (press && !this.grounded) {
        this.jetTime = ORBIT.tap;
        this.puffed = true;
      }
      this.jetTime = Math.max(0, this.jetTime - h);
      if (input.throttle < 0) {
        const vf = dot(this.v, this.f);
        if (vf > 0) this.v = sub(this.v, mul(this.f, Math.min(vf, ORBIT.brake * h)));
        this.braking = true;
      } else if (!this.grounded && (input.jump || this.jetTime > 0)) {
        // A gentle trim: towards circular speed sideways, climbing or sinking towards `height`.
        this.jets = true;
        const vr = dot(this.v, u);
        const side = sub(this.v, mul(u, vr));
        const along = len(side) > 0.1 ? norm(side) : this.f;
        const climb = Math.max(-ORBIT.climb, Math.min(ORBIT.climb, 0.15 * (ORBIT.height - r)));
        const dv = sub(add(mul(along, Math.sqrt(body.mu / r)), mul(u, climb)), this.v);
        const m = len(dv);
        if (m > 1e-6) this.v = add(this.v, mul(dv, Math.min(1, (ORBIT.thrust * h) / m)));
      }
      if (this.lap > 2 * Math.PI && !this.jets) this.v = mul(this.v, Math.exp(-ORBIT.sag * h));
      // Never enough energy to fly off: the highest point stays below 2 × maxA.
      const most = Math.sqrt(body.mu * (2 / r - 1 / ORBIT.maxA));
      const sp = len(this.v);
      if (sp > most) this.v = mul(this.v, most / sp);
    } else {
      // Never fast enough to go into orbit: every leap comes back down.
      const airCap = Math.sqrt(body.mu / r) * 0.75;
      const sp = len(this.v);
      if (sp > airCap) this.v = mul(this.v, airCap / sp);
    }

    const before = u;
    this.p = add(this.p, mul(this.v, h));
    if (this.orbiting) {
      const lapBefore = this.lap;
      this.lap += Math.acos(Math.min(1, dot(before, norm(this.p))));
      if (lapBefore < 2 * Math.PI && this.lap >= 2 * Math.PI) this.orbited = true;
    }

    // Don't sink into the ground.
    r = len(this.p);
    u = mul(this.p, 1 / r);
    const floor = this.groundRadius(u) + k.ride;
    if (r < floor) {
      this.p = mul(u, floor);
      const vr = dot(this.v, u);
      if (vr < 0) this.v = sub(this.v, mul(u, vr));
    }

    // Bump around obstacles: the parked rocket, trees and rocks.
    for (const o of this.obstacles) this.bump(o, u, h);
    if (this.grid) for (const o of this.grid.near(this.p)) this.bump(o, u, h);
  }

  /** Friendly bump: push out of the obstacle, bounce a little and slide off at an angle. */
  bump(o, u, h) {
    let d = sub(this.p, o.p);
    const above = dot(d, u);
    // Wheels clear of the top: jumped over. The rocket (`top`: its height) can only be cleared
    // by super hopping over it; the low orbit passes just above an ordinary one.
    if (o.h !== undefined ? above - this.kind.ride > o.h : this.orbiting && above > (o.top ?? 12)) return;
    d = sub(d, mul(u, above));
    const dist = len(d);
    const r = o.r + (this.kind.reach ?? 1);
    if (dist >= r || dist < 1e-6) return;
    const out = mul(d, 1 / dist);
    this.p = add(this.p, mul(out, r - dist));
    const vin = dot(this.v, out);
    if (vin < 0) {
      // Only the push-in is taken away (so reversing or steering off always works), with a
      // little bounce for proper crashes; gentle nudges just stop.
      this.v = sub(this.v, mul(out, vin * (vin < -3 ? 1.3 : 1)));
      // Glancing hits turn us to slide along it, faster the more glancing; head-on just stops.
      const fin = dot(this.f, out);
      const along = sub(this.f, mul(out, fin));
      const side = len(along);
      if (fin < 0 && side > 1e-3) {
        const turn = Math.min(Math.acos(Math.min(1, side)), h * 3 * Math.min(1, side / 0.3));
        this.f = norm(rotate(this.f, norm(cross(this.f, along)), turn));
      }
      if (-vin > this.bumped) {
        this.bumped = -vin;
        this.bumpedInto = o;
      }
    }
  }
}
