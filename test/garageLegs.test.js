// Legs on the garage (#42): the garage can hold legs (only legs: anything else would block the
// door), and the ramp still reaches the ground however high the garage sits.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { holdsRadial, rocketStats } from '../src/rocket/parts.js';
import { buildRocket } from '../src/rocket/rocketMesh.js';

// Plain paints: the wood texture needs a canvas, which the tests don't have.
const garage = (radial) => ({ type: 'garage', paint: 'teal', buggy: { kind: 'hopper', paint: 'navy' }, ...(radial && { radial: { type: radial, paint: 'mustard' } }) });

/** Height above the ground of the open ramp's far end (the rocket's origin is the ground). */
function rampEnd(design) {
  const rocket = buildRocket(design);
  let ramp;
  rocket.group.traverse((o) => o.userData.ramp && (ramp = o));
  ramp.rotation.x = ramp.userData.rampTilt; // open, as the drive scene sets it
  rocket.group.updateMatrixWorld(true);
  return ramp.localToWorld(new THREE.Vector3(0, 0, 1.6)).y;
}

describe('legs on the garage (#42)', () => {
  it('the garage holds legs, and nothing else', () => {
    expect(holdsRadial('garage', 'legs')).toBe(true);
    for (const r of ['fins', 'boosters', 'lights']) expect(holdsRadial('garage', r)).toBe(false);
    for (const p of ['tube', 'bigtube', 'capsule']) expect(holdsRadial(p, 'fins')).toBe(true);
    expect(holdsRadial('engine', 'legs')).toBe(false);
  });

  it('legs on the garage count as landing legs', () => {
    const stack = [{ type: 'capsule', paint: 'cream' }, { type: 'engine', paint: 'navy' }, garage('legs')];
    expect(rocketStats({ stack }).legs).toBe(true);
  });

  it('the open ramp reaches the ground, with or without legs, wherever the garage is', () => {
    const top = [{ type: 'nose', paint: 'orange' }, { type: 'capsule', paint: 'cream' }];
    const designs = [
      [...top, { type: 'engine', paint: 'navy' }, garage('legs')], // at the bottom, on legs
      [...top, { type: 'engine', paint: 'navy' }, garage()], // at the bottom, on the ground
      [...top, garage(), { type: 'tube', paint: 'teal', radial: { type: 'legs', paint: 'mustard' } }, { type: 'bigengine', paint: 'navy' }], // higher up
    ];
    for (const stack of designs) expect(Math.abs(rampEnd({ stack }))).toBeLessThan(0.25);
  });
});
