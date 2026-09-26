// Zoom maths, kept pure so it can be tested headlessly. Every mode zooms in real camera
// distances with fixed limits, so the reachable range never depends on where the rocket is
// or how often the map was re-fitted (issue #18).

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Flight camera: always able to get right up to the rocket, or back far enough to see a world. */
export const FLIGHT_ZOOM = [12, 15000];
/** Buggy chase camera. */
export const DRIVE_ZOOM = [5, 100];
/** Half the width of the whole solar system (Tumble's orbit plus its sphere of influence). */
export const SYSTEM_EXTENT = 72000;
/** The map's default view of Ember's space: every planet's orbit, out to Tumble's. */
export const SYSTEM_VIEW = 63000;

/** The automatic follow distance: further out the higher we fly. */
export function flightAutoDist(alt) {
  return clamp(26 + Math.max(0, alt) * 0.85, 26, 6000);
}

/** Flight camera distance: the player's multiplier on the automatic distance, clamped absolutely. */
export function flightDist(auto, zoom) {
  return clamp(auto * zoom, FLIGHT_ZOOM[0], FLIGHT_ZOOM[1]);
}

/** The multiplier that puts the flight camera at `dist` (clamped) for this automatic distance. */
export function flightZoomFor(auto, dist) {
  return clamp(dist, FLIGHT_ZOOM[0], FLIGHT_ZOOM[1]) / auto;
}

/** Camera distance that fits `extent` (half-width) on screen, for a vertical fov in degrees. */
export function fitDist(extent, fovDeg, aspect) {
  return extent / Math.tan((fovDeg * Math.PI) / 360) / Math.min(1, aspect);
}

/** Map limits: from framing the focused world (3× its radius) out to the whole solar system. */
export function mapZoomLimits(radius, fovDeg, aspect) {
  return [fitDist(radius * 3, fovDeg, aspect), fitDist(SYSTEM_EXTENT, fovDeg, aspect)];
}

/** Slider position (0..1000, left = close) to a distance, logarithmically. */
export function sliderToDist(v, [lo, hi]) {
  return lo * Math.pow(hi / lo, clamp(v, 0, 1000) / 1000);
}

export function distToSlider(d, [lo, hi]) {
  return clamp((Math.log(d / lo) / Math.log(hi / lo)) * 1000, 0, 1000);
}

// ---- Keeping the view steady when a new world takes over (#49) ----
//
// The automatic follow distance comes from the height above the world we're in, so at an SOI
// hand-off it would jump (entering Pebble: about 1030 m to 210 m in one frame). Instead the
// hand-off leaves a `carry`, a multiplier on the automatic distance that keeps the camera where
// it was, and that eases back to 1 only while it's calm: never during a burn or close to the
// ground, and over a second or two.

/** Below this height (m) the view never eases after a hand-off. */
export const HANDOFF_LOW = 30;
/** How fast a hand-off's leftover eases away: its e-folding time in seconds (about 2 s to settle). */
export const CARRY_TAU = 0.6;
/** The fastest the view's "down" turns toward a new world after a hand-off (rad/s). */
export const HANDOFF_TURN = 1.5;

/** The carry that keeps the camera distance the same when the automatic distance goes from `oldAuto` to `newAuto`. */
export function handoffCarry(carry, oldAuto, newAuto) {
  return (carry * oldAuto) / newAuto;
}

/**
 * How calm it is for the view to settle after a hand-off, 0..1: 0 during a burn or close to
 * the ground (still landed is calm), slower low down.
 */
export function handoffCalm(throttle, alt, landed) {
  if (landed) return 1;
  if (throttle > 0 || alt < HANDOFF_LOW) return 0;
  return Math.min(1, 0.3 + (alt - HANDOFF_LOW) / 150);
}

/** The fastest the carry eases, in log-distance per second (2: about 3% a frame). */
export const CARRY_RATE = 2;

/** One frame of the carry easing back to 1, at `calm` speed: exponential, but never faster than CARRY_RATE. */
export function easeCarry(carry, dt, calm) {
  if (carry === 1 || !(calm > 0)) return carry;
  const l = Math.log(carry);
  const step = Math.min(Math.abs(l) * (1 - Math.exp((-dt * calm) / CARRY_TAU)), CARRY_RATE * calm * dt);
  const left = l - Math.sign(l) * step;
  return Math.abs(left) < 1e-3 ? 1 : Math.exp(left);
}
