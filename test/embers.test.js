// #54 (stage 2): Sizzle's embers and heat haze over its lava: where they go (always over the
// lava), each spark's loop (rises, winks out, rests, starts again somewhere new), and when they
// fade (in front of the rocket or buggy, at the lens, far away).
import { describe, it, expect } from 'vitest';
import { EMBER_LOOK, EMBER_STRIDE, SIGHT_VEIL, emberPlan, emberAt, hash, sightFade, nearFade, createEmbers } from '../src/world/embers.js';
import { createSystem } from '../src/physics/bodies.js';

const sys = createSystem();
const sizzle = sys.byId.sizzle;
const look = EMBER_LOOK.lava;
const pools = sizzle.terrainFn.pools.list;
const plan = emberPlan(look, pools, sizzle.liquidR);
const count = plan.length / EMBER_STRIDE;
const sparks = [], sheets = [];
for (let i = 0; i < count; i++) (plan[i * EMBER_STRIDE + 8] < 0.5 ? sparks : sheets).push(i);
const unit = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };

describe('emberPlan (#54, Sizzle)', () => {
  it('is the same every time, and phone-sized', () => {
    expect(Array.from(emberPlan(look, pools, sizzle.liquidR))).toEqual(Array.from(plan));
    expect(count).toBeLessThan(600);
    expect(sheets.length).toBeLessThan(40);
  });

  it('gives every pool its sparks (more on the big ones) and a couple of haze sheets', () => {
    const per = pools.map(() => ({ sparks: 0, sheets: 0 }));
    const poolOf = (i) => {
      const k = i * EMBER_STRIDE;
      const [x, y, z] = unit(plan[k], plan[k + 1], plan[k + 2]);
      let best = 0, bestD = Infinity;
      pools.forEach((p, j) => {
        const d = Math.acos(Math.min(1, x * p.mid.x + y * p.mid.y + z * p.mid.z));
        if (d < bestD) { best = j; bestD = d; }
      });
      return best;
    };
    for (const i of sparks) per[poolOf(i)].sparks++;
    for (const i of sheets) per[poolOf(i)].sheets++;
    for (const p of per) {
      expect(p.sparks).toBeGreaterThanOrEqual(look.embers);
      expect(p.sheets).toBeGreaterThanOrEqual(look.sheets);
    }
  });

  it('starts every spark, every time round, over the lava (well inside the shore)', () => {
    const out = {};
    for (const i of sparks) {
      const k = i * EMBER_STRIDE;
      const period = plan[k + 4], phase = plan[k + 6];
      for (let c = 0; c < 60; c++) {
        // The moment it starts, cycle c (a whisker in).
        const t = (c + 1e-6) * period - phase + period * 1000;
        emberAt(plan, i, t, out);
        expect(out.age).toBeLessThan(0.01);
        const r = Math.hypot(out.x, out.y, out.z);
        expect(r - sizzle.liquidR).toBeGreaterThan(0.1);
        expect(r - sizzle.liquidR).toBeLessThan(0.6); // (the tangent offsets lift it a little off the sphere)
        expect(sizzle.shoreDist(...unit(out.x, out.y, out.z))).toBeLessThan(-1);
      }
    }
  });

  it('stands the haze sheets over the middle of the pools, narrower than them', () => {
    for (const i of sheets) {
      const k = i * EMBER_STRIDE;
      const d = sizzle.shoreDist(...unit(plan[k], plan[k + 1], plan[k + 2]));
      expect(d).toBeLessThan(-4);
      expect(plan[k + 9]).toBeLessThan(-d * 1.3); // half-width
      expect(plan[k + 10]).toBeGreaterThan(2); // height
      expect(plan[k + 10]).toBeLessThan(8);
    }
  });
});

