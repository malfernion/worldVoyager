// The frontier (#62 stage 4): the icy-rock belt round Yonder's distance and the New Horizons-style
// probe flying past Yonder. The belt's place and density, never inside a world or in front of the
// flight plane, its instances and draw calls, hidden from the start view; the probe's path (from
// the game clock, never inside a world, heading out), and finding it by seeing it fly past.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as THREE from 'three';
import { createSystem } from '../src/physics/bodies.js';
import { BELT, BIG_ROCKS, BIG_REACH, beltPlan, sectorOf, sectorMiddle, beltTurn, beltClear, PROBE, probeAt } from '../src/physics/frontier.js';
import { DISCOVERIES, PROBE_VIEW, probeSeen, buggyFinds, landingFinds, discoveryTargets } from '../src/physics/discoveries.js';
import { STICKERS } from '../src/progress.js';
import { SYSTEM_VIEW } from '../src/ui/zoom.js';
import { FlightScene } from '../src/scenes/flight.js';
import { mission, parkAt } from './missions.js';

// createFrontier()'s glint texture draws on a canvas: a do-nothing one here.
const ctx2d = new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true });
globalThis.document ??= { getElementById: () => null };
globalThis.document.createElement ??= () => ({ getContext: () => ctx2d, width: 0, height: 0 });
const { createBelt, createFrontier, beltShown, dotsShown, beltGrow, BELT_LOOK } = await import('../src/world/frontier.js');

const sys = createSystem();
const { yonder, hither, homestead } = sys.byId;
const rocks = beltPlan();
const RADII = 0.8; // a rock reaches at most this many of its sizes from its middle (lump × stretch)

