// Hither (#62, stage 3): Yonder's big twin moon, like Charon round Pluto. Its orbit and sphere of
// influence (inside Yonder's, clear of everything); the two tidally locked, facing each other
// forever (both spin about z once a lap), and what that means for the ground under a landed
// rocket and a buggy; Yonder's heart still on the side the cameras see (and still found); the
// Charon look (a dark red cap, craters); its landscape (#62, the owner's pass: two branching
// chasms, Kubrick Mons's broad massif in its moat, crisp craters); landing and driving; trips there and
// back; the double world's discovery (seeing both together); Ember's far light out there too.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSystem } from '../src/physics/bodies.js';
import { makeTerrain, SPIN_AXES, YONDER_HEART, HITHER_CAP, HITHER_BELT, HITHER_MOUNT, HITHER_CHASMS, KUBRICK, heartDir, heartDist } from '../src/physics/terrain.js';
import { DISCOVERIES, PAIR_VIEW, pairSeen, sunDirection } from '../src/physics/discoveries.js';
import { parkingRadius, inStableOrbit } from '../src/physics/autopilot.js';
import { airOf } from '../src/physics/exhaust.js';
import { Buggy, vec } from '../src/physics/buggy.js';
import { BUGGIES } from '../src/rocket/parts.js';
import { STICKERS, GOALS } from '../src/progress.js';
import { ROCKY_LOOK } from '../src/world/richLook.js';
import { farLight } from '../src/world/planets.js';
import { FlightScene } from '../src/scenes/flight.js';
import { DriveMode } from '../src/scenes/drive.js';
import { mission, parkAt, gotoTrip } from './missions.js';

globalThis.document ??= { getElementById: () => null };

const sys = createSystem();
const { yonder, hither, ember } = sys.byId;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ter = makeTerrain('hither');

describe('Hither\'s orbit (#62 stage 3)', () => {
  it('goes round Yonder close enough to see both at once, and is half its size', () => {
    expect(hither.parent).toBe(yonder);
    expect(yonder.children).toEqual([hither]);
    expect(hither.ecc).toBe(0);
    expect(hither.orbitDir).toBe(-1);
    // Real Charon is at about 16 Pluto radii; here a little closer, for the view and short hops.
    expect(hither.orbitRadius / yonder.radius).toBeGreaterThan(8);
    expect(hither.orbitRadius / yonder.radius).toBeLessThan(12);
    expect(hither.radius / yonder.radius).toBeCloseTo(0.5, 1);
    expect(hither.gravity).toBeLessThan(yonder.gravity);
    // One lap in about 25 game minutes (Charon's is 6.4 days).
    expect(hither.orbitalPeriod).toBeGreaterThan(1200);
    expect(hither.orbitalPeriod).toBeLessThan(1800);
  });

  it('its sphere of influence fits inside Yonder\'s with room to spare, clear of Yonder\'s parking orbit', () => {
    expect(hither.orbitRadius + hither.soi).toBeLessThan(yonder.soi - 500);
    expect(hither.orbitRadius - hither.soi).toBeGreaterThan(parkingRadius(yonder) + 500);
    // Its own: well inside the Laplace sphere, with room for its parking orbit.
    expect(hither.soi).toBeLessThan(hither.orbitRadius * (hither.mu / yonder.mu) ** 0.4);
    expect(parkingRadius(hither)).toBeLessThan(hither.soi * 0.4);
    // Yonder's own sphere (stage 1's, which test/yonder.test.js keeps clear of everything) is unchanged.
    expect(yonder.soi).toBe(3000);
  });

  it('starts opposite Yonder\'s heart, as Charon is from Pluto\'s', () => {
    const p = hither.relPos(0);
    const heart = Math.atan2(YONDER_HEART.c.y, YONDER_HEART.c.x);
    expect(Math.abs(wrap(Math.atan2(p.y, p.x) - heart - Math.PI))).toBeLessThan(0.01);
  });
});

