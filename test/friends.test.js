// Pip's friends, the space band (#16): where they are, saying hello, the 🎵 compass, how loud
// each part is from where you are, Full Band, saving, and the music engine playing every part.
import { describe, it, expect, beforeEach } from 'vitest';
import { createSystem } from '../src/physics/bodies.js';
import { Buggy, vec } from '../src/physics/buggy.js';
import {
  FRIENDS, HEAR, REACH, friendLevel, friendLevels, buggyMeets, landingMeets, friendTargets, campfireAt,
  allFound, fullBandReady, FULL_BAND, homeCampfire,
} from '../src/physics/friends.js';
import { DISCOVERIES, buggyFinds, discoveryTargets, nearestTarget, groundPoint } from '../src/physics/discoveries.js';
import { SIZZLE_VENTS, DUSTY_VOLCANO, NIBBLE_CRATER, FROSTY_GLOWS } from '../src/physics/terrain.js';
import { Progress, STICKERS, FRIEND_IDS, BAND_IDS, GOALS } from '../src/progress.js';
import { sentencesOf } from '../src/ui/speech.js';
import { BUGGIES } from '../src/rocket/parts.js';
import { AudioEngine, FRIEND_PARTS, cutoffFor } from '../src/audio/audio.js';

const sys = createSystem();
const nobody = () => false;
const angle = (a, b) => Math.acos(Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));

// A buggy standing still, `metres` over the ground from `dir`.
function buggyNear(body, dir, metres) {
  const b = new Buggy(body, BUGGIES.rover);
  const u = [dir.x, dir.y, dir.z];
  const side = vec.norm(vec.cross(u, [0, 0, 1]));
  b.spawn(vec.add(u, vec.mul(side, metres / body.radius)), vec.cross(side, u));
  b.speed = 0;
  return b;
}

