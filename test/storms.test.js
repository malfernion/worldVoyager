// #54 stage 3: Dusty's thin high clouds and dust storms: where they go, how they drift, the sky
// and haze down in a storm (the real FlightScene.updateHaze()), the blowing dust, and Homestead
// left exactly as it was.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CLOUD_LOOK, PUFF_STRIDE, cloudPlan } from '../src/world/clouds.js';
import { STORM_LOOK, INSIDE, APPROACH, stormShapes, stormAt, stormNear, stormPlan, streamPlan, createStreams, createStorms, STREAM_STRIDE } from '../src/world/storms.js';
import { FlightScene } from '../src/scenes/flight.js';
import { hazeSky, SKY_LOOK } from '../src/world/planets.js';
import { createSystem } from '../src/physics/bodies.js';

globalThis.document ??= { getElementById: () => null };

const sys = createSystem();
const dusty = sys.byId.dusty;
const home = sys.byId.homestead;
const R = dusty.radius;
const look = STORM_LOOK.dusty;
const shapes = stormShapes(look);

const sprites = (plan) => {
  const out = [];
  for (let i = 0; i < plan.puffs.length; i += PUFF_STRIDE) {
    const p = plan.puffs.subarray(i, i + PUFF_STRIDE);
    out.push({ x: p[0], y: p[1], z: p[2], size: p[3], cloud: p[5], dens: p[10], stretch: p[15] });
  }
  return out;
};
// A unit direction turned `a` radians about z (the way the layers drift).
const turn = ([x, y, z], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];

describe('Homestead is left as it was (#54 stage 3)', () => {
  it('its cloud plan is the same, sprite for sprite', () => {
    const p = cloudPlan(CLOUD_LOOK.homestead, home.radius);
    let sum = 0, h = 0;
    p.puffs.forEach((v) => { sum += v; h = (h * 31 + Math.round(v * 1000)) % 1000000007; });
    // (Taken from the plan before Dusty's clouds were added.)
    expect(p.puffs.length).toBe(40336);
    expect(p.clouds.length).toBe(190);
    expect(sum).toBeCloseTo(256954.92433596705, 3);
    expect(h).toBe(-468123945);
  });

  it('has no storms, and still casts its shadows', () => {
    expect(STORM_LOOK.homestead).toBeUndefined();
    expect(createStorms(home, new THREE.Vector3())).toBeNull();
    expect(CLOUD_LOOK.homestead.shadow).toBeGreaterThan(0);
    expect(CLOUD_LOOK.homestead.opacity).toBeUndefined();
    expect(CLOUD_LOOK.homestead.limbRound).toBeUndefined(); // its puffs at the edge as they were
    expect(CLOUD_LOOK.dusty.limbRound).toBeGreaterThan(0); // Dusty's streaks turn into puffs there
  });
});

describe('Dusty\'s thin high clouds (#54 stage 3)', () => {
  const cl = CLOUD_LOOK.dusty;
  const plan = cloudPlan(cl, R);
  const ps = sprites(plan);

  it('are mostly thin wisps and streaks, with only a few clumps', () => {
    const wisps = plan.clouds.filter((c) => c.wisp).length;
    const fronts = plan.clouds.filter((c) => c.front >= 0).length;
    const clumps = plan.clouds.length - wisps - fronts;
    expect(wisps).toBeGreaterThan(clumps * 3);
    expect(fronts).toBeGreaterThan(0); // a few long streaky bands
    // Drawn out further than Homestead's wisps, and thinner.
    for (const p of ps) if (plan.clouds[p.cloud].wisp) expect(p.stretch).toBeGreaterThan(2);
  });

  it('are sparse, pale and faint, with no shadows', () => {
    expect(ps.length).toBeLessThan(sprites(cloudPlan(CLOUD_LOOK.homestead, home.radius)).length / 2);
    expect(cl.opacity).toBeLessThan(0.6);
    expect(cl.shadow).toBe(0);
    const c = new THREE.Color(cl.lit);
    expect(Math.min(c.r, c.g, c.b)).toBeGreaterThan(0.85);
  });

  it('sit high, near the top of the sky, under the space line', () => {
    for (const c of plan.clouds) {
      expect(c.base - R).toBeGreaterThanOrEqual(cl.alt[0] - 0.01);
      expect(c.base - R).toBeLessThan(dusty.spaceLine);
    }
    // Higher than the storms, well clear of the ground's hills.
    expect(cl.alt[0]).toBeGreaterThan(look.alt + 15);
  });
});

