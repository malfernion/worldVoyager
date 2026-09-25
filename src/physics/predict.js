// Trajectory prediction with patched conics: follow the rocket's current conic until it
// hits the ground, leaves the SOI, or falls into a moon's SOI, then continue from there.
import { propagate, elements, anomalyOf, pointAt, anomalyLimit } from './orbit.js';

const tmpA = {};
const tmpB = {};

function trace(cur, opts, closestRef) {
  const { body } = cur;
  const mu = body.mu;
  const el = elements(mu, cur.x, cur.y, cur.vx, cur.vy);
  const closed = el.e < 1 && el.ra < body.soi;
  let horizon = closed ? el.period : opts.maxTime;
  horizon = Math.min(horizon, opts.maxTime);

  const canImpact = el.rp < body.maxSurface;
  const canExit = !closed && Number.isFinite(body.soi);
  const rMin = el.rp, rMax = closed ? el.ra : Infinity;
  const kids = body.children.filter((c) => c.orbitRadius + c.soi > rMin && c.orbitRadius - c.soi < rMax);
  const target = opts.target && opts.target.parent === body ? opts.target : null;

  const seg = {
    body, t0: cur.t, t1: cur.t + horizon, start: { x: cur.x, y: cur.y, vx: cur.vx, vy: cur.vy },
    el, closed, end: 'none', next: null, endState: null,
  };

  // Don't instantly "re-encounter" the moon we just climbed out of.
  let leftBehind = cur.cameFrom || null;
  const check = (t, p) => {
    const r = Math.hypot(p.x, p.y);
    if (canImpact && r < body.maxSurface && r <= body.surfaceAt(Math.atan2(p.y, p.x))) return { type: 'impact' };
    if (canExit && r > body.soi) return { type: 'exit' };
    for (const c of kids) {
      c.relPos(cur.t + t, tmpB);
      const dx = p.x - tmpB.x, dy = p.y - tmpB.y;
      const inside = dx * dx + dy * dy < c.soi * c.soi;
      if (c === leftBehind) {
        if (!inside) leftBehind = null;
        continue;
      }
      if (inside) return { type: 'encounter', body: c };
    }
    return null;
  };

  let t = 0;
  let prevT = 0;
  let hit = null;
  let guard = 0;
  const p = tmpA;
  while (guard++ < 4000) {
    propagate(mu, cur.x, cur.y, cur.vx, cur.vy, t, p);
    if (target) {
      target.relPos(cur.t + t, tmpB);
      const d = Math.hypot(p.x - tmpB.x, p.y - tmpB.y);
      if (!closestRef.value || d < closestRef.value.dist) {
        closestRef.value = { dist: d, t: cur.t + t, body, rocket: { x: p.x, y: p.y }, target: { x: tmpB.x, y: tmpB.y } };
      }
    }
    if (t > 0) {
      hit = check(t, p);
      if (hit) break;
    }
    if (t >= horizon) break;
    const r = Math.hypot(p.x, p.y);
    const v = Math.hypot(p.vx, p.vy) || 1e-6;
    let dt = (0.018 * r) / v;
    if (r < body.maxSurface * 1.3) dt = Math.min(dt, 1.5 / v);
    dt = Math.max(0.02, Math.min(dt, horizon / 40));
    prevT = t;
    t = Math.min(horizon, t + dt);
  }

  if (hit) {
    // Refine the event time by bisection.
    let lo = prevT, hi = t;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      propagate(mu, cur.x, cur.y, cur.vx, cur.vy, mid, p);
      const h = check(mid, p);
      if (h && h.type === hit.type && h.body === hit.body) hi = mid; else lo = mid;
    }
    const end = propagate(mu, cur.x, cur.y, cur.vx, cur.vy, hi, {});
    seg.t1 = cur.t + hi;
    seg.end = hit.type;
    seg.endState = end;
    seg.next = hit.type === 'exit' ? body.parent : hit.type === 'encounter' ? hit.body : null;
  } else {
    seg.endState = propagate(mu, cur.x, cur.y, cur.vx, cur.vy, horizon, {});
    seg.t1 = cur.t + horizon;
  }
  return seg;
}

/**
 * Predict up to `maxSegments` patched-conic segments.
 * Returns { segments, closest } where closest is the nearest approach to opts.target
 * (only tracked while in the target's parent SOI).
 */
export function predict(state, opts = {}) {
  const o = { maxSegments: 3, maxTime: 30000, target: null, ...opts };
  const segments = [];
  const closestRef = { value: null };
  let cur = { body: state.body, x: state.x, y: state.y, vx: state.vx, vy: state.vy, t: state.t };
  for (let i = 0; i < o.maxSegments; i++) {
    const seg = trace(cur, o, closestRef);
    segments.push(seg);
    const e = seg.endState;
    if (seg.end === 'exit') {
      const b = seg.body;
      const p = b.relPos(seg.t1), v = b.relVel(seg.t1);
      cur = { body: b.parent, x: e.x + p.x, y: e.y + p.y, vx: e.vx + v.x, vy: e.vy + v.y, t: seg.t1, cameFrom: b };
    } else if (seg.end === 'encounter') {
      const c = seg.next;
      const p = c.relPos(seg.t1), v = c.relVel(seg.t1);
      cur = { body: c, x: e.x - p.x, y: e.y - p.y, vx: e.vx - v.x, vy: e.vy - v.y, t: seg.t1 };
    } else {
      break;
    }
  }
  return { segments, closest: closestRef.value };
}

/** Points (local to the segment's body) tracing the segment's conic, for drawing. */
export function segmentPoints(seg, count = 160) {
  const { el, start, endState } = seg;
  const nu0 = anomalyOf(el, start.x, start.y);
  let nu1;
  if (seg.closed && seg.end === 'none') {
    nu1 = nu0 + Math.PI * 2;
  } else {
    nu1 = anomalyOf(el, endState.x, endState.y);
    if (el.e < 1) {
      while (nu1 < nu0) nu1 += Math.PI * 2;
    } else {
      const lim = anomalyLimit(el, Infinity) - 1e-4;
      nu1 = Math.min(nu1, lim);
    }
  }
  const pts = [];
  const p = {};
  for (let i = 0; i <= count; i++) {
    const nu = nu0 + ((nu1 - nu0) * i) / count;
    pointAt(el, nu, p);
    pts.push(p.x, p.y);
  }
  // Make sure the drawn path ends exactly where the event happens.
  if (!(seg.closed && seg.end === 'none')) {
    pts[pts.length - 2] = endState.x;
    pts[pts.length - 1] = endState.y;
  }
  return pts;
}

/** Periapsis radius of the first segment inside `body`, if the path ever gets there. */
export function arrivalInfo(prediction, body) {
  for (const seg of prediction.segments) {
    if (seg.body === body) return { seg, rp: seg.el.rp, impact: seg.end === 'impact' };
  }
  return null;
}