describe('facing each other forever: tidally locked (#62 stage 3)', () => {
  const faces = (t) => {
    const p = hither.relPos(t);
    return {
      // Which way the other one is, in each world's own (spinning) frame.
      hither: Math.atan2(-p.y, -p.x) - hither.spinAt(t),
      yonder: Math.atan2(p.y, p.x) - yonder.spinAt(t),
    };
  };

  it('Hither always shows Yonder the same face, and Yonder always shows Hither the same face', () => {
    const f0 = faces(0);
    for (const t of [0, 1, 137, 764, 1527, 5000, 22000, 123456]) {
      const f = faces(t);
      expect(Math.abs(wrap(f.hither - f0.hither)), `t ${t}`).toBeLessThan(1e-6);
      expect(Math.abs(wrap(f.yonder - f0.yonder)), `t ${t}`).toBeLessThan(1e-6);
    }
    // ...while they really do turn: a quarter of a lap later each has turned a quarter.
    const q = hither.orbitalPeriod / 4;
    expect(Math.abs(wrap(hither.spinAt(q)))).toBeCloseTo(Math.PI / 2, 6);
    expect(Math.abs(wrap(yonder.spinAt(q)))).toBeCloseTo(Math.PI / 2, 6);
    // Both the way Hither goes round (clockwise), and not turned at the start.
    expect(Math.sign(hither.spinRate)).toBe(hither.orbitDir);
    expect(Math.abs(yonder.spinAt(0))).toBe(0);
  });

  it('no other world turns (their ground and meshes are exactly as before)', () => {
    for (const b of sys.bodies) {
      if (b === hither || b === yonder) continue;
      expect(b.spinRate, b.id).toBe(0);
      expect(b.spinAt(5000), b.id).toBe(0);
      expect(b.surfaceUnder(1.3, 5000), b.id).toBe(b.surfaceAt(1.3));
    }
  });

  it('Ember goes round each one\'s sky once a turn (the discoveries\' sun is in the world\'s own frame)', () => {
    for (const b of [hither, yonder]) {
      const a = sunDirection(b, 0), later = sunDirection(b, hither.orbitalPeriod / 4);
      // (The ground turns a quarter; Ember moves on only a little, Yonder going round it.)
      expect(Math.abs(wrap(Math.atan2(later.y, later.x) - Math.atan2(a.y, a.x)) - Math.PI / 2)).toBeLessThan(0.25);
    }
  });

  it('a landed rocket turns with the ground: the same spot, on the ground, upright, and takes off again', () => {
    for (const world of ['hither', 'yonder']) {
      const m = parkAt(mission(), world, 500, 1);
      expect(m.run('land')).toBe(true);
      const s = m.flight.state;
      expect(s.landed).toBe(true);
      const spot = s.landAngle;
      const up0 = Math.atan2(s.y, s.x);
      for (let i = 0; i < 20; i++) {
        m.flight.step(1 / 60, 1000);
        expect(s.landAngle).toBe(spot);
        expect(Math.abs(m.flight.altitude)).toBeLessThan(1e-6);
        expect(Math.abs(wrap(s.angle - Math.atan2(s.y, s.x)))).toBeLessThan(1e-9); // standing straight up
        expect(Math.abs(wrap(Math.atan2(s.y, s.x) - spot - s.body.spinAt(s.t)))).toBeLessThan(1e-9);
      }
      expect(Math.abs(wrap(Math.atan2(s.y, s.x) - up0))).toBeGreaterThan(0.5); // it has gone round with it
      expect(s.crashed).toBe(false);
      expect(m.run('orbit')).toBe(true);
      expect(inStableOrbit(m.flight), world).toBe(true);
    }
  });

  it('touching down, what counts is the speed against the ground', () => {
    const m = parkAt(mission(), 'hither', 800, 0);
    const s = m.flight.state;
    // Hovering just over the ground, still in the flight's frame: the ground slides by at its
    // turning speed (well under the safe speed), so it's a landing.
    const a = 0.7, r = hither.surfaceUnder(a, 800) + 0.01;
    Object.assign(s, { x: r * Math.cos(a), y: r * Math.sin(a), vx: 0, vy: 0, angle: a });
    for (let i = 0; i < 60 && !s.landed; i++) m.flight.step(1 / 60, 1);
    expect(s.landed).toBe(true);
    expect(s.crashed).toBe(false);
    expect(Math.abs(wrap(s.landAngle - (a - hither.spinAt(s.t))))).toBeLessThan(0.01);
  });
});