describe('a spark\'s loop (#54, Sizzle)', () => {
  it('rises, winks out, rests, then starts again somewhere new', () => {
    const out = {};
    for (const i of sparks.slice(0, 80)) {
      const k = i * EMBER_STRIDE;
      const period = plan[k + 4], life = plan[k + 5], rise = plan[k + 10], spread = plan[k + 3], drift = plan[k + 11];
      const t0 = 500 * period - plan[k + 6]; // the start of a loop
      let lastH = -1, shown = 0, rested = 0;
      const R = sizzle.liquidR;
      for (let s = 0; s < 200; s++) {
        const t = t0 + ((s + 0.5) / 200) * period;
        emberAt(plan, i, t, out);
        const h = Math.hypot(out.x, out.y, out.z) - R;
        if (out.age < 0) {
          // Resting: not drawn.
          expect(out.alpha).toBe(0);
          rested++;
          continue;
        }
        shown++;
        // Up all the way (never down), no higher than it may go.
        expect(h).toBeGreaterThanOrEqual(lastH - 0.02);
        expect(h).toBeLessThanOrEqual(rise + 0.2 + 0.4);
        lastH = h;
        expect(out.alpha).toBeGreaterThanOrEqual(0);
        expect(out.alpha).toBeLessThanOrEqual(1);
        expect(out.size).toBeGreaterThan(0);
        // Wandering only a little off its start's disc.
        const c = [plan[k], plan[k + 1], plan[k + 2]];
        const dot = (out.x * c[0] + out.y * c[1] + out.z * c[2]) / Math.hypot(...c);
        const side = Math.sqrt(Math.max(0, Math.hypot(out.x, out.y, out.z) ** 2 - dot * dot));
        expect(side).toBeLessThan(spread + drift + 0.5);
      }
      expect(shown / 200).toBeCloseTo(life, 1);
      if (life < 0.97) expect(rested).toBeGreaterThan(0);
      // Fades in and winks out: nothing at its very start or end.
      emberAt(plan, i, t0 + 1e-4, out);
      expect(out.alpha).toBeLessThan(0.02);
      emberAt(plan, i, t0 + period * life * 0.999, out);
      expect(out.alpha).toBeLessThan(0.02);
      emberAt(plan, i, t0 + period * life * 0.3, out);
      expect(out.alpha).toBeGreaterThan(0.5);
    }
  });

  it('never starts twice in the same spot', () => {
    const out = {};
    const i = sparks[3];
    const k = i * EMBER_STRIDE;
    const starts = [];
    for (let c = 0; c < 20; c++) {
      emberAt(plan, i, (c + 1e-6) * plan[k + 4] - plan[k + 6] + plan[k + 4] * 100, out);
      starts.push([out.x, out.y, out.z]);
    }
    for (let a = 0; a < starts.length; a++) {
      for (let b = a + 1; b < starts.length; b++) {
        expect(Math.hypot(starts[a][0] - starts[b][0], starts[a][1] - starts[b][1], starts[a][2] - starts[b][2])).toBeGreaterThan(1e-3);
      }
    }
  });

  it('hashes evenly into 0..1', () => {
    const bins = new Array(10).fill(0);
    for (let n = 0; n < 20000; n++) {
      const h = hash(n * 1.37 + 0.11);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      bins[Math.floor(h * 10)]++;
    }
    for (const b of bins) expect(b).toBeGreaterThan(1500);
  });
});

describe('ember fades (#54, Sizzle)', () => {
  const cam = [0, 0, 30];
  const focus = new Float64Array([0, 0, 0]);
  it('fades a spark across the line of sight to the rocket or buggy, only there', () => {
    // Right in front of it.
    expect(sightFade(0, 0, 10, 0.3, ...cam, focus, 1)).toBeCloseTo(SIGHT_VEIL, 5);
    // Off to the side, well clear.
    expect(sightFade(8, 0, 10, 0.3, ...cam, focus, 1)).toBe(1);
    // Behind it.
    expect(sightFade(0, 0, -5, 0.3, ...cam, focus, 1)).toBe(1);
    // In between: some.
    const k = sightFade(1.8, 0, 10, 0.3, ...cam, focus, 1);
    expect(k).toBeGreaterThan(SIGHT_VEIL);
    expect(k).toBeLessThan(1);
    // Nothing to keep clear: all of it.
    expect(sightFade(0, 0, 10, 0.3, ...cam, focus, 0)).toBe(1);
    // The closest focus wins.
    const two = new Float64Array([20, 0, 0, 0, 0, 0]);
    expect(sightFade(0, 0, 10, 0.3, ...cam, two, 2)).toBeCloseTo(SIGHT_VEIL, 5);
  });

  it('fades at the lens and far away (the globe stays clean)', () => {
    expect(nearFade(0.15, 0.2, look.far)).toBe(0);
    expect(nearFade(0.15, 20, look.far)).toBe(1);
    expect(nearFade(0.15, 150, look.far)).toBe(1);
    const orbit = nearFade(0.15, (look.far[0] + look.far[1]) / 2, look.far);
    expect(orbit).toBeGreaterThan(0.2);
    expect(orbit).toBeLessThan(0.8);
    expect(nearFade(0.15, look.far[1] + 1, look.far)).toBe(0);
  });
});

describe('createEmbers (#54, Sizzle)', () => {
  it('is one mesh for Sizzle, and nothing for worlds without lava', () => {
    const e = createEmbers(sizzle, { x: 1, y: 0, z: 0 });
    expect(e.count).toBe(count);
    expect(e.mesh.geometry.instanceCount).toBe(count);
    for (const id of ['homestead', 'pebble', 'misty', 'dusty']) expect(createEmbers(sys.byId[id], null)).toBeNull();
  });

  it('keeps its clock and foci without allocating', () => {
    const e = createEmbers(sizzle, { x: 1, y: 0, z: 0 });
    const u = e.mesh.material.uniforms;
    const vecs = [...u.foci.value];
    e.update(1234.5);
    expect(u.time.value).toBe(1234.5);
    e.fade(new Float64Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), 2);
    expect(u.nFoci.value).toBe(2);
    expect(u.foci.value[1].toArray()).toEqual([4, 5, 6]);
    expect(u.foci.value.every((v, i) => v === vecs[i])).toBe(true);
    e.fade(new Float64Array(12), 4); // more than it has room for: only the first three
    expect(u.nFoci.value).toBe(3);
  });
});
