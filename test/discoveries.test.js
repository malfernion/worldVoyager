// Discoveries (#15): where the secrets are, what finds them, the ✨ compass, and saving stickers.
import { describe, it, expect, beforeEach } from 'vitest';
import { createSystem } from '../src/physics/bodies.js';
import { Flight } from '../src/physics/sim.js';
import { Buggy, vec } from '../src/physics/buggy.js';
import {
  DISCOVERIES, DUST_DEVILS, FLARE, buggyFinds, landingFinds, discoveryTargets, nearestTarget, groundPoint,
  devilAt, isNight, ringGapCrossed, flareAt, flareSeen, sunDirection, finds,
} from '../src/physics/discoveries.js';
import { FROSTY_GLOWS, NIBBLE_CRATER } from '../src/physics/terrain.js';
import { Progress, STICKERS, DISCOVERY_IDS, GOALS } from '../src/progress.js';
import { sentencesOf } from '../src/ui/speech.js';
import { BUGGIES } from '../src/rocket/parts.js';

const sys = createSystem();
const nobody = () => false;
const onGround = (body, dir) => groundPoint(body, dir);
// A buggy standing still, `east` metres over the ground from `dir`.
function buggyNear(body, dir, metres, kind = 'rover') {
  const b = new Buggy(body, BUGGIES[kind]);
  const u = [dir.x, dir.y, dir.z];
  const side = vec.norm(vec.cross(u, Math.abs(dir.z) > 0.9 ? [1, 0, 0] : [0, 0, 1]));
  b.spawn(vec.add(u, vec.mul(side, metres / body.radius)), vec.cross(side, u));
  b.speed = 0;
  return b;
}

