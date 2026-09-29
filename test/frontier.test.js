// The frontier (#62 stage 4): a sparse, broad, thick belt of icy rocks round Yonder's distance,
// every rock tumbling, the little lander on one of its big rocks, and the few crossers. The belt's
// spread and depth, the clear slab round the flight plane (no vanishing bubble), never inside a
// world, its instances and draw calls, hidden from the start view, rocks by the camera fading;
// each rock's tumble (from the game clock, in the shader, normals and ink too); the lander riding
// its rock near Yonder's path and found by seeing it up close; the crossers' orbits (pure), the
// nudge they give a rocket (small, once, never a crash, replayed the same) and their puffs on
// Yonder and Hither.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as THREE from 'three';
import { createSystem } from '../src/physics/bodies.js';
import {
  BELT, BELT_MID, ROCK_REACH, BIG_ROCKS, BIG_REACH, LANDER_ROCK, CROSS, beltPlan, sectorOf, sectorMiddle, beltTurn, tumbleAngle, spinClock,
  landerRockAt, crossers, crosserPos, passTime, crosserHit, crosserShown, crosserHitsBetween, crosserTouch, worldOf,
} from '../src/physics/frontier.js';
import { DISCOVERIES, LANDER_VIEW, landerSeen, buggyFinds, landingFinds, discoveryTargets } from '../src/physics/discoveries.js';
import { Flight } from '../src/physics/sim.js';
import { STICKERS } from '../src/progress.js';
import { SYSTEM_VIEW } from '../src/ui/zoom.js';
import { FlightScene } from '../src/scenes/flight.js';
import { createBelt, createFrontier, beltShown, dotsShown, beltGrow, nearFade, BELT_LOOK } from '../src/world/frontier.js';
import { mission } from './missions.js';

globalThis.document ??= { getElementById: () => null };

const sys = createSystem();
const { yonder, hither, homestead } = sys.byId;
const rocks = beltPlan();
const list = crossers(sys);