describe('friends (#16)', () => {
  it('five friends on five different worlds, each with a sticker, a hello, a hint and a part', () => {
    expect(FRIENDS.length).toBe(5);
    expect(new Set(FRIENDS.map((f) => f.world)).size).toBe(5);
    expect(FRIEND_IDS).toEqual(FRIENDS.map((f) => f.id));
    expect(BAND_IDS).toEqual([...FRIEND_IDS, FULL_BAND]);
    for (const id of BAND_IDS) {
      const st = STICKERS[id];
      expect(st.icon && st.name && st.say && st.hint, id).toBeTruthy();
      expect(sys.byId[st.world], id).toBeTruthy();
    }
    for (const f of FRIENDS) {
      expect(STICKERS[f.id].world).toBe(f.world);
      expect(FRIEND_PARTS[f.part], f.part).toBeTruthy();
    }
    expect(new Set(FRIENDS.map((f) => f.part)).size).toBe(5);
  });

  it('every band sticker has its own icon', () => {
    const icons = Object.values(STICKERS).map((s) => s.icon);
    for (const id of BAND_IDS) expect(icons.filter((x) => x === STICKERS[id].icon).length, id).toBe(1);
  });

  it('Pip says it all in short sentences', () => {
    for (const id of BAND_IDS) {
      for (const line of [STICKERS[id].say, STICKERS[id].hint]) {
        for (const s of sentencesOf(line)) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(14);
      }
    }
  });

  it('friends aren\'t goals (no checklist)', () => {
    for (const id of BAND_IDS) expect(GOALS.some((g) => g.id === id)).toBe(false);
  });

  it('campfires are on gentle ground, in front of the flight plane, clear of the discoveries and vents', () => {
    for (const f of FRIENDS) {
      const body = sys.byId[f.world];
      const R = body.radius;
      const p = groundPoint(body, f.spot);
      // In front of the flight plane (so the glow shows on the world's face from orbit), outside
      // the strip kept clear for the rocket, but close enough to land next to.
      expect(p[2], f.id).toBeGreaterThan(16);
      expect(Math.asin(f.spot.z) * R, f.id).toBeLessThan(REACH.landing - 6);
      // Gentle: the ground within 4 m changes height by less than a third of that.
      const h = body.terrainFn.height(f.spot.x, f.spot.y, f.spot.z);
      for (let k = 0; k < 8; k++) {
        const q = (k / 8) * Math.PI * 2;
        const e = 4 / R;
        const d = vec.norm([f.spot.x + Math.cos(q) * e * -f.spot.y, f.spot.y + Math.cos(q) * e * f.spot.x, f.spot.z + Math.sin(q) * e]);
        expect(Math.abs(body.terrainFn.height(d[0], d[1], d[2]) - h) / 4, f.id).toBeLessThan(0.34);
      }
      const avoid = [
        ...DISCOVERIES.filter((d) => d.world === f.world).flatMap((d) => d.spots ?? []),
        ...(f.world === 'sizzle' ? SIZZLE_VENTS : []),
        ...(f.world === 'dusty' ? [DUSTY_VOLCANO] : []),
        ...(f.world === 'nibble' ? [NIBBLE_CRATER] : []),
        ...(f.world === 'frosty' ? FROSTY_GLOWS : []),
      ];
      for (const a of avoid) expect(angle(a, f.spot) * R, f.id).toBeGreaterThan(30);
    }
  });

  describe('how loud a friend is', () => {
    const f = FRIENDS[0];
    const body = sys.byId[f.world];
    const fire = campfireAt(body, f);
    const up = vec.norm(fire);
    const at = (metres) => {
      // A spot `metres` from the campfire over the ground (along the flight-plane direction).
      const side = vec.norm(vec.cross(up, [0, 0, 1]));
      const a = metres / body.radius;
      const dir = vec.norm(vec.add(vec.mul(up, Math.cos(a)), vec.mul(side, Math.sin(a))));
      return groundPoint(body, { x: dir[0], y: dir[1], z: dir[2] }, 1);
    };
    const on = (p, extra = {}) => ({ body, p, ground: true, home: false, party: false, solo: null, ...extra });

    it('grows louder and clearer as you drive up, and is full by the fire', () => {
      let last = { gain: 0, bright: -1 };
      for (let m = 240; m >= 0; m -= 5) {
        const l = friendLevel(f, on(at(m)), false);
        // (Bumps in the ground can make a step a hair further away as the crow flies.)
        expect(l.gain).toBeGreaterThanOrEqual(last.gain - 1e-3);
        expect(l.bright).toBeGreaterThanOrEqual(last.bright - 1e-3);
        expect(l.gain).toBeGreaterThanOrEqual(HEAR.quiet);
        expect(l.gain).toBeLessThanOrEqual(1);
        last = { ...l };
      }
      expect(friendLevel(f, on(at(3)), false).gain).toBeCloseTo(1, 5);
      expect(friendLevel(f, on(at(3)), false).bright).toBeCloseTo(1, 5);
      // Clearly louder every few metres: halfway there by about 60 m.
      expect(friendLevel(f, on(at(120)), false).gain).toBeLessThan(0.3);
      expect(friendLevel(f, on(at(60)), false).gain).toBeGreaterThan(0.4);
      expect(friendLevel(f, on(at(60)), false).gain).toBeLessThan(0.65);
      expect(friendLevel(f, on(at(20)), false).gain).toBeGreaterThan(0.8);
    });

    it('is quiet and muffled from orbit, whichever side you are on', () => {
      const a = Math.atan2(up[1], up[0]);
      for (const da of [0, Math.PI / 2, Math.PI]) {
        const r = body.radius + body.spaceLine * 1.5;
        const l = friendLevel(f, on([Math.cos(a + da) * r, Math.sin(a + da) * r, 0], { ground: false }), false);
        expect(l.gain).toBeGreaterThanOrEqual(HEAR.quiet);
        expect(l.gain).toBeLessThanOrEqual(HEAR.orbit);
        expect(l.bright).toBeLessThan(0.25);
      }
    });

    it('is silent on other worlds and in space, until found; then plays at home', () => {
      const p = [0, 0, 0];
      expect(friendLevel(f, on(p, { body: sys.byId.dusty }), false).gain).toBe(0);
      expect(friendLevel(f, on(p, { body: sys.byId.ember }), true).gain).toBe(0);
      expect(friendLevel(f, on(p, { body: sys.home, home: true }), false).gain).toBe(0);
      const home = friendLevel(f, on(p, { body: sys.home, home: true }), true);
      expect(home.gain).toBe(HEAR.home);
      expect(home.bright).toBe(1);
      expect(friendLevel(f, on(p, { body: null, home: true, party: true }), true).gain).toBe(HEAR.party);
      // Tapped in the sticker book: that one plays up loud, wherever we are.
      expect(friendLevel(f, on(p, { body: sys.byId.ember, solo: f.id }), true).gain).toBe(HEAR.solo);
      expect(friendLevel(f, on(p, { body: sys.byId.ember, solo: f.id }), false).gain).toBe(0);
      expect(friendLevel(FRIENDS[1], on(p, { body: sys.byId.ember, solo: f.id }), true).gain).toBe(0);
    });

    it('fills the same objects every time (no allocation a few times a second)', () => {
      const out = [];
      const where = { body: sys.home, p: [0, 0, 0], home: true, party: false, solo: null };
      friendLevels(where, () => true, out);
      const first = [...out];
      friendLevels(where, nobody, out);
      expect(out.length).toBe(FRIENDS.length);
      out.forEach((o, i) => {
        expect(o).toBe(first[i]);
        expect(o.part).toBe(FRIENDS[i].part);
        expect(o.gain).toBe(0);
      });
    });
  });

  describe('saying hello', () => {
    for (const f of FRIENDS) {
      it(`${f.id}: driving up says hello, further away doesn't, and only once`, () => {
        const body = sys.byId[f.world];
        const near = buggyNear(body, f.spot, REACH.buggy - 2);
        expect(buggyMeets(body, near.p, nobody)).toBe(f.id);
        expect(buggyMeets(body, buggyNear(body, f.spot, REACH.buggy + 3).p, nobody)).toBe(null);
        expect(buggyMeets(body, near.p, (id) => id === f.id)).toBe(null);
        // Nobody else's friend.
        expect(buggyMeets(sys.home, near.p, nobody)).toBe(null);
      });

      it(`${f.id}: landing right next to the campfire says hello, landing far away doesn't`, () => {
        const body = sys.byId[f.world];
        const a = Math.atan2(f.spot.y, f.spot.x);
        expect(landingMeets(body, a, nobody)).toBe(f.id);
        expect(landingMeets(body, a + 0.1 * (80 / body.radius), nobody)).toBe(f.id);
        expect(landingMeets(body, a + Math.PI / 2, nobody)).toBe(null);
        expect(landingMeets(body, a, (id) => id === f.id)).toBe(null);
      });
    }
  });

  it('the compass lists friends still to meet with a 🎵, after the discoveries', () => {
    const body = sys.byId.pebble;
    const ctx = { time: 0, toSun: { x: 1, y: 0, z: 0 }, has: nobody };
    const targets = [];
    discoveryTargets(body, ctx, targets);
    friendTargets(body, ctx.has, targets);
    expect(targets.map((t) => t.id).sort()).toEqual(['find-footprints', 'find-mirror', 'friend-mossy']);
    expect(targets.find((t) => t.id === 'friend-mossy').icon).toBe('🎵');
    expect(targets.filter((t) => t.icon === '✨').length).toBe(2);
    const met = (id) => id === 'friend-mossy';
    discoveryTargets(body, { ...ctx, has: met }, targets);
    friendTargets(body, met, targets);
    expect(targets.some((t) => t.id === 'friend-mossy')).toBe(false);
    expect(friendTargets(sys.home, nobody)).toEqual([]);
  });

  // A pretend kid following the compass (✨ and 🎵): steer to the nearest target, stop there,
  // then on to the next, until everything on the world is found and every friend met.
  function followCompass(body, startAngle, seconds = 360) {
    const b = new Buggy(body, BUGGIES.rover);
    b.spawn([Math.cos(startAngle), Math.sin(startAngle), 0.05], [0, 0, 1]);
    const found = new Set();
    const g = FROSTY_GLOWS[0], l = Math.hypot(g.x, g.y);
    const toSun = body.id === 'frosty' ? { x: -g.x / l, y: -g.y / l, z: 0 } : { x: 1, y: 0, z: 0 };
    const ctx = { time: 0, toSun, has: (id) => found.has(id) };
    const targets = [];
    let stuck = 0, backing = 0, near = null;
    for (let i = 0; i < seconds * 30; i++) {
      ctx.time = i / 30;
      const id = buggyFinds(body, b, ctx) ?? buggyMeets(body, b.p, ctx.has);
      if (id) found.add(id);
      discoveryTargets(body, ctx, targets);
      friendTargets(body, ctx.has, targets);
      near = nearestTarget(targets, b.p);
      if (!near) break;
      const u = b.up;
      let want = vec.sub(near.target.p, b.p);
      want = vec.norm(vec.sub(want, vec.mul(u, vec.dot(want, u))));
      const turn = Math.atan2(vec.dot(vec.cross(b.f, want), u), vec.dot(b.f, want));
      const vf = vec.dot(b.v, b.f);
      let throttle = near.dist < 4 ? (vf > 0.3 ? -1 : 0) : 1;
      let steer = Math.max(-1, Math.min(1, turn * 2));
      stuck = b.speed < 0.5 && throttle > 0 ? stuck + 1 : 0;
      if (stuck > 60) backing = 60;
      if (backing > 0) {
        backing--;
        throttle = -1;
        steer = 1;
      }
      b.step(1 / 30, { throttle, steer, jump: false });
    }
    return { found, left: near };
  }

  describe('following the compass from any landing spot meets the friend (and finds the rest)', () => {
    for (const f of FRIENDS) {
      it(f.world, () => {
        const body = sys.byId[f.world];
        const want = [...DISCOVERIES.filter((d) => d.world === f.world).map((d) => d.id), f.id].sort();
        for (const a of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) {
          const r = followCompass(body, a);
          expect([...r.found].sort(), `${f.world} from ${a.toFixed(2)}: ${r.left?.target.id} ${r.left?.dist.toFixed(1)} m away`).toEqual(want);
        }
      }, 120000);
    }
  });

  describe('Full Band', () => {
    const everyone = (extra = []) => {
      const s = new Set([...FRIEND_IDS, ...extra]);
      return (id) => s.has(id);
    };
    it('needs every friend, and being home', () => {
      expect(allFound(everyone())).toBe(true);
      expect(allFound((id) => id !== 'friend-crumb' && FRIEND_IDS.includes(id))).toBe(false);
      expect(fullBandReady(everyone(), true)).toBe(true);
      expect(fullBandReady(everyone(), false)).toBe(false);
      expect(fullBandReady((id) => id !== 'friend-bolt' && FRIEND_IDS.includes(id), true)).toBe(false);
      // Only once.
      expect(fullBandReady(everyone([FULL_BAND]), true)).toBe(false);
    });

    it('the home campfire is by the launch pad', () => {
      const p = homeCampfire(sys.home);
      const pad = [0, sys.home.surfaceAt(Math.PI / 2), 0];
      expect(Math.hypot(p[0] - pad[0], p[1] - pad[1], p[2] - pad[2])).toBeLessThan(12);
    });
  });
});

