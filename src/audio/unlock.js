// Getting sound out of iPhone/iPad WebKit (#24). Every iPad browser, Chrome included, is WebKit
// underneath, and it's fussy about Web Audio:
// - In silent mode it mutes Web Audio (but not <audio> elements) unless the page asks for the
//   "playback" audio session: navigator.audioSession (iOS 16.4+), or on older iOS a silent
//   looping <audio> element started from a tap.
// - A context only starts or resumes inside a tap (touchend / pointerup / click, not touch
//   pointerdown), and it can drop to 'suspended' or 'interrupted' (app switch, phone call, Siri),
//   so we try again on every tap until it's 'running'.
// Everything is feature-detected and harmless elsewhere. No DOM or window access at import time,
// so the state machine is unit-tested with a fake context (test/audio.test.js).

/** iPhone, iPod or iPad (iPadOS asks for desktop sites and claims to be a Mac with touch). */
export function isAppleTouch(nav) {
  if (!nav) return false;
  return /iPad|iPhone|iPod/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

/** Ask for the "playback" audio session so the silent switch doesn't mute us. */
export function setPlaybackSession(nav) {
  try {
    const s = nav?.audioSession;
    if (!s) return false;
    if (s.type !== 'playback') s.type = 'playback';
    return s.type === 'playback';
  } catch {
    return false;
  }
}

/** A new AudioContext (or webkitAudioContext), or null. No sampleRate option: let the
 *  hardware pick, since all our buffers use ctx.sampleRate and decoding resamples to it. */
export function makeContext(win) {
  const AC = win?.AudioContext || win?.webkitAudioContext;
  if (!AC) return null;
  try {
    return new AC();
  } catch {
    return null;
  }
}

/** decodeAudioData as a promise. Older WebKit only has the callback form (and throws if the
 *  callbacks are missing); newer ones return a promise too. Either way settles once. */
export function decodeAudio(ctx, data) {
  return new Promise((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(data, resolve, (e) => reject(e || new Error('decode failed')));
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

/** A tiny silent WAV (8-bit mono, 8 kHz) as a data URI, for the older-iOS <audio> trick. */
export function silentWav(seconds = 0.5, rate = 8000) {
  const n = Math.round(seconds * rate);
  const bytes = new Uint8Array(44 + n);
  const v = new DataView(bytes.buffer);
  const str = (o, s) => [...s].forEach((c, i) => (bytes[o + i] = c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, n, true);
  bytes.fill(128, 44); // 8-bit PCM is unsigned: 128 is silence
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'data:audio/wav;base64,' + btoa(bin);
}

/**
 * Owns the AudioContext's life: created, resumed and primed from taps, suspended while the page
 * is hidden. `gesture()` is cheap once everything is running, so call it on every tap.
 */
export class AudioUnlock {
  constructor({ win = null, nav = null, create = () => makeContext(win), silentEl = null } = {}) {
    this.nav = nav;
    this.create = create;
    this.ctx = null;
    this.sessionSet = false;
    this.primed = 0; // silent buffers played (the classic iOS unlock)
    this.gestures = 0;
    this.resumes = 0;
    this.lastError = null;
    this.log = [];
    // Older iOS only (no audioSession): a looping silent <audio> switches the session to playback.
    this.silentEl = null;
    this.silent = 'unused';
    if (!nav?.audioSession && isAppleTouch(nav)) {
      this.silentEl = silentEl || null;
      if (this.silentEl) this.silent = 'ready';
    }
    // Ask as early as possible; asking again on each tap is harmless.
    this.sessionSet = setPlaybackSession(nav);
  }

  note(msg) {
    this.log.push(`${(typeof performance !== 'undefined' ? performance.now() / 1000 : 0).toFixed(1)}s ${msg}`);
    if (this.log.length > 12) this.log.shift();
  }

  /** Call from any user gesture: creates or resumes the context. Returns it (or null). */
  gesture() {
    this.gestures++;
    if (!this.sessionSet) this.sessionSet = setPlaybackSession(this.nav);
    if (!this.ctx) {
      this.ctx = this.create();
      if (!this.ctx) return null;
      this.note(`created (${this.ctx.state}, ${this.ctx.sampleRate} Hz)`);
      this.ctx.addEventListener?.('statechange', () => this.note(`state ${this.ctx.state}`));
    }
    const ctx = this.ctx;
    if (ctx.state !== 'running' || !this.primed) {
      this.resume();
      this.prime();
    }
    this.playSilentEl();
    return ctx;
  }

  /** Resume unless running or closed. Safe outside a gesture (it just may not work there). */
  resume() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed' || typeof ctx.resume !== 'function') return;
    this.resumes++;
    try {
      const p = ctx.resume();
      p?.catch?.((e) => this.fail('resume', e));
    } catch (e) {
      this.fail('resume', e);
    }
  }

  /** Play one silent sample straight to the speakers: what really unlocks iOS audio. */
  prime() {
    const ctx = this.ctx;
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
      this.primed++;
    } catch (e) {
      this.fail('prime', e);
    }
  }

  playSilentEl() {
    const el = this.silentEl;
    if (!el || (this.silent === 'playing' && !el.paused) || this.hidden) return;
    try {
      const p = el.play();
      this.silent = 'playing';
      p?.catch?.((e) => {
        this.silent = 'blocked';
        this.fail('silent <audio>', e);
      });
    } catch (e) {
      this.silent = 'blocked';
      this.fail('silent <audio>', e);
    }
  }

  /** Page hidden: stop everything so there's no sound (or lock-screen player) in the background. */
  hide() {
    this.hidden = true;
    const ctx = this.ctx;
    if (ctx && ctx.state === 'running' && typeof ctx.suspend === 'function') {
      try {
        ctx.suspend()?.catch?.(() => {});
      } catch {
        // nothing to do
      }
    }
    if (this.silentEl && this.silent === 'playing') {
      this.silentEl.pause();
      this.silent = 'paused';
    }
  }

  /** Page visible again: try to resume. iOS may refuse outside a tap; the next tap fixes it. */
  show() {
    this.hidden = false;
    this.resume();
  }

  fail(what, e) {
    this.lastError = `${what}: ${e?.name || e}`;
    this.note(this.lastError);
  }

  /** What to check on a real device: `app.audio.debugState()`. */
  debugState() {
    const ctx = this.ctx;
    return {
      ctxState: ctx ? ctx.state : 'none',
      sampleRate: ctx ? ctx.sampleRate : null,
      audioSession: this.nav?.audioSession ? this.nav.audioSession.type : 'unsupported',
      sessionSet: this.sessionSet,
      unlocked: this.primed > 0,
      primed: this.primed,
      silentAudio: this.silent,
      gestures: this.gestures,
      resumes: this.resumes,
      lastError: this.lastError,
      log: [...this.log],
    };
  }
}
