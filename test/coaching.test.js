// Coaching and the autopilot (#36): the 🧭 toggle during the starter journey, the map's
// 🧭 Show me how after it, the lit 🧭 that dismisses it, and the autopilot buttons, which always
// fly. Drives the real FlightScene (fly(), goals, flight events; no three.js is touched there)
// with a real speech queue on a fake clock, a real Progress, and a pretend kid on the controls
// who does what the coach says, a few frames late.
import { describe, it, expect, beforeEach } from 'vitest';
import { FlightScene } from '../src/scenes/flight.js';
import { SpeechQueue } from '../src/ui/speechQueue.js';
import { Progress, STICKERS, GOALS, FIRST_FLIGHT, goalShown } from '../src/progress.js';
import { coachButton } from '../src/ui/flightHud.js';
import { mission, parkAt } from './missions.js';

// The lines, exactly (#36).
const COACH_ON = 'Okay! I\'ll tell you what to do while you fly.';
const COACH_OFF = 'Okay! I\'ll stop telling you what to do. You\'re the pilot!';
const INTRO = 'You\'re the pilot! Want me to tell you what to do? Tap the compass. Or tap the swirly button, and I\'ll fly us round for you!';
const LAUNCH = 'First we fly up high. Point up and hold GO!';
const BLAST_OFF = 'Blast off! Keep holding GO!';
const ORBIT_BTN = 'This button flies us all the way round the planet!';
const LAND_BTN = 'This button lands us nice and softly!';
const GOTO_BTN = 'This button flies us all the way there!';
const ALL_BY_YOURSELF = 'You landed all by yourself! Great flying!';
// What only a coach says (cues and lessons), never the autopilot.
const COACHY = /hold GO|Hold GO|Let go!|arrow|all by yourself/;

let store;
beforeEach(() => {
  store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
});

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

const JOURNEY = GOALS.map((g) => g.id);

/**
 * A flight scene with what fly(), the goals and the flight events need. `done`: stickers
 * already earned (JOURNEY for after the starter journey). `heard`: every line Pip starts
 * saying, in order; `mark(label)` notes a moment in it. The kid flies whenever Pip coaches
 * (and lets go of everything when she doesn't), unless `t.kid = false`.
 */
function setup(m, { done = [], coach = false, explain = false } = {}) {
  store.clear(); // each scene starts from its own save
  const clock = fakeClock();
  const heard = [];
  const speech = new SpeechQueue({
    timers: clock,
    play: (l) => {
      heard.push(l.text);
      return false;
    },
  });
  const progress = new Progress();
  for (const id of done) progress.done[id] = 1;
  progress.settings.coach = coach;
  if (!explain) for (const k of ['button-orbit', 'button-land', 'button-goto']) progress.markExplained(k);
  // As App.onSticker does: the sticker's line, then "Next: …" or the journey's end.
  progress.on((id) => {
    speech.push(STICKERS[id].say || STICKERS[id].name, { keep: true });
    for (const next of progress.afterSticker(id)) speech.push(next, { key: 'goal' });
  });
  const s = Object.create(FlightScene.prototype);
  s.app = {
    progress,
    speech,
    screen: 'flight',
    pip: (text, o = {}) => speech.push(text, { pri: 'normal', key: null, ...o }),
    afterPip: (fn) => speech.action(fn),
    hush: () => speech.clear(),
    audio: { play() {}, setMood() {} },
    hud: { showTarget() {}, showCrash() {}, hideCrash() {} },
  };
  Object.assign(s, {
    flight: m.flight, autopilot: m.ap, system: m.sys, time: 0, crashed: false, target: null, mode: 'flight', pause: null, clock: null,
    input: { left: false, right: false, go: false, fine: false }, warpIndex: 0, manualWarp: false,
    snapshots: [], snapTimer: 0, predTimer: 0, prediction: null, drive: { active: false, cancel() {} },
    showing: null, coachKey: null, coachSpent: null, coachWait: 0, coachAsked: false, introGlow: false, lastPos: { body: null, x: 0, y: 0 },
  });
  s.burst = s.discover = s.checkDiscoveries = s.checkBand = () => {};
  m.ap.on((e) => s.onPilotMessage(e));
  m.flight.on((type, d) => s.onFlightEvent(type, d));
  const t = { s, m, heard, speech, progress, kid: true, ap: m.ap, flight: m.flight, sys: m.sys, lag: 8 };
  const queue = [];
  /** The pretend kid: follows the arrow with the turn buttons and holds GO when told, `lag` frames late. */
  const kid = () => {
    const ap = m.ap;
    const f = m.flight;
    if (!t.kid || !ap.coachSession || ap.driving) {
      queue.length = 0;
      if (t.kid) s.input.left = s.input.right = s.input.go = false;
      return;
    }
    const { angle, throttle } = ap.cmd;
    let turn = 0;
    if (angle !== null && !f.state.landed) {
      const d = Math.atan2(Math.sin(angle - f.state.angle), Math.cos(angle - f.state.angle));
      turn = Math.abs(d) < 0.05 ? 0 : Math.sign(d);
    }
    queue.push({ turn, go: throttle > 0.5 });
    const act = queue.length > t.lag ? queue.shift() : { turn: 0, go: false };
    s.input.left = act.turn > 0;
    s.input.right = act.turn < 0;
    s.input.go = act.go;
  };
  /** Play for up to `seconds` (real time), or until `until()`; returns whether it got there. */
  t.run = async (seconds, until = () => false) => {
    for (let i = 0; i < seconds * 60; i++) {
      if (until()) return true;
      kid();
      s.fly(1 / 60);
      s.checkGoals();
      if (m.flight.state.crashed) throw new Error(`crashed: ${heard.slice(-4).join(' | ')}`);
      if (i % 6 === 5) await clock.advance(0.1);
    }
    await clock.advance(0.1);
    return until();
  };
  t.mark = (label) => heard.push(`--- ${label}`);
  /** What Pip said since the last mark. */
  t.since = () => heard.slice(heard.findLastIndex((l) => l.startsWith('---')) + 1);
  /** Is Pip flying the rocket herself (the autopilot), rather than the player? */
  t.pipFlies = () => m.ap.active && !m.ap.coachSession;
  t.coaching = () => m.ap.coachSession;
  return t;
}

