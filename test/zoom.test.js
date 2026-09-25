import { describe, it, expect } from 'vitest';
import {
  clamp, FLIGHT_ZOOM, DRIVE_ZOOM, SYSTEM_EXTENT, SYSTEM_VIEW, flightAutoDist, flightDist, flightZoomFor,
  fitDist, mapZoomLimits, sliderToDist, distToSlider,
} from '../src/ui/zoom.js';
import { createSystem } from '../src/physics/bodies.js';

const FOV = 50;

describe('zoom in real distances (#18)', () => {
  it('flight camera reaches the same min and max at the pad and in deep space', () => {
    for (const alt of [0, 100, 2000, 30000]) {
      const auto = flightAutoDist(alt);
      let zoom = 1;
      // Pinch all the way in, then all the way out, like zoomBy does.
      for (let i = 0; i < 200; i++) zoom = flightZoomFor(auto, flightDist(auto, zoom) * 0.8);
      expect(flightDist(auto, zoom)).toBeCloseTo(FLIGHT_ZOOM[0]);
      for (let i = 0; i < 200; i++) zoom = flightZoomFor(auto, flightDist(auto, zoom) * 1.25);
      expect(flightDist(auto, zoom)).toBeCloseTo(FLIGHT_ZOOM[1]);
    }
  });

  it('the automatic flight distance is always inside the limits', () => {
    for (const alt of [0, 50, 1000, 1e6]) {
      const d = flightDist(flightAutoDist(alt), 1);
      expect(d).toBeGreaterThanOrEqual(FLIGHT_ZOOM[0]);
      expect(d).toBeLessThanOrEqual(FLIGHT_ZOOM[1]);
    }
    // The follow still pulls back as we climb.
    expect(flightDist(flightAutoDist(3000), 1)).toBeGreaterThan(flightDist(flightAutoDist(0), 1));
  });

  it('map limits never drift across view toggles and re-fits', () => {
    const system = createSystem();
    for (const aspect of [0.46, 1.8]) {
      for (const body of system.bodies) {
        const first = mapZoomLimits(body.radius, FOV, aspect);
        // Frames the world at about 3× its radius, and the whole system at the far end.
        expect(first[0]).toBeCloseTo(fitDist(body.radius * 3, FOV, aspect));
        expect(first[1]).toBeGreaterThan(fitDist(SYSTEM_VIEW, FOV, aspect));
        // Re-fit to ever larger orbits (what fitMap does on each toggle): the limits stay put,
        // and every default view is inside them.
        for (let extent = body.radius * 3; extent < SYSTEM_EXTENT * 2; extent *= 1.7) {
          const [lo, hi] = mapZoomLimits(body.radius, FOV, aspect);
          expect([lo, hi]).toEqual(first);
          const fitted = clamp(fitDist(extent, FOV, aspect), lo, hi);
          expect(fitted).toBeGreaterThanOrEqual(lo);
          expect(fitted).toBeLessThanOrEqual(hi);
        }
      }
    }
  });

  it('the map can always see the whole solar system, out to the farthest world (#11)', () => {
    const planets = createSystem().bodies.filter((b) => b.parent?.kind === 'star');
    for (const b of planets) {
      // Out to the far end of a stretched orbit (the comet, #13).
      expect(SYSTEM_VIEW).toBeGreaterThan(b.apoapsis + b.radius);
      expect(SYSTEM_EXTENT).toBeGreaterThanOrEqual(b.apoapsis + b.soi);
    }
    expect(SYSTEM_VIEW).toBeLessThan(SYSTEM_EXTENT);
  });

  it('the slider mapping round-trips in every mode', () => {
    const ranges = [FLIGHT_ZOOM, DRIVE_ZOOM, mapZoomLimits(30, FOV, 0.5), mapZoomLimits(1500, FOV, 1.6)];
    for (const range of ranges) {
      expect(sliderToDist(0, range)).toBeCloseTo(range[0]);
      expect(sliderToDist(1000, range)).toBeCloseTo(range[1]);
      for (const v of [0, 1, 250, 500, 999, 1000]) expect(distToSlider(sliderToDist(v, range), range)).toBeCloseTo(v, 6);
      // Out-of-range distances pin the slider to its ends.
      expect(distToSlider(range[0] / 10, range)).toBe(0);
      expect(distToSlider(range[1] * 10, range)).toBe(1000);
    }
  });
});
