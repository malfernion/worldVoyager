// The page itself must never stay zoomed in (#39). iOS WebKit (every iPad browser) ignores
// `user-scalable=no` and `maximum-scale`, so a pinch or double-tap in the wrong spot can zoom
// the whole page, leaving the controls off screen. We block WebKit's page-zoom gestures, and if
// the page gets zoomed anyway: try to reset it, then fit the HUD into what's visible and show a
// big "zoom back out" button, so a child is never stuck.
//
// The top half is pure (tested); `PageZoom` wires it to the page.

/** Page scales this close to 1 count as not zoomed (rounding, and never a false alarm). */
export const ZOOM_EPS = 0.02;

/** Is the page zoomed in? Browser zoom (Ctrl +/-) leaves visualViewport.scale at 1, so it never counts. */
export function isZoomed(scale) {
  return Number.isFinite(scale) && scale > 1 + ZOOM_EPS;
}

/**
 * What to do at this page scale: 'none' (not zoomed), 'reset' (zoomed: try the automatic reset
 * first), or 'rescue' (still zoomed after a reset: fit the HUD to the visible part and show the
 * zoom-out button).
 */
export function zoomAction(scale, resetTries) {
  if (!isZoomed(scale)) return 'none';
  return resetTries < 1 ? 'reset' : 'rescue';
}

/**
 * CSS transform that fits a full-screen layer (#ui) into the visual viewport: moved to where the
 * visible part is and shrunk by the zoom, so on screen every control is where and as big as usual.
 */
export function rescueTransform({ offsetLeft = 0, offsetTop = 0, scale = 1 }) {
  return `translate(${offsetLeft}px, ${offsetTop}px) scale(${1 / scale})`;
}

/** How long a viewport-meta rewrite stays before the original goes back, and before we look again. */
const RESET_HOLD = 300;
const RESET_CHECK = 700;

export class PageZoom {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.layer  the HUD layer to keep inside the visible part (#ui)
   * @param {HTMLElement} opts.button the big zoom-out button (inside the layer)
   * @param {(on: boolean) => void} [opts.onRescue] called when the rescue shows (true) or ends (false)
   */
  constructor({ layer, button, onRescue = () => {} }) {
    this.layer = layer;
    this.button = button;
    this.onRescue = onRescue;
    this.vv = window.visualViewport || null;
    this.meta = document.querySelector('meta[name=viewport]');
    this.original = this.meta?.content || '';
    this.resetTries = 0;
    this.rescuing = false;
    this.resets = 0; // how many resets we've tried (debugging)
  }

  get scale() {
    return this.vv ? this.vv.scale : 1;
  }

  /** Block the page's own zoom gestures and start watching the visual viewport. */
  listen() {
    // WebKit's pinch gestures (gesturestart/change/end) zoom the page whatever touch-action says.
    // They're separate from pointer events, so the game's own pinch (bindGestures) is untouched.
    // While the page is zoomed we let them through, so a pinch can zoom back out.
    const block = (e) => {
      if (!isZoomed(this.scale)) e.preventDefault();
    };
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(type, block, { passive: false });
    }
    // Two fingers moving on anything (a scroller, the edges) is a page pinch in Safari: stop it.
    // Pointer events still arrive, and one-finger scrolling (tray, sticker book) isn't affected.
    document.addEventListener('touchmove', (e) => {
      if (e.touches.length > 1 && !isZoomed(this.scale)) e.preventDefault();
    }, { passive: false });
    // Double-tap zoom: touch-action (style.css) stops it; this catches browsers that zoom on dblclick.
    document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

    this.button.addEventListener('click', () => {
      this.resetTries = 0; // a tap is a user gesture: try the reset again
      this.check();
    });
    if (this.vv) {
      this.vv.addEventListener('resize', () => this.check());
      this.vv.addEventListener('scroll', () => this.check());
    }
    this.check();
  }

  /** Look at the page scale and do what zoomAction says. */
  check() {
    const act = zoomAction(this.scale, this.resetTries);
    if (act === 'none') {
      this.resetTries = 0;
      this.setRescue(false);
    } else if (act === 'reset') {
      this.resetTries++;
      this.reset();
      clearTimeout(this.checkTimer);
      this.checkTimer = setTimeout(() => this.check(), RESET_CHECK);
    } else {
      this.setRescue(true);
    }
  }

  /** The known iOS trick: rewriting the viewport meta tag makes WebKit re-apply initial-scale=1. */
  reset() {
    this.resets++;
    if (!this.meta) return;
    this.meta.content = 'width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
    clearTimeout(this.restoreTimer);
    this.restoreTimer = setTimeout(() => {
      this.meta.content = this.original;
      window.scrollTo(0, 0);
    }, RESET_HOLD);
  }

  /** Show / move / hide the rescue: the HUD fitted to the visible part and the zoom-out button. */
  setRescue(on) {
    if (on) this.layer.style.transform = rescueTransform(this.vv || {});
    if (on === this.rescuing) return;
    this.rescuing = on;
    this.layer.classList.toggle('page-zoomed', on);
    this.button.classList.toggle('hidden', !on);
    if (!on) this.layer.style.transform = '';
    this.onRescue(on);
  }
}
