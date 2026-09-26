// Screen markers (#33): the icons over the view (▲ ▼ 💥 ✨ 🎯 🔥 ⏰, the rocket arrow, the pins
// while driving). Each kind explains itself: the first time one shows, Pip pauses the game when
// nothing urgent is happening and says one short line while it glows; tapping one says it again.
// The autopilot buttons (🌀 🛬 🤖) explain themselves the same way, once, when first used (#36).
// Also keeps the map's world labels from piling on top of each other. Pure: no DOM, no three.js.

// What Pip says about each kind. Plain string literals, so the voice scanner finds them.
export const MARKER_LINES = {
  rocket: 'That\'s our rocket! The line shows where we\'ll go.',
  high: 'That triangle is the highest we\'ll go!',
  low: 'That triangle is the lowest we\'ll go!',
  impact: 'That boom shows where we would crash!',
  meet: 'Sparkles show where we\'ll meet the world we picked!',
  near: 'That target shows where we\'ll get closest!',
  burn: 'The fire shows where we\'ll fire the engine!',
  home: 'That\'s our rocket! Tap the house to drive back.',
  secret: 'Psst! Follow the sparkles to find a secret!',
  friend: 'Listen! Can you hear music? Follow the notes!',
  clock: 'The clock makes time go fast until we get there! Tap it to stop.',
};

// Autopilot buttons (#36) explain themselves too, once, the first time one is used to fly for
// us. Saved with the markers (`progress.markers`) under `button-<mode>`, so no marker kind clashes.
export const BUTTON_LINES = {
  orbit: 'This button flies us all the way round the planet!',
  land: 'This button lands us nice and softly!',
  goto: 'This button flies us all the way there!',
};

/**
 * The line to say as an autopilot button is used, or null: only when Pip flies (never in coach
 * mode, where the button doesn't fly for you), and only the first time for each button.
 * explained(key) -> bool. Returns { key, line }; the caller saves `key` as explained.
 */
export function buttonExplanation(mode, { coach = false, explained }) {
  const line = BUTTON_LINES[mode];
  const key = `button-${mode}`;
  if (!line || coach || explained(key)) return null;
  return { key, line };
}

// Kinds explained with a pause the first time they show, in this order if several show at once.
// The pins while driving aren't: Pip's compass hints already cover them (tap still explains).
// Nor is the fast travel ⏰ (#27): the child drops it, so Pip explains it then, the first time.
export const FIRST_SIGHT = ['rocket', 'high', 'low', 'impact', 'meet', 'near', 'burn'];

export const SETTLE = 1; // real seconds a marker must have been on screen (not a flicker)
export const EXPLAIN_GAP = 6; // real seconds between one explanation and the next
export const MAX_PAUSE = 12; // the game never stays paused longer than this

/**
 * Is it safe to pause the game for an explanation right now? Only when nothing urgent is going on:
 * Pip isn't talking (a coach cue, a safety takeover, a lesson or a sticker), the engine is off and
 * the child isn't steering, no crash, and no helper is at a tricky bit or burning. A coached
 * helper only allows it while coasting on a trip (never in the first lesson or a coached landing).
 *
 * c: { screen, mode, crashed, speaking, throttle, steering, sinceLast,
 *      helper: null | { mode, coach, throttle, aiming, tricky } }
 */
export function calmToExplain(c) {
  if (c.screen !== 'flight' || c.mode === 'drive' || c.crashed) return false;
  if (c.speaking || c.throttle > 0 || c.steering) return false;
  if (c.sinceLast < EXPLAIN_GAP) return false;
  const h = c.helper;
  if (h) {
    if (h.throttle > 0 || h.tricky) return false;
    if (h.coach && (h.mode !== 'goto' || h.aiming)) return false;
  }
  return true;
}

/**
 * Which kind to explain first, if any: shown long enough, not explained yet.
 * onScreen: { kind: seconds it has been on screen }; explained(kind) -> bool.
 */
export function nextToExplain(onScreen, explained) {
  for (const kind of FIRST_SIGHT) {
    if (!explained(kind) && (onScreen[kind] ?? 0) >= SETTLE) return kind;
  }
  return null;
}

/** Both together: the kind to pause and explain now, or null. */
export function pickExplanation(onScreen, explained, calm) {
  return calmToExplain(calm) ? nextToExplain(onScreen, explained) : null;
}

// ---- world labels on the map ---------------------------------------------------------------

/**
 * Which labels win a crowded spot: the picked world, then the one we're at and the one the map
 * is centred on, then planets (and the comet), then Ember, then moons. Ember never outranks a
 * planet: in the middle of the whole solar system it would hide Homestead.
 */
export function labelRank(body, { target = null, focus = null, here = null } = {}) {
  if (body === target) return 0;
  if (!body.parent) return 3;
  if (body === here || body === focus) return 1;
  return body.parent.parent ? 4 : 2;
}

const overlaps = (a, b, pad) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/**
 * Keep labels apart (#33). items: [{ id, rank, x, y, w, h, mw, mh }] where (x, y) is the label's
 * anchor (top centre, as the CSS places it), w × h its full size and mw × mh its icon-only size.
 * In rank order, each label is shown full if it fits, else icon-only if that fits, else hidden.
 * Returns a Map id -> 'full' | 'mini' | 'hidden'.
 */
export function declutterLabels(items, pad = 2) {
  const out = new Map();
  const placed = [];
  const order = [...items].sort((a, b) => a.rank - b.rank);
  for (const it of order) {
    const full = { x: it.x - it.w / 2, y: it.y, w: it.w, h: it.h };
    const mini = { x: it.x - it.mw / 2, y: it.y, w: it.mw, h: it.mh };
    if (!placed.some((p) => overlaps(p, full, pad))) {
      placed.push(full);
      out.set(it.id, 'full');
    } else if (!placed.some((p) => overlaps(p, mini, pad))) {
      placed.push(mini);
      out.set(it.id, 'mini');
    } else {
      out.set(it.id, 'hidden');
    }
  }
  return out;
}