describe('Dusty\'s dust storms: where they are (#54 stage 3)', () => {
  const plan = stormPlan(look, R);
  const ps = sprites(plan);

  it('are the same every time, and phone-sized', () => {
    expect(Array.from(stormPlan(look, R).puffs)).toEqual(Array.from(plan.puffs));
    expect(look.storms.length).toBeGreaterThanOrEqual(1);
    expect(look.storms.length).toBeLessThanOrEqual(2);
    // One uniform per cell: keep it well within what phones allow.
    expect(plan.clouds.length).toBeLessThan(120);
    expect(ps.length).toBeLessThan(800);
  });

  it('fill each storm with cells, and have a billowing front on the side they drift towards', () => {
    shapes.forEach((sh, si) => {
      const cells = plan.clouds.filter((c) => c.storm === si);
      expect(cells.length).toBeGreaterThan(15);
      for (const c of cells) {
        const l = Math.hypot(c.x, c.y, c.z);
        expect(stormAt(look, R, c.x / l, c.y / l, c.z / l, 0)).toBeGreaterThan(0);
      }
      const front = cells.filter((c) => c.front);
      expect(front.length).toBeGreaterThan(3);
      // All ahead of the middle, along the drift (east there).
      for (const c of front) {
        const l = Math.hypot(c.x, c.y, c.z);
        const d = [c.x / l - sh.c[0], c.y / l - sh.c[1], c.z / l - sh.c[2]];
        expect(d[0] * sh.e[0] + d[1] * sh.e[1] + d[2] * sh.e[2]).toBeGreaterThan(0);
      }
    });
  });

  it('are broad regional patches: much of the world stays clear', () => {
    let inside = 0, n = 0;
    for (let i = 0; i < 4000; i++) {
      const z = (i + 0.5) / 4000 * 2 - 1, a = i * 2.39996, k = Math.sqrt(1 - z * z);
      if (stormAt(look, R, k * Math.cos(a), k * Math.sin(a), z, 0) > 0.5) inside++;
      n++;
    }
    expect(inside / n).toBeGreaterThan(0.04);
    expect(inside / n).toBeLessThan(0.25);
  });

  it('one is on the side the cameras see, one crosses the flight plane (so a landing can be in it)', () => {
    expect(shapes.some((sh) => sh.c[2] > 0.6)).toBe(true);
    const across = shapes.find((sh) => Math.abs(sh.c[2]) < 0.2);
    expect(across).toBeTruthy();
    const lon = Math.atan2(across.c[1], across.c[0]);
    expect(stormAt(look, R, Math.cos(lon), Math.sin(lon), 0, 0)).toBe(1);
  });

  it('lie low over the ground, but for a towering wall at the front (under the space line)', () => {
    for (const c of plan.clouds) expect(c.base - R).toBeCloseTo(look.alt, 5);
    let front = 0;
    for (const p of ps) {
      const h = Math.hypot(p.x, p.y, p.z) - R;
      if (plan.clouds[p.cloud].front) front = Math.max(front, h + p.size * 0.5);
      else expect(h).toBeLessThan(CLOUD_LOOK.dusty.alt[0] - 5);
      expect(h).toBeLessThan(dusty.spaceLine);
    }
    // Tall enough to show over this small world's near horizon as it comes.
    expect(front).toBeGreaterThan(look.alt + 25);
  });

  it('show coming over the horizon before they arrive, and only near one', () => {
    const c = shapes[1].c, lon = Math.atan2(c[1], c[0]);
    const out = {};
    // Walking in towards its middle along the flight plane, from well outside it.
    let last = -1;
    for (let a = lon + 1.4; a > lon; a -= 0.01) {
      stormNear(look, R, Math.cos(a), Math.sin(a), 0, 0, out);
      expect(out.k).toBeGreaterThanOrEqual(last - 1e-9);
      last = out.k;
      if (out.k > 0) {
        // It points (along the ground) towards the storm: back towards lower angles here.
        const east = [-Math.sin(a), Math.cos(a), 0];
        expect(out.x * east[0] + out.y * east[1]).toBeLessThan(0);
        expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 6);
        expect(out.x * Math.cos(a) + out.y * Math.sin(a)).toBeCloseTo(0, 6);
      }
    }
    expect(last).toBe(1);
    stormNear(look, R, 0, 0, -1, 0, out); // far from both
    expect(out.k).toBe(0);
    expect(APPROACH).toBeGreaterThan(INSIDE[1]);
  });
});

