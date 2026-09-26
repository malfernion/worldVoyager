// Driving back into the rocket (#37): only through the open garage door, from in front, on
// the ground, and only once the buggy has left the door after rolling out.
import { describe, it, expect } from 'vitest';
import { createSystem } from '../src/physics/bodies.js';
import { Buggy, Garage, GARAGE, atGarage, garageSpot, homeAim, inGarageZone, vec } from '../src/physics/buggy.js';
import { BUGGIES } from '../src/rocket/parts.js';
import { DriveMode } from '../src/scenes/drive.js';

const DOOR = [0, 0, 1]; // the door faces +z in the rocket's frame (DriveMode's DOOR_DIR)

/** A rocket parked on `bodyId` at `angle`, like DriveMode.rocketFoot(). */
function parked(bodyId = 'pebble', angle = 1.1) {
  const sys = createSystem();
  const body = sys.byId[bodyId];
  const r = body.surfaceAt(angle);
  const foot = [Math.cos(angle) * r, Math.sin(angle) * r, 0];
  const up = vec.norm(foot);
  const side = vec.cross(up, DOOR); // square to the door, along the ground
  return { body, foot, up, side };
}

/** A buggy `ahead` metres in front of the door (negative: behind) and `aside` to the side, facing `f`. */
function buggyAt(rocket, kind, ahead, aside, f) {
  const { body, foot } = rocket;
  const b = new Buggy(body, BUGGIES[kind]);
  b.spawn(vec.add(vec.add(foot, vec.mul(DOOR, ahead)), vec.mul(rocket.side, aside)), f);
  b.obstacles = [{ p: foot, r: 1.5, top: 12 }]; // the rocket is solid, as in DriveMode.deploy()
  return b;
}

/** Steer like a small driver: turn towards `target`, full throttle. */
function towards(b, target) {
  const u = b.up;
  let want = vec.sub(target, b.p);
  want = vec.norm(vec.sub(want, vec.mul(u, vec.dot(want, u))));
  const turn = vec.dot(vec.cross(b.f, want), u);
  const ahead = vec.dot(b.f, want);
  return { throttle: 1, steer: ahead < 0 ? Math.sign(turn || 1) : Math.max(-1, Math.min(1, turn * 4)) };
}

/** Drive for `seconds`; the step the garage takes us in, and the hardest bonk. */
function run(b, garage, seconds, input) {
  let inAt = -1, bonk = 0, closest = Infinity;
  for (let i = 0; i < seconds * 60; i++) {
    b.step(1 / 60, typeof input === 'function' ? input(i, b) : input);
    bonk = Math.max(bonk, b.bumped);
    b.bumped = 0;
    const { along, side } = garageSpot(b.p, garage.foot, garage.door);
    closest = Math.min(closest, Math.hypot(along, side));
    if (garage.update(b)) {
      inAt = i;
      break;
    }
  }
  return { inAt, bonk, closest };
}

