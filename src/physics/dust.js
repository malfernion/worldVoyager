// Buggy dust (#26): tyre dust, the Hopper's jump bursts and jets, landing thumps. Pure and
// headless: one fixed pool of particles in typed arrays (no allocation per frame), living in
// the world's own frame like the buggy. Grains fall with the world's real gravity (mu / r²):
// slow, clean arcs on airless Pebble or Nibble, a quick drop on Homestead. Where there's air
// (Homestead, Dusty) they're puffier, slow down and fade sooner. They never go into the ground:
// landing, a grain stops at the surface and fades. src/world/dust.js draws the pool.

export const DUST = {
  capacity: 384, // particles, shared by every buggy effect
  crawl: 1.2, // below this speed (m/s) rolling tyres throw nothing
  roll: 1.1, // per wheel per second, for each m/s over `crawl`
  slip: 6, // per wheel per second, for each m/s of sliding sideways
  push: 1.8, // per wheel per second, for each m/s² of speeding up or braking
  maxRate: 36, // per wheel per second
  air: 2.4, // drag (1/s) where there's air; none in a vacuum
  life: 3.2, // longest a grain lives in a vacuum (s): long enough for Nibble's slow arcs
  airLife: 1.1, // ...and where there's air
  fade: 0.35, // a grain that lands fades out over this long (s)
  lift: 0.12, // grains rest this far above the ground (m), so the soft puff isn't half buried
  // Ground heights re-checked per step, so grains crossing a hill don't sink into it: every
  // flying grain within `near` metres of the ground, plus `resample` others round robin, but
  // never more than `checks` in all (the rest keep their last one).
  near: 0.8,
  resample: 32,
  checks: 160,
};

// Particle kinds: dust is drawn lit with normal blending; flame is an unlit, additive glow.
export const DUST_KIND = 0;
export const FLAME_KIND = 1;

// In a sea (#44): bubbles rise and pop at the surface; spray thrown up out of it vanishes
// back in when it falls through the surface. Other particles ignore the liquid.
export const FLOAT_NONE = 0;
export const FLOAT_BUBBLE = 1;
export const FLOAT_SPRAY = 2;
const BUBBLE_COL = { r: 0.86, g: 0.95, b: 1 };

const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Does this world have air (to slow and spread the dust)? Only solid worlds are driven on. */
export function hasAir(body) {
  return !!body.atmosphere && !body.gas;
}

/**
 * How much dust one wheel on the ground throws (particles per second): none when crawling,
 * more the faster it rolls, and lots when sliding sideways (`slip`, m/s) or speeding up or
 * braking hard (`push`, m/s²).
 */
export function dustRate(speed, slip = 0, push = 0) {
  const roll = Math.max(0, speed - DUST.crawl) * DUST.roll * smooth(DUST.crawl, DUST.crawl + 2, speed);
  const skid = Math.max(0, slip - 0.3) * DUST.slip + Math.max(0, push - 1) * DUST.push;
  return Math.min(DUST.maxRate, roll + skid * smooth(0.3, 1.5, speed + slip));
}

/**
 * The dust colour under direction (x, y, z) (unit, the world's frame): the terrain's own colour
 * from terrain.js (the same the ground mesh is painted with), a little paler, as fine dust is,
 * and more so on dark ground so it still reads. Over water, a blue-white spray. Writes into
 * `out` ({ r, g, b, water }) and returns it.
 */
export function dustColor(body, x, y, z, out) {
  const t = body.terrainFn;
  const h = t ? t.height(x, y, z) : 0;
  // (Lava is never driven into, #45: by it, the dust is its dark rock.)
  out.water = !!body.liquid && body.liquid.kind !== 'lava' && body.liquidDepth(x, y, z) > 0;
  if (out.water) {
    // (Misty's methane, #46, sprays a pale amber.)
    if (body.liquid.kind === 'methane') { out.r = 0.96; out.g = 0.84; out.b = 0.62; } else { out.r = 0.86; out.g = 0.95; out.b = 1; }
    return out;
  }
  const c = t ? t.color(x, y, z, h) : [0.8, 0.8, 0.8];
  // Grass throws up bits of earth too.
  const green = Math.max(0, Math.min(1, (c[1] - Math.max(c[0], c[2])) * 6));
  if (green > 0) for (let k = 0; k < 3; k++) c[k] += (SOIL[k] - c[k]) * 0.45 * green;
  const lum = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const k = 0.25 + 0.35 * smooth(0.4, 0.1, lum);
  out.r = c[0] + (1 - c[0]) * k;
  out.g = c[1] + (1 - c[1]) * k;
  out.b = c[2] + (1 - c[2]) * k;
  return out;
}

