// The frontier (#62 stage 4): the icy-rock belt round Yonder's distance, every rock tumbling, and
// the little lander on one of its big rocks. The belt's place and density, never inside a world or
// in front of the flight plane, its instances and draw calls, hidden from the start view; each
// rock's tumble (from the game clock, in the shader, normals and ink too); the lander riding its
// rock, near Yonder's path, and finding it by seeing it up close.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as THREE from 'three';
import { createSystem } from '../src/physics/bodies.js';
import { BELT, BIG_ROCKS, BIG_REACH, LANDER_ROCK, beltPlan, sectorOf, sectorMiddle, beltTurn, beltClear, tumbleAngle, spinClock, landerRockAt } from '../src/physics/frontier.js';
import { DISCOVERIES, LANDER_VIEW, landerSeen, buggyFinds, landingFinds, discoveryTargets } from '../src/physics/discoveries.js';
import { STICKERS } from '../src/progress.js';
import { SYSTEM_VIEW } from '../src/ui/zoom.js';
import { FlightScene } from '../src/scenes/flight.js';
import { createBelt, createFrontier, beltShown, dotsShown, beltGrow, BELT_LOOK } from '../src/world/frontier.js';
import { mission } from './missions.js';

globalThis.document ??= { getElementById: () => null };

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
    // The tumble clock: the time since the last whole spinT.
    expect(fr.belt.uniforms.fcTime.value).toBeCloseTo(spinClock(t), 9);
    ctx.mode = 'drive';
    fr.update(ctx);
    expect(fr.belt.group.visible).toBe(false);
    expect(fr.belt.dots.visible).toBe(false);
    expect(fr.lander.group.visible).toBe(false);
    // The update itself makes no objects: the same ones before and after.
    const before = [fr.belt.uniforms.fcAt.value, fr.lander.group.position, fr.lander.group.quaternion, fr.lander.up];
    ctx.mode = 'flight';
    ctx.t += 3;
    fr.update(ctx);
    const after = [fr.belt.uniforms.fcAt.value, fr.lander.group.position, fr.lander.group.quaternion, fr.lander.up];
    after.forEach((o, i) => expect(o).toBe(before[i]));
  });
});

