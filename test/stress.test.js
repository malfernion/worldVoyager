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
  // Leaving big Tumble too fast went backwards round Ember and met Dusty head-on (#11).
  ['coach', 'tumble', 'dusty', 11844],
  // Arriving at Ringo the wrong way round, low: turning round used to drop us into the clouds.
  ['coach', 'tumble', 'sizzle', 19977],
  // The longest route (up, across, down) ran out of tries just as it reached Nibble.
  ['autopilot', 'flip', 'nibble', 19977],
  ['coach', 'flip', 'nibble', 3711],
  // Racing after the comet close to Ember dived into the star (#13).
  ['autopilot', 'sizzle', 'ducky', 9133],
  ['coach', 'tumble', 'ducky', 25399],
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

  // The longest trips, and the backwards moon (#11).
  it('autopilot tour from the pad: Tumble, Flip, Frosty, then home', () => {
    const r = tour(['tumble', 'flip', 'frosty', 'homestead'], 3100, false);
    expect(r.kind, `${r.to}: ${r.detail}`).toBe('ok');
  }, 60000);

  it('coach tour from the pad: Flip, Ringo, Tumble, Dusty', () => {
    const r = tour(['flip', 'ringo', 'tumble', 'dusty'], 8200, true);
    expect(r.kind, `${r.to}: ${r.detail}`).toBe('ok');
  }, 60000);

  // Catching the comet, landing on it (coach), and leaving it again (#13). A lopsided orbit
  // round it used to dip so low over the duck's lumps that a push on the way out hit them.
  it('coach tour from the pad: Ringo, Dusty, Ducky, Sizzle', () => {
    const r = tour(['ringo', 'dusty', 'ducky', 'sizzle'], 10898, true);
    expect(r.kind, `${r.to}: ${r.detail}`).toBe('ok');
  }, 60000);

  it('coach tour from the pad: Pebble, then home (no parking across Pebble\'s path)', () => {
    const r = tour(['pebble', 'homestead'], 24762, true);
    expect(r.kind, `${r.to}: ${r.detail}`).toBe('ok');
  }, 60000);
});
