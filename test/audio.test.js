import { describe, it, expect } from 'vitest';
import { AudioUnlock, setPlaybackSession, decodeAudio, silentWav, isAppleTouch, makeContext } from '../src/audio/unlock.js';

// A fake AudioContext that behaves like iOS: resume() only works inside a tap.
class FakeCtx {
  constructor() {
    this.state = 'suspended';
    this.sampleRate = 48000;
    this.destination = {};
    this.inTap = false;
    this.started = 0;
    this.resumeCalls = 0;
  }
  resume() {
    this.resumeCalls++;
    if (this.inTap) this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  createBuffer() {
    return {};
  }
  createBufferSource() {
    return { connect: () => {}, start: () => this.started++ };
  }
}

const tapOn = (unlock, ctx) => {
  ctx.inTap = true;
  const out = unlock.gesture();
  ctx.inTap = false;
  return out;
};

describe('audio unlock (iOS WebKit, #24)', () => {
  it('creates the context once on the first tap, resumes and primes it', () => {
    let made = 0;
    const ctx = new FakeCtx();
    const u = new AudioUnlock({ create: () => (made++, ctx) });
    expect(u.debugState().ctxState).toBe('none');
    expect(tapOn(u, ctx)).toBe(ctx);
    expect(ctx.state).toBe('running');
    expect(ctx.started).toBe(1);
    expect(u.debugState().unlocked).toBe(true);
    // Later taps are cheap: no new context, no resume, no more silent buffers.
    tapOn(u, ctx);
    tapOn(u, ctx);
    expect(made).toBe(1);
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.started).toBe(1);
  });

  it('comes back after an app switch or a phone call on the next tap', () => {
    const ctx = new FakeCtx();
    const u = new AudioUnlock({ create: () => ctx });
    tapOn(u, ctx);
    u.hide();
    expect(ctx.state).toBe('suspended');
    u.show(); // outside a tap: iOS refuses
    expect(ctx.state).toBe('suspended');
    tapOn(u, ctx);
    expect(ctx.state).toBe('running');
    ctx.state = 'interrupted'; // Siri, a call
    tapOn(u, ctx);
    expect(ctx.state).toBe('running');
  });

  it('never resumes a closed context and survives no Web Audio at all', () => {
    const ctx = new FakeCtx();
    const u = new AudioUnlock({ create: () => ctx });
    tapOn(u, ctx);
    ctx.state = 'closed';
    const calls = ctx.resumeCalls;
    tapOn(u, ctx);
    expect(ctx.resumeCalls).toBe(calls);
    const none = new AudioUnlock({ create: () => null });
    expect(none.gesture()).toBe(null);
    expect(makeContext({})).toBe(null);
    expect(makeContext(null)).toBe(null);
  });

  it('records a failed resume instead of throwing', async () => {
    const ctx = new FakeCtx();
    ctx.resume = () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    const u = new AudioUnlock({ create: () => ctx });
    expect(() => u.gesture()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(u.debugState().lastError).toBe('resume: NotAllowedError');
  });

  it('asks for the playback audio session where it exists', () => {
    const nav = { audioSession: { type: 'auto' } };
    expect(setPlaybackSession(nav)).toBe(true);
    expect(nav.audioSession.type).toBe('playback');
    expect(setPlaybackSession({})).toBe(false);
    expect(setPlaybackSession(null)).toBe(false);
    const locked = { get audioSession() { throw new Error('nope'); } };
    expect(setPlaybackSession(locked)).toBe(false);
    const u = new AudioUnlock({ nav: { audioSession: { type: 'auto' } }, create: () => new FakeCtx() });
    expect(u.debugState().sessionSet).toBe(true);
    expect(u.debugState().audioSession).toBe('playback');
  });

  it('uses the silent <audio> trick only on older iOS, and pauses it while hidden', () => {
    const el = () => ({ paused: true, plays: 0, play() { this.plays++; this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } });
    const oldIpad = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 };
    const a = el();
    const ctx = new FakeCtx();
    const u = new AudioUnlock({ nav: oldIpad, silentEl: a, create: () => ctx });
    tapOn(u, ctx);
    expect(a.plays).toBe(1);
    tapOn(u, ctx);
    expect(a.plays).toBe(1);
    u.hide();
    expect(a.paused).toBe(true);
    tapOn(u, ctx); // a tap while hidden (unlikely) doesn't restart it
    expect(a.plays).toBe(1);
    u.show();
    tapOn(u, ctx);
    expect(a.plays).toBe(2);
    // New iOS (audioSession) and desktop never touch it.
    for (const nav of [{ ...oldIpad, audioSession: { type: 'auto' } }, { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64', maxTouchPoints: 0 }]) {
      const b = el();
      const c = new FakeCtx();
      const v = new AudioUnlock({ nav, silentEl: b, create: () => c });
      tapOn(v, c);
      expect(b.plays).toBe(0);
      expect(v.debugState().silentAudio).toBe('unused');
    }
  });

  it('spots iPhones and iPads (including iPadOS pretending to be a Mac)', () => {
    expect(isAppleTouch({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) CriOS/120' })).toBe(true);
    expect(isAppleTouch({ userAgent: 'Mac', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isAppleTouch({ userAgent: 'Mac', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isAppleTouch({ userAgent: 'Android', platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false);
  });

  it('decodes with the promise form and the old callback-only form', async () => {
    const modern = { decodeAudioData: (d) => Promise.resolve('buf:' + d) };
    expect(await decodeAudio(modern, 'a')).toBe('buf:a');
    const old = { decodeAudioData: (d, ok) => { setTimeout(() => ok('old:' + d)); } };
    expect(await decodeAudio(old, 'b')).toBe('old:b');
    const bad = { decodeAudioData: (d, ok, err) => { setTimeout(() => err(null)); } };
    await expect(decodeAudio(bad, 'c')).rejects.toThrow('decode failed');
    const throws = { decodeAudioData: () => { throw new TypeError('Not enough arguments'); } };
    await expect(decodeAudio(throws, 'd')).rejects.toThrow('Not enough arguments');
  });

  it('makes a tiny valid silent WAV', () => {
    const uri = silentWav();
    expect(uri.length).toBeLessThan(6000);
    const bytes = Uint8Array.from(atob(uri.split(',')[1]), (c) => c.charCodeAt(0));
    const txt = (o) => String.fromCharCode(...bytes.slice(o, o + 4));
    expect(txt(0) + txt(8) + txt(12) + txt(36)).toBe('RIFFWAVEfmt data');
    const v = new DataView(bytes.buffer);
    expect(v.getUint32(4, true)).toBe(bytes.length - 8);
    expect(v.getUint32(40, true)).toBe(4000);
    expect(bytes.slice(44).every((b) => b === 128)).toBe(true);
  });
});
