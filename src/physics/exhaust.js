// The rocket's exhaust in the air (#60): smoke or steam left behind by the main engine,
// billowing clouds rolling out along the ground at lift-off and touchdown, little puffs from
// the turning thrusters, and dust kicked up near the ground (on airless worlds only that).
// Pure and headless: one fixed ring of particles in typed arrays (no allocation per frame),
// living in the frame of the world we're at, like the rocket. src/world/exhaust.js draws it.
//
// The air decides everything: thick air (Homestead, Misty) gives a big, billowy trail that
// lingers and drifts; thin air (Dusty) a faint one; in a vacuum there's no smoke at all, only
// the flame (and dust near the ground). The air thins out with height (`airAt`), so the trail
// fades away as the rocket climbs. Only the look: the physics never sees it.
import { dustColor } from './dust.js';

export const EXHAUST = {
  capacity: 400, // particles, shared by every exhaust effect (the oldest go first when it's full)
  trail: 22, // trail puffs per second at full power in thick air...
  perMetre: 0.55, // ...plus this many per metre flown, so a fast rocket's trail has no gaps
  perFrame: 5, // but never more than this many trail puffs in one frame
  trailLife: 5.5, // seconds a trail puff lasts in thick air (less in thin)
  billow: 7, // ground billows per second at full power right on the ground
  billowHigh: 22, // the plume reaches the ground from up to this high (m, for a one-engine rocket)
  billowLife: 4.2,
  puffs: 16, // thruster puffs per second while turning at full rate
  dust: 30, // dust grains per second kicked up at full power (airless worlds; less in air)
  warp: [3, 30], // time speed where trails start thinning .. are gone (no absurd trails at warp)
  minAir: 0.02, // below this there's no smoke
};

// Each world's air: how thick at the ground (`dens`), the smoke's colour, and the wind (m/s
// along the ground, so trails drift). Homestead: white steam; Dusty: thin, dusty orange;
// Misty: thick, murky orange (inside its haze). A world with an atmosphere that isn't listed
// gets thick air and a pale version of its atmosphere's colour.
export const AIR = {
  homestead: { dens: 1, smoke: [0.97, 0.97, 0.99], wind: 1.8 },
  dusty: { dens: 0.4, smoke: [0.92, 0.64, 0.46], wind: 2.4 },
  misty: { dens: 1.35, smoke: [0.86, 0.68, 0.48], wind: 0.7 },
};

const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const cache = new WeakMap();

/** A world's air ({ dens, smoke, wind }), or null in a vacuum. */
export function airOf(body) {
  if (!body?.atmosphere || body.kind === 'star') return null;
  if (AIR[body.id]) return AIR[body.id];
  let a = cache.get(body);
  if (!a) {
    const c = body.atmosphere;
    const pale = (v) => 0.55 + 0.45 * (v / 255);
    a = { dens: 1, smoke: [pale((c >> 16) & 255), pale((c >> 8) & 255), pale(c & 255)], wind: 1 };
    cache.set(body, a);
  }
  return a;
}

/**
 * How thick the air is `alt` metres above the ground (1 = Homestead's at the ground; 0 in a
 * vacuum). It thins out quickly with height, and is all gone by the world's space line.
 */
export function airAt(body, alt) {
  const a = airOf(body);
  if (!a) return 0;
  const top = body.spaceLine;
  const h = Math.max(0, alt);
  return a.dens * Math.exp((-1.5 * h) / top) * (1 - smooth(0.6 * top, top, h));
}

/** How opaque smoke is in air this thick: none in a vacuum, faint in thin air, solid in thick. */
export function smokeAlpha(air) {
  return air < EXHAUST.minAir ? 0 : 0.9 * smooth(0, 0.6, air);
}

/**
 * Trail puffs per second for the main engine at `throttle` (0..1) in air this thick, at time
 * speed `warp`: none in a vacuum, fewer in thin air, thinned out at high time speeds.
 */
export function trailRate(air, throttle, warp = 1) {
  if (air < EXHAUST.minAir || throttle <= 0) return 0;
  return EXHAUST.trail * Math.pow(Math.min(1, throttle), 0.6) * Math.min(1.25, 0.35 + air) * warpThin(warp);
}