const onPad = (t0 = 0) => {
  const m = mission();
  m.flight.resetToPad(t0);
  return m;
};
const inOrbit = (world = 'homestead', t0 = 0) => parkAt(mission(), world, t0);
const button = (t) => coachButton({ starterDone: t.progress.starterDone, coachOn: t.s.coachOn, showing: t.s.showing });

describe('the 🧭 toggle during the starter journey (#36)', () => {
  it('is there all through the journey, on or off, and gone after it', () => {
    expect(coachButton({ starterDone: false, coachOn: false, showing: null })).toEqual({ shown: true, on: false });
    expect(coachButton({ starterDone: false, coachOn: true, showing: null })).toEqual({ shown: true, on: true });
    expect(coachButton({ starterDone: true, coachOn: true, showing: null })).toEqual({ shown: false, on: false });
  });

  it('on at the pad: the coached launch starts at once, and waits for the player\'s GO', async () => {
    const t = setup(onPad());
    t.kid = false;
    t.s.setCoaching(true);
    expect(t.coaching()).toBe(true);
    expect(t.ap.mode).toBe('orbit');
    await t.run(4);
    expect(t.heard).toEqual([COACH_ON, LAUNCH]);
    expect(t.ap.driving).toBe(false);
    expect(t.flight.state.landed).toBe(true);
    expect(t.progress.settings.coach).toBe(true);
  });

  it('launching with it already on: coaching starts on the pad', async () => {
    const t = setup(onPad(), { coach: true, done: [] });
    t.kid = false;
    await t.run(2);
    expect(t.coaching()).toBe(true);
    expect(t.heard).toEqual([LAUNCH]);
  });

  it('off before lift-off: coaching stops, and nothing flies', async () => {
    const t = setup(onPad(), { coach: true });
    t.kid = false;
    await t.run(2);
    t.mark('off');
    t.s.setCoaching(false);
    await t.run(6);
    expect(t.since()).toEqual([COACH_OFF]);
    expect(t.ap.active).toBe(false);
    expect(t.flight.state.landed).toBe(true);
  });

  it('off mid-launch: the player keeps flying, the autopilot never takes over, no more cues', async () => {
    const t = setup(onPad(), { coach: true });
    await t.run(60, () => t.flight.altitude > 40);
    expect(t.flight.state.landed).toBe(false);
    t.kid = false;
    t.s.input.go = true; // still holding GO when the coach goes
    t.mark('off');
    t.s.setCoaching(false);
    expect(t.ap.active).toBe(false);
    await t.run(1);
    expect(t.flight.throttle).toBeGreaterThan(0); // their GO still burns
    Object.assign(t.s.input, { go: false, left: false, right: false });
    await t.run(1);
    expect(t.flight.throttle).toBe(0);
    expect(t.flight.targetAngle).toBe(null);
    expect(t.flight.turn).toBe(0);
    expect(t.since()).toEqual([COACH_OFF]);
    expect(t.ap.active).toBe(false);
  });

  it('coaches each starter step in turn, and Pebble is the map\'s Show me how', async () => {
    const t = setup(onPad(), { coach: true });
    const p = t.progress;
    // 🚀 🌀 The launch into orbit.
    expect(await t.run(300, () => p.has('orbit'))).toBe(true);
    expect(t.heard.slice(0, 2)).toEqual([LAUNCH, BLAST_OFF]);
    // 🏡 Straight on to the landing at home, once Pip has said the sticker and what's next.
    expect(await t.run(30, () => t.coaching() && t.ap.target === t.sys.home)).toBe(true);
    t.mark('land home');
    expect(await t.run(600, () => p.has('land-homestead'))).toBe(true);
    await t.run(15, () => t.since().includes(ALL_BY_YOURSELF));
    expect(t.since()).toContain(ALL_BY_YOURSELF);
    // 🌕 Flying to Pebble isn't coached by the toggle...
    await t.run(20);
    expect(t.ap.active).toBe(false);
    expect(p.currentGoal.id).toBe('visit-pebble');
    // ...but by the map's 🧭 Show me how: the trip and the landing.
    t.s.setTarget(t.sys.byId.pebble);
    t.mark('pebble');
    t.s.showMeHow();
    expect(t.s.showing.body).toBe(t.sys.byId.pebble);
    expect(await t.run(3000, () => p.has('land-pebble'))).toBe(true);
    await t.run(0.1);
    expect(t.s.showing).toBe(null); // arrived
    expect(t.progress.settings.coach).toBe(true); // the toggle stays on
    // 🏡 Then the flight home and the landing, once Pip has cheered.
    expect(await t.run(30, () => t.coaching())).toBe(true);
    // It waits for Pip to finish the sticker, what's next and the cheer, then opens.
    const said = t.since();
    const at = said.indexOf(STICKERS['land-pebble'].name);
    expect(said.slice(at)).toEqual([STICKERS['land-pebble'].name, 'Next: Fly home and land!', ALL_BY_YOURSELF, 'Let\'s fly to Homestead!']);
    expect(t.ap.mode).toBe('goto');
    expect(t.ap.target).toBe(t.sys.home);
    t.mark('home');
    expect(await t.run(3000, () => p.starterDone)).toBe(true);
    await t.run(20, () => t.since().includes(ALL_BY_YOURSELF));
    expect(t.since()).toContain(ALL_BY_YOURSELF);
    expect(t.heard.filter((l) => l === ALL_BY_YOURSELF)).toHaveLength(3); // home, Pebble, home again
    // The journey's over: nothing coaches, and the 🧭 is gone.
    await t.run(5);
    expect(t.ap.active).toBe(false);
    expect(button(t).shown).toBe(false);
    expect(t.heard.filter((l) => l === 'Whoa, too fast! I\'ll catch us this time.')).toEqual([]);
  }, 240000);

  it('on with the Pebble step: the toggle doesn\'t start the trip, Pip says how to pick it', async () => {
    const t = setup(onPad(), { done: ['space', 'orbit', 'land-homestead'] });
    t.s.setCoaching(true);
    await t.run(5);
    expect(t.ap.active).toBe(false);
    expect(t.heard).toEqual([COACH_ON, 'Open the map and tap Pebble.']);
  });

  it('on in orbit on the "land at home" step: coaches the landing', async () => {
    const t = setup(inOrbit(), { done: ['space', 'orbit'] });
    t.s.setCoaching(true);
    await t.run(4);
    expect(t.coaching()).toBe(true);
    expect(t.heard[0]).toBe(COACH_ON);
    expect(t.heard[1]).toMatch(/^Let's land on Homestead together!/);
  });

  it('on the pad at the "land at home" step (back at the pad after a crash): up, round and down', async () => {
    const t = setup(onPad(), { coach: true, done: ['space', 'orbit'] });
    await t.run(3);
    expect(t.coaching()).toBe(true);
    expect(t.ap.target).toBe(t.sys.home);
    expect(t.heard).toEqual([LAUNCH]); // no "Let's fly to Homestead!": we're there
    expect(await t.run(900, () => t.progress.has('land-homestead'))).toBe(true);
    expect(t.flight.state.body).toBe(t.sys.home);
    expect(t.heard.join(' ')).toMatch(/Let's land on Homestead together!/);
  }, 60000);

  it('Show me how during the journey turns the toggle on', async () => {
    const t = setup(inOrbit(), { done: ['space', 'orbit', 'land-homestead'] });
    t.s.setTarget(t.sys.byId.pebble);
    t.s.showMeHow();
    expect(t.progress.settings.coach).toBe(true);
    expect(button(t)).toEqual({ shown: true, on: true });
    // Off stops that too.
    t.s.setCoaching(false);
    expect(t.s.showing).toBe(null);
    expect(t.ap.active).toBe(false);
    expect(t.s.target).toBe(t.sys.byId.pebble);
  });
});

describe('🧭 Show me how after the starter journey (#36)', () => {
  it('from the pad: take-off, orbit, the trip and the landing, with the lit 🧭 and the goal chip until we arrive', async () => {
    const t = setup(onPad(), { done: JOURNEY });
    const pebble = t.sys.byId.pebble;
    t.s.setTarget(pebble);
    await t.run(4);
    expect(t.heard).toEqual(['That\'s Pebble! I can fly you there, or show you how!']);
    expect(goalShown(t.progress, t.s.showing)).toBe(null);
    expect(button(t).shown).toBe(false);
    t.mark('show');
    t.s.showMeHow();
    expect(button(t)).toEqual({ shown: true, on: true });
    expect(goalShown(t.progress, t.s.showing)).toMatchObject({ icon: '🧭', text: 'Fly to Pebble and land!' });
    // On the pad the coached launch starts at once (the rocket waits for the player's GO).
    expect(t.coaching()).toBe(true);
    await t.run(6);
    expect(t.since().slice(0, 2)).toEqual([COACH_ON, 'Let\'s fly to Pebble!']);
    expect(t.flight.state.landed).toBe(false);
    expect(await t.run(3000, () => t.flight.state.landed && t.flight.state.body === pebble)).toBe(true);
    await t.run(15, () => t.since().includes(ALL_BY_YOURSELF));
    expect(t.since()).toContain(ALL_BY_YOURSELF);
    expect(t.s.showing).toBe(null);
    expect(t.ap.active).toBe(false);
    expect(button(t).shown).toBe(false);
    expect(goalShown(t.progress, t.s.showing)).toBe(null);
  }, 120000);

  it('on the pad, it starts at once, even while Pip is saying something else', async () => {
    const t = setup(onPad(), { done: JOURNEY });
    t.s.setTarget(t.sys.byId.dusty);
    t.speech.push(STICKERS.drive.say, { keep: true });
    t.s.showMeHow();
    expect(t.coaching()).toBe(true);
    expect(t.ap.target).toBe(t.sys.byId.dusty);
  });

  it('in flight, it starts once Pip has said "Okay!"', async () => {
    const t = setup(inOrbit(), { done: JOURNEY });
    t.kid = false;
    t.s.setTarget(t.sys.byId.dusty);
    t.s.showMeHow();
    expect(t.coaching()).toBe(false);
    await t.run(5, () => t.coaching());
    expect(t.coaching()).toBe(true);
    expect(t.heard[t.heard.length - 1]).toBe(COACH_ON);
  });

  it('from orbit: the trip and the landing (no take-off)', async () => {
    const t = setup(inOrbit(), { done: JOURNEY });
    t.s.setTarget(t.sys.byId.pebble);
    t.mark('show');
    t.s.showMeHow();
    await t.run(6);
    expect(t.since().slice(0, 2)).toEqual([COACH_ON, 'Let\'s fly to Pebble!']);
    expect(t.since()).not.toContain(LAUNCH);
    expect(await t.run(3000, () => t.flight.state.landed)).toBe(true);
    await t.run(0.1);
    expect(t.flight.state.body).toBe(t.sys.byId.pebble);
    expect(t.s.showing).toBe(null);
  }, 120000);

  it('the world we\'re at: Show me how coaches the landing, Take me there lands with the autopilot', async () => {
    const t = setup(inOrbit('pebble'), { done: JOURNEY });
    const pebble = t.sys.byId.pebble;
    t.s.setTarget(pebble);
    await t.run(3);
    expect(t.heard).toEqual(['We\'re at Pebble! I can land us, or show you how!']);
    t.mark('show');
    t.s.showMeHow();
    expect(goalShown(t.progress, t.s.showing).text).toBe('Land on Pebble!');
    await t.run(4);
    expect(t.since()[0]).toBe(COACH_ON);
    expect(t.since()[1]).toMatch(/^Let's land on Pebble together!/);
    expect(await t.run(600, () => t.flight.state.landed)).toBe(true);
    await t.run(0.1);
    expect(t.s.showing).toBe(null);

    const u = setup(inOrbit('pebble'), { done: JOURNEY, explain: true });
    u.s.setTarget(u.sys.byId.pebble);
    u.mark('take');
    u.s.helper('goto');
    expect(u.pipFlies()).toBe(true);
    expect(await u.run(600, () => u.flight.state.landed)).toBe(true);
    expect(u.flight.state.body).toBe(u.sys.byId.pebble);
    // It lands (no "tap the landing button"), and doesn't call itself a trip button there.
    expect(u.since()).not.toContain(GOTO_BTN);
    expect(u.since().join(' ')).toMatch(/Let's land on Pebble\. Nice and gentle!/);
  }, 60000);

  it('on the ground of the world we\'re at, or round a gas giant: nothing to pick, Pip says where we are', async () => {
    const t = setup(onPad(), { done: JOURNEY });
    t.s.setTarget(t.sys.home);
    expect(t.s.target).toBe(null);
    const u = setup(inOrbit('ringo'), { done: JOURNEY });
    u.s.setTarget(u.sys.byId.ringo);
    expect(u.s.target).toBe(null);
    await t.run(3);
    await u.run(3);
    expect(t.heard).toEqual(['We\'re at Homestead!']);
    expect(u.heard).toEqual(['We\'re at Ringo!']);
  });

  it('tapping the lit 🧭 dismisses it for good; a new Show me how starts again', async () => {
    const t = setup(inOrbit(), { done: JOURNEY });
    const pebble = t.sys.byId.pebble;
    t.s.setTarget(pebble);
    t.s.showMeHow();
    await t.run(8);
    expect(t.coaching()).toBe(true);
    t.mark('dismiss');
    t.s.tapCoach();
    expect(t.s.showing).toBe(null);
    expect(t.ap.active).toBe(false);
    expect(button(t).shown).toBe(false);
    expect(goalShown(t.progress, t.s.showing)).toBe(null);
    await t.run(30);
    expect(t.since()).toEqual([COACH_OFF]);
    expect(t.ap.active).toBe(false); // nothing takes over, and coaching doesn't come back
    expect(t.s.target).toBe(pebble); // still picked
    t.mark('again');
    t.s.tapCoach(); // the 🧭 isn't there any more; a stray tap does nothing
    await t.run(2);
    expect(t.since()).toEqual([]);
    t.s.showMeHow();
    await t.run(4);
    expect(t.since().slice(0, 2)).toEqual([COACH_ON, 'Let\'s fly to Pebble!']);
    expect(t.coaching()).toBe(true);
  });

  it('🤖 Take me there ends it: Pip flies us, and coaching doesn\'t come back after', async () => {
    const t = setup(inOrbit(), { done: JOURNEY });
    const pebble = t.sys.byId.pebble;
    t.s.setTarget(pebble);
    t.s.showMeHow();
    await t.run(4);
    t.s.helper('goto');
    expect(t.s.showing).toBe(null);
    expect(t.pipFlies()).toBe(true);
    t.mark('take');
    expect(await t.run(3000, () => !t.ap.active)).toBe(true);
    expect(t.flight.state.body).toBe(pebble);
    await t.run(10);
    expect(t.ap.active).toBe(false);
    expect(t.since().join(' ')).not.toMatch(COACHY);
  }, 120000);
});

describe('🤖 Take me there (#36)', () => {
  it('tapped again stops the trip; for another world, it flies there instead', () => {
    const t = setup(inOrbit(), { done: JOURNEY });
    t.s.setTarget(t.sys.byId.pebble);
    t.s.helper('goto');
    expect(t.pipFlies()).toBe(true);
    t.s.setTarget(t.sys.byId.dusty);
    t.s.helper('goto');
    expect(t.pipFlies()).toBe(true);
    expect(t.ap.target).toBe(t.sys.byId.dusty);
    t.s.helper('goto');
    expect(t.ap.active).toBe(false);
  });
});

describe('the autopilot during coaching (#36)', () => {
  it('🌀 mid-lesson: coaching goes quiet while Pip flies, then coaches the next step', async () => {
    const t = setup(onPad(), { coach: true });
    await t.run(60, () => t.flight.altitude > 20);
    t.mark('orbit');
    t.s.helper('orbit');
    expect(t.pipFlies()).toBe(true);
    let cues = 0;
    await t.run(300, () => {
      if (t.coaching()) return true;
      if (/Hold GO|Let go|arrow/.test(t.heard.at(-1))) cues++;
      return false;
    });
    expect(cues).toBe(0);
    expect(t.progress.has('orbit')).toBe(true);
    const quiet = t.since().slice(0, t.since().indexOf('You are in orbit! That means you are falling around the planet so fast you keep missing the ground!'));
    expect(quiet.join(' ')).not.toMatch(COACHY);
    // The next starter step, with its own opener.
    await t.run(20);
    expect(t.since().join(' ')).toMatch(/Let's land on Homestead together!/);
  }, 60000);

  it('🌀 during a Show me how: picks up the same trip afterwards, without starting over', async () => {
    const t = setup(onPad(), { done: JOURNEY });
    t.s.setTarget(t.sys.byId.pebble);
    t.s.showMeHow();
    await t.run(60, () => t.flight.altitude > 20);
    t.s.helper('orbit');
    t.mark('orbit');
    expect(await t.run(300, () => t.coaching())).toBe(true);
    expect(t.s.showing?.body).toBe(t.sys.byId.pebble);
    expect(t.ap.mode).toBe('goto');
    await t.run(10);
    expect(t.since()).not.toContain('Let\'s fly to Pebble!');
    expect(t.since()).not.toContain(COACH_ON);
  }, 60000);

  it('the autopilot buttons never coach, whether or not the coach is on', async () => {
    for (const coach of [false, true]) {
      const t = setup(onPad(), { coach, explain: true });
      t.kid = false;
      t.s.helper('orbit');
      expect(t.pipFlies()).toBe(true);
      await t.run(2);
      expect(t.flight.state.landed).toBe(false); // Pip flies at once
      expect(t.heard[0]).toBe(ORBIT_BTN);
      // Only when the player flies the launch is it "keep holding GO".
      expect(t.heard).not.toContain(BLAST_OFF);
      const u = setup(inOrbit(), { coach, explain: true, done: ['space', 'orbit'] });
      u.kid = false;
      u.s.helper('land');
      expect(u.pipFlies()).toBe(true);
      await u.run(4);
      expect(u.heard).toContain(LAND_BTN);
      expect(u.heard.join(' ')).not.toMatch(COACHY);
    }
  });

  it('🛬 where we can\'t land says why, without first saying what the button does', async () => {
    const t = setup(inOrbit('ringo'), { explain: true, done: JOURNEY });
    t.s.helper('land');
    await t.run(4);
    expect(t.heard).toEqual(['Ringo is made of clouds, there\'s no ground to land on! Let\'s visit one of its moons.']);
    expect(t.progress.explained('button-land')).toBe(false);
  });

  it('tapping a running autopilot button stops it, and coaching picks up again', async () => {
    const t = setup(onPad(), { coach: true });
    t.kid = false;
    await t.run(1);
    t.s.helper('orbit');
    expect(t.pipFlies()).toBe(true);
    t.s.helper('orbit');
    await t.run(1);
    expect(t.coaching()).toBe(true);
  });
});

describe('the first launch (#36)', () => {
  it('Pip explains the choice once, after the first goal', () => {
    const p = new Progress();
    const g = GOALS[0];
    expect(p.launchLine()).toEqual({ text: `${g.text} ${g.hint} ${INTRO}`, first: true });
    expect(FIRST_FLIGHT).toBe(INTRO);
    expect(p.launchLine()).toEqual({ text: `${g.text} ${g.hint}`, first: false });
    expect(new Progress().launchLine().first).toBe(false); // saved
    const q = new Progress();
    for (const id of JOURNEY) q.done[id] = 1;
    expect(q.launchLine()).toBe(null);
  });

  it('then tapping the compass just turns coaching on, which starts the launch', async () => {
    const t = setup(onPad());
    t.kid = false;
    t.s.introGlow = true;
    t.s.tapCoach();
    expect(t.s.introGlow).toBe(false);
    expect(t.coaching()).toBe(true);
    await t.run(4);
    expect(t.heard).toEqual([COACH_ON, LAUNCH]);
  });
});
