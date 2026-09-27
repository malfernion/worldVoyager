// #54: Homestead's cloud layer: where the clouds go, when they fade, and their shadow map.
import { describe, it, expect } from 'vitest';
import { CLOUD_LOOK, PUFF_STRIDE, VEIL, cloudPlan, cloudFade, cubeDir, shadowFaces, SHADOW_N } from '../src/world/clouds.js';
import { createSystem } from '../src/physics/bodies.js';

const home = createSystem().byId.homestead;
const look = CLOUD_LOOK.homestead;
const plan = cloudPlan(look, home.radius);
const puffs = [];
for (let i = 0; i < plan.puffs.length; i += PUFF_STRIDE) {
  const [x, y, z, size, lift, cloud] = plan.puffs.subarray(i, i + PUFF_STRIDE);
  puffs.push({ x, y, z, size, lift, cloud, r: Math.hypot(x, y, z) });
}

describe('cloudPlan (#54)', () => {
  it('is the same every time', () => {
    expect(Array.from(cloudPlan(look, home.radius).puffs)).toEqual(Array.from(plan.puffs));
  });

  it('makes every cloud it was asked for', () => {
    const want = look.sky.count + look.plane.count + look.spread.front + look.spread.back;
    expect(plan.clouds.length).toBe(want);
    for (let c = 0; c < want; c++) expect(puffs.filter((p) => p.cloud === c).length).toBeGreaterThanOrEqual(look.puffs[0]);
  });

  it('puts clouds where the views look: the sky behind the pad, and round the flight plane', () => {
    const behind = plan.clouds.filter((c) => c.z > look.sky.z[0] - 1 && c.z < look.sky.z[1] + 1);
    const plane = plan.clouds.filter((c) => Math.abs(c.z) < 30);
    expect(behind.length).toBeGreaterThanOrEqual(look.sky.count);
    expect(plane.length).toBeGreaterThanOrEqual(look.plane.count);
    // All the way round, so one is never far from the pad whichever way the layer has turned.
    const lons = plane.map((c) => Math.atan2(c.y, c.x)).sort((a, b) => a - b);
    const gaps = lons.map((a, i) => (i ? a - lons[i - 1] : a + 2 * Math.PI - lons[lons.length - 1]));
    expect(Math.max(...gaps)).toBeLessThan(Math.PI / 2);
  });

  it('keeps them between the hills and the space line, on flat bases', () => {
    for (const p of puffs) {
      const c = plan.clouds[p.cloud];
      const base = p.r - p.lift;
      expect(Math.abs(base - c.base)).toBeLessThan(2); // (a cloud's base is flat to within a curve)
      expect(c.base - home.radius).toBeGreaterThanOrEqual(look.alt[0]);
      expect(c.base - home.radius).toBeLessThanOrEqual(look.alt[1]);
      expect(p.r + p.size - home.radius).toBeLessThan(home.spaceLine);
    }
  });

  it('lists the puffs far to near for the flight camera (+z)', () => {
    for (let i = 1; i < puffs.length; i++) expect(puffs[i].z).toBeGreaterThanOrEqual(puffs[i - 1].z);
  });

  it("gives each cloud a reach that covers all its puffs", () => {
    for (const p of puffs) {
      const c = plan.clouds[p.cloud];
      expect(Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) + p.size).toBeLessThanOrEqual(c.r + 1e-3);
    }
  });
});

describe('cloudFade (#54)', () => {
  // A cloud of reach 20 at the origin.
  const fade = (cam, foci = []) => cloudFade(0, 0, 0, 20, ...cam, Float64Array.from(foci.flat()), foci.length);

  it('shows a cloud seen from far away', () => {
    expect(fade([0, 0, 200])).toBe(1);
  });

  it('fades it out as the camera comes close, and hides it with the camera inside', () => {
    expect(fade([0, 0, 5])).toBe(0);
    expect(fade([0, 0, 30])).toBeGreaterThan(0);
    expect(fade([0, 0, 30])).toBeLessThan(fade([0, 0, 40]));
    expect(fade([0, 0, 50])).toBe(1);
  });

  it('turns it to a veil when it is between the camera and the rocket', () => {
    expect(fade([0, 0, 100], [[0, 0, -30]])).toBeCloseTo(VEIL);
    // ...or just off the line, still covering part of the rocket.
    expect(fade([0, 0, 100], [[12, 0, -30]])).toBeLessThan(0.6);
  });

  it('leaves it alone when it is behind the rocket or well off to the side', () => {
    expect(fade([0, 0, 100], [[0, 0, 40]])).toBe(1);
    expect(fade([0, 0, 100], [[80, 0, -30]])).toBe(1);
  });

  it('checks every focus (rocket, ground under it, buggy)', () => {
    expect(fade([0, 0, 100], [[80, 0, -30], [0, 0, -30]])).toBeCloseTo(VEIL);
  });
});

describe('the clouds\' shadow map (#54)', () => {
  it('has each cube face looking along its own axis', () => {
    const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    axes.forEach((a, f) => {
      const d = cubeDir(f, SHADOW_N / 2 - 0.5, SHADOW_N / 2 - 0.5, SHADOW_N);
      expect(d[0] * a[0] + d[1] * a[1] + d[2] * a[2]).toBeCloseTo(1, 3);
    });
  });

  // Look a direction up in the faces the way the GPU does (nearest texel).
  const faces = shadowFaces(plan.clouds, plan.puffs);
  const at = (x, y, z) => {
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    let f, sc, tc, m;
    if (ax >= ay && ax >= az) { m = ax; f = x > 0 ? 0 : 1; sc = x > 0 ? -z : z; tc = -y; }
    else if (ay >= az) { m = ay; f = y > 0 ? 2 : 3; sc = x; tc = y > 0 ? z : -z; }
    else { m = az; f = z > 0 ? 4 : 5; sc = z > 0 ? x : -x; tc = -y; }
    const px = Math.min(SHADOW_N - 1, Math.floor(((sc / m + 1) / 2) * SHADOW_N));
    const py = Math.min(SHADOW_N - 1, Math.floor(((tc / m + 1) / 2) * SHADOW_N));
    return faces[f][py * SHADOW_N + px] / 255;
  };

  it('is dark under every big puff and clear away from the clouds', () => {
    for (const p of puffs) if (p.size > 6) expect(at(p.x, p.y, p.z)).toBeGreaterThan(0.9);
    // Far from every cloud: nothing.
    let clear = 0, tried = 0;
    for (let i = 0; i < 400; i++) {
      const z = (i / 200) - 1 + 1 / 400, a = i * 2.39996;
      const k = Math.sqrt(1 - z * z), d = [k * Math.cos(a), k * Math.sin(a), z];
      const far = plan.clouds.every((c) => {
        const l = Math.hypot(c.x, c.y, c.z);
        return Math.acos((d[0] * c.x + d[1] * c.y + d[2] * c.z) / l) * l > c.r * 1.3;
      });
      if (!far) continue;
      tried++;
      if (at(...d) === 0) clear++;
    }
    expect(tried).toBeGreaterThan(100);
    expect(clear).toBe(tried);
  });
});