const SOIL = [0.62, 0.5, 0.34];

export class DustPool {
  constructor(capacity = DUST.capacity) {
    this.capacity = capacity;
    this.pos = new Float64Array(capacity * 3);
    this.vel = new Float64Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.fadeAt = new Float32Array(capacity); // starts fading out at this age
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.grav = new Float32Array(capacity); // times the world's gravity (flames and gas: 0)
    this.drag = new Float32Array(capacity);
    this.floor = new Float64Array(capacity); // ground radius under it (+ DUST.lift)
    this.spin = new Float32Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.float = new Uint8Array(capacity); // FLOAT_*: how it meets a sea's surface
    this.landed = new Uint8Array(capacity);
    this.live = new Int32Array(capacity); // indices of live particles, [0, count)
    this.free = new Int32Array(capacity); // a stack of free slots, [0, nFree)
    this.count = 0;
    this.body = null;
    this.clear();
  }

  /** Which world the dust is on (clears it when that changes). */
  setWorld(body) {
    if (this.body === body) return;
    this.body = body;
    this.mu = body.mu;
    this.airy = hasAir(body);
    this.top = body.liquid ? body.liquidR : 0; // the sea's surface, for bubbles and spray (#44)
    this.clear();
  }

  clear() {
    this.count = 0;
    this.nFree = this.capacity;
    for (let i = 0; i < this.capacity; i++) this.free[i] = this.capacity - 1 - i;
    this.cursor = 0;
  }

  /** Ground radius under direction (x, y, z), not necessarily unit. */
  groundAt(x, y, z) {
    const b = this.body;
    const t = b.terrainFn;
    if (!t) return b.radius;
    const l = Math.hypot(x, y, z) || 1;
    return b.radius + t.height(x / l, y / l, z / l);
  }

  /**
   * A new particle at (x, y, z) moving at (vx, vy, vz), with colour (r, g, b). Returns its slot,
   * or -1 when the pool is full (then it's simply not made). `o`: { size, grow (end size in
   * times the start size), life, alpha, grav (times the world's gravity), drag (added to the
   * air's), kind, spin, float (FLOAT_*) }; kept out of any hot allocation by passing one reused object.
   */
  spawn(x, y, z, vx, vy, vz, r, g, b, o) {
    if (this.nFree === 0 || !this.body) return -1;
    const i = this.free[--this.nFree];
    this.live[this.count++] = i;
    const air = this.airy;
    const p = this.pos, v = this.vel, c = this.col;
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    v[i * 3] = vx; v[i * 3 + 1] = vy; v[i * 3 + 2] = vz;
    c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b;
    const kind = o.kind ?? DUST_KIND;
    const dust = kind === DUST_KIND;
    this.kind[i] = kind;
    this.age[i] = 0;
    this.life[i] = o.life ?? (air ? DUST.airLife : DUST.life);
    this.fadeAt[i] = this.life[i] * 0.55;
    this.size0[i] = o.size ?? 0.5;
    // Puffier where there's air; grains stay small in a vacuum.
    this.size1[i] = this.size0[i] * (o.grow ?? (dust ? (air ? 2.8 : 1.35) : 1.5));
    this.alpha[i] = o.alpha ?? 0.9;
    this.grav[i] = o.grav ?? 1;
    this.drag[i] = (o.drag ?? 0) + (air && dust ? DUST.air : 0);
    this.spin[i] = o.spin ?? 0;
    this.float[i] = o.float ?? FLOAT_NONE;
    this.landed[i] = 0;
    const floor = this.groundAt(x, y, z) + DUST.lift;
    this.floor[i] = floor;
    // Never start inside the ground.
    const rr = Math.hypot(x, y, z);
    if (rr < floor && rr > 0) {
      const k = floor / rr;
      p[i * 3] *= k; p[i * 3 + 1] *= k; p[i * 3 + 2] *= k;
    }
    return i;
  }

