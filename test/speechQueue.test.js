import { describe, it, expect, vi, afterEach } from 'vitest';
import { SpeechQueue, estimateDuration, stallTimeout, GAP, CUE_GAP, CAP } from '../src/ui/speechQueue.js';
import { keyOf } from '../src/ui/speech.js';

const tick = () => new Promise((r) => setImmediate(r));

/** Fake time for the queue: nothing happens until the test moves the clock on. */
function fakeClock() {
  let t = 0;
  let id = 0;
  const jobs = new Map();
  return {
    now: () => t,
    set: (fn, s) => {
      jobs.set(++id, { at: t + s, fn });
      return id;
    },
    clear: (i) => jobs.delete(i),
    async advance(s) {
      const end = t + s;
      for (;;) {
        await tick();
        let next = null;
        for (const [i, j] of jobs) if (j.at <= end && (!next || j.at < next[1].at)) next = [i, j];
        if (!next) break;
        jobs.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
      await tick();
    },
  };
}

/**
 * A queue with a fake player. `voice: true`: lines play as "real audio" until the test ends
 * them (end(text)); false: nothing audible, so the queue paces them by their estimate.
 */
function setup({ voice = true } = {}) {
  const clock = fakeClock();
  const log = [];
  const stopped = [];
  const ends = new Map();
  const q = new SpeechQueue({
    timers: clock,
    play: (item) => {
      log.push(item.text);
      if (!voice) return false;
      return new Promise((res) => ends.set(item.text, () => res(true)));
    },
    stop: (item) => stopped.push(item.text),
  });
  const end = async (text) => {
    ends.get(text)();
    await tick();
  };
  return { q, clock, log, stopped, end };
}

const LONG = 'This is a long line that Pip takes quite a few seconds to say out loud to everyone.';

describe('speech queue (#31)', () => {
  it('estimates how long a line takes from its sentences', () => {
    expect(estimateDuration('')).toBe(0);
    expect(estimateDuration('🚀')).toBe(0);
    const one = estimateDuration('Hold GO!');
    expect(one).toBeGreaterThan(0.5);
    expect(one).toBeLessThan(1.5);
    expect(estimateDuration('Hold GO! 🚀')).toBe(one);
    expect(estimateDuration(LONG)).toBeGreaterThan(4);
    expect(estimateDuration('Hold GO! Hold GO!')).toBeGreaterThan(2 * one);
    expect(stallTimeout(estimateDuration(LONG))).toBeGreaterThan(2 * estimateDuration(LONG));
  });

  it('plays lines in order, each after the last has finished plus a short gap', async () => {
    const { q, clock, log, end } = setup();
    q.push('First line.');
    q.push('Second line.');
    q.push('Third line.');
    expect(log).toEqual(['First line.']);
    await clock.advance(3); // still talking: nothing else starts
    expect(log).toEqual(['First line.']);
    await end('First line.');
    await clock.advance(GAP - 0.01);
    expect(log).toEqual(['First line.']);
    await clock.advance(0.02);
    expect(log).toEqual(['First line.', 'Second line.']);
    await end('Second line.');
    await clock.advance(GAP + 0.01);
    expect(log).toEqual(['First line.', 'Second line.', 'Third line.']);
    expect(q.busy).toBe(true);
    await end('Third line.');
    await clock.advance(GAP + 0.01);
    expect(q.busy).toBe(false);
  });

  it('a line that arrives just after another finished still waits for the gap', async () => {
    const { q, clock, log, end } = setup();
    q.push('First line.');
    await end('First line.');
    await clock.advance(0.1);
    q.push('Second line.');
    expect(log).toEqual(['First line.']);
    await clock.advance(GAP);
    expect(log).toEqual(['First line.', 'Second line.']);
  });

  it('paces silent lines (voice off, no sound yet) by their estimated length', async () => {
    const { q, clock, log } = setup({ voice: false });
    q.push(LONG);
    q.push('Next line.');
    const est = estimateDuration(LONG);
    await clock.advance(est - 0.1);
    expect(log).toEqual([LONG]);
    await clock.advance(0.1 + GAP + 0.01);
    expect(log).toEqual([LONG, 'Next line.']);
  });

  it('urgent lines cut in and drop what was waiting', async () => {
    const { q, clock, log, stopped, end } = setup();
    q.push(LONG);
    q.push('Old news.');
    q.push('More old news.');
    q.push('Kaboom!', { pri: 'urgent' });
    expect(stopped).toEqual([LONG]);
    expect(log).toEqual([LONG, 'Kaboom!']);
    expect(q.pending).toEqual([]);
    await end('Kaboom!');
    await clock.advance(5);
    expect(log).toEqual([LONG, 'Kaboom!']);
    expect(q.busy).toBe(false);
  });

  it('cues cut a long line off, but let a nearly finished one end first', async () => {
    const { q, clock, log, stopped, end } = setup();
    q.push(LONG);
    q.push('Normal news.');
    await clock.advance(1);
    q.push('Hold GO!', { pri: 'cue', key: 'coach' });
    expect(stopped).toEqual([LONG]);
    expect(log).toEqual([LONG, 'Hold GO!']);
    // The normal line still comes afterwards.
    await end('Hold GO!');
    await clock.advance(GAP + 0.01);
    expect(log.at(-1)).toBe('Normal news.');

    // Now a short line, nearly done: the cue follows straight on instead.
    const s = setup();
    s.q.push('Short one.');
    s.q.push('Normal news.');
    await s.clock.advance(estimateDuration('Short one.') - 0.5);
    s.q.push('Let go!', { pri: 'cue', key: 'coach' });
    expect(s.stopped).toEqual([]);
    await s.end('Short one.');
    await s.clock.advance(CUE_GAP + 0.01);
    expect(s.log).toEqual(['Short one.', 'Let go!']);
  });

  it('a newer cue drops an older waiting one, and cuts off an older one playing', async () => {
    const { q, clock, log, stopped, end } = setup();
    q.push('Kaboom!', { pri: 'urgent' });
    q.push('Hold GO!', { pri: 'cue', key: 'coach' });
    q.push('Let go!', { pri: 'cue', key: 'coach' });
    expect(q.pending.map((p) => p.text)).toEqual(['Let go!']);
    await end('Kaboom!');
    await clock.advance(CUE_GAP + 0.01);
    expect(log).toEqual(['Kaboom!', 'Let go!']);
    // Superseded while it's still being said: the old cue is wrong now.
    q.push('Hold GO!', { pri: 'cue', key: 'coach' });
    expect(stopped).toEqual(['Let go!']);
    expect(log.at(-1)).toBe('Hold GO!');
    // The very same cue again while it's playing: no repeat.
    expect(q.push('Hold GO!', { pri: 'cue', key: 'coach' })).toBe(false);
  });

  it('cues go stale quickly, normal lines later', async () => {
    const { q, clock, log, end } = setup();
    q.push('Whoa, too low!', { pri: 'urgent' });
    q.push('Hold GO!', { pri: 'cue', key: 'coach' });
    q.push('Something nice.', { stale: 4 });
    q.push('Something else.');
    await clock.advance(4.5); // the urgent line is long in the saying
    expect(log).toEqual(['Whoa, too low!']);
    await end('Whoa, too low!');
    await clock.advance(GAP * 3);
    expect(log).toEqual(['Whoa, too low!', 'Something else.']);
  });

  it('chatter is only said when Pip is free', async () => {
    const { q, clock, log, end } = setup();
    expect(q.push('Follow the sparkles!', { pri: 'chatter' })).toBe(true);
    expect(q.push('Psst!', { pri: 'chatter' })).toBe(false);
    q.push('Real news.');
    await end('Follow the sparkles!');
    expect(q.push('Psst!', { pri: 'chatter' })).toBe(false); // in the gap, with a line waiting
    await clock.advance(GAP + 0.01);
    await end('Real news.');
    await clock.advance(GAP + 0.01);
    expect(q.push('Psst!', { pri: 'chatter' })).toBe(true);
    expect(log).toEqual(['Follow the sparkles!', 'Real news.', 'Psst!']);
  });

  it('a key replaces a waiting line of the same kind instead of adding another', async () => {
    const { q, clock, log, end } = setup();
    q.push('Talking now.');
    q.push('That\'s Pebble!', { key: 'target' });
    q.push('Other news.');
    q.push('That\'s Dusty!', { key: 'target' });
    expect(q.pending.map((p) => p.text)).toEqual(['Other news.', 'That\'s Dusty!']);
    await end('Talking now.');
    await clock.advance(GAP + 0.01);
    await end('Other news.');
    await clock.advance(GAP + 0.01);
    expect(log).toEqual(['Talking now.', 'Other news.', 'That\'s Dusty!']);
    // The same line again while it's being said isn't repeated.
    expect(q.push('That\'s Dusty!', { key: 'target' })).toBe(false);
  });

  it('keeps the queue short: the least important, oldest lines go first', () => {
    const { q } = setup();
    q.push('Kaboom!', { pri: 'urgent' });
    q.push('One.');
    q.push('Hold GO!', { pri: 'cue', key: 'coach' });
    q.push('Two.');
    q.push('Three.');
    q.push('Four.');
    expect(q.pending.map((p) => p.text)).toEqual(['Hold GO!', 'Three.', 'Four.']);
    expect(q.pending.length).toBe(CAP);
  });

  it('drops other lines before a sticker line (keep) when the queue is full', () => {
    const { q } = setup();
    q.push('You landed on Flip!');
    q.push('You got a sticker!', { keep: true });
    q.push('Next: land on Ducky!');
    q.push('A long dark streak!');
    q.push('Hello, Mossy!');
    expect(q.pending.map((p) => p.text)).toEqual(['You got a sticker!', 'A long dark streak!', 'Hello, Mossy!']);
  });

  it('never waits forever for a line that never says it ended', async () => {
    const { q, clock, log, stopped } = setup();
    q.push('Stuck line.'); // the fake player never ends it
    q.push('Next line.');
    const limit = stallTimeout(estimateDuration('Stuck line.'));
    await clock.advance(limit - 0.1);
    expect(log).toEqual(['Stuck line.']);
    await clock.advance(0.1 + GAP + 0.01);
    expect(stopped).toEqual(['Stuck line.']);
    expect(log).toEqual(['Stuck line.', 'Next line.']);
  });

  it('runs actions in turn, survives a crash, and forgets them on a fresh start', async () => {
    const { q, clock, end } = setup();
    const ran = [];
    q.action(() => ran.push('now'));
    expect(ran).toEqual(['now']); // idle: straight away
    q.push('Landed!');
    q.action(() => ran.push('sticker'));
    expect(ran).toEqual(['now']);
    q.push('Kaboom!', { pri: 'urgent' });
    await end('Kaboom!');
    await clock.advance(GAP + 0.01);
    expect(ran).toEqual(['now', 'sticker']);

    q.push('Landed!');
    q.action(() => ran.push('never'));
    q.clear({ actions: true });
    await clock.advance(5);
    expect(ran).toEqual(['now', 'sticker']);
    expect(q.busy).toBe(false);
  });

  it('calls onStart when a line actually starts, not when it is queued', async () => {
    const { q, clock, end } = setup();
    const popped = [];
    q.push('First.');
    q.push('Sticker line.', { onStart: () => popped.push('sticker') });
    expect(popped).toEqual([]);
    await end('First.');
    await clock.advance(GAP + 0.01);
    expect(popped).toEqual(['sticker']);
  });

  it('drops lines that no longer apply, cutting one off mid-line, and carries on (#32)', async () => {
    const { q, clock, log, stopped, end } = setup();
    q.push(LONG, { from: 'helper' });
    q.push('Sticker line.');
    q.push('Point up and hold GO!', { from: 'helper', key: 'coach' });
    q.action(() => log.push('action'));
    q.drop((l) => l.from === 'helper');
    expect(stopped).toEqual([LONG]);
    await clock.advance(GAP + 0.01);
    expect(log).toEqual([LONG, 'Sticker line.']);
    await end('Sticker line.');
    await clock.advance(GAP + 0.01);
    expect(log).toEqual([LONG, 'Sticker line.', 'action']);
    // Nothing matching: nothing changes.
    q.push('Still here.');
    q.drop((l) => l.from === 'helper');
    expect(stopped).toEqual([LONG]);
    expect(log.at(-1)).toBe('Still here.');
  });
});

// ---- the Narrator driven by the queue, with a fake AudioContext --------------------------

describe('narrator with the speech queue (#31)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function narrator({ synth = null } = {}) {
    vi.useFakeTimers();
    const sources = [];
    const ctx = {
      decodeAudioData: () => Promise.resolve({ duration: 1 }),
      createBufferSource: () => {
        const src = { connect: () => {}, start: () => sources.push(src), stop: () => src.onended?.() };
        return src;
      },
    };
    const ducks = [];
    const audio = { ctx, voiceOut: () => ({}), duck: (on) => ducks.push(on) };
    vi.stubGlobal('window', { speechSynthesis: synth });
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(text) { this.text = text; } });
    vi.stubGlobal('fetch', async (url) => (url.endsWith('manifest.json')
      ? { ok: true, json: async () => ({ lines: { [keyOf('Hello there!')]: 'jess/hello.m4a' } }) }
      : { arrayBuffer: async () => new ArrayBuffer(8) }));
    const { Narrator } = await import('../src/ui/narrator.js');
    const n = new Narrator(audio);
    const log = [];
    const q = new SpeechQueue({
      timers: { now: () => Date.now() / 1000, set: (fn, s) => setTimeout(fn, s * 1000), clear: (i) => clearTimeout(i) },
      play: (item) => {
        log.push(item.text);
        return n.say(item.text);
      },
      stop: () => n.stop(),
    });
    return { n, q, log, sources, ducks };
  }

  it('waits for the clip to end, keeps the music down across the gap, then paces an unrecorded line', async () => {
    const { q, log, sources, ducks } = await narrator();
    q.push('Hello there!');
    q.push('Nobody recorded this one.');
    await vi.advanceTimersByTimeAsync(3000);
    expect(sources.length).toBe(1); // the clip is still playing
    expect(log).toEqual(['Hello there!']);
    sources[0].onended();
    await vi.advanceTimersByTimeAsync(120 + GAP * 1000 + 10);
    expect(log).toEqual(['Hello there!', 'Nobody recorded this one.']);
    expect(ducks).toEqual([true, true]); // never let back up between the lines
    // No browser speech here: the line is paced by its estimate, then the music comes back.
    await vi.advanceTimersByTimeAsync(estimateDuration('Nobody recorded this one.') * 1000 + 1000);
    expect(ducks.at(-1)).toBe(false);
    expect(q.busy).toBe(false);
  });

  it('browser speech that never ends does not stall the queue', async () => {
    const spoken = [];
    const synth = {
      getVoices: () => [],
      speak: (u) => {
        spoken.push(u.text);
        u.onstart?.(); // starts talking, then never says it's done (Chrome)
      },
      cancel: vi.fn(),
    };
    const { q, log } = await narrator({ synth });
    q.push('Nobody recorded this one.');
    q.push('Or this one.');
    const limit = stallTimeout(estimateDuration('Nobody recorded this one.'));
    await vi.advanceTimersByTimeAsync(limit * 1000 + GAP * 1000 + 50);
    expect(spoken).toEqual(['Nobody recorded this one.', 'Or this one.']);
    expect(log).toEqual(['Nobody recorded this one.', 'Or this one.']);
    expect(synth.cancel).toHaveBeenCalled();
  });
});
