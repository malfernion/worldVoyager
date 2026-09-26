// The 🧭 coach switch (#32): what Pip says on each flip, in each context, and who ends up
// flying. Drives the real FlightScene.setCoaching / helper / onPilotMessage (no three.js is
// touched there) with a real speech queue on a fake clock and a headless flight.
import { describe, it, expect } from 'vitest';
import { FlightScene } from '../src/scenes/flight.js';
import { SpeechQueue } from '../src/ui/speechQueue.js';
import { mission, parkAt } from './missions.js';

const YOU_FLY = 'You fly, I\'ll tell you when!';
const I_FLY = 'I\'ll fly, you watch!';
const IDLE_OFF = 'Now I\'ll fly when you tap a helper!';
const LESSON = 'First we fly up high. Point up and hold GO!';

const tick = () => new Promise((r) => setImmediate(r));

function fakeClock() {
  let t = 0;
  let id = 0;
  const jobs = new Map();
  return {
    now: () => t,
    set: (fn, s) => {
      jobs.set(++id, { at: t + s, fn });
      return id;
    },
    clear: (i) => jobs.delete(i),
    async advance(s) {
      const end = t + s;
      for (;;) {
        await tick();
        let next = null;
        for (const [i, j] of jobs) if (j.at <= end && (!next || j.at < next[1].at)) next = [i, j];
        if (!next) break;
        jobs.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
      await tick();
    },
  };
}

/**
 * A flight scene with just what the switch needs. `heard` is every line Pip starts saying, in
 * order; `flip(on)` marks the moment in it. Lines are paced by their estimated length.
 */
function setup(m, { coach = false, explain = false } = {}) {
  const clock = fakeClock();
  const heard = [];
  const cut = [];
  const explained = new Set(explain ? [] : ['button-orbit', 'button-land', 'button-goto']);
  const speech = new SpeechQueue({
    timers: clock,
    play: (l) => {
      heard.push(l.text);
      return false;
    },
    stop: (l) => cut.push(l.text),
  });
  const s = Object.create(FlightScene.prototype);
  s.app = {
    progress: { settings: { coach }, save() {}, has: () => false, explained: (k) => explained.has(k), markExplained: (k) => explained.add(k) },
    speech,
    pip: (text, o = {}) => speech.push(text, { pri: 'normal', key: null, ...o }),
    audio: { setMood() {} },
  };
  Object.assign(s, { flight: m.flight, autopilot: m.ap, time: 0, crashed: false, target: null, coachNudge: false });
  m.ap.on((e) => s.onPilotMessage(e));
  const run = async (seconds) => {
    for (let i = 0; i < seconds * 60; i++) {
      m.ap.update(1 / 60);
      m.flight.step(1 / 60, 1);
      if (i % 6 === 5) await clock.advance(0.1);
    }
  };
  const flip = (on) => {
    heard.push(on ? '--- on' : '--- off');
    s.setCoaching(on);
  };
  /** What Pip said after the last flip. */
  const since = () => heard.slice(heard.findLastIndex((t) => t.startsWith('---')) + 1);
  return { s, heard, cut, explained, run, flip, since, ap: m.ap, flight: m.flight, sys: m.sys };
}

const onPad = () => {
  const m = mission();
  m.flight.resetToPad(0);
  return m;
};
const inOrbit = () => parkAt(mission(), 'homestead', 0);

describe('the 🧭 coach switch (#32)', () => {
  it('idle on the pad: says who flies next, and nothing starts flying', async () => {
    const t = setup(onPad());
    t.flip(true);
    await t.run(3);
    expect(t.since()).toEqual([YOU_FLY]);
    expect(t.ap.active).toBe(false);
    expect(t.flight.state.landed).toBe(true);
    t.flip(false);
    await t.run(3);
    expect(t.since()).toEqual([IDLE_OFF]);
    expect(t.ap.active).toBe(false);
    expect(t.s.app.progress.settings.coach).toBe(false);
  });

  it('idle in flight: the same lines, and the player keeps flying', async () => {
    const t = setup(inOrbit());
    t.flip(true);
    await t.run(3);
    expect(t.since()).toEqual([YOU_FLY]);
    t.flip(false);
    await t.run(3);
    expect(t.since()).toEqual([IDLE_OFF]);
    expect(t.ap.active).toBe(false);
  });

  it('flipping quickly: the newest line wins, never the old one after the flip', async () => {
    const t = setup(onPad());
    t.flip(true);
    await t.run(0.3);
    t.flip(false);
    await t.run(0.3);
    t.flip(true);
    await t.run(4);
    expect(t.cut).toEqual([YOU_FLY, IDLE_OFF]);
    expect(t.since()).toEqual([YOU_FLY]);
    expect(t.heard.filter((l) => !l.startsWith('---'))).toEqual([YOU_FLY, IDLE_OFF, YOU_FLY]);
  });

  it('a coached launch switched off: Pip takes over, and the lesson line is never said', async () => {
    const t = setup(onPad(), { coach: true });
    t.s.app.pip('A long goal line that Pip is still saying when the lesson starts, so it waits.', { speak: true, key: 'goal' });
    t.s.helper('orbit');
    await t.run(1);
    expect(t.ap.coachSession).toBe(true);
    expect(t.ap.driving).toBe(false);
    t.flip(false);
    await t.run(4);
    expect(t.since()).toEqual([I_FLY]);
    expect(t.heard).not.toContain(LESSON);
    expect(t.ap.mode).toBe('orbit');
    expect(t.ap.coachSession).toBe(false);
    expect(t.ap.driving).toBe(true);
    expect(t.flight.state.landed).toBe(false); // Pip really flies it
  });

  it('an autopilot landing switched on: the player flies it, told what to do', async () => {
    const t = setup(inOrbit());
    t.s.helper('land');
    await t.run(1);
    expect(t.ap.driving).toBe(true);
    t.flip(true);
    await t.run(8);
    const after = t.since();
    expect(after[0]).toBe(YOU_FLY);
    expect(after.some((l) => /point|hold GO/i.test(l))).toBe(true);
    expect(after.join(' ')).not.toMatch(/Let's land/);
    expect(t.ap.mode).toBe('land');
    expect(t.ap.coachSession).toBe(true);
  });

  for (const coach of [false, true]) {
    it(`a trip switched ${coach ? 'off' : 'on'}: it carries on to the same world with the other pilot`, async () => {
      const t = setup(inOrbit(), { coach });
      t.s.target = t.sys.byId.pebble;
      t.s.helper('goto');
      await t.run(4);
      expect(t.ap.coachSession).toBe(coach);
      t.flip(!coach);
      await t.run(8);
      const after = t.since();
      expect(after[0]).toBe(coach ? I_FLY : YOU_FLY);
      // No "let's go" line from the restarted trip, and nothing from the old one.
      expect(after.join(' ')).not.toMatch(/Let's fly to/);
      if (coach) expect(after.join(' ')).not.toMatch(/hold GO/);
      expect(t.s.tripRunning).toBe(true);
      expect(t.ap.target).toBe(t.sys.byId.pebble);
      expect(t.ap.coachSession).toBe(!coach);
      expect(t.ap.driving).toBe(coach);
    });
  }

  it('a coached trip\'s landing switched off: Pip lands it', async () => {
    const m = parkAt(mission(), 'pebble', 0);
    const t = setup(m, { coach: true });
    // Where a coached trip ends up: landing, with the trip's target still set.
    t.ap.start('land', t.sys.byId.pebble, { coach: true });
    await t.run(1);
    t.flip(false);
    await t.run(4);
    expect(t.since()[0]).toBe(I_FLY);
    expect(t.since().join(' ')).not.toMatch(/Let's land/);
    expect(t.s.tripRunning).toBe(true);
    expect(t.ap.driving).toBe(true);
  });

  it('the first-launch nudge: tapping the compass on the pad starts a coached launch', async () => {
    const t = setup(onPad());
    t.s.coachNudge = true;
    t.s.app.pip('Fly to space! Hold GO to blast off! Want me to show you how to fly? Tap the compass!', { speak: true, key: 'goal' });
    await t.run(1);
    t.flip(true);
    await t.run(6);
    expect(t.since()).toEqual([YOU_FLY, LESSON]);
    expect(t.s.coachNudge).toBe(false);
    expect(t.ap.mode).toBe('orbit');
    expect(t.ap.coachSession).toBe(true);
    expect(t.ap.driving).toBe(false);
    expect(t.flight.state.landed).toBe(true); // waits for the player's GO
  });
});

// The autopilot buttons explain themselves once, the first time they fly for us (#36).
const ORBIT_BTN = 'This button flies us all the way round the planet!';
const LAND_BTN = 'This button lands us nice and softly!';
const GOTO_BTN = 'This button flies us all the way there!';

describe('autopilot buttons say what they do, once (#36)', () => {
  it('🌀 on the pad: the explanation first, then the helper\'s own line, and it flies at once', async () => {
    const t = setup(onPad(), { explain: true });
    t.s.helper('orbit');
    expect(t.ap.driving).toBe(true);
    await t.run(0.5);
    expect(t.flight.state.landed).toBe(false); // not waiting for Pip to finish talking
    await t.run(6);
    expect(t.heard.slice(0, 2)).toEqual([ORBIT_BTN, 'Up, up and away! Let\'s go around!']);
    expect(t.cut).toEqual([]);
    expect(t.explained.has('button-orbit')).toBe(true);
    // Stopped and used again: no second explanation.
    t.s.helper('orbit');
    t.s.helper('orbit');
    await t.run(4);
    expect(t.heard.filter((l) => l === ORBIT_BTN)).toHaveLength(1);
  });

  it('the first flight\'s "Blast off!" doesn\'t cut the 🌀 explanation off', async () => {
    const t = setup(onPad(), { explain: true });
    t.s.system = t.sys;
    t.flight.on((type, d) => type === 'liftoff' && t.s.onFlightEvent(type, d));
    t.s.helper('orbit');
    await t.run(8);
    expect(t.heard[0]).toBe(ORBIT_BTN);
    expect(t.heard).toContain('Blast off! Keep holding GO!');
    expect(t.cut).toEqual([]);
  });

  it('🛬 and 🤖 Take me there each have their own line', async () => {
    const t = setup(inOrbit(), { explain: true });
    t.s.helper('land');
    await t.run(6);
    expect(t.heard.slice(0, 2)).toEqual([LAND_BTN, 'Let\'s land on Homestead. Nice and gentle!']);
    t.s.helper('land');
    t.s.target = t.sys.byId.pebble;
    t.s.helper('goto');
    await t.run(6);
    expect(t.heard).toContain(GOTO_BTN);
    expect(t.heard.indexOf(GOTO_BTN)).toBeLessThan(t.heard.indexOf('Let\'s fly to Pebble!'));
    expect(t.cut).toEqual([]);
  });

  it('coached (the 🧭 switch on): no "flies us" line, and it still explains itself later', async () => {
    const t = setup(onPad(), { coach: true, explain: true });
    t.s.helper('orbit');
    await t.run(4);
    expect(t.heard.join(' ')).not.toMatch(/This button/);
    expect(t.explained.has('button-orbit')).toBe(false);
  });

  it('handed over to the player before it\'s said: the explanation is dropped', async () => {
    const t = setup(inOrbit(), { explain: true });
    t.s.app.pip('A long goal line that Pip is still saying when the helper starts, so it waits.', { speak: true, key: 'goal' });
    t.s.helper('land');
    await t.run(0.5);
    t.flip(true);
    await t.run(8);
    expect(t.heard).not.toContain(LAND_BTN);
    expect(t.since()[0]).toBe(YOU_FLY);
  });
});
