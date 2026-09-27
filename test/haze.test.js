// Skies (#46, #58, #61): the real FlightScene.updateHaze() / updateDriving() / setUnderwater()
// with a real three.js scene, fog, camera and haze sky dome; nothing is drawn. Driving never
// updated the haze, so after a dip in a lake (or with the flight camera zoomed out before 🚙)
// the buggy drove under a black, starry sky. And the haze must come in smoothly as the camera
// comes down, with no jump anywhere between orbit and the ground. Homestead's and Dusty's skies
// (#61) are the same machinery, thinner: no fog, the stars through them by night.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FlightScene } from '../src/scenes/flight.js';
import { hazeSky, SKY_LOOK } from '../src/world/planets.js';
import { LOOKS } from '../src/world/liquid.js';
import { createSystem } from '../src/physics/bodies.js';

globalThis.document ??= { getElementById: () => null };

const sys = createSystem();
const misty = sys.byId.misty;
const home = sys.byId.homestead;
const dusty = sys.byId.dusty;
const FOG_OFF = 1e9;

function setup(body = misty) {
  const s = Object.create(FlightScene.prototype);
  const visual = (b) => ({
    body: b,
    group: new THREE.Group(),
    atmosphere: b.atmosphere ? { material: { uniforms: { fade: { value: 1 } } } } : null,
    hazeSky: SKY_LOOK[b.id] ? hazeSky(b.radius, SKY_LOOK[b.id]) : null,
  });
  const v = visual(body);
  const sun = { body: sys.bodies.find((b) => b.kind === 'star'), group: new THREE.Group() };
  sun.group.position.set(1e5, 0, 0); // the sun off to +x: the +x side of the world is day
  s.app = { audio: { setUnderwater() {} } };
  s.scene = new THREE.Scene();
  s.scene.fog = new THREE.Fog(0x2d7fa8, FOG_OFF, FOG_OFF * 2);
  s.scene.background = new THREE.Color(0x0d1024);
  Object.assign(s, {
    spaceColour: s.scene.background.clone(), sky: new THREE.Group(), camera: new THREE.PerspectiveCamera(50, 2, 0.2, 3e6),
    visuals: [v, sun], sunVisual: sun, mode: 'flight', underwater: false, flight: { state: { body } },
    drive: { active: false },
  });
  return { s, v };
}

/**
 * The camera `alt` metres above the day side's ground, `back` metres from what it follows (at
 * the floating origin), as the drive camera is.
 */
const at = (s, alt, dir = [1, 0, 0], back = 6) => {
  const R = s.visuals[0].body.radius;
  s.camera.position.set(back, 0, 0);
  s.visuals[0].group.position.set(...dir.map((c, i) => s.camera.position.getComponent(i) - c * (R + alt)));
};
// The camera `alt` m up where the sun is `a` radians from overhead (0: noon, π: midnight).
const sunAt = (s, alt, a) => at(s, alt, [Math.cos(a), Math.sin(a), 0]);
// What one frame looks like, as numbers that shouldn't jump from one frame to the next.
const look = (s, v) => {
  const u = v.hazeSky.material.uniforms;
  const shown = v.hazeSky.visible;
  const sum = (c) => c.r + c.g + c.b;
  return {
    k: s.haze,
    shell: v.atmosphere.material.uniforms.fade.value,
    dome: shown ? u.k.value : 0,
    // How much light the dome adds low down and overhead, and how much of space it hides.
    horizon: shown ? sum(u.horizon.value) * u.k.value : 0,
    zenith: shown ? sum(u.zenith.value) * u.k.value : 0,
    veil: shown ? u.veil.value * u.k.value : 0,
    bg: sum(s.scene.background),
    // What fraction of something 30 m away is fogged over.
    fog30: Math.max(0, Math.min(1, (30 - s.scene.fog.near) / (s.scene.fog.far - s.scene.fog.near))),
  };
};

