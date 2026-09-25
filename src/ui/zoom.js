// Zoom maths, kept pure so it can be tested headlessly. Every mode zooms in real camera
// distances with fixed limits, so the reachable range never depends on where the rocket is
// or how often the map was re-fitted (issue #18).

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Flight camera: always able to get right up to the rocket, or back far enough to see a world. */
export const FLIGHT_ZOOM = [12, 15000];
/** Buggy chase camera. */
export const DRIVE_ZOOM = [5, 100];
/** Half the width of the whole solar system (Ringo's orbit plus its sphere of influence). */
export const SYSTEM_EXTENT = 45000;

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
