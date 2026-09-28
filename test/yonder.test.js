// Yonder (#62, stage 1): a little icy dwarf world like Pluto, far out past everything else. Its
// stretched orbit, never meeting Tumble; landing and driving on it; the map reaching it; 🤖 Take
// me there to it and back (and coached); and out there Ember's light dim and cold, and Ember a
// bright star, while every other world keeps its look. Stage 2: its heart (where it is and its
// shape), mountains (never in the way of landing or driving) and glaciers, the heart's churning
// cells and "find the heart", and its blue haze (only Yonder's, only the look).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSystem } from '../src/physics/bodies.js';
import { makeTerrain, SPIN_AXES, YONDER_HEART, YONDER_GLACIERS, heartAt, heartDir, heartDist } from '../src/physics/terrain.js';
import { DISCOVERIES, HEART_NEAR, HEART_SPOT, HEART_IN, HEART_VIEW, heartSeen, finds, buggyFinds, groundPoint, discoveryTargets } from '../src/physics/discoveries.js';
import { airOf } from '../src/physics/exhaust.js';
import { Buggy, vec } from '../src/physics/buggy.js';
import { BUGGIES } from '../src/rocket/parts.js';
import { STICKERS, GOALS } from '../src/progress.js';
import { ROCKY_LOOK, HEART_LOOK, HAZE_LAYERS, blueHazeAt, cellAt, richRocky } from '../src/world/richLook.js';
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
    expect(yonder.atmosphere).toBeUndefined(); // airless for the exhaust (#60): its blue haze is only the look (stage 2)
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

// ---- Stage 2: the heart, mountains, glaciers, finding the heart, the blue haze -----------------

const ter = makeTerrain('yonder');
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** Points on a grid over the heart's frame: [u, v, dir]. */
function heartGrid(step = 0.02, pad = 0.4) {
  const out = [];
  for (let u = -0.66 - pad; u <= 0.66 + pad; u += step) {
    for (let v = -pad; v <= 1.08 + pad; v += step) out.push([u, v, heartDir(u, v)]);
  }
  return out;
}

