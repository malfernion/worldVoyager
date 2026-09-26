// All sound is made on the fly with WebAudio: plucked banjo & guitar (Karplus-Strong),
// a reedy harmonica, soft string pads and a little upright bass, played by a generative
// campfire sequencer. Pip's friends (#16) each add their own part on top, over the same
// chords, as loud as src/physics/friends.js says. Plus rocket rumble and cartoon sound effects.
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

// The friends' parts (#16). Each has its own gain (how loud that friend is from where we are,
// times `mix`) and low-pass filter (muffled from far away), then joins the music bus, so the
// music switch and the ducking under Pip's voice apply to them too. `mix` keeps the whole band
// (every part at its home level together) about as loud again as the campfire band itself;
// the master compressor catches the rest. `peak` is each part's loudest single note (gain),
// kept here so a test can check the sum.
export const FRIEND_PARTS = {
  harmonica: { mix: 0.9, peak: 0.07 * 0.8 * 2 }, // two-note breaths
  drum: { mix: 0.8, peak: 0.5 },
  kalimba: { mix: 0.8, peak: 0.13 + 0.03 },
  bass: { mix: 0.9, peak: 0.42 },
  whistle: { mix: 0.7, peak: 0.09 * 0.9 },
};
// Crumb's kalimba: which chord note on each step (-1: rest); Flurry's whistle tunes for even and
// odd bars: [chord note, length in eighths] on each step.
const KALIMBA = [-1, 3, 4, -1, 5, 4];
const WHISTLE = [
  [[2, 2.6], null, null, [3, 1], [2, 1], [1, 0.9]],
  [[3, 1.5], null, [4, 1], [2, 2.8], null, null],
];
// Filter cutoff for brightness 0 (muffled, from orbit) to 1 (right by the campfire).
export const cutoffFor = (bright) => 500 * Math.pow(16, Math.max(0, Math.min(1, bright)));

