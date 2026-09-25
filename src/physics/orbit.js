// 2D two-body orbital mechanics.
// Everything lives in one plane: positions/velocities are plain numbers relative to the
// body whose sphere of influence (SOI) we are in. Propagation uses the universal-variable
// formulation so circular, elliptic, parabolic and hyperbolic paths all work the same way.

const TWO_PI = Math.PI * 2;

function stumpC(z) {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 0.5 - z / 24;
}

function stumpS(z) {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120;
}

/**
 * Propagate a state by dt seconds under gravity parameter mu.
 * Writes into `out` ({x,y,vx,vy}) and returns it.
 */
export function propagate(mu, x, y, vx, vy, dt, out = {}) {
  const r0 = Math.hypot(x, y);
  const v02 = vx * vx + vy * vy;
  const sqmu = Math.sqrt(mu);
  const rv = x * vx + y * vy;
  const alpha = 2 / r0 - v02 / mu;

  if (dt === 0) {
    out.x = x; out.y = y; out.vx = vx; out.vy = vy;
    return out;
  }
  // Closed orbits repeat, so only propagate the remainder of a period.
  if (alpha > 1e-12) {
    const period = TWO_PI / Math.sqrt(mu * alpha * alpha * alpha);
    if (Math.abs(dt) > period) dt %= period;
  }

  let chi;
  if (alpha > 1e-12) {
    chi = sqmu * alpha * dt;
  } else if (alpha < -1e-12) {
    const a = 1 / alpha;
    const s = Math.sign(dt);
    const arg = (-2 * mu * alpha * dt) / (rv + s * Math.sqrt(-mu * a) * (1 - r0 * alpha));
    chi = arg > 0 ? s * Math.sqrt(-a) * Math.log(arg) : sqmu * dt / r0;
  } else {
    chi = sqmu * dt / r0;
  }

  // Laguerre iteration (robust for all conic types).
  const c1 = rv / sqmu;
  const c2 = 1 - alpha * r0;
  let C = 0.5, S = 1 / 6, z = 0;
  for (let i = 0; i < 60; i++) {
    z = alpha * chi * chi;
    C = stumpC(z);
    S = stumpS(z);
    const F = c1 * chi * chi * C + c2 * chi * chi * chi * S + r0 * chi - sqmu * dt;
    const dF = c1 * chi * (1 - z * S) + c2 * chi * chi * C + r0;
    const ddF = c1 * (1 - z * C) + c2 * chi * (1 - z * S);
    const n = 5;
    const disc = Math.sqrt(Math.abs((n - 1) * (n - 1) * dF * dF - n * (n - 1) * F * ddF));
    const denom = dF + Math.sign(dF || 1) * disc;
    const delta = denom !== 0 ? (n * F) / denom : F / dF;
    chi -= delta;
    if (Math.abs(delta) < 1e-9 * Math.max(1, Math.abs(chi))) break;
  }
  z = alpha * chi * chi;
  C = stumpC(z);
  S = stumpS(z);

  const f = 1 - (chi * chi / r0) * C;
  const g = dt - (chi * chi * chi * S) / sqmu;
  const nx = f * x + g * vx;
  const ny = f * y + g * vy;
  const r = Math.hypot(nx, ny);
  const fdot = (sqmu / (r * r0)) * (alpha * chi * chi * chi * S - chi);
  const gdot = 1 - (chi * chi / r) * C;
  out.x = nx;
  out.y = ny;
  out.vx = fdot * x + gdot * vx;
  out.vy = fdot * y + gdot * vy;
  return out;
}

/** Orbital elements for drawing and for the "high point / low point" markers. */
export function elements(mu, x, y, vx, vy) {
  const r = Math.hypot(x, y);
  const v2 = vx * vx + vy * vy;
  const h = x * vy - y * vx;
  const rv = x * vx + y * vy;
  const ex = ((v2 - mu / r) * x - rv * vx) / mu;
  const ey = ((v2 - mu / r) * y - rv * vy) / mu;
  const energy = v2 / 2 - mu / r;
  const a = Math.abs(energy) > 1e-12 ? -mu / (2 * energy) : Infinity;
  // Near-vertical flights have e ~ 1; trust the energy to decide open vs closed.
  let e = Math.hypot(ex, ey);
  if (a > 0 && e >= 1) e = 1 - 1e-9;
  const p = (h * h) / mu;
  const dir = h >= 0 ? 1 : -1;
  const argp = e > 1e-7 ? Math.atan2(ey, ex) : Math.atan2(y, x);
  const rp = p / (1 + e);
  const ra = e < 1 && a > 0 ? a * (1 + e) : Infinity; // a(1+e) stays accurate for near-vertical paths
  // True anomaly measured in the direction of motion.
  const nu = wrapPi(dir * (Math.atan2(y, x) - argp));
  const el = { mu, e, a, p, h, dir, argp, rp, ra, nu, energy, period: Infinity, timeToPe: null, timeToAp: null };

  if (e < 1 && a > 0) {
    const n = Math.sqrt(mu / (a * a * a));
    el.period = TWO_PI / n;
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
    let M = E - e * Math.sin(E);
    if (M < 0) M += TWO_PI;
    el.timeToPe = (TWO_PI - M) / n;
    el.timeToAp = ((Math.PI - M + TWO_PI) % TWO_PI) / n;
  } else if (e > 1) {
    const n = Math.sqrt(mu / (-a * -a * -a));
    const F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
    const M = e * Math.sinh(F) - F;
    el.timeToPe = M < 0 ? -M / n : null;
  }
  return el;
}

/** Radius on the conic at true anomaly nu. */
export function radiusAt(el, nu) {
  return el.p / (1 + el.e * Math.cos(nu));
}

/** Local-frame point on the conic at true anomaly nu. */
export function pointAt(el, nu, out = {}) {
  const r = radiusAt(el, nu);
  const ang = el.argp + el.dir * nu;
  out.x = r * Math.cos(ang);
  out.y = r * Math.sin(ang);
  return out;
}

/** True anomaly of a local-frame position on this orbit. */
export function anomalyOf(el, x, y) {
  return wrapPi(el.dir * (Math.atan2(y, x) - el.argp));
}

/** Largest |nu| reachable before the path exceeds radius rMax (Infinity if never). */
export function anomalyLimit(el, rMax) {
  const c = (el.p / rMax - 1) / el.e;
  if (el.e < 1e-9 || c <= -1) return Infinity;
  if (c >= 1) return 0;
  return Math.acos(c);
}

export function wrapPi(a) {
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}

export function wrap2Pi(a) {
  a %= TWO_PI;
  return a < 0 ? a + TWO_PI : a;
}