  /** Move everything on by dt: gravity towards the middle, air drag, landing, ageing. */
  step(dt) {
    if (!this.body || this.count === 0) return;
    const p = this.pos, v = this.vel;
    const mu = this.mu;
    let checks = DUST.checks;
    for (let n = this.count - 1; n >= 0; n--) {
      const i = this.live[n];
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.kill(n);
        continue;
      }
      const j = i * 3;
      let x = p[j], y = p[j + 1], z = p[j + 2];
      let r = Math.hypot(x, y, z) || 1;
      if (!this.landed[i]) {
        const g = (this.grav[i] * mu) / (r * r);
        const k = g * dt / r;
        v[j] -= x * k; v[j + 1] -= y * k; v[j + 2] -= z * k;
        if (this.drag[i] > 0) {
          const d = Math.exp(-this.drag[i] * dt);
          v[j] *= d; v[j + 1] *= d; v[j + 2] *= d;
        }
        x += v[j] * dt; y += v[j + 1] * dt; z += v[j + 2] * dt;
        r = Math.hypot(x, y, z) || 1;
        // Bubbles pop at the surface; spray falling back into the sea is gone.
        const fl = this.float[i];
        if (fl && (fl === FLOAT_BUBBLE ? r > this.top : r < this.top && x * v[j] + y * v[j + 1] + z * v[j + 2] < 0)) {
          this.kill(n);
          continue;
        }
      }
      if (!this.landed[i] && checks > 0 && (r - this.floor[i] < DUST.near || (n + this.cursor) % this.count < DUST.resample)) {
        this.floor[i] = this.groundAt(x, y, z) + DUST.lift;
        checks--;
      }
      const floor = this.floor[i];
      if (r < floor) {
        // Landed: rest on the ground and fade out.
        const k = floor / r;
        x *= k; y *= k; z *= k;
        v[j] = v[j + 1] = v[j + 2] = 0;
        if (!this.landed[i]) {
          this.landed[i] = 1;
          if (this.age[i] < this.fadeAt[i]) {
            this.fadeAt[i] = this.age[i];
            this.life[i] = this.age[i] + DUST.fade;
          }
        }
      }
      p[j] = x; p[j + 1] = y; p[j + 2] = z;
    }
    this.cursor = (this.cursor + DUST.resample) % Math.max(1, this.count);
  }

  /** Remove the n-th live particle (swap with the last). */
  kill(n) {
    const i = this.live[n];
    this.live[n] = this.live[--this.count];
    this.free[this.nFree++] = i;
  }

  /** How big (m) and how opaque (0..1) particle i is now. */
  sizeOf(i) {
    const a = this.age[i] / this.life[i];
    return this.size0[i] + (this.size1[i] - this.size0[i]) * Math.sqrt(Math.min(1, a));
  }

  alphaOf(i) {
    const age = this.age[i];
    return this.alpha[i] * smooth(0, 0.06, age) * (1 - smooth(this.fadeAt[i], this.life[i], age));
  }
}

// Flames from the Hopper's jets: warm glows that don't fall (hot gas) and die quickly.
const FLAME_COLS = [[1, 0.62, 0.22], [1, 0.84, 0.45], [1, 0.95, 0.75]];

/**
 * All the dust one buggy makes (#26), into a shared DustPool: tyre dust from the wheels that
 * touch the ground, a thump when landing (every buggy), and the Hopper's take-off burst, jets
 * and super hop. Pure: the drive scene calls update() every frame, takeOff() when the buggy
 * jumps and jet() for the orbit jets.
 * wheels: [[x, z], ...] where each tyre touches the ground in the buggy's frame (x right, z
 * forward); jets: [[x, y, z], ...] the Hopper's nozzles (pointing down), or none.
 */
export class BuggyDust {
  constructor(pool, buggy, wheels, jets = [], rand = Math.random) {
    this.pool = pool;
    this.b = buggy;
    this.wheels = wheels;
    this.jets = jets;
    this.rand = rand;
    pool.setWorld(buggy.body);
    this.acc = new Float32Array(wheels.length); // particles owed per wheel
    this.colAt = new Float64Array(wheels.length * 3); // where each wheel's colour was sampled
    this.cols = wheels.map(() => ({ r: 1, g: 1, b: 1, water: false, fresh: false }));
    this.under = { r: 1, g: 1, b: 1, water: false };
    this.opts = { size: 0.5, grow: undefined, life: undefined, alpha: 0.9, grav: 1, drag: 0, kind: DUST_KIND, spin: 0, float: FLOAT_NONE };
    this.spray = { float: FLOAT_SPRAY, alpha: 0.75 };
    this.bubbleOpts = { grav: -0.3, drag: 2.5, life: 2.4, grow: 1.4, alpha: 0.75, float: FLOAT_BUBBLE };
    this.wasIn = buggy.inWater;
    this.splashed = 0; // how fast we just crossed a sea's surface (m/s), for the scene's sound
    this.bubbleAcc = 0;
    this.bowAcc = 0;
    this.lastV = new Float64Array(3);
    this.lastVf = 0;
    this.push = 0; // smoothed forward acceleration (m/s²)
    this.wasGrounded = buggy.grounded;
    this.air = 0; // seconds since take-off (for the Hopper's rising jets)
    this.scale = Math.max(0.8, (buggy.kind.wheel ?? 0.55) / 0.55); // big wheels, big dust
    // Frame vectors (right, up, forward, ground normal) for this frame, no allocation.
    this.R = new Float64Array(3);
    this.U = new Float64Array(3);
    this.F = new Float64Array(3);
    this.N = new Float64Array(3);
    this.landing = 0; // impact speed of the last landing (m/s), for the scene's sound and shake
  }

