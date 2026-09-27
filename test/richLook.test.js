// #51: the baked relief shading darkens hollows and lightens ridges, and leaves flat ground alone.
import { describe, it, expect } from 'vitest';
import { reliefShade } from '../src/world/richLook.js';

// A flat square grid of heights (N × N vertices, two triangles per cell).
function grid(N, heightAt) {
  const heights = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) heights[j * N + i] = heightAt(i, j);
  const index = [];
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      index.push(a, b, d, a, d, c);
    }
  }
  return { heights, index };
}

describe('reliefShade (#51)', () => {
  const N = 21;
  const bump = (cx, cy, h, r) => (i, j) => h * Math.exp(-((i - cx) ** 2 + (j - cy) ** 2) / (r * r));
  // A crater-like pit on the left, a hill on the right.
  const pit = bump(6, 10, -4, 2.5), hill = bump(15, 10, 4, 2.5);
  const { heights, index } = grid(N, (i, j) => pit(i, j) + hill(i, j));
  const shade = reliefShade(heights, index);
  const at = (i, j) => shade[j * N + i];

  it('darkens the bottom of a hollow and lightens the top of a hill', () => {
    expect(at(6, 10)).toBeLessThan(0.9);
    expect(at(15, 10)).toBeGreaterThan(1.05);
  });

  it('leaves flat ground about as it was', () => {
    expect(Math.abs(at(10, 2) - 1)).toBeLessThan(0.03);
  });

  it('stays within its limits', () => {
    for (const s of shade) {
      expect(s).toBeGreaterThanOrEqual(1 - 0.3 - 1e-6);
      expect(s).toBeLessThanOrEqual(1 + 0.14 + 1e-6);
    }
  });
});
