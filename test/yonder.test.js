// Yonder (#62, stage 1): a little icy dwarf world like Pluto, far out past everything else. Its
// stretched orbit, never meeting Tumble; landing and driving on it; the map reaching it; 🤖 Take
// me there to it and back (and coached); and out there Ember's light dim and cold, and Ember a
// bright star, while every other world keeps its look.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSystem } from '../src/physics/bodies.js';
import { makeTerrain, SPIN_AXES } from '../src/physics/terrain.js';
import { Buggy, vec } from '../src/physics/buggy.js';
import { BUGGIES } from '../src/rocket/parts.js';
import { STICKERS, GOALS } from '../src/progress.js';
import { ROCKY_LOOK } from '../src/world/richLook.js';
import { farLight, FAR_LIGHT } from '../src/world/planets.js';
import { FlightScene } from '../src/scenes/flight.js';
import { SYSTEM_EXTENT, SYSTEM_VIEW, mapZoomLimits, fitDist } from '../src/ui/zoom.js';
import { mission, parkAt, gotoTrip, flyTo, STATS } from './missions.js';

globalThis.document ??= { getElementById: () => null };

const sys = createSystem();
const { yonder, tumble, ember } = sys.byId;

/** The farthest from Ember a body's sphere of influence ever reaches (its parent's farthest, plus its own). */
function reach(b) {
  let r = b.apoapsis + (Number.isFinite(b.soi) ? b.soi : 0);
  for (let p = b.parent; p && p.parent; p = p.parent) r += p.apoapsis;
  return r;
}

describe('Yonder\'s orbit (#62)', () => {
  it('is a stretched orbit round Ember, twice as far out as Tumble on average', () => {
    expect(yonder.parent).toBe(ember);
    expect(yonder.orbitRadius).toBe(110000);
    expect(yonder.periapsis).toBeCloseTo(80000);
    expect(yonder.apoapsis).toBeCloseTo(140000);
    expect(yonder.orbitRadius / tumble.orbitRadius).toBeGreaterThan(1.9);
    // One lap about 6.4 game hours; everything else round Ember is much quicker.
    expect(yonder.orbitalPeriod).toBeGreaterThan(22000);
    expect(yonder.orbitalPeriod).toBeLessThan(24000);
    for (const b of ember.children) if (b !== yonder) expect(b.orbitalPeriod).toBeLessThan(yonder.orbitalPeriod / 2);
    expect(yonder.dwarf).toBe(true);
    expect(yonder.orbitDir).toBe(-1);
  });

  it('is sensibly placed at the start: on its way in, left of Ember, clear of Tumble', () => {
    const p = yonder.worldPos(0), q = tumble.worldPos(0);
    const r = Math.hypot(p.x, p.y);
    expect(r).toBeGreaterThan(85000);
    expect(r).toBeLessThan(95000);
    expect(p.x).toBeLessThan(0);
    expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(40000);
    // Coming in: nearer a little later.
    const later = yonder.worldPos(1000);
    expect(Math.hypot(later.x, later.y)).toBeLessThan(r);
  });

  it('never meets Tumble (or anything else) over many laps', () => {
    // Closest in is still well outside everything else's reach.
    for (const b of sys.bodies) {
      if (b === yonder || b === ember) continue;
      expect(yonder.periapsis - yonder.soi - reach(b), b.id).toBeGreaterThan(10000);
    }
    // And step it: 50 laps, never within both SOIs (plus a big margin) of Tumble.
    let closest = Infinity;
    const a = {}, b = {};
    for (let t = 0; t < yonder.orbitalPeriod * 50; t += 25) {
      yonder.worldPos(t, a);
      tumble.worldPos(t, b);
      closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
    }
    expect(closest).toBeGreaterThan(tumble.soi + yonder.soi + 10000);
    expect(closest).toBeLessThan(26000); // still "comes in near Tumble's orbit", like Pluto near Neptune's
  });

  it('its SOI is big enough to go round and small enough to stay its own', () => {
    expect(yonder.soi).toBeGreaterThan(yonder.radius * 12);
    // Well inside the Laplace sphere even at its closest (a(m/M)^0.4).
    expect(yonder.soi).toBeLessThan(yonder.periapsis * (yonder.mu / ember.mu) ** 0.4);
  });
});