describe('Misty\'s haze (#58)', () => {
  it('down on the ground: an orange sky dome, the stars gone, the distance fogged, the buggy clear', () => {
    const { s, v } = setup();
    at(s, 2);
    s.updateHaze();
    const fog = s.scene.fog;
    expect(s.haze).toBe(1);
    expect(v.hazeSky.visible).toBe(true);
    expect(v.hazeSky.material.uniforms.k.value).toBe(1);
    expect(s.sky.visible).toBe(false);
    expect(fog.near).toBeGreaterThan(6); // past the buggy, 6 m from the camera
    expect(fog.far).toBeLessThan(100); // the horizon is only a few dozen metres away
    expect(s.scene.background.equals(fog.color)).toBe(true);
    expect(v.hazeSky.material.uniforms.horizon.value.equals(fog.color)).toBe(true);
    // The shell only shows from outside; down here it's all fog and dome.
    expect(v.atmosphere.material.uniforms.fade.value).toBe(0);
  });

  it('what the camera follows stays clear, however far back the camera is', () => {
    const { s } = setup();
    for (const back of [4, 6, 12, 26, 45, 80]) {
      at(s, 3, [1, 0, 0], back);
      s.updateHaze();
      expect(s.scene.fog.near).toBeGreaterThan(back);
    }
  });

  it('comes in smoothly from orbit to the ground: no jump in any of it', () => {
    const { s, v } = setup();
    let last = null;
    for (let alt = 400; alt >= 0; alt -= 0.5) {
      at(s, alt);
      s.updateHaze();
      const now = look(s, v);
      if (last) for (const key of Object.keys(now)) expect(Math.abs(now[key] - last[key]), `${key} at ${alt} m`).toBeLessThan(0.03);
      last = now;
    }
    expect(last.k).toBe(1);
  });

  it('is gone high up, and in the map', () => {
    const { s, v } = setup();
    at(s, 2);
    s.updateHaze();
    at(s, 250);
    s.updateHaze();
    expect(s.haze).toBe(0);
    expect(v.hazeSky.visible).toBe(false);
    expect(s.scene.fog.near).toBe(FOG_OFF);
    expect(s.sky.visible).toBe(true);
    expect(v.atmosphere.material.uniforms.fade.value).toBe(1);
    at(s, 2);
    s.updateHaze();
    s.mode = 'map';
    s.updateHaze();
    expect(v.hazeSky.visible).toBe(false);
    expect(s.scene.fog.near).toBe(FOG_OFF);
  });

  it('is dimmer on the night side', () => {
    const { s } = setup();
    at(s, 2, [1, 0, 0]);
    s.updateHaze();
    const day = s.scene.fog.color.clone();
    at(s, 2, [-1, 0, 0]);
    s.updateHaze();
    expect(s.scene.fog.color.r).toBeLessThan(day.r * 0.5);
  });

  it('driving keeps it, even after a dip in a lake (it used to go black and starry)', () => {
    const { s, v } = setup();
    // updateDriving() with everything but the haze and the sea stubbed out: the buggy's camera
    // 2 m up, driving into a lake for a moment and out again.
    let wet = false;
    Object.assign(s, {
      flight: { state: { body: misty, t: 0 }, step() {}, worldPos: () => ({}) },
      particles: { update() {} },
      origin: { x: 0, y: 0 }, tmp: {}, system: sys,
      drive: {
        active: true, world: { x: 0, y: 0 }, buggy: { body: misty },
        update() {}, place() {}, updateCamera: (dt, cam) => at(s, 2),
      },
    });
    for (const k of ['placeBodies', 'placeRocket', 'updateLines', 'updateAtmospheres', 'updateMarkers', 'updateMood', 'checkBand', 'updateExhaust']) s[k] = () => {};
    s.updateUnderwater = () => { if (wet !== s.underwater) s.setUnderwater(wet, { fog: 0x3b2410, fogFar: 14 }); };
    s.haze = 0; // e.g. the flight camera was zoomed out when 🚙 was tapped
    s.updateDriving(1 / 60);
    expect(s.haze).toBe(1);
    expect(v.hazeSky.visible).toBe(true);
    wet = true;
    s.updateDriving(1 / 60);
    expect(s.scene.fog.far).toBe(14); // the lake's own murk
    expect(v.hazeSky.visible).toBe(false);
    wet = false;
    s.updateDriving(1 / 60);
    expect(s.haze).toBe(1);
    expect(v.hazeSky.visible).toBe(true);
    expect(s.sky.visible).toBe(false);
    expect(s.scene.fog.near).toBeLessThan(10);
    expect(s.scene.background.equals(s.scene.fog.color)).toBe(true);
  });

  it('worlds without a sky are untouched: no fog, space behind, the stars out', () => {
    for (const id of ['pebble', 'sizzle', 'nibble']) {
      const { s } = setup(sys.byId[id]);
      at(s, 2);
      s.updateHaze();
      expect(s.haze, id).toBe(0);
      expect(s.scene.fog.near).toBe(FOG_OFF);
      expect(s.scene.background.equals(s.spaceColour)).toBe(true);
      expect(s.sky.visible).toBe(true);
    }
  });
});

