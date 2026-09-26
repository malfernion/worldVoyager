// The flight: planets, rocket, flight camera + map camera, predicted path, markers,
// smoke & sparkles. Positions use a floating origin so huge distances stay precise.
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { Flight } from '../physics/sim.js';
import { predict, segmentPoints, nearRadial, radialApex } from '../physics/predict.js';
import { Autopilot, inStableOrbit, landRefusal } from '../physics/autopilot.js';
import { pointAt, propagate } from '../physics/orbit.js';
import { buildRocket } from '../rocket/rocketMesh.js';
import { rocketStats } from '../rocket/parts.js';
import { groundHeading, vec } from '../physics/buggy.js';
import { createFlame, Particles, Debris } from '../world/effects.js';
import { createSky } from '../world/sky.js';
import { DriveMode } from './drive.js';
import { landingFinds, ringGapCrossed, flareSeen, sunDirection } from '../physics/discoveries.js';
import { landingMeets, allFound, fullBandReady, FULL_BAND } from '../physics/friends.js';
import { MARKER_LINES, FIRST_SIGHT, MAX_PAUSE, pickExplanation, buttonExplanation, labelRank, declutterLabels } from '../ui/markers.js';
import { TAP_RADIUS, clockAllowed, clockOnPath, clockWindow, pickOnPath, travelWarp, arrived } from '../ui/fastTravel.js';
import { clamp, flightAutoDist, flightDist, flightZoomFor, fitDist, mapZoomLimits, DRIVE_ZOOM, FLIGHT_ZOOM, SYSTEM_VIEW } from '../ui/zoom.js';
import { GOALS, STARTER_END } from '../progress.js';

// A splash's two colours: white and blue for water (#44), pale and dark amber for methane (#46).
const WATER_SPLASH = [0xeaf7ff, 0x9fd6ee];
const AMBER_SPLASH = [0xf4e0bc, 0xb8864a];

export const WARP_LEVELS = [1, 3, 10, 30, 100, 300, 1000];
const FOG_OFF = 1e9;
// Misty's haze (#46, updateHaze): full up to `low` metres above the ground, gone by `top`; the
// fog starts `near` and is solid `far` metres from the camera (divided by how hazy it is).
const HAZE = { low: 30, top: 200, near: 18, far: 280 };
const SEG_COLORS = [0xffe08a, 0x8fe3ff, 0xffa3d1, 0xb6ff9a];
const CONFETTI = [0xff6b6b, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xf78c6b, 0xc77dff];
// Longest (real seconds) a new coached action waits for Pip to stop talking (#36).
const COACH_WAIT = 20;

// Holding Shift on a keyboard fires the engine at a tenth of full power, for careful burns (#28).
// Keyboard only: there's no touch control for it, to keep the buttons simple for little ones.
export const FINE_THRUST = 0.1;
export const goThrottle = (power, fine) => (fine ? power * FINE_THRUST : power);

