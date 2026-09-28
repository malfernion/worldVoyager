// #54 (stage 5): Frosty's mist and ice sparkles. The mist: where the wisps go (always out of a
// glowing crack, never in the ice), each wisp's loop (it leaves the crack, drifts off and lifts
// a little, then starts again somewhere new along it), how much shows by day and by night, and
// when it fades (at the lens, big on screen, far away); only Frosty has it. The sparkles: only
// Frosty's ground shader has them, and the glint grid keeps its spots a steady size on screen.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MIST_LOOK, MIST_STRIDE, mistPlan, mistAt, mistStrength, mistFade, createMist } from '../src/world/mist.js';
import { ROCKY_LOOK, SPARKLE, sparkleCell, richRocky } from '../src/world/richLook.js';
import { FROSTY_GLOWS } from '../src/physics/terrain.js';
import { createSystem } from '../src/physics/bodies.js';

const sys = createSystem();
const frosty = sys.byId.frosty;
const look = MIST_LOOK.frosty;
const R = frosty.radius;
const ground = (x, y, z) => R + frosty.terrainFn.height(x, y, z);
const plan = mistPlan(look, ground, R);
const count = plan.length / MIST_STRIDE;
const unit = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };

// A point's place relative to crack g: metres along it and across it (on the ground).
function onCrack(g, p) {
  const u = unit(...p);
  const d = [u[0] - g.x, u[1] - g.y, u[2] - g.z];
  const along = d[0] * g.t.x + d[1] * g.t.y + d[2] * g.t.z;
  const s = [g.y * g.t.z - g.z * g.t.y, g.z * g.t.x - g.x * g.t.z, g.x * g.t.y - g.y * g.t.x];
  const across = d[0] * s[0] + d[1] * s[1] + d[2] * s[2];
  return { along: along * R, across: across * R };
}
const crackOf = (i) => FROSTY_GLOWS[Math.floor(i / look.wisps)];

describe('mistPlan (#54, Frosty)', () => {
  it('is the same every time, and phone-sized', () => {
    expect(Array.from(mistPlan(look, ground, R))).toEqual(Array.from(plan));
    expect(count).toBe(FROSTY_GLOWS.length * look.wisps);
    expect(count).toBeLessThan(300);
  });

  it('spreads each crack\'s wisps all along it, and only along the glowing groove', () => {
    for (let c = 0; c < FROSTY_GLOWS.length; c++) {
      const g = FROSTY_GLOWS[c];
      const alongs = [];
      for (let i = c * look.wisps; i < (c + 1) * look.wisps; i++) {
        const k = i * MIST_STRIDE;
        const { along, across } = onCrack(g, [plan[k], plan[k + 1], plan[k + 2]]);
        expect(Math.abs(across)).toBeLessThan(0.05);
        // (The groove is full to 0.1 radii from the middle, gone by 0.18.)
        expect(Math.abs(along) + plan[k + 3]).toBeLessThan(0.15 * R);
        alongs.push(along);
      }
      alongs.sort((a, b) => a - b);
      expect(alongs[0]).toBeLessThan(-0.08 * R);
      expect(alongs.at(-1)).toBeGreaterThan(0.08 * R);
      for (let j = 1; j < alongs.length; j++) expect(alongs[j] - alongs[j - 1]).toBeLessThan(2 * look.len * R / look.wisps + 0.5);
    }
  });
});

describe('mistAt: each wisp\'s loop', () => {
  const out = {};
  it('leaves from the crack every time round, never in the ice', () => {
    for (let i = 0; i < count; i++) {
      const k = i * MIST_STRIDE;
      const period = plan[k + 8], phase = plan[k + 10];
      for (let c = 0; c < 30; c++) {
        const t = (c + 1e-6) * period - phase + period * 1000;
        mistAt(plan, i, t, out);
        expect(out.age).toBeLessThan(0.01);
        const { along, across } = onCrack(crackOf(i), [out.x, out.y, out.z]);
        expect(Math.abs(along)).toBeLessThan(0.15 * R);
        expect(Math.abs(across)).toBeLessThan(look.side + 0.1);
        // Its middle above the ground there (it's drawn squashed, so its soft bottom edge is about
        // on the ground), and not floating: it rides at the height of the highest bank it may
        // drift over (the groove is 1.5 m deep, the drawn mesh too coarse to show it).
        const gap = Math.hypot(out.x, out.y, out.z) - ground(...unit(out.x, out.y, out.z));
        expect(gap).toBeGreaterThan(0.1 * out.size);
        expect(gap).toBeLessThan(0.3 * out.size + 5);
      }
    }
  });

  it('drifts off the crack, lifts a little and spreads, then rests and starts again', () => {
    for (let i = 0; i < count; i += 3) {
      const k = i * MIST_STRIDE;
      const period = plan[k + 8], life = plan[k + 9], phase = plan[k + 10];
      const t0 = 3 * period - phase + period * 1000;
      const start = { ...mistAt(plan, i, t0 + 0.01) };
      const mid = { ...mistAt(plan, i, t0 + 0.5 * life * period) };
      const end = { ...mistAt(plan, i, t0 + 0.99 * life * period) };
      const rest = mistAt(plan, i, t0 + (life + (1 - life) / 2) * period);
      expect(start.alpha).toBeLessThan(0.2);
      expect(mid.alpha).toBeGreaterThan(0.9);
      expect(end.alpha).toBeLessThan(0.05);
      expect(mid.size).toBeGreaterThan(start.size);
      expect(end.lift).toBeGreaterThanOrEqual(start.lift);
      expect(end.lift - start.lift).toBeLessThanOrEqual(look.rise[1] + 1e-6);
      if (life < 1) expect(rest.alpha).toBe(0);
      // Never into the ice as it drifts off the crack.
      for (let f = 0; f <= 1; f += 0.1) {
        const p = mistAt(plan, i, t0 + f * life * period);
        expect(Math.hypot(p.x, p.y, p.z) - ground(...unit(p.x, p.y, p.z))).toBeGreaterThan(0.1 * p.size);
      }
      // Never wanders far: it's mist over the crack, not a cloud crossing the moon.
      const { across } = onCrack(crackOf(i), [end.x, end.y, end.z]);
      expect(Math.abs(across)).toBeLessThan(look.side + look.drift[1] * 1.4);
    }
  });

  it('keeps moving (it is ambient, on the real clock)', () => {
    const a = { ...mistAt(plan, 5, 100) }, b = mistAt(plan, 5, 100.5);
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(0.01);
  });
});