  frame() {
    const b = this.b, U = this.U, F = this.F, N = this.N, R = this.R;
    const r = Math.hypot(b.p[0], b.p[1], b.p[2]) || 1;
    U[0] = b.p[0] / r; U[1] = b.p[1] / r; U[2] = b.p[2] / r;
    N[0] = b.n[0]; N[1] = b.n[1]; N[2] = b.n[2];
    F[0] = b.f[0]; F[1] = b.f[1]; F[2] = b.f[2];
    // right = up × forward
    R[0] = U[1] * F[2] - U[2] * F[1];
    R[1] = U[2] * F[0] - U[0] * F[2];
    R[2] = U[0] * F[1] - U[1] * F[0];
  }

  /** Emit one particle in the pool with the shared options object. */
  emit(x, y, z, vx, vy, vz, r, g, bl, size, o = {}) {
    const op = this.opts;
    op.size = size;
    op.grow = o.grow;
    op.life = o.life;
    op.alpha = o.alpha ?? 0.9;
    op.grav = o.grav ?? 1;
    op.drag = o.drag ?? 0;
    op.kind = o.kind ?? DUST_KIND;
    op.float = o.float ?? FLOAT_NONE;
    op.spin = this.rand() * 6.28;
    return this.pool.spawn(x, y, z, vx, vy, vz, r, g, bl, op);
  }

  /** A grain of ground-coloured dust, slightly varied (spray over a sea: it vanishes back in). */
  grain(x, y, z, vx, vy, vz, col, size, o) {
    const k = 0.9 + this.rand() * 0.2;
    return this.emit(x, y, z, vx, vy, vz, Math.min(1, col.r * k), Math.min(1, col.g * k), Math.min(1, col.b * k), size, o ?? (col.water ? this.spray : undefined));
  }

  /** Under a sea the buggy's middle is under the surface: bubbles instead of dust (#44). */
  get submerged() {
    return this.b.depth > 0.3;
  }

  /** A bubble at (x, y, z), drifting up (it pops at the surface). */
  bubble(x, y, z, vx, vy, vz, size) {
    const c = BUBBLE_COL;
    return this.emit(x, y, z, vx, vy, vz, c.r, c.g, c.b, size * (0.7 + this.rand() * 0.6), this.bubbleOpts);
  }

  /** A few bubbles around the buggy (from under the wheels when `low`). */
  bubbles(n, spread = 1, low = true) {
    const b = this.b, U = this.U, rn = this.rand;
    const d = low ? b.kind.ride : -0.4;
    for (let k = 0; k < n; k++) {
      const jx = (rn() - 0.5) * spread, jy = (rn() - 0.5) * spread, jz = (rn() - 0.5) * spread;
      const up = 0.4 + rn() * 0.8;
      if (this.bubble(b.p[0] - U[0] * d + jx, b.p[1] - U[1] * d + jy, b.p[2] - U[2] * d + jz,
        U[0] * up + jx * 0.5, U[1] * up + jy * 0.5, U[2] * up + jz * 0.5, 0.22 * this.scale) < 0) break;
    }
  }