/** 1 at normal speed, fading to 0 at high time speeds (so the trail doesn't stretch absurdly). */
export function warpThin(warp) {
  return 1 - smooth(EXHAUST.warp[0], EXHAUST.warp[1], warp);
}

/**
 * How hard the plume hits the ground (0..1): full power right on the ground, nothing from
 * `billowHigh` up (higher for a big multi-engine rocket), and only while the nozzles point at
 * the ground (`upright`: 1 standing straight up, 0 sideways).
 */
export function groundBlast(throttle, alt, upright, power = 1) {
  if (throttle <= 0 || upright < 0.2) return 0;
  const high = EXHAUST.billowHigh * power;
  return Math.min(1, throttle) * (1 - smooth(0, high, alt)) * smooth(0.2, 0.7, upright);
}

/**
 * A fixed ring of exhaust particles. Spawning when full reuses the oldest slot; drawing goes
 * oldest to newest (the newest, nearest the rocket, on top). Particles drift with the air:
 * their speed relaxes (at `drag`) towards the wind plus a slow rise, and ones with `grav`
 * fall (dust in a vacuum). None goes into the ground.
 */
export class ExhaustPool {
  constructor(capacity = EXHAUST.capacity) {
    this.capacity = capacity;
    this.pos = new Float64Array(capacity * 3);
    this.vel = new Float64Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.rise = new Float32Array(capacity); // m/s the air lifts it (warm steam, smoke)
    this.grav = new Float32Array(capacity); // times the world's gravity (dust in a vacuum)
    this.spin = new Float32Array(capacity);
    this.seed = new Float32Array(capacity);
    this.lift = new Float32Array(capacity); // how high above the ground its middle is (m)
    this.start = 0; // oldest slot
    this.count = 0;
    this.body = null;
    this.wind = 0;
    this.turn = 0; // how far a spinning world's ground has turned (#62 stage 3, Body.spinAt): the particles are in the flight's frame
  }

  /** Which world the particles are in (clears them when that changes). */
  setWorld(body) {
    if (this.body === body) return;
    this.body = body;
    this.mu = body?.mu ?? 0;
    this.wind = airOf(body)?.wind ?? 0;
    this.clear();
  }

  clear() {
    this.start = 0;
    this.count = 0;
  }

  /** Slot of the k-th particle, oldest first. */
  slot(k) {
    const i = this.start + k;
    return i >= this.capacity ? i - this.capacity : i;
  }

  /**
   * A new particle at (x, y, z) moving at (vx, vy, vz), colour (r, g, b). `o`: { size, grow
   * (end size in times the start), life, alpha, drag, rise, grav, spin, seed }; pass one reused
   * object. Returns its slot (reusing the oldest when full).
   */
  spawn(x, y, z, vx, vy, vz, r, g, b, o) {
    let i;
    if (this.count < this.capacity) {
      i = this.slot(this.count++);
    } else {
      i = this.start;
      this.start = this.slot(1);
    }
    const p = this.pos, v = this.vel, c = this.col;
    // Never start inside the ground (the nozzles are close to it on the pad).
    const rr = Math.hypot(x, y) || 1;
    const floor = this.body.surfaceAt(Math.atan2(y, x) - this.turn) + 0.3;
    if (rr < floor) { x *= floor / rr; y *= floor / rr; }
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    v[i * 3] = vx; v[i * 3 + 1] = vy; v[i * 3 + 2] = vz;
    c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b;
    this.age[i] = 0;
    this.life[i] = o.life;
    this.size0[i] = o.size;
    this.size1[i] = o.size * o.grow;
    this.alpha[i] = o.alpha;
    this.drag[i] = o.drag;
    this.rise[i] = o.rise;
    this.grav[i] = o.grav;
    this.spin[i] = o.spin;
    this.seed[i] = o.seed;
    this.lift[i] = 100; // until it's stepped
    return i;
  }