describe('the icy-rock belt (#62 stage 4)', () => {
  it('is sparse and broad: well inside and outside Yonder\'s orbit, kilometres apart, all the way round', () => {
    expect(rocks.length).toBe(BELT.count);
    expect(BELT.inner).toBeLessThan(yonder.periapsis - 10000);
    expect(BELT.outer).toBeGreaterThan(yonder.apoapsis + 10000);
    for (const r of rocks) {
      expect(r.r).toBeGreaterThanOrEqual(BELT.inner);
      expect(r.r).toBeLessThanOrEqual(BELT.outer);
      expect(Math.hypot(r.x, r.y)).toBeCloseTo(r.r, 6);
    }
    // Broad, not a ring: a good share inside Yonder's closest and outside its farthest.
    const inside = rocks.filter((r) => r.r < yonder.periapsis).length / rocks.length;
    const outside = rocks.filter((r) => r.r > yonder.apoapsis).length / rocks.length;
    expect(inside).toBeGreaterThan(0.03);
    expect(outside).toBeGreaterThan(0.08);
    // Sparse: kilometres apart in the plane (and more in 3D).
    const area = Math.PI * (BELT.outer ** 2 - BELT.inner ** 2);
    expect(Math.sqrt(area / rocks.length)).toBeGreaterThan(4000);
    const per = Array(BELT.sectors).fill(0);
    for (const r of rocks) per[r.sector]++;
    for (const n of per) expect(n).toBeGreaterThan((0.6 * BELT.count) / BELT.sectors);
    for (const b of BIG_ROCKS) expect(b.r > BELT.inner && b.r < BELT.outer).toBe(true);
  });

  it('is thick and tilted: rocks at many depths above and below the flight plane', () => {
    const above = rocks.filter((r) => r.z > 0).length / rocks.length;
    expect(above).toBeGreaterThan(0.4);
    expect(above).toBeLessThan(0.6);
    const depths = rocks.map((r) => Math.abs(r.z)).sort((a, b) => a - b);
    expect(depths[Math.floor(depths.length / 2)]).toBeGreaterThan(1500); // typically kilometres off the plane
    expect(depths[Math.floor(depths.length * 0.9)]).toBeGreaterThan(5000);
    expect(depths[depths.length - 1]).toBeLessThan(0.2 * BELT.outer); // a few degrees' tilt, not a ball
    expect(BIG_ROCKS.some((b) => b.z > 0) && BIG_ROCKS.some((b) => b.z < 0)).toBe(true);
  });

  it('keeps a clear slab round the flight plane (no rock but the crossers ever in it), wider than Yonder and Hither', () => {
    expect(BELT.slab).toBeGreaterThan(yonder.radius + hither.radius);
    for (const r of rocks) expect(Math.abs(r.z) - r.size * ROCK_REACH).toBeGreaterThanOrEqual(BELT.slab - 1e-6);
    for (const b of BIG_ROCKS) expect(Math.abs(b.z) - (b.size * BIG_REACH[b.kind]) / 2).toBeGreaterThan(BELT.slab);
    // So Yonder and Hither (in the plane, not reaching past the slab) never touch one; no bubble.
    for (const b of sys.bodies) {
      if (!b.parent || b === yonder || b === hither) continue;
      // Every other world never comes near the belt at all.
      let far = 0;
      for (let t = 0; t < 30000; t += 50) {
        const w = b.worldPos(t, {});
        far = Math.max(far, Math.hypot(w.x, w.y) + b.radius);
      }
      expect(far, b.id).toBeLessThan(BELT.inner - 5000);
    }
    const src = readFileSync(new URL('../src/physics/frontier.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/beltClear|clear: \[/);
  });

  it('keeps every rock near its arc\'s middle, so none is far from its mesh\'s origin', () => {
    const m = {};
    for (const r of rocks) {
      expect(sectorOf(r.a)).toBe(r.sector);
      sectorMiddle(r.sector, m);
      expect(Math.hypot(r.x - m.x, r.y - m.y, r.z)).toBeLessThan(55000); // float32 steps about 4 mm
    }
    expect(Math.hypot(sectorMiddle(0).x, sectorMiddle(0).y)).toBeCloseTo(BELT_MID, 6);
    expect(sectorOf(-0.001)).toBe(BELT.sectors - 1);
    expect(sectorOf(2 * Math.PI + 0.001)).toBe(0);
  });

  it('turns slowly as one, the way Yonder goes round, on the game clock', () => {
    expect(beltTurn(sys, 0)).toBeCloseTo(0, 12);
    expect(beltTurn(sys, 1000)).toBeCloseTo(yonder.angularSpeed * 1000, 12);
    expect(Math.sign(beltTurn(sys, 1000))).toBe(yonder.orbitDir);
    expect(Math.abs(beltTurn(sys, yonder.orbitalPeriod))).toBeCloseTo(2 * Math.PI, 6);
  });

  it('is only the look, but for the crossers in the sim: prediction, the helpers and the buggy never read it', () => {
    expect(sys.bodies.map((b) => b.id)).not.toContain('belt');
    for (const f of ['predict', 'autopilot', 'orbit', 'bodies', 'buggy']) {
      expect(readFileSync(new URL(`../src/physics/${f}.js`, import.meta.url), 'utf8'), f).not.toMatch(/frontier/);
    }
    const sim = readFileSync(new URL('../src/physics/sim.js', import.meta.url), 'utf8');
    expect(sim).toMatch(/import \{ crosserTouch, CROSS \} from '\.\/frontier\.js'/);
  });

  it('is few draw calls: an instanced mesh (and its ink) per arc, an instance per big one and crosser, one draw call of map dots', () => {
    const belt = createBelt(sys);
    expect(belt.arcs.length).toBe(BELT.sectors);
    let n = 0, tris = 0;
    for (const a of belt.arcs) {
      expect(a.isInstancedMesh).toBe(true);
      expect(a.children.length).toBe(1);
      expect(a.children[0].instanceMatrix).toBe(a.instanceMatrix);
      expect(a.count).toBeLessThan((2 * BELT.count) / BELT.sectors);
      n += a.count;
      tris += (a.geometry.attributes.position.count / 3) * a.count;
      expect(a.boundingSphere.radius).toBeLessThan(60000); // culled whole: an arc's bounds, not the ring's
    }
    expect(n).toBe(BELT.count);
    expect(tris / BELT.count).toBeLessThanOrEqual(20);
    expect(belt.big.length).toBe(BIG_ROCKS.length);
    expect(belt.cross.length).toBe(list.length);
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.length).toBeLessThanOrEqual(6);
    for (const b of [...belt.big, ...belt.cross]) expect(b.count).toBe(1);
    const mats = new Set(), inks = new Set();
    for (const m of [...belt.arcs, ...belt.big, ...belt.cross]) {
      mats.add(m.material);
      inks.add(m.children[0].material);
    }
    expect(mats.size).toBe(1);
    expect(inks.size).toBe(1);
    expect(belt.dots.isPoints).toBe(true);
    expect(belt.dots.geometry.attributes.position.count).toBe(BELT.count + BIG_ROCKS.length);
  });

  it('never smaller than a speck on screen, never grown huge, and never grown into the clear slab', () => {
    const perPx = (2 * Math.tan(THREE.MathUtils.degToRad(25))) / 390;
    expect(beltGrow(40, 100, perPx)).toBe(1);
    const far = beltGrow(20, 15000, perPx);
    expect(far).toBeGreaterThan(1);
    expect((20 * far) / (15000 * perPx)).toBeCloseTo(BELT_LOOK.minPx, 6);
    expect(beltGrow(18, 1e6, perPx)).toBe(BELT_LOOK.maxGrow);
    // A rock just outside the slab grows only as far as the slab's edge.
    for (const r of rocks.slice(0, 500)) {
      const g = beltGrow(r.size, 30000, perPx, r.z);
      expect(Math.abs(r.z) - g * r.size * ROCK_REACH).toBeGreaterThanOrEqual(BELT.slab - 1e-6 - (g === 1 ? 0 : 0));
    }
  });

  it('fades rocks right by the camera (between it and the rocket), never others', () => {
    expect(nearFade(100, 1000)).toBe(0);
    expect(nearFade(2000, 1000)).toBe(1);
    expect(nearFade(450, 1000)).toBeGreaterThan(0);
    expect(nearFade(450, 1000)).toBeLessThan(1);
    // A rock below the flight plane is always further than the camera's height: never faded.
    for (const h of [30, 500, 6000, 15000]) expect(nearFade(h + BELT.slab, h)).toBe(1);
  });

  it('keeps the start the same: hidden on the pad and anywhere inside Tumble\'s orbit, only faint dots on the map', () => {
    const w = homestead.worldPos(0, {});
    expect(beltShown('flight', 50, Math.hypot(w.x, w.y))).toBe(false);
    expect(dotsShown('flight', 50)).toBe(0);
    expect(beltShown('flight', 15000, 45000)).toBe(false); // zoomed right out, anywhere inside about 47,000
    expect(beltShown('drive', 10, 110000)).toBe(false);
    expect(beltShown('flight', 6000, 110000)).toBe(true);
    expect(beltShown('flight', 200, 69000)).toBe(true);
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
    const near = fr.belt.arcs.filter((m) => m.position.length() < 40000);
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThan(5);
    for (const m of fr.belt.arcs) expect(m.rotation.z).toBeCloseTo(beltTurn(sys, t), 12);
    const arc = near[0], mid = arc.userData.mid;
    const c = Math.cos(beltTurn(sys, t)), s = Math.sin(beltTurn(sys, t));
    expect(arc.position.x).toBeCloseTo(c * mid.x - s * mid.y - origin.x, 6);
    expect(arc.position.y).toBeCloseTo(s * mid.x + c * mid.y - origin.y, 6);
    expect(fr.belt.uniforms.fcTime.value).toBeCloseTo(spinClock(t), 9);
    expect(fr.belt.uniforms.fcNear.value.x).toBeCloseTo(BELT_LOOK.near[0] * 5000, 6);
    // Each crosser where its orbit says.
    const p = crosserPos(list[2], t, {});
    expect(fr.belt.cross[2].position.x).toBeCloseTo(p.x - origin.x, 6);
    expect(fr.belt.cross[2].position.z).toBeCloseTo(p.z, 6);
    ctx.mode = 'drive';
    fr.update(ctx);
    expect(fr.belt.group.visible).toBe(false);
    expect(fr.belt.dots.visible).toBe(false);
    expect(fr.lander.group.visible).toBe(false);
    const before = [fr.belt.uniforms.fcNear.value, fr.lander.group.position, fr.lander.group.quaternion, fr.lander.up, fr.belt.cross[0].position];
    ctx.mode = 'flight';
    ctx.t += 3;
    fr.update(ctx);
    const after = [fr.belt.uniforms.fcNear.value, fr.lander.group.position, fr.lander.group.quaternion, fr.lander.up, fr.belt.cross[0].position];
    after.forEach((o, i) => expect(o).toBe(before[i]));
  });
});

describe('every rock tumbles (#62 stage 4)', () => {
  it('each about its own axis, a whole number of turns every spinT, the small ones faster', () => {
    for (const r of [...rocks, ...BIG_ROCKS, ...list]) {
      expect(Math.hypot(...r.axis)).toBeCloseTo(1, 9);
      expect(Number.isInteger(r.spin)).toBe(true);
      expect(r.spin).toBeGreaterThan(0);
    }
    for (const r of rocks) {
      const period = BELT.spinT / r.spin;
      expect(period).toBeGreaterThanOrEqual(6);
      expect(period).toBeLessThanOrEqual(90);
    }
    for (const b of BIG_ROCKS) {
      expect(BELT.spinT / b.spin).toBeGreaterThanOrEqual(100);
      expect(BELT.spinT / b.spin).toBeLessThanOrEqual(300);
    }
    const bySize = [...rocks].sort((x, y) => x.size - y.size);
    const tenth = Math.floor(rocks.length / 10);
    const mean = (l) => l.reduce((v, r) => v + BELT.spinT / r.spin, 0) / l.length;
    expect(mean(bySize.slice(0, tenth))).toBeLessThan(mean(bySize.slice(-tenth)) / 2);
    const up = rocks.filter((r) => Math.abs(r.axis[2]) > 0.9).length / rocks.length;
    expect(up).toBeGreaterThan(0.05);
    expect(up).toBeLessThan(0.15);
  });

  it('from the game clock: the same time, the same turn (saves, rewind, warp), and no jump as the clock wraps', () => {
    expect(tumbleAngle(20, 0.5, 1234.5)).toBe(tumbleAngle(20, 0.5, 1234.5));
    const turns = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
    for (const spin of [1, 20, 240]) {
      const w = (2 * Math.PI * spin) / BELT.spinT;
      for (const T of [BELT.spinT, 7 * BELT.spinT, 1e6 * BELT.spinT]) {
        expect(turns(tumbleAngle(spin, 1, T + 0.01), tumbleAngle(spin, 1, T - 0.01))).toBeCloseTo(0.02 * w, 6);
      }
    }
    expect(spinClock(1e9 + 12.25)).toBeLessThan(BELT.spinT);
    expect(spinClock(3 * BELT.spinT + 12.25)).toBeCloseTo(12.25, 9);
  });

  it('in the vertex shader, from per-instance attributes the rock and its ink share; its normals turn too', () => {
    const belt = createBelt(sys);
    for (const m of [...belt.arcs, ...belt.big, ...belt.cross]) {
      const ink = m.children[0];
      for (const name of ['fcAxis', 'fcSpin']) {
        const attr = m.geometry.attributes[name];
        expect(attr.isInstancedBufferAttribute, name).toBe(true);
        expect(attr.count).toBe(m.count);
        expect(ink.geometry.attributes[name]).toBe(attr);
      }
    }
    expect(belt.arcs[0].geometry.attributes.fcSpin).not.toBe(belt.arcs[1].geometry.attributes.fcSpin);
    expect(belt.arcs[0].geometry.attributes.position).toBe(belt.arcs[1].geometry.attributes.position);
    const r = rocks.find((x) => x.sector === 0);
    const sp = belt.arcs[0].geometry.attributes.fcSpin;
    expect(sp.getX(0)).toBeCloseTo((2 * Math.PI * r.spin) / BELT.spinT, 6);
    expect(sp.getY(0)).toBeCloseTo(r.phase, 5);
    const rockShader = { uniforms: {}, vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: '' };
    belt.arcs[0].material.onBeforeCompile(rockShader);
    const inkShader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: '' };
    belt.arcs[0].children[0].material.onBeforeCompile(inkShader);
    for (const sh of [rockShader, inkShader]) {
      expect(sh.vertexShader).not.toContain('#include <project_vertex>');
      expect(sh.vertexShader).toContain('fcC + fcTurn((instanceMatrix * vec4(transformed, 1.0)).xyz - fcC)');
      expect(sh.vertexShader).toContain('smoothstep(fcNear.x, fcNear.y, fcDist)');
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
  it('rests on a big rock just under the clear slab, never a crosser, all of it always outside the slab', () => {
    expect(BIG_ROCKS.filter((b) => b.lander)).toEqual([LANDER_ROCK]);
    expect(LANDER_ROCK.r > BELT.inner && LANDER_ROCK.r < BELT.outer).toBe(true);
    expect(LANDER_ROCK.z).toBeLessThan(0);
    expect(LANDER_ROCK.z + (LANDER_ROCK.size * BIG_REACH[LANDER_ROCK.kind]) / 2 + BELT_LOOK.lander).toBeLessThan(-BELT.slab);
    expect(LANDER_ROCK.z).toBeGreaterThan(-BELT.slab - 120); // right by the slab, so flying over shows it
    expect(BELT_LOOK.lander / LANDER_ROCK.size).toBeGreaterThan(1 / 7);
  });

  it('is near Yonder\'s path: once a Yonder year Yonder comes within a few km', () => {
    let best = Infinity, near = 0;
    const dt = 20;
    for (let t = 0; t < yonder.orbitalPeriod; t += dt) {
      const r = landerRockAt(sys, t, {}), y = yonder.worldPos(t, {});
      const d = Math.hypot(r.x - y.x, r.y - y.y);
      best = Math.min(best, d);
      if (d < 10000) near += dt;
    }
    expect(best).toBeGreaterThan(3000);
    expect(best).toBeLessThan(6000);
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
      const tumble = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...LANDER_ROCK.axis), tumbleAngle(LANDER_ROCK.spin, LANDER_ROCK.phase, t));
      const q = new THREE.Quaternion().setFromAxisAngle(Z, beltTurn(sys, t)).multiply(tumble);
      const at = fr.spot.at.clone().applyQuaternion(q).add(rock);
      expect(fr.lander.group.position.distanceTo(at)).toBeLessThan(1e-6);
      expect(fr.spot.at.length()).toBeGreaterThan(LANDER_ROCK.size * 0.3);
      expect(fr.spot.at.length()).toBeLessThan(LANDER_ROCK.size * 0.62);
      expect(fr.lander.up.dot(fr.spot.up.clone().applyQuaternion(q))).toBeCloseTo(1, 9);
      ups.push(fr.lander.up.clone());
    }
    expect(ups[0].angleTo(ups[1])).toBeGreaterThan(0.05);
  });

  it('is a discovery with a sticker, a lander fact and a hint, found only by seeing it', () => {
    const d = DISCOVERIES.find((x) => x.id === 'find-lander');
    expect(d.world).toBe('yonder');
    expect(d.find).toBe('lander');
    const st = STICKERS['find-lander'];
    expect(st.say).toContain('hopping');
    expect(st.hint).toContain('Yonder');
    expect(STICKERS['find-probe']).toBeUndefined();
    expect(DISCOVERIES.some((x) => x.id === 'find-probe')).toBe(false);
    const ctx = { time: 0, toSun: { x: 1, y: 0, z: 0 }, has: (id) => id !== 'find-lander' };
    expect(discoveryTargets(yonder, ctx).map((x) => x.id)).not.toContain('find-lander');
    expect(landingFinds(yonder, 0.3, ctx)).toBe(null);
    expect(buggyFinds(yonder, { p: [yonder.radius, 0, 0], speed: 0, grounded: true }, ctx)).toBe(null);
  });

  it('needs it on screen, clear of the buttons, facing us, and big enough to make out', () => {
    const v = { x: 0.1, y: 0.1, behind: false, facing: 0.7, px: 8 };
    expect(landerSeen(v)).toBe(true);
    expect(landerSeen({ ...v, px: LANDER_VIEW.px - 0.5 })).toBe(false);
    expect(landerSeen({ ...v, facing: -0.3 })).toBe(false);
    expect(landerSeen({ ...v, behind: true })).toBe(false);
    expect(landerSeen({ ...v, x: 0.95 })).toBe(false);
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

  it('is found flying over it with it facing us, and not from far off, round the back, or driving', () => {
    const t = facing(1), back = facing(-1);
    expect(t).not.toBe(null);
    expect(back).not.toBe(null);
    // (Out in Ember's space the flight camera's usual distance is its farthest, 6 km: zoomed in to
    // a couple of hundred metres over the rocket, the lander shows.)
    expect(scene(t, [20, -20], 0.03).look()).toBe(true);
    expect(scene(t, [20, -20], 0.05).look()).toBe(true);
    expect(scene(t, [20, -20], 1).look()).toBe(false); // the usual view out there: a speck
    expect(scene(t, [3000, 0]).look()).toBe(false);
    expect(scene(back, [20, -20]).look()).toBe(false);
    const d = scene(t, [20, -20]);
    d.drive = { active: true };
    expect(d.landerInView()).toBe(false);
    const c = scene(t, [20, -20]);
    c.look();
    c.crashed = true;
    expect(c.landerInView()).toBe(false);
  });
});

describe('the crossers (#62 stage 4): the odd real collision', () => {
  it('are a handful of small rocks on tilted orbits, crossing the flight plane at fixed points, from the game clock', () => {
    for (const c of list) {
      expect(c.size).toBeLessThan(40);
      expect(c.incl).toBeGreaterThan(0.05);
      expect(c.rate).toBeLessThan(0); // round the way everything goes
      // In the plane exactly at each crossing, at its node (or opposite).
      for (const k of [0, 1, 7, -3]) {
        const p = crosserPos(c, passTime(c, k), {});
        expect(Math.abs(p.z)).toBeLessThan(1e-6);
        expect(Math.hypot(p.x, p.y)).toBeCloseTo(c.R, 3);
      }
      // Pure: the same time, the same place.
      expect(crosserPos(c, 12345.6, {})).toEqual(crosserPos(c, 12345.6, {}));
      // In the belt.
      expect(c.R > BELT.inner && c.R < BELT.outer).toBe(true);
    }
  });

  it('one beats 3:2 with Yonder and reaches it every two Yonder years; one reaches Hither; each a puff on the cameras\' side', () => {
    const hits = [];
    crosserHitsBetween(sys, 0, 4 * yonder.orbitalPeriod + 1000, (h) => hits.push(h));
    const onYonder = hits.filter((h) => h.body === yonder), onHither = hits.filter((h) => h.body === hither);
    expect(onYonder.length).toBeGreaterThanOrEqual(2);
    expect(onHither.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < onYonder.length; i++) expect(onYonder[i].t - onYonder[i - 1].t).toBeCloseTo(2 * yonder.orbitalPeriod, 0);
    for (const h of hits) {
      // Where it lands: on the world's ground (its radius from the middle), on the side the cameras see.
      expect(Math.hypot(h.x, h.y, h.z)).toBeCloseTo(h.body.radius, 6);
      expect(h.z).toBeGreaterThan(0);
      // Touching at that moment.
      const c = list[h.crosser];
      const p = crosserPos(c, h.t, {}), w = worldOf(h.body, h.t, {});
      expect(Math.hypot(p.x - w.x, p.y - w.y, p.z)).toBeCloseTo(h.body.radius + c.size * ROCK_REACH, 3);
    }
    // Hits are rare: a few over many Yonder years.
    expect(hits.length).toBeLessThan(8);
  });

  it('are never drawn inside a world: gone from the moment one reaches it until far off the plane', () => {
    for (const c of list) {
      for (let k = 0; k > -8; k--) {
        const tk = passTime(c, k);
        for (let t = tk - 120; t < tk + 120; t += 0.5) {
          if (!crosserShown(sys, c, t)) continue;
          const p = crosserPos(c, t, {});
          for (const b of [yonder, hither]) {
            const w = worldOf(b, t, {});
            expect(Math.hypot(p.x - w.x, p.y - w.y, p.z)).toBeGreaterThan(b.radius + c.size * ROCK_REACH - 0.01);
          }
        }
      }
    }
    // Gone after a hit, back by the far point of that lap.
    const k = Math.round((list[0].u0 + list[0].rate * list[0].meetsYonder) / Math.PI);
    const hit = crosserHit(sys, list[0], k);
    expect(hit.body).toBe(yonder);
    expect(crosserShown(sys, list[0], hit.t - 1)).toBe(true);
    expect(crosserShown(sys, list[0], hit.t + 1)).toBe(false);
    const quarter = Math.PI / 2 / Math.abs(list[0].rate);
    expect(crosserShown(sys, list[0], hit.t + quarter + 60)).toBe(true);
  });

  // A flying rocket in Ember's space right where crosser c crosses the plane on crossing k.
  function inTheWay(c, k, off = [0, 0], dt = -8) {
    const f = new Flight(sys, { accel: 20, turnRate: 1, safeSpeed: 3, maxTilt: 0.5 });
    const tk = passTime(c, k);
    const p = crosserPos(c, tk, {});
    // Drifting with the rock's in-plane speed, so it waits there for it.
    f.state = { body: sys.byId.ember, x: p.x + p.vx * dt + off[0], y: p.y + p.vy * dt + off[1], vx: p.vx, vy: p.vy, angle: 0, t: tk + dt, landed: false, landAngle: 0, crashed: false, flightTime: 5 };
    return f;
  }

  it('nudge a flying rocket in their way: a small push, once a crossing, never a crash, and the same on replay', () => {
    const c = list[3];
    const f = inTheWay(c, -2);
    const events = [];
    let dv = 0;
    f.on((type, d) => {
      events.push([type, d]);
      // The push: this substep's change of speed (gravity's share in one substep is tiny).
      if (type === 'bump') dv = Math.hypot(f.state.vx - f.lastGood.vx, f.state.vy - f.lastGood.vy);
    });
    const snap = f.snapshot();
    for (let i = 0; i < 60 * 120; i++) f.step(1 / 60, 1);
    const bumps = events.filter(([e]) => e === 'bump');
    expect(bumps.length).toBe(1);
    expect(events.some(([e]) => e === 'crash')).toBe(false);
    expect(f.state.crashed).toBe(false);
    // Small: a few m/s.
    expect(CROSS.bump).toBeLessThanOrEqual(3);
    expect(dv).toBeGreaterThan(CROSS.bump * 0.9);
    expect(dv).toBeLessThan(CROSS.bump * 1.1);
    // Rewind and fly again: the same bump at the same place.
    const first = { x: f.state.x, y: f.state.y };
    f.restore(snap);
    for (let i = 0; i < 60 * 120; i++) f.step(1 / 60, 1);
    expect(Math.hypot(f.state.x - first.x, f.state.y - first.y)).toBeLessThan(1e-3);
    // Out of its way (40 m to the side), nothing.
    const g = inTheWay(c, -2, [40 + c.size, 0]);
    const ev2 = [];
    g.on((type) => ev2.push(type));
    for (let i = 0; i < 60 * 120; i++) g.step(1 / 60, 1);
    expect(ev2).not.toContain('bump');
  });

  it('never bother a landed rocket, and crosserTouch is cheap: nothing unless one is at the plane', () => {
    const dir = {};
    // Far from every crossing, nothing.
    expect(crosserTouch(sys, sys.byId.ember, 110000, 0, passTime(list[2], -1) + 500, dir)).toBe(-1);
    // A landed rocket isn't stepped through the sim's flight, so never nudged.
    const f = new Flight(sys, { accel: 20, turnRate: 1, safeSpeed: 3, maxTilt: 0.5 });
    const events = [];
    f.on((e) => events.push(e));
    for (let i = 0; i < 600; i++) f.step(1 / 60, 1000);
    expect(events).not.toContain('bump');
  });

  it('a hit on Yonder makes a puff of ice dust in the flight scene (pooled particles), once', () => {
    const hits = [];
    crosserHitsBetween(sys, 0, yonder.orbitalPeriod, (h) => hits.push(h));
    const hit = hits.find((h) => h.body === yonder);
    const puffs = [];
    const s = Object.create(FlightScene.prototype);
    Object.assign(s, {
      system: sys, flight: { state: { t: hit.t - 5 } }, app: { audio: { play() {} } },
      particles: { spawn: (kind, body, x, y, z) => puffs.push({ kind, body, x, y, z }) },
    });
    s.updateImpacts();
    s.flight.state.t = hit.t + 5;
    s.updateImpacts();
    expect(puffs.length).toBeGreaterThan(20);
    for (const p of puffs) {
      expect(p.body).toBe(yonder);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(yonder.radius, 6);
    }
    // Not again for the same moment, nor after a rewind.
    const n = puffs.length;
    s.updateImpacts();
    s.flight.state.t = hit.t - 100;
    s.updateImpacts();
    s.flight.state.t = hit.t - 99;
    s.updateImpacts();
    expect(puffs.length).toBe(n);
  });
});