  /**
   * Going into or out of a sea (#44): a ring of spray thrown up from where the buggy crosses
   * the surface, bigger the faster it goes.
   */
  splash(speed) {
    const b = this.b, U = this.U, R = this.R, F = this.F, rn = this.rand;
    const top = this.pool.top;
    const r = Math.hypot(b.p[0], b.p[1], b.p[2]) || 1;
    const k = (top + 0.05) / r;
    const cx = b.p[0] * k, cy = b.p[1] * k, cz = b.p[2] * k;
    const n = Math.round(Math.min(40, 10 + speed * 3));
    const col = BUBBLE_COL;
    for (let i = 0; i < n; i++) {
      const a = ((i + rn() * 0.8) / n) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const ox = R[0] * c + F[0] * s, oy = R[1] * c + F[1] * s, oz = R[2] * c + F[2] * s;
      const sp = (0.8 + rn()) * (1 + speed * 0.25);
      const up = 2 + rn() * 2.5 + speed * 0.3;
      if (this.emit(cx + ox, cy + oy, cz + oz, ox * sp + U[0] * up + b.v[0] * 0.3, oy * sp + U[1] * up + b.v[1] * 0.3, oz * sp + U[2] * up + b.v[2] * 0.3,
        col.r, col.g, col.b, (0.3 + rn() * 0.25) * this.scale, this.spray) < 0) break;
    }
  }

  /** Driving through shallow water: a bow wave peeling off both sides of the nose. */
  bowWave(dt, vf) {
    const b = this.b, U = this.U, R = this.R, F = this.F, rn = this.rand;
    const speed = Math.abs(vf);
    if (speed < 1.5) {
      this.bowAcc = 0;
      return;
    }
    this.bowAcc += dt * Math.min(30, speed * 4);
    const top = this.pool.top;
    const r = Math.hypot(b.p[0], b.p[1], b.p[2]) || 1;
    const k = (top + 0.05) / r;
    const nose = Math.sign(vf) * 1.4;
    const col = BUBBLE_COL;
    while (this.bowAcc >= 1) {
      this.bowAcc -= 1;
      const side = rn() < 0.5 ? -1 : 1;
      const ox = R[0] * side * 0.8 + F[0] * nose, oy = R[1] * side * 0.8 + F[1] * nose, oz = R[2] * side * 0.8 + F[2] * nose;
      const out = 0.8 + rn() * 0.8 + speed * 0.2, up = 1 + rn() * 1.2 + speed * 0.1;
      this.emit(b.p[0] * k + ox, b.p[1] * k + oy, b.p[2] * k + oz,
        R[0] * side * out + U[0] * up + F[0] * vf * 0.4, R[1] * side * out + U[1] * up + F[1] * vf * 0.4, R[2] * side * out + U[2] * up + F[2] * vf * 0.4,
        col.r, col.g, col.b, (0.25 + rn() * 0.2) * this.scale, this.spray);
    }
  }

  /** The dust colour right under the buggy. */
  colourUnder() {
    const U = this.U;
    return dustColor(this.b.body, U[0], U[1], U[2], this.under);
  }

  /** Every frame, after the buggy has stepped. */
  update(dt, input = {}) {
    if (dt <= 0) return;
    const b = this.b;
    this.frame();
    const U = this.U, N = this.N, F = this.F, R = this.R, v = b.v;
    // Forward speed along the ground, and how hard it's changing (smoothed, so bumps don't count).
    const vf = v[0] * F[0] + v[1] * F[1] + v[2] * F[2];
    const vs = v[0] * R[0] + v[1] * R[1] + v[2] * R[2];
    const a = b.grounded && this.wasGrounded ? Math.abs(vf - this.lastVf) / dt : 0;
    this.push += (Math.min(a, 20) - this.push) * (1 - Math.exp(-dt * 12));
    this.lastVf = vf;

    this.landing = 0;
    if (b.grounded && !this.wasGrounded) {
      const lv = this.lastV;
      const impact = -(lv[0] * U[0] + lv[1] * U[1] + lv[2] * U[2]);
      this.landing = impact;
      this.thump(impact);
    }
    if (!b.grounded) this.air += dt;
    else this.air = 0;

    if (b.grounded) this.tyres(dt, vf, vs, input);
    else this.acc.fill(0);
    this.hopperJets(dt, input);

    // Seas (#44): a splash going in or out, a bow wave in the shallows, bubbles all under.
    this.splashed = 0;
    if (b.inWater !== this.wasIn) {
      const speed = Math.hypot(v[0], v[1], v[2]);
      if (speed > 0.8) {
        this.splash(speed);
        this.splashed = speed;
      }
    }
    this.wasIn = b.inWater;
    if (b.inWater && !this.submerged) this.bowWave(dt, vf);
    if (this.submerged) {
      this.bubbleAcc += dt * 3;
      if (this.bubbleAcc >= 1) {
        this.bubbleAcc -= 1;
        this.bubbles(1, 1.2, false);
      }
    }

    this.lastV[0] = v[0]; this.lastV[1] = v[1]; this.lastV[2] = v[2];
    this.wasGrounded = b.grounded;
  }