describe('Yonder, the world (#62)', () => {
  it('is solid, dry, gentle and landable all round the flight plane', () => {
    expect(yonder.solid).toBe(true);
    expect(yonder.liquid).toBe(null);
    expect(yonder.atmosphere).toBeUndefined(); // airless for the exhaust (#60): the blue haze comes later
    expect(yonder.maxSurface - yonder.radius).toBeLessThan(6);
    expect(yonder.radius - yonder.minSurface).toBeLessThan(4);
    for (let i = 0; i < 360; i++) expect(yonder.landableAt((i / 360) * Math.PI * 2)).toBe(true);
    // A little bigger than Frosty, gentle gravity.
    expect(yonder.radius).toBeGreaterThan(sys.byId.frosty.radius);
    expect(yonder.gravity).toBeLessThan(3);
  });

  it('has pale ice plains and dark reddish lands round its middle, with a few craters in the dark', () => {
    const t = makeTerrain('yonder');
    const ax = SPIN_AXES.yonder;
    let dark = 0, darkMid = 0, mid = 0, n = 0;
    for (let i = 0; i < 4000; i++) {
      const z = ((i * 0.618034) % 1) * 2 - 1, a = i * 2.39996, k = Math.sqrt(1 - z * z);
      const x = k * Math.cos(a), y = k * Math.sin(a);
      const th = t.tholin(x, y, z) > 0.5;
      n++;
      if (th) dark++;
      if (Math.abs(x * ax.x + y * ax.y + z * ax.z) < 0.3) {
        mid++;
        if (th) darkMid++;
      }
      const c = t.color(x, y, z, t.height(x, y, z));
      if (th) expect(c[0]).toBeGreaterThan(c[2]); // reddish
    }
    expect(dark / n).toBeGreaterThan(0.12);
    expect(dark / n).toBeLessThan(0.4);
    expect(darkMid / mid).toBeGreaterThan((dark / n) * 1.5); // a belt round the middle
    expect(t.pits.length).toBeGreaterThanOrEqual(3);
    // Near the poles it's pale.
    const pole = t.color(ax.x, ax.y, ax.z, t.height(ax.x, ax.y, ax.z));
    expect(Math.min(...pole)).toBeGreaterThan(0.8);
  });

  it('has its stickers (not goals), a Pluto fact and its own icons, and the richer look', () => {
    expect(STICKERS['visit-yonder'].say).toContain('Ember');
    expect(STICKERS['land-yonder']).toBeTruthy();
    expect(yonder.blurb).toContain('Pluto');
    expect(GOALS.some((g) => g.id.endsWith('-yonder'))).toBe(false);
    const icons = Object.values(STICKERS).map((s) => s.icon);
    for (const id of ['visit-yonder', 'land-yonder']) expect(icons.filter((x) => x === STICKERS[id].icon).length, id).toBe(1);
    expect(ROCKY_LOOK.yonder).toBeTruthy();
  });

  it('the autopilot lands on it from all round a parking orbit', () => {
    for (let k = 0; k < 6; k++) {
      const m = parkAt(mission(), 'yonder', 500, (k / 6) * Math.PI * 2);
      expect(m.run('land')).toBe(true);
      expect(m.flight.state.landed, `from ${k}`).toBe(true);
      expect(m.flight.state.crashed).toBe(false);
    }
  });

  it('a buggy drives a long way across it, and never leaves the ground for long', () => {
    for (const kind of ['rover', 'truck', 'hopper']) {
      const b = new Buggy(yonder, BUGGIES[kind]);
      b.spawn([0, 1, 0], [0, 0, 1]);
      let travelled = 0, last = b.up, air = 0, maxAir = 0;
      for (let i = 0; i < 60 * 60; i++) {
        b.step(1 / 60, { throttle: 1, steer: i % 600 < 200 ? 0.4 : 0 });
        travelled += Math.acos(Math.min(1, vec.dot(b.up, last))) * yonder.radius;
        last = b.up;
        air = b.grounded === false ? air + 1 : 0;
        maxAir = Math.max(maxAir, air);
      }
      expect(travelled, kind).toBeGreaterThan(200);
      expect(maxAir / 60, kind).toBeLessThan(6);
    }
  });
});

describe('the map reaches Yonder (#62)', () => {
  it('zooms out to its whole orbit; the default view stays the planets\'', () => {
    expect(SYSTEM_EXTENT).toBeGreaterThanOrEqual(yonder.apoapsis + yonder.soi);
    expect(SYSTEM_VIEW).toBe(63000);
    for (const aspect of [0.46, 1, 1.8]) {
      const [lo, hi] = mapZoomLimits(yonder.radius, 50, aspect);
      expect(hi).toBeGreaterThanOrEqual(fitDist(yonder.apoapsis, 50, aspect));
      expect(lo).toBeLessThan(fitDist(yonder.soi, 50, aspect));
    }
  });
});

describe('🤖 Take me there to Yonder and back (#62)', () => {
  it('the autopilot flies there from Homestead and home again', () => {
    for (const [from, to, t] of [['homestead', 'yonder', 1000], ['yonder', 'homestead', 9133], ['tumble', 'yonder', 5000]]) {
      const r = gotoTrip(from, to, t, false);
      expect(r.kind, `${from} to ${to}: ${r.detail}`).toBe('ok');
    }
  }, 60000);

  it('coached, the pretend kid flies there and back', () => {
    for (const [from, to, t] of [['homestead', 'yonder', 9133], ['yonder', 'homestead', 1000]]) {
      const r = gotoTrip(from, to, t, true);
      expect(r.kind, `${from} to ${to}: ${r.detail}`).toBe('ok');
    }
  }, 60000);

  it('from the pad to Yonder, then Pebble, with a slow-turning, just-strong-enough rocket', () => {
    const m = mission({ ...STATS, accel: 10.6, turnRate: 0.7 });
    m.flight.resetToPad(3000);
    for (const to of ['yonder', 'pebble']) {
      const r = flyTo(m, to, false);
      expect(r.kind, `${to}: ${r.detail}`).toBe('ok');
    }
  }, 60000);
});