describe('saving friends (#16)', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    };
  });

  it('a friend met is saved and still there next time', () => {
    const p = new Progress();
    const heard = [];
    p.on((id) => heard.push(id));
    expect(p.earn('friend-mossy')).toBe(true);
    expect(p.earn('friend-mossy')).toBe(false);
    expect(heard).toEqual(['friend-mossy']);
    const again = new Progress();
    expect(again.has('friend-mossy')).toBe(true);
    expect(again.has('friend-bolt')).toBe(false);
  });

  it('an older save (before friends) still loads', () => {
    store.set('worldVoyager.v1', JSON.stringify({ done: { space: 1, 'find-crater': 2 }, design: { stack: [] }, settings: { music: false } }));
    const p = new Progress();
    expect(p.has('space') && p.has('find-crater')).toBe(true);
    expect(p.settings.music).toBe(false);
    expect(BAND_IDS.some((id) => p.has(id))).toBe(false);
    p.earn('friend-toasty');
    p.earn(FULL_BAND);
    const again = new Progress();
    expect(again.has('space') && again.has('friend-toasty') && again.has(FULL_BAND)).toBe(true);
  });
});

// ---- the music engine, headless ---------------------------------------------------------------

// A fake AudioContext: records nodes and every automation call, and lets us move the clock.
function fakeAudio() {
  const log = { nodes: 0, targets: [], links: [] };
  const param = (v = 0) => ({
    value: v,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime(x) {
      if (!(x > 0)) throw new Error('exponential ramp to ' + x);
    },
    setTargetAtTime(x, t, k) {
      log.targets.push({ x, t, k });
    },
  });
  const node = (extra = {}) => {
    log.nodes++;
    const n = { disconnect() {}, start() {}, stop() {}, ...extra };
    n.connect = (to) => (log.links.push([n, to]), to);
    return n;
  };
  const ctx = {
    currentTime: 0,
    sampleRate: 22050,
    state: 'running',
    destination: {},
    createGain: () => node({ gain: param(1) }),
    createBiquadFilter: () => node({ frequency: param(350), Q: param(1), gain: param(0), type: 'lowpass' }),
    createOscillator: () => node({ frequency: param(440), detune: param(0), type: 'sine' }),
    createBufferSource: () => node({ buffer: null, loop: false }),
    createStereoPanner: () => node({ pan: param(0) }),
    createConvolver: () => node({ buffer: null }),
    createDynamicsCompressor: () => node({ threshold: param(-24), ratio: param(12) }),
    createBuffer: (ch, len, sr) => {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { duration: len / sr, getChannelData: (i) => data[i] };
    },
  };
  return { ctx, log };
}

