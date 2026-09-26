// Pip's speech queue (#31): one line at a time, a short gap between lines, and priorities so
// nothing important waits and nothing stale piles up. Pure (no DOM, no audio): the app hands
// it `play` / `stop` and, in tests, fake timers.
//
// Priorities:
//   urgent   crash, safety takeover: cuts the current line off and drops everything queued.
//   cue      the coach's HOLD / LET GO / turn cues: jump the queue and cut the current line
//            off, unless it's nearly done (then they follow straight on). Go stale fast.
//   normal   everything else: waits its turn, then plays after the gap.
//   chatter  idle hints: said only if Pip isn't busy, otherwise dropped.
// A `key` marks lines of one kind: a new one replaces a queued one with the same key, and the
// same line again while it's playing is ignored. `onStart` runs when the line really starts
// (e.g. its sticker pops up then).
import { sentencesOf, keyOf } from './speech.js';

export const GAP = 0.4; // seconds between lines
export const CUE_GAP = 0.15; // a waiting cue follows on quicker
export const CUE_WAIT = 2; // a cue waits for the current line only if it ends within this
export const CAP = 3; // lines waiting, at most
export const RANK = { chatter: 0, normal: 1, cue: 2, urgent: 3 };
// How long a line may wait before it's old news (seconds).
const STALE = { cue: 3, normal: 30 };

/**
 * About how long Pip takes to say `text` (seconds). Fitted to the recorded clips: about 0.4 s
 * plus 0.06 s a letter per sentence, with the narrator's short pause between sentences.
 */
export function estimateDuration(text) {
  const sentences = sentencesOf(text || '');
  if (!sentences.length) return 0;
  let t = 0.12 * (sentences.length - 1);
  for (const s of sentences) t += 0.4 + 0.06 * keyOf(s).length;
  return t;
}

/** Longest a line may take before we stop waiting for it (browser speech can forget to end). */
export function stallTimeout(est) {
  return est * 1.5 + 3;
}

const realTimers = {
  now: () => performance.now() / 1000,
  set: (fn, s) => setTimeout(fn, s * 1000),
  clear: (id) => clearTimeout(id),
};

export class SpeechQueue {
  /**
   * play(item): start saying item.text (and show it). Returns (a promise of) true if real audio
   * covered the line; otherwise the queue paces it by its estimated duration.
   * stop(item): cut it off. onEnd(item): it finished (not cut off).
   */
  constructor({ play, stop = () => {}, onEnd = () => {}, timers = realTimers, gap = GAP, cap = CAP } = {}) {
    Object.assign(this, { playFn: play, stopFn: stop, onEnd, timers, gap, cap });
    this.current = null;
    this.pending = [];
    this.gapTimer = null;
    this.watchdog = null;
    this.paceTimer = null;
  }

  /** Is Pip talking, pausing between lines, or with lines waiting? */
  get busy() {
    return !!(this.current || this.gapTimer !== null || this.pending.length);
  }

  /** Queue a line. Returns false if it was dropped (chatter while busy, or a repeat). */
  push(text, { pri = 'normal', key = null, stale, ...extra } = {}) {
    if (!text) return false;
    const now = this.timers.now();
    const item = { text, pri, key, at: now, stale: stale ?? STALE[pri] ?? Infinity, ...extra };
    if (pri === 'urgent') {
      this.pending = this.pending.filter((p) => p.fn);
      this.interrupt();
      this.start(item);
      return true;
    }
    if (pri === 'chatter') {
      if (this.busy) return false;
      this.start(item);
      return true;
    }
    const cur = this.current;
    if (key && cur && cur.key === key && cur.text === text) return false;
    if (key) this.pending = this.pending.filter((p) => p.key !== key);

    if (pri === 'cue') {
      let i = 0;
      while (i < this.pending.length && RANK[this.pending[i].pri] >= RANK.cue) i++;
      this.pending.splice(i, 0, item);
      this.trim();
      if (cur) {
        if (cur.pri === 'urgent') return true;
        // A newer cue of the same kind makes the old one wrong: cut it off.
        const left = cur.started + cur.est - now;
        if (left > CUE_WAIT || (key && cur.key === key)) {
          this.interrupt();
          this.advance();
        }
        return true;
      }
      this.timers.clear(this.gapTimer);
      this.advance();
      return true;
    }

    this.pending.push(item);
    this.trim();
    if (!cur && this.gapTimer === null) this.advance();
    return true;
  }