describe('every rock tumbles (#62 stage 4)', () => {
  it('each about its own axis, a whole number of turns every spinT, the small ones faster', () => {
    for (const r of [...rocks, ...BIG_ROCKS]) {
      expect(Math.hypot(...r.axis)).toBeCloseTo(1, 9);
      expect(Number.isInteger(r.spin)).toBe(true);
      expect(r.spin).toBeGreaterThan(0);
    }
    // Small rocks: a few seconds to a minute and a half a turn.
    for (const r of rocks) {
      const period = BELT.spinT / r.spin;
      expect(period).toBeGreaterThanOrEqual(6);
      expect(period).toBeLessThanOrEqual(90);
    }
    // Big ones: a couple of minutes to five.
    for (const b of BIG_ROCKS) {
      expect(BELT.spinT / b.spin).toBeGreaterThanOrEqual(100);
      expect(BELT.spinT / b.spin).toBeLessThanOrEqual(300);
    }
    const bySize = [...rocks].sort((x, y) => x.size - y.size);
    const tenth = Math.floor(rocks.length / 10);
    const mean = (l) => l.reduce((v, r) => v + BELT.spinT / r.spin, 0) / l.length;
    expect(mean(bySize.slice(0, tenth))).toBeLessThan(mean(bySize.slice(-tenth)) / 2);
    // Every which way: about as many axes near the plane's normal as random axes give (10%).
    const up = rocks.filter((r) => Math.abs(r.axis[2]) > 0.9).length / rocks.length;
    expect(up).toBeGreaterThan(0.05);
    expect(up).toBeLessThan(0.15);
  });

  it('from the game clock: the same time, the same turn (saves, rewind, warp), and no jump as the clock wraps', () => {
    expect(tumbleAngle(20, 0.5, 1234.5)).toBe(tumbleAngle(20, 0.5, 1234.5));
    const turns = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
    for (const spin of [1, 20, 240]) {
      const w = (2 * Math.PI * spin) / BELT.spinT; // radians a second
      for (const T of [BELT.spinT, 7 * BELT.spinT, 1e6 * BELT.spinT]) {
        expect(turns(tumbleAngle(spin, 1, T + 0.01), tumbleAngle(spin, 1, T - 0.01))).toBeCloseTo(0.02 * w, 6);
      }
    }
    // The shader's clock keeps its precision: never more than spinT, however long the game runs.
    expect(spinClock(1e9 + 12.25)).toBeLessThan(BELT.spinT);
    expect(spinClock(3 * BELT.spinT + 12.25)).toBeCloseTo(12.25, 9);
  });

  it('in the vertex shader, from per-instance attributes the rock and its ink share; its normals turn too', () => {
    const belt = createBelt();
    for (const m of [...belt.arcs, ...belt.big]) {
      const ink = m.children[0];
      for (const name of ['fcAxis', 'fcSpin']) {
        const attr = m.geometry.attributes[name];
        expect(attr.isInstancedBufferAttribute, name).toBe(true);
        expect(attr.count).toBe(m.count);
        expect(ink.geometry.attributes[name]).toBe(attr); // the ink tumbles with its rock
      }
    }
    // Each arc has its own tumbles (the shape's vertices are shared).
    expect(belt.arcs[0].geometry.attributes.fcSpin).not.toBe(belt.arcs[1].geometry.attributes.fcSpin);
    expect(belt.arcs[0].geometry.attributes.position).toBe(belt.arcs[1].geometry.attributes.position);
    // The rate and phase are the plan's.
    const r = rocks.find((x) => x.sector === 0);
    const sp = belt.arcs[0].geometry.attributes.fcSpin;
    expect(sp.getX(0)).toBeCloseTo((2 * Math.PI * r.spin) / BELT.spinT, 6);
    expect(sp.getY(0)).toBeCloseTo(r.phase, 5);
    // The shaders: the tumble goes into the position (after the instance's shape, round its
    // middle), and for the rock into its normal too (so the lit side stays towards Ember).
    const rockShader = { uniforms: {}, vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: '' };
    belt.arcs[0].material.onBeforeCompile(rockShader);
    const inkShader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: '' };
    belt.arcs[0].children[0].material.onBeforeCompile(inkShader);
    for (const sh of [rockShader, inkShader]) {
      expect(sh.vertexShader).not.toContain('#include <project_vertex>');
      expect(sh.vertexShader).toContain('fcC + fcTurn((instanceMatrix * vec4(transformed, 1.0)).xyz - fcC)');
      expect(sh.uniforms.fcTime).toBe(belt.uniforms.fcTime);
    }
    expect(rockShader.vertexShader).not.toContain('#include <defaultnormal_vertex>');
    expect(rockShader.vertexShader).toContain('normalMatrix * fcTurn(fcIm * transformedNormal)');
    expect(inkShader.vertexShader).toContain('transformed += normalize(normal)');
  });

  it('turns shapes and normals as a true rotation (the shader\'s sum against three\'s quaternion)', () => {
    const axis = new THREE.Vector3(0.3, -0.5, 0.81).normalize(), a = 2.2;
    const turn = (v) => {
      const c = Math.cos(a), s = Math.sin(a);
      return v.clone().multiplyScalar(c).add(axis.clone().cross(v).multiplyScalar(s)).add(axis.clone().multiplyScalar(axis.dot(v) * (1 - c)));
    };
    const q = new THREE.Quaternion().setFromAxisAngle(axis, a);
    for (const v of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.2, 0.7, -0.4)]) {
      expect(turn(v).distanceTo(v.clone().applyQuaternion(q))).toBeLessThan(1e-12);
    }
  });
});