  /** Move everything on by dt (real seconds): drift with the air, fall, age, stay above ground. */
  step(dt) {
    const body = this.body;
    if (!body || this.count === 0 || dt <= 0) return;
    // The oldest ones that are done make room.
    while (this.count > 0 && this.age[this.start] >= this.life[this.start]) {
      this.start = this.slot(1);
      this.count--;
    }
    const p = this.pos, v = this.vel;
    const wind = this.wind, mu = this.mu;
    for (let k = 0; k < this.count; k++) {
      const i = this.slot(k);
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const j = i * 3;
      let x = p[j], y = p[j + 1], z = p[j + 2];
      const r = Math.hypot(x, y) || 1;
      const ux = x / r, uy = y / r;
      if (this.grav[i] > 0) {
        const g = (this.grav[i] * mu) / (r * r + z * z);
        v[j] -= ux * g * dt; v[j + 1] -= uy * g * dt;
      }
      if (this.drag[i] > 0) {
        // The air's own speed here: the wind along the ground (clockwise round the world) and a slow rise.
        const ax = uy * wind + ux * this.rise[i], ay = -ux * wind + uy * this.rise[i];
        const d = Math.exp(-this.drag[i] * dt);
        v[j] = ax + (v[j] - ax) * d;
        v[j + 1] = ay + (v[j + 1] - ay) * d;
        v[j + 2] *= d;
      }
      x += v[j] * dt; y += v[j + 1] * dt; z += v[j + 2] * dt;
      // Never into the ground: slide along it instead (billows roll out; dust lands and stops).
      const rr = Math.hypot(x, y);
      // (A big puff's middle stays a third of its size up: it hugs the ground, and the shader
      // thins out what's below the ground.)
      const ground = body.surfaceAt(Math.atan2(y, x) - this.turn);
      const floor = ground + 0.3 + 0.35 * this.sizeOf(i);
      if (rr < floor) {
        x *= floor / rr; y *= floor / rr;
        const vr = (v[j] * x + v[j + 1] * y) / floor;
        if (vr < 0) {
          v[j] -= (vr * x) / floor; v[j + 1] -= (vr * y) / floor;
          if (this.grav[i] > 0) { v[j] *= 0.5; v[j + 1] *= 0.5; v[j + 2] *= 0.5; }
        }
      }
      p[j] = x; p[j + 1] = y; p[j + 2] = z;
      this.lift[i] = Math.hypot(x, y) - ground;
    }
  }

  /** How big (m, radius) particle i is now: grows fast at first, then slowly. */
  sizeOf(i) {
    const a = Math.min(1, this.age[i] / this.life[i]);
    const b = (1 - a) * (1 - a) * (1 - a);
    return this.size0[i] + (this.size1[i] - this.size0[i]) * (1 - b * b);
  }

  /** How much of it is left (0..1): a quick fade in, then it thins away over its second half. */
  fadeOf(i) {
    const a = this.age[i] / this.life[i];
    return smooth(0, 0.04, a) * (1 - smooth(0.4, 1, a));
  }
}

/**
 * All the exhaust one rocket makes, into an ExhaustPool. Pure: the flight scene calls update()
 * every frame with the rocket's state, and touchdown() when it lands.
 * engines: [{ x, y, scale }] where each nozzle is in the rocket's frame (x sideways, y up the
 * rocket from its base), as rocketMesh.js gives them; height: the rocket's height (m).
 */
export class RocketExhaust {
  constructor(pool, rand = Math.random) {
    this.pool = pool;
    this.rand = rand;
    this.engines = [{ x: 0, y: 0, scale: 1 }];
    this.height = 6;
    this.power = 1; // how big a blast: more engines, bigger clouds
    this.o = { size: 1, grow: 2, life: 1, alpha: 1, drag: 0, rise: 0, grav: 0, spin: 0, seed: 0 };
    this.dustCol = { r: 1, g: 1, b: 1, water: false };
    this.acc = { trail: 0, billow: 0, puff: 0, dust: 0 };
    this.last = { body: null, x: 0, y: 0, angle: 0, ok: false };
    this.air = 0; // the air's thickness at the nozzles last frame (for tests and the look)
  }