describe('Yonder\'s heart (#62 stage 2)', () => {
  it('is a two-lobed heart with a notch and a point', () => {
    // Its point, the two lobes, the notch between them, the sides.
    expect(heartDist(0, 0)).toBeCloseTo(0, 6);
    expect(heartDist(0, 0.05)).toBeLessThan(0);
    expect(heartDist(0, -0.05)).toBeGreaterThan(0);
    for (const x of [-0.3, 0.3]) expect(heartDist(x, 0.72)).toBeCloseTo(-0.36, 6);
    expect(heartDist(0, 0.98)).toBeGreaterThan(0); // the notch
    expect(heartDist(-0.3, 1.0)).toBeLessThan(0);
    expect(heartDist(0.3, 1.0)).toBeLessThan(0);
    expect(heartDist(0.7, 0.72)).toBeGreaterThan(0);
    // Mirror-symmetric, and narrowing to its point.
    for (let v = 0; v < 1.1; v += 0.1) expect(heartDist(-0.2, v)).toBeCloseTo(heartDist(0.2, v), 9);
    const width = (v) => { let w = 0; for (let u = 0; u < 1; u += 0.002) if (heartDist(u, v) < 0) w = u; return w; };
    expect(width(0.1)).toBeLessThan(width(0.3));
    expect(width(0.3)).toBeLessThan(width(0.6));
    // heartAt() and heartDir() undo each other.
    for (const [u, v] of [[0, 0.54], [-0.4, 0.9], [0.5, 0.2]]) {
      const d = heartDir(u, v);
      const h = heartAt(d.x, d.y, d.z);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
      expect(h.u).toBeCloseTo(u, 9);
      expect(h.v).toBeCloseTo(v, 9);
    }
  });

  it('is on the side the cameras see, all of it, upright on the map', () => {
    const H = YONDER_HEART;
    // Its middle faces the map's camera (+z), and none of it wraps over the edge seen from there.
    expect(H.c.z).toBeGreaterThan(0.7);
    let low = 1;
    for (const [u, v, d] of heartGrid(0.02, 0)) if (heartDist(u, v) < 0) low = Math.min(low, d.z);
    expect(low).toBeGreaterThan(0.25);
    // Its up is the map's up (world +y), so it's the right way up there.
    expect(H.up.y).toBeGreaterThan(0.9);
    expect(H.up.x * H.c.x + H.up.y * H.c.y + H.up.z * H.c.z).toBeCloseTo(0, 9);
    // Big, like Pluto's (Tombaugh Regio is about 1,600 km across; Pluto's radius 1,190 km).
    expect(1.32 * H.size).toBeGreaterThan(1.1);
  });

  it('is pale ice, much brighter than the ground round it, with a smooth low basin on the left', () => {
    let inL = 0, inN = 0, outL = 0, outN = 0, basinH = [], eastH = [];
    for (const [u, v, d] of heartGrid(0.02, 0.25)) {
      const sd = heartDist(u, v);
      const h = ter.height(d.x, d.y, d.z);
      const c = ter.color(d.x, d.y, d.z, h);
      const hr = ter.heart(d.x, d.y, d.z);
      if (sd < -0.08) { inL += lum(c); inN++; }
      if (sd > 0.1 && sd < 0.25) { outL += lum(c); outN++; }
      if (hr.basin > 0.99 && hr.glacier === 0) basinH.push(h);
      if (hr.east > 0.99 && hr.glacier === 0) eastH.push(h);
      // The cells only in the basin, the flow lines only on glaciers.
      const mk = ter.marks(d.x, d.y, d.z, [0, 0, 0, 0, 0]);
      if (mk[2] > 0.01) expect(hr.basin).toBeGreaterThan(0);
      if (mk[3] > 0.01) expect(hr.in).toBeGreaterThan(0);
    }
    expect(inL / inN).toBeGreaterThan(1.6 * (outL / outN));
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const spread = (a) => Math.max(...a) - Math.min(...a);
    expect(basinH.length).toBeGreaterThan(100);
    expect(mean(basinH)).toBeLessThan(mean(eastH) - 1.5); // the left lobe is lower
    expect(spread(basinH)).toBeLessThan(0.4); // and smooth
  });

  it('has glaciers flowing from the right lobe\'s uplands down into the basin', () => {
    expect(YONDER_GLACIERS.length).toBeGreaterThanOrEqual(3);
    for (const g of YONDER_GLACIERS) {
      const at = (s) => heartDir(g.a[0] + g.f[0] * g.len * s, g.a[1] + g.f[1] * g.len * s);
      const top = at(0.2), snout = at(0.9); // (its source fades in over the first tenth)
      expect(ter.heart(top.x, top.y, top.z).glacier).toBeGreaterThan(0.9);
      expect(ter.heart(snout.x, snout.y, snout.z).glacier).toBeGreaterThan(0.9);
      expect(ter.heart(snout.x, snout.y, snout.z).basin).toBeGreaterThan(0.9); // it ends out on the plain
      expect(ter.height(top.x, top.y, top.z) - ter.height(snout.x, snout.y, snout.z)).toBeGreaterThan(1.5);
      // Downhill all the way (no step up or down along it).
      let last = Infinity;
      for (let s = 0.05; s <= 0.95; s += 0.05) {
        const d = at(s);
        const h = ter.height(d.x, d.y, d.z);
        expect(h).toBeLessThan(last + 0.1);
        last = h;
      }
    }
  });

  it('has tall ice mountains along the basin\'s west side, well away from the landing strip', () => {
    expect(ter.peaks.length).toBeGreaterThanOrEqual(4);
    for (const p of ter.peaks) {
      const h = ter.height(p.x, p.y, p.z);
      expect(h).toBeGreaterThan(6); // tall (the plains are a metre or two)
      expect(Math.asin(p.z) * yonder.radius).toBeGreaterThan(40); // clear of the flight plane
      const hp = heartAt(p.x, p.y, p.z);
      expect(hp.u).toBeLessThan(0); // on the west (left) side
      expect(heartDist(hp.u, hp.v)).toBeGreaterThan(0); // just outside the heart
      expect(heartDist(hp.u, hp.v)).toBeLessThan(0.2);
      expect(ter.bare(p.x, p.y, p.z)).toBe(true); // no boulders on them
    }
  });

  it('keeps the ground by the flight plane gentle: no walls where the rocket lands or the buggy rolls out', () => {
    // Within 25 m either side of the plane, all round: slopes under 25 degrees.
    const R = yonder.radius, e = 1 / R;
    let worst = 0;
    for (let i = 0; i < 720; i++) {
      const a = (i / 720) * Math.PI * 2;
      for (let zm = -25; zm <= 25; zm += 5) {
        const z = zm / R, k = Math.sqrt(1 - z * z);
        const at = (da, dz) => { const zz = z + dz, kk = Math.sqrt(1 - zz * zz); return ter.height(kk * Math.cos(a + da / k), kk * Math.sin(a + da / k), zz); };
        const sa = (at(e, 0) - at(-e, 0)) / 2, sz = (at(0, e) - at(0, -e)) / 2;
        worst = Math.max(worst, Math.atan(Math.hypot(sa, sz)) * 180 / Math.PI);
      }
    }
    expect(worst).toBeLessThan(25);
  });

  it('a buggy drives from the landing strip onto the heart, and past the mountains, never stuck', () => {
    const ctx = { time: 0, toSun: { x: 1, y: 0, z: 0 }, has: () => false };
    for (const [from, to] of [[HEART_NEAR, HEART_NEAR], [ter.peaks.at(-1), ter.peaks.at(-1)]]) {
      const a = Math.atan2(from.y, from.x);
      for (const kind of ['rover', 'truck', 'hopper']) {
        const b = new Buggy(yonder, BUGGIES[kind]);
        b.spawn([Math.cos(a), Math.sin(a), 0], [0, 0, 1]); // on the plane, facing the heart / mountain
        let found = null, moved = 0, last = b.up;
        for (let i = 0; i < 60 * 40 && !found; i++) {
          b.step(1 / 60, { throttle: 1, steer: 0 });
          moved += Math.acos(Math.min(1, vec.dot(b.up, last))) * yonder.radius;
          last = b.up;
          if (to === HEART_NEAR) found = buggyFinds(yonder, b, ctx);
        }
        if (to === HEART_NEAR) expect(found, kind).toBe('find-heart');
        else expect(moved, kind).toBeGreaterThan(40); // up to the mountain and on, round it or over
      }
    }
  });
});