describe('the lander on a belt rock (#62 stage 4)', () => {
  it('rests on a big rock in the belt, all of it always behind the flight plane', () => {
    expect(BIG_ROCKS.filter((b) => b.lander)).toEqual([LANDER_ROCK]);
    expect(LANDER_ROCK.r > BELT.inner && LANDER_ROCK.r < BELT.outer).toBe(true);
    expect(LANDER_ROCK.z + (LANDER_ROCK.size * BIG_REACH[LANDER_ROCK.kind]) / 2 + BELT_LOOK.lander).toBeLessThan(0);
    // Big enough on its rock to see: a seventh of its width or more.
    expect(BELT_LOOK.lander / LANDER_ROCK.size).toBeGreaterThan(1 / 7);
  });

  it('is near Yonder\'s path: once a Yonder year Yonder comes within a few km (never close enough to shrink it)', () => {
    let best = Infinity, near = 0;
    const dt = 20;
    for (let t = 0; t < yonder.orbitalPeriod; t += dt) {
      const r = landerRockAt(sys, t, {}), y = yonder.worldPos(t, {});
      const d = Math.hypot(r.x - y.x, r.y - y.y);
      best = Math.min(best, d);
      if (d < 10000) near += dt;
    }
    expect(best).toBeGreaterThan(BELT.clear[1]);
    expect(best).toBeLessThan(6000);
    // It lingers there (the far end of Yonder's loop against the turning belt): half an hour or more within 10 km.
    expect(near).toBeGreaterThan(1800);
  });

  it('rides its tumbling rock: the same spot on its ground, turning with it, from the game clock', () => {
    const fr = createFrontier(sys);
    const cam = new THREE.PerspectiveCamera(50, 844 / 390, 1, 3e6);
    const Z = new THREE.Vector3(0, 0, 1);
    const ups = [];
    for (const t of [4000, 4007, 4030, 4100]) {
      const r = landerRockAt(sys, t, {});
      const origin = { x: r.x + 50, y: r.y - 50 };
      fr.update({ t, time: t, origin, camera: cam, mode: 'flight', camWorld: { ...origin }, camHeight: 200, yonder: null, viewH: 390 });
      expect(fr.lander.group.visible).toBe(true);
      const rock = fr.rock.position;
      expect(rock.x).toBeCloseTo(r.x - origin.x, 6);
      expect(rock.y).toBeCloseTo(r.y - origin.y, 6);
      // Where it stands: the rock's turn (the belt's, then its tumble) applied to its spot.
      const tumble = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...LANDER_ROCK.axis), tumbleAngle(LANDER_ROCK.spin, LANDER_ROCK.phase, t));
      const q = new THREE.Quaternion().setFromAxisAngle(Z, beltTurn(sys, t)).multiply(tumble);
      const at = fr.spot.at.clone().applyQuaternion(q).add(rock);
      expect(fr.lander.group.position.distanceTo(at)).toBeLessThan(1e-6);
      // On the ground: its feet on the rock's surface, and upright on it.
      expect(fr.spot.at.length()).toBeGreaterThan(LANDER_ROCK.size * 0.3);
      expect(fr.spot.at.length()).toBeLessThan(LANDER_ROCK.size * 0.62);
      expect(fr.lander.up.dot(fr.spot.up.clone().applyQuaternion(q))).toBeCloseTo(1, 9);
      ups.push(fr.lander.up.clone());
    }
    // It really turns.
    expect(ups[0].angleTo(ups[1])).toBeGreaterThan(0.05);
  });

  it('is a discovery with a sticker, a lander fact and a hint, found only by seeing it', () => {
    const d = DISCOVERIES.find((x) => x.id === 'find-lander');
    expect(d.world).toBe('yonder');
    expect(d.find).toBe('lander');
    const st = STICKERS['find-lander'];
    expect(st.say).toContain('MASCOT');
    expect(st.say).toContain('hopping');
    expect(st.hint).toContain('Yonder');
    expect(STICKERS['find-probe']).toBeUndefined();
    expect(DISCOVERIES.some((x) => x.id === 'find-probe')).toBe(false);
    // Not on the ground: the buggy, landing and the ✨ compass never find it.
    const ctx = { time: 0, toSun: { x: 1, y: 0, z: 0 }, has: (id) => id !== 'find-lander' };
    expect(discoveryTargets(yonder, ctx).map((x) => x.id)).not.toContain('find-lander');
    expect(landingFinds(yonder, 0.3, ctx)).toBe(null);
    expect(buggyFinds(yonder, { p: [yonder.radius, 0, 0], speed: 0, grounded: true }, ctx)).toBe(null);
  });

  it('needs it on screen, clear of the buttons, facing us, and big enough to make out', () => {
    const v = { x: 0.1, y: 0.1, behind: false, facing: 0.7, px: 8 };
    expect(landerSeen(v)).toBe(true);
    expect(landerSeen({ ...v, px: LANDER_VIEW.px - 0.5 })).toBe(false); // far off
    expect(landerSeen({ ...v, facing: -0.3 })).toBe(false); // round the back of its rock
    expect(landerSeen({ ...v, behind: true })).toBe(false);
    expect(landerSeen({ ...v, x: 0.95 })).toBe(false); // under the buttons
    expect(landerSeen({ ...v, y: -0.8 })).toBe(false);
  });

  const shared = createFrontier(sys);
  // A flight scene with the frontier and just what landerInView() needs (like test/hither.test.js):
  // the rocket drifting in Ember's space `off` from the lander's rock at time t.
  function scene(t, off, zoom = 1) {
    globalThis.window ??= {};
    Object.assign(globalThis.window, { innerWidth: 844, innerHeight: 390 });
    const m = mission();
    const r = landerRockAt(sys, t, {});
    m.flight.state = { body: sys.byId.ember, x: r.x + off[0], y: r.y + off[1], vx: 0, vy: 0, angle: 0, t, landed: false, landAngle: 0, crashed: false, flightTime: 5 };
    const s = Object.create(FlightScene.prototype);
    Object.assign(s, {
      flight: m.flight, system: m.sys, time: 0, crashed: false, mode: 'flight', origin: { x: 0, y: 0 }, tmp: {}, tmp2: {}, tmp3: {},
      zoom, carry: 1, camSettle: false, camera: new THREE.PerspectiveCamera(50, 844 / 390, 1, 3e6), camUp: new THREE.Vector3(0, 1, 0),
      rocket: { height: 6 }, drive: { active: false }, visuals: [], frontier: shared,
    });
    s.look = () => {
      s.placeOrigin(s.flight.worldPos({}));
      s.updateCamera(0);
      s.updateFrontier();
      return s.landerInView();
    };
    return s;
  }
  // A game time when the lander faces the cameras (its up towards +z; sign -1: away from them).
  function facing(sign) {
    const fr = createFrontier(sys);
    const cam = new THREE.PerspectiveCamera(50, 1, 1, 3e6);
    for (let t = 4000; t < 5000; t += 1) {
      const r = landerRockAt(sys, t, {});
      fr.update({ t, time: 0, origin: { x: r.x, y: r.y }, camera: cam, mode: 'flight', camWorld: { x: r.x, y: r.y }, camHeight: 100, yonder: null, viewH: 390 });
      if (fr.lander.up.z * sign > 0.6) return t;
    }
    return null;
  }

  it('is found flying up close with it facing us, and not from far off, round the back, or driving', () => {
    const t = facing(1), back = facing(-1);
    expect(t).not.toBe(null);
    expect(back).not.toBe(null);
    expect(scene(t, [40, -40]).look()).toBe(true);
    expect(scene(t, [40, -40], 3).look()).toBe(true);
    expect(scene(t, [40, -40], 60).look()).toBe(false); // zoomed right out: a speck
    expect(scene(t, [3000, 0]).look()).toBe(false); // far off
    expect(scene(back, [40, -40]).look()).toBe(false); // round the back of its rock
    const d = scene(t, [40, -40]);
    d.drive = { active: true };
    expect(d.landerInView()).toBe(false);
    const c = scene(t, [40, -40]);
    c.look();
    c.crashed = true;
    expect(c.landerInView()).toBe(false);
  });
});