describe('Ember from far away (#62)', () => {
  it('only Yonder is ever far enough out for it: every other world keeps its light', () => {
    for (const b of sys.bodies) {
      if (b === yonder || b === ember) continue;
      expect(farLight(reach(b)).k, b.id).toBe(0);
    }
    const f = farLight(yonder.periapsis - yonder.soi);
    expect(f.k).toBe(1);
    expect(f.sun).toBeLessThan(0.65);
    expect(f.core).toBeLessThan(0.5);
    // Dimmer still at its farthest; never dark.
    const far = farLight(yonder.apoapsis + yonder.soi);
    expect(far.sun).toBeLessThan(f.sun);
    expect(far.sun).toBeGreaterThan(0.3);
    expect(farLight(0)).toEqual({ k: 0, sun: 1, fill: 1, core: 1, glowA: 1, glowB: 1 });
  });

  // The real FlightScene.updateFarLight() on a stand-in for Ember's visual (as starVisual makes it).
  function scene() {
    const s = Object.create(FlightScene.prototype);
    const glow = (k) => { const g = new THREE.Sprite(); g.scale.setScalar(ember.radius * k); return g; };
    s.sunVisual = {
      body: ember, group: new THREE.Group(), light: new THREE.PointLight(0xfff0d8, 2.6, 0, 0),
      mesh: new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial({ color: 0xffd98a })), glows: [glow(3.2), glow(8)],
      glint: Object.assign(new THREE.Sprite(), { visible: false }),
    };
    s.hemi = new THREE.HemisphereLight(0x8a9cff, 0x2a1d30, 0.55);
    s.ambient = new THREE.AmbientLight(0x404060, 0.35);
    s.mode = 'flight';
    s.tmp3 = {};
    s.flight = { state: { t: 0 } };
    s.initFarLight();
    return s;
  }
  const lookOf = (s) => ({
    sun: s.sunVisual.light.intensity, colour: s.sunVisual.light.color.getHex(), hemi: s.hemi.intensity, ambient: s.ambient.intensity,
    disc: s.sunVisual.mesh.material.color.getHex(), core: s.sunVisual.mesh.scale.x, glows: s.sunVisual.glows.map((g) => g.scale.x),
    glint: s.sunVisual.glint.visible,
  });

  it('at every other world the light and Ember look exactly as before', () => {
    const s = scene();
    const before = lookOf(s);
    // Out to Yonder and back in, then round every other world (and its SOI's far edge).
    s.updateFarLight(yonder.worldPos(0));
    expect(lookOf(s)).not.toEqual(before);
    for (const b of sys.bodies) {
      if (b === yonder || b === ember) continue;
      for (const t of [0, 3000, 11000]) {
        const p = b.worldPos(t);
        const r = Math.hypot(p.x, p.y);
        const k = (r + (Number.isFinite(b.soi) ? b.soi : 0)) / r;
        s.updateFarLight({ x: p.x * k, y: p.y * k });
        expect(lookOf(s), b.id).toEqual(before);
      }
    }
  });

  it('at Yonder the light is dim and cold, and Ember a small white-hot star (the map shows it as usual)', () => {
    const s = scene();
    const before = lookOf(s);
    s.updateFarLight(yonder.worldPos(0));
    const at = lookOf(s);
    expect(at.sun).toBeLessThan(before.sun * 0.65);
    expect(at.hemi).toBeLessThan(before.hemi);
    const c = new THREE.Color(at.colour);
    expect(c.b).toBeGreaterThan(c.r); // cold, bluish
    expect(at.core).toBeLessThanOrEqual(FAR_LIGHT.core + 1e-9);
    expect(at.glows[1]).toBeLessThan(before.glows[1] * 0.3);
    expect([before.glint, at.glint]).toEqual([false, true]); // a bright star's glint
    // On the map framing Yonder: dim there too, but Ember drawn as usual.
    s.mode = 'map';
    s.mapFocus = yonder;
    s.updateFarLight({ x: 0, y: 0 });
    const map = lookOf(s);
    expect(map.sun).toBeLessThan(before.sun * 0.65);
    expect([map.core, map.glows, map.disc, map.glint]).toEqual([before.core, before.glows, before.disc, false]);
    // Framing Ember (or any other world): all as before.
    s.mapFocus = ember;
    s.updateFarLight({ x: 0, y: 0 });
    expect(lookOf(s)).toEqual(before);
  });
});