describe('discoveries (#15)', () => {
  it('every discovery has a sticker with a fact and a hint, on a real world', () => {
    expect(DISCOVERY_IDS.length).toBe(DISCOVERIES.length);
    for (const d of DISCOVERIES) {
      const st = STICKERS[d.id];
      expect(st, d.id).toBeTruthy();
      expect(st.world).toBe(d.world);
      expect(sys.byId[d.world], d.world).toBeTruthy();
      expect(st.icon && st.name && st.say && st.hint).toBeTruthy();
    }
  });

  it('Pip says them in short sentences', () => {
    for (const id of DISCOVERY_IDS) {
      for (const line of [STICKERS[id].say, STICKERS[id].hint]) {
        for (const s of sentencesOf(line)) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(14);
      }
    }
  });

  it('every icon in the sticker book is different', () => {
    const icons = Object.values(STICKERS).map((s) => s.icon);
    const discovery = DISCOVERY_IDS.map((id) => STICKERS[id].icon);
    for (const i of discovery) expect(icons.filter((x) => x === i).length, i).toBe(1);
  });

  it('landmarks stand on the ground, on dry land', () => {
    for (const d of DISCOVERIES) {
      for (const s of d.spots ?? []) {
        const body = sys.byId[d.world];
        const p = onGround(body, s);
        expect(vec.len(p)).toBeCloseTo(body.radius + body.terrainFn.height(s.x, s.y, s.z), 6);
        if (body.liquid) expect(body.liquidDepth(s.x, s.y, s.z)).toBeLessThan(-2);
      }
    }
  });

  describe('found by the buggy', () => {
    for (const d of DISCOVERIES.filter((x) => x.find === 'near' || x.find === 'park')) {
      it(`${d.id}: close by finds it, further away doesn't`, () => {
        const body = sys.byId[d.world];
        const ctx = { time: 0, toSun: { x: 1, y: 0, z: 0 }, has: nobody };
        const near = buggyNear(body, d.spots[0], d.reach - 2);
        expect(buggyFinds(body, near, ctx)).toBe(d.id);
        const far = buggyNear(body, d.spots[0], d.reach + 3);
        expect(buggyFinds(body, far, ctx)).toBe(null);
        // Already found: not again.
        expect(buggyFinds(body, near, { ...ctx, has: (id) => id === d.id })).toBe(null);
      });
    }

    it('the laser mirror needs the buggy parked', () => {
      const d = DISCOVERIES.find((x) => x.id === 'find-mirror');
      const body = sys.byId.pebble;
      const b = buggyNear(body, d.spots[0], 2);
      const ctx = { time: 0, toSun: { x: 1, y: 0, z: 0 }, has: nobody };
      b.speed = 4;
      expect(buggyFinds(body, b, ctx)).toBe(null);
      b.speed = 0.2;
      expect(buggyFinds(body, b, ctx)).toBe('find-mirror');
    });

    it('Frosty\'s ocean glow only shows (and counts) at night', () => {
      const body = sys.byId.frosty;
      const g = FROSTY_GLOWS[0];
      const b = buggyNear(body, g, 2);
      const l = Math.hypot(g.x, g.y);
      const day = { x: g.x / l, y: g.y / l, z: 0 };
      const night = { x: -day.x, y: -day.y, z: 0 };
      expect(isNight(g, night)).toBe(true);
      expect(buggyFinds(body, b, { time: 0, toSun: day, has: nobody })).toBe(null);
      expect(buggyFinds(body, b, { time: 0, toSun: night, has: nobody })).toBe('find-ocean');
      // Wherever Ember is, some crack is on the night side.
      for (let a = 0; a < Math.PI * 2; a += 0.1) {
        expect(FROSTY_GLOWS.some((s) => isNight(s, { x: Math.cos(a), y: Math.sin(a), z: 0 }))).toBe(true);
      }
    });

    it('dust devils wander, and driving through one finds it', () => {
      const body = sys.byId.dusty;
      const a = devilAt(0, 0), b = devilAt(0, 60);
      expect(Math.acos(a.x * b.x + a.y * b.y + a.z * b.z) * body.radius).toBeGreaterThan(5);
      const ctx = { time: 60, toSun: { x: 1, y: 0, z: 0 }, has: nobody };
      const inside = buggyNear(body, b, 1.5);
      expect(buggyFinds(body, inside, ctx)).toBe('find-dust-devil');
      const miss = buggyNear(body, b, 9);
      expect(buggyFinds(body, miss, ctx)).toBe(null);
    });

    it('driving into Nibble\'s giant crater finds it', () => {
      const body = sys.byId.nibble;
      const ctx = { time: 0, toSun: { x: 1, y: 0, z: 0 }, has: nobody };
      expect(buggyFinds(body, buggyNear(body, NIBBLE_CRATER, 8), ctx)).toBe('find-crater');
      const away = { x: -NIBBLE_CRATER.x, y: -NIBBLE_CRATER.y, z: -NIBBLE_CRATER.z };
      expect(buggyFinds(body, buggyNear(body, away, 0), ctx)).toBe(null);
      // Flying over it (the Hopper's orbit secret) doesn't count.
      const over = buggyNear(body, NIBBLE_CRATER, 0);
      over.p = vec.mul(over.p, 46 / vec.len(over.p));
      over.grounded = false;
      expect(buggyFinds(body, over, ctx)).toBe(null);
    });
  });

  describe('found by landing', () => {
    it('landing in Nibble\'s giant crater finds it, landing elsewhere doesn\'t', () => {
      const body = sys.byId.nibble;
      const at = Math.atan2(NIBBLE_CRATER.y, NIBBLE_CRATER.x);
      const ctx = { time: 0, toSun: { x: 1, y: 0, z: 0 }, has: nobody };
      expect(landingFinds(body, at, ctx)).toBe('find-crater');
      expect(landingFinds(body, at + 0.3, ctx)).toBe('find-crater');
      expect(landingFinds(body, at + Math.PI, ctx)).toBe(null);
    });

    it('landing right by a landmark finds it', () => {
      // Landmarks keep clear of the flight plane (so they never hide the rocket), so try it with
      // the rocket's foot right under one.
      for (const d of DISCOVERIES.filter((x) => x.find === 'near' || x.find === 'park')) {
        const body = sys.byId[d.world];
        const s = d.spots[0];
        const foot = groundPoint(body, { x: s.x, y: s.y, z: s.z });
        const who = { p: foot, stopped: true, time: 0, toSun: { x: 1, y: 0, z: 0 }, landing: true };
        expect(finds(d, body, who), d.id).toBe(true);
      }
    });

    it('a rocket can\'t land in a dust devil', () => {
      const body = sys.byId.dusty;
      for (let t = 0; t < 200; t += 5) {
        const d = devilAt(0, t);
        expect(landingFinds(body, Math.atan2(d.y, d.x), { time: t, toSun: { x: 1, y: 0, z: 0 }, has: nobody })).not.toBe('find-dust-devil');
      }
    });
  });

  // A pretend kid following the ✨ compass: steer towards the nearest target, stop when there,
  // then on to the next, until everything on the world is found.
  function followCompass(body, kind, startAngle, { toSun = { x: 1, y: 0, z: 0 }, seconds = 300 } = {}) {
    const b = new Buggy(body, BUGGIES[kind]);
    b.spawn([Math.cos(startAngle), Math.sin(startAngle), 0.05], [0, 0, 1]);
    const found = new Set();
    const ctx = { time: 0, toSun, has: (id) => found.has(id) };
    const targets = [];
    let stuck = 0, backing = 0, near = null;
    for (let i = 0; i < seconds * 30; i++) {
      ctx.time = i / 30;
      const id = buggyFinds(body, b, ctx);
      if (id) {
        found.add(id);
        if (process.env.DEBUG_COMPASS) console.log(body.id, startAngle.toFixed(2), id, ctx.time.toFixed(0), 's');
      }
      discoveryTargets(body, ctx, targets);
      near = nearestTarget(targets, b.p);
      if (!near) break;
      const u = b.up;
      let want = vec.sub(near.target.p, b.p);
      want = vec.norm(vec.sub(want, vec.mul(u, vec.dot(want, u))));
      const turn = Math.atan2(vec.dot(vec.cross(b.f, want), u), vec.dot(b.f, want));
      const vf = vec.dot(b.v, b.f);
      let throttle = near.dist < 4 ? (vf > 0.3 ? -1 : 0) : 1;
      let steer = Math.max(-1, Math.min(1, turn * 2));
      // Stuck against something steep: back up for a bit, turning.
      stuck = b.speed < 0.5 && throttle > 0 ? stuck + 1 : 0;
      if (stuck > 60) backing = 60;
      if (backing > 0) {
        backing--;
        throttle = -1;
        steer = 1;
      }
      b.step(1 / 30, { throttle, steer, jump: false });
    }
    return { found, time: ctx.time, left: near };
  }

  describe('following the ✨ compass from any landing spot finds everything on the world', () => {
    const worlds = [...new Set(DISCOVERIES.filter((d) => !['gap', 'flare'].includes(d.find)).map((d) => d.world))];
    for (const w of worlds) {
      it(w, () => {
        const body = sys.byId[w];
        const want = DISCOVERIES.filter((d) => d.world === w).map((d) => d.id).sort();
        // For Frosty's night glow: Ember on the far side from the first crack.
        const g = FROSTY_GLOWS[0], l = Math.hypot(g.x, g.y);
        const toSun = w === 'frosty' ? { x: -g.x / l, y: -g.y / l, z: 0 } : { x: 1, y: 0, z: 0 };
        for (const a of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) {
          const r = followCompass(body, 'rover', a, { toSun });
          expect([...r.found].sort(), `${w} from angle ${a.toFixed(2)}: ${r.left?.target.id} ${r.left?.dist.toFixed(1)} m away`).toEqual(want);
        }
      }, 120000);
    }
  });

  describe('the ring gap', () => {
    const ringo = sys.byId.ringo;
    // The ring plane meets the flight plane along this line (square to the axis's x, y).
    const along = (r, side) => {
      const ax = 0.25, ay = Math.sin(0.6), l = Math.hypot(ax, ay);
      const lx = -ay / l, ly = ax / l;
      return [lx * r + (ax / l) * side, ly * r + (ay / l) * side];
    };

    it('crossing between the clouds and the rings counts', () => {
      const [x0, y0] = along(ringo.radius * 1.25, 20);
      const [x1, y1] = along(ringo.radius * 1.25, -20);
      expect(ringGapCrossed(ringo, x0, y0, x1, y1)).toBe(true);
      expect(ringGapCrossed(ringo, x1, y1, x0, y0)).toBe(true);
    });

    it('crossing through the rings, or not crossing, doesn\'t', () => {
      const [x0, y0] = along(ringo.radius * 1.8, 20);
      const [x1, y1] = along(ringo.radius * 1.8, -20);
      expect(ringGapCrossed(ringo, x0, y0, x1, y1)).toBe(false);
      const [a0, b0] = along(ringo.radius * 1.25, 20);
      const [a1, b1] = along(ringo.radius * 1.25, 5);
      expect(ringGapCrossed(ringo, a0, b0, a1, b1)).toBe(false);
      // Tumble's faint rings aren't the ones.
      expect(ringGapCrossed(sys.byId.tumble, a0, b0, a1, b1)).toBe(false);
    });

    it('a cosy orbit round Ringo dives through the gap, even at top time warp', () => {
      for (const warp of [1, 1000]) {
        const f = new Flight(sys, { accel: 18, turnRate: 1.5, safeSpeed: 8, maxTilt: 0.6 });
        const r = ringo.radius + ringo.spaceLine * 1.3;
        const v = Math.sqrt(ringo.mu / r);
        Object.assign(f.state, { body: ringo, x: r, y: 0, vx: 0, vy: -v, landed: false, t: 100 });
        let crossings = 0;
        let { x, y } = f.state;
        const period = (2 * Math.PI * r) / v;
        for (let i = 0; f.state.t < 100 + period; i++) {
          f.step(1 / 60, warp);
          if (ringGapCrossed(ringo, x, y, f.state.x, f.state.y)) crossings++;
          x = f.state.x;
          y = f.state.y;
        }
        expect(crossings, `warp ${warp}`).toBe(2);
      }
    });
  });

  describe('Ember\'s flares', () => {
    it('come and go', () => {
      expect(flareAt(FLARE.last / 2)).toBeCloseTo(1, 5);
      expect(flareAt(FLARE.last + 1)).toBe(0);
      expect(flareAt(FLARE.period + FLARE.last / 2)).toBeCloseTo(1, 5);
      expect(flareAt(-FLARE.period + FLARE.last / 2)).toBeCloseTo(1, 5);
    });

    it('are seen up close to Ember, in one piece, while it flares', () => {
      const ember = sys.byId.ember;
      const state = (dist, t, extra = {}) => ({ body: ember, x: dist, y: 0, t, crashed: false, ...extra });
      const on = FLARE.last / 2, off = FLARE.last + 10;
      expect(flareSeen(state(ember.radius * 5, on))).toBe(true);
      expect(flareSeen(state(ember.radius * 5, off))).toBe(false);
      expect(flareSeen(state(ember.radius * 8, on))).toBe(false); // out at Homestead's orbit
      expect(flareSeen(state(ember.radius * 5, on, { crashed: true }))).toBe(false);
      expect(flareSeen({ ...state(ember.radius * 0.1, on), body: sys.home })).toBe(false);
    });
  });

  it('the sun direction points from a world to Ember', () => {
    const d = sunDirection(sys.home, 0);
    const w = sys.home.worldPos(0);
    expect(d.x * w.x + d.y * w.y).toBeLessThan(0);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 9);
  });

  it('the compass only lists what is still to find', () => {
    const body = sys.byId.pebble;
    const ctx = { time: 0, toSun: { x: 1, y: 0, z: 0 }, has: nobody };
    expect(discoveryTargets(body, ctx).map((t) => t.id).sort()).toEqual(['find-footprints', 'find-mirror']);
    expect(discoveryTargets(body, { ...ctx, has: (id) => id === 'find-mirror' }).map((t) => t.id)).toEqual(['find-footprints']);
    expect(discoveryTargets(sys.byId.dusty, ctx).filter((t) => t.id === 'find-dust-devil').length).toBe(DUST_DEVILS.length);
    expect(discoveryTargets(sys.byId.ringo, ctx)).toEqual([]);
    expect(nearestTarget([], [0, 0, 0])).toBe(null);
  });
});

