// Misty's haze (#46, #58): the real FlightScene.updateHaze() / updateDriving() / setUnderwater()
// with a real three.js scene, fog, camera and haze sky dome; nothing is drawn. Driving never
// updated the haze, so after a dip in a lake (or with the flight camera zoomed out before 🚙)
// the buggy drove under a black, starry sky. And the haze must come in smoothly as the camera
// comes down, with no jump anywhere between orbit and the ground.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FlightScene } from '../src/scenes/flight.js';
import { hazeSky } from '../src/world/planets.js';
import { createSystem } from '../src/physics/bodies.js';

globalThis.document ??= { getElementById: () => null };

const sys = createSystem();
const misty = sys.byId.misty;
const home = sys.byId.homestead;
const R = misty.radius;
const FOG_OFF = 1e9;

function setup(body = misty) {
  const s = Object.create(FlightScene.prototype);
  const visual = (b) => ({
    body: b,
    group: new THREE.Group(),
    atmosphere: b.atmosphere ? { material: { uniforms: { fade: { value: 1 } } } } : null,
    hazeSky: b.haze ? hazeSky(b.radius) : null,
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
  s.camera.position.set(back, 0, 0);
  s.visuals[0].group.position.set(...dir.map((c, i) => s.camera.position.getComponent(i) - c * (R + alt)));
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
      const u = v.hazeSky.material.uniforms;
      const now = {
        k: s.haze,
        shell: v.atmosphere.material.uniforms.fade.value,
        dome: v.hazeSky.visible ? u.k.value : 0,
        bg: s.scene.background.r + s.scene.background.g + s.scene.background.b,
        // What fraction of something 30 m away is fogged over.
        fog30: Math.max(0, Math.min(1, (30 - s.scene.fog.near) / (s.scene.fog.far - s.scene.fog.near))),
      };
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
    for (const k of ['placeBodies', 'placeRocket', 'updateLines', 'updateAtmospheres', 'updateMarkers', 'updateMood', 'checkBand']) s[k] = () => {};
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

  it('worlds without haze are untouched: no fog, space behind, the stars out', () => {
    const { s } = setup(home);
    at(s, 2);
    s.updateHaze();
    expect(s.scene.fog.near).toBe(FOG_OFF);
    expect(s.scene.background.equals(s.spaceColour)).toBe(true);
    expect(s.sky.visible).toBe(true);
  });
});