describe('Yonder\'s heart, turning with Yonder (#62 stage 3)', () => {
  it('only turns about the middle of the side the cameras see, so all of it always faces them', () => {
    const H = YONDER_HEART;
    let low = 1;
    for (let u = -0.7; u <= 0.7; u += 0.05) for (let v = -0.1; v <= 1.1; v += 0.05) if (heartDist(u, v) < 0) low = Math.min(low, heartDir(u, v).z);
    // Turning about z keeps every point's z: the lowest point of the heart stays well up that side.
    expect(low).toBeGreaterThan(0.25);
    expect(H.c.z).toBeGreaterThan(0.7);
    // Upright on the map at the start (it turns round once every 25 minutes of game time).
    expect(Math.abs(yonder.spinAt(0))).toBe(0);
    expect(H.up.y).toBeGreaterThan(0.9);
  });

  // The real FlightScene.heartInView() / pairInView() with the real map camera (as in yonder.test.js).
  function mapScene(t, visuals = ['yonder', 'hither']) {
    globalThis.window ??= {};
    Object.assign(globalThis.window, { innerWidth: 844, innerHeight: 390 });
    const m = parkAt(mission(), 'yonder', t, 1);
    const s = Object.create(FlightScene.prototype);
    s.app = { progress: { settings: {}, has: () => true, explained: () => true, markExplained() {}, earn() {} }, pip: () => true, afterPip() {}, audio: { play() {}, setMood() {} }, hud: { showTarget() {} } };
    Object.assign(s, {
      flight: m.flight, autopilot: m.ap, system: m.sys, time: 0, crashed: false, target: null, mode: 'flight', pause: null, clock: null,
      input: { left: false, right: false, go: false, fine: false }, warpIndex: 0, manualWarp: false,
      snapshots: [], snapTimer: 0, predTimer: 0, prediction: null, origin: { x: 0, y: 0 }, tmp: {}, tmp2: {}, tmp3: {}, kindAt: {},
      mapAt: { x: 0, y: 0 }, mapOff: { x: 0, y: 0 }, mapGoalAt: { x: 0, y: 0 }, mapDist: 2000, zoom: 1, carry: 1, camSettle: false, soiGlow: null,
      camera: new THREE.PerspectiveCamera(50, 844 / 390, 1, 3e6), camUp: new THREE.Vector3(0, 1, 0), rocket: { height: 6 },
      drive: { active: false, cancel() {} }, showing: null,
    });
    s.visuals = visuals.map((id) => ({ body: m.sys.byId[id], group: new THREE.Group() }));
    s.look = (fn) => {
      const rw = s.flight.worldPos({});
      s.placeOrigin(rw);
      s.updateCamera(0);
      s.camera.updateMatrixWorld();
      for (const v of s.visuals) {
        const w = v.body.worldPos(s.flight.state.t, {});
        v.group.position.set(w.x - s.origin.x, w.y - s.origin.y, 0);
        v.group.scale.setScalar(s.mapScale(v.body));
      }
      return fn();
    };
    return s;
  }

  it('is still found from the map zoomed in on Yonder, whenever we look', () => {
    for (const t of [600, 900, 1300, 1700, 2400]) {
      const s = mapScene(t, ['yonder']);
      s.toggleMap();
      s.focusMapOn(yonder);
      s.mapDist = 1500;
      expect(s.look(() => s.heartInView()), `t ${t}`).toBe(true);
    }
  });

  it('seen from the far side of where the heart has turned to, it faces away', () => {
    for (const t of [600, 1300]) {
      const s = mapScene(t, ['yonder']);
      const far = parkAt(mission(), 'yonder', t, Math.atan2(YONDER_HEART.c.y, YONDER_HEART.c.x) + yonder.spinAt(t) + Math.PI);
      s.flight = far.flight;
      s.zoom = 3;
      expect(s.look(() => s.heartInView()), `t ${t}`).toBe(false);
    }
  });

  describe('the double world (#62 stage 3)', () => {
    it('is a discovery with a sticker and the dancers\' fact, found by seeing both together', () => {
      const d = DISCOVERIES.find((x) => x.id === 'find-dancers');
      expect(d.world).toBe('hither');
      expect(d.find).toBe('pair');
      const st = STICKERS['find-dancers'];
      expect(st.say).toContain('Charon');
      expect(st.say).toContain('dancers holding hands');
      expect(st.hint).toBeTruthy();
    });

    it('needs both on screen, clear of the buttons, big enough, and apart', () => {
      const a = { x: 0, y: 0, behind: false, px: 12 }, b = { x: 0.4, y: 0.2, behind: false, px: 6 };
      expect(pairSeen(a, b, 150)).toBe(true);
      expect(pairSeen(a, { ...b, px: PAIR_VIEW.px - 1 }, 150)).toBe(false); // too small to see
      expect(pairSeen(a, b, 20)).toBe(false); // one blob
      expect(pairSeen(a, { ...b, behind: true }, 150)).toBe(false);
      expect(pairSeen(a, { ...b, x: 0.95 }, 150)).toBe(false); // under the buttons at the edge
      expect(pairSeen({ ...a, y: -0.8 }, b, 150)).toBe(false);
    });

    it('is seen on the map of Yonder, but not on the map of the whole system', () => {
      let seen = 0;
      for (const t of [600, 1000, 1400, 1800]) {
        const s = mapScene(t);
        s.toggleMap();
        s.focusMapOn(yonder);
        if (s.look(() => s.pairInView())) seen++;
        s.mapDist = 250000; // zoomed right out: two dots on top of each other
        expect(s.look(() => s.pairInView()), `t ${t}`).toBe(false);
      }
      expect(seen).toBeGreaterThanOrEqual(3); // (unless Hither is right under the top buttons)
    });
  });
});

