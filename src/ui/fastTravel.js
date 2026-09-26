// Fast travel (#27): tap the predicted path on the map to drop a ⏰ there. Time speeds up at
// once until the rocket gets there (as fast as is safe, slowing down on the way in so it lands
// on the moment), then the game pauses so the child can do what they came for. Tapping the ⏰
// takes it away; steering, GO or the time buttons take over too. Pure: no DOM, no three.js.

export const TAP_RADIUS = 28; // px: how near the path a finger has to land
export const TAP_MOVE = 10; // px: a finger that moved further than this was panning the map
export const MIN_LEAD = 2; // s of game time: not right where the rocket already is
export const CRASH_GAP = 3; // s of game time: never arrive right on top of a crash
export const ARRIVE_LEAD = 0.3; // real seconds: each warp level is kept while arriving takes longer than this

/**
 * Where on the path a ⏰ may go, as game times [from, to], or null if nowhere: from a moment
 * ahead of the rocket to the end of the drawn path (a little before a crash). A crash that now
 * comes before the ⏰ puts it off the path, so travel stops before the ground.
 * segments: the prediction's segments ({ t0, t1, end }); now: the sim time.
 */
export function clockWindow(segments, now) {
  if (!segments?.length) return null;
  const last = segments[segments.length - 1];
  const from = now + MIN_LEAD;
  const to = last.t1 - (last.end === 'impact' ? CRASH_GAP : 0);
  return to > from ? [from, to] : null;
}

/** Is a ⏰ at game time t still on the path? (Otherwise it goes, and travel stops.) */
export function clockOnPath(segments, t, now) {
  const w = clockWindow(segments, now);
  // Still ahead but closer than MIN_LEAD is fine: we're nearly there.
  return !!w && t > now && t <= w[1];
}

/**
 * Can a ⏰ be dropped now? Only on the map, flying, and while the child is the pilot: helpers
 * (autopilot, coach, Faster / Slower) run the clock themselves, so while one is on, taps on
 * the path do nothing. c: { mode, crashed, landed, helper }
 */
export function clockAllowed(c) {
  return c.mode === 'map' && !c.crashed && !c.landed && !c.helper;
}

const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

/**
 * The time on the path nearest a tap, or null if the tap wasn't on it. paths: polylines on
 * screen, each a list of { x, y, t } in time order (null for a point off screen). A tap near
 * a piece of line gets the time interpolated along it; with `at(t) -> { x, y } | null` (the
 * true path on screen) that is refined, since a straight piece cuts the corner of a curve.
 * Where two bits of path cross, the nearer wins, and the sooner one if they're about as near.
 * Returns { t, d } (d in px).
 */
export function pickOnPath(paths, x, y, radius = TAP_RADIUS, at = null) {
  let best = null;
  for (const pts of paths) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (!a || !b) continue;
      const len2 = dist2(a.x, a.y, b.x, b.y);
      const k = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / len2)) : 0;
      const d = Math.sqrt(dist2(x, y, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k));
      if (d > radius * 1.5) continue;
      const t = a.t + (b.t - a.t) * k;
      if (!best || d < best.d - 4 || (d < best.d + 4 && t < best.t)) best = { t, d, t0: a.t, t1: b.t };
    }
  }
  if (!best) return null;
  if (at) {
    // Golden-section search along the true path between the two samples.
    const dAt = (t) => {
      const p = at(t);
      return p ? Math.sqrt(dist2(x, y, p.x, p.y)) : Infinity;
    };
    const g = (Math.sqrt(5) - 1) / 2;
    let lo = best.t0, hi = best.t1;
    for (let i = 0; i < 30; i++) {
      const m1 = hi - g * (hi - lo), m2 = lo + g * (hi - lo);
      if (dAt(m1) < dAt(m2)) hi = m2; else lo = m1;
    }
    const t = (lo + hi) / 2;
    const d = dAt(t);
    if (d < best.d) best = { ...best, t, d };
  }
  return best.d <= radius ? { t: best.t, d: best.d } : null;
}

/**
 * How fast time goes while travelling to a ⏰ `left` game seconds away, this frame of `dt`
 * real seconds. The biggest warp level that still leaves at least ARRIVE_LEAD real seconds to
 * go, so it steps down as the ⏰ comes closer; on the last frame less than normal speed, to
 * land exactly on the moment instead of overshooting. The auto slow-downs before a new world
 * or the ground still apply on top. Returns { index, warp } (index into levels, for the HUD).
 */
export function travelWarp(left, dt, levels) {
  let index = 0;
  for (let i = levels.length - 1; i > 0; i--) {
    if (levels[i] * ARRIVE_LEAD <= left) {
      index = i;
      break;
    }
  }
  const warp = dt > 0 ? Math.min(levels[index], Math.max(0, left) / dt) : levels[index];
  return { index, warp };
}

/** Have we got there? (The last frame steps exactly onto the moment, give or take rounding.) */
export const arrived = (left) => left <= 1e-6;
