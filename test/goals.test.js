// The starter journey (#36): its goals in order, the end of the goals, the later worlds' stickers,
// older saves, and that every goal line is in the voice list.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { Progress, GOALS, STICKERS, STARTER_END, JOURNEY_DONE, goalShown, migrate } from '../src/progress.js';
import { SpeechQueue } from '../src/ui/speechQueue.js';
import { sentencesOf, keyOf } from '../src/ui/speech.js';

const STARTER = ['space', 'orbit', 'land-homestead', 'visit-pebble', 'land-pebble', 'home-again'];
const LATER = ['visit-dusty', 'land-dusty', 'land-nibble', 'visit-ringo', 'land-sizzle', 'land-frosty', 'visit-tumble', 'visit-flip', 'land-flip', 'visit-ducky', 'land-ducky'];

let store;
beforeEach(() => {
  store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
});
const saved = (done) => store.set('worldVoyager.v1', JSON.stringify({ done }));

describe('the starter journey (#36)', () => {
  it('has these goals, in this order, ending with flying home', () => {
    expect(GOALS.map((g) => g.id)).toEqual(STARTER);
    expect(STARTER_END).toBe('home-again');
    for (const g of GOALS) expect(STICKERS[g.id]).toBeTruthy(); // every goal earns a sticker
  });

  it('goes through the goals in order, saying "Next:" after each', () => {
    const p = new Progress();
    expect(p.starterDone).toBe(false);
    for (let i = 0; i < GOALS.length - 1; i++) {
      expect(p.currentGoal.id).toBe(STARTER[i]);
      expect(goalShown(p)).toBe(p.currentGoal);
      p.earn(STARTER[i]);
      expect(p.afterSticker(STARTER[i])).toEqual([`Next: ${GOALS[i + 1].text}`]);
    }
    expect(p.currentGoal.id).toBe('home-again');
  });

  it('ends: no goal, no chip, no "Next:", just that you can fly anywhere', () => {
    const p = new Progress();
    for (const id of STARTER) p.earn(id);
    expect(p.starterDone).toBe(true);
    expect(p.currentGoal).toBe(null);
    expect(goalShown(p)).toBe(null);
    expect(p.afterSticker('home-again')).toEqual([JOURNEY_DONE]);
    // Stickers after the journey bring no "Next:".
    for (const id of ['visit-dusty', 'land-dusty', 'land-homestead', 'find-rover', 'kaboom']) {
      p.earn(id);
      expect(p.afterSticker(id)).toEqual([]);
    }
    // One clip per sentence.
    expect(sentencesOf(JOURNEY_DONE)).toEqual(['You can fly anywhere now!', 'Pick a world on the map.', 'I can fly you there, or show you how!']);
  });

  it('finishing the journey ends it even if an earlier goal was skipped', () => {
    const p = new Progress();
    for (const id of ['space', 'land-homestead', 'visit-pebble', 'land-pebble', 'home-again']) p.earn(id);
    expect(p.has('orbit')).toBe(false);
    expect(p.currentGoal).toBe(null);
  });

  it('later worlds are stickers, not goals, and are still earned as before', () => {
    for (const id of LATER) {
      expect(STICKERS[id]).toBeTruthy();
      expect(GOALS.some((g) => g.id === id)).toBe(false);
    }
    const p = new Progress();
    p.earn('space');
    const heard = [];
    p.on((id) => heard.push(id));
    for (const id of LATER) expect(p.earn(id)).toBe(true);
    expect(heard).toEqual(LATER);
    expect(p.afterSticker('land-dusty')).toEqual([]); // not a goal: no "Next:"
    expect(p.currentGoal.id).toBe('orbit'); // the journey carries on
    expect(new Progress().has('land-ducky')).toBe(true);
  });

  it('queues the end line right after the last sticker line', async () => {
    const said = [];
    const q = new SpeechQueue({ play: (item) => (said.push(item.text), true), gap: 0 });
    const p = new Progress();
    for (const id of STARTER.slice(0, -1)) p.earn(id);
    // As App.onSticker does: the sticker line, then its follow-ups, all through the queue.
    p.on((id) => {
      q.push(STICKERS[id].say, { keep: true });
      for (const next of p.afterSticker(id)) q.push(next, { key: 'goal' });
    });
    p.earn('home-again');
    // The queue's gap is a real (0 ms) timer: wait for timers, not just a few turns of the loop.
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 5));
    expect(said).toEqual([STICKERS['home-again'].say, JOURNEY_DONE]);
  });

  it('landing home and finishing at once: the end line replaces the waiting "Next:"', () => {
    const q = new SpeechQueue({ play: () => new Promise(() => {}) }); // the first line never ends
    const p = new Progress();
    for (const id of ['space', 'orbit', 'visit-pebble', 'land-pebble']) p.earn(id);
    p.on((id) => {
      q.push(STICKERS[id].say, { keep: true });
      for (const next of p.afterSticker(id)) q.push(next, { key: 'goal' });
    });
    p.earn('land-homestead');
    p.earn('home-again');
    expect(q.current.text).toBe(STICKERS['land-homestead'].say);
    expect(q.pending.map((x) => x.text)).toEqual([STICKERS['home-again'].say, JOURNEY_DONE]);
  });
});

