// Buggy driving: arcade car physics over the full 3D globe of one world.
// Positions are in the world's own frame (the same frame the rocket uses, but with z).
// Gravity is real (pulls toward the centre, so hills and jumps behave), and top speed is
// kept below orbit speed so every jump comes back down.

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
    this.obstacles = []; // [{ p: [x,y,z], r }] e.g. the parked rocket
  }

  /** Top speed on this world: the buggy's own limit, but always well below orbit speed. */
  get topSpeed() {
    const orbit = Math.sqrt(this.body.mu / this.body.radius);
    return Math.min(this.kind.maxSpeed, orbit * 0.7);
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
    let left = Math.min(dt, 0.1);
    while (left > 1e-6) {
      const h = Math.min(STEP, left);
      this.substep(h, input);
      left -= h;
    }
    this.speed = len(this.v);
  }

  substep(h, input) {
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
    this.grounded = r <= ground + 0.08;
    if (this.grounded) this.flying = false;
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

      if (input.jump && k.jump && this.jumpCooldown === 0 && !this.inWater) {
        this.v = add(this.v, mul(n, k.jump));
        this.jumpCooldown = 0.6;
        this.flying = true;
        this.jumped = true;
      }
      this.distance += vf * h;
    }

    // Never fast enough to go into orbit: every leap comes back down.
    const airCap = Math.sqrt(body.mu / r) * 0.75;
    const sp = len(this.v);
    if (sp > airCap) this.v = mul(this.v, airCap / sp);

    this.p = add(this.p, mul(this.v, h));

    // Don't sink into the ground.
    r = len(this.p);
    u = mul(this.p, 1 / r);
    const floor = this.groundRadius(u) + k.ride;
    if (r < floor) {
      this.p = mul(u, floor);
      const vr = dot(this.v, u);
      if (vr < 0) this.v = sub(this.v, mul(u, vr));
    }

    // Bump around obstacles (the parked rocket).
    for (const o of this.obstacles) {
      let d = sub(this.p, o.p);
      d = sub(d, mul(u, dot(d, u)));
      const dist = len(d);
      if (dist < o.r && dist > 1e-6) {
        const out = mul(d, 1 / dist);
        this.p = add(this.p, mul(out, o.r - dist));
        const vin = dot(this.v, out);
        if (vin < 0) this.v = sub(this.v, mul(out, vin * 1.3));
      }
    }
  }
}
