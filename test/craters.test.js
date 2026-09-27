// #56: crater rims read round on the mesh: the bowl, rim and ejecta join without slope jumps,
// at the same depth and rim height as before (landing sites and Nibble's crater unchanged).
import { describe, it, expect } from 'vitest';
import { craterProfile } from '../src/physics/terrain.js';

const slope = (d, e = 1e-5) => (craterProfile(d + e) - craterProfile(d - e)) / (2 * e);

describe('crater profile (#56)', () => {
  it('keeps its depth and rim height, and fades out at 1.6 radii', () => {
    expect(craterProfile(0)).toBeCloseTo(-1, 6);
    expect(craterProfile(1)).toBeCloseTo(0.35, 6);
    expect(craterProfile(1.6)).toBe(0);
    expect(craterProfile(3)).toBe(0);
  });

  it('has no creases: the slope is continuous everywhere, level at the middle and the crest', () => {
    for (let d = 0.01; d < 1.7; d += 0.01) expect(Math.abs(slope(d + 0.001) - slope(d - 0.001)), `d ${d}`).toBeLessThan(0.05);
    expect(Math.abs(slope(1))).toBeLessThan(1e-3);
    expect(Math.abs(slope(1.6))).toBeLessThan(1e-3);
  });

  it('rises all the way from the floor to the rim, then falls away', () => {
    for (let d = 0; d < 1; d += 0.01) expect(craterProfile(d + 0.01)).toBeGreaterThanOrEqual(craterProfile(d) - 1e-9);
    for (let d = 1; d < 1.6; d += 0.01) expect(craterProfile(d + 0.01)).toBeLessThanOrEqual(craterProfile(d) + 1e-9);
  });
});