describe('Hither, the world (#62 stage 3)', () => {
  it('is solid, dry, airless, gentle and landable all round the flight plane', () => {
    expect(hither.solid).toBe(true);
    expect(hither.liquid).toBe(null);
    expect(hither.atmosphere).toBeUndefined();
    expect(airOf(hither)).toBe(null);
    expect(hither.maxSurface - hither.radius).toBeLessThan(5);
    expect(hither.radius - hither.minSurface).toBeLessThan(4);
    for (let i = 0; i < 360; i++) expect(hither.landableAt((i / 360) * Math.PI * 2)).toBe(true);
  });

  it('keeps the ground by the flight plane gentle: the chasms, craters and Kubrick keep clear of it', () => {
    const R = hither.radius, e = 1 / R;
    let worst = 0;
    for (let i = 0; i < 720; i++) {
      const a = (i / 720) * Math.PI * 2;
      for (let zm = -11; zm <= 11; zm += 2.75) {
        const z = zm / R, k = Math.sqrt(1 - z * z);
        const at = (da, dz) => { const zz = z + dz, kk = Math.sqrt(1 - zz * zz); return ter.height(kk * Math.cos(a + da / k), kk * Math.sin(a + da / k), zz); };
        const sa = (at(e, 0) - at(-e, 0)) / 2, sz = (at(0, e) - at(0, -e)) / 2;
        worst = Math.max(worst, Math.atan(Math.hypot(sa, sz)) * 180 / Math.PI);
        expect(ter.canyon(k * Math.cos(a), k * Math.sin(a), z)).toBe(0);
      }
    }
    expect(worst).toBeLessThan(25);
  });

  it('looks like Charon: a dark red cap on the seen side, grey ice, craters, a mountain on the plains', () => {
    // The cap faces the cameras (off-centre), dark and reddish; the rest grey.
    expect(HITHER_CAP.z).toBeGreaterThan(0.8);
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const cap = ter.color(HITHER_CAP.x, HITHER_CAP.y, HITHER_CAP.z, ter.height(HITHER_CAP.x, HITHER_CAP.y, HITHER_CAP.z));
    expect(cap[0]).toBeGreaterThan(cap[2] * 1.5);
    let grey = 0, n = 0;
    for (let i = 0; i < 3000; i++) {
      const z = ((i * 0.618034) % 1) * 2 - 1, a = i * 2.39996, k = Math.sqrt(1 - z * z);
      const x = k * Math.cos(a), y = k * Math.sin(a);
      if (ter.cap(x, y, z) > 0.01 || ter.canyon(x, y, z) > 0.01) continue;
      const c = ter.color(x, y, z, ter.height(x, y, z));
      n++;
      if (Math.max(...c) - Math.min(...c) < 0.1) grey++;
    }
    expect(grey / n).toBeGreaterThan(0.9);
    expect(lum(cap)).toBeLessThan(0.5 * lum(ter.color(0, 0, -1, ter.height(0, 0, -1))));
    expect(Math.abs(HITHER_BELT.z)).toBeLessThan(0.3); // the north / plains line crosses the view
    // Kubrick Mons: on the plains, well off the plane.
    expect(Math.asin(HITHER_MOUNT.z) * hither.radius).toBeGreaterThan(30);
    expect(ter.plains(HITHER_MOUNT.x, HITHER_MOUNT.y, HITHER_MOUNT.z)).toBeGreaterThan(0.9);
  });

  // Hither's own frame at a projected point (x, y) on the seen side.
  const seen = (x, y) => vec.norm([x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))]);
  // A point `m` metres from `d` towards `t` (a unit tangent there).
  const walk = (d, t, m) => vec.norm(vec.add(d, vec.mul(t, Math.tan(m / hither.radius))));
  const slopeAt = (d) => {
    const e = 0.5 / hither.radius, t1 = vec.norm(vec.cross(d, [0, 0, 1])), t2 = vec.cross(d, t1);
    const h = (p) => ter.height(...p);
    const sa = (h(walk(d, t1, 0.5)) - h(walk(d, t1, -0.5))), sb = (h(walk(d, t2, 0.5)) - h(walk(d, t2, -0.5)));
    return Math.atan(Math.hypot(sa, sb) / (2 * e * hither.radius)) * 180 / Math.PI;
  };

  it('has one or two chasms, each a trunk that branches like a river, all on the side the cameras see', () => {
    expect(HITHER_CHASMS.length).toBeGreaterThanOrEqual(1);
    expect(HITHER_CHASMS.length).toBeLessThanOrEqual(2);
    let branches = 0;
    for (const ch of HITHER_CHASMS) {
      const [trunk, ...rest] = ch.paths;
      expect(rest.length, ch.name).toBeGreaterThanOrEqual(1);
      branches += rest.length;
      for (const b of rest) {
        // Each branch leaves the trunk, narrower and shallower, and tapers to nothing at its tip.
        const [x, y, w, deep] = b[0];
        const on = trunk.find((p) => p[0] === x && p[1] === y);
        expect(on, `${ch.name} branch at ${x}, ${y}`).toBeTruthy();
        expect(w).toBeLessThan(on[2]);
        expect(deep).toBeLessThan(on[3]);
        expect(b[b.length - 1][3]).toBe(0);
        for (let i = 1; i < b.length; i++) expect(b[i][3]).toBeLessThanOrEqual(b[i - 1][3]);
      }
      // All of it on the seen side, off the flight plane, and a real chasm along its trunk.
      for (const p of ch.paths.flat()) expect(seen(p[0], p[1])[2], ch.name).toBeGreaterThan(0.2);
      let deep = 0;
      for (const p of trunk) if (ter.canyon(...seen(p[0], p[1])) > 0.7) deep++;
      expect(deep, ch.name).toBeGreaterThanOrEqual(3);
    }
    // The big one branches most, like a river's tributaries, and its mouth opens onto the plane.
    expect(branches).toBeGreaterThanOrEqual(4);
    expect(HITHER_CHASMS[0].paths.length - 1).toBeGreaterThanOrEqual(3);
    expect(HITHER_CHASMS[0].paths[0][0][3]).toBe(0);
    // Not everywhere, though (Hither isn't Mars): most of the ground is no chasm at all.
    let inChasm = 0;
    for (let i = 0; i < 4000; i++) {
      const z = ((i * 0.618034) % 1) * 2 - 1, a = i * 2.39996, k = Math.sqrt(1 - z * z);
      if (ter.canyon(k * Math.cos(a), k * Math.sin(a), z) > 0.05) inChasm++;
    }
    expect(inChasm / 4000).toBeLessThan(0.06);
  });

  it('the chasms have flat floors, steep cliffs and dark floors that read from space', () => {
    // Across the big trunk half-way along.
    const trunk = HITHER_CHASMS[0].paths[0];
    const [a, b] = [trunk[4], trunk[5]];
    const mid = seen((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    const along = vec.norm(vec.sub(seen(b[0], b[1]), seen(a[0], a[1])));
    const across = vec.norm(vec.cross(mid, along));
    const profile = [];
    for (let m = -16; m <= 16; m += 0.5) profile.push(ter.height(...walk(mid, across, m)));
    const floor = profile.slice(24, 41); // the middle 8 m
    expect(Math.max(...floor) - Math.min(...floor)).toBeLessThan(1);
    expect(Math.max(...profile) - Math.min(...floor)).toBeGreaterThan(6);
    let steep = 0;
    for (let i = 1; i < profile.length; i++) steep = Math.max(steep, Math.atan(Math.abs(profile[i] - profile[i - 1]) / 0.5) * 180 / Math.PI);
    expect(steep).toBeGreaterThan(55);
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const at = (p) => lum(ter.color(...p, ter.height(...p)));
    expect(at(mid)).toBeLessThan(0.75 * at(walk(mid, across, 16)));
  });

  it('Kubrick Mons is a broad massif, not a spike, standing in a wide, gentle moat', () => {
    const M = [HITHER_MOUNT.x, HITHER_MOUNT.y, HITHER_MOUNT.z];
    const east = vec.norm([-M[1], M[0], 0]), north = vec.cross(M, east);
    const ring = (m, fn) => {
      for (let i = 0; i < 36; i++) {
        const t = vec.add(vec.mul(east, Math.cos(i * Math.PI / 18)), vec.mul(north, Math.sin(i * Math.PI / 18)));
        fn(walk(M, t, m));
      }
    };
    expect(ter.height(...M)).toBeGreaterThan(10);
    // Broad: still well up 12 m out all round, and foothills to 20 m.
    ring(12, (p) => expect(ter.mount(...p)).toBeGreaterThan(3));
    ring(20, (p) => expect(ter.mount(...p)).toBeGreaterThan(0.5));
    // Several summits and shoulders, not one cone: blocks of different heights.
    expect(KUBRICK.blocks.length).toBeGreaterThanOrEqual(4);
    expect(new Set(KUBRICK.blocks.map((b) => b.h)).size).toBeGreaterThanOrEqual(4);
    // The moat: all the way round, lower than the plains beyond it, wide and gentle.
    const [mid, half] = KUBRICK.moat;
    ring(mid, (p) => expect(ter.mount(...p)).toBeLessThan(-1.5));
    expect(half).toBeGreaterThanOrEqual(8);
    let worst = 0;
    for (let m = mid - half * 0.7; m <= mid + half; m += 2) ring(m, (p) => { worst = Math.max(worst, slopeAt(p)); });
    expect(worst).toBeLessThan(32);
    // Well off the flight plane.
    expect((Math.asin(HITHER_MOUNT.z) * hither.radius) - (mid + half)).toBeGreaterThan(12);
  });

  it('has crisp craters: deep bowls with sharp rims, on the side the cameras see too', () => {
    expect(ter.pits.length).toBeGreaterThanOrEqual(20);
    expect(ter.pits.filter((p) => p.z > 0.2).length).toBeGreaterThanOrEqual(8);
    expect(ter.pits.some((p) => p.fresh && p.z > 0.2)).toBe(true);
    for (const p of ter.pits) {
      const c = [p.x, p.y, p.z], t = vec.norm(vec.cross(c, [0.3, 0.5, 0.8]));
      const r = p.radius * hither.radius;
      const rim = ter.height(...walk(c, t, r)), floor = ter.height(...c);
      expect(rim - floor, `crater of ${r.toFixed(1)} m`).toBeGreaterThan(0.3 * r);
    }
  });

  it('has its stickers (not goals), a Charon fact, its own icons, a spin axis and the richer look', () => {
    expect(STICKERS['visit-hither'].say).toContain('Charon');
    expect(STICKERS['land-hither']).toBeTruthy();
    expect(hither.blurb).toContain('Charon');
    expect(GOALS.some((g) => g.id.endsWith('-hither'))).toBe(false);
    const icons = Object.values(STICKERS).map((s) => s.icon);
    for (const id of ['visit-hither', 'land-hither', 'find-dancers']) expect(icons.filter((x) => x === STICKERS[id].icon).length, id).toBe(1);
    expect(ROCKY_LOOK.hither).toBeTruthy();
    expect(SPIN_AXES.hither).toBeTruthy();
  });

  it('the autopilot lands on it from all round a parking orbit, at any turn', () => {
    for (let k = 0; k < 6; k++) {
      const m = parkAt(mission(), 'hither', 300 + k * 290, (k / 6) * Math.PI * 2);
      expect(m.run('land')).toBe(true);
      expect(m.flight.state.landed, `from ${k}`).toBe(true);
      expect(m.flight.state.crashed).toBe(false);
    }
  });

  it('a buggy drives from the flight plane down the big chasm\'s gentle mouth, all along it and out the far end', () => {
    for (const kind of ['rover', 'truck', 'hopper']) {
      const b = new Buggy(hither, BUGGIES[kind]);
      // From the flight plane just below the chasm's mouth, heading up the seen side, straight on.
      const [mx, my] = HITHER_CHASMS[0].paths[0][0];
      b.spawn(vec.norm([mx, my, 0]), [0, 0, 1]);
      let travelled = 0, last = b.up, air = 0, maxAir = 0, inChasm = 0, floor = -1, out = false, high = 0;
      for (let i = 0; i < 60 * 40; i++) {
        b.step(1 / 60, { throttle: 1, steer: 0 });
        travelled += Math.acos(Math.min(1, vec.dot(b.up, last))) * hither.radius;
        last = b.up;
        const k = ter.canyon(...b.up);
        if (k > 0.5) inChasm++;
        if (k > 0.9 && floor < 0) {
          floor = i / 60;
          // Down the ramp onto the floor with the wheels on the ground (no drop over a cliff).
          expect(maxAir / 60, kind).toBeLessThan(1.5);
        }
        if (floor > 0 && k < 0.02) out = true;
        air = b.grounded === false ? air + 1 : 0;
        maxAir = Math.max(maxAir, air);
        high = Math.max(high, vec.len(b.p) - hither.radius - ter.height(...b.up));
      }
      expect(floor, kind).toBeGreaterThan(0);
      expect(floor, kind).toBeLessThan(15);
      expect(inChasm / 60, kind).toBeGreaterThan(10);
      expect(out, kind).toBe(true);
      expect(travelled, kind).toBeGreaterThan(150);
      // Driving straight on where the chasm bends, it can climb a cliff and leap off the top
      // (low gravity: a long hop), but it always comes back down, never far up.
      expect(maxAir / 60, kind).toBeLessThan(10);
      expect(high, kind).toBeLessThan(20);
    }
  });

  it('driving on a turning world: the buggy is drawn where its ground is now', () => {
    const d = Object.create(DriveMode.prototype);
    const s = { body: hither, landAngle: 1, t: 700 };
    d.fs = { flight: { state: s }, rocket: { parts: [], group: { traverse() {} } }, design: { stack: [] } };
    d.buggy = new Buggy(hither, BUGGIES.rover);
    d.buggy.spawn([Math.cos(1.2), Math.sin(1.2), 0.3], [0, 0, 1]);
    d.active = true;
    d.phase = 'drive';
    d.effects = () => {};
    d.dustPool = { step() {} };
    d.garage = { update: () => false };
    d.update(1 / 60, {});
    const w = hither.worldPos(s.t), a = hither.spinAt(s.t), p = d.buggy.p;
    expect(d.world.x).toBeCloseTo(w.x + Math.cos(a) * p[0] - Math.sin(a) * p[1], 6);
    expect(d.world.y).toBeCloseTo(w.y + Math.sin(a) * p[0] + Math.cos(a) * p[1], 6);
    expect(d.world.z).toBeCloseTo(p[2], 9);
    const t = d.toFlight([1, 0, 0.5]);
    expect(t[0]).toBeCloseTo(Math.cos(a), 9);
    expect(t[1]).toBeCloseTo(Math.sin(a), 9);
    expect(t[2]).toBe(0.5);
  });
});