  /** Run fn when the queue gets to it: after the lines before it have been said. */
  action(fn) {
    this.pending.push({ fn, pri: 'normal', at: this.timers.now() });
    if (!this.current && this.gapTimer === null) this.advance();
  }

  /** Stop talking and forget waiting lines (and, with actions, waiting actions too). */
  clear({ actions = false } = {}) {
    this.pending = actions ? [] : this.pending.filter((p) => p.fn);
    this.interrupt();
    if (this.pending.length) this.gapTimer = this.timers.set(() => this.advance(), this.gap);
  }

  /**
   * Forget lines that no longer apply (#32: the 🧭 switch handed a helper over): drop the
   * waiting ones `match` picks, and cut the current one off if it matches too.
   */
  drop(match) {
    this.pending = this.pending.filter((p) => p.fn || !match(p));
    if (!this.current || !match(this.current)) return;
    this.interrupt();
    if (this.pending.length) this.gapTimer = this.timers.set(() => this.advance(), this.gap);
  }

  // ---- internals ------------------------------------------------------------

  /** Too many lines waiting: drop the least important, oldest first (`keep` lines last of all). */
  trim() {
    for (;;) {
      const lines = this.pending.filter((p) => !p.fn);
      if (lines.length <= this.cap) return;
      const spare = lines.filter((p) => !p.keep);
      const pool = spare.length ? spare : lines;
      let drop = pool[0];
      for (const p of pool) if (RANK[p.pri] < RANK[drop.pri]) drop = p;
      this.pending.splice(this.pending.indexOf(drop), 1);
    }
  }

  interrupt() {
    const t = this.timers;
    t.clear(this.gapTimer);
    t.clear(this.watchdog);
    t.clear(this.paceTimer);
    this.gapTimer = this.watchdog = this.paceTimer = null;
    const cur = this.current;
    this.current = null;
    if (cur) this.stopFn(cur);
  }

  advance() {
    this.timers.clear(this.gapTimer);
    this.gapTimer = null;
    while (this.pending.length && !this.current) {
      const item = this.pending.shift();
      if (item.fn) {
        try {
          item.fn();
        } catch (e) {
          console.error(e);
        }
        continue;
      }
      if (this.timers.now() - item.at > item.stale) continue;
      this.start(item);
    }
  }

  start(item) {
    const t = this.timers;
    this.current = item;
    item.started = t.now();
    item.est = estimateDuration(item.text);
    // Never wait forever: browser speech sometimes never says it's finished.
    this.watchdog = t.set(() => this.finish(item, true), stallTimeout(item.est));
    let r;
    try {
      item.onStart?.();
      r = this.playFn(item);
    } catch (e) {
      console.error(e);
      r = false;
    }
    Promise.resolve(r).then((spoke) => {
      if (this.current !== item) return;
      // Nothing audible (voice off, no sound yet, speech failed): pace it as if it were said.
      const left = spoke ? 0 : item.started + item.est - t.now();
      if (left <= 0) this.finish(item);
      else this.paceTimer = t.set(() => this.finish(item), left);
    });
  }

  finish(item, stalled = false) {
    if (this.current !== item) return;
    const t = this.timers;
    t.clear(this.watchdog);
    t.clear(this.paceTimer);
    this.watchdog = this.paceTimer = null;
    this.current = null;
    if (stalled) this.stopFn(item);
    this.onEnd(item);
    const next = this.pending[0];
    this.gapTimer = t.set(() => this.advance(), next?.pri === 'cue' ? CUE_GAP : this.gap);
  }
}
