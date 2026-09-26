// The garage door (#38): it opens for the buggy and closes again behind it, including after
// the scene has left drive mode (it used to stay open).
import { describe, it, expect } from 'vitest';
import { DriveMode } from '../src/scenes/drive.js';
import { FlightScene } from '../src/scenes/flight.js';

function fakeRocket() {
  const door = { userData: { door: true }, position: { y: 0 } };
  const ramp = { userData: { ramp: true }, rotation: { x: 0 }, visible: false };
  return { door, ramp, group: { traverse: (fn) => [door, ramp].forEach(fn) } };
}

describe('garage door (#38)', () => {
  it('opens, then closes behind the buggy and stops moving', () => {
    const rocket = fakeRocket();
    const d = Object.create(DriveMode.prototype);
    d.fs = { rocket };
    d.setDoor(true);
    for (let i = 0; i < 180; i++) d.animateDoor(1 / 60);
    expect(rocket.door.position.y).toBeCloseTo(1.35);
    expect(rocket.ramp.visible).toBe(true);
    d.setDoor(false);
    for (let i = 0; i < 180; i++) d.animateDoor(1 / 60);
    expect(rocket.door.position.y).toBe(0);
    expect(rocket.ramp.visible).toBe(false);
    expect(d.doorMoving).toBe(false);
  });

  it('keeps closing once the scene is back in flight mode', () => {
    const rocket = fakeRocket();
    const d = Object.create(DriveMode.prototype);
    d.fs = { rocket };
    d.active = false;
    d.setDoor(true);
    for (let i = 0; i < 180; i++) d.animateDoor(1 / 60);
    d.setDoor(false); // what finish() does as the buggy rolls in
    // The flight scene's update, outside drive mode: stop right after it animates the door.
    const fs = Object.create(FlightScene.prototype);
    fs.drive = d;
    fs.mode = 'flight';
    fs.flight = { state: {} };
    fs.time = 0;
    fs.input = {};
    fs.updateExplain = () => {
      throw new Error('stop');
    };
    for (let i = 0; i < 180; i++) {
      try {
        fs.update(1 / 60);
      } catch (e) {
        if (e.message !== 'stop') throw e;
      }
    }
    expect(rocket.door.position.y).toBe(0);
    expect(rocket.ramp.visible).toBe(false);
  });
});