describe('older saves (#36)', () => {
  it('a new save starts at the beginning', () => {
    const p = new Progress();
    expect(p.currentGoal.id).toBe('space');
    expect(p.starterDone).toBe(false);
  });

  it('a save partway through carries on from where it is', () => {
    saved({ space: 1, orbit: 2 });
    expect(new Progress().currentGoal.id).toBe('land-homestead');
    saved({ space: 1, orbit: 2, 'land-homestead': 3, 'visit-pebble': 4 });
    expect(new Progress().currentGoal.id).toBe('land-pebble');
  });

  it('a save that got as far as landing on Pebble is asked to fly home and land', () => {
    saved({ space: 1, orbit: 2, 'land-homestead': 3, 'visit-pebble': 4, 'land-pebble': 5, splash: 6, 'find-mirror': 7 });
    const p = new Progress();
    expect(p.starterDone).toBe(false);
    expect(p.currentGoal.id).toBe('home-again');
  });

  it('a save that explored beyond Pebble goes straight into the open game', () => {
    saved({ space: 1, orbit: 2, 'land-homestead': 3, 'visit-pebble': 4, 'land-pebble': 5, 'visit-dusty': 6 });
    const p = new Progress();
    expect(p.starterDone).toBe(true);
    expect(p.currentGoal).toBe(null);
    expect(p.has('visit-dusty')).toBe(true);
    expect(p.has('home-again')).toBe(true);
    p.earn('kaboom'); // saved with the next change
    expect(JSON.parse(store.get('worldVoyager.v1')).done['home-again']).toBe(5);
  });

  it('exploring beyond only counts after landing on Pebble', () => {
    const done = { space: 1, 'visit-dusty': 2, 'land-ducky': 3 };
    expect(migrate(done)).toBe(false);
    expect(done['home-again']).toBeUndefined();
    expect(migrate({ 'land-pebble': 1, 'land-homestead': 2, 'find-footprints': 3 })).toBe(false);
    expect(migrate({ 'land-pebble': 1, 'land-nibble': 2 })).toBe(true);
    expect(migrate({ 'land-pebble': 1, 'home-again': 2, 'land-nibble': 3 })).toBe(false);
  });
});

describe('voice lines (#36)', () => {
  it('lines.json has every goal line, the journey\'s end and the new sticker', () => {
    const keys = new Set(JSON.parse(readFileSync(new URL('../tools/voice/lines.json', import.meta.url), 'utf8')).map((l) => l.key));
    const msgs = [JOURNEY_DONE, STICKERS['home-again'].say];
    for (const g of GOALS) msgs.push(`${g.text} ${g.hint}`, `Next: ${g.text}`);
    for (const m of msgs) for (const s of sentencesOf(m)) expect(keys.has(keyOf(s)), s).toBe(true);
  });
});