  /** Dust from each wheel that's touching the ground. */
  tyres(dt, vf, vs, input) {
    const b = this.b, U = this.U, N = this.N, F = this.F, R = this.R;
    const speed = Math.abs(vf);
    const slip = Math.abs(vs);
    const base = dustRate(speed, slip, this.push);
    if (base <= 0) {
      this.acc.fill(0);
      return;
    }
    const ride = b.kind.ride;
    const water = b.inWater;
    const under = this.submerged;
    const rate = base * (under ? 0.5 : water ? 1.6 : 1);
    const pool = this.pool;
    const sgn = vf >= 0 ? 1 : -1;
    // Braking (pushing against the way we roll) sprays forwards; speeding up flings it back.
    const braking = input.throttle && Math.sign(input.throttle) !== sgn && speed > 0.5;
    for (let w = 0; w < this.wheels.length; w++) {
      const wx = this.wheels[w][0], wz = this.wheels[w][1];
      const x = b.p[0] + R[0] * wx + F[0] * wz - U[0] * ride;
      const y = b.p[1] + R[1] * wx + F[1] * wz - U[1] * ride;
      const z = b.p[2] + R[2] * wx + F[2] * wz - U[2] * ride;
      // Is this tyre on the ground (not hanging over a dip)?
      const gap = Math.hypot(x, y, z) - pool.groundAt(x, y, z);
      if (gap > 0.35) {
        this.acc[w] = 0;
        continue;
      }
      this.acc[w] += rate * dt;
      if (this.acc[w] < 1) continue;
      if (under) {
        // Under the sea the wheels stir up bubbles, not dust.
        for (; this.acc[w] >= 1; this.acc[w] -= 1) {
          const rn = this.rand;
          this.bubble(x, y, z, (rn() - 0.5) * 0.8 + U[0] * 0.5, (rn() - 0.5) * 0.8 + U[1] * 0.5, (rn() - 0.5) * 0.8 + U[2] * 0.5, 0.2 * this.scale);
        }
        continue;
      }
      const col = this.wheelColour(w, x, y, z);
      while (this.acc[w] >= 1) {
        this.acc[w] -= 1;
        const rn = this.rand;
        const kick = (0.25 + rn() * 0.2) * speed + this.push * 0.12;
        const back = braking ? 0.4 * kick : -kick * sgn;
        const up = (water ? 1.6 : 0.7) + rn() * 1.3 + speed * 0.08 + slip * 0.15;
        const out = vs * 0.35 + (rn() - 0.5) * 1.2;
        const jx = (rn() - 0.5) * 0.6, jy = (rn() - 0.5) * 0.6, jz = (rn() - 0.5) * 0.6;
        this.grain(
          x, y, z,
          F[0] * back + N[0] * up + R[0] * out + jx,
          F[1] * back + N[1] * up + R[1] * out + jy,
          F[2] * back + N[2] * up + R[2] * out + jz,
          col, (0.38 + rn() * 0.3) * this.scale * (water ? 1.3 : 1),
        );
      }
    }
  }

  /** Each wheel's dust colour, sampled again once it has moved half a metre. */
  wheelColour(w, x, y, z) {
    const at = this.colAt, c = this.cols[w];
    const dx = x - at[w * 3], dy = y - at[w * 3 + 1], dz = z - at[w * 3 + 2];
    if (!c.fresh || dx * dx + dy * dy + dz * dz > 0.25) {
      const l = Math.hypot(x, y, z) || 1;
      dustColor(this.b.body, x / l, y / l, z / l, c);
      c.fresh = true;
      at[w * 3] = x; at[w * 3 + 1] = y; at[w * 3 + 2] = z;
    }
    return c;
  }