describe('Homestead\'s and Dusty\'s skies (#61)', () => {
  for (const world of [home, dusty]) {
    const id = world.id;
    it(`${id}: on the ground a sky dome over it, but no fog, the stars kept and the shell only half faded`, () => {
      const { s, v } = setup(world);
      at(s, 2);
      s.updateHaze();
      expect(s.haze).toBe(1);
      expect(v.hazeSky.visible).toBe(true);
      expect(v.hazeSky.material.uniforms.k.value).toBe(1);
      // The ground and horizon stay crisp, and moons and stars aren't fogged over.
      expect(s.scene.fog.near).toBe(FOG_OFF);
      expect(s.scene.background.equals(s.spaceColour)).toBe(true);
      expect(s.sky.visible).toBe(true);
      expect(v.atmosphere.material.uniforms.fade.value).toBeCloseTo(1 - SKY_LOOK[id].shell);
    });

    it(`${id}: no jump from orbit to the ground, by day, at dusk and by night`, () => {
      for (const a of [0, 0.8, 1.5, Math.PI / 2, 1.7, 2.4, Math.PI]) {
        const { s, v } = setup(world);
        let last = null;
        for (let alt = 400; alt >= 0; alt -= 0.5) {
          sunAt(s, alt, a);
          s.updateHaze();
          const now = look(s, v);
          if (last) for (const key of Object.keys(now)) expect(Math.abs(now[key] - last[key]), `${key} at ${alt} m, sun ${a}`).toBeLessThan(0.03);
          last = now;
        }
        expect(last.k).toBe(1);
        expect(last.fog30).toBe(0);
      }
    });

    it(`${id}: nor as the sun goes down (driving round the world)`, () => {
      const { s, v } = setup(world);
      let last = null;
      for (let a = 0; a <= Math.PI; a += 0.005) {
        sunAt(s, 2, a);
        s.updateHaze();
        const now = look(s, v);
        const u = v.hazeSky.material.uniforms;
        now.dusk = u.dusk.value.r + u.dusk.value.g + u.dusk.value.b;
        if (last) for (const key of Object.keys(now)) expect(Math.abs(now[key] - last[key]), `${key} with the sun at ${a}`).toBeLessThan(0.03);
        last = now;
      }
    });

    it(`${id}: gone in orbit and in the map, the shell back as it was`, () => {
      const { s, v } = setup(world);
      at(s, 2);
      s.updateHaze();
      at(s, SKY_LOOK[id].top + 1);
      s.updateHaze();
      expect(s.haze).toBe(0);
      expect(v.hazeSky.visible).toBe(false);
      expect(v.atmosphere.material.uniforms.fade.value).toBe(1);
      at(s, 2);
      s.updateHaze();
      s.mode = 'map';
      s.updateHaze();
      expect(v.hazeSky.visible).toBe(false);
      expect(v.atmosphere.material.uniforms.fade.value).toBe(1);
    });

    it(`${id}: night looks like night: dark, and the stars show through`, () => {
      const { s, v } = setup(world);
      const u = v.hazeSky.material.uniforms;
      const sum = (c) => c.r + c.g + c.b;
      sunAt(s, 2, 0);
      s.updateHaze();
      const day = { h: sum(u.horizon.value), z: sum(u.zenith.value), veil: u.veil.value };
      sunAt(s, 2, Math.PI);
      s.updateHaze();
      expect(sum(u.horizon.value)).toBeLessThan(day.h * 0.25);
      expect(sum(u.zenith.value)).toBeLessThan(day.z * 0.25);
      expect(u.veil.value).toBeLessThan(0.6); // overhead, most of space shows through
      expect(day.veil).toBeGreaterThan(0.7); // by day, the sky hides it
      expect(sum(u.dusk.value)).toBe(0);
      expect(sum(u.glow.value)).toBe(0);
      // The sunset band only near the terminator.
      sunAt(s, 2, 0);
      s.updateHaze();
      expect(sum(u.dusk.value)).toBe(0);
      sunAt(s, 2, Math.PI / 2);
      s.updateHaze();
      expect(sum(u.dusk.value)).toBeGreaterThan(0.1);
    });
  }

  it('Homestead\'s is blue by day and Dusty\'s butterscotch, and thinner', () => {
    const colours = {};
    for (const world of [home, dusty]) {
      const { s, v } = setup(world);
      sunAt(s, 2, 0.3);
      s.updateHaze();
      colours[world.id] = { h: v.hazeSky.material.uniforms.horizon.value.clone(), veil: v.hazeSky.material.uniforms.veil.value };
    }
    expect(colours.homestead.h.b).toBeGreaterThan(colours.homestead.h.r);
    expect(colours.dusty.h.r).toBeGreaterThan(colours.dusty.h.b);
    expect(colours.dusty.veil).toBeLessThan(colours.homestead.veil);
  });

  it('driving on Homestead keeps it, even after a dip in the sea', () => {
    const { s, v } = setup(home);
    let wet = false;
    Object.assign(s, {
      flight: { state: { body: home, t: 0 }, step() {}, worldPos: () => ({}) },
      particles: { update() {} },
      origin: { x: 0, y: 0 }, tmp: {}, system: sys,
      drive: {
        active: true, world: { x: 0, y: 0 }, buggy: { body: home },
        update() {}, place() {}, updateCamera: (dt, cam) => at(s, 2),
      },
    });
    for (const k of ['placeBodies', 'placeRocket', 'updateLines', 'updateAtmospheres', 'updateMarkers', 'updateMood', 'checkBand', 'updateExhaust']) s[k] = () => {};
    s.updateUnderwater = () => { if (wet !== s.underwater) s.setUnderwater(wet, LOOKS.water); };
    s.haze = 0;
    s.updateDriving(1 / 60);
    expect(s.haze).toBe(1);
    expect(v.hazeSky.visible).toBe(true);
    wet = true;
    s.updateDriving(1 / 60);
    expect(s.scene.fog.far).toBe(LOOKS.water.fogFar); // the sea's own murk
    expect(s.scene.fog.near).toBe(1.5);
    expect(v.hazeSky.visible).toBe(false);
    expect(s.sky.visible).toBe(false);
    wet = false;
    s.updateDriving(1 / 60);
    expect(s.haze).toBe(1);
    expect(v.hazeSky.visible).toBe(true);
    expect(s.sky.visible).toBe(true);
    expect(s.scene.fog.near).toBe(FOG_OFF);
    expect(s.scene.background.equals(s.spaceColour)).toBe(true);
  });
});
