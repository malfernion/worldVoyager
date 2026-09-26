import { describe, it, expect, beforeEach } from 'vitest';
import {
  MARKER_LINES, FIRST_SIGHT, SETTLE, EXPLAIN_GAP, calmToExplain, nextToExplain, pickExplanation, labelRank, declutterLabels,
  BUTTON_LINES, buttonExplanation,
} from '../src/ui/markers.js';
import { Progress } from '../src/progress.js';
import { createSystem } from '../src/physics/bodies.js';
import { sentencesOf } from '../src/ui/speech.js';

// Coasting in the map, Pip quiet, no helper: the calmest moment there is.
const calm = (extra = {}) => ({
  screen: 'flight', mode: 'map', crashed: false, speaking: false, throttle: 0, steering: false, sinceLast: Infinity, helper: null, ...extra,
});
const helper = (extra = {}) => ({ mode: 'goto', coach: false, throttle: 0, aiming: false, tricky: false, ...extra });

describe('explaining markers on first sight (#33)', () => {
  it('every marker kind has one short line', () => {
    for (const kind of [...FIRST_SIGHT, 'home', 'secret', 'friend']) {
      const line = MARKER_LINES[kind];
      expect(line, kind).toBeTruthy();
      expect(sentencesOf(line).length).toBeLessThanOrEqual(3);
      for (const s of sentencesOf(line)) expect(s.split(' ').length, s).toBeLessThanOrEqual(10);
    }
  });

  it('pauses only when nothing urgent is going on', () => {
    expect(calmToExplain(calm())).toBe(true);
    expect(calmToExplain(calm({ mode: 'flight' }))).toBe(true);
    // Not on the title screen or while driving, never after a crash.
    expect(calmToExplain(calm({ screen: 'title' }))).toBe(false);
    expect(calmToExplain(calm({ mode: 'drive' }))).toBe(false);
    expect(calmToExplain(calm({ crashed: true }))).toBe(false);
    // Pip is talking (a coach cue, a safety takeover, the lesson, a sticker): wait.
    expect(calmToExplain(calm({ speaking: true }))).toBe(false);
    // The engine is on, or the child is steering.
    expect(calmToExplain(calm({ throttle: 1 }))).toBe(false);
    expect(calmToExplain(calm({ steering: true }))).toBe(false);
    // One at a time, with a breather between.
    expect(calmToExplain(calm({ sinceLast: EXPLAIN_GAP - 0.1 }))).toBe(false);
    expect(calmToExplain(calm({ sinceLast: EXPLAIN_GAP }))).toBe(true);
  });

  it('never breaks into a helper at a tricky bit, a burn or a coach lesson', () => {
    // Pip flying a trip, coasting: fine (the sim just waits).
    expect(calmToExplain(calm({ helper: helper() }))).toBe(true);
    expect(calmToExplain(calm({ helper: helper({ mode: 'orbit' }) }))).toBe(true);
    // Burning, or at a moment the helper wants normal speed for.
    expect(calmToExplain(calm({ helper: helper({ throttle: 1 }) }))).toBe(false);
    expect(calmToExplain(calm({ helper: helper({ tricky: true }) }))).toBe(false);
    // Coaching: only while coasting on a trip, never while asking the child to point somewhere.
    expect(calmToExplain(calm({ helper: helper({ coach: true }) }))).toBe(true);
    expect(calmToExplain(calm({ helper: helper({ coach: true, aiming: true }) }))).toBe(false);
    // The first-launch lesson (a coached orbit) and a coached landing: never.
    expect(calmToExplain(calm({ helper: helper({ coach: true, mode: 'orbit' }) }))).toBe(false);
    expect(calmToExplain(calm({ helper: helper({ coach: true, mode: 'land' }) }))).toBe(false);
  });

  it('explains a kind once it has been on screen a moment, once only, one at a time', () => {
    const explained = new Set();
    const has = (k) => explained.has(k);
    expect(nextToExplain({}, has)).toBe(null);
    // A flicker isn't enough.
    expect(nextToExplain({ high: SETTLE / 2 }, has)).toBe(null);
    expect(nextToExplain({ high: SETTLE }, has)).toBe('high');
    // Several at once: one at a time, in order (the rocket first).
    const all = { rocket: 5, high: 5, low: 5, impact: 5 };
    expect(nextToExplain(all, has)).toBe('rocket');
    explained.add('rocket');
    expect(nextToExplain(all, has)).toBe('high');
    explained.add('high').add('low').add('impact');
    expect(nextToExplain(all, has)).toBe(null);
    // Pins while driving are explained by tapping only.
    expect(nextToExplain({ home: 5, secret: 5 }, () => false)).toBe(null);
  });

  it('picks nothing when it is not calm, even with a new marker showing', () => {
    expect(pickExplanation({ impact: 3 }, () => false, calm())).toBe('impact');
    expect(pickExplanation({ impact: 3 }, () => false, calm({ speaking: true }))).toBe(null);
    expect(pickExplanation({ impact: 3 }, () => true, calm())).toBe(null);
  });
});

