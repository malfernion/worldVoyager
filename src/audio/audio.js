// All sound is made on the fly with WebAudio: plucked banjo & guitar (Karplus-Strong),
// a reedy harmonica, soft string pads and a little upright bass, played by a generative
// campfire sequencer. Plus rocket rumble and cartoon sound effects.
// The context's life (unlocking on iPad/iPhone, resuming after app switches) is in unlock.js.
import { AudioUnlock, isAppleTouch, silentWav } from './unlock.js';

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Chords as [root midi, quality]. Key of G.
const Q = { maj: [0, 4, 7], min: [0, 3, 7], sus: [0, 5, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], add9: [0, 4, 7, 14] };
const MOODS = {
  camp: {
    eighth: 0.27, barsPerChord: 2,
    prog: [[43, 'maj'], [48, 'add9'], [43, 'maj'], [50, 'sus'], [40, 'min'], [48, 'maj'], [43, 'maj'], [50, 'maj']],
    banjo: 0.9, guitar: 0.8, pad: 0.25, bass: 0.7, melody: 0.5, lead: 'harmonica',
  },
  space: {
    eighth: 0.36, barsPerChord: 2,
    prog: [[40, 'min7'], [48, 'maj7'], [43, 'add9'], [50, 'sus'], [45, 'min7'], [48, 'maj7'], [40, 'min'], [50, 'maj']],
    banjo: 0.35, guitar: 0.3, pad: 0.6, bass: 0.35, melody: 0.3, lead: 'whistle',
  },
  discover: {
    eighth: 0.25, barsPerChord: 2,
    prog: [[50, 'maj'], [45, 'maj'], [47, 'min'], [43, 'maj'], [50, 'maj'], [45, 'sus'], [43, 'add9'], [45, 'maj']],
    banjo: 1.0, guitar: 0.7, pad: 0.35, bass: 0.7, melody: 0.8, lead: 'harmonica',
  },
};
const PENTA = [0, 2, 4, 7, 9];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.musicOn = true;
    this.sfxOn = true;
    this.mood = 'camp';
    this.nextMood = 'camp';
    this.plucks = new Map();
    this.unlock = null;
  }

  /**
   * Listen for taps anywhere: the first one starts the sound, and later ones resume it if iOS
   * stopped it (app switch, phone call). Also pauses the sound while the page is hidden.
   */
  listen(doc = document, win = window, nav = navigator) {
    let silentEl = null;
    if (!nav.audioSession && isAppleTouch(nav) && typeof Audio !== 'undefined') {
      // Older-iOS fallback only. Never in the DOM, no controls; paused while the page is hidden.
      silentEl = new Audio();
      silentEl.src = silentWav();
      silentEl.loop = true;
      silentEl.preload = 'auto';
      silentEl.disableRemotePlayback = true;
      silentEl.setAttribute('x-webkit-airplay', 'deny');
      silentEl.setAttribute('playsinline', '');
    }
    this.unlock = new AudioUnlock({ win, nav, silentEl });
    const tap = () => this.start();
    // touch pointerdown doesn't count as a gesture for audio; touchend, pointerup and click do.
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
      doc.addEventListener(type, tap, { capture: true, passive: true });
    }
    doc.addEventListener('visibilitychange', () => (doc.hidden ? this.unlock.hide() : this.unlock.show()));
  }

  /** Call from a user gesture (tap) so browsers allow sound. Cheap once running. */
  start() {
    if (!this.unlock) this.listen();
    const ctx = this.unlock.gesture();
    if (!ctx || this.ctx) return;
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.reverb.connect(wet).connect(this.master);

    this.music = ctx.createGain();
    this.music.gain.value = this.musicOn ? 0.5 : 0;
    this.music.connect(this.master);
    this.music.connect(this.reverb);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxOn ? 0.8 : 0;
    this.sfx.connect(this.master);
    const sfxVerb = ctx.createGain();
    sfxVerb.gain.value = 0.25;
    this.sfx.connect(sfxVerb).connect(this.reverb);

    // Pip's voice: its own channel, not affected by the music/sound switches.
    this.voice = ctx.createGain();
    this.voice.gain.value = 1.0;
    this.voice.connect(this.master);

    this.noise = this.makeNoise(2);
    this.setupEngine();
    this.bar = 0;
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.2;
    this.timer = setInterval(() => this.schedule(), 60);
  }

  /** For checking sound on a real device: `app.audio.debugState()` in the console. */
  debugState() {
    return this.unlock ? this.unlock.debugState() : { ctxState: 'none', listening: false };
  }

  /** A small on-screen readout of debugState() (open the game with ?audiodebug). */
  showDebug() {
    const el = document.createElement('pre');
    el.style.cssText = 'position:fixed;left:4px;top:4px;z-index:9999;margin:0;padding:6px;max-width:90vw;'
      + 'font:11px/1.3 monospace;color:#fff;background:rgba(0,0,0,.7);pointer-events:none;white-space:pre-wrap';
    document.body.appendChild(el);
    const draw = () => (el.textContent = JSON.stringify(this.debugState(), null, 1));
    draw();
    setInterval(draw, 500);
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.music) this.music.gain.setTargetAtTime(on ? (this.ducked ? 0.2 : 0.5) : 0, this.ctx.currentTime, 0.3);
  }

  voiceOut() {
    return this.voice;
  }

  /** Dip the music while Pip is talking. */
  duck(on) {
    if (!this.music) return;
    this.ducked = on;
    const level = this.musicOn ? (on ? 0.2 : 0.5) : 0;
    this.music.gain.setTargetAtTime(level, this.ctx.currentTime, on ? 0.08 : 0.6);
  }

  setSfx(on) {
    this.sfxOn = on;
    if (this.sfx) this.sfx.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.1);
  }

  setMood(mood) {
    if (MOODS[mood]) this.nextMood = mood;
  }

  // ---- building blocks ---------------------------------------------------

  makeImpulse(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
    }
    return buf;
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Karplus-Strong plucked string, rendered once per note and cached. */
  pluckBuffer(midi, kind) {
    const key = kind + midi;
    if (this.plucks.has(key)) return this.plucks.get(key);
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const f = midiHz(midi);
    // Averaging adds half a sample of delay, so aim the interpolated delay at period - 0.5.
    const period = sr / f - 0.5;
    const N = Math.floor(period);
    const frac = period - N;
    const len = Math.floor(sr * (kind === 'banjo' ? 1.6 : 2.6));
    const buf = ctx.createBuffer(1, len, sr);
    const y = buf.getChannelData(0);
    const decay = kind === 'banjo' ? 0.9965 : 0.9985;
    let prev = 0;
    for (let i = 0; i < N + 2; i++) {
      let n = Math.random() * 2 - 1;
      if (kind !== 'banjo') {
        n = prev + (n - prev) * 0.45; // darker pick for guitar
        prev = n;
      }
      y[i] = n * 0.8;
    }
    let prevS = 0;
    for (let i = N + 2; i < len; i++) {
      const s = y[i - N] * (1 - frac) + y[i - N - 1] * frac;
      y[i] = decay * 0.5 * (s + prevS);
      prevS = s;
    }
    // Pluck position comb gives the banjo its twang.
    if (kind === 'banjo') {
      const d = Math.floor(N / 7);
      for (let i = len - 1; i >= d; i--) y[i] = y[i] - 0.6 * y[i - d];
    }
    this.plucks.set(key, buf);
    return buf;
  }

  pluck(midi, time, vel = 1, kind = 'banjo', dest = this.music) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.pluckBuffer(midi, kind);
    const g = ctx.createGain();
    g.gain.value = vel * (kind === 'banjo' ? 0.28 : 0.32);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    let node = src;
    if (kind === 'banjo') {
      const peak = ctx.createBiquadFilter();
      peak.type = 'peaking';
      peak.frequency.value = 1800;
      peak.gain.value = 5;
      node.connect(peak);
      node = peak;
    } else {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2600;
      node.connect(lp);
      node = lp;
    }
    node.connect(g);
    if (pan) {
      pan.pan.value = kind === 'banjo' ? 0.25 : -0.25;
      g.connect(pan).connect(dest);
    } else {
      g.connect(dest);
    }
    src.start(time);
    src.stop(time + src.buffer.duration);
  }

  pad(notes, time, dur, vol) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, time);
    out.gain.linearRampToValueAtTime(vol * 0.05, time + dur * 0.35);
    out.gain.setValueAtTime(vol * 0.05, time + dur * 0.75);
    out.gain.linearRampToValueAtTime(0, time + dur + 1.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 0.4;
    lp.connect(out).connect(this.music);
    for (const m of notes) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiHz(m);
        o.detune.value = det;
        o.connect(lp);
        o.start(time);
        o.stop(time + dur + 1.3);
      }
    }
  }

  bass(midi, time, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = midiHz(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.32 * vol, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, time + 1.1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    o.connect(lp).connect(g).connect(this.music);
    o.start(time);
    o.stop(time + 1.2);
  }

  lead(midi, time, dur, kind, vol = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = kind === 'whistle' ? 'sine' : 'sawtooth';
    o.frequency.value = midiHz(midi);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vibG = ctx.createGain();
    vibG.gain.setValueAtTime(0, time);
    vibG.gain.linearRampToValueAtTime(midiHz(midi) * 0.012, time + Math.min(0.5, dur));
    vib.connect(vibG).connect(o.frequency);
    const g = ctx.createGain();
    const peak = (kind === 'whistle' ? 0.09 : 0.07) * vol;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.07);
    g.gain.setValueAtTime(peak * 0.85, time + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, time + dur + 0.12);
    let node = o;
    if (kind !== 'whistle') {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 0.9;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      o.connect(bp).connect(lp);
      node = lp;
    }
    node.connect(g).connect(this.music);
    o.start(time);
    vib.start(time);
    o.stop(time + dur + 0.2);
    vib.stop(time + dur + 0.2);
  }

  // ---- the campfire band -------------------------------------------------

  schedule() {
    const ctx = this.ctx;
    while (this.nextTime < ctx.currentTime + 0.25) {
      const stepsPerBar = 6;
      const s = this.step % stepsPerBar;
      if (s === 0) {
        if (this.bar % 2 === 0 && this.nextMood !== this.mood) {
          this.mood = this.nextMood;
          this.bar = 0;
        }
        this.startBar(this.nextTime);
      }
      if (this.musicOn) this.playStep(s, this.nextTime);
      this.nextTime += MOODS[this.mood].eighth * (s % 2 === 0 ? 1.06 : 0.94); // a lazy swing
      this.step++;
      if (this.step % stepsPerBar === 0) this.bar++;
    }
  }

  startBar(time) {
    const mood = MOODS[this.mood];
    const idx = Math.floor(this.bar / mood.barsPerChord) % mood.prog.length;
    const [root, q] = mood.prog[idx];
    this.chord = { root, tones: Q[q] };
    if (!this.musicOn) return;
    const barDur = mood.eighth * 6;
    if (this.bar % mood.barsPerChord === 0 && mood.pad > 0) {
      const notes = Q[q].slice(0, 3).map((t) => root + 12 + t);
      this.pad(notes, time, barDur * mood.barsPerChord, mood.pad);
    }
    if (Math.random() < mood.melody * 0.35 && this.bar % 2 === 0) this.phrase(time, mood);
  }

  phrase(time, mood) {
    const key = 43; // G
    let note = 67 + PENTA[Math.floor(Math.random() * 3) + 1];
    let t = time + mood.eighth * (Math.random() < 0.5 ? 0 : 2);
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const dur = mood.eighth * (Math.random() < 0.5 ? 2 : 3);
      this.lead(note, t, dur * 0.95, mood.lead, 1);
      t += dur;
      // Walk around the G pentatonic scale.
      const scale = [];
      for (let o = 0; o < 3; o++) for (const p of PENTA) scale.push(key + 12 * 2 + p + o * 12 - 12);
      const idx = scale.indexOf(note);
      const move = [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)];
      note = scale[Math.max(0, Math.min(scale.length - 1, (idx < 0 ? 5 : idx) + move))];
      if (note > 83) note -= 12;
      if (note < 62) note += 12;
    }
  }

  playStep(s, time) {
    const mood = MOODS[this.mood];
    const { root, tones } = this.chord;
    const chordNote = (i, base) => {
      const oct = Math.floor(i / tones.length);
      return base + tones[i % tones.length] + oct * 12;
    };
    // Bass: root on 1, fifth on 4.
    if (s === 0) this.bass(root, time, mood.bass);
    if (s === 3 && Math.random() < 0.8) this.bass(root + 7, time, mood.bass * 0.8);
    // Guitar: gentle arpeggio.
    if (mood.guitar > 0 && Math.random() < mood.guitar) {
      const pattern = [0, 2, 1, 3, 2, 1];
      this.pluck(chordNote(pattern[s], root + 12), time, 0.7, 'guitar');
    }
    // Banjo: forward roll up high.
    if (Math.random() < mood.banjo) {
      const roll = [2, 3, 4, 1, 3, 5];
      this.pluck(chordNote(roll[(s + this.bar) % roll.length], root + 24), time, 0.55 + Math.random() * 0.3, 'banjo');
    }
  }

  // ---- sound effects -----------------------------------------------------

  setupEngine() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 300;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    src.connect(this.engineFilter).connect(this.engineGain).connect(this.sfx);
    src.start();
    const rumble = ctx.createOscillator();
    rumble.type = 'sawtooth';
    rumble.frequency.value = 42;
    const rl = ctx.createBiquadFilter();
    rl.type = 'lowpass';
    rl.frequency.value = 120;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumble.connect(rl).connect(this.rumbleGain).connect(this.sfx);
    rumble.start();
  }

  setEngine(throttle) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(throttle * 0.55, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(250 + throttle * 900, t, 0.08);
    this.rumbleGain.gain.setTargetAtTime(throttle * 0.25, t, 0.08);
  }

  tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseBurst(dur, freq, { vol = 0.4, type = 'bandpass', q = 1, delay = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  play(name) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    switch (name) {
      case 'tap':
        this.tone(880, 0.08, { vol: 0.15, slide: 0.6 });
        break;
      case 'grab':
        this.tone(500, 0.1, { vol: 0.2, slide: 1.8, type: 'triangle' });
        break;
      case 'snap':
        this.noiseBurst(0.12, 900, { vol: 0.5, q: 2 });
        this.tone(180, 0.15, { vol: 0.35, slide: 0.5 });
        this.tone(1320, 0.1, { vol: 0.08, delay: 0.05, type: 'triangle' });
        break;
      case 'remove':
        this.tone(700, 0.18, { vol: 0.2, slide: 0.4, type: 'triangle' });
        this.noiseBurst(0.2, 2000, { vol: 0.15 });
        break;
      case 'paint':
        this.tone(1000, 0.12, { vol: 0.12, slide: 1.5 });
        this.tone(1500, 0.12, { vol: 0.08, slide: 1.5, delay: 0.06 });
        break;
      case 'land':
        [67, 71, 74, 79].forEach((m, i) => this.pluck(m, now + i * 0.09, 0.9, 'banjo', this.sfx));
        break;
      case 'sticker':
        [72, 76, 79, 84, 88].forEach((m, i) => this.tone(midiHz(m), 0.5, { vol: 0.12, type: 'triangle', delay: i * 0.07 }));
        [55, 59, 62, 67].forEach((m, i) => this.pluck(m + 12, now + 0.35 + i * 0.1, 0.8, 'banjo', this.sfx));
        break;
      case 'crash':
        this.noiseBurst(1.2, 400, { vol: 0.9, type: 'lowpass' });
        this.noiseBurst(0.5, 1800, { vol: 0.3 });
        this.tone(900, 0.7, { vol: 0.2, slide: 0.15, type: 'square', delay: 0.15 });
        break;
      case 'boing':
        this.tone(220, 0.4, { vol: 0.3, slide: 2.5, type: 'triangle' });
        break;
      case 'bonk': // a soft, rubbery buggy bump
        this.tone(170, 0.2, { vol: 0.3, slide: 0.6 });
        this.tone(340, 0.1, { vol: 0.08, slide: 0.7, type: 'triangle' });
        this.noiseBurst(0.08, 500, { vol: 0.2, type: 'lowpass' });
        break;
      case 'bonkTree': // the bump plus a leafy rustle
        this.play('bonk');
        this.noiseBurst(0.4, 3200, { vol: 0.08, q: 0.7, delay: 0.05 });
        break;
      case 'whoosh':
        this.noiseBurst(0.5, 700, { vol: 0.25, q: 0.6 });
        break;
      case 'soi':
        [79, 83, 86].forEach((m, i) => this.tone(midiHz(m), 0.9, { vol: 0.09, type: 'sine', delay: i * 0.12 }));
        break;
      case 'warp':
        this.tone(400, 0.25, { vol: 0.1, slide: 2, type: 'triangle' });
        break;
      case 'unwarp':
        this.tone(800, 0.25, { vol: 0.1, slide: 0.5, type: 'triangle' });
        break;
      case 'rewind':
        this.tone(1200, 0.5, { vol: 0.12, slide: 0.3, type: 'triangle' });
        this.tone(900, 0.5, { vol: 0.08, slide: 0.3, type: 'triangle', delay: 0.1 });
        break;
      default:
        break;
    }
  }
}
