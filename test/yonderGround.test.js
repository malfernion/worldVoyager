// The rest of Yonder's ground (#62): away from its heart, cracked frost plains, bladed terrain
// (like Pluto's Tartarus Dorsa) and pitted dark lands, drawn by its ground shader. Only on Yonder
// (every other world's ground shader is as it was), never on the heart, its rim, glaciers or
// mountains (the owner's heart stays exactly as it is), and the blades' low ridges gentle to
// drive over and nowhere near the flight plane.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSystem } from '../src/physics/bodies.js';
import { makeTerrain, YONDER_BLADES, YONDER_HEART, heartAt, heartDir } from '../src/physics/terrain.js';
import { Buggy, vec } from '../src/physics/buggy.js';
import { BUGGIES } from '../src/rocket/parts.js';
import { ROCKY_LOOK, YONDER_GROUND, CRACK_STRAY, CRATER_FIT, crackAt, richRocky } from '../src/world/richLook.js';

globalThis.document ??= { getElementById: () => null };

const sys = createSystem();
const { yonder } = sys.byId;
const ter = yonder.terrainFn;
const R = yonder.radius;

// Points all over the world (a Fibonacci sphere).
function* sphere(n) {
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n, a = i * 2.399963, k = Math.sqrt(1 - z * z);
    yield [k * Math.cos(a), k * Math.sin(a), z];
  }
}

// The rocky ground shader with its snippets, as the renderer would build it.
function built(body) {
  const mat = richRocky(new THREE.MeshToonMaterial({ vertexColors: true }), body, new THREE.Vector3(1, 0, 0));
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: THREE.ShaderLib.toon.fragmentShader };
  mat.onBeforeCompile(shader);
  return { mat, shader };
}

// A small hash like the shader's (any three numbers 0..1 per cell will do for the sums).
const fr = (x) => x - Math.floor(x);
const hash3 = (i, j, k) => [fr(Math.sin(i * 12.9898 + j * 78.233 + k * 37.719) * 43758.5453), fr(Math.sin(i * 39.3468 + j * 11.135 + k * 83.155) * 24634.6345), fr(Math.sin(i * 73.156 + j * 52.235 + k * 9.151) * 56445.2345)];