describe('🤖 Take me there to Hither and back (#62 stage 3)', () => {
  it('the autopilot hops between Yonder and Hither, and flies there from home and back', () => {
    for (const [from, to, t] of [['yonder', 'hither', 1000], ['hither', 'yonder', 5000], ['homestead', 'hither', 5000], ['hither', 'homestead', 9133]]) {
      const r = gotoTrip(from, to, t, false);
      expect(r.kind, `${from} to ${to}: ${r.detail}`).toBe('ok');
      expect(r.strays, `${from} to ${to}`).toBe(0);
    }
  }, 60000);

  it('coached, the pretend kid hops between them, and flies there from home', () => {
    for (const [from, to, t] of [['yonder', 'hither', 5000], ['hither', 'yonder', 1000], ['homestead', 'hither', 9133]]) {
      const r = gotoTrip(from, to, t, true);
      expect(r.kind, `${from} to ${to}: ${r.detail}`).toBe('ok');
    }
  }, 60000);
});

describe('Ember from far away, at Hither too (#62 stage 3)', () => {
  it('Hither is always all the way into the far light, like Yonder', () => {
    for (let t = 0; t < yonder.orbitalPeriod; t += 500) {
      const p = hither.worldPos(t);
      const d = Math.hypot(p.x, p.y);
      expect(farLight(d - hither.soi).k).toBe(1);
      expect(farLight(d + hither.soi).sun).toBeGreaterThan(0.3);
    }
    expect(ember).toBeTruthy();
  });
});
