import { describe, it, expect } from 'vitest';
import { isZoomed, zoomAction, rescueTransform, ZOOM_EPS } from '../src/ui/pageZoom.js';

describe('page zoom guard (#39)', () => {
  it('only a real zoom-in counts', () => {
    expect(isZoomed(1)).toBe(false);
    expect(isZoomed(1 + ZOOM_EPS / 2)).toBe(false); // rounding noise
    expect(isZoomed(0.8)).toBe(false); // zoomed out: every control is still on screen
    expect(isZoomed(undefined)).toBe(false); // no visualViewport
    expect(isZoomed(NaN)).toBe(false);
    expect(isZoomed(1.1)).toBe(true);
    expect(isZoomed(3)).toBe(true);
  });

  it('does nothing at scale 1, whatever happened before', () => {
    expect(zoomAction(1, 0)).toBe('none');
    expect(zoomAction(1, 5)).toBe('none');
    expect(zoomAction(1.01, 1)).toBe('none');
  });

  it('tries the automatic reset first, then the rescue button', () => {
    expect(zoomAction(2, 0)).toBe('reset');
    expect(zoomAction(2, 1)).toBe('rescue');
    expect(zoomAction(1.5, 3)).toBe('rescue');
  });

  it('fits the HUD into the visible part of the page', () => {
    expect(rescueTransform({ offsetLeft: 100, offsetTop: 40, scale: 2 })).toBe('translate(100px, 40px) scale(0.5)');
    expect(rescueTransform({})).toBe('translate(0px, 0px) scale(1)');
  });
});