describe('saving discoveries (#15)', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    };
  });

  it('a found discovery is saved and still there next time', () => {
    const p = new Progress();
    const heard = [];
    p.on((id) => heard.push(id));
    expect(p.earn('find-observatory')).toBe(true);
    expect(p.earn('find-observatory')).toBe(false);
    expect(heard).toEqual(['find-observatory']);
    const again = new Progress();
    expect(again.has('find-observatory')).toBe(true);
    expect(again.has('find-mirror')).toBe(false);
  });

  it('an older save (before discoveries) still loads', () => {
    store.set('worldVoyager.v1', JSON.stringify({ done: { space: 1, orbit: 2 }, design: { stack: [] }, settings: { music: false } }));
    const p = new Progress();
    expect(p.has('space')).toBe(true);
    expect(p.settings.music).toBe(false);
    expect(DISCOVERY_IDS.some((id) => p.has(id))).toBe(false);
    expect(p.currentGoal.id).toBe('land-homestead');
    p.earn('find-crater');
    const again = new Progress();
    expect(again.has('space') && again.has('find-crater')).toBe(true);
  });

  it('discoveries aren\'t goals (no checklist)', () => {
    for (const id of DISCOVERY_IDS) expect(GOALS.some((g) => g.id === id)).toBe(false);
  });
});