describe('the garage trigger (pure)', () => {
  const { foot, up, side } = parked();
  const at = (ahead, aside) => vec.add(vec.add(foot, vec.mul(DOOR, ahead)), vec.add(vec.mul(side, aside), vec.mul(up, 0.7)));
  const facingDoor = vec.mul(DOOR, -1);
  const b = (ahead, aside, f = facingDoor, extra = {}) => ({ p: at(ahead, aside), v: vec.mul(f, 2), f, altitude: 0, orbiting: false, ...extra });

  it('measures where we are in front of the door', () => {
    const s = garageSpot(at(4, -2), foot, DOOR);
    expect(s.along).toBeCloseTo(4, 5);
    expect(s.side).toBeCloseTo(2, 5);
    expect(garageSpot(at(-5, 0), foot, DOOR).along).toBeCloseTo(-5, 5);
  });

  it('takes us in on the ramp and just in front of it, facing the door', () => {
    for (const [ahead, aside] of [[2.6, 0], [4, 0], [6, 0], [3, 2.5], [5, -2.8]]) expect(atGarage(b(ahead, aside), foot, DOOR)).toBe(true);
    // At a slant is fine, and a slow roll, even a stop, is too.
    const slant = vec.norm(vec.add(facingDoor, vec.mul(side, 0.8)));
    expect(atGarage(b(4, 1, slant), foot, DOOR)).toBe(true);
    expect(atGarage({ ...b(4, 0), v: [0, 0, 0] }, foot, DOOR)).toBe(true);
  });

  it('not from behind, beside, too far out, or facing away', () => {
    expect(atGarage(b(-3, 0), foot, DOOR)).toBe(false); // behind
    expect(atGarage(b(0, 2.6, vec.mul(side, -1)), foot, DOOR)).toBe(false); // beside, driving at it
    expect(atGarage(b(3, 2.8, vec.mul(side, -1)), foot, DOOR)).toBe(false); // driving across in front
    expect(atGarage(b(3, 4), foot, DOOR)).toBe(false); // off to the side
    expect(atGarage(b(9, 0), foot, DOOR)).toBe(false); // too far out
    expect(atGarage(b(4, 0, DOOR), foot, DOOR)).toBe(false); // facing away
    expect(atGarage({ ...b(4, 0), v: vec.mul(DOOR, 3) }, foot, DOOR)).toBe(false); // sliding away from it
  });

  it('not in the air, hopping or orbiting', () => {
    expect(atGarage(b(3, 0, facingDoor, { altitude: 2 }), foot, DOOR)).toBe(false);
    expect(atGarage(b(3, 0, facingDoor, { orbiting: true }), foot, DOOR)).toBe(false);
  });

  it('only once we have left the door after rolling out', () => {
    const g = new Garage(foot, DOOR);
    expect(g.update(b(6, 0))).toBe(false); // rolled out right here: not yet
    expect(g.update(b(4, 0))).toBe(false);
    expect(g.update(b(8, 0))).toBe(false); // out of the box: now it counts
    expect(g.update(b(5, 0))).toBe(true);
  });

  it('the compass leads round to the front of the door when close', () => {
    expect(homeAim(at(10, 0), foot, DOOR)).toBe(foot); // in front: the rocket
    expect(homeAim(at(-80, 0), foot, DOOR)).toBe(foot); // far away: the rocket
    const lead = homeAim(at(-10, 3), foot, DOOR); // close behind: out in front of the door
    expect(garageSpot(lead, foot, DOOR).along).toBeCloseTo(GARAGE.lead, 5);
    expect(inGarageZone(at(4, 0), foot, DOOR)).toBe(true);
  });
});