// The muffle filter's cutoff in the open and under a sea (#44), Hz.
const OPEN_AIR = 20000;
const UNDERWATER = 650;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.musicOn = true;
    this.sfxOn = true;
    this.mood = 'camp';
    this.nextMood = 'camp';
    this.plucks = new Map();
    this.unlock = null;
    // The friends' parts (#16): { gain, filter, level, bright, until } once started.
    this.parts = {};
    this.levels = {};
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

    // Under a sea (#44) the music and sounds (not Pip's voice) are muffled: everything but the
    // voice goes through this low-pass, wide open until then.
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = OPEN_AIR;
    this.muffle.Q.value = 0.7;
    this.muffle.connect(this.master);
    this.reverb.connect(wet).connect(this.muffle);

    this.music = ctx.createGain();
    this.music.gain.value = this.musicOn ? 0.5 : 0;
    this.music.connect(this.muffle);
    this.music.connect(this.reverb);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxOn ? 0.8 : 0;
    this.sfx.connect(this.muffle);
    const sfxVerb = ctx.createGain();
    sfxVerb.gain.value = 0.25;
    this.sfx.connect(sfxVerb).connect(this.reverb);
    if (this.underwater) this.setUnderwater(true, true);

    // Pip's voice: its own channel, not affected by the music/sound switches.
    this.voice = ctx.createGain();
    this.voice.gain.value = 1.0;
    this.voice.connect(this.master);

    this.noise = this.makeNoise(2);
    this.setupEngine();
    this.setupFriends();
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

  /** Under a sea (#44): muffle the music and sounds (Pip stays clear). Cheap to call every frame. */
  setUnderwater(on, force = false) {
    if (on === this.underwater && !force) return;
    this.underwater = on;
    if (!this.muffle) return;
    this.muffle.frequency.setTargetAtTime(on ? UNDERWATER : OPEN_AIR, this.ctx.currentTime, on ? 0.05 : 0.15);
  }

  /**
   * Gentle lapping of the waves (#44): `level` 0 (far from any sea) to 1 (right by it, or in it).
   * A looped, filtered noise that swells and fades slowly; made the first time it's needed, and
   * only touched when the level really changes.
   */
  setLapping(level) {
    level = Math.max(0, Math.min(1, level));
    if (!this.ctx || (this.lapLevel ?? 0) === level || (!this.lap && level <= 0)) return;
    if (this.lap && Math.abs(level - this.lapLevel) < 0.03 && level > 0) return;
    this.lapLevel = level;
    const ctx = this.ctx;
    if (!this.lap) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 520;
      f.Q.value = 0.6;
      // Slow swells: a wave every few seconds.
      const swell = ctx.createGain();
      swell.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.23;
      const depth = ctx.createGain();
      depth.gain.value = 0.45;
      lfo.connect(depth).connect(swell.gain);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(f).connect(swell).connect(gain).connect(this.sfx);
      src.start();
      lfo.start();
      this.lap = gain;
    }
    this.lap.gain.setTargetAtTime(level * 0.16, ctx.currentTime, 0.4);
  }

  setMood(mood) {
    if (MOODS[mood]) this.nextMood = mood;
  }

  /**
   * How loud each friend's part is (#16): [{ part, gain, bright }] from friendLevels() in
   * src/physics/friends.js. Call it a few times a second; it only touches the audio graph when
   * a level really changes, and then glides there (setTargetAtTime), never jumps.
   */
  setFriendLevels(levels) {
    for (const l of levels) {
      const want = this.levels[l.part] ??= { gain: 0, bright: 0 };
      want.gain = l.gain;
      want.bright = l.bright;
      const p = this.parts[l.part];
      if (p) this.applyPart(p, want);
    }
  }

  applyPart(p, want) {
    const now = this.ctx.currentTime;
    if (Math.abs(want.gain - p.level) < 0.004 && Math.abs(want.bright - p.bright) < 0.02) return;
    // Fading out: keep playing notes while the gain glides down.
    if (want.gain <= 0.01 && p.level > 0.01) p.until = now + 3;
    p.level = want.gain;
    p.bright = want.bright;
    p.gain.gain.setTargetAtTime(want.gain * FRIEND_PARTS[p.name].mix, now, 0.5);
    p.filter.frequency.setTargetAtTime(cutoffFor(want.bright), now, 0.5);
  }

  setupFriends() {
    const ctx = this.ctx;
    for (const name of Object.keys(FRIEND_PARTS)) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoffFor(0);
      filter.Q.value = 0.5;
      gain.connect(filter).connect(this.music);
      const p = { name, gain, filter, level: 0, bright: 0, until: 0 };
      this.parts[name] = p;
      if (this.levels[name]) this.applyPart(p, this.levels[name]);
    }
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
    const len = Math.floor(sr * (kind === 'banjo' ? 1.6 : kind === 'bass' ? 1.4 : 2.6));
    const buf = ctx.createBuffer(1, len, sr);
    const y = buf.getChannelData(0);
    // Decay is per trip round the string (a period), so low notes ring on longer.
    const decay = kind === 'banjo' ? 0.9965 : kind === 'bass' ? 0.993 : 0.9985;
    let prev = 0;
    for (let i = 0; i < N + 2; i++) {
      let n = Math.random() * 2 - 1;
      if (kind !== 'banjo') {
        n = prev + (n - prev) * (kind === 'bass' ? 0.25 : 0.45); // darker pick for guitar, darker still for the bass
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
    g.gain.value = vel * (kind === 'banjo' ? 0.28 : kind === 'bass' ? 0.42 : 0.32);
    const pan = ctx.createStereoPanner && kind !== 'bass' ? ctx.createStereoPanner() : null;
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
      lp.frequency.value = kind === 'bass' ? 900 : 2600;
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

  lead(midi, time, dur, kind, vol = 1, dest = this.music) {
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
    node.connect(g).connect(dest);
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
    this.playFriends(s, time, mood, root, chordNote);
  }

  /** Is a friend's part worth scheduling notes for? (Silent parts cost nothing.) */
  partOn(name) {
    const p = this.parts[name];
    return p && (p.level > 0.01 || this.ctx.currentTime < p.until) ? p : null;
  }

  /**
   * The friends' parts (#16), a step at a time, over the same chords as the band: only chord
   * tones, so everything fits whichever friends are playing. s: step in the bar (0-5, beats on
   * 0 and 3, a lazy 6/8); chordNote(i, base): the chord's i-th note up from `base`.
   */
  playFriends(s, time, mood, root, chordNote) {
    const e = mood.eighth;
    const even = this.bar % 2 === 0;
    let p;
    // Mossy's harmonica: soft two-note breaths (the chord's third and fifth) on the beats.
    if ((p = this.partOn('harmonica'))) {
      if (s === 0) {
        this.lead(chordNote(1, root + 24), time, e * 2.6, 'harmonica', 0.8, p.gain);
        this.lead(chordNote(2, root + 24), time, e * 2.6, 'harmonica', 0.8, p.gain);
      } else if (s === 3 && Math.random() < 0.7) {
        this.lead(chordNote(0, root + 24), time, e * 1.8, 'harmonica', 0.6, p.gain);
        this.lead(chordNote(1, root + 24), time, e * 1.8, 'harmonica', 0.6, p.gain);
      }
    }
    // Bolt's hand drum: doum on one, dum on four, teks in between.
    if ((p = this.partOn('drum'))) {
      if (s === 0) this.drum(time, 'low', 1, p.gain);
      else if (s === 3) this.drum(time, 'mid', 0.7, p.gain);
      else if (s === 2 || s === 5) this.drum(time, 'tek', 0.7, p.gain);
      else if (s === 4 && Math.random() < 0.5) this.drum(time, 'tek', 0.35, p.gain);
    }
    // Crumb's kalimba: a twinkly broken chord on the off-beats, high up.
    if ((p = this.partOn('kalimba'))) {
      const idx = s === 5 && !even ? 6 : KALIMBA[s];
      if (idx >= 0 && Math.random() < 0.9) this.kalimba(chordNote(idx, root + 12), time, s === 1 ? 1 : 0.75, p.gain);
    }
    // Toasty's double bass: a plucked, walking line under the band.
    if ((p = this.partOn('bass'))) {
      if (s === 0) this.pluck(root, time, 1, 'bass', p.gain);
      else if (s === 2 && Math.random() < 0.7) this.pluck(root + 7, time, 0.55, 'bass', p.gain);
      else if (s === 3) this.pluck(root + 12, time, 0.7, 'bass', p.gain);
      else if (s === 5 && Math.random() < 0.6) this.pluck(chordNote(1, root + 12), time, 0.6, 'bass', p.gain);
    }
    // Flurry's tin whistle: a little tune from the chord, one shape on even bars, one on odd.
    if ((p = this.partOn('whistle'))) {
      const n = (even ? WHISTLE[0] : WHISTLE[1])[s];
      if (n) this.lead(chordNote(n[0], root + 24), time, e * n[1] * 0.95, 'whistle', 0.9, p.gain);
    }
  }

  /** A hand drum: a deep doum, a middle dum, or a slappy tek off the rim. */
  drum(time, kind, vol, dest) {
    const ctx = this.ctx;
    if (kind === 'tek') {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2800;
      f.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.3 * vol, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
      src.connect(f).connect(g).connect(dest);
      src.start(time, Math.random());
      src.stop(time + 0.1);
      return;
    }
    const [from, to, len] = kind === 'low' ? [120, 62, 0.45] : [180, 115, 0.3];
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(from, time);
    o.frequency.exponentialRampToValueAtTime(to, time + len * 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.5 * vol, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, time + len);
    o.connect(g).connect(dest);
    o.start(time);
    o.stop(time + len + 0.05);
  }

  /** A kalimba (thumb piano) tine: a soft bell with a quick click of overtone. */
  kalimba(midi, time, vol, dest) {
    const ctx = this.ctx;
    const f = midiHz(midi);
    for (const [mul, peak, len] of [[1, 0.13, 1.3], [4, 0.03, 0.12]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(peak * vol, time + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, time + len);
      o.connect(g).connect(dest);
      o.start(time);
      o.stop(time + len + 0.05);
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
      case 'discover': // a twinkly rising chime for a secret found (#15)
        [84, 88, 91, 96, 100, 103].forEach((m, i) => this.tone(midiHz(m), 0.6, { vol: 0.08, type: 'sine', delay: i * 0.06 }));
        this.noiseBurst(0.6, 7000, { vol: 0.05, q: 0.8 });
        break;
      case 'friend': // saying hello to a friend (#16): a twinkle and a happy banjo strum
        this.play('discover');
        [55, 59, 62, 67, 71].forEach((m, i) => this.pluck(m + 12, now + 0.45 + i * 0.05, 0.8, 'banjo', this.sfx));
        break;
      case 'band': // the Full Band together (#16): a big strum, drum hits and a whistle flourish
        [43, 50, 55, 59, 62, 67, 71, 74, 79].forEach((m, i) => this.pluck(m + 12, now + i * 0.04, 0.9, i < 3 ? 'guitar' : 'banjo', this.sfx));
        this.drum(now, 'low', 0.8, this.sfx);
        this.drum(now + 0.45, 'mid', 0.6, this.sfx);
        this.drum(now + 0.6, 'low', 0.8, this.sfx);
        [79, 83, 86, 91].forEach((m, i) => this.lead(m, now + 0.6 + i * 0.12, 0.3, 'whistle', 0.8, this.sfx));
        break;
      case 'garage': // driving in through the garage door (#37): a quick happy strum up
        [67, 72, 76, 79].forEach((m, i) => this.pluck(m, now + i * 0.06, 0.6, 'banjo', this.sfx));
        break;
      case 'beep': // the old rover's sleepy beep-boop
        this.tone(988, 0.16, { vol: 0.12, type: 'square', delay: 0.5 });
        this.tone(659, 0.3, { vol: 0.12, type: 'square', slide: 0.8, delay: 0.72 });
        break;
      case 'crash':
        this.noiseBurst(1.2, 400, { vol: 0.9, type: 'lowpass' });
        this.noiseBurst(0.5, 1800, { vol: 0.3 });
        this.tone(900, 0.7, { vol: 0.2, slide: 0.15, type: 'square', delay: 0.15 });
        break;
      case 'splash': // the buggy going into or out of a sea (#44): a sploosh and a bloop
        this.noiseBurst(0.45, 900, { vol: 0.35, type: 'lowpass' });
        this.noiseBurst(0.3, 2600, { vol: 0.08, q: 0.7, delay: 0.03 });
        this.tone(320, 0.18, { vol: 0.12, slide: 1.8, delay: 0.05 });
        break;
      case 'bigSplash': // a rocket crashing into a sea (#44): a huge sploosh, then drips
        this.noiseBurst(1.4, 700, { vol: 0.9, type: 'lowpass' });
        this.noiseBurst(0.9, 2400, { vol: 0.25, q: 0.6, delay: 0.05 });
        [0.5, 0.75, 0.95, 1.2].forEach((d, i) => this.tone(500 + i * 130, 0.14, { vol: 0.1, slide: 1.9, delay: d }));
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
      case 'thump': // a buggy landing hard (#26): a soft, dusty crunch
        this.tone(95, 0.18, { vol: 0.22, slide: 0.6 });
        this.noiseBurst(0.22, 420, { vol: 0.14, type: 'lowpass' });
        this.noiseBurst(0.12, 2400, { vol: 0.03, q: 0.8, delay: 0.02 });
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