describe('saving explained markers (#33)', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    };
  });

  it('an explained marker stays explained next time', () => {
    const p = new Progress();
    expect(p.explained('high')).toBe(false);
    p.markExplained('high');
    expect(p.explained('high')).toBe(true);
    const again = new Progress();
    expect(again.explained('high')).toBe(true);
    expect(again.explained('impact')).toBe(false);
  });

  it('an older save (before #33) still loads, with nothing explained', () => {
    store.set('worldVoyager.v1', JSON.stringify({ done: { space: 1 }, design: { stack: [] }, settings: { coach: true } }));
    const p = new Progress();
    expect(p.has('space')).toBe(true);
    expect(p.settings.coach).toBe(true);
    expect(FIRST_SIGHT.some((k) => p.explained(k))).toBe(false);
    p.markExplained('rocket');
    const again = new Progress();
    expect(again.has('space') && again.explained('rocket')).toBe(true);
  });

  it('a brand new adventure explains them again', () => {
    const p = new Progress();
    p.markExplained('impact');
    p.reset();
    expect(p.explained('impact')).toBe(false);
    expect(new Progress().explained('impact')).toBe(false);
  });
});

describe('autopilot buttons explain themselves once (#36)', () => {
  it('each autopilot button has one short line', () => {
    for (const mode of ['orbit', 'land', 'goto']) {
      expect(sentencesOf(BUTTON_LINES[mode]), mode).toHaveLength(1);
    }
  });

  it('only the first time for each button', () => {
    const done = new Set();
    const explained = (k) => done.has(k);
    const ex = buttonExplanation('orbit', { explained });
    expect(ex.line).toBe(BUTTON_LINES.orbit);
    done.add(ex.key);
    expect(buttonExplanation('orbit', { explained })).toBe(null);
    expect(buttonExplanation('land', { explained })?.line).toBe(BUTTON_LINES.land);
    expect(buttonExplanation('drive', { explained })).toBe(null);
  });

  it('saved alongside the markers, and older saves have none explained', () => {
    const store = new Map([['worldVoyager.v1', JSON.stringify({ done: {}, markers: { high: true } })]]);
    globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
    const p = new Progress();
    const explained = (k) => p.explained(k);
    const ex = buttonExplanation('land', { explained });
    expect(ex).not.toBe(null);
    p.markExplained(ex.key);
    const again = new Progress();
    expect(buttonExplanation('land', { explained: (k) => again.explained(k) })).toBe(null);
    expect(again.explained('high')).toBe(true);
    expect(FIRST_SIGHT.includes(ex.key)).toBe(false);
  });
});

