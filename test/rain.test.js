// #54 stage 4: Misty's drifting haze bands (and the detached haze layer), and its gentle methane
// rain: where the showers are and how they drift, their clouds and shafts, each drop's loop, the
// rings on the lakes, the sky down in a shower (the real FlightScene.updateHaze()), and every
// other world left as it was.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PUFF_STRIDE } from '../src/world/clouds.js';
import { STORM_LOOK, createStorms } from '../src/world/storms.js';
import { BAND_LOOK, bandAt, bandFrame, detachedAt, bandShader } from '../src/world/hazeBands.js';
import { RAIN_LOOK, RAIN_SOUND, showerAt, showerPlan, rainPlan, RAIN_STRIDE, dropLife, dropLoop, dropShown, groundFaces, groundSample, rainVolume, createRain, createShowers } from '../src/world/rain.js';
import { FlightScene } from '../src/scenes/flight.js';
import { hazeSky, SKY_LOOK, atmosphere } from '../src/world/planets.js';
import { createSystem } from '../src/physics/bodies.js';

globalThis.document ??= { getElementById: () => null };

const sys = createSystem();
const misty = sys.byId.misty;
const R = misty.radius;
const look = RAIN_LOOK.misty;
const bands = BAND_LOOK.misty;
const turn = ([x, y, z], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
const dirOf = (lon, z) => { const k = Math.sqrt(1 - z * z); return [k * Math.cos(lon), k * Math.sin(lon), z]; };

describe('every other world is left as it was (#54 stage 4)', () => {
  it('only Misty has haze bands and rain; Dusty keeps its storms', () => {
    expect(Object.keys(BAND_LOOK)).toEqual(['misty']);
    expect(Object.keys(RAIN_LOOK)).toEqual(['misty']);
    expect(STORM_LOOK.misty).toBeUndefined();
    for (const b of sys.bodies) {
      if (b.id === 'misty') continue;
      expect(createShowers(b, new THREE.Vector3())).toBeNull();
    }
    expect(createStorms(sys.byId.dusty, new THREE.Vector3()).layer.mesh.name).toBe('storms');
    expect(SKY_LOOK.homestead.storm).toBeUndefined();
  });

  it('a shell without bands is the plain additive glow, shader and all', () => {
    const plain = atmosphere(300, 0x9fd4ff, 1.4);
    const m = plain.material;
    expect(m.blending).toBe(THREE.AdditiveBlending);
    expect(m.uniforms.time).toBeUndefined();
    expect(m.fragmentShader).toContain('gl_FragColor = vec4(color * a, a);');
    expect(m.fragmentShader).not.toContain('rho');
    expect(m.vertexShader).not.toContain('vO');
    const banded = atmosphere(R * 1.22, misty.atmosphere, 1.5, 0.8, bands).material;
    // With bands: ONE, ONE_MINUS_SRC_ALPHA: the glow added as additive did (colour * a * a).
    expect(banded.blending).toBe(THREE.CustomBlending);
    expect(banded.blendSrc).toBe(THREE.OneFactor);
    expect(banded.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(banded.fragmentShader).toContain('color * a * a + light');
    expect(banded.uniforms.time.value).toBe(0);
  });
});

describe('Misty\'s haze bands (#54 stage 4)', () => {
  const { a } = bandFrame(bands);
  // A direction at latitude `lat` round the bands' axis, longitude `lon`.
  const at = (lat, lon) => {
    const { b, c } = bandFrame(bands);
    return [0, 1, 2].map((i) => a[i] * Math.sin(lat) + (b[i] * Math.cos(lon) + c[i] * Math.sin(lon)) * Math.cos(lat));
  };

  it('are lighter and darker in turn across the face, under a darker hood at the seen pole', () => {
    // The axis leans towards the cameras (+z), so the bands are arcs across the disc.
    expect(a[2]).toBeGreaterThan(0.4);
    expect(Math.abs(a[2])).toBeLessThan(0.9);
    const ks = bands.bands.map((bd) => bd.k);
    for (let i = 1; i < ks.length; i++) expect(Math.sign(ks[i])).toBe(-Math.sign(ks[i - 1]));
    // Averaged round the world, each band is what it says (the waves wobble it).
    for (const bd of bands.bands) {
      let sum = 0;
      for (let l = 0; l < 64; l++) sum += bandAt(bands, ...at(bd.lat, (l / 64) * 2 * Math.PI), 0);
      expect(Math.sign(sum)).toBe(Math.sign(bd.k));
    }
    expect(bandAt(bands, ...a, 0)).toBeCloseTo(bands.hood.k, 5);
  });

  it('are soft: no jump anywhere across them', () => {
    let prev = bandAt(bands, ...at(-1.5, 0.3), 0);
    for (let lat = -1.5; lat <= 1.5; lat += 0.005) {
      const k = bandAt(bands, ...at(lat, 0.3), 0);
      expect(Math.abs(k - prev)).toBeLessThan(0.03);
      prev = k;
    }
  });

  it('drift slowly round the axis on the real clock, each at its own speed', () => {
    for (const bd of bands.bands) {
      const one = { ...bands, bands: [bd], hood: { lat: 9, k: 0 } };
      const lat = bd.lat + bd.w * 0.6;
      for (const lon of [0.3, 2, 4.5]) {
        const t = 100;
        expect(bandAt(one, ...at(lat, lon + bd.speed * t), t)).toBeCloseTo(bandAt(one, ...at(lat, lon), 0), 6);
      }
      // Slowly: well under a turn in ten minutes.
      expect(bd.speed * 600).toBeLessThan(Math.PI);
      expect(bd.speed).toBeGreaterThan(0);
    }
    expect(new Set(bands.bands.map((bd) => bd.speed)).size).toBe(bands.bands.length);
    // (The shader says the same speeds.)
    const glsl = bandShader(bands).main;
    for (const bd of bands.bands) expect(glsl).toContain(bd.speed.toFixed(5));
  });

  it('the detached layer is a thin ring clear of the main haze, a darker gap inside it', () => {
    const d = bands.detached;
    const ground = 1 / 1.22; // the ground's edge, as a share of the shell's radius
    expect(d.gap[0]).toBeGreaterThan(ground + 0.05);
    expect(d.at - d.w).toBeGreaterThan(d.gap[1]);
    expect(d.at + d.w).toBeLessThan(1);
    expect(detachedAt(bands, d.at).ring).toBe(1);
    expect(detachedAt(bands, d.at + d.w).ring).toBe(0);
    expect(detachedAt(bands, (d.gap[0] + d.gap[1]) / 2).gap).toBeCloseTo(d.gapK, 5);
    expect(detachedAt(bands, ground).gap).toBe(0);
    expect(detachedAt(bands, d.at).gap).toBe(0);
    // Bands only over the face: the glowing ring round it keeps its look.
    expect(bands.face[1]).toBeLessThanOrEqual(ground + 0.03);
  });
});

describe('Misty\'s methane showers: where they are (#54 stage 4)', () => {
  it('are the same every time, and phone-sized', () => {
    const p = showerPlan(look, R), q = showerPlan(look, R);
    expect(p.puffs).toEqual(q.puffs);
    expect(p.puffs.length / PUFF_STRIDE).toBeLessThan(900);
    expect(p.clouds.length).toBeLessThan(250);
  });

  it('are regional: most of the world is dry, and two cross the flight plane (a landing can be in one)', () => {
    let wet = 0, n = 0;
    for (let i = 0; i < 4000; i++) {
      const z = (i / 4000) * 2 - 1 + 0.00025, lon = i * 2.39996;
      if (showerAt(look, R, ...dirOf(lon, z), 0) > 0.5) wet++;
      n++;
    }
    expect(wet / n).toBeGreaterThan(0.04);
    expect(wet / n).toBeLessThan(0.25);
    // Along the flight plane, over a whole turn of the drift, rain some of the time at any spot.
    const P = (2 * Math.PI) / look.drift;
    let plane = 0, m = 0;
    for (let t = 0; t < P; t += P / 400) {
      if (showerAt(look, R, 1, 0, 0, t) > 0.5) plane++;
      m++;
    }
    expect(plane / m).toBeGreaterThan(0.08);
    expect(plane / m).toBeLessThan(0.4);
  });

  it('drift slowly eastwards on the real clock, with soft edges', () => {
    const sh = look.storms[0];
    const mid = dirOf(sh.lon, sh.z);
    expect(showerAt(look, R, ...mid, 0)).toBe(1);
    const t = 60;
    expect(showerAt(look, R, ...turn(mid, look.drift * t), t)).toBe(1);
    // A few minutes to pass over a spot: gentle, now and then.
    expect((2 * sh.size[0]) / R / look.drift).toBeGreaterThan(120);
    // No jump walking out of one.
    let prev = 1;
    for (let d = 0; d < 1.2; d += 0.002) {
      const k = showerAt(look, R, ...dirOf(sh.lon + d, sh.z), 0);
      expect(Math.abs(k - prev)).toBeLessThan(0.06);
      prev = k;
    }
    expect(prev).toBe(0);
  });

  it('are weather seen from low down: gone from the globe in space, shafts first', () => {
    const { layer } = createShowers(misty, new THREE.Vector3(1, 0, 0));
    const group = new THREE.Group();
    const cam = new THREE.Vector3();
    const fades = (alt) => {
      cam.set(0, 0, R + alt);
      layer.fade(cam, [], 0, group);
      const c = [], s = [];
      layer.clouds.forEach((cl, i) => (cl.shaft ? s : c).push(layer.fades[i]));
      return { c: Math.max(...c), s: Math.max(...s) };
    };
    expect(fades(40).c).toBeGreaterThan(0.5);
    expect(fades(40).s).toBeGreaterThan(0.5);
    expect(fades(150).s).toBe(0);
    expect(fades(150).c).toBeGreaterThan(0.2);
    expect(fades(400).c).toBe(0);
    expect(layer.mesh.visible).toBe(false);
    fades(40);
    expect(layer.mesh.visible).toBe(true);
    // (The map draws the world bigger: counted in the world's own metres.)
    group.scale.setScalar(3);
    cam.set(0, 0, 3 * (R + 400));
    layer.fade(cam, [], 0, group);
    expect(Math.max(...layer.fades)).toBe(0);
  });

  it('their clouds sit under the space line, with shafts of rain from their bases to the ground', () => {
    const p = showerPlan(look, R);
    const shafts = p.clouds.filter((c) => c.shaft);
    expect(shafts.length).toBeGreaterThan(20);
    for (let i = 0; i < p.puffs.length; i += PUFF_STRIDE) {
      const s = p.puffs.subarray(i, i + PUFF_STRIDE);
      const cl = p.clouds[s[5]];
      const r = Math.hypot(s[0], s[1], s[2]);
      if (cl.shaft) {
        // Drawn out straight down (along its up), from the ground to the clouds' base.
        const up = [s[0] / r, s[1] / r, s[2] / r];
        expect(s[12] * up[0] + s[13] * up[1] + s[14] * up[2]).toBeGreaterThan(0.99);
        expect(r - s[3] * s[15]).toBeGreaterThan(R - 3);
        expect(r - s[3] * s[15]).toBeLessThan(R + 3);
        expect(r + s[3] * s[15]).toBeCloseTo(R + look.alt, 0);
        expect(s[10]).toBeLessThan(0.35); // faint
      } else {
        expect(r).toBeGreaterThan(R + look.alt - 1);
        expect(r + s[3]).toBeLessThan(R + misty.spaceLine + 8);
      }
    }
  });
});

describe('the rain (#54 stage 4)', () => {
  const plan = rainPlan(look);
  const n = plan.length / RAIN_STRIDE;
  const at = (i) => plan.subarray(i * RAIN_STRIDE, (i + 1) * RAIN_STRIDE);
  const r = look.rain;

  it('is a fixed set of big, slow drops', () => {
    expect(n).toBe(r.drops);
    for (let i = 0; i < n; i++) {
      const p = at(i);
      for (let k = 0; k < 4; k++) expect(p[k]).toBeGreaterThanOrEqual(0);
      // Fat: a few centimetres across, a few times as long; slow (Titan's rain falls slowly).
      expect(p[4]).toBeGreaterThan(0.03);
      expect(p[5]).toBeGreaterThan(2);
      expect(p[5]).toBeLessThan(8);
      expect(p[6]).toBeGreaterThan(1.5);
      expect(p[6]).toBeLessThan(5);
      // Its splash: small.
      expect(p[7]).toBeGreaterThan(0.1);
      expect(p[7]).toBeLessThan(0.4);
    }
  });

  it('each drop falls onto a spot, splashes there (a ring on a lake), then goes round again elsewhere', () => {
    const o = {};
    const groundR = R + 1;
    for (const [ground, lake] of [[R + 2.5, false], [R - 1, false], [R - 6, true]]) {
      const floorR = R - 5;
      let prev = null, falls = 0, lands = 0;
      for (let t = 0; t < 60; t += 0.02) {
        dropLoop(look, 0.3, 3, t, groundR, ground, floorR, o);
        expect(o.age).toBeGreaterThanOrEqual(0);
        expect(o.age).toBeLessThan(1);
        if (o.phase === 'fall') {
          falls++;
          // Always above where it lands, and coming down.
          expect(o.r).toBeGreaterThan(Math.max(ground, floorR) - 1e-6);
          if (prev?.phase === 'fall' && prev.cycle === o.cycle) expect(o.r).toBeLessThan(prev.r);
        } else if (o.phase === 'land') {
          lands++;
          expect(o.lake).toBe(lake);
          // On the ground (or the lake), exactly: never floating or sunk.
          expect(o.r).toBe(lake ? floorR : ground);
          // It lands where it was falling to, with no jump.
          if (prev?.phase === 'fall' && prev.cycle === o.cycle) expect(prev.r - o.r).toBeLessThan(3 * 0.02 + 1e-6);
        }
        if (prev && o.cycle === prev.cycle && prev.phase === 'land') expect(o.phase).not.toBe('fall');
        prev = { ...o };
      }
      expect(falls).toBeGreaterThan(0);
      expect(lands).toBeGreaterThan(0);
    }
    // Different drops are at different points of their loops.
    expect(dropLoop(look, 0.1, 3, 5, R, R, R - 5).age).not.toBeCloseTo(dropLoop(look, 0.2, 3, 5, R, R, R - 5).age, 2);
    // The loop is long enough for any drop to land and finish its splash.
    for (let i = 0; i < n; i++) expect(dropLife(look, at(i)[6]) * at(i)[6]).toBeGreaterThan(r.top + r.below);
  });

  it('a light shower has fewer drops, not fainter ones; a full one has them all', () => {
    for (let i = 0; i < n; i++) {
      const s = at(i)[3];
      expect(dropShown(s, 0)).toBe(0);
      expect(dropShown(s, 1)).toBe(1);
    }
    let half = 0;
    for (let i = 0; i < n; i++) half += dropShown(at(i)[3], 0.5) > 0.99 ? 1 : 0;
    expect(half / n).toBeGreaterThan(0.4);
    expect(half / n).toBeLessThan(0.7);
  });

  it('knows the drawn ground\'s height all round: the mesh itself, baked', () => {
    // A small lumpy test mesh (the real one is Misty's terrain mesh: planets.js passes it).
    const geo = new THREE.IcosahedronGeometry(1, 12);
    const pos = geo.attributes.position;
    const h = (x, y, z) => 1.5 * Math.sin(5 * x + 2 * y) * Math.cos(4 * z);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const l = Math.hypot(x, y, z), rr = R + h(x / l, y / l, z / l);
      pos.setXYZ(i, (x / l) * rr, (y / l) * rr, (z / l) * rr);
    }
    const N = 96;
    const faces = groundFaces(pos.array, null, R, N);
    for (const f of faces) for (const v of f) expect(Number.isNaN(v)).toBe(false);
    // In the middle of each triangle: the flat triangle's own height there (not the smooth shape).
    const a = pos.array;
    let worst = 0;
    for (let k = 0; k < a.length; k += 9 * 7) {
      const cx = (a[k] + a[k + 3] + a[k + 6]) / 3, cy = (a[k + 1] + a[k + 4] + a[k + 7]) / 3, cz = (a[k + 2] + a[k + 5] + a[k + 8]) / 3;
      const l = Math.hypot(cx, cy, cz);
      worst = Math.max(worst, Math.abs(groundSample(faces, N, cx / l, cy / l, cz / l) - (l - R)));
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('is only in a shower: hidden (no draw call) outside one; drawn after the lakes', () => {
    const shw = createShowers(misty, new THREE.Vector3(1, 0, 0));
    const rain = shw.streams;
    expect(rain.mesh.visible).toBe(false);
    expect(rain.mesh.renderOrder).toBeGreaterThan(1);
    const u = rain.mesh.material.uniforms;
    expect(u.floorR.value).toBeGreaterThan(misty.liquidR);
    expect(u.floorR.value).toBeLessThan(misty.liquidR + 0.1);
    rain.set(0.8, 1, 0, 0, R + 1, 12, 1 / 60);
    expect(rain.mesh.visible).toBe(true);
    expect(u.focus.value.x).toBeCloseTo(R + 1, 5);
    expect(u.wind.value.y).toBeCloseTo(1, 5); // slanting eastwards, the way the showers go
    rain.set(0);
    expect(rain.mesh.visible).toBe(false);
    // One draw call whatever the number of drops (their splashes and rings are the same instances).
    expect(rain.mesh.geometry.instanceCount).toBe(n);
    expect(createRain(look, R, R - 5, new THREE.Vector3()).mesh.name).toBe('rain');
  });

  it('sounds as deep as we are in a shower, fading as we climb, softer from the rocket\'s view', () => {
    expect(rainVolume(0, 2, true)).toBe(0);
    expect(rainVolume(1, 2, true)).toBe(1);
    expect(rainVolume(0.5, 2, true)).toBeCloseTo(0.5, 5);
    expect(rainVolume(1, 2, false)).toBeCloseTo(RAIN_SOUND.rocket, 5);
    expect(RAIN_SOUND.rocket).toBeLessThan(1);
    let prev = 1;
    for (let hgt = 0; hgt < 200; hgt += 1) {
      const v = rainVolume(1, hgt, true);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      expect(prev - v).toBeLessThan(0.05);
      prev = v;
    }
    expect(rainVolume(1, RAIN_SOUND.top, true)).toBe(0);
    expect(rainVolume(1, 500, true)).toBe(0);
  });
});

describe('down in a shower (#54 stage 4)', () => {
  const FOG_OFF = 1e9;
  const setup = () => {
    const s = Object.create(FlightScene.prototype);
    const v = {
      body: misty,
      group: new THREE.Group(),
      atmosphere: { material: { uniforms: { fade: { value: 1 } } } },
      hazeSky: hazeSky(R, SKY_LOOK.misty),
      storms: createShowers(misty, new THREE.Vector3(1, 0, 0)),
    };
    const sun = { body: sys.bodies.find((b) => b.kind === 'star'), group: new THREE.Group() };
    sun.group.position.set(1e5, 0, 0);
    s.app = { audio: { setUnderwater() {} } };
    s.scene = new THREE.Scene();
    s.scene.fog = new THREE.Fog(0x2d7fa8, FOG_OFF, FOG_OFF * 2);
    s.scene.background = new THREE.Color(0x0d1024);
    Object.assign(s, {
      spaceColour: s.scene.background.clone(), sky: new THREE.Group(), camera: new THREE.PerspectiveCamera(50, 2, 0.2, 3e6),
      visuals: [v, sun], sunVisual: sun, mode: 'flight', underwater: false, drive: { active: false },
      flight: { state: { body: misty, x: R, y: 0, landed: true } }, time: 0, stormTint: new THREE.Color(), storm: 0, stormBank: {},
    });
    return { s, v };
  };
  const at = (s, alt, dir) => {
    s.camera.position.set(6, 0, 0);
    s.visuals[0].group.position.set(...dir.map((c, i) => s.camera.position.getComponent(i) - c * (R + alt)));
  };
  const sh = look.storms[0];
  // The first shower's middle turned to face the sun (+x).
  const noon = (s) => { s.time = (((-sh.lon) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / look.drift; };
  const inside = [Math.sqrt(1 - sh.z * sh.z), 0, sh.z];

  it('the haze darkens and closes in a little, but what we follow stays clear; drops fall', () => {
    const { s, v } = setup();
    noon(s);
    at(s, 2, [Math.cos(1.1), Math.sin(1.1), 0]); // outside, by day, same time: the plain haze (#58)
    s.updateHaze();
    expect(s.storm).toBe(0);
    const u = v.hazeSky.material.uniforms;
    const dry = { h: u.horizon.value.clone(), far: s.scene.fog.far, near: s.scene.fog.near };
    expect(dry.far).toBeCloseTo(SKY_LOOK.misty.fog.far + 6, 5);
    s.updateStorms(1 / 60);
    expect(v.storms.streams.mesh.visible).toBe(false);
    at(s, 2, inside);
    s.updateHaze();
    expect(s.storm).toBeGreaterThan(0.95);
    const lum = (c) => c.r + c.g + c.b;
    expect(lum(u.horizon.value)).toBeLessThan(lum(dry.h));
    expect(u.horizon.value.r).toBeGreaterThan(u.horizon.value.b); // still Misty's orange
    expect(s.scene.fog.far).toBeLessThan(dry.far);
    // A mood, not a whiteout: the fog still starts beyond what we follow, and the far side of a
    // lake (30 m) is still mostly there.
    expect(s.scene.fog.near).toBeGreaterThanOrEqual(6);
    expect((30 - s.scene.fog.near) / (s.scene.fog.far - s.scene.fog.near)).toBeLessThan(0.5);
    s.updateStorms(1 / 60);
    expect(v.storms.streams.mesh.visible).toBe(true);
    expect(v.storms.layer.opacity.value).toBeLessThan(look.opacity * 0.2);
    // No bank on the horizon for rain (the haze hides the distance).
    expect(v.hazeSky.material.uniforms.bankK.value).toBe(0);
  });

  it('comes in and goes smoothly walking out of one, and is gone up high and in the map', () => {
    const { s } = setup();
    noon(s);
    let prev = null;
    for (let d = 0; d < 1; d += 0.004) {
      at(s, 2, dirOf(d, sh.z));
      s.updateHaze();
      const now = { st: s.storm, far: s.scene.fog.far };
      if (prev) {
        expect(Math.abs(now.st - prev.st)).toBeLessThan(0.05);
        expect(Math.abs(now.far - prev.far)).toBeLessThan(2);
      }
      prev = now;
    }
    // Its sound: loud down in it, quieter from the rocket's view, gone as we climb, in the map and in space.
    at(s, 2, inside);
    s.updateHaze();
    expect(rainVolume(s.rainDepth, s.rainHeight, true)).toBeGreaterThan(0.9);
    expect(rainVolume(s.rainDepth, s.rainHeight, false)).toBeLessThan(0.7);
    at(s, 80, inside);
    s.updateHaze();
    expect(rainVolume(s.rainDepth, s.rainHeight, true)).toBe(0);
    at(s, 150, inside);
    s.updateHaze();
    expect(s.storm).toBe(0);
    at(s, 400, inside);
    s.updateHaze();
    expect(s.rainDepth).toBe(0);
    at(s, 2, inside);
    s.mode = 'map';
    s.updateHaze();
    expect(s.storm).toBe(0);
    expect(s.rainDepth).toBe(0);
  });
});