function startEngine() {
  const { ctx, log } = fakeAudio();
  const a = new AudioEngine();
  a.unlock = { gesture: () => ctx };
  a.start();
  clearInterval(a.timer);
  return { a, ctx, log };
}

const allParts = (gain, bright = 1) => FRIENDS.map((f) => ({ part: f.part, gain, bright }));

describe('the friends\' parts in the music (#16)', () => {
  it('play in every mood with every part on, without throwing, at a sensible cost', () => {
    const { a, ctx, log } = startEngine();
    a.setFriendLevels(allParts(1));
    for (const mood of ['camp', 'space', 'discover']) {
      a.setMood(mood);
      const before = log.nodes;
      const t0 = performance.now();
      // 60 s of music, scheduled the way the 60 ms timer does it.
      for (let i = 0; i < 1000; i++) {
        ctx.currentTime += 0.06;
        a.schedule();
      }
      const ms = performance.now() - t0;
      const perSecond = (log.nodes - before) / 60;
      // A busy campfire band plus five friends: well under a few hundred new nodes a second.
      expect(perSecond, mood).toBeLessThan(250);
      // Karplus-Strong buffers are built once and cached, so after the first moments this is
      // cheap: under 2 ms a call on average even here.
      expect(ms / 1000, mood).toBeLessThan(2);
    }
  });

  it('silent parts cost nothing', () => {
    const quiet = startEngine();
    quiet.a.setFriendLevels(allParts(0));
    const loud = startEngine();
    loud.a.setFriendLevels(allParts(1));
    for (const { a, ctx } of [quiet, loud]) {
      a.setMood('camp');
      for (let i = 0; i < 500; i++) {
        ctx.currentTime += 0.06;
        a.schedule();
      }
    }
    expect(loud.log.nodes).toBeGreaterThan(quiet.log.nodes * 1.5);
    const band = startEngine();
    let friendNotes = 0;
    for (const k of ['drum', 'kalimba']) {
      const f = band.a[k].bind(band.a);
      band.a[k] = (...args) => (friendNotes++, f(...args));
    }
    band.a.setFriendLevels(allParts(0));
    for (let i = 0; i < 300; i++) {
      band.ctx.currentTime += 0.06;
      band.a.schedule();
    }
    expect(friendNotes).toBe(0);
  });

  it('every friend plays only the band\'s chord notes (the same chords, so it all fits)', () => {
    const { a, ctx } = startEngine();
    a.setFriendLevels(allParts(1));
    const wrong = [];
    let notes = 0;
    const check = (midi, part) => {
      notes++;
      const { root, tones } = a.chord;
      const pc = (((midi - root) % 12) + 12) % 12;
      if (!tones.map((t) => t % 12).includes(pc)) wrong.push(`${part} ${midi} over ${root} ${tones}`);
    };
    const orig = { lead: a.lead.bind(a), pluck: a.pluck.bind(a), kalimba: a.kalimba.bind(a) };
    const bus = (dest) => Object.values(a.parts).find((p) => p.gain === dest)?.name;
    a.lead = (m, t, d, k, v, dest) => (bus(dest) && check(m, bus(dest)), orig.lead(m, t, d, k, v, dest));
    a.pluck = (m, t, v, k, dest) => (bus(dest) && check(m, bus(dest)), orig.pluck(m, t, v, k, dest));
    a.kalimba = (m, t, v, dest) => (check(m, 'kalimba'), orig.kalimba(m, t, v, dest));
    for (const mood of ['camp', 'space', 'discover']) {
      a.setMood(mood);
      for (let i = 0; i < 1000; i++) {
        ctx.currentTime += 0.06;
        a.schedule();
      }
    }
    expect(notes).toBeGreaterThan(500);
    expect(wrong).toEqual([]);
  });

  it('levels glide (setTargetAtTime) and only change when they really change', () => {
    const { a, log } = startEngine();
    log.targets.length = 0;
    a.setFriendLevels(allParts(0.5, 0.5));
    // A gain and a filter glide per part, never a jump.
    expect(log.targets.length).toBe(FRIENDS.length * 2);
    for (const t of log.targets) expect(t.k).toBeGreaterThanOrEqual(0.3);
    a.setFriendLevels(allParts(0.5, 0.5));
    a.setFriendLevels(allParts(0.502, 0.505));
    expect(log.targets.length).toBe(FRIENDS.length * 2);
    a.setFriendLevels(allParts(0.8, 1));
    expect(log.targets.length).toBe(FRIENDS.length * 4);
    const part = a.parts.drum;
    expect(log.targets.some((t) => Math.abs(t.x - 0.8 * FRIEND_PARTS.drum.mix) < 1e-9)).toBe(true);
    expect(part.level).toBe(0.8);
    expect(cutoffFor(0)).toBeLessThan(cutoffFor(0.5));
    expect(cutoffFor(1)).toBeGreaterThan(6000);
  });

  it('levels set before the sound starts are used once it does', () => {
    const { ctx } = fakeAudio();
    const a = new AudioEngine();
    a.setFriendLevels(allParts(0.7));
    a.unlock = { gesture: () => ctx };
    a.start();
    clearInterval(a.timer);
    expect(a.parts.whistle.level).toBe(0.7);
  });

  it('go through the music bus, so the music switch and Pip\'s ducking apply to them', () => {
    const { a, log } = startEngine();
    const linked = (from, to) => log.links.some(([x, y]) => x === from && y === to);
    for (const p of Object.values(a.parts)) {
      expect(linked(p.gain, p.filter)).toBe(true);
      expect(linked(p.filter, a.music)).toBe(true);
    }
  });

  it('the whole band at home stays about as loud as the campfire band itself (no clipping)', () => {
    // The loudest moment: every part's loudest note at once, at the Full Band party level.
    const friends = Object.values(FRIEND_PARTS).reduce((sum, p) => sum + p.peak * p.mix, 0) * HEAR.party;
    // The campfire band's own loudest notes: banjo, guitar, bass, lead and a pad chord.
    const band = 0.28 * 0.85 + 0.32 * 0.7 + 0.32 * 0.7 + 0.09 + 6 * 0.05 * 0.35;
    expect(friends).toBeLessThan(band * 1.2);
  });
});