describe('mistStrength: day and night', () => {
  it('is full at night, faint in full sun, and never jumps', () => {
    expect(mistStrength(-1, look)).toBe(1);
    expect(mistStrength(-0.3, look)).toBe(1);
    expect(mistStrength(1, look)).toBeCloseTo(look.day);
    expect(look.day).toBeGreaterThan(0);
    expect(look.day).toBeLessThan(0.3);
    let last = 1;
    for (let c = -1; c <= 1; c += 0.01) {
      const s = mistStrength(c, look);
      expect(s).toBeLessThanOrEqual(last + 1e-9);
      expect(last - s).toBeLessThan(0.05);
      last = s;
    }
  });
});

describe('mistFade: the lens, big on screen and far away', () => {
  const focal = 1 / Math.tan((50 / 2) * Math.PI / 180);
  it('is gone right at the lens, and when it would fill the screen', () => {
    expect(mistFade(2, 1, focal, look.far)).toBe(0);
    expect(mistFade(2, 4, focal, look.far)).toBeLessThan(0.1);
  });
  it('shows in full at driving distances, and is gone from orbit', () => {
    expect(mistFade(2, 25, focal, look.far)).toBe(1);
    expect(mistFade(2, 60, focal, look.far)).toBe(1);
    expect(mistFade(2, look.far[1] + 1, focal, look.far)).toBe(0);
  });
});

describe('createMist', () => {
  it('is one mesh on Frosty, and nowhere else', () => {
    const m = createMist(frosty, new THREE.Vector3(1, 0, 0));
    expect(m.mesh.geometry.instanceCount).toBe(count);
    expect(m.mesh.material.depthWrite).toBe(false);
    for (const b of sys.bodies) if (b.id !== 'frosty') expect(MIST_LOOK[b.id]).toBeUndefined();
  });
});

// The rocky ground shader with its snippets, as the renderer would build it.
function built(body) {
  const mat = richRocky(new THREE.MeshToonMaterial({ vertexColors: true, flatShading: true }), body, new THREE.Vector3(1, 0, 0));
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: THREE.ShaderLib.toon.fragmentShader };
  mat.onBeforeCompile?.(shader);
  return { mat, shader };
}

describe('ice sparkles (#54, Frosty)', () => {
  it('are Frosty\'s alone: every other world\'s ground shader is as it was', () => {
    for (const b of sys.bodies) {
      if (!ROCKY_LOOK[b.id]) continue;
      const { mat, shader } = built(b);
      const has = b.id === 'frosty';
      expect(!!ROCKY_LOOK[b.id].sparkle).toBe(has);
      expect(shader.fragmentShader.includes('rlGlint')).toBe(has);
      expect(shader.fragmentShader.includes('RL_SPARKLE')).toBe(has);
      expect('rlSparkle' in shader.uniforms).toBe(has);
      expect(!!mat.userData.richUpdate).toBe(has);
      expect(mat.customProgramCacheKey().includes('RL_SPARKLE')).toBe(has);
    }
  });

  it('twinkle on the clock', () => {
    const { mat, shader } = built(frosty);
    mat.userData.richUpdate(12.5);
    expect(shader.uniforms.rlTime.value).toBe(12.5);
  });

  it('keep their spots a steady size on screen, whatever the distance, without popping', () => {
    // Up close: the finest grid; further off, twice as coarse per doubling of distance.
    expect(sparkleCell(0.001).cell).toBe(SPARKLE.cell);
    for (const px of [0.02, 0.05, 0.1, 0.3]) {
      const { cell, blend } = sparkleCell(px);
      const effective = cell * 2 ** blend; // what the blend of the two grids amounts to
      expect(effective / px).toBeCloseTo(20, 5);
    }
    // The blend runs smoothly into the next grid.
    let last = sparkleCell(0.02);
    for (let px = 0.02; px < 0.5; px *= 1.01) {
      const s = sparkleCell(px);
      const a = last.cell * 2 ** last.blend, b = s.cell * 2 ** s.blend;
      expect(b / a).toBeLessThan(1.02);
      last = s;
    }
    // Twice as sharp a screen: the same spots in CSS pixels.
    expect(sparkleCell(0.05, SPARKLE, 2).cell * 2 ** sparkleCell(0.05, SPARKLE, 2).blend).toBeCloseTo(2 * 20 * 0.05, 5);
  });

  it('show landed and driving, faintly from low orbit, never from the globe', () => {
    expect(sparkleCell(0.02).k).toBe(1);
    expect(sparkleCell(0.2).k).toBe(1);
    expect(sparkleCell(0.6).k).toBeGreaterThan(0);
    expect(sparkleCell(0.6).k).toBeLessThan(1);
    expect(sparkleCell(2).k).toBe(0);
  });
});