  /** The rocket's engines and height (after building it). */
  setRocket(engines, height) {
    this.engines = engines.length ? engines : [{ x: 0, y: 0, scale: 1 }];
    this.height = height;
    let big = 0;
    for (const e of this.engines) big += e.scale * e.scale;
    this.power = Math.min(2, Math.max(0.7, Math.sqrt(big)));
  }

  /** Forget where the rocket was (a rewind, the pad, a new flight): no trail joining the two. */
  reset() {
    this.last.ok = false;
    for (const k in this.acc) this.acc[k] = 0;
  }

  clear() {
    this.pool.clear();
    this.reset();
  }

  /**
   * One frame. `s`: { body, x, y, vx, vy, angle, landed, crashed } (the flight's state),
   * `throttle` 0..1, `alt` (m above the ground), `dt` real seconds, `warp` the time speed.
   */
  update(dt, s, throttle, alt, warp = 1) {
    const pool = this.pool;
    pool.setWorld(s.body);
    pool.turn = s.body.spinAt(s.t ?? 0);
    pool.step(dt);
    const last = this.last;
    if (dt <= 0) return;
    const body = s.body;
    if (s.crashed || !body.solid) {
      this.reset();
      return;
    }
    // Where the rocket was last frame, to spread this frame's puffs along the way (not after a jump).
    const jump = !last.ok || last.body !== body || Math.hypot(s.x - last.x, s.y - last.y) > 60;
    const x0 = jump ? s.x : last.x, y0 = jump ? s.y : last.y, a0 = jump ? s.angle : last.angle;
    let da = Math.atan2(Math.sin(s.angle - a0), Math.cos(s.angle - a0));
    last.body = body; last.x = s.x; last.y = s.y; last.angle = s.angle; last.ok = true;

    const air = airAt(body, alt);
    this.air = air;
    const thin = warpThin(warp);
    const on = throttle > 0.005;
    // The plume hitting the ground: billows in air, dust anyway (less of it in thick air).
    const r = Math.hypot(s.x, s.y) || 1;
    const upright = (Math.cos(s.angle) * s.x + Math.sin(s.angle) * s.y) / r; // 1: nozzles straight at the ground
    const blast = on ? groundBlast(throttle, alt, upright, this.power) : 0;
    if (blast > 0) this.ground(dt, s, blast, air, thin);
    else this.acc.billow = this.acc.dust = 0;
    // The trail, where it isn't blown out along the ground as billows instead.
    if (on && air >= EXHAUST.minAir) this.trail(dt, s, x0, y0, a0, throttle, air, thin * (1 - 0.85 * blast));
    else this.acc.trail = 0;

    // Turning thrusters: puffs from the nose and tail while the rocket turns, in air.
    if (s.landed) da = 0;
    const turn = Math.abs(da) / dt;
    if (air >= EXHAUST.minAir && turn > 0.08 && Math.abs(da) < 0.5) this.thrusters(dt, s, Math.sign(da), turn, air, thin);
    else this.acc.puff = 0;
  }