describe('Dusty\'s dust storms drift (#54 stage 3)', () => {
  it('slowly round the world, eastwards, on the real clock', () => {
    const c = shapes[1].c;
    expect(stormAt(look, R, ...c, 0)).toBe(1);
    // After t seconds the storm is where the layer has turned it.
    for (const t of [10, 300, 1000, 5000]) {
      const d = turn(c, t * look.drift);
      expect(stormAt(look, R, ...d, t)).toBeCloseTo(1, 6);
    }
    // Slowly: a spot on the plane under its middle is still inside a minute later, not ten.
    const lon = Math.atan2(c[1], c[0]);
    expect(stormAt(look, R, Math.cos(lon), Math.sin(lon), 0, 60)).toBeGreaterThan(0.9);
    expect(stormAt(look, R, Math.cos(lon), Math.sin(lon), 0, 600)).toBe(0);
    expect(look.drift).toBeGreaterThan(0);
    expect(look.drift * shapes[1].A).toBeLessThan(1); // under a metre a second
  });

  it('with soft edges: no jump walking across one', () => {
    const c = shapes[1].c, lon = Math.atan2(c[1], c[0]);
    let last = null;
    for (let a = lon - 1.5; a < lon + 1.5; a += 0.002) {
      const k = stormAt(look, R, Math.cos(a), Math.sin(a), 0, 0);
      if (last !== null) expect(Math.abs(k - last)).toBeLessThan(0.05);
      last = k;
    }
    expect(INSIDE[0]).toBeLessThan(INSIDE[1]);
  });
});

describe('the blowing dust (#54 stage 3)', () => {
  const plan = streamPlan(look);
  const s = look.streams;

  it('is a fixed set of streaks and puffs, low over the ground', () => {
    expect(plan.length / STREAM_STRIDE).toBe(s.streaks + s.puffs);
    for (let i = 0; i < plan.length; i += STREAM_STRIDE) {
      for (let j = 0; j < 4; j++) expect(plan[i + j]).toBeGreaterThanOrEqual(0);
      for (let j = 0; j < 4; j++) expect(plan[i + j]).toBeLessThan(1);
      expect(plan[i + 8]).toBeGreaterThan(0);
      expect(plan[i + 8]).toBeLessThanOrEqual(Math.max(s.high[1], s.puffHigh[1]));
    }
  });

  it('is hidden (no draw call) outside a storm, and blows along the ground, wrapping in its box', () => {
    const st = createStreams(look, new THREE.Vector3());
    st.set(0);
    expect(st.mesh.visible).toBe(false);
    const u = st.mesh.material.uniforms;
    const offset = u.offset.value;
    for (let i = 0; i < 2000; i++) st.set(1, 1, 0, 0, R, i / 60, 1 / 60);
    expect(st.mesh.visible).toBe(true);
    expect(u.offset.value).toBe(offset); // nothing allocated
    for (const c of ['x', 'y', 'z']) {
      expect(offset[c]).toBeGreaterThanOrEqual(0);
      expect(offset[c]).toBeLessThan(s.box);
    }
    // The wind is along the ground (square to up), east.
    expect(u.wind.value.dot(u.up.value)).toBeCloseTo(0, 6);
    expect(u.wind.value.y).toBeCloseTo(1, 6);
    // Near a pole, still some way along the ground.
    st.set(1, 0, 0, 1, R, 0, 1 / 60);
    expect(u.wind.value.length()).toBeCloseTo(1, 6);
    expect(u.wind.value.dot(u.up.value)).toBeCloseTo(0, 6);
  });
});