describe('finding the heart (#62 stage 2)', () => {
  it('is a discovery on Yonder with a sticker and a Pluto fact', () => {
    const d = DISCOVERIES.find((x) => x.id === 'find-heart');
    expect(d.world).toBe('yonder');
    const st = STICKERS['find-heart'];
    expect(st.say).toContain('Tombaugh');
    expect(st.say).toContain('lava lamp');
    expect(st.hint).toBeTruthy();
    // The compass points at its edge nearest the flight plane, just inside it.
    const h = heartAt(HEART_NEAR.x, HEART_NEAR.y, HEART_NEAR.z);
    expect(heartDist(h.u, h.v)).toBeLessThan(-HEART_IN);
    expect(discoveryTargets(yonder, { time: 0, toSun: { x: 1, y: 0, z: 0 }, has: () => false }).map((t) => t.id)).toEqual(['find-heart']);
  });

  it('is found driving onto it, not beside it or flying over it', () => {
    const d = DISCOVERIES.find((x) => x.id === 'find-heart');
    const who = (dir, lift = 0) => ({ p: groundPoint(yonder, dir, lift), stopped: false, time: 0, toSun: { x: 1, y: 0, z: 0 } });
    expect(finds(d, yonder, who(HEART_SPOT, 0.5))).toBe(true);
    expect(finds(d, yonder, who(HEART_NEAR, 0.5))).toBe(true);
    expect(finds(d, yonder, who(HEART_SPOT, 30))).toBe(false);
    expect(finds(d, yonder, who(heartDir(0.9, 0.5), 0.5))).toBe(false);
    expect(finds(d, yonder, who(heartDir(0, -0.1), 0.5))).toBe(false);
  });

  it('is found seeing it: on screen, facing us and big enough to make out', () => {
    const view = (extra = {}) => ({ x: -0.2, y: 0.3, behind: false, facing: 0.7, px: 60, ...extra });
    expect(heartSeen(view())).toBe(true);
    expect(heartSeen(view({ px: HEART_VIEW.px - 1 }))).toBe(false);
    expect(heartSeen(view({ facing: 0.2 }))).toBe(false);
    expect(heartSeen(view({ behind: true }))).toBe(false);
    expect(heartSeen(view({ x: 0.9 }))).toBe(false);
    expect(heartSeen(view({ y: -0.7 }))).toBe(false);
  });

  // The real FlightScene.heartInView() with the real map camera (as in mapView.test.js).
  it('from the map zoomed in on Yonder, but not the default map, nor from its far side', () => {
    globalThis.window ??= {};
    Object.assign(globalThis.window, { innerWidth: 844, innerHeight: 390 });
    const m = parkAt(mission(), 'yonder', 600, 1);
    const s = Object.create(FlightScene.prototype);
    s.app = { progress: { settings: {}, has: () => true, explained: () => true, markExplained() {}, earn() {} }, pip: () => true, afterPip() {}, audio: { play() {}, setMood() {} }, hud: { showTarget() {} } };
    Object.assign(s, {
      flight: m.flight, autopilot: m.ap, system: m.sys, time: 0, crashed: false, target: null, mode: 'flight', pause: null, clock: null,
      input: { left: false, right: false, go: false, fine: false }, warpIndex: 0, manualWarp: false,
      snapshots: [], snapTimer: 0, predTimer: 0, prediction: null, origin: { x: 0, y: 0 }, tmp: {}, tmp2: {}, tmp3: {}, kindAt: {},
      mapAt: { x: 0, y: 0 }, mapOff: { x: 0, y: 0 }, mapGoalAt: { x: 0, y: 0 }, mapDist: 2000, zoom: 1, carry: 1, camSettle: false, soiGlow: null,
      camera: new THREE.PerspectiveCamera(50, 844 / 390, 1, 3e6), camUp: new THREE.Vector3(0, 1, 0), rocket: { height: 6 },
      drive: { active: false, cancel() {} }, showing: null,
    });
    const group = new THREE.Group();
    s.visuals = [{ body: yonder, group }];
    const look = () => {
      const rw = s.flight.worldPos({});
      s.placeOrigin(rw);
      s.updateCamera(0);
      s.camera.updateMatrixWorld();
      const w = yonder.worldPos(s.flight.state.t, {});
      group.position.set(w.x - s.origin.x, w.y - s.origin.y, 0);
      group.scale.setScalar(s.mapScale(yonder));
      return s.heartInView();
    };
    s.toggleMap();
    s.focusMapOn(yonder);
    expect(look()).toBe(false); // the default map: Yonder a small ball in its big sphere of influence
    s.mapDist = 1500; // zoomed in (the map's own limits allow it)
    expect(s.mapLimits()[0]).toBeLessThan(1500);
    expect(look()).toBe(true);
    // In the flight view from the far side of Yonder, zoomed out: its heart faces away.
    const far = parkAt(mission(), 'yonder', 600, Math.atan2(YONDER_HEART.c.y, YONDER_HEART.c.x) + Math.PI);
    s.flight = far.flight;
    s.mode = 'flight';
    s.zoom = 3;
    expect(look()).toBe(false);
  });
});