describe('the rest of Yonder\'s ground (#62)', () => {
  it('is only in Yonder\'s ground shader', () => {
    for (const b of sys.bodies) {
      const look = ROCKY_LOOK[b.id];
      if (!look) continue;
      const has = b.id === 'yonder';
      expect(!!look.ground, b.id).toBe(has);
      const { mat, shader } = built(b);
      expect(shader.fragmentShader.includes('rlCracks'), b.id).toBe(has);
      expect(shader.fragmentShader.includes('rlGround'), b.id).toBe(has);
      expect(shader.vertexShader.includes('groundMark'), b.id).toBe(has);
      expect('rlCrack' in shader.uniforms, b.id).toBe(has);
      expect(mat.customProgramCacheKey().includes('RL_GROUND'), b.id).toBe(has);
    }
    // The heart's cells are still drawn, before the rest of the ground's patterns.
    const f = built(yonder).shader.fragmentShader;
    expect(f.indexOf('rlCell.x')).toBeGreaterThan(0);
    expect(f.indexOf('rlCell.x')).toBeLessThan(f.indexOf('rlCracks(rlObj'));
  });

  it('leaves the heart, its rim, glaciers and mountains exactly as they are', () => {
    let heart = 0;
    const mk = new Array(10).fill(0);
    for (const [x, y, z] of sphere(60000)) {
      const hr = ter.heart(x, y, z);
      if (!(hr.in > 0.05 || hr.sd < 0.04 || hr.glacier > 0.05 || hr.peak > 0.02)) continue;
      heart++;
      const l = ter.land(x, y, z);
      expect([l.crack, l.pit, l.blade]).toEqual([0, 0, 0]);
      // (So the shader's patterns and the new colours don't touch it.)
      ter.marks(x, y, z, mk);
      expect(mk.slice(5, 8)).toEqual([0, 0, 0]);
    }
    expect(heart).toBeGreaterThan(3000);
  });

  it('covers the rest: cracked plains, pitted dark lands, and the blades east of the heart', () => {
    let n = 0, crack = 0, pit = 0, blade = 0, dark = 0, darkPitted = 0;
    for (const [x, y, z] of sphere(20000)) {
      const hr = ter.heart(x, y, z);
      if (hr.near > 0) continue;
      const l = ter.land(x, y, z);
      n++;
      if (l.crack > 0.5) crack++;
      if (l.blade > 0.5) blade++;
      if (l.pit > 0.5) pit++;
      if (ter.tholin(x, y, z) > 0.8) { dark++; if (l.pit > 0.5 || l.blade > 0.5) darkPitted++; }
    }
    expect(crack / n).toBeGreaterThan(0.4); // most of the world is the pale plains
    expect(pit / n).toBeGreaterThan(0.15);
    expect(darkPitted / dark).toBeGreaterThan(0.95);
    expect(blade).toBeGreaterThan(0);
    // The blades: east of the heart, on the side the cameras see, well clear of the flight plane.
    let bn = 0;
    for (const [x, y, z] of sphere(40000)) {
      if (ter.land(x, y, z).blade <= 0) continue;
      bn++;
      const h = heartAt(x, y, z);
      expect(h.u).toBeGreaterThan(0.8);
      expect(z * R).toBeGreaterThan(30); // (the flight plane's strip, test/yonder.test.js)
    }
    expect(bn / 40000).toBeGreaterThan(0.01); // big enough to see from orbit
  });

  it('gives the blades low, gentle ridges, a gap apart', () => {
    const B = YONDER_BLADES;
    expect(B.h).toBeLessThan(1.2);
    expect(B.gap).toBeGreaterThan(9); // several of the mesh's vertices (about 3 m apart) across each
    const d = heartDir(...B.at);
    // Across the oval: crests and troughs, a gap apart; never steep.
    const e = 0.25 / R;
    let worst = 0, lo = Infinity, hi = -Infinity;
    const H = YONDER_HEART;
    const k = Math.cos(B.turn), s = Math.sin(B.turn);
    for (let t = -0.25; t <= 0.25; t += 0.0005) {
      const p = heartDir(B.at[0] + t * k, B.at[1] - t * s);
      const h = ter.height(p.x, p.y, p.z);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
      // The steepest slope, any way round, at this point.
      const t1 = vec.norm(vec.cross([p.x, p.y, p.z], [0, 0, 1])), t2 = vec.cross([p.x, p.y, p.z], t1);
      const at = (a, b) => { const q = vec.norm([p.x + t1[0] * a + t2[0] * b, p.y + t1[1] * a + t2[1] * b, p.z + t1[2] * a + t2[2] * b]); return ter.height(...q); };
      const sa = (at(e, 0) - at(-e, 0)) / 0.5, sb = (at(0, e) - at(0, -e)) / 0.5;
      worst = Math.max(worst, Math.atan(Math.hypot(sa, sb)) * 180 / Math.PI);
    }
    expect(hi - lo).toBeGreaterThan(B.h * 0.8); // real ridges
    expect(worst).toBeLessThan(25); // (the hills under them and all: as gentle as by the flight plane)
    expect(H.size * R * 0.5).toBeGreaterThan(B.gap * 5); // many blades across the oval
    expect(ter.bare(d.x, d.y, d.z)).toBe(false);
  });

  it('a buggy drives across the blades and out the other side, never stuck', () => {
    const B = YONDER_BLADES;
    const k = Math.cos(B.turn), s = Math.sin(B.turn);
    for (const kind of ['rover', 'truck', 'hopper']) {
      const from = heartDir(B.at[0] - 0.45 * k, B.at[1] + 0.45 * s), to = heartDir(B.at[0] + 0.45 * k, B.at[1] - 0.45 * s);
      const b = new Buggy(yonder, BUGGIES[kind]);
      const up = [from.x, from.y, from.z], goal = [to.x, to.y, to.z];
      const toward = (u) => vec.norm(vec.sub(goal, vec.mul(u, vec.dot(goal, u))));
      b.spawn(up, toward(up));
      let crossed = false;
      for (let i = 0; i < 60 * 90 && !crossed; i++) {
        // Steer towards the far side.
        const want = toward(b.up);
        const side = vec.dot(vec.cross(b.f, want), b.up);
        b.step(1 / 60, { throttle: 1, steer: Math.max(-1, Math.min(1, side * 3)) });
        crossed = vec.dot(vec.norm(b.p), goal) > Math.cos(8 / R);
      }
      expect(crossed, kind).toBe(true);
    }
  });

  it('cracks: 8 lookups find the same cracks as all 27 cells round the point', () => {
    let lines = 0, wrong = 0;
    const up = [0, 0, 1];
    for (let n = 0; n < 40000; n++) {
      const p = [fr(Math.sin(n * 1.7) * 9731) * 40 - 20, fr(Math.sin(n * 2.3) * 7919) * 40 - 20, fr(Math.sin(n * 3.1) * 5501) * 40 - 20];
      const a = crackAt(p, up, hash3, false), b = crackAt(p, up, hash3);
      if (a.dist < YONDER_GROUND.crack.width * 2) { lines++; if (Math.abs(a.dist - b.dist) > 1e-9) wrong++; }
    }
    expect(lines).toBeGreaterThan(1000);
    expect(wrong / lines).toBeLessThan(0.002);
    expect(CRACK_STRAY).toBeLessThanOrEqual(0.6);
  });

  it('cracks: the distance is along the ground, and big polygons, bigger than the heart\'s cells', () => {
    // On a flat ground (up = z), a crack's distance is at least its 3D distance to the edge's plane.
    for (let n = 0; n < 500; n++) {
      const p = [n * 0.173, n * 0.311, 0.4];
      const c = crackAt(p, [0, 0, 1], hash3);
      expect(c.dist).toBeGreaterThanOrEqual(0);
      expect(c.lean).toBeGreaterThanOrEqual(0);
      expect(c.lean).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(YONDER_GROUND.crack.cell).toBeGreaterThan(ROCKY_LOOK.yonder.heart.cell * 1.5);
    // The fine net inside them is finer than the heart's cells: from further off it's gone (the shader).
    expect(YONDER_GROUND.crack.fine[0]).toBeLessThan(ROCKY_LOOK.yonder.heart.cell);
  });

  it('craters always fit inside their cell (one lookup each, never cut off), a few sizes', () => {
    expect(CRATER_FIT.r[1] + CRATER_FIT.stray).toBeLessThanOrEqual(0.5);
    const c = YONDER_GROUND.pit.cells;
    expect(c.length).toBe(3);
    expect(c[0]).toBeGreaterThan(c[1] * 2);
    expect(c[1]).toBeGreaterThan(c[2] * 2);
  });
});
