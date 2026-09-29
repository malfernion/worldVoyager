// Where the sticker that pops up (a discovery's, a landing's, …) goes on screen, so it never covers
// Pip's words (#62: the round picture sat on top of the speech bubble on phones). Pure, so it's
// tested at phone and tablet sizes; main.js places #sticker-pop with it once Pip's line is showing.

/**
 * The sticker pop's size (the round picture and its name under it, CSS px, at scale 1), the gap
 * it keeps from the bubble and the screen's edges (`gap`, `side`), the top bar and the bottom row
 * of buttons it keeps clear of (`top`, `bottom`), and the smallest it may shrink to (`min`).
 */
export const STICKER_POP = { w: 230, h: 212, gap: 10, side: 8, top: 64, bottom: 100, min: 0.45 };

/**
 * Where the sticker goes: { x, y (its middle, CSS px), scale } for a screen `view` { w, h, and
 * optionally top, bottom: the free band between the top bar and the buttons at the bottom, CSS px,
 * when the page knows them better than STICKER_POP's defaults } and the speech bubble's box
 * `bubble` { left, top, right, bottom } (or null if it isn't showing).
 * It takes the free space round the bubble where it can be biggest (below, beside it, above),
 * never overlapping it, shrinking to fit a small screen.
 */
export function stickerSpot(view, bubble, P = STICKER_POP) {
  const fit = (w, h) => Math.min(1, w / P.w, h / P.h);
  const bottom = view.bottom ?? view.h - P.bottom;
  const top = view.top ?? P.top;
  if (!bubble || bubble.bottom <= bubble.top) {
    const s = Math.max(P.min, fit(view.w - 2 * P.side, bottom - top));
    return { x: view.w / 2, y: Math.min(view.h * 0.42, (top + bottom) / 2), scale: s };
  }
  // The free boxes round the bubble: [left, top, right, bottom].
  const regions = [
    ['below', P.side, bubble.bottom + P.gap, view.w - P.side, bottom],
    ['left', P.side, top, bubble.left - P.gap, bottom],
    ['right', bubble.right + P.gap, top, view.w - P.side, bottom],
    ['above', P.side, top, view.w - P.side, bubble.top - P.gap],
  ];
  let best = null;
  for (const [name, l, t, r, b] of regions) {
    const w = r - l, h = b - t;
    if (w <= 0 || h <= 0) continue;
    const s = fit(w, h);
    // (Below is where it reads best, so it wins a near tie.)
    if (!best || s > best.s + 0.02) best = { name, l, t, r, b, s };
  }
  if (!best) return { x: view.w / 2, y: view.h / 2, scale: P.min, where: 'none' };
  const s = best.s;
  const half = { w: (P.w * s) / 2, h: (P.h * s) / 2 };
  const clampX = (x) => Math.min(best.r - half.w, Math.max(best.l + half.w, x));
  let x, y;
  if (best.name === 'below') {
    x = clampX(view.w / 2);
    y = best.t + half.h; // just under the bubble
  } else if (best.name === 'above') {
    x = clampX(view.w / 2);
    y = best.b - half.h;
  } else {
    x = (best.l + best.r) / 2;
    y = Math.min(best.b - half.h, Math.max(best.t + half.h, (bubble.top + bubble.bottom) / 2));
  }
  return { x, y, scale: s, where: best.name };
}
