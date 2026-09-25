import { describe, it, expect } from 'vitest';
import { gotoTrip, tour } from './missions.js';

// A few trips from the stress sweep (`npm run stress`) that used to go wrong: missing a
// burn and looping into a moon, bumping into a moon on the way in, braking too hard on a
// tiny moon, and parking across a moon's path. The full sweep runs every pair of worlds.
const trips = [
  ['autopilot', 'frosty', 'sizzle', 9133],
  ['autopilot', 'sizzle', 'nibble', 14555],
  ['autopilot', 'dusty', 'homestead', 19977],
  ['coach', 'homestead', 'dusty', 9133],
  ['coach', 'ringo', 'dusty', 9133],
  ['coach', 'nibble', 'pebble', 9133],
  ['coach', 'sizzle', 'dusty', 17266],
  ['coach', 'frosty', 'sizzle', 6422],
];

describe('take me there, stress subset', () => {
  for (const [who, from, to, t] of trips) {
    it(`${who}: ${from} to ${to} (t = ${t})`, () => {
      const r = gotoTrip(from, to, t, who === 'coach');
      expect(r.kind, r.detail).toBe('ok');
    }, 60000);
  }

  it('autopilot tour from the pad: Dusty, Sizzle, Nibble, Ringo', () => {
    const r = tour(['dusty', 'sizzle', 'nibble', 'ringo'], 2233, false);
    expect(r.kind, `${r.to}: ${r.detail}`).toBe('ok');
  }, 60000);

  it('coach tour from the pad: Pebble, then home (no parking across Pebble\'s path)', () => {
    const r = tour(['pebble', 'homestead'], 24762, true);
    expect(r.kind, `${r.to}: ${r.detail}`).toBe('ok');
  }, 60000);
});
