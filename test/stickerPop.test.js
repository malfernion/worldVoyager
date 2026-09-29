// The sticker that pops up (#62: it covered Pip's words on phones) goes clear of Pip's bubble, on
// screen and clear of the top bar and bottom buttons, at phone and tablet sizes.
import { describe, it, expect } from 'vitest';
import { stickerSpot, STICKER_POP } from '../src/ui/stickerPop.js';

// Pip's bubble as the CSS lays it out: centred, up to 520 px wide (the screen less 32), from
// `top`, `lines` lines of text tall.
function bubbleFor(w, top, lines) {
  const width = Math.min(520, w - 32);
  const left = (w - width) / 2;
  return { left, top, right: left + width, bottom: top + 26 + lines * 22 };
}

const SIZES = [
  [375, 667], [390, 844], [667, 375], [844, 390], [1024, 768], [768, 1024], [1180, 820], [932, 430],
];

describe('the sticker pop (#62)', () => {
  for (const [w, h] of SIZES) {
    for (const lines of [1, 3, 5, 7]) {
      it(`${w}×${h}, a ${lines}-line bubble: never over Pip's words, on screen`, () => {
        const top = h < 450 ? 156 : 122; // (#pip's top on short landscape phones and elsewhere)
        const b = bubbleFor(w, top, lines);
        const s = stickerSpot({ w, h }, b);
        const hw = (STICKER_POP.w * s.scale) / 2, hh = (STICKER_POP.h * s.scale) / 2;
        const box = { left: s.x - hw, right: s.x + hw, top: s.y - hh, bottom: s.y + hh };
        const overlaps = box.left < b.right && box.right > b.left && box.top < b.bottom && box.bottom > b.top;
        expect(overlaps).toBe(false);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(w);
        expect(box.top).toBeGreaterThanOrEqual(STICKER_POP.top - 1e-9);
        expect(box.bottom).toBeLessThanOrEqual(h - STICKER_POP.bottom + 1e-9);
        // Still big enough to see (bigger on tablets).
        expect(s.scale).toBeGreaterThan(w >= 700 && h >= 700 ? 0.9 : 0.3);
      });
    }
  }

  it('the discovery case from the screenshots: a landscape phone with a long line goes beside the bubble', () => {
    const b = bubbleFor(844, 156, 5);
    const s = stickerSpot({ w: 844, h: 390 }, b);
    expect(['left', 'right']).toContain(s.where);
    expect(s.scale).toBeGreaterThan(0.5);
  });

  it('with no bubble showing it sits in the middle', () => {
    const s = stickerSpot({ w: 1024, h: 768 }, null);
    expect(s.x).toBe(512);
    expect(s.scale).toBe(1);
  });
});