  /** Main engine: puffs left behind along the way, blown out of the nozzles and slowed by the air. */
  trail(dt, s, x0, y0, a0, throttle, air, thin) {
    const rn = this.rand, o = this.o;
    const moved = Math.hypot(s.x - x0, s.y - y0);
    this.acc.trail += trailRate(air, throttle) * thin * dt + moved * EXHAUST.perMetre * thin * Math.min(1, air * 2);
    let n = Math.min(EXHAUST.perFrame, Math.floor(this.acc.trail));
    this.acc.trail -= n;
    if (this.acc.trail > EXHAUST.perFrame) this.acc.trail = 0; // don't save up at warp
    const smoke = airOf(s.body).smoke;
    const alpha = smokeAlpha(air);
    const thick = Math.min(1.3, air);
    const jet = (8 + 8 * throttle);
    for (let k = 0; k < n; k++) {
      // Somewhere between last frame's place and this one's.
      const u = (k + rn()) / n;
      const ang = a0 + Math.atan2(Math.sin(s.angle - a0), Math.cos(s.angle - a0)) * u;
      const ax = Math.cos(ang), ay = Math.sin(ang);
      const e = this.engines[Math.floor(rn() * this.engines.length)];
      const sc = e.scale;
      // The rocket's x is along (sin a, -cos a) (rocketMesh's frame turned by angle - 90°).
      const bx = x0 + (s.x - x0) * u, by = y0 + (s.y - y0) * u;
      const tip = e.y - (1.6 + rn() * 1.2) * sc; // just past the flame's bright core
      const jx = (rn() - 0.5) * 0.6 * sc, jy = (rn() - 0.5) * 0.6 * sc;
      const x = bx + ay * e.x + ax * tip + jx, y = by - ax * e.x + ay * tip + jy;
      const sp = jet * (0.7 + rn() * 0.6);
      const side = (rn() - 0.5) * 5;
      o.size = (2.6 + rn() * 0.8) * sc * (0.7 + 0.3 * thick);
      o.grow = (1.8 + 1.8 * thick) * (0.8 + rn() * 0.4);
      o.life = EXHAUST.trailLife * (0.55 + 0.45 * thick) * (0.8 + rn() * 0.4);
      o.alpha = alpha * (0.8 + rn() * 0.2);
      o.drag = 2.2;
      o.rise = 0.5 + rn() * 0.5;
      o.grav = 0;
      o.spin = rn() * 6.28;
      o.seed = rn();
      const shade = 0.93 + rn() * 0.09;
      this.pool.spawn(x, y, (rn() - 0.5) * 0.8 * sc,
        s.vx * 0.25 - ax * sp + ay * side, s.vy * 0.25 - ay * sp - ax * side, (rn() - 0.5) * 3,
        Math.min(1, smoke[0] * shade), Math.min(1, smoke[1] * shade), Math.min(1, smoke[2] * shade), o);
    }
  }

  /**
   * The plume meeting the ground under the rocket: in air, big clouds rolling out along the
   * ground both ways (mostly the air's colour, some the ground's dust); dust thrown out along
   * the ground everywhere (in a vacuum, falling back in clean arcs).
   */
  ground(dt, s, blast, air, thin) {
    const rn = this.rand, o = this.o;
    const body = s.body;
    const up = Math.atan2(s.y, s.x);
    const ux = Math.cos(up), uy = Math.sin(up);
    const tx = -uy, ty = ux;
    const turn = body.spinAt(s.t ?? 0);
    const gr = body.surfaceAt(up - turn);
    const col = dustColor(body, Math.cos(up - turn), Math.sin(up - turn), 0, this.dustCol);
    const smoke = airOf(body)?.smoke;
    const alpha = smokeAlpha(air);
    const pw = this.power;
    if (smoke && alpha > 0) {
      this.acc.billow += EXHAUST.billow * blast * Math.min(1.2, 0.3 + air) * thin * dt;
      for (; this.acc.billow >= 1; this.acc.billow -= 1) {
        const dir = rn() < 0.5 ? -1 : 1;
        // Mostly out sideways along the ground (as seen), some towards or away from us.
        const out = rn() * 0.9 + 0.1, deep = (rn() - 0.6) * 1.2;
        const sp = (9 + rn() * 9) * (0.5 + 0.5 * blast) * pw;
        const dusty = rn() < 0.3;
        const k = 0.94 + rn() * 0.08;
        const c0 = dusty ? col.r : smoke[0], c1 = dusty ? col.g : smoke[1], c2 = dusty ? col.b : smoke[2];
        const off = (rn() - 0.5) * 2 * pw;
        o.size = (1.8 + rn() * 0.8) * pw;
        o.grow = 2 + rn() * 0.6;
        o.life = EXHAUST.billowLife * (0.7 + rn() * 0.5) * (0.6 + 0.4 * Math.min(1, air));
        o.alpha = alpha * (dusty ? 0.9 : 1);
        o.drag = 1.1;
        o.rise = 0.4 + rn() * 0.6;
        o.grav = 0;
        o.spin = rn() * 6.28;
        o.seed = rn();
        const h = gr + 0.8 + rn() * 0.8;
        this.pool.spawn(ux * h + tx * off, uy * h + ty * off, deep * 2,
          tx * dir * sp * out + ux * (1 + rn() * 2), ty * dir * sp * out + uy * (1 + rn() * 2), deep * sp * 0.5,
          Math.min(1, c0 * k), Math.min(1, c1 * k), Math.min(1, c2 * k), o);
      }
    }
    // Dust (#26's look: the ground's own colour). In thick air the billows are most of it.
    this.acc.dust += EXHAUST.dust * blast * (1 - 0.6 * Math.min(1, air)) * thin * dt;
    const vacuum = !airOf(body);
    for (; this.acc.dust >= 1; this.acc.dust -= 1) {
      const dir = rn() < 0.5 ? -1 : 1;
      const sp = (5 + rn() * 9) * pw;
      const upv = 1 + rn() * (vacuum ? 4 : 2);
      const k = 0.9 + rn() * 0.2;
      const deep = (rn() - 0.5) * 1.4;
      o.size = (0.45 + rn() * 0.35) * pw;
      o.grow = vacuum ? 1.5 : 3;
      o.life = vacuum ? 1.6 + rn() : 1.4 + rn() * 0.8;
      o.alpha = 0.85;
      o.drag = vacuum ? 0 : 2.4;
      o.rise = 0;
      o.grav = 1;
      o.spin = rn() * 6.28;
      o.seed = rn();
      const h = gr + 0.5;
      this.pool.spawn(ux * h, uy * h, deep,
        tx * dir * sp + ux * upv, ty * dir * sp + uy * upv, deep * sp * 0.6,
        Math.min(1, col.r * k), Math.min(1, col.g * k), Math.min(1, col.b * k), o);
    }
  }