describe('the icy-rock belt (#62 stage 4)', () => {
  it('is a sparse ring round Yonder\'s distance, thickest round its average', () => {
    expect(rocks.length).toBe(BELT.count);
    expect(BELT.inner).toBe(80000); // Yonder's closest
    expect(BELT.outer).toBe(140000); // and farthest
    for (const r of rocks) {
      expect(r.r).toBeGreaterThanOrEqual(BELT.inner);
      expect(r.r).toBeLessThanOrEqual(BELT.outer);
      expect(Math.hypot(r.x, r.y)).toBeCloseTo(r.r, 6);
    }
    const middle = rocks.filter((r) => Math.abs(r.r - BELT.mid) < 10000).length / rocks.length;
    const edges = rocks.filter((r) => Math.abs(r.r - BELT.mid) > 20000).length / rocks.length;
    expect(middle).toBeGreaterThan(0.5);
    expect(edges).toBeLessThan(0.15);
    // Sparse: on average kilometres apart (a rock per a few square km of the ring).
    const area = Math.PI * (BELT.outer ** 2 - BELT.inner ** 2);
    expect(Math.sqrt(area / rocks.length)).toBeGreaterThan(1500);
    // All the way round (no empty arc).
    const per = Array(BELT.sectors).fill(0);
    for (const r of rocks) per[r.sector]++;
    for (const n of per) expect(n).toBeGreaterThan((0.6 * BELT.count) / BELT.sectors);
    // Big ones stay in the ring too.
    for (const b of BIG_ROCKS) expect(b.r > BELT.inner && b.r < BELT.outer).toBe(true);
  });

  it('is small rocks, a few bigger ones, grey ice and reddish tholin', () => {
    const sizes = rocks.map((r) => r.size).sort((a, b) => a - b);
    expect(sizes[0]).toBeGreaterThanOrEqual(BELT.size[0]);
    expect(sizes[sizes.length - 1]).toBeLessThanOrEqual(BELT.size[1]);
    expect(sizes[Math.floor(sizes.length / 2)]).toBeLessThan(40); // mostly small
    for (const b of BIG_ROCKS) expect(b.size * BIG_REACH[b.kind]).toBeLessThan(2 * hither.radius); // never world-sized
    const red = rocks.filter((r) => r.tint > 0.5).length / rocks.length;
    expect(red).toBeGreaterThan(0.25);
    expect(red).toBeLessThan(0.45);
    expect(new Set(BIG_ROCKS.map((b) => b.kind))).toEqual(new Set(['snowman', 'egg', 'round']));
  });

  it('is all behind the flight plane, so never in front of the rocket', () => {
    for (const r of rocks) expect(r.z + r.size * RADII).toBeLessThan(0);
    for (const b of BIG_ROCKS) expect(b.z + (b.size * BIG_REACH[b.kind]) / 2).toBeLessThan(0);
  });

  it('keeps every rock near its arc\'s middle, so none is far from its mesh\'s origin', () => {
    const m = {};
    for (const r of rocks) {
      expect(sectorOf(r.a)).toBe(r.sector);
      sectorMiddle(r.sector, m);
      expect(Math.hypot(r.x - m.x, r.y - m.y)).toBeLessThan(35000); // float32 steps under 4 mm
    }
    expect(sectorOf(-0.001)).toBe(BELT.sectors - 1);
    expect(sectorOf(2 * Math.PI + 0.001)).toBe(0);
  });

  it('turns slowly as one, the way Yonder goes round, on the game clock', () => {
    expect(beltTurn(sys, 0)).toBeCloseTo(0, 12);
    expect(beltTurn(sys, 1000)).toBeCloseTo(yonder.angularSpeed * 1000, 12);
    expect(Math.sign(beltTurn(sys, 1000))).toBe(yonder.orbitDir);
    // Once round in one of Yonder's years (about 30 m/s at the belt's middle).
    expect(Math.abs(beltTurn(sys, yonder.orbitalPeriod))).toBeCloseTo(2 * Math.PI, 6);
  });

  it('never draws a rock inside a world: none near any other world, and near Yonder they shrink away', () => {
    // No other world ever comes near the ring.
    for (const b of sys.bodies) {
      if (!b.parent || b === yonder || b === hither) continue;
      let far = 0;
      for (let t = 0; t < 30000; t += 50) {
        const w = b.worldPos(t, {});
        far = Math.max(far, Math.hypot(w.x, w.y) + b.radius);
      }
      expect(far, b.id).toBeLessThan(BELT.inner - 10000);
    }
    // Hither's orbit and ball, and Yonder's, are inside where rocks are gone.
    expect(hither.orbitRadius + hither.radius + BELT.size[1] * RADII).toBeLessThan(BELT.clear[0]);
    expect(beltClear(BELT.clear[0])).toBe(0);
    expect(beltClear(BELT.clear[0] - 500)).toBe(0);
    expect(beltClear(BELT.clear[1])).toBe(1);
    expect(beltClear((BELT.clear[0] + BELT.clear[1]) / 2)).toBeCloseTo(0.5, 6);
    // Over a year: every rock still drawn near Yonder is well clear of both worlds.
    let checked = 0;
    for (let t = 0; t < yonder.orbitalPeriod; t += yonder.orbitalPeriod / 60) {
      const y = yonder.worldPos(t, {}), h = hither.worldPos(t, {});
      const a = beltTurn(sys, t), c = Math.cos(a), s = Math.sin(a);
      for (const r of rocks) {
        const x = c * r.x - s * r.y, yy = s * r.x + c * r.y;
        const d = Math.hypot(x - y.x, yy - y.y);
        if (d > BELT.clear[1] + 1000 || beltClear(d) === 0) continue;
        checked++;
        const reach = r.size * RADII * beltClear(d);
        expect(Math.hypot(x - y.x, yy - y.y, r.z) - reach).toBeGreaterThan(yonder.radius + 1000);
        expect(Math.hypot(x - h.x, yy - h.y, r.z) - reach).toBeGreaterThan(hither.radius + 100);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('is only the look: no body, and the flight, prediction and helpers never read it', () => {
    expect(sys.bodies.map((b) => b.id)).not.toContain('belt');
    expect(sys.bodies.map((b) => b.id)).not.toContain('probe');
    for (const f of ['sim', 'predict', 'autopilot', 'orbit', 'bodies', 'buggy']) {
      expect(readFileSync(new URL(`../src/physics/${f}.js`, import.meta.url), 'utf8'), f).not.toMatch(/frontier/);
    }
  });

  it('is few draw calls: an instanced mesh (and its ink) per arc, an instance per big one, one draw call of map dots', () => {
    const belt = createBelt();
    expect(belt.arcs.length).toBe(BELT.sectors);
    let n = 0, tris = 0;
    for (const a of belt.arcs) {
      expect(a.isInstancedMesh).toBe(true);
      expect(a.children.length).toBe(1); // its ink, sharing the matrices
      expect(a.children[0].instanceMatrix).toBe(a.instanceMatrix);
      expect(a.count).toBeLessThan((2 * BELT.count) / BELT.sectors);
      n += a.count;
      tris += (a.geometry.attributes.position.count / 3) * a.count;
      // Culled whole when off screen: an arc's bounds are an arc, not the ring.
      expect(a.boundingSphere.radius).toBeLessThan(40000);
    }
    expect(n).toBe(BELT.count);
    expect(tris / BELT.count).toBeLessThanOrEqual(20); // low-poly lumps
    expect(belt.big.length).toBe(BIG_ROCKS.length);
    for (const b of belt.big) expect(b.count).toBe(1);
    // Every mesh shares the one rock material and the one ink material (two programs).
    const mats = new Set(), inks = new Set();
    for (const m of [...belt.arcs, ...belt.big]) {
      mats.add(m.material);
      inks.add(m.children[0].material);
    }
    expect(mats.size).toBe(1);
    expect(inks.size).toBe(1);
    expect(belt.dots.isPoints).toBe(true);
    expect(belt.dots.geometry.attributes.position.count).toBe(BELT.count + BIG_ROCKS.length);
  });

  it('never smaller than a speck on screen, and never grown huge', () => {
    const perPx = (2 * Math.tan(THREE.MathUtils.degToRad(25))) / 390;
    expect(beltGrow(40, 100, perPx)).toBe(1); // close by: its real size
    const far = beltGrow(20, 15000, perPx);
    expect(far).toBeGreaterThan(1);
    expect((20 * far) / (15000 * perPx)).toBeCloseTo(BELT_LOOK.minPx, 6);
    expect(beltGrow(18, 1e6, perPx)).toBe(BELT_LOOK.maxGrow);
  });

  it('keeps the start the same: hidden on the pad and anywhere inside Tumble\'s orbit, only faint dots on the map', () => {
    // The pad: the camera at Homestead, low.
    const w = homestead.worldPos(0, {});
    expect(beltShown('flight', 50, Math.hypot(w.x, w.y))).toBe(false);
    expect(dotsShown('flight', 50)).toBe(0);
    // Zoomed right out in flight anywhere up to Tumble's orbit.
    expect(beltShown('flight', 15000, 56000)).toBe(false);
    // Driving: never.
    expect(beltShown('drive', 10, 110000)).toBe(false);
    // Out there: drawn.
    expect(beltShown('flight', 6000, 110000)).toBe(true);
    expect(beltShown('flight', 200, 81000)).toBe(true);
    // The map: the rocks' meshes only zoomed in; the dots only zoomed out, and faint.
    expect(beltShown('map', 200000, 110000)).toBe(false);
    expect(dotsShown('map', 5000)).toBe(0);
    expect(dotsShown('map', 1.2 * SYSTEM_VIEW)).toBe(1);
    expect(BELT_LOOK.dotOpacity).toBeLessThanOrEqual(0.5);
  });

  it('places everything relative to the floating origin, allocating nothing per frame, and hides it all while driving', () => {
    const fr = createFrontier(sys);
    const cam = new THREE.PerspectiveCamera(50, 844 / 390, 1, 3e6);
    const t = 5000;
    const a = 0.5 + beltTurn(sys, t);
    const origin = { x: 108000 * Math.cos(a), y: 108000 * Math.sin(a) };
    const ctx = { t, time: 1, origin, camera: cam, mode: 'flight', camWorld: { ...origin }, camHeight: 5000, yonder: null, viewH: 390 };
    fr.update(ctx);
    expect(fr.belt.group.visible).toBe(true);
    // Every arc near the camera sits within its own size of the scene's middle.
    const near = fr.belt.arcs.filter((m) => m.position.length() < 40000);
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThan(5);
    for (const m of fr.belt.arcs) expect(m.rotation.z).toBeCloseTo(beltTurn(sys, t), 12);
    // An arc's scene position is its middle (turned with the belt) less the origin.
    const arc = near[0], mid = arc.userData.mid;
    const c = Math.cos(beltTurn(sys, t)), s = Math.sin(beltTurn(sys, t));
    expect(arc.position.x).toBeCloseTo(c * mid.x - s * mid.y - origin.x, 6);
    expect(arc.position.y).toBeCloseTo(s * mid.x + c * mid.y - origin.y, 6);
    ctx.mode = 'drive';
    fr.update(ctx);
    expect(fr.belt.group.visible).toBe(false);
    expect(fr.belt.dots.visible).toBe(false);
    expect(fr.probe.group.visible).toBe(false);
    // The update itself makes no objects: same objects before and after.
    const before = [fr.at, fr.belt.uniforms.fcAt.value, fr.probe.turn.quaternion];
    ctx.mode = 'flight';
    fr.update(ctx);
    expect([fr.at, fr.belt.uniforms.fcAt.value, fr.probe.turn.quaternion]).toEqual(before);
  });
});

describe('the probe (#62 stage 4)', () => {
  const pass = (lap) => (lap + 0.5) * PROBE.period;

  it('is where the game clock says, whatever was asked before (saves, rewind, warp)', () => {
    const a = probeAt(sys, 12345.6, {});
    probeAt(sys, 99, {});
    probeAt(sys, 50000, {});
    expect(probeAt(sys, 12345.6, {})).toEqual(a);
  });

  it('flies past Yonder once a pass: straight, fast, closest at the middle, fading in and out far away', () => {
    const at = pass(12);
    const p = probeAt(sys, at, {});
    expect(p.s).toBeCloseTo(0, 6);
    expect(p.k).toBe(1);
    expect(Math.hypot(p.x - p.sx, p.y - p.sy)).toBeCloseTo(PROBE.pass, 6);
    // Faster than a low orbit round Yonder.
    const speed = (2 * PROBE.reach) / PROBE.period;
    expect(speed).toBeGreaterThan(2 * Math.sqrt(yonder.mu / (yonder.radius * 2)));
    // Straight, in Yonder's frame.
    const q = probeAt(sys, at + 30, {}), o = probeAt(sys, at - 30, {});
    const ax = q.x - q.sx - (o.x - o.sx), ay = q.y - q.sy - (o.y - o.sy);
    expect(Math.hypot(ax, ay)).toBeCloseTo(60 * speed, 6);
    expect((ax * p.hx + ay * p.hy) / Math.hypot(ax, ay)).toBeCloseTo(1, 9);
    // Fades at the ends, where it's far from Yonder, so its jump back is never seen.
    expect(probeAt(sys, 12 * PROBE.period + 0.01, {}).k).toBeLessThan(0.001);
    expect(probeAt(sys, 13 * PROBE.period - 0.01, {}).k).toBeLessThan(0.001);
    for (const dt of [-0.45, -0.4, 0.4, 0.45]) {
      const e = probeAt(sys, at + dt * PROBE.period, {});
      if (e.k < 1) expect(Math.hypot(e.x - e.sx, e.y - e.sy)).toBeGreaterThan(yonder.soi);
    }
    // Moves smoothly within a pass (no jumps frame to frame).
    let last = probeAt(sys, 12 * PROBE.period + 1, {});
    for (let t = 12 * PROBE.period + 1.1; t < 13 * PROBE.period - 1; t += 0.1) {
      const n = probeAt(sys, t, {});
      expect(Math.hypot(n.x - last.x, n.y - last.y)).toBeLessThan(0.1 * (speed + 400));
      last = n;
    }
  });

  it('heads away from Ember, on the side away from Hither (Yonder\'s heart side, like New Horizons)', () => {
    for (let lap = 0; lap < 60; lap++) {
      const at = pass(lap);
      const p = probeAt(sys, at, {});
      expect(p.hx * p.sx + p.hy * p.sy).toBeGreaterThanOrEqual(0);
      const h = hither.relPos(at, {});
      expect((p.x - p.sx) * h.x + (p.y - p.sy) * h.y).toBeLessThan(0);
    }
  });

  it('is never inside a world, nor in front of the flight plane', () => {
    expect(PROBE.z + PROBE.radius).toBeLessThan(0);
    let yMin = Infinity, hMin = Infinity;
    for (let t = 0; t < 60 * PROBE.period; t += 1) {
      const p = probeAt(sys, t, {});
      if (p.k === 0) continue;
      for (const b of sys.bodies) {
        const w = b.worldPos(t, {});
        const d = Math.hypot(p.x - w.x, p.y - w.y, p.z);
        expect(d, `${b.id} at ${t}`).toBeGreaterThan(b.radius + PROBE.radius);
        if (b === yonder) yMin = Math.min(yMin, d);
        if (b === hither) hMin = Math.min(hMin, d);
      }
    }
    expect(yMin).toBeGreaterThan(PROBE.pass - 1);
    expect(hMin).toBeGreaterThan(1500);
  });

  it('is a discovery with a sticker, a New Horizons fact and a hint, found only by seeing it', () => {
    const d = DISCOVERIES.find((x) => x.id === 'find-probe');
    expect(d.world).toBe('yonder');
    expect(d.find).toBe('probe');
    const st = STICKERS['find-probe'];
    expect(st.say).toContain('New Horizons');
    expect(st.say).toContain('Pluto');
    expect(st.hint).toContain('Yonder');
    // Not on the ground: the buggy, landing and the ✨ compass never find it.
    const ctx = { time: 0, toSun: { x: 1, y: 0, z: 0 }, has: (id) => id !== 'find-probe' };
    expect(discoveryTargets(yonder, ctx).map((x) => x.id)).not.toContain('find-probe');
    expect(landingFinds(yonder, 0.3, ctx)).toBe(null);
    expect(buggyFinds(yonder, { p: [yonder.radius, 0, 0], speed: 0, grounded: true }, ctx)).toBe(null);
  });

  it('needs it on screen, clear of the buttons, properly there, and big enough or right by the rocket', () => {
    const v = { x: 0.1, y: 0.1, behind: false, px: 4, k: 1, near: 3000 };
    expect(probeSeen(v)).toBe(true);
    expect(probeSeen({ ...v, px: PROBE_VIEW.px - 0.5 })).toBe(false); // a dot, far off
    expect(probeSeen({ ...v, px: 1, near: 300 })).toBe(true); // flying right by it
    expect(probeSeen({ ...v, behind: true })).toBe(false);
    expect(probeSeen({ ...v, x: 0.95 })).toBe(false); // under the buttons
    expect(probeSeen({ ...v, y: -0.8 })).toBe(false);
    expect(probeSeen({ ...v, k: 0.2 })).toBe(false); // fading in at a pass's end
  });

  // A flight scene with just what probeInView() needs (like test/hither.test.js).
  function scene(m, mode = 'flight', zoom = 1) {
    globalThis.window ??= {};
    Object.assign(globalThis.window, { innerWidth: 844, innerHeight: 390 });
    const s = Object.create(FlightScene.prototype);
    Object.assign(s, {
      flight: m.flight, system: m.sys, time: 0, crashed: false, mode: 'flight', origin: { x: 0, y: 0 }, tmp: {}, tmp2: {}, tmp3: {},
      mapAt: { x: 0, y: 0 }, mapOff: { x: 0, y: 0 }, mapGoalAt: { x: 0, y: 0 }, mapDist: 2000, zoom, carry: 1, camSettle: false,
      camera: new THREE.PerspectiveCamera(50, 844 / 390, 1, 3e6), camUp: new THREE.Vector3(0, 1, 0), rocket: { height: 6 },
      drive: { active: false }, visuals: [],
    });
    s.look = () => {
      const rw = s.flight.worldPos({});
      if (mode === 'map') {
        s.mode = 'map';
        s.mapAt.x = rw.x;
        s.mapAt.y = rw.y;
      }
      s.placeOrigin(rw);
      s.updateCamera(0);
      const r = s.probeInView();
      s.seen = { ...s.probeView, p: undefined };
      return r;
    };
    return s;
  }

  // The rocket in Yonder's space `off` metres from the probe's closest point, at that time.
  function nearPass(lap, off, dt = 0) {
    const at = pass(lap) + dt;
    const p = probeAt(sys, pass(lap), {});
    const m = mission();
    parkAt(m, 'yonder', at, 0);
    const st = m.flight.state;
    const dx = p.x - p.sx, dy = p.y - p.sy, l = Math.hypot(dx, dy);
    st.x = dx + (dx / l) * off;
    st.y = dy + (dy / l) * off;
    st.angle = Math.atan2(st.y, st.x) - Math.PI / 2;
    return m;
  }

  // A kid parked in a low orbit round Yonder, on the side the probe passes, watching: is it found
  // on some frame as it flies by (±`span` s round its closest)?
  function watch(lap, zoom, mode = 'flight', span = 90) {
    const p = probeAt(sys, pass(lap), {});
    const side = Math.atan2(p.y - p.sy, p.x - p.sx);
    for (let dt = -span; dt <= span; dt += 1) {
      const m = mission();
      parkAt(m, 'yonder', pass(lap) + dt, side);
      const s = scene(m, mode, zoom);
      if (mode === 'map') s.mapDist = zoom;
      if (s.look()) return true;
    }
    return false;
  }

  it('is found in the flight view as it flies past a rocket in a low orbit round Yonder, whenever the pass is', () => {
    // Zoomed out a little from the parked view (it passes about 110 m above the parking orbit).
    for (const lap of [0, 7, 31, 55]) {
      expect(watch(lap, 3), `lap ${lap}`).toBe(true);
      expect(watch(lap, 8), `lap ${lap} zoomed out more`).toBe(true);
    }
    // Right in close on the rocket it's off the top of the screen: it has to be seen.
    expect(watch(7, 0.3)).toBe(false);
  });

  it('is found flying along with it, at the flight view\'s usual zoom', () => {
    // The rocket 40 m behind it on its way, at its height.
    const p = probeAt(sys, pass(9), {});
    const m = nearPass(9, 0);
    m.flight.state.x -= p.hx * 40;
    m.flight.state.y -= p.hy * 40;
    const sc = scene(m);
    expect(sc.look()).toBe(true);
    expect(sc.seen.near).toBeLessThan(PROBE_VIEW.near);
  });

  it('is not found far from it, before it comes, or while driving', () => {
    // Parked in a low orbit on the far side of Yonder from its pass.
    expect(scene(nearPass(3, -2 * PROBE.pass)).look()).toBe(false);
    // Long before it comes by (the rocket where it will pass).
    expect(scene(nearPass(3, -100, -0.4 * PROBE.period)).look()).toBe(false);
    // At home.
    const m = mission();
    parkAt(m, 'homestead', pass(3), 0);
    expect(scene(m).look()).toBe(false);
    const d = scene(nearPass(3, -120));
    d.drive = { active: true };
    expect(d.look()).toBe(false);
    const c = scene(nearPass(3, -120));
    c.crashed = true;
    expect(c.look()).toBe(false);
  });
});
