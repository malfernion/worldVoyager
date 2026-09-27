// #51 / #52: the baked relief shading darkens hollows and lightens ridges, and leaves smooth
// ground alone; and its `rich` weights fade it out under a sea.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { reliefShade, bakeRelief } from '../src/world/richLook.js';

// A closed sphere mesh (like a world's), with each vertex's unit direction.
function sphere(detail = 12) {
  let geo = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const n = geo.attributes.position.count;
  const dirs = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(geo.attributes.position, i).normalize();
    dirs.set([v.x, v.y, v.z], i * 3);
  }
  return { geo, n, dirs };
}
const dot = (dirs, i, v) => dirs[i * 3] * v.x + dirs[i * 3 + 1] * v.y + dirs[i * 3 + 2] * v.z;
const nearest = (dirs, n, v) => {
  let best = 0;
  for (let i = 1; i < n; i++) if (dot(dirs, i, v) > dot(dirs, best, v)) best = i;
  return best;
};

describe('reliefShade (#51)', () => {
  const { geo, n, dirs } = sphere();
  const PIT = { x: 1, y: 0, z: 0 }, HILL = { x: -1, y: 0, z: 0 }, FLAT = { x: 0, y: 0, z: 1 };
  const bump = (i, v, h) => h * Math.exp(-((1 - dot(dirs, i, v)) / 0.02));
  const heights = new Float32Array(n).map((_, i) => bump(i, PIT, -4) + bump(i, HILL, 4));
  const shade = reliefShade(heights, geo.index.array);

  it('darkens the bottom of a hollow and lightens the top of a hill', () => {
    expect(shade[nearest(dirs, n, PIT)]).toBeLessThan(0.9);
    expect(shade[nearest(dirs, n, HILL)]).toBeGreaterThan(1.05);
  });

  it('leaves smooth ground about as it was', () => {
    expect(Math.abs(shade[nearest(dirs, n, FLAT)] - 1)).toBeLessThan(0.03);
  });

  it('stays within its limits', () => {
    for (const s of shade) {
      expect(s).toBeGreaterThanOrEqual(1 - 0.3 - 1e-6);
      expect(s).toBeLessThanOrEqual(1 + 0.14 + 1e-6);
    }
  });
});

describe('bakeRelief (#52)', () => {
  it('leaves seabeds under a sea alone', () => {
    // Homestead's sea is at -1.5 m.
    const { geo, n, dirs } = sphere();
    const heights = new Float32Array(n).map((_, i) => 6 * Math.sin(dirs[i * 3] * 9) - 3);
    const colors = new Float32Array(n * 3).fill(0.5);
    bakeRelief({ id: 'homestead', liquid: { level: -1.5 } }, geo, heights, dirs, colors);
    const rich = geo.attributes.rich.array;
    for (let i = 0; i < n; i++) {
      if (heights[i] < -2.5) {
        expect(rich[i]).toBe(0);
        expect(colors[i * 3]).toBe(0.5);
      }
      if (heights[i] > 0) expect(rich[i]).toBe(1);
    }
  });
});

describe('reliefShade softening (#56)', () => {
  it('shades a single-vertex dip as a soft blob, not one dark vertex', () => {
    const { geo, n, dirs } = sphere();
    const at = nearest(dirs, n, { x: 0, y: 1, z: 0 });
    const heights = new Float32Array(n);
    heights[at] = -1;
    const hard = reliefShade(heights, geo.index.array, { soften: 0 });
    const soft = reliefShade(heights, geo.index.array);
    // The dip itself is darkened less sharply...
    expect(1 - soft[at]).toBeLessThan(1 - hard[at]);
    // ...and its neighbours share it.
    const idx = geo.index.array;
    let nb = -1;
    for (let f = 0; f < idx.length && nb < 0; f += 3) for (let e = 0; e < 3; e++) if (idx[f + e] === at) nb = idx[f + ((e + 1) % 3)];
    expect(soft[nb]).toBeLessThan(1);
    expect(Math.abs(soft[at] - soft[nb])).toBeLessThan(Math.abs(hard[at] - hard[nb]));
  });
});