export class FlightScene {
  constructor(app) {
    this.app = app;
    this.system = app.system;
    this.visuals = app.visuals;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1024);
    this.spaceColour = this.scene.background.clone();
    // Under a sea (#44) the view fogs over. The fog is always there (so no material ever needs
    // rebuilding when we dive), just pushed out of sight until then.
    this.scene.fog = new THREE.Fog(0x2d7fa8, FOG_OFF, FOG_OFF * 2);
    this.underwater = false;
    this.lapWait = 0;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 3e6);
    this.origin = { x: 0, y: 0 };
    this.mode = 'flight';
    this.zoom = 1; // player's multiplier on the automatic follow distance
    this.mapDist = 1; // map camera distance (absolute)
    this.pan = { x: 0, y: 0 };
    this.mapFocus = null;
    this.warpIndex = 0;
    this.target = null;
    this.input = { left: false, right: false, go: false, fine: false };
    this.snapshots = [];
    this.snapTimer = 0;
    this.predTimer = 0;
    this.prediction = null;
    this.time = 0;
    this.camUp = new THREE.Vector3(0, 1, 0);
    this.tmp = {};
    this.tmp2 = {};
    this.tmp3 = {};
    this.discoverUntil = 0;

    for (const v of this.visuals) this.scene.add(v.group);
    this.sunVisual = this.visuals.find((v) => v.body.kind === 'star');
    this.sky = createSky();
    this.scene.add(this.sky);
    this.scene.add(new THREE.HemisphereLight(0x8a9cff, 0x2a1d30, 0.55));
    this.scene.add(new THREE.AmbientLight(0x404060, 0.35));

    this.rocketHolder = new THREE.Group();
    this.scene.add(this.rocketHolder);
    this.particles = new Particles(this.scene);
    this.debris = new Debris(this.scene);

    this.lineGroup = new THREE.Group();
    this.scene.add(this.lineGroup);
    this.segLines = [];
    this.orbitLines = new Map();
    for (const v of this.visuals) {
      const b = v.body;
      if (!b.parent) continue;
      // A circle, or the comet's stretched ellipse.
      const line = this.makeLine(b.orbitPoints(720), b.color, 2, 0.45);
      this.orbitLines.set(b, line);
    }
    this.ghosts = new Map();

    this.drive = new DriveMode(this);
    // Discoveries (#15): what the landmarks need to know each frame, and the ring gap's watch.
    // Friends (#16): who we just met (they wave), where the buggy is, and the Full Band party.
    this.landmarkCtx = { found: (id) => this.app.progress.has(id), aim: null, hello: null, listener: null, party: false };
    this.buggyAt = { body: null, p: null };
    this.bandWait = 0;
    this.bandUntil = -Infinity;
    this.lastPos = { body: null, x: 0, y: 0 };
    this.gapAt = null;
    this.labels = document.getElementById('labels');
    this.markers = new Map();
    // Markers that explain themselves (#33): which kinds are on screen and for how long, the one
    // Pip is talking about (it glows), and the pause while Pip explains one for the first time.
    this.kindsShown = new Set();
    this.kindTime = {};
    this.kindAt = {}; // where each kind is: scene x, y and screen sx, sy
    this.panGlide = null;
    this.highlight = null;
    // The game's one pause: while Pip explains a marker ({ why: 'explain', kind, t }), or after
    // fast travel got to its ⏰ ({ why: 'arrived', t }). Only the sim and helpers stop.
    this.pause = null;
    this.lastExplain = -Infinity;
    this.clock = null; // fast travel (#27): { t } while travelling to a ⏰ on the path
    this.calm = { screen: '', mode: '', crashed: false, speaking: false, throttle: 0, steering: false, sinceLast: 0, helper: null };
    this.calmHelper = { mode: null, coach: false, throttle: 0, aiming: false, tricky: false };
    // Coaching (#36): the Show me how under way ({ body, here }), the coached action last
    // started and the one that ended by itself (keys from coachWant()), and the first launch's
    // glowing 🧭.
    this.showing = null;
    this.coachKey = null;
    this.coachSpent = null;
    this.coachWait = 0;
    this.coachAsked = false;
    this.introGlow = false;
    // Any tap carries on from the pause (the line itself still finishes), and leaves the map be.
    window.addEventListener('pointerdown', () => {
      this.panGlide = null;
      if (this.pause) this.endPause();
    }, true);
  }

  makeLine(points, color, width, opacity = 1) {
    const geo = new LineGeometry();
    geo.setPositions(points);
    const mat = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthWrite: false });
    mat.resolution.set(window.innerWidth, window.innerHeight);
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    line.frustumCulled = false;
    line.renderOrder = 5;
    this.lineGroup.add(line);
    return line;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.lineGroup.traverse((o) => o.material?.resolution?.set(w, h));
  }

  // ---- lifecycle ---------------------------------------------------------

  start(design) {
    this.design = design;
    this.stats = rocketStats(design, this.system.home.gravity);
    const t = this.flight ? this.flight.state.t : 0;
    this.flight = new Flight(this.system, this.stats);
    this.flight.resetToPad(t);
    this.flight.on((type, d) => this.onFlightEvent(type, d));
    this.autopilot = new Autopilot(this.flight);
    this.autopilot.on((m) => this.onPilotMessage(m));
    this.drive?.cancel();
    this.buildRocketMesh();
    this.snapshots = [];
    this.warpIndex = 0;
    this.mode = 'flight';
    this.zoom = 1;
    this.prediction = null;
    this.crashed = false;
    this.debris.clear();
    this.particles.clear();
    this.camUp.set(0, 1, 0);
    this.camUpAngle = undefined;
    this.pause = null;
    this.clock = null;
    // A new flight: no Show me how (the 🧭 toggle is a setting and stays).
    this.showing = null;
    this.coachKey = this.coachSpent = null;
    this.app.audio.setMood('camp');
  }

  buildRocketMesh() {
    this.rocketHolder.clear();
    this.rocket = buildRocket(this.design);
    this.rocketHolder.add(this.rocket.group);
    this.flames = this.rocket.engines.map((e) => {
      const f = createFlame(e.scale);
      f.group.position.set(e.x, e.y, 0);
      this.rocket.group.add(f.group);
      return f;
    });
    this.rocketHolder.visible = true;
  }

  resetToPad() {
    this.drive.cancel();
    this.autopilot.stop();
    this.flight.resetToPad();
    this.crashed = false;
    this.debris.clear();
    this.rocketHolder.visible = true;
    this.snapshots = [];
    this.clock = null;
    this.warpIndex = 0;
    this.mode = 'flight';
    this.coachSpent = null; // coaching picks up again from the pad
    this.app.hud.hideCrash();
  }

  // ---- actions (called by the HUD) ---------------------------------------

  toggleMap() {
    if (this.mode === 'drive') return;
    this.panGlide = null;
    this.mode = this.mode === 'map' ? 'flight' : 'map';
    if (this.mode === 'map') {
      this.mapFocus = this.flight.state.body;
      this.pan = { x: 0, y: 0 };
      this.fitMap();
    }
    this.app.audio.play('whoosh');
  }

  fitMap() {
    const s = this.flight.state;
    const b = this.mapFocus;
    let extent;
    if (b === s.body) {
      const r = Math.hypot(s.x, s.y);
      const el = this.flight.elements();
      extent = Math.max(b.radius * 3, r * 1.3);
      if (!s.landed && el.e < 1 && el.ra < b.soi) extent = Math.max(extent, el.ra * 1.25);
      if (Number.isFinite(b.soi)) extent = Math.min(extent, b.soi * 1.1);
      if (b.kind === 'star') extent = Math.max(extent, SYSTEM_VIEW);
    } else {
      extent = Number.isFinite(b.soi) ? Math.min(b.soi, b.radius * 12) : SYSTEM_VIEW;
    }
    // A new default view, always inside the fixed limits, so re-fitting never changes what's reachable.
    const [lo, hi] = this.mapLimits();
    this.mapDist = clamp(fitDist(extent, this.camera.fov, this.camera.aspect), lo, hi);
  }

  mapLimits() {
    return mapZoomLimits(this.mapFocus.radius, this.camera.fov, this.camera.aspect);
  }

  // ---- zoom in real distances (pinch, wheel and the slider all come through here) ----

  zoomLimits() {
    if (this.mode === 'map') return this.mapLimits();
    return this.mode === 'drive' ? DRIVE_ZOOM : FLIGHT_ZOOM;
  }

  viewDist() {
    if (this.mode === 'map') return this.mapDist;
    if (this.mode === 'drive') return this.drive.viewDist();
    return flightDist(flightAutoDist(this.flight.altitude), this.zoom);
  }

  setViewDist(d) {
    if (this.mode === 'map') {
      const [lo, hi] = this.mapLimits();
      this.mapDist = clamp(d, lo, hi);
      this.mapEase = false;
    } else if (this.mode === 'drive') {
      this.drive.setViewDist(d);
    } else {
      // Keep it a multiplier so the view still pulls back as we climb.
      this.zoom = flightZoomFor(flightAutoDist(this.flight.altitude), d);
    }
  }

  /** Re-centre the map on a world. With `smooth`, glide there instead of jumping. */
  focusMapOn(body, smooth = false) {
    this.panGlide = null;
    if (!smooth || !this.mapFocus) {
      this.mapFocus = body;
      this.pan = { x: 0, y: 0 };
      this.fitMap();
      return;
    }
    const t = this.flight.state.t;
    const oldCentre = this.mapFocus.worldPos(t, {});
    const newCentre = body.worldPos(t, {});
    const oldDist = this.mapDist;
    this.mapFocus = body;
    this.pan = { x: oldCentre.x + this.pan.x - newCentre.x, y: oldCentre.y + this.pan.y - newCentre.y };
    this.fitMap();
    this.mapDistTarget = this.mapDist;
    this.mapDist = oldDist;
    this.mapEase = true;
  }

  easeMap(dt) {
    if (!this.mapEase) return;
    const k = 1 - Math.exp(-dt * 2.5);
    this.pan.x -= this.pan.x * k;
    this.pan.y -= this.pan.y * k;
    this.mapDist += (this.mapDistTarget - this.mapDist) * k;
    if (Math.hypot(this.pan.x, this.pan.y) < 1 && Math.abs(this.mapDist / this.mapDistTarget - 1) < 0.01) this.mapEase = false;
  }

  /** Change time speed by a step (+1 / -1), or pass `reset` for normal speed. */
  setWarp(step, reset = false) {
    // The time buttons take the clock back from fast travel (#27), from the speed it was at.
    this.clearClock(false);
    const before = this.warpIndex;
    this.warpIndex = reset ? 0 : Math.max(0, Math.min(WARP_LEVELS.length - 1, this.warpIndex + step));
    // Taking the time controls while a helper runs: the helper keeps flying, you keep the clock.
    if (this.autopilot.active) this.manualWarp = !reset;
    if (this.warpIndex !== before || reset) this.app.audio.play(this.warpIndex > before ? 'warp' : 'unwarp');
  }

  /** Jump straight to a time speed (0 = normal … 6 = fastest), e.g. from the number keys (#23). */
  setWarpLevel(i) {
    if (i <= 0) this.setWarp(0, true);
    else this.setWarp(Math.min(i, WARP_LEVELS.length - 1) - this.warpIndex);
  }

  get warp() {
    const ap = this.autopilot;
    const mine = WARP_LEVELS[this.warpIndex];
    if (!ap?.active || ap.warp === null) return mine;
    // Helpers always get normal speed for burns and tricky bits.
    if (ap.warp <= 1) return 1;
    return this.manualWarp ? mine : ap.warp;
  }

  rewind() {
    if (this.mode === 'drive') return;
    if (this.snapshots.length < 2) {
      this.resetToPad();
      return;
    }
    const back = Math.min(this.snapshots.length - 1, 10);
    const snap = this.snapshots[this.snapshots.length - 1 - back];
    this.snapshots.length = this.snapshots.length - back;
    this.autopilot.stop();
    this.clearClock();
    this.coachSpent = null; // coaching picks up again from here
    this.flight.restore(snap);
    this.crashed = false;
    this.debris.clear();
    this.rocketHolder.visible = true;
    this.warpIndex = 0;
    this.prediction = null;
    this.app.hud.hideCrash();
    this.app.audio.play('rewind');
  }

  // ---- coaching (#36) ----------------------------------------------------------
  //
  // The player flies; Pip only flies when asked, with an autopilot button (🌀 Orbit, 🛬 Land,
  // the map's 🤖 Take me there): those always start the autopilot, never coached. Coaching is
  // separate: a coached action, run through the same helper programs with `coach: true`, that
  // says what to do (arrow, glowing turn button, HOLD! / LET GO!) and keeps its tiny nudges and
  // safety catches. Two ways in:
  // - During the starter journey, the 🧭 toggle (`settings.coach`): while it's on, each starter
  //   step is coached as it comes (`coachWant()`), except flying to Pebble, which is the map's
  //   choice like every trip after the journey.
  // - The map's 🧭 Show me how (`showMeHow()`, `this.showing`): coaches the whole action to the
  //   picked world, until we land there or the lit 🧭 in the helper row dismisses it.
  // It never guesses: nothing else starts coaching. While an autopilot button flies (or we drive,
  // or crashed), coaching is quiet; `updateCoaching()` (every frame) picks it up again afterwards
  // if there's still something to coach.

  /** The 🧭 toggle (only shown during the starter journey). */
  get coachOn() {
    return !!this.app.progress.settings.coach;
  }

  /**
   * What to coach now, or null: { key, mode, body }. A Show me how comes first; otherwise, with
   * the toggle on during the starter journey, the current starter step, if it's coached from
   * where we are. `key` names the action, so it can pick up again where it left off.
   */
  coachWant() {
    const app = this.app;
    const s = this.flight.state;
    if (this.showing) return { key: `show-${this.showing.body.id}`, mode: 'goto', body: this.showing.body };
    if (app.progress.starterDone || !this.coachOn) return null;
    const home = this.system.home;
    const pebble = this.system.byId.pebble;
    switch (app.progress.currentGoal?.id) {
      case 'space':
      case 'orbit':
        // The launch into orbit: one lesson for both steps.
        return s.body === home && !inStableOrbit(this.flight) ? { key: 'launch', mode: 'orbit', body: null } : null;
      case 'land-homestead':
        // Landing at home: from orbit or on the way down, the landing; from the pad, up, round and down.
        return { key: 'land-home', mode: 'goto', body: home };
      case 'land-pebble':
        return s.body === pebble ? { key: 'land-pebble', mode: 'goto', body: pebble } : null;
      case 'home-again':
        // The flight home and the landing: a coached trip to Homestead.
        return { key: 'home-again', mode: 'goto', body: home };
      default:
        // Flying to Pebble: the map's 🤖 / 🧭 choice, as for every trip after the journey.
        return null;
    }
  }

  /**
   * Every frame: start (or pick up again) whatever should be coached. Nothing while an autopilot
   * button flies, after a crash or while driving. A coached action that ended by itself
   * (`coachSpent`) isn't started again until something changes (a rewind, the pad, the toggle,
   * a new Show me how). When to start:
   * - picking up again (after an autopilot button, a rewind, driving): at once;
   * - just asked for (the toggle turned on, Show me how: `coachAsked`): at once on the ground,
   *   where the rocket waits for the player's GO; in flight once Pip has said "Okay!", so the
   *   first cue doesn't cut that off;
   * - the next starter step, by itself: once Pip has finished what she's saying (a sticker,
   *   "Next: …", "You landed all by yourself!"), up to `COACH_WAIT`.
   */
  updateCoaching(dt = 0) {
    const ap = this.autopilot;
    const s = this.flight.state;
    // We got there another way (Pip landed us, say): the Show me how is over.
    if (this.showing && s.landed && s.body === this.showing.body && !ap.coachSession) this.endShowing();
    const want = ap.active || this.crashed || s.crashed || this.drive?.active ? null : this.coachWant();
    if (!want || want.key === this.coachSpent) {
      // Nothing to start now: when there is, it's no longer an answer to a tap.
      if (!ap.coachSession) this.coachAsked = false;
      return;
    }
    const resume = want.key === this.coachKey;
    const wait = resume ? false : this.coachAsked ? !s.landed && this.pipSaying((l) => l.key === 'coach-switch') : !!this.app.speech?.busy;
    if (wait && (this.coachWait += dt) < COACH_WAIT) return;
    this.coachWait = 0;
    this.coachAsked = false;
    this.coachKey = want.key;
    ap.start(want.mode, want.body, { coach: true, resume });
  }

  /** Is Pip saying, or about to say, a line `match` picks? */
  pipSaying(match) {
    const q = this.app.speech;
    const line = (l) => !!l && !l.fn && match(l);
    return !!q && (line(q.current) || q.pending.some(line));
  }

  /** Stop the coached program now (the rocket keeps whatever the player is doing), and what it was still going to say. */
  quietCoach() {
    const ap = this.autopilot;
    if (ap.coachSession) ap.stop();
    this.app.speech?.drop((l) => l.from === 'coach');
  }

  /** A Show me how is over (we got there, it was dismissed, or 🤖 Take me there took over): the lit 🧭 and the goal chip go. */
  endShowing() {
    if (!this.showing) return;
    this.showing = null;
    this.quietCoach();
  }

  /** Pip says the coach is on or off, at once (a cue; a newer one replaces an older one). */
  sayCoach(on) {
    const app = this.app;
    app.speech?.drop((l) => l.key === 'coach-switch');
    const said = { speak: true, pri: 'cue', key: 'coach-switch' };
    if (on) app.pip('Okay! I\'ll tell you what to do while you fly.', said);
    else app.pip('Okay! I\'ll stop telling you what to do. You\'re the pilot!', said);
  }

  /**
   * The 🧭 toggle during the starter journey. On: coach the starter step now (on the pad, the
   * launch starts at once). Off: coaching stops wherever it is (a Show me how too); the rocket
   * carries on under the player's control, and the autopilot never takes over.
   */
  setCoaching(on) {
    const app = this.app;
    app.progress.settings.coach = on;
    app.progress.save();
    this.introGlow = false;
    this.showing = null;
    this.quietCoach();
    this.coachKey = this.coachSpent = null;
    this.coachAsked = on;
    this.coachWait = 0;
    this.sayCoach(on);
    if (!on) return;
    this.updateCoaching();
    // Nothing to coach yet on the way to Pebble: that's the map's choice, so say how to make it.
    const goal = app.progress.currentGoal?.id;
    if (!this.autopilot.active && !this.coachWant() && (goal === 'visit-pebble' || goal === 'land-pebble')) {
      app.pip(GOALS.find((g) => g.id === 'visit-pebble').hint, { speak: true, key: 'goal' });
    }
  }

  /**
   * The 🧭 in the helper row: the toggle during the starter journey; after it, the lit 🧭 of a
   * Show me how, and tapping that dismisses the coach for good (the world stays picked, so the
   * player flies there alone). With neither it isn't shown, so a tap does nothing.
   */
  tapCoach() {
    if (!this.app.progress.starterDone) {
      this.setCoaching(!this.coachOn);
    } else if (this.showing) {
      this.endShowing();
      this.sayCoach(false);
    }
  }

  /**
   * The map card's 🧭 Show me how: the player flies to the picked world and Pip coaches the whole
   * action, landing included (from a pad: take-off, orbit, the trip, the landing). The world
   * we're at means landing on it. During the starter journey it turns the toggle on too.
   */
  showMeHow() {
    const app = this.app;
    const body = this.target;
    if (!body || this.crashed || this.drive?.active) return;
    this.clearClock();
    this.warpIndex = 0;
    this.manualWarp = false;
    // Whatever was flying (an autopilot trip, another coached action) makes way, and what Pip
    // was saying about it, or about the card, no longer applies.
    this.autopilot.stop();
    app.speech?.drop((l) => l.from === 'coach' || l.from === 'helper' || l.key === 'target');
    if (!app.progress.starterDone && !this.coachOn) {
      app.progress.settings.coach = true;
      app.progress.save();
    }
    this.introGlow = false;
    this.showing = { body, here: body === this.flight.state.body };
    this.coachKey = this.coachSpent = null;
    this.coachAsked = true;
    this.coachWait = 0;
    this.sayCoach(true);
    this.updateCoaching();
  }

  /** An autopilot trip from the target card is running (including the landing it can end with). */
  get tripRunning() {
    const ap = this.autopilot;
    return ap.active && !ap.coachSession && (ap.mode === 'goto' || (ap.mode === 'land' && !!ap.target));
  }

  /**
   * An autopilot button: 🌀 Orbit, 🛬 Land, or the map's 🤖 Take me there (`goto`). Pip always
   * flies these, coaching or not; tapping a running one again stops it. Coaching goes quiet
   * meanwhile and picks up again afterwards, except that 🤖 Take me there ends a Show me how
   * (Pip is taking us there now).
   */
  helper(mode) {
    if (this.crashed) return;
    const ap = this.autopilot;
    const target = mode === 'goto' ? this.target : null;
    const same = mode === 'goto' ? this.tripRunning && ap.target === target : ap.mode === mode;
    if (ap.active && !ap.coachSession && same) {
      ap.stop();
      return;
    }
    if (mode === 'goto' && !target) return;
    // Helpers run the clock themselves: no fast travel alongside one (#27).
    this.clearClock();
    this.warpIndex = 0;
    this.manualWarp = false;
    if (mode === 'goto') this.endShowing();
    this.quietCoach();
    this.explainButton(mode, target);
    ap.start(mode, target);
  }

  /**
   * The first time an autopilot button flies for us, Pip says what it does (#36), saved like
   * the markers. Queued before the helper's own first line (which comes on its first step), so
   * that waits its turn behind it instead of cutting it off; the helper flies meanwhile. Not
   * when it's only going to say no (🛬 over a gas giant, too weak a rocket), nor for 🤖 Take me
   * there picked for the world we're at (that lands; it explains itself on a real trip).
   */
  explainButton(mode, target) {
    const app = this.app;
    const f = this.flight;
    if (mode === 'land' && landRefusal(f)) return;
    if (mode === 'goto' && target === f.state.body) return;
    const ex = buttonExplanation(mode, { explained: (k) => app.progress.explained(k) });
    if (!ex) return;
    app.progress.markExplained(ex.key);
    app.pip(ex.line, { speak: true, key: 'button', from: 'helper' });
  }

  /**
   * Pick a world on the map (or null): its card offers 🤖 Take me there and 🧭 Show me how (#36).
   * The world we're flying round means landing on it. Where there's nothing to do (we're on its
   * ground, or it's all clouds) it isn't picked, and Pip just says where we are.
   */
  setTarget(body) {
    const s = this.flight.state;
    if (body && (body === this.target || body.kind === 'star')) body = null;
    const at = body && body === s.body && (s.landed || !body.solid) ? body : null;
    if (at) body = null;
    this.target = body;
    this.prediction = null;
    this.app.hud.showTarget(body);
    if (at) this.app.pip(`We're at ${at.name}!`, { speak: true, key: 'target' });
    else if (body === s.body) this.app.pip(`We're at ${body.name}! I can land us, or show you how!`, { speak: true, key: 'target' });
    else if (body) this.app.pip(`That's ${body.name}! I can fly you there, or show you how!`, { speak: true, key: 'target' });
  }

  // ---- events --------------------------------------------------------------

  onPilotMessage(m) {
    // The helper says how urgent each line is (coach cues, safety takeovers, chat). Coaching
    // lines are marked, so they can be dropped when coaching stops or goes quiet.
    if (m.text) this.app.pip(m.text, { speak: true, pri: m.pri, key: m.key, from: this.autopilot.coachSession ? 'coach' : 'helper' });
    // A helper just finished: a GO still held from its last cue mustn't burn on by itself.
    if (m.done) this.goLatched = true;
    // A coached action ended by itself (we got there, or it couldn't): not again until something
    // changes, and a Show me how is over (keeping its last line: "You landed all by yourself!").
    if (m.done && m.coached) {
      this.coachSpent = this.coachKey;
      this.showing = null;
    }
    if (m.visiting) this.discover(m.visiting);
  }

  discover() {
    this.discoverUntil = this.time + 40;
    this.app.audio.setMood('discover');
  }

  onFlightEvent(type, d) {
    const app = this.app;
    switch (type) {
      case 'liftoff':
        if (d.body === this.system.home && this.flight.state.landAngle === Math.PI / 2 && !app.progress.has('space')) {
          // Replaces the goal line (how to blast off): that's being done now. A cue for the
          // player's GO, so only when the player flies the launch, not Pip (#36).
          if (!this.autopilot.driving) app.pip('Blast off! Keep holding GO!', { speak: true, pri: 'cue', key: 'goal' });
        }
        break;
      case 'soi': {
        app.audio.play('soi');
        if (d.kind === 'enter') {
          app.pip(`${d.to.icon} Welcome to ${d.to.name}!`, { speak: true });
          app.progress.earn(`visit-${d.to.id}`);
          this.discover(d.to);
        } else if (d.to.kind === 'star') {
          app.pip(`We're flying around Ember now! ${d.from.name} is behind us.`, { speak: true });
        } else {
          app.pip(`Back in ${d.to.name}'s space.`, { speak: false, pri: 'chatter' });
        }
        if (this.mode === 'map') this.focusMapOn(d.to, true);
        break;
      }
      case 'landed': {
        const b = d.body;
        app.audio.play('land');
        this.burst(b, 'dust');
        if (this.autopilot.coachSession) this.goLatched = true;
        if (!d.afterFlight) break;
        const id = `land-${b.id}`;
        if (b === this.system.home && !app.progress.has('space')) {
          app.pip('Bump! Try flying higher next time!', { speak: true });
          break;
        }
        const has = (x) => app.progress.has(x);
        const found = landingFinds(b, this.flight.state.landAngle, { time: this.time, toSun: sunDirection(b, this.flight.state.t), has });
        const met = landingMeets(b, this.flight.state.landAngle, has); // right by a friend (#16)
        const first = app.progress.earn(id);
        // The starter journey's last goal (#36): home again, after landing on Pebble.
        const back = b === this.system.home && has('land-pebble') && app.progress.earn(STARTER_END);
        if (first || back) this.burst(b, 'confetti');
        else if (!found && !met) app.pip(`Touchdown on ${b.name}! ${b.icon}`, { speak: true });
        this.warpIndex = 0;
        this.discover(b);
        // Landed right by (or in) a discovery or a friend: once Pip has said what's before it.
        if (found) app.afterPip(() => this.found(found));
        if (met) app.afterPip(() => this.metFriend(met));
        break;
      }
      case 'crash': {
        this.crashed = true;
        this.clearClock();
        this.warpIndex = 0;
        const s = this.flight.state;
        // Into a sea (#44): a big splash instead of a fireball; into lava (#45): a sizzle and smoke.
        const wet = !!s.body.liquid && d.reason === s.body.liquid.kind;
        const lava = d.reason === 'lava';
        app.audio.play(lava ? 'lavaCrash' : wet ? 'bigSplash' : 'crash');
        this.debris.explode(this.rocket, s.body, { x: s.x, y: s.y }, s.angle, Math.atan2(s.y, s.x));
        this.rocketHolder.visible = false;
        this.burst(s.body, lava ? 'steam' : wet ? 'splash' : 'explosion', s.body.liquid?.kind === 'methane' ? AMBER_SPLASH : WATER_SPLASH);
        // A crash makes anything Pip was about to say old news.
        app.hush();
        const first = !app.progress.has('kaboom');
        const lines = {
          gas: `Whoosh! ${s.body.name} is made of clouds, there's no ground!`,
          star: 'Yikes, too hot! Ember is a star!',
          fast: 'Kaboom! Too fast! Slow down before landing.',
          tipped: 'Oops, we tipped over! Land standing up straight.',
          water: 'Splash! Rockets can\'t float. Let\'s land on the ground!',
          lava: 'Sizzle! Lava is much too hot to land on!',
          methane: 'Splash! That lake is made of methane. Let\'s land on the ground!',
        };
        // The first splash says it with its sticker.
        const splashFirst = d.reason === 'water' && !app.progress.has('splash');
        if (!first && !splashFirst) app.pip(lines[d.reason] || 'Kaboom!', { speak: true, pri: 'urgent' });
        // Stickers after the crash line, so it doesn't cut their lines off.
        if (d.reason === 'gas') app.progress.earn('dive');
        if (d.reason === 'water') app.progress.earn('splash');
        app.progress.earn('kaboom');
        setTimeout(() => this.crashed && app.hud.showCrash(), 1400);
        break;
      }
      default:
        break;
    }
  }

  /** A discovery (#15) found from the rocket: a chime, sparkles, then the sticker and the fact. */
  found(id) {
    const app = this.app;
    if (app.progress.has(id)) return;
    app.audio.play('discover');
    this.burst(this.flight.state.body, 'sparkle');
    this.discover();
    app.progress.earn(id);
  }

  /**
   * Said hello to a friend (#16), from the buggy or by landing next to them: they wave, a
   * chime and a strum, sparkles, their sticker pops and Pip chats. Their part joins the music.
   */
  metFriend(id) {
    const app = this.app;
    const has = (x) => app.progress.has(x);
    if (has(id)) return;
    app.audio.play('friend');
    if (this.drive.active) this.drive.sparkle();
    else this.burst(this.flight.state.body, 'sparkle');
    this.landmarkCtx.hello = { id, time: this.time };
    this.discover();
    app.progress.earn(id);
    // The last one: time to take everyone home (queued after Pip's hello).
    if (allFound(has) && !has(FULL_BAND)) app.pip('That\'s everyone! Let\'s go home to the campfire!', { speak: true });
  }

  /**
   * Full Band (#16): with every friend found, being back on Homestead's ground (landed, or
   * driving) for a few seconds brings everyone together at the campfire: a big strum, confetti,
   * the sticker, and the whole band plays loud for a while.
   */
  checkBand(dt, onHomeGround) {
    const app = this.app;
    if (app.screen !== 'flight' || this.crashed || !fullBandReady((x) => app.progress.has(x), onHomeGround)) {
      this.bandWait = 0;
      return;
    }
    this.bandWait += dt;
    if (this.bandWait < 4) return;
    this.bandWait = 0;
    app.audio.play('band');
    if (this.drive.active) this.drive.sparkle();
    else this.burst(this.flight.state.body, 'confetti');
    this.bandUntil = this.time + 45;
    app.progress.earn(FULL_BAND);
  }

  /**
   * Where we're listening from, for how loud each friend is (#16): the buggy while driving,
   * otherwise the rocket (in the world frame of the world we're at). Fills `w` (no allocation).
   */
  listener(w) {
    const s = this.flight.state;
    const home = this.system.home;
    const b = this.drive.active ? this.drive.buggy : null;
    if (b) {
      w.body = b.body;
      w.p[0] = b.p[0]; w.p[1] = b.p[1]; w.p[2] = b.p[2];
      w.ground = true;
      w.home = b.body === home;
    } else {
      w.body = s.body;
      w.p[0] = s.x; w.p[1] = s.y; w.p[2] = 0;
      w.ground = s.landed;
      w.home = s.body === home && (s.landed || this.flight.altitude < home.spaceLine);
    }
    w.party = this.time < this.bandUntil;
    return w;
  }

  burst(body, kind, splash = WATER_SPLASH) {
    const s = this.flight.state;
    const up = Math.atan2(s.y, s.x);
    const ux = Math.cos(up), uy = Math.sin(up);
    const n = kind === 'confetti' ? 70 : kind === 'explosion' ? 40 : kind === 'splash' || kind === 'steam' ? 60 : kind === 'sparkle' ? 30 : 14;
    if (kind === 'steam') {
      // Into lava (#45): a hiss of white steam and dark smoke billowing up, with a few glowing
      // sparks of lava thrown out.
      const g = body.mu / (body.radius * body.radius);
      const top = body.surfaceAt(up);
      for (let i = 0; i < n; i++) {
        const spark = i % 4 === 0;
        const a = up + (Math.random() - 0.5) * (spark ? 1.6 : 0.9);
        const sp = spark ? 6 + Math.random() * 8 : 2 + Math.random() * 5;
        const vz = (Math.random() - 0.5) * sp;
        const x = ux * top + Math.cos(a) * 0.8, y = uy * top + Math.sin(a) * 0.8, z = (Math.random() - 0.5) * 3;
        if (spark) {
          this.particles.spawn('spark', body, x, y, z, Math.cos(a) * sp, Math.sin(a) * sp, vz, { size: 1.2, grow: -0.5, life: 1 + Math.random() * 0.6, drag: 0.4, gravity: g, color: 0xffa040 });
        } else {
          this.particles.spawn('puff', body, x, y, z, Math.cos(a) * sp, Math.sin(a) * sp, vz, {
            size: 2 + Math.random(), grow: 3, life: 2.4 + Math.random() * 1.2, drag: 0.9, gravity: -0.4, color: i % 3 === 1 ? 0x4a3a34 : i % 3 ? 0xf2eee8 : 0xb8aca2,
          });
        }
      }
      return;
    }
    if (kind === 'splash') {
      // A tall white column and a ring of spray thrown out sideways, falling back in (#44).
      const g = body.mu / (body.radius * body.radius);
      const top = body.surfaceAt(up);
      for (let i = 0; i < n; i++) {
        const col = i % 2 === 0;
        const a = up + (Math.random() - 0.5) * (col ? 0.5 : 2.6);
        const sp = col ? 10 + Math.random() * 12 : 5 + Math.random() * 8;
        const vz = (Math.random() - 0.5) * (col ? 4 : sp * 1.6);
        this.particles.spawn('puff', body, ux * top + Math.cos(a) * 0.5, uy * top + Math.sin(a) * 0.5, (Math.random() - 0.5) * 2,
          Math.cos(a) * sp, Math.sin(a) * sp, vz, { size: col ? 2.2 : 1.6, grow: 1.8, life: 1.6 + Math.random() * 0.8, drag: 0.6, gravity: g, color: splash[i % 3 ? 0 : 1] });
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      const a = up + (Math.random() - 0.5) * (kind === 'dust' ? 3 : 5);
      const sp = kind === 'confetti' ? 6 + Math.random() * 10 : kind === 'explosion' ? 3 + Math.random() * 9 : 2 + Math.random() * 3;
      const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp, vz = (Math.random() - 0.5) * sp;
      const x = s.x + ux * 2, y = s.y + uy * 2;
      if (kind === 'confetti') {
        this.particles.spawn('confetti', body, x + ux * 4, y + uy * 4, 0, vx, vy, vz, {
          color: CONFETTI[i % CONFETTI.length], size: 0.5, grow: 0, life: 3, drag: 1.2, gravity: 3,
        });
      } else if (kind === 'sparkle') {
        this.particles.spawn('spark', body, x, y, 0, vx, vy, vz, { size: 1.5, grow: -0.4, life: 1.2, drag: 1.5 });
      } else if (kind === 'explosion') {
        this.particles.spawn(i % 3 ? 'puff' : 'spark', body, x, y, 0, vx, vy, vz, {
          size: i % 3 ? 3 : 2, grow: 2, life: 1.5 + Math.random(), drag: 1.5, color: i % 3 === 1 ? 0xffb070 : undefined,
        });
      } else {
        this.particles.spawn('puff', body, s.x, s.y, 0, vx, vy, vz, { size: 1.6, grow: 1.5, life: 1.4, drag: 1.8, color: 0xd8cfc0 });
      }
    }
  }

  // ---- per-frame -------------------------------------------------------------

  update(dt) {
    this.time += dt;
    this.lastDt = dt;
    const f = this.flight;
    const s = f.state;

    if (this.mode === 'drive' || this.drive.active) {
      this.updateDriving(dt);
      return;
    }
    // The garage door keeps moving after the buggy is back (it closes behind it, #38).
    this.drive.animateDoor(dt);

    // The first sight of a marker may pause to explain it (#33); steering or GO ends it (fly).
    const steering = this.input.left || this.input.right || this.input.go;
    this.updateExplain(dt, steering);
    this.fly(dt);

    if (!this.pause) this.checkGoals();
    this.updateMood();

    // Positions.
    if (this.mode === 'map') {
      this.easeMap(dt);
      this.glideMap(dt);
    }
    const rw = f.worldPos(this.tmp);
    if (this.mode === 'flight') {
      this.origin.x = rw.x;
      this.origin.y = rw.y;
    } else {
      const fw = this.mapFocus.worldPos(s.t, this.tmp2);
      this.origin.x = fw.x + this.pan.x;
      this.origin.y = fw.y + this.pan.y;
    }
    this.placeBodies(s.t);
    this.placeRocket(rw);
    this.updateEffects(dt);
    this.updateCamera(dt);
    this.updateLines();
    this.sky.position.copy(this.camera.position);
    this.updateAtmospheres();
    this.updateMarkers();
    this.updateUnderwater(dt);
    this.updateHaze();
    this.app.audio.setEngine(this.crashed ? 0 : f.throttle);
  }

  /** Into or out of a sea (#44): fog, tint, stars and muffling. `look`: the liquid's LOOKS entry. */
  setUnderwater(under, look) {
    this.underwater = under;
    const fog = this.scene.fog;
    if (under) {
      fog.color.set(look.fog);
      fog.near = 1.5;
      fog.far = look.fogFar;
      this.scene.background.copy(fog.color);
    } else {
      fog.near = FOG_OFF;
      fog.far = FOG_OFF * 2;
      this.scene.background.copy(this.spaceColour);
    }
    this.sky.visible = !under;
    const tint = document.getElementById('underwater');
    tint?.classList.toggle('on', under);
    // (Under Misty's methane, #46, a dark amber tint instead of blue.)
    if (under) tint?.classList.toggle('amber', look.tint === 'amber');
    this.app.audio.setUnderwater(under);
  }

  /**
   * Misty's thick orange haze (#46), only the look: near its ground (driving, landed, or flying
   * low) the sky turns hazy orange, even by day, the stars fade out, and the distance fogs over
   * in the same colour. It thins out as the camera climbs, gone by `HAZE.top` metres up. It
   * reuses the scene's always-there fog (#44), so no material changes; nothing is allocated.
   * Under a methane lake the underwater fog wins.
   */
  updateHaze() {
    const s = this.flight.state;
    const body = this.drive.active ? this.drive.buggy.body : s.body;
    let k = 0;
    const v = body.haze && this.mode !== 'map' && !this.underwater ? this.visuals.find((x) => x.body === body) : null;
    const c = this.camera.position;
    if (v) {
      const g = v.group.position;
      const r = Math.hypot(c.x - g.x, c.y - g.y, c.z - g.z);
      const t = Math.max(0, Math.min(1, (r - body.radius - HAZE.low) / (HAZE.top - HAZE.low)));
      k = 1 - t * t * (3 - 2 * t);
    }
    if (k === this.haze && k === 0) return;
    this.haze = k;
    // Down in it, the fog is the haze; the shell seen from so close would only glare.
    if (v) this.hazeShell = v.atmosphere;
    if (this.hazeShell) this.hazeShell.material.uniforms.fade.value = 1 - 0.85 * k;
    if (this.underwater) return;
    const fog = this.scene.fog;
    if (k < 0.01) {
      fog.near = FOG_OFF;
      fog.far = FOG_OFF * 2;
      this.scene.background.copy(this.spaceColour);
      this.sky.visible = true;
      return;
    }
    // Dimmer on the night side (the sun's direction from the world against the camera's "up").
    const g = v.group.position, sun = this.sunVisual.group.position;
    const ux = c.x - g.x, uy = c.y - g.y, uz = c.z - g.z;
    const sx = sun.x - g.x, sy = sun.y - g.y, sz = sun.z - g.z;
    const cos = (ux * sx + uy * sy + uz * sz) / ((Math.hypot(ux, uy, uz) * Math.hypot(sx, sy, sz)) || 1);
    const day = 0.3 + 0.7 * Math.max(0, Math.min(1, (cos + 0.2) / 0.5));
    fog.color.set(body.haze).multiplyScalar(day);
    fog.near = HAZE.near / k;
    fog.far = HAZE.far / k;
    this.scene.background.copy(this.spaceColour).lerp(fog.color, k);
    this.sky.visible = k < 0.6;
  }

  /** Leaving the flight screen: out of any sea, and no more lapping (or lava's hiss). */
  dryOff() {
    if (this.underwater) this.setUnderwater(false);
    this.app.audio.setLapping(0);
    this.app.audio.setBubbling(0);
  }

  /**
   * The camera under a sea (#44): blue fog and tint, the stars hidden, the music and sounds
   * muffled. And, near a sea, the gentle lapping of the waves (checked a few times a second;
   * by lava, #45, its bubbling hiss).
   */
  updateUnderwater(dt) {
    const s = this.flight.state;
    const body = this.drive.active ? this.drive.buggy.body : s.body;
    const v = body.liquid && this.mode !== 'map' ? this.visuals.find((x) => x.body === body) : null;
    let under = false;
    if (v?.liquid) {
      // The camera and the world's middle are both in scene coordinates (floating origin).
      const c = this.camera.position, g = v.group.position;
      const x = c.x - g.x, y = c.y - g.y, z = c.z - g.z;
      const r = Math.hypot(x, y, z);
      under = r < body.liquidR && body.liquidDepth(x / r, y / r, z / r) > 0;
    }
    if (under !== this.underwater) this.setUnderwater(under, v?.liquid.look);
    // Lapping waves: by the sea (driving, or the rocket low over it or standing near it).
    this.lapWait -= dt;
    if (this.lapWait > 0) return;
    this.lapWait = 0.4;
    let near = 0;
    if (body.liquid && this.app.screen === 'flight' && !this.crashed) {
      if (this.drive.active) near = under ? 0.3 : body.nearLiquid(this.drive.buggy.p);
      else if (s.body === body && (s.landed || this.flight.altitude < 30)) near = body.nearLiquid([s.x, s.y, 0]) * (s.landed ? 1 : 0.6);
    }
    // By lava (#45) it's a low bubbling hiss instead of waves.
    const lava = body.liquid?.kind === 'lava';
    // Misty's methane lakes (#46) are nearly still: only a faint lapping.
    this.app.audio.setLapping(lava ? 0 : near * (body.liquid?.kind === 'methane' ? 0.4 : 1));
    this.app.audio.setBubbling(lava ? near : 0);
  }

  /**
   * The flight's part of a frame (headless: no three.js here): controls, time warp (and fast
   * travel), the helper, the sim, rewind history and the predicted path.
   */
  fly(dt) {
    const f = this.flight;
    const ap = this.autopilot;
    const s = f.state;
    // Manual controls take over from the helpers (a coach just talks, so you keep flying).
    const manualTurn = (this.input.left ? 1 : 0) - (this.input.right ? 1 : 0);
    const manual = manualTurn !== 0 || this.input.go;
    // Steering or GO ends a pause at once, and takes over from fast travel (#27).
    if (this.pause && (manual || this.crashed)) this.endPause();
    if (manual) this.clearClock();
    const paused = !!this.pause;
    if (manual && ap.driving && !ap.coachSession) ap.stop();
    // After a coached touchdown, a GO still held from the last pulse mustn't hop us back up.
    if (!this.input.go) this.goLatched = false;
    if (!ap.driving) {
      f.turn = manualTurn;
      f.targetAngle = null;
      f.throttle = this.input.go && !this.goLatched && !this.crashed ? goThrottle(ap.goPower, this.input.fine) : 0;
      if (f.throttle > 0) this.warpIndex = 0;
    } else {
      f.turn = 0;
    }

    let warp = f.throttle > 0 && !ap.driving ? 1 : this.warp;
    // Fast travel (#27): as fast as the ⏰ allows, stepping down as it comes closer.
    if (this.clock && !paused) {
      const tw = travelWarp(this.clock.t - s.t, dt, WARP_LEVELS);
      this.warpIndex = tw.index;
      warp = tw.warp;
    }
    // Slow down time before something important happens (a new world, or the ground).
    if (this.prediction && warp > 1 && !s.landed) {
      const seg = this.prediction.segments[0];
      if (seg && seg.end !== 'none' && seg.t0 <= s.t) {
        const left = seg.t1 - s.t;
        const cap = Math.max(1, left / 2.5);
        if (cap < warp) {
          warp = cap;
          if (!ap.active) this.warpIndex = Math.max(0, WARP_LEVELS.findLastIndex((w) => w <= cap));
        }
      }
    }
    if (!this.crashed && !paused) {
      this.updateCoaching(dt);
      ap.update(dt);
      f.step(dt, warp);
      if (this.clock && arrived(this.clock.t - s.t)) this.arrive();
    }

    // Rewind history.
    if (!paused) this.snapTimer += dt;
    if (this.snapTimer > 0.5 && !this.crashed) {
      this.snapTimer = 0;
      this.snapshots.push(f.snapshot());
      if (this.snapshots.length > 90) this.snapshots.shift();
    }

    // Predicted path.
    this.predTimer -= dt;
    if (!s.landed && !this.crashed && !paused && (this.predTimer <= 0 || f.throttle > 0)) {
      this.predTimer = 0.2;
      this.prediction = predict(s, { target: this.target, maxSegments: 4, maxTime: 40000 });
    } else if (s.landed) {
      this.prediction = null;
    }
    // The path changed under the ⏰ (a crash now comes first, or we landed): stop there.
    if (this.clock && !clockOnPath(this.prediction?.segments, this.clock.t, s.t)) this.clearClock();
  }

  /**
   * First sight of a marker (#33): once one kind has been on screen for a moment and nothing
   * urgent is going on (the pure rules are in src/ui/markers.js), pause and let Pip explain it.
   * Each kind only once (saved); the pause ends when Pip has said it, on any tap, or after
   * MAX_PAUSE at the latest.
   */
  updateExplain(dt, steering) {
    for (const kind of FIRST_SIGHT) this.kindTime[kind] = this.kindsShown.has(kind) ? (this.kindTime[kind] || 0) + dt : 0;
    const ex = this.pause;
    if (ex) {
      ex.t += dt;
      // An explanation never pauses for long; after fast travel we wait for the child (#27).
      if (ex.why === 'explain' && ex.t > MAX_PAUSE) this.endPause();
      return;
    }
    const app = this.app;
    const ap = this.autopilot;
    const c = this.calm;
    c.screen = app.screen;
    c.mode = this.mode;
    c.crashed = this.crashed;
    c.speaking = app.speech.busy;
    c.throttle = this.flight.throttle;
    c.steering = steering;
    c.sinceLast = this.time - this.lastExplain;
    c.helper = null;
    if (ap.active) {
      const h = this.calmHelper;
      h.mode = ap.mode;
      h.coach = !!ap.coachSession;
      h.throttle = ap.cmd.throttle;
      h.aiming = ap.cmd.angle !== null;
      h.tricky = ap.warp !== null && ap.warp <= 1;
      c.helper = h;
    }
    const kind = pickExplanation(this.kindTime, (k) => app.progress.explained(k), c);
    if (kind) this.explain(kind, true);
  }

  /** Pip explains a kind of marker (first sight, with `pause`, or tapped): it glows meanwhile. */
  explain(kind, pause = false) {
    const app = this.app;
    const line = MARKER_LINES[kind];
    if (!line) return;
    app.progress.markExplained(kind);
    // Keyed, so tapping again (or another marker) doesn't stack lines up.
    const said = app.pip(line, { speak: true, key: 'marker', onStart: () => (this.highlight = kind) });
    if (!said) return;
    if (pause) {
      this.pause = { why: 'explain', kind, t: 0 };
      this.showKind(kind);
    }
    app.afterPip(() => {
      if (this.highlight === kind) this.highlight = null;
      if (this.pause?.why === 'explain' && this.pause.kind === kind) this.endPause();
    });
  }

  /**
   * On the map, glide a marker out from under Pip's bubble or the thumbs to just below the
   * middle, so the child can see what Pip is talking about.
   */
  showKind(kind) {
    const at = this.kindAt[kind];
    if (this.mode !== 'map' || !at) return;
    const W = window.innerWidth, H = window.innerHeight;
    if (at.sx > W * 0.2 && at.sx < W * 0.8 && at.sy > H * 0.4 && at.sy < H * 0.72) return;
    const perPx = (2 * this.mapDist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / H;
    this.mapEase = false;
    this.panGlide = { x: this.pan.x + at.x, y: this.pan.y + at.y + H * 0.08 * perPx, t: 0 };
  }

  glideMap(dt) {
    const g = this.panGlide;
    if (!g) return;
    const k = 1 - Math.exp(-dt * 4);
    this.pan.x += (g.x - this.pan.x) * k;
    this.pan.y += (g.y - this.pan.y) * k;
    g.t += dt;
    if (g.t > 2.5 || this.mode !== 'map') this.panGlide = null;
  }

  endPause() {
    this.pause = null;
    this.lastExplain = this.time;
  }

  // ---- fast travel (#27) ---------------------------------------------------

  /**
   * A tap on the map that wasn't a pan (from the HUD's gestures). On the path, and with no
   * helper flying: drop the ⏰ there and travel to it at once (a later tap moves it).
   * Returns whether it did.
   */
  tapMap(sx, sy) {
    const s = this.flight.state;
    const c = { mode: this.mode, crashed: this.crashed, landed: s.landed, helper: this.autopilot.active };
    if (!clockAllowed(c) || !this.prediction) return false;
    const win = clockWindow(this.prediction.segments, s.t);
    if (!win) return false;
    const frames = this.segmentFrames();
    const paths = frames.map((f) => {
      const { t0, t1 } = f.seg;
      const pts = [];
      const a = Math.max(t0, win[0]), b = Math.min(t1, win[1]);
      if (b <= a) return pts;
      const n = 400;
      for (let k = 0; k <= n; k++) {
        const t = a + ((b - a) * k) / n;
        const q = this.screenAt(frames, t);
        pts.push(q && { x: q.x, y: q.y, t });
      }
      return pts;
    });
    const hit = pickOnPath(paths, sx, sy, TAP_RADIUS, (t) => (t >= win[0] && t <= win[1] ? this.screenAt(frames, t) : null));
    if (!hit) return false;
    this.setClock(hit.t);
    return true;
  }

  /** Where the path is at game time t, in scene coordinates (null if it isn't drawn there). */
  pathAt(frames, t) {
    const f = frames.find((fr) => t >= fr.seg.t0 && t <= fr.seg.t1);
    if (!f) return null;
    const { seg } = f;
    const p = propagate(seg.body.mu, seg.start.x, seg.start.y, seg.start.vx, seg.start.vy, t - seg.t0, this.tmp3);
    return f.at(p.x, p.y, t);
  }

  /** The path at game time t on screen, in px (null if it's off screen). */
  screenAt(frames, t) {
    const q = this.pathAt(frames, t);
    if (!q) return null;
    const v = new THREE.Vector3(q.x, q.y, 0).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  /** Put the ⏰ at game time t and set off: time speeds up until we get there. */
  setClock(t) {
    this.clock = { t };
    this.manualWarp = false;
    this.app.audio.play('warp');
    // The first time, Pip says what it does (and that tapping it stops it), with the map
    // gliding the ⏰ out from under her bubble.
    if (this.app.progress.explained('clock')) return;
    this.explain('clock');
    const frames = this.segmentFrames();
    const q = this.pathAt(frames, t), scr = this.screenAt(frames, t);
    if (q && scr) {
      this.kindAt.clock = { x: q.x, y: q.y, sx: scr.x, sy: scr.y };
      this.showKind('clock');
    }
  }

  /** Stop travelling and take the ⏰ away (back to normal speed, unless `resetWarp` is false). */
  clearClock(resetWarp = true) {
    if (!this.clock) return;
    this.clock = null;
    if (resetWarp) this.warpIndex = 0;
  }

  /** Tapping the ⏰ takes it away. */
  tapClock() {
    this.clearClock();
    this.app.audio.play('unwarp');
  }

  /** We got to the ⏰: pause, so the child can do what they came for. Any tap, turn or GO carries on. */
  arrive() {
    this.clock = null;
    this.warpIndex = 0;
    this.pause = { why: 'arrived', t: 0 };
    this.app.audio.play('unwarp');
    this.app.pip('We\'re here! Take your time.', { speak: true, key: 'clock' });
  }

  /** Buggy time: the rocket waits on the pad while we drive around. */
  updateDriving(dt) {
    const f = this.flight;
    const s = f.state;
    f.throttle = 0;
    f.turn = 0;
    f.targetAngle = null;
    f.step(dt, 1);
    this.prediction = null;
    this.drive.update(dt, this.input);
    if (!this.drive.active) return; // just parked
    this.origin.x = this.drive.world.x;
    this.origin.y = this.drive.world.y;
    this.drive.place(this.input);
    this.placeBodies(s.t);
    this.placeRocket(f.worldPos(this.tmp));
    this.particles.update(dt, s.t, this.origin);
    this.drive.updateCamera(dt, this.camera);
    this.camera.far = 3e6;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.updateLines();
    this.sky.position.copy(this.camera.position);
    this.updateAtmospheres();
    this.updateMarkers();
    this.updateMood();
    this.updateUnderwater(dt);
    this.checkBand(dt, this.drive.buggy?.body === this.system.home);
  }

  checkGoals() {
    const f = this.flight;
    const s = f.state;
    const p = this.app.progress;
    const home = this.system.home;
    if (s.crashed) {
      this.gapAt = null;
      return;
    }
    if (s.body === home && !s.landed && f.altitude > home.spaceLine) p.earn('space');
    if (s.body === home && inStableOrbit(f)) p.earn('orbit');
    if (s.body.kind === 'star' && Math.hypot(s.x, s.y) < s.body.radius * 3) p.earn('sun');
    this.checkDiscoveries();
    this.checkBand(this.lastDt ?? 0, s.body === home && s.landed);
  }

  /**
   * Discoveries found while flying (#15): diving through the gap between Ringo and its rings
   * (counted a few seconds later, if we didn't crash), and Ember's solar flares up close.
   */
  checkDiscoveries() {
    const s = this.flight.state;
    const p = this.app.progress;
    const last = this.lastPos;
    if (!p.has('find-ring-gap')) {
      if (last.body === s.body && !s.landed && ringGapCrossed(s.body, last.x, last.y, s.x, s.y)) this.gapAt = s.t;
      if (this.gapAt !== null && s.t < this.gapAt) this.gapAt = null; // rewound
      if (this.gapAt !== null && s.t > this.gapAt + 4) {
        this.gapAt = null;
        this.found('find-ring-gap');
      }
    }
    last.body = s.body;
    last.x = s.x;
    last.y = s.y;
    if (!p.has('find-flare') && flareSeen(s)) this.found('find-flare');
  }

  updateMood() {
    const f = this.flight;
    const s = f.state;
    let mood = 'space';
    if (this.time < this.discoverUntil) mood = 'discover';
    else if (s.body === this.system.home && (s.landed || f.altitude < this.system.home.spaceLine)) mood = 'camp';
    else if (s.landed) mood = 'discover';
    this.app.audio.setMood(mood);
  }

  mapScale(body) {
    if (this.mode !== 'map') return 1;
    const dist = this.camera.position.z;
    const pxPerUnit = window.innerHeight / (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    const px = body.radius * pxPerUnit;
    const min = body.kind === 'star' ? 14 : 7;
    return px < min ? min / px : 1;
  }

  placeBodies(t) {
    const tmp = this.tmp2;
    for (const v of this.visuals) {
      v.body.worldPos(t, tmp);
      v.group.position.set(tmp.x - this.origin.x, tmp.y - this.origin.y, 0);
      v.group.scale.setScalar(this.mapScale(v.body));
      if (v.env) {
        // For the comet's tails: Ember sits at the world's middle, and which way are we going?
        const d = Math.hypot(tmp.x, tmp.y);
        v.env.toSun.set(-tmp.x / d, -tmp.y / d, 0);
        v.env.dist = d;
        v.body.relVel(t, tmp);
        v.env.back.set(-tmp.x, -tmp.y, 0).normalize();
        v.env.scale = v.group.scale.x;
      }
      for (const u of v.updates) u(this.time);
      if (v.landmarks) {
        // Ember's flares rise on the rocket's side when it's in Ember's space.
        const s = this.flight.state;
        const ctx = this.landmarkCtx;
        ctx.aim = s.body === v.body ? Math.atan2(s.y, s.x) : null;
        // Friends (#16) wave when the buggy comes close, and bounce about at the Full Band.
        const b = this.drive.active ? this.drive.buggy : null;
        this.buggyAt.body = b?.body ?? null;
        this.buggyAt.p = b?.p ?? null;
        ctx.listener = b ? this.buggyAt : null;
        ctx.party = this.time < this.bandUntil;
        v.landmarks.update(this.time, t, ctx);
      }
    }
  }

  placeRocket(rw) {
    const s = this.flight.state;
    const g = this.rocketHolder;
    g.position.set(rw.x - this.origin.x, rw.y - this.origin.y, 0);
    g.rotation.z = s.angle - Math.PI / 2;
    if (s.landed && this.flight.throttle > 0) {
      g.position.x += (Math.random() - 0.5) * 0.15;
      g.position.y += (Math.random() - 0.5) * 0.15;
    }
    for (const fl of this.flames) fl.update(this.crashed ? 0 : this.flight.throttle, this.time);
    for (const [i, l] of this.rocket.lights.entries()) l.visible = Math.sin(this.time * 3 + i * 1.7) > -0.3;
    this.rocket.group.traverse((o) => {
      if (o.userData.pip) o.rotation.y = Math.sin(this.time * 0.8) * 0.5;
    });
    // In the map, the rocket shows as a marker instead.
    g.visible = !this.crashed && this.mode !== 'map';
  }

  updateEffects(dt) {
    const f = this.flight;
    const s = f.state;
    if (!this.crashed && f.throttle > 0) {
      const alt = f.altitude;
      const up = Math.atan2(s.y, s.x);
      if (s.body.solid && alt < 28 && Math.random() < dt * 40 * f.throttle) {
        // Clouds of dust rolling along the ground.
        const side = Math.random() < 0.5 ? -1 : 1;
        const tx = -Math.sin(up) * side, ty = Math.cos(up) * side;
        const gr = s.body.surfaceAt(up);
        const sp = 6 + Math.random() * 8;
        this.particles.spawn('puff', s.body, Math.cos(up) * (gr + 1), Math.sin(up) * (gr + 1), (Math.random() - 0.5) * 4,
          tx * sp, ty * sp, (Math.random() - 0.5) * 6, { size: 2.2, grow: 2.2, life: 2.2, drag: 1.1, color: s.body.id === 'homestead' ? 0xf4ede0 : s.body.color });
      }
      if (Math.random() < dt * 25) {
        const back = s.angle + Math.PI + (Math.random() - 0.5) * 0.5;
        const sp = 10 + Math.random() * 8;
        this.particles.spawn('spark', s.body, s.x + Math.cos(back) * 1.5, s.y + Math.sin(back) * 1.5, 0,
          Math.cos(back) * sp + s.vx, Math.sin(back) * sp + s.vy, (Math.random() - 0.5) * 3, { size: 0.9, grow: -0.5, life: 0.6, drag: 0 });
      }
    }
    this.particles.update(dt, s.t, this.origin);
    this.debris.update(dt, s.t, this.origin);
  }

  updateCamera(dt) {
    const cam = this.camera;
    const f = this.flight;
    const s = f.state;
    if (this.mode === 'flight') {
      // "Down" points at the world we're near. Far out in space we keep the view steady,
      // and when a new world takes over we turn gently instead of flipping around.
      const alt = Math.max(0, f.altitude);
      const up = Math.atan2(s.y, s.x);
      const near = alt < s.body.radius * 2.5 || s.landed;
      if (this.camUpAngle === undefined) this.camUpAngle = up;
      if (near) {
        const diff = Math.atan2(Math.sin(up - this.camUpAngle), Math.cos(up - this.camUpAngle));
        const closeness = 1 - Math.min(1, alt / (s.body.radius * 2.5));
        const rate = s.landed || alt < 30 ? 6 : 0.4 + 2.5 * closeness;
        this.camUpAngle += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt, Math.abs(diff) * (1 - Math.exp(-dt * 4)) + 0.001);
      }
      this.camUp.set(Math.cos(this.camUpAngle), Math.sin(this.camUpAngle), 0);
      const dist = flightDist(flightAutoDist(alt), this.zoom);
      const axis = new THREE.Vector3(Math.cos(s.angle), Math.sin(s.angle), 0);
      const centre = this.crashed ? new THREE.Vector3() : axis.multiplyScalar(this.rocket.height * 0.5);
      cam.up.copy(this.camUp);
      cam.position.copy(centre).addScaledVector(this.camUp, dist * 0.3).add(new THREE.Vector3(0, 0, dist * 0.95));
      cam.lookAt(centre.clone().addScaledVector(this.camUp, dist * 0.12));
      cam.near = Math.max(0.2, dist * 0.01);
    } else {
      const dist = this.mapDist;
      cam.up.set(0, 1, 0);
      cam.position.set(0, 0, dist);
      cam.lookAt(0, 0, 0);
      cam.near = Math.max(1, dist * 0.001);
    }
    cam.far = 3e6;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  updateAtmospheres() {
    const sun = this.visuals.find((v) => v.body.kind === 'star').group.position;
    const view = this.camera.matrixWorldInverse;
    const d = new THREE.Vector3();
    for (const v of this.visuals) {
      if (!v.sunDir) continue;
      d.copy(sun).sub(v.group.position).normalize().transformDirection(view);
      v.sunDir.copy(d);
      if (v.atmosphere) v.atmosphere.material.uniforms.sunDir.value.copy(d);
    }
  }

  /**
   * How to draw each predicted segment so the whole path is one unbroken line.
   * - The first segment is drawn around the world we're in, where it is now.
   * - Dropping into a moon: drawn as seen from the planet (the moon's motion is added in),
   *   so the path carries straight on and meets the ghost moon where it will really be.
   * - Climbing out to a parent: shifted to start exactly where the previous piece ends.
   */
  segmentFrames() {
    const pred = this.prediction;
    const s = this.flight.state;
    if (!pred) return [];
    const frames = [];
    let prev = null;
    for (const seg of pred.segments) {
      let anchor, chain;
      if (!prev) {
        const w = seg.body.worldPos(s.t, {});
        anchor = { x: w.x - this.origin.x, y: w.y - this.origin.y };
        chain = [];
      } else if (seg.body.parent === prev.seg.body) {
        anchor = prev.anchor;
        chain = [seg.body, ...prev.chain];
      } else if (prev.chain.length) {
        anchor = prev.anchor;
        chain = prev.chain.slice(1);
      } else {
        const p = prev.seg.body.relPos(seg.t0);
        anchor = { x: prev.anchor.x - p.x, y: prev.anchor.y - p.y };
        chain = [];
      }
      const offset = (t) => {
        let x = 0, y = 0;
        for (const c of chain) {
          const q = c.relPos(t);
          x += q.x;
          y += q.y;
        }
        return { x, y };
      };
      // Local point (in seg.body's frame) at time t -> scene position.
      const at = (lx, ly, t) => {
        const o = offset(t);
        return { x: anchor.x + o.x + lx, y: anchor.y + o.y + ly };
      };
      prev = { seg, anchor, chain, moving: chain.length > 0, offset, at };
      frames.push(prev);
    }
    return frames;
  }

  /** Scene-relative points for a segment (relative to its frame anchor). */
  segmentPolyline(f) {
    const { seg } = f;
    const pts = [];
    if (!f.moving) {
      const pts2 = segmentPoints(seg, seg.body.kind === 'star' ? 400 : 200);
      for (let k = 0; k < pts2.length; k += 2) pts.push(pts2[k], pts2[k + 1], 0);
      return pts;
    }
    const steps = 160;
    const tmp = {};
    for (let k = 0; k <= steps; k++) {
      const dt = ((seg.t1 - seg.t0) * k) / steps;
      propagate(seg.body.mu, seg.start.x, seg.start.y, seg.start.vx, seg.start.vy, dt, tmp);
      const o = f.offset(seg.t0 + dt);
      pts.push(tmp.x + o.x, tmp.y + o.y, 0);
    }
    return pts;
  }

  /** When to show the ghost of a moon we're heading into: closest approach or the bump. */
  ghostTime(seg) {
    const pe = seg.el.timeToPe;
    if (seg.end === 'impact' || pe === null || seg.t0 + pe > seg.t1) return seg.t1;
    return seg.t0 + pe;
  }

  updateLines() {
    const map = this.mode === 'map';
    const s = this.flight.state;
    // Planet and moon orbits: bold in the map, faint trails in the flight view.
    for (const [b, line] of this.orbitLines) {
      const w = b.parent.worldPos(s.t, this.tmp2);
      line.position.set(w.x - this.origin.x, w.y - this.origin.y, 0);
      const target = b === this.target;
      line.material.opacity = map ? (target ? 0.9 : 0.35) : target ? 0.35 : 0.16;
      line.material.linewidth = map ? (target ? 3 : 2) : 1.5;
    }
    // Predicted path (geometry only rebuilt when the prediction changes).
    const pred = this.prediction;
    const frames = this.segmentFrames();
    const rebuild = pred !== this.drawnPrediction;
    this.drawnPrediction = pred;
    for (let i = 0; i < Math.max(frames.length, this.segLines.length); i++) {
      if (i >= frames.length) {
        this.segLines[i].visible = false;
        continue;
      }
      const f = frames[i];
      const seg = f.seg;
      let line = this.segLines[i];
      if (rebuild || !line) {
        const pts = this.segmentPolyline(f);
        const color = seg.end === 'impact' ? 0xff8a65 : SEG_COLORS[i % SEG_COLORS.length];
        if (!line) {
          line = this.makeLine(pts, color, 3.5);
          this.segLines.push(line);
        } else {
          line.geometry.dispose();
          line.geometry = new LineGeometry();
          line.geometry.setPositions(pts);
          line.material.color.set(color);
        }
      }
      line.visible = !this.crashed;
      line.material.opacity = map ? 0.95 : 0.55;
      // Pip is saying "the line shows where we'll go" (#33): make it stand out.
      line.material.linewidth = (map ? 3.5 : 2.5) * (this.highlight === 'rocket' ? 1.8 : 1);
      line.position.set(f.anchor.x, f.anchor.y, 0);
      if (f.moving) {
        const g = f.at(0, 0, this.ghostTime(seg));
        this.showGhost(seg.body, g.x, g.y);
      }
    }
    for (const [b, g] of this.ghosts) {
      g.visible = g.userData.frame === this.time;
      g.scale.setScalar(this.mapScale(b));
    }
  }

  showGhost(body, x, y) {
    let g = this.ghosts.get(body);
    if (!g) {
      g = new THREE.Mesh(
        new THREE.SphereGeometry(body.radius, 32, 20),
        new THREE.MeshBasicMaterial({ color: body.color, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      this.scene.add(g);
      this.ghosts.set(body, g);
    }
    g.position.set(x, y, 0);
    g.userData.frame = this.time;
  }

  // ---- HTML markers (labels, high/low points, rocket icon) -------------------

  marker(key, className, html) {
    let el = this.markers.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = `marker ${className}`;
      el.innerHTML = html;
      this.labels.appendChild(el);
      this.markers.set(key, el);
    }
    el.dataset.frame = this.time;
    return el;
  }

  /**
   * A marker that explains itself (#33): tap it and Pip says what it is; it glows while Pip
   * does. Placed like placeMarker; notes that its kind is on screen.
   */
  kindMarker(key, className, html, kind, x, y, z = 0, onTap = null) {
    const el = this.marker(key, `${className} tap`, html);
    el.dataset.kind = kind;
    if (!el.onclick) {
      el.onclick = (e) => {
        e.stopPropagation();
        this.app.audio.play('tap');
        // Most markers explain themselves; the ⏰ goes away (its line says so, #27).
        if (onTap) onTap();
        else this.explain(el.dataset.kind);
      };
    }
    el.classList.toggle('explain', this.highlight === kind);
    const scr = this.placeMarker(el, x, y, z);
    if (scr && !this.kindsShown.has(kind)) {
      this.kindsShown.add(kind);
      const at = (this.kindAt[kind] ??= { x: 0, y: 0, sx: 0, sy: 0 });
      at.x = x;
      at.y = y;
      at.sx = scr.sx;
      at.sy = scr.sy;
    }
    return scr;
  }

  placeMarker(el, x, y, z = 0) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const off = v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2;
    el.style.display = off ? 'none' : '';
    if (off) return null;
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    return { sx, sy };
  }

  updateMarkers() {
    const map = this.mode === 'map';
    const s = this.flight.state;
    const tmp = this.tmp2;
    this.kindsShown.clear();
    if (map) {
      // World labels: tap one to pick it. Where they crowd together (a moon by its planet),
      // the less important ones shrink to their icon or hide (#33).
      const crowd = [];
      for (const v of this.visuals) {
        const b = v.body;
        const el = this.marker(`body-${b.id}`, 'body-label', `<span class="icon">${b.icon}</span><span class="name">${b.name}</span>`);
        if (!el.onclick) el.onclick = (e) => { e.stopPropagation(); this.app.audio.play('tap'); this.setTarget(b); };
        el.classList.toggle('targeted', b === this.target);
        if (!el.labelSize) {
          // Measured once (full, then icon-only): its text never changes.
          el.classList.remove('mini');
          const full = [el.offsetWidth, el.offsetHeight];
          el.classList.add('mini');
          el.labelSize = [...full, el.offsetWidth, el.offsetHeight];
          el.classList.remove('mini');
        }
        b.worldPos(s.t, tmp);
        const sc = this.mapScale(b);
        const scr = this.placeMarker(el, tmp.x - this.origin.x, tmp.y - this.origin.y - b.radius * sc * 1.05);
        if (!scr) continue;
        const [w, h, mw, mh] = el.labelSize;
        crowd.push({ id: b.id, el, rank: labelRank(b, { target: this.target, focus: this.mapFocus, here: s.body }), x: scr.sx, y: scr.sy, w, h, mw, mh });
      }
      const how = declutterLabels(crowd);
      for (const it of crowd) {
        const h = how.get(it.id);
        it.el.classList.toggle('mini', h === 'mini');
        if (h === 'hidden') it.el.style.display = 'none';
      }
      const segs = this.prediction?.segments || [];
      const frames = this.segmentFrames();
      frames.forEach((f, i) => {
        const { seg } = f;
        const el = seg.el;
        const span = seg.t1 - seg.t0;
        // ▲ ▼ only where we are now and at the world we picked: the ones along the way were clutter.
        const apsides = i === 0 || seg.body === this.target;
        const radial = !f.moving && nearRadial(seg);
        const apex = radial && apsides ? radialApex(seg) : null;
        if (apex) {
          // Straight up: the conic is a line, so find the top of the climb in time instead.
          const q = f.at(apex.x, apex.y, seg.t0 + apex.t);
          this.kindMarker(`ap-${i}`, 'apsis', '▲', 'high', q.x, q.y);
        } else if (apsides && !radial && !f.moving && el.e < 1 && el.ra < seg.body.soi && el.timeToAp !== null && (seg.closed || el.timeToAp < span)) {
          const p = pointAt(el, Math.PI);
          const q = f.at(p.x, p.y, seg.t0 + el.timeToAp);
          this.kindMarker(`ap-${i}`, 'apsis', '▲', 'high', q.x, q.y);
        }
        if (apsides && el.timeToPe !== null && (seg.closed || el.timeToPe < span) && seg.end !== 'impact') {
          const p = pointAt(el, 0);
          const q = f.at(p.x, p.y, seg.t0 + el.timeToPe);
          this.kindMarker(`pe-${i}`, 'apsis low', '▼', 'low', q.x, q.y);
        }
        if (seg.end === 'impact') {
          const q = f.at(seg.endState.x, seg.endState.y, seg.t1);
          this.kindMarker(`impact-${i}`, 'event', '💥', 'impact', q.x, q.y);
        }
        if (f.moving && seg.body === this.target) {
          const g = f.at(0, 0, this.ghostTime(seg));
          this.kindMarker(`meet-${i}`, 'event meet', `✨ ${seg.body.name}!`, 'meet', g.x, g.y - seg.body.radius * this.mapScale(seg.body) * 1.4);
        }
      });
      const closest = this.prediction?.closest;
      const meets = segs.some((seg) => seg.body === this.target);
      if (closest && this.target && !meets) {
        const w = closest.body.worldPos(s.t, {});
        this.kindMarker('near', 'event near', '🎯', 'near', w.x - this.origin.x + closest.rocket.x, w.y - this.origin.y + closest.rocket.y);
      }
      if (this.autopilot.marker) {
        const m = this.autopilot.marker;
        const w = m.body.worldPos(s.t, {});
        this.kindMarker('burn', 'event burn', '<span>🔥</span>', 'burn', w.x - this.origin.x + m.x, w.y - this.origin.y + m.y);
      }
      // Fast travel's ⏰ (#27), where the path will be at its time.
      const q = this.clock && this.pathAt(frames, this.clock.t);
      if (q) this.kindMarker('clock', 'event clock', '<span>⏰</span>', 'clock', q.x, q.y, 0, () => this.tapClock());
    }
    // Coach arrow: which way to point.
    const ap = this.autopilot;
    if (ap.coachSession && !ap.driving && ap.cmd.angle !== null && !this.crashed && !s.landed) {
      const rwp = this.flight.worldPos({});
      const mid = this.mode === 'map' ? 0 : this.rocket.height / 2;
      const c = { x: rwp.x - this.origin.x + Math.cos(s.angle) * mid, y: rwp.y - this.origin.y + Math.sin(s.angle) * mid };
      const centre = new THREE.Vector3(c.x, c.y, 0).project(this.camera);
      const tip = new THREE.Vector3(c.x + Math.cos(ap.cmd.angle), c.y + Math.sin(ap.cmd.angle), 0).project(this.camera);
      const dx = (tip.x - centre.x) * window.innerWidth, dy = -(tip.y - centre.y) * window.innerHeight;
      const el = this.marker('guide', 'guide-arrow', '<div class="ring"><div class="arrow"></div></div>');
      const scr = this.placeMarker(el, c.x, c.y);
      if (scr) el.firstChild.style.transform = `rotate(${Math.atan2(dx, -dy)}rad)`;
      const d = Math.atan2(Math.sin(ap.cmd.angle - s.angle), Math.cos(ap.cmd.angle - s.angle));
      el.classList.toggle('aligned', Math.abs(d) < 0.3);
    }

    // Velocity for the HUD dial: direction on screen, and whether a landing is looking safe.
    this.velocity = null;
    const speed = this.flight.speed;
    if (!this.crashed && !s.landed && speed > 0.3) {
      const rwp = this.flight.worldPos({});
      const c = { x: rwp.x - this.origin.x, y: rwp.y - this.origin.y };
      const va = Math.atan2(s.vy, s.vx);
      const centre = new THREE.Vector3(c.x, c.y, 0).project(this.camera);
      const tip = new THREE.Vector3(c.x + Math.cos(va), c.y + Math.sin(va), 0).project(this.camera);
      const dx = (tip.x - centre.x) * window.innerWidth, dy = -(tip.y - centre.y) * window.innerHeight;
      const b = s.body;
      const alt = this.flight.altitude;
      const vr = (s.x * s.vx + s.y * s.vy) / Math.hypot(s.x, s.y);
      const landing = b.solid && alt < Math.max(b.spaceLine * 1.5, 40) && vr < 0;
      let zone = 'fly';
      if (landing) {
        const safe = this.stats.safeSpeed;
        if (alt < 12) {
          zone = speed < safe * 0.7 ? 'good' : speed < safe ? 'ok' : 'bad';
        } else {
          // Higher up: can the engine still stop us before the ground?
          const brake = Math.max(0.5, this.stats.accel - this.flight.localGravity);
          const stop = (speed * speed) / (2 * brake);
          zone = stop < alt * 0.4 ? 'good' : stop < alt * 0.8 ? 'ok' : 'bad';
        }
      }
      this.velocity = { screenAngle: Math.atan2(dx, -dy), speed, zone, down: Math.max(0, -vr) };
    }

    // Driving: a pin over the parked rocket (stuck to the screen edge if it's out of view).
    if (this.mode === 'drive' && this.drive.active) {
      const foot = this.drive.rocketFoot();
      const w = s.body.worldPos(s.t, {});
      const up = foot.map((c) => c / Math.hypot(...foot));
      const p = new THREE.Vector3(w.x + foot[0] + up[0] * (this.rocket.height + 3) - this.origin.x, w.y + foot[1] + up[1] * (this.rocket.height + 3) - this.origin.y, foot[2] + up[2] * (this.rocket.height + 3));
      const v = p.clone().project(this.camera);
      const onScreen = v.z < 1 && Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.9;
      if (onScreen) this.kindMarker('home-pin', 'home-pin', '<span>🚀</span>', 'home', p.x, p.y, p.z);
      // Direction to the rocket for the HUD compass (flipped if it's behind us). Close by but
      // beside or behind it, the compass leads round to the front of the garage door (#37).
      const aim = this.drive.homeAim(foot);
      this.homeCompass = { angle: this.groundAngle(aim, w), visible: onScreen };
      this.secretCompass = this.compassTo(this.drive.nearest, w);
    } else {
      this.homeCompass = null;
      this.secretCompass = null;
    }

    // Rocket icon: always in the map; in flight when the rocket is too small to see.
    const rw = this.flight.worldPos({});
    const rel = { x: rw.x - this.origin.x, y: rw.y - this.origin.y };
    const camDist = this.camera.position.distanceTo(new THREE.Vector3(rel.x, rel.y, 0));
    const tiny = camDist > 900;
    if ((map || tiny) && !this.crashed) {
      const scr = this.kindMarker('rocket', 'rocket-marker', '<div class="arrow"></div>', 'rocket', rel.x, rel.y);
      const el = this.markers.get('rocket');
      if (scr) {
        const ahead = new THREE.Vector3(rel.x + Math.cos(s.angle) * 10, rel.y + Math.sin(s.angle) * 10, 0).project(this.camera);
        const ax = (ahead.x * 0.5 + 0.5) * window.innerWidth - scr.sx;
        const ay = (-ahead.y * 0.5 + 0.5) * window.innerHeight - scr.sy;
        el.firstChild.style.transform = `rotate(${Math.atan2(ax, -ay)}rad)`;
      }
    }
    for (const [key, el] of this.markers) {
      if (Number(el.dataset.frame) !== this.time) {
        el.remove();
        this.markers.delete(key);
      }
    }
  }

  /**
   * The on-planet compass (#15): which way on screen to the nearest target (a discovery now;
   * other kinds later, #16), how near it is (0 far .. 1 here), and a sparkle over it up close.
   * nearest: { target: { id, p, icon }, dist } in the world's frame; w: the world's position.
   */
  compassTo(nearest, w) {
    if (!nearest) return null;
    const tp = nearest.target.p;
    const l = Math.hypot(tp[0], tp[1], tp[2]);
    const lift = 5;
    const p = new THREE.Vector3(w.x + tp[0] * (1 + lift / l) - this.origin.x, w.y + tp[1] * (1 + lift / l) - this.origin.y, tp[2] * (1 + lift / l));
    const v = p.clone().project(this.camera);
    const onScreen = v.z < 1 && Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.9;
    if (onScreen && nearest.dist < 60) {
      // A secret (✨) or a friend (🎵): tap it and Pip says the compass hint again (#33).
      const kind = nearest.target.icon === '🎵' ? 'friend' : 'secret';
      this.kindMarker(`secret-pin-${kind}`, 'secret-pin', `<span>${nearest.target.icon}</span>`, kind, p.x, p.y, p.z);
    }
    return {
      angle: this.groundAngle(tp, w),
      near: Math.max(0, Math.min(1, 1 - nearest.dist / 150)),
      icon: nearest.target.icon,
    };
  }

  /**
   * Which way on screen a compass points to reach `target` (in the world's frame) from the
   * buggy: along the ground, round the world, not through it (#41). The screen direction of a
   * short step along groundHeading(), from just above the buggy.
   */
  groundAngle(target, w) {
    const b = this.drive.buggy;
    const up = vec.norm(b.p);
    const dir = groundHeading(b.p, target, b.f);
    const at = (k) => new THREE.Vector3(
      w.x + b.p[0] + up[0] + dir[0] * k - this.origin.x,
      w.y + b.p[1] + up[1] + dir[1] * k - this.origin.y,
      b.p[2] + up[2] + dir[2] * k,
    ).project(this.camera);
    const a = at(0), c = at(1);
    return Math.atan2((c.x - a.x) * window.innerWidth, (c.y - a.y) * window.innerHeight);
  }

  clearMarkers() {
    for (const el of this.markers.values()) el.remove();
    this.markers.clear();
  }
}