  /**
   * Turning (by hand or by a helper): small puffs from thrusters at the nose and the tail,
   * pushing the nose round (gas out the other way) and the tail the opposite way.
   */
  thrusters(dt, s, dir, turn, air, thin) {
    const rn = this.rand, o = this.o;
    this.acc.puff += EXHAUST.puffs * Math.min(1, turn / 1.2) * thin * dt;
    const smoke = airOf(s.body).smoke;
    const alpha = smokeAlpha(air) * 0.9;
    const ax = Math.cos(s.angle), ay = Math.sin(s.angle);
    // Sideways, the way the nose turns (angle increasing: anticlockwise).
    const px = -ay, py = ax;
    for (; this.acc.puff >= 1; this.acc.puff -= 1) {
      const nose = rn() < 0.6;
      const along = this.height * (nose ? 0.82 : 0.12);
      const out = (nose ? -dir : dir);
      const sp = 5 + rn() * 3;
      o.size = 0.7 + rn() * 0.3;
      o.grow = 2.5 + rn();
      o.life = 1 + rn() * 0.6;
      o.alpha = alpha;
      o.drag = 3;
      o.rise = 0.3;
      o.grav = 0;
      o.spin = rn() * 6.28;
      o.seed = rn();
      const k = 0.96 + rn() * 0.06;
      this.pool.spawn(s.x + ax * along + px * out * 0.9, s.y + ay * along + py * out * 0.9, (rn() - 0.5) * 0.4,
        s.vx + px * out * sp, s.vy + py * out * sp, (rn() - 0.5) * 1.5,
        Math.min(1, smoke[0] * k), Math.min(1, smoke[1] * k), Math.min(1, smoke[2] * k), o);
    }
  }

  /** Touching down (`speed` m/s): a ring of billows (in air) and dust rolling out from under the rocket. */
  touchdown(s, speed) {
    const body = s.body;
    if (!body.solid) return;
    this.pool.setWorld(body);
    this.pool.turn = body.spinAt(s.t ?? 0);
    const air = airAt(body, 0);
    const blast = Math.min(1, 0.5 + speed * 0.15);
    // What the plume does on the ground for a second or so, all at once.
    for (let k = 0; k < 12; k++) this.ground(0.1, s, blast, air, 1);
  }
}
