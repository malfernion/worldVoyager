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
function setup(m, { coach = false } = {}) {
  const clock = fakeClock();
  const heard = [];
  const cut = [];
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
    progress: { settings: { coach }, save() {}, has: () => false },
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
  return { s, heard, cut, run, flip, since, ap: m.ap, flight: m.flight, sys: m.sys };
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

  it('holding Faster: always flown for you, so it\'s an idle flip', async () => {
    const t = setup(inOrbit());
    t.s.holdHelper('faster', true);
    t.flip(true);
    await t.run(2);
    expect(t.since()).toEqual([YOU_FLY]);
    expect(t.ap.mode).toBe('faster');
    expect(t.ap.coachSession).toBe(false);
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