  /**
   * A ring of dust bursting out along the ground from under the buggy: `n` grains at `speed`
   * (m/s), puffing up by `up`. `drop` lowers the centre (the jets blow from above the ground).
   */
  ring(n, speed, up, size, drop = 0) {
    const b = this.b, U = this.U, R = this.R, F = this.F;
    if (this.submerged) {
      this.bubbles(Math.ceil(n / 2), 1.5);
      return;
    }
    const col = this.colourUnder();
    const rn = this.rand;
    const d = b.kind.ride + drop;
    const cx = b.p[0] - U[0] * d, cy = b.p[1] - U[1] * d, cz = b.p[2] - U[2] * d;
    const water = col.water;
    for (let k = 0; k < n; k++) {
      const a = ((k + rn() * 0.8) / n) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const ox = R[0] * c + F[0] * s, oy = R[1] * c + F[1] * s, oz = R[2] * c + F[2] * s;
      const sp = speed * (0.7 + rn() * 0.6);
      const u = up * (0.5 + rn()) * (water ? 1.8 : 1);
      const off = 0.5 + rn() * 0.6;
      if (this.grain(
        cx + ox * off, cy + oy * off, cz + oz * off,
        ox * sp + U[0] * u, oy * sp + U[1] * u, oz * sp + U[2] * u,
        col, size * (0.8 + rn() * 0.5),
      ) < 0) break;
    }
  }

  /** Landing: a puff of dust, bigger the harder we came down. */
  thump(impact) {
    if (impact < 1.2) return;
    this.frame();
    const n = Math.round(Math.min(30, 4 + (impact - 1.2) * 5));
    this.ring(n, 0.8 + impact * 0.35, 0.4 + impact * 0.12, (0.45 + Math.min(0.5, impact * 0.05)) * this.scale);
  }

  /** The Hopper jumps: a ring of dust and a flash from the jets (a big one for a super hop). */
  takeOff(superHop = false) {
    this.frame();
    this.air = 0;
    if (superHop) {
      this.ring(28, 4.5, 1.2, 0.7);
      for (let i = 0; i < 14; i++) this.jet(-1, 4 + this.rand() * 4, 0.7);
    } else {
      this.ring(16, 3, 0.8, 0.55);
    }
    const U = this.U;
    for (let k = 0; k < this.jets.length; k++) {
      for (let i = 0; i < 4; i++) this.flame(k, -U[0] * 6, -U[1] * 6, -U[2] * 6, 0.55, 0.3);
    }
  }

  /** A flame at nozzle k, moving at (vx, vy, vz) plus a little jitter and the buggy's speed. */
  flame(k, vx, vy, vz, size, life) {
    const b = this.b, U = this.U, R = this.R, F = this.F, rn = this.rand;
    if (!this.jets.length) return -1;
    const j = this.jets[k % this.jets.length];
    const x = b.p[0] + R[0] * j[0] + U[0] * j[1] + F[0] * j[2];
    const y = b.p[1] + R[1] * j[0] + U[1] * j[1] + F[1] * j[2];
    const z = b.p[2] + R[2] * j[0] + U[2] * j[1] + F[2] * j[2];
    const c = FLAME_COLS[Math.floor(rn() * FLAME_COLS.length)];
    const jx = (rn() - 0.5) * 1.2, jy = (rn() - 0.5) * 1.2, jz = (rn() - 0.5) * 1.2;
    return this.emit(x, y, z, b.v[0] + vx + jx, b.v[1] + vy + jy, b.v[2] + vz + jz, c[0], c[1], c[2],
      size * (0.8 + rn() * 0.4), { kind: FLAME_KIND, grav: 0, drag: 3, life: life * (0.8 + rn() * 0.4), grow: 1.8, alpha: 0.95 });
  }

  /**
   * One puff from the orbit jets (the Nibble super hop), blowing backwards (dir -1) or
   * forwards (+1, braking): mostly flame, with a little grey smoke that hangs about.
   */
  jet(dir, speed, size = 0.5) {
    const F = this.F, rn = this.rand;
    this.frame();
    const k = Math.floor(rn() * Math.max(1, this.jets.length));
    const vx = F[0] * dir * speed, vy = F[1] * dir * speed, vz = F[2] * dir * speed;
    if (rn() < 0.75) return this.flame(k, vx, vy, vz, size, 0.6);
    const i = this.flame(k, vx, vy, vz, size, 0.9);
    if (i >= 0) {
      // Smoke, not fire: a pale, lit puff instead.
      const pool = this.pool;
      pool.kind[i] = DUST_KIND;
      pool.col[i * 3] = pool.col[i * 3 + 1] = pool.col[i * 3 + 2] = 0.88;
      pool.alpha[i] = 0.6;
    }
    return i;
  }