describe('the heart\'s churning cells (#62 stage 2)', () => {
  const hash = (i, j) => { const f = (x) => { const s = Math.sin(x) * 43758.5453; return s - Math.floor(s); }; return [f(i * 12.9898 + j * 78.233), f(i * 39.3468 + j * 11.135)]; };
  it('are only in Yonder\'s ground shader', () => {
    for (const b of sys.bodies) {
      const look = ROCKY_LOOK[b.id];
      if (!look) continue;
      expect(!!look.heart, b.id).toBe(b.id === 'yonder');
      expect(!!b.terrainFn.marks, b.id).toBe(b.id === 'yonder');
      const mat = richRocky(new THREE.MeshToonMaterial({ vertexColors: true }), b, new THREE.Vector3(1, 0, 0));
      const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: THREE.ShaderLib.toon.fragmentShader };
      mat.onBeforeCompile(shader);
      const has = b.id === 'yonder';
      expect(shader.fragmentShader.includes('rlCell'), b.id).toBe(has);
      expect(shader.vertexShader.includes('heartMark'), b.id).toBe(has);
      expect(mat.customProgramCacheKey().includes('RL_HEART'), b.id).toBe(has);
    }
  });

  it('churn slowly, and come round again with no jump when the clock wraps', () => {
    const L = HEART_LOOK;
    let changed = 0;
    for (let i = 0; i < 200; i++) {
      const q = [i * 0.137, i * 0.291];
      const a = cellAt(q, 0, hash), b = cellAt(q, L.churn, hash), c = cellAt(q, L.churn / 4, hash);
      expect(b.edge).toBeCloseTo(a.edge, 9);
      expect(a.edge).toBeGreaterThanOrEqual(0);
      if (Math.abs(c.edge - a.edge) > 0.05) changed++;
      // Slowly: a second later, nearly the same.
      expect(Math.abs(cellAt(q, 1, hash).edge - a.edge)).toBeLessThan(0.02);
    }
    expect(changed).toBeGreaterThan(50);
    // A cell's middle wanders less than half a cell, so the pattern stays cells.
    expect(L.drift).toBeLessThan(0.5);
    // Cells tens of metres across at most: many over the basin.
    expect(L.cell).toBeGreaterThan(6);
    expect(L.cell).toBeLessThan(25);
  });
});

