// Pip's friends' look (#43): suited space travellers, more detailed than the old critters but
// still phone-friendly, and the same size, so they still fit round every campfire.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildFriend } from '../src/world/friendMesh.js';

const NAMES = ['mossy', 'bolt', 'crumb', 'toasty', 'flurry'];

const shown = (o) => {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
};

function measure(f) {
  let tris = 0, calls = 0;
  f.group.traverse((o) => {
    if (!o.isMesh || !shown(o)) return;
    calls++;
    if (!o.userData.isOutline) tris += o.geometry.attributes.position.count / 3;
  });
  return { tris, calls, box: new THREE.Box3().setFromObject(f.group) };
}

describe('friend looks (#43)', () => {
  for (const name of NAMES) {
    it(`${name} stands on the ground, about Pip-and-a-bit tall, on a phone-sized budget`, () => {
      const f = buildFriend(name);
      f.update(0, 'play');
      const { tris, calls, box } = measure(f);
      expect(box.min.y).toBeGreaterThan(-0.05); // feet (and the helmet) on the ground
      expect(box.min.y).toBeLessThan(0.05);
      const h = box.max.y - box.min.y;
      expect(h).toBeGreaterThan(name === 'crumb' ? 1.3 : 1.7);
      expect(h).toBeLessThan(2.3);
      expect(tris).toBeLessThan(10000);
      expect(calls).toBeLessThanOrEqual(6); // body, two arms, each with its ink
    });
  }

  it('waving swaps in the raised arm, and playing puts it away again', () => {
    const f = buildFriend('bolt');
    const arms = () => f.group.children[0].children.filter((c) => c.isGroup).map((g) => g.visible);
    f.update(1, 'wave');
    expect(arms()).toEqual([true, false, true]);
    f.update(1, 'play');
    expect(arms()).toEqual([true, true, false]);
  });
});
