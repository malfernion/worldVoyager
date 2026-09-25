// Buggy driving: arcade car physics over the full 3D globe of one world.
// Positions are in the world's own frame (the same frame the rocket uses, but with z).
// Gravity is real (pulls toward the centre, so hills and jumps behave), and top speed is
// kept below orbit speed so every jump comes back down.
// The one secret exception: a super hop lets the Hopper orbit tiny Nibble (see ORBIT).

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
    this.inWater = false;
    this.distance = 0; // for spinning the wheels
    this.speed = 0;
    this.jumpCooldown = 0;
    this.jumpWasDown = false;
    this.orbiting = false; // in a super hop (the Nibble secret)
    this.jets = false; // the Hopper's jets are firing (in a super hop)
    this.jetTime = 0; // a tap keeps the jets going this much longer (s)
    this.lap = 0; // how far round the world we've flown since the super hop (radians)
    this.obstacles = []; // [{ p: [x,y,z], r, top }] e.g. the parked rocket (r: its own radius, top: its height)
    this.grid = null; // ObstacleGrid of the world's trees or rocks
    this.bumped = 0; // hardest bump since the scene last looked (m/s), and what we hit
    this.bumpedInto = null;
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

  isWater(dir) {
    const t = this.body.terrainFn;
    return t && t.sea !== undefined && t.height(dir[0], dir[1], dir[2]) <= t.sea + 1e-3;
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
  }

  substep(h, input, press) {
    const k = this.kind;
    const body = this.body;
    let r = len(this.p);
    let u = mul(this.p, 1 / r);
    this.f = norm(sub(this.f, mul(u, dot(this.f, u))));
    const g = body.mu / (r * r);
    this.jumpCooldown = Math.max(0, this.jumpCooldown - h);

    // Gravity always pulls toward the middle of the world.
    this.v = add(this.v, mul(u, -g * h));

    const ground = this.groundRadius(u) + k.ride;
    // Just after a super hop we're still touching the ground; don't let the tyres grab us back.
    this.grounded = r <= ground + 0.08 && !(this.orbiting && this.jumpCooldown > 0.4);
    if (this.grounded) {
      this.flying = false;
      this.orbiting = false;
    }
    // Sticky tyres: on low-gravity moons, don't float off every little bump (real jumps still fly).
    if (!this.grounded && !this.flying && r - ground < 2.5) this.v = add(this.v, mul(u, -Math.max(0, 5 - g) * h));
    this.inWater = this.grounded && this.isWater(u);

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

      let cap = this.topSpeed * (this.inWater ? 0.45 : 1);
      const slope = 1 - dot(n, u);
      const accel = k.accel * (1 + (k.climb || 0) * Math.min(1, slope * 6)) * (this.inWater ? 0.6 : 1);
      if (input.throttle) {
        const target = input.throttle > 0 ? cap : -cap * 0.5;
        const want = target - vf;
        vf += Math.sign(want) * Math.min(Math.abs(want), accel * h);
      } else {
        vf *= Math.exp(-(this.inWater ? 1.5 : 0.5) * h); // gently roll to a stop
      }
      if (Math.abs(vf) > cap) vf = Math.sign(vf) * cap;
      // Tyres stop sideways sliding (ice is slippery!).
      const grip = k.grip * (body.id === 'frosty' ? 0.25 : 1);
      vs *= Math.exp(-grip * h);
      this.v = add(add(mul(fg, vf), mul(sg, vs)), mul(n, vn));

      // Steering turns more the faster we roll (and backwards when reversing).
      const roll = Math.min(1, Math.abs(vf) / 2) * Math.sign(vf || 1);
      if (input.steer) this.f = rotate(this.f, n, input.steer * k.turn * h * roll);

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
      } else if (input.jump && k.jump && this.jumpCooldown === 0 && !this.inWater) {
        this.v = add(this.v, mul(n, k.jump));
        this.jumpCooldown = 0.6;
        this.flying = true;
        this.jumped = true;
      }
      this.distance += vf * h;
    }

    this.braking = false;
    this.jets = false;
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