describe('world labels on the map don\'t pile up (#33)', () => {
  const sys = createSystem();
  const { homestead, pebble, ember, ringo, sizzle, frosty, misty, ducky } = sys.byId;
  // A label about 90 × 44 px (icon-only 36 × 34), anchored at its top centre.
  const label = (id, x, y, rank) => ({ id, rank, x, y, w: 90, h: 44, mw: 36, mh: 34 });

  it('ranks the picked world, then the one in focus, planets, Ember, then moons', () => {
    expect(labelRank(pebble, { target: pebble, focus: homestead })).toBe(0);
    expect(labelRank(homestead, { focus: homestead })).toBe(1);
    expect(labelRank(pebble, { here: pebble })).toBe(1);
    // The whole solar system, centred on Ember, from the pad: home wins over Ember.
    expect(labelRank(homestead, { focus: ember, here: homestead })).toBeLessThan(labelRank(ember, { focus: ember, here: homestead }));
    expect(labelRank(ringo)).toBe(2);
    expect(labelRank(ducky)).toBe(2);
    expect(labelRank(ember)).toBe(3);
    expect(labelRank(pebble)).toBe(4);
    expect(labelRank(pebble)).toBeGreaterThan(labelRank(homestead));
  });

  it('labels far apart all show in full', () => {
    const how = declutterLabels([label('a', 100, 100, 2), label('b', 300, 100, 2), label('c', 100, 300, 4)]);
    expect([...how.values()]).toEqual(['full', 'full', 'full']);
  });

  it('a moon on top of its planet hides behind it; a nearby one shrinks to its icon', () => {
    const how = declutterLabels([
      label('pebble', 102, 104, labelRank(pebble)),
      label('homestead', 100, 100, labelRank(homestead)),
    ]);
    expect(how.get('homestead')).toBe('full');
    expect(how.get('pebble')).toBe('hidden');
    // Just beside it: the full label would overlap, the icon fits.
    const near = declutterLabels([
      label('homestead', 100, 100, labelRank(homestead)),
      label('pebble', 175, 100, labelRank(pebble)),
    ]);
    expect(near.get('homestead')).toBe('full');
    expect(near.get('pebble')).toBe('mini');
  });

  it('the picked moon wins over its planet', () => {
    const how = declutterLabels([
      label('ringo', 100, 100, labelRank(ringo, { target: sizzle })),
      label('sizzle', 104, 102, labelRank(sizzle, { target: sizzle })),
      label('frosty', 98, 106, labelRank(frosty, { target: sizzle })),
    ]);
    expect(how.get('sizzle')).toBe('full');
    expect(how.get('ringo')).toBe('hidden');
    expect(how.get('frosty')).toBe('hidden');
    // Misty (#46), Ringo's outer moon, picked: it wins over Ringo and its neighbours.
    const outer = declutterLabels([
      label('ringo', 100, 100, labelRank(ringo, { target: misty })),
      label('sizzle', 104, 102, labelRank(sizzle, { target: misty })),
      label('frosty', 98, 106, labelRank(frosty, { target: misty })),
      label('misty', 102, 98, labelRank(misty, { target: misty })),
    ]);
    expect(outer.get('misty')).toBe('full');
    expect([outer.get('ringo'), outer.get('sizzle'), outer.get('frosty')]).toEqual(['hidden', 'hidden', 'hidden']);
  });

  it('shown labels never overlap', () => {
    // A tight cluster, like Ringo with its moons zoomed right out.
    const items = [];
    for (let i = 0; i < 12; i++) items.push(label(`w${i}`, 200 + ((i * 37) % 120), 200 + ((i * 53) % 80), i % 5));
    const how = declutterLabels(items);
    const boxes = items.filter((it) => how.get(it.id) !== 'hidden').map((it) => {
      const mini = how.get(it.id) === 'mini';
      const w = mini ? it.mw : it.w, h = mini ? it.mh : it.h;
      return { x: it.x - w / 2, y: it.y, w, h };
    });
    expect(boxes.length).toBeGreaterThan(1);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(hit).toBe(false);
      }
    }
  });
});