describe('down in a dust storm (#54 stage 3)', () => {
  const FOG_OFF = 1e9;
  const setup = () => {
    const s = Object.create(FlightScene.prototype);
    const v = {
      body: dusty,
      group: new THREE.Group(),
      atmosphere: { material: { uniforms: { fade: { value: 1 } } } },
      hazeSky: hazeSky(R, SKY_LOOK.dusty),
      storms: createStorms(dusty, new THREE.Vector3(1, 0, 0)),
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
      flight: { state: { body: dusty, x: R, y: 0, landed: true } }, time: 0, stormTint: new THREE.Color(), storm: 0, stormBank: {},
    });
    return { s, v };
  };
  // The camera `alt` m over direction dir, 6 m from what it follows (at the origin).
  const at = (s, alt, dir) => {
    s.camera.position.set(6, 0, 0);
    s.visuals[0].group.position.set(...dir.map((c, i) => s.camera.position.getComponent(i) - c * (R + alt)));
  };
  const c = shapes[1].c;
  const lon = Math.atan2(c[1], c[0]);
  // Days: the storm's middle turned to face the sun (+x) at time 0.
  const noon = (s) => { s.time = (((-lon) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / look.drift; };
  const inside = [1, 0, 0];

  it('the sky turns dusty, hides more of space, and the distance fogs over: but what we follow stays clear', () => {
    const { s, v } = setup();
    noon(s);
    at(s, 2, [0.6, 0.8, 0]); // outside, same time: the plain thin sky (#61)
    s.updateHaze();
    expect(s.storm).toBe(0);
    expect(s.scene.fog.near).toBe(FOG_OFF);
    const u = v.hazeSky.material.uniforms;
    const clear = { h: u.horizon.value.clone(), veil: u.veil.value };
    at(s, 2, inside);
    s.updateHaze();
    expect(s.storm).toBeGreaterThan(0.95);
    expect(u.veil.value).toBeGreaterThan(clear.veil);
    expect(u.horizon.value.equals(clear.h)).toBe(false);
    expect(u.horizon.value.r).toBeGreaterThan(u.horizon.value.b);
    // Fogged in the horizon's colour beyond what the camera follows (6 m away), never before it.
    expect(s.scene.fog.near).toBeGreaterThanOrEqual(6);
    expect(s.scene.fog.far).toBeLessThan(150);
    expect(s.scene.fog.color.equals(u.horizon.value)).toBe(true);
    // A mood, not a whiteout: the ground 30 m off is still mostly there.
    expect((30 - s.scene.fog.near) / (s.scene.fog.far - s.scene.fog.near)).toBeLessThan(0.5);
    // And the storm's own cells give way round the camera.
    expect(v.storms.layer.opacity.value).toBe(look.opacity);
    s.updateStorms(1 / 60);
    expect(v.storms.layer.opacity.value).toBeLessThan(look.opacity * 0.2);
    expect(v.storms.streams.mesh.visible).toBe(true);
  });

  it('coming, a bank of dust stands on the horizon the way it is; gone inside it and far away', () => {
    const { s, v } = setup();
    noon(s);
    const u = v.hazeSky.material.uniforms;
    at(s, 2, [Math.cos(-0.5), Math.sin(-0.5), 0]); // outside, ahead of its front
    s.updateHaze();
    expect(s.storm).toBe(0);
    expect(u.bankK.value).toBeGreaterThan(0.3);
    expect(u.bank.value.y).toBeGreaterThan(0); // towards the storm (at angle 0)
    expect(u.bankBase.value).toBeLessThanOrEqual(0);
    at(s, 2, inside);
    s.updateHaze();
    expect(u.bankK.value).toBeLessThan(0.05);
    at(s, 2, [0, 0, -1]);
    s.updateHaze();
    expect(u.bankK.value).toBe(0);
    // Up high the horizon dips below level, and the bank is counted from there.
    at(s, 30, [Math.cos(-0.5), Math.sin(-0.5), 0]);
    s.updateHaze();
    expect(u.bankBase.value).toBeLessThan(-0.3);
  });

  it('comes in and goes smoothly: driving into one, and climbing out of one', () => {
    const { s, v } = setup();
    noon(s);
    const u = v.hazeSky.material.uniforms;
    const snap = () => ({
      st: s.storm, veil: u.veil.value, h: u.horizon.value.r + u.horizon.value.g + u.horizon.value.b,
      fog30: Math.max(0, Math.min(1, (30 - s.scene.fog.near) / (s.scene.fog.far - s.scene.fog.near))),
    });
    let last = null;
    for (let a = -1.5; a <= 0; a += 0.002) {
      at(s, 2, [Math.cos(a), Math.sin(a), 0]);
      s.updateHaze();
      const now = snap();
      if (last) for (const k of Object.keys(now)) expect(Math.abs(now[k] - last[k]), `${k} at ${a}`).toBeLessThan(0.04);
      last = now;
    }
    expect(last.st).toBeGreaterThan(0.95);
    last = null;
    for (let alt = 2; alt < 200; alt += 0.5) {
      at(s, alt, inside);
      s.updateHaze();
      const now = snap();
      if (last) for (const k of Object.keys(now)) expect(Math.abs(now[k] - last[k]), `${k} at ${alt} m`).toBeLessThan(0.04);
      last = now;
    }
    // Gone above the storm: no fog, no blowing dust, the cells back.
    expect(s.storm).toBe(0);
    expect(s.scene.fog.near).toBe(FOG_OFF);
    s.updateStorms(1 / 60);
    expect(v.storms.streams.mesh.visible).toBe(false);
    expect(v.storms.layer.opacity.value).toBe(look.opacity);
  });

  it('by night it is a dark, dusty night; and in the map there is none', () => {
    const { s, v } = setup();
    noon(s);
    s.time += Math.PI / look.drift; // the storm's middle now on the night side (-x)
    at(s, 2, [-1, 0, 0]);
    s.updateHaze();
    expect(s.storm).toBeGreaterThan(0.95);
    const h = v.hazeSky.material.uniforms.horizon.value;
    expect(h.r + h.g + h.b).toBeLessThan(0.5);
    s.mode = 'map';
    s.updateHaze();
    s.updateStorms(1 / 60);
    expect(s.storm).toBe(0);
    expect(v.storms.streams.mesh.visible).toBe(false);
  });
});