describe('driving real buggies into the garage (#37)', () => {
  for (const [bodyId, kind] of [['pebble', 'rover'], ['homestead', 'truck'], ['nibble', 'hopper'], ['frosty', 'rover']]) {
    it(`a ${kind} on ${bodyId} drives straight at the door from 20 m and goes in`, () => {
      const rocket = parked(bodyId);
      const b = buggyAt(rocket, kind, 20, 0, vec.mul(DOOR, -1));
      // Steering at the door as we go (on slippery Frosty the slope slides us sideways).
      const door = vec.add(rocket.foot, vec.mul(DOOR, 2));
      const { inAt, bonk } = run(b, new Garage(rocket.foot, DOOR), 10, (i, bg) => towards(bg, door));
      expect(inAt).toBeGreaterThan(0);
      expect(bonk).toBe(0); // taken in before it could hit the rocket
    });
  }

  it('a slow, wobbly approach from off to one side still goes in', () => {
    const rocket = parked('homestead');
    const b = buggyAt(rocket, 'rover', 18, 8, vec.mul(DOOR, -1));
    const door = vec.add(rocket.foot, vec.mul(DOOR, 2));
    const { inAt } = run(b, new Garage(rocket.foot, DOOR), 20, (i) => ({ ...towards(b, door), throttle: i % 90 < 45 ? 0.5 : 0 }));
    expect(inAt).toBeGreaterThan(0);
  });

  it('from behind or the sides it bonks, as before, and never goes in', () => {
    const rocket = parked('homestead');
    for (const [ahead, aside] of [[-20, 0], [0, 20], [0, -20], [-12, 12]]) {
      const start = vec.add(vec.mul(DOOR, ahead), vec.mul(rocket.side, aside));
      const b = buggyAt(rocket, 'rover', ahead, aside, vec.mul(start, -1));
      const { inAt, bonk, closest } = run(b, new Garage(rocket.foot, DOOR), 8, { throttle: 1, steer: 0 });
      expect(inAt).toBe(-1);
      expect(bonk).toBeGreaterThan(1.2); // a proper bonk
      expect(closest).toBeGreaterThan(2.3); // the rocket is solid
    }
  });

  it('driving across in front of the door, close by, doesn\'t take us in', () => {
    const rocket = parked('homestead');
    const b = buggyAt(rocket, 'rover', 4, 20, vec.mul(rocket.side, -1));
    const { inAt } = run(b, new Garage(rocket.foot, DOOR), 6, { throttle: 1, steer: 0 });
    expect(inAt).toBe(-1);
  });

  it('right after rolling out it waits until we have driven off and come back', () => {
    const rocket = parked('homestead');
    // As DriveMode.deploy(): 6 m out in front of the door, facing away from it.
    const b = buggyAt(rocket, 'rover', 6, 0, DOOR);
    const g = new Garage(rocket.foot, DOOR);
    // Straight back up the ramp: it's where we came from, so nothing (and it bonks).
    expect(run(b, g, 3, { throttle: -1, steer: 0 }).inAt).toBe(-1);
    expect(g.armed).toBe(false);
    // Off we go, then round and back to the door.
    const door = vec.add(rocket.foot, vec.mul(DOOR, 2));
    let left = -1;
    const { inAt } = run(b, g, 30, (i, bg) => {
      if (left < 0 && g.armed) left = i;
      return i < 120 ? { throttle: 1, steer: 0 } : towards(bg, door);
    });
    expect(left).toBeGreaterThanOrEqual(0);
    expect(inAt).toBeGreaterThan(left);
  });

  it('the Hopper mid-hop over the ramp doesn\'t go in', () => {
    const rocket = parked('homestead');
    const b = buggyAt(rocket, 'hopper', 20, 0, vec.mul(DOOR, -1));
    const g = new Garage(rocket.foot, DOOR);
    let airborneInZone = 0;
    const { inAt } = run(b, g, 10, (i, bg) => {
      const { along } = garageSpot(bg.p, rocket.foot, DOOR);
      if (bg.altitude > GARAGE.ground && inGarageZone(bg.p, rocket.foot, DOOR)) airborneInZone++;
      return { throttle: 1, steer: 0, jump: along < 10 };
    });
    expect(airborneInZone).toBeGreaterThan(0);
    // It may come down on the ramp afterwards and go in, but never while in the air.
    if (inAt > 0) expect(b.altitude).toBeLessThanOrEqual(GARAGE.ground);
  });
});

describe('DriveMode drives in through the door (#37)', () => {
  function scene() {
    const rocket = parked('homestead', Math.PI / 2);
    const sounds = [];
    const part = { userData: { door: true }, position: { y: 0 } };
    const fs = {
      flight: { state: { body: rocket.body, landAngle: Math.PI / 2, t: 0 } },
      rocket: { parts: [], group: { traverse: (fn) => fn(part) } },
      design: { stack: [] },
      app: { audio: { play: (n) => sounds.push(n) }, pip: () => true },
      scene: { remove() {} },
      mode: 'drive',
    };
    const d = Object.create(DriveMode.prototype);
    d.fs = fs;
    d.buggy = buggyAt(rocket, 'rover', 20, 0, vec.mul(DOOR, -1));
    d.garage = new Garage(d.rocketFoot(), DOOR);
    d.active = true;
    d.phase = 'drive';
    d.effects = () => {};
    d.dustPool = { step() {}, clear() {} };
    return { d, fs, sounds };
  }

  it('rolls in (like 🏠 from close by) and parks', () => {
    const { d, fs, sounds } = scene();
    const input = { go: true };
    for (let i = 0; i < 600 && d.phase === 'drive'; i++) d.update(1 / 60, input);
    expect(d.phase).toBe('in');
    expect(d.far).toBe(false);
    expect(sounds).toContain('garage');
    for (let i = 0; i < 120 && d.active; i++) d.update(1 / 60, input);
    expect(d.active).toBe(false);
    expect(fs.mode).toBe('flight');
    expect(sounds).toContain('snap');
  });
});