describe('Yonder\'s blue haze (#62 stage 2)', () => {
  const look = HAZE_LAYERS.yonder;
  it('is only Yonder\'s, and only the look: still no air for the exhaust', () => {
    expect(Object.keys(HAZE_LAYERS)).toEqual(['yonder']);
    expect(yonder.atmosphere).toBeUndefined();
    expect(airOf(yonder)).toBe(null);
  });

  it('is a thin ring at the edge in a few layers, none over the ground', () => {
    expect(blueHazeAt(look, 0.5)).toBe(0);
    expect(blueHazeAt(look, 0.97)).toBe(0);
    expect(blueHazeAt(look, 1.005)).toBeGreaterThan(0.1);
    expect(blueHazeAt(look, look.shell)).toBe(0);
    // Separate layers: brighter on each than just between them.
    expect(look.layers.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < look.layers.length; i++) {
      const [at, w] = look.layers[i];
      const gap = (look.layers[i - 1][0] + at) / 2;
      expect(blueHazeAt(look, at)).toBeGreaterThan(blueHazeAt(look, gap) * 1.5);
      expect(at - w * 2).toBeGreaterThan(1 + look.hug[0] * 0.5);
      expect(at + w).toBeLessThan(look.shell);
    }
  });

  it('never gets thinner than a pixel and a half (no shimmer), and dims as it widens', () => {
    const [at, w0] = look.layers[1];
    const wide = 0.02; // radii per pixel: Yonder small on screen
    const sum = (px) => { let a = 0; for (let s = at - 0.1; s < at + 0.1; s += 0.0001) a += blueHazeAt({ ...look, hug: [0.001, 0], layers: [look.layers[1]] }, s, px); return a; };
    expect(blueHazeAt(look, at + 1.2 * wide, wide)).toBeGreaterThan(0); // spread over the pixels
    expect(sum(wide)).toBeCloseTo(sum(0), 0);
    expect(w0).toBeLessThan(wide);
  });

  it('is brightest backlit', () => {
    const s = look.layers[0][0];
    expect(blueHazeAt(look, s, 0, 1)).toBeGreaterThan(3 * blueHazeAt(look, s, 0, 0));
    expect(blueHazeAt(look, s, 0, -1)).toBe(blueHazeAt(look, s, 0, 0));
  });
});