  /**
   * At the lava's edge (#45): a puff of steam and smoke rising from where the buggy's nose
   * meets the heat (`hard`: how hard it pushed, m/s), with a few glowing sparks spat up.
   * `out`: the unit way out of the lava (the buggy's shoreOut()).
   */
  steam(hard, out) {
    const b = this.b, U = this.U, rn = this.rand;
    this.frame();
    const d = 1.4 + b.kind.ride; // just in front, towards the lava, at the ground
    const cx = b.p[0] - out[0] * d - U[0] * b.kind.ride, cy = b.p[1] - out[1] * d - U[1] * b.kind.ride, cz = b.p[2] - out[2] * d - U[2] * b.kind.ride;
    const n = Math.round(Math.min(14, 5 + hard * 3));
    for (let i = 0; i < n; i++) {
      const jx = (rn() - 0.5) * 1.6, jy = (rn() - 0.5) * 1.6, jz = (rn() - 0.5) * 1.6;
      const up = 1.2 + rn() * 1.6;
      const grey = i % 3 === 0 ? 0.45 : 0.95;
      if (this.emit(cx + jx, cy + jy, cz + jz, U[0] * up + jx * 0.4, U[1] * up + jy * 0.4, U[2] * up + jz * 0.4,
        grey, grey * 0.97, grey * 0.94, (0.6 + rn() * 0.5) * this.scale, { grav: -0.15, drag: 1.4, life: 1.6 + rn() * 0.8, grow: 3, alpha: 0.7 }) < 0) return;
    }
    for (let i = 0; i < 4; i++) {
      const c = FLAME_COLS[i % FLAME_COLS.length];
      const jx = (rn() - 0.5) * 2, jy = (rn() - 0.5) * 2, jz = (rn() - 0.5) * 2;
      const up = 2 + rn() * 2;
      this.emit(cx, cy, cz, U[0] * up + jx, U[1] * up + jy, U[2] * up + jz, c[0], c[1] * 0.8, c[2] * 0.5,
        0.25, { kind: FLAME_KIND, grav: 1, drag: 0.5, life: 0.7 + rn() * 0.4, grow: 0.6, alpha: 1 });
    }
  }

  /** A wisp of steam drifting up off the lava just ahead (#45): by its edge, now and then. */
  wisp(out) {
    const b = this.b, U = this.U, rn = this.rand;
    this.frame();
    const d = 3 + rn() * 3;
    const sx = (rn() - 0.5) * 4;
    const R = this.R;
    const x = b.p[0] - out[0] * d + R[0] * sx - U[0] * b.kind.ride, y = b.p[1] - out[1] * d + R[1] * sx - U[1] * b.kind.ride, z = b.p[2] - out[2] * d + R[2] * sx - U[2] * b.kind.ride;
    return this.emit(x, y, z, U[0] * 1.2, U[1] * 1.2, U[2] * 1.2, 0.96, 0.94, 0.92, 0.7, { grav: 0, drag: 0.8, life: 2.2, grow: 3.2, alpha: 0.4 });
  }

  /** Ducky's gas jets (#13): pale fizz rising from under the wheels (gas, so it doesn't fall). */
  fizz() {
    const b = this.b, U = this.U, rn = this.rand;
    this.frame();
    const d = b.kind.ride + 0.3;
    const jx = (rn() - 0.5) * 1.5, jy = (rn() - 0.5) * 1.5, jz = (rn() - 0.5) * 1.5;
    const up = 2 + rn() * 2;
    return this.emit(
      b.p[0] - U[0] * d + jx, b.p[1] - U[1] * d + jy, b.p[2] - U[2] * d + jz,
      U[0] * up + jx, U[1] * up + jy, U[2] * up + jz,
      0.93, 0.96, 1, 0.7, { grav: 0, drag: 1.2, life: 1.1, grow: 2.6, alpha: 0.8 },
    );
  }

  /**
   * The Hopper's jets while jump is held: a flicker under the nozzles as it rises after a hop
   * (or while the orbit jets fire), and, close to the ground, dust blown out from underneath.
   */
  hopperJets(dt, input) {
    const b = this.b;
    if (!this.jets.length || b.grounded) return;
    const rising = !b.orbiting && input.jump && this.air < 0.7;
    const firing = rising || b.jets || b.braking;
    if (!firing) return;
    const U = this.U;
    if (rising && this.rand() < dt * 40) {
      this.flame(Math.floor(this.rand() * this.jets.length), -U[0] * 5, -U[1] * 5, -U[2] * 5, 0.4, 0.22);
    }
    // Close to the ground the blast kicks up a little dust.
    const alt = b.altitude;
    if (alt < 4 && this.rand() < dt * 30 * (1 - alt / 4)) this.ring(1, 2.5, 0.4, 0.45, alt);
  }
}
