// Pip's voice. Lines are pre-recorded (Orpheus TTS, see tools/voice/) one sentence per clip,
// listed in public/voice/manifest.json. A message is split into sentences and the matching
// clips play one after another. Anything without a recording falls back to the browser's
// own speech so Pip never goes silent. One message at a time: the speech queue (#31,
// speechQueue.js) decides what's said when, and waits for say() to finish.
import { sentencesOf, keyOf } from './speech.js';
import { estimateDuration, stallTimeout } from './speechQueue.js';
import { decodeAudio } from '../audio/unlock.js';

const BASE = './voice/';
const GAP = 0.12; // seconds between sentences
const UNDUCK = 0.8; // seconds of quiet before the music comes back up (spans the gap between lines)

// Fallback speech: prefer natural-sounding voices, skip novelty ones.
const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|grandma|grandpa|rocko|shelley|sandy|flo|eddy|reed/i;
function voiceScore(v) {
  let s = 0;
  if (/natural|neural|premium|enhanced|online|siri/i.test(v.name)) s += 100;
  if (/google/i.test(v.name)) s += 40;
  if (/^en[-_](US|GB|AU|IE|NZ|CA)/i.test(v.lang)) s += 10;
  if (/samantha|daniel|karen|moira|tessa|alex/i.test(v.name) && !/premium|enhanced/i.test(v.name)) s -= 20;
  return s;
}

export class Narrator {
  constructor(audio) {
    this.audio = audio;
    this.enabled = true;
    this.clips = null;
    this.buffers = new Map();
    this.token = 0;
    this.source = null;
    this.synth = window.speechSynthesis || null;
    this.ready = fetch(`${BASE}manifest.json`)
      .then((r) => (r.ok ? r.json() : { lines: {} }))
      .then((m) => (this.clips = m.lines || {}))
      .catch(() => (this.clips = {}));
  }

  /** Load a clip once (decoded audio is cached). */
  buffer(file) {
    if (!this.buffers.has(file)) {
      const ctx = this.audio.ctx;
      const p = fetch(BASE + file)
        .then((r) => r.arrayBuffer())
        .then((b) => decodeAudio(ctx, b)) // callback form too, for older WebKit
        .catch((e) => {
          this.buffers.delete(file);
          throw e;
        });
      this.buffers.set(file, p);
    }
    return this.buffers.get(file);
  }

  /** Quietly download every clip after the game starts, so Pip never has to wait. */
  async preload() {
    await this.ready;
    if (!this.audio.ctx) return;
    const files = [...new Set(Object.values(this.clips))];
    for (let i = 0; i < files.length; i += 6) {
      await Promise.allSettled(files.slice(i, i + 6).map((f) => this.buffer(f)));
    }
  }

  /** Say a message. Resolves when it's done (or cut off): true if anything was heard. */
  say(text) {
    if (!this.enabled || !text) return Promise.resolve(false);
    this.stop();
    const token = ++this.token;
    return this.run(text, token);
  }

  async run(text, token) {
    await this.ready;
    const sentences = sentencesOf(text);
    let heard = false;
    clearTimeout(this.unduckTimer);
    this.audio.duck?.(true);
    try {
      for (const s of sentences) {
        if (token !== this.token) return heard;
        const file = this.clips[keyOf(s)];
        if (file && this.audio.ctx) {
          let buf = null;
          try {
            buf = await this.buffer(file);
          } catch {
            buf = null;
          }
          if (token !== this.token) return heard;
          if (buf) {
            await this.playBuffer(buf);
            heard = true;
            continue;
          }
        }
        if (import.meta.env?.DEV) console.warn('[pip] no recording for:', s);
        if (await this.speakFallback(s)) heard = true;
      }
    } finally {
      if (token === this.token) this.unduckSoon();
    }
    return heard;
  }

  /** Music back up after a moment, unless Pip carries on talking (the next line in the queue). */
  unduckSoon() {
    clearTimeout(this.unduckTimer);
    this.unduckTimer = setTimeout(() => this.audio.duck?.(false), UNDUCK * 1000);
  }

  playBuffer(buf) {
    return new Promise((resolve) => {
      const ctx = this.audio.ctx;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.audio.voiceOut());
      src.onended = () => {
        if (this.source === src) this.source = null;
        setTimeout(resolve, GAP * 1000);
      };
      this.source = src;
      src.start();
    });
  }

  /** Browser speech for an unrecorded sentence. Resolves true if it was spoken. */
  speakFallback(sentence) {
    return new Promise((resolve) => {
      if (!this.synth) return resolve(false);
      const u = new SpeechSynthesisUtterance(sentence);
      const voices = this.synth.getVoices().filter((v) => /^en/i.test(v.lang) && !NOVELTY.test(v.name));
      voices.sort((a, b) => voiceScore(b) - voiceScore(a));
      if (voices[0]) {
        u.voice = voices[0];
        u.lang = voices[0].lang;
      }
      u.rate = 0.97;
      u.pitch = 1.05;
      let started = false;
      let timer = null;
      const done = (ok) => {
        clearTimeout(timer);
        u.onstart = u.onend = u.onerror = null;
        resolve(ok);
      };
      u.onstart = () => (started = true);
      u.onend = () => done(true);
      u.onerror = () => done(false); // e.g. not allowed before the first tap
      // Chrome sometimes never sends end (or error): don't wait forever.
      timer = setTimeout(() => {
        if (u.onend) this.synth.cancel();
        done(started);
      }, stallTimeout(estimateDuration(sentence)) * 1000);
      this.synth.speak(u);
    });
  }

  stop() {
    this.token++;
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // already stopped
      }
      this.source = null;
    }
    this.synth?.cancel();
    this.unduckSoon();
  }
}
