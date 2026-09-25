// The flight: planets, rocket, flight camera + map camera, predicted path, markers,
// smoke & sparkles. Positions use a floating origin so huge distances stay precise.
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { Flight } from '../physics/sim.js';
import { predict, segmentPoints } from '../physics/predict.js';
import { Autopilot, inStableOrbit } from '../physics/autopilot.js';
import { pointAt } from '../physics/orbit.js';
import { buildRocket } from '../rocket/rocketMesh.js';
import { rocketStats } from '../rocket/parts.js';
import { createFlame, Particles, Debris } from '../world/effects.js';
import { createSky } from '../world/sky.js';

export const WARP_LEVELS = [1, 3, 10, 30, 100, 300, 1000];
const SEG_COLORS = [0xffe08a, 0x8fe3ff, 0xffa3d1, 0xb6ff9a];
const CONFETTI = [0xff6b6b, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xf78c6b, 0xc77dff];

export class FlightScene {
  constructor(app) {
    this.app = app;
    this.system = app.system;
    this.visuals = app.visuals;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1024);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 3e6);
    this.origin = { x: 0, y: 0 };
    this.mode = 'flight';
    this.zoom = 1;
    this.mapZoom = 1;
    this.pan = { x: 0, y: 0 };
    this.mapFocus = null;
    this.warpIndex = 0;
    this.target = null;
    this.input = { left: false, right: false, go: false };
    this.snapshots = [];
    this.snapTimer = 0;
    this.predTimer = 0;
    this.prediction = null;
    this.time = 0;
    this.camUp = new THREE.Vector3(0, 1, 0);
    this.tmp = {};
    this.tmp2 = {};
    this.discoverUntil = 0;

    for (const v of this.visuals) this.scene.add(v.group);
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
      const pts = [];
      for (let i = 0; i <= 256; i++) {
        const a = (i / 256) * Math.PI * 2;
        pts.push(Math.cos(a) * b.orbitRadius, Math.sin(a) * b.orbitRadius, 0);
      }
      const line = this.makeLine(pts, b.color, 2, 0.45);
      this.orbitLines.set(b, line);
    }
    this.ghosts = new Map();

    this.labels = document.getElementById('labels');
    this.markers = new Map();
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
    this.autopilot.stop();
    this.flight.resetToPad();
    this.crashed = false;
    this.debris.clear();
    this.rocketHolder.visible = true;
    this.snapshots = [];
    this.warpIndex = 0;
    this.mode = 'flight';
    this.app.hud.hideCrash();
  }

  // ---- actions (called by the HUD) ---------------------------------------

  toggleMap() {
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
      if (b.kind === 'star') extent = Math.max(extent, 38000);
    } else {
      extent = Number.isFinite(b.soi) ? Math.min(b.soi, b.radius * 12) : 38000;
    }
    const aspect = Math.min(1, this.camera.aspect);
    this.mapDist = extent / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / aspect;
    this.mapZoom = 1;
  }

  focusMapOn(body) {
    this.mapFocus = body;
    this.pan = { x: 0, y: 0 };
    this.fitMap();
  }

  cycleWarp(dir = 1) {
    if (this.flight.throttle > 0 && !this.autopilot.active) return;
    if (this.autopilot.active) this.autopilot.stop();
    this.warpIndex = (this.warpIndex + dir + WARP_LEVELS.length) % WARP_LEVELS.length;
    this.app.audio.play(dir > 0 && this.warpIndex > 0 ? 'warp' : 'unwarp');
  }

  get warp() {
    return this.autopilot?.warp ?? WARP_LEVELS[this.warpIndex];
  }

  rewind() {
    if (this.snapshots.length < 2) {
      this.resetToPad();
      return;
    }
    const back = Math.min(this.snapshots.length - 1, 10);
    const snap = this.snapshots[this.snapshots.length - 1 - back];
    this.snapshots.length = this.snapshots.length - back;
    this.autopilot.stop();
    this.flight.restore(snap);
    this.crashed = false;
    this.debris.clear();
    this.rocketHolder.visible = true;
    this.warpIndex = 0;
    this.prediction = null;
    this.app.hud.hideCrash();
    this.app.audio.play('rewind');
  }

  helper(mode) {
    if (this.crashed) return;
    if (this.autopilot.mode === mode) {
      this.autopilot.stop();
      return;
    }
    if (mode === 'goto' && !this.target) return;
    this.warpIndex = 0;
    this.autopilot.start(mode, mode === 'goto' ? this.target : null);
  }

  holdHelper(mode, on) {
    if (this.crashed) return;
    if (on) {
      this.warpIndex = 0;
      this.autopilot.start(mode);
    } else if (this.autopilot.mode === mode) {
      this.autopilot.stop();
    }
  }

  setTarget(body) {
    if (body && (body === this.target || body.kind === 'star')) body = null;
    this.target = body;
    this.prediction = null;
    this.app.hud.showTarget(body);
    if (body) this.app.pip(`That's ${body.name}! Tap "Take me there" to fly there.`, { speak: true });
  }

  // ---- events --------------------------------------------------------------

  onPilotMessage(m) {
    if (m.text) this.app.pip(m.text, { speak: true });
    if (m.visiting) this.discover(m.visiting);
  }

  discover(body) {
    this.discoverUntil = this.time + 40;
    this.app.audio.setMood('discover');
    void body;
  }

  onFlightEvent(type, d) {
    const app = this.app;
    switch (type) {
      case 'liftoff':
        if (d.body === this.system.home && this.flight.state.landAngle === Math.PI / 2 && !app.progress.has('space')) {
          app.pip('Blast off! Keep holding GO!', { speak: true });
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
          app.pip(`Back in ${d.to.name}'s space.`, { speak: false });
        }
        if (this.mode === 'map') this.focusMapOn(d.to);
        break;
      }
      case 'landed': {
        const b = d.body;
        app.audio.play('land');
        this.burst(b, 'dust');
        if (!d.afterFlight) break;
        if (d.splash) app.progress.earn('splash');
        const id = `land-${b.id}`;
        if (b === this.system.home && !app.progress.has('space')) {
          app.pip('Bump! Try flying higher next time!', { speak: true });
          break;
        }
        if (app.progress.earn(id)) {
          this.burst(b, 'confetti');
        } else {
          app.pip(`Touchdown on ${b.name}! ${b.icon}`, { speak: true });
        }
        this.warpIndex = 0;
        this.discover(b);
        break;
      }
      case 'crash': {
        this.crashed = true;
        this.warpIndex = 0;
        app.audio.play('crash');
        const s = this.flight.state;
        this.debris.explode(this.rocket, s.body, { x: s.x, y: s.y }, s.angle, Math.atan2(s.y, s.x));
        this.rocketHolder.visible = false;
        this.burst(s.body, 'explosion');
        if (d.reason === 'gas') app.progress.earn('dive');
        const first = app.progress.earn('kaboom');
        const lines = {
          gas: `Whoosh! ${s.body.name} is made of clouds, there's no ground!`,
          star: 'Yikes, too hot! Ember is a star!',
          fast: 'Kaboom! Too fast! Slow down before landing.',
          tipped: 'Oops, we tipped over! Land standing up straight.',
        };
        if (!first) app.pip(lines[d.reason] || 'Kaboom!', { speak: true });
        setTimeout(() => this.crashed && app.hud.showCrash(), 1400);
        break;
      }
      default:
        break;
    }
  }

  burst(body, kind) {
    const s = this.flight.state;
    const up = Math.atan2(s.y, s.x);
    const ux = Math.cos(up), uy = Math.sin(up);
    const n = kind === 'confetti' ? 70 : kind === 'explosion' ? 40 : 14;
    for (let i = 0; i < n; i++) {
      const a = up + (Math.random() - 0.5) * (kind === 'dust' ? 3 : 5);
      const sp = kind === 'confetti' ? 6 + Math.random() * 10 : kind === 'explosion' ? 3 + Math.random() * 9 : 2 + Math.random() * 3;
      const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp, vz = (Math.random() - 0.5) * sp;
      const x = s.x + ux * 2, y = s.y + uy * 2;
      if (kind === 'confetti') {
        this.particles.spawn('confetti', body, x + ux * 4, y + uy * 4, 0, vx, vy, vz, {
          color: CONFETTI[i % CONFETTI.length], size: 0.5, grow: 0, life: 3, drag: 1.2, gravity: 3,
        });
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
    const f = this.flight;
    const ap = this.autopilot;
    const s = f.state;

    // Manual controls take over from the helpers.
    const manualTurn = (this.input.left ? 1 : 0) - (this.input.right ? 1 : 0);
    const manual = manualTurn !== 0 || this.input.go;
    if (manual && ap.active) ap.stop();
    if (!ap.active) {
      f.turn = manualTurn;
      f.targetAngle = null;
      f.throttle = this.input.go && !this.crashed ? 1 : 0;
      if (f.throttle > 0) this.warpIndex = 0;
    } else {
      f.turn = 0;
    }

    let warp = this.warp;
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
    if (!this.crashed) {
      ap.update(dt);
      f.step(dt, warp);
    }

    // Rewind history.
    this.snapTimer += dt;
    if (this.snapTimer > 0.5 && !this.crashed) {
      this.snapTimer = 0;
      this.snapshots.push(f.snapshot());
      if (this.snapshots.length > 90) this.snapshots.shift();
    }

    // Predicted path.
    this.predTimer -= dt;
    if (!s.landed && !this.crashed && (this.predTimer <= 0 || f.throttle > 0)) {
      this.predTimer = 0.2;
      this.prediction = predict(s, { target: this.target, maxSegments: 4, maxTime: 40000 });
    } else if (s.landed) {
      this.prediction = null;
    }

    this.checkGoals();
    this.updateMood();

    // Positions.
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
    this.placeRocket(rw, dt);
    this.updateEffects(dt, rw);
    this.updateCamera(dt);
    this.updateLines();
    this.sky.position.copy(this.camera.position);
    this.updateAtmospheres();
    this.updateMarkers();
    this.app.audio.setEngine(this.crashed ? 0 : f.throttle);
  }

  checkGoals() {
    const f = this.flight;
    const s = f.state;
    const p = this.app.progress;
    const home = this.system.home;
    if (s.crashed) return;
    if (s.body === home && !s.landed && f.altitude > home.spaceLine) p.earn('space');
    if (s.body === home && inStableOrbit(f)) p.earn('orbit');
    if (s.body.kind === 'star' && Math.hypot(s.x, s.y) < s.body.radius * 3) p.earn('sun');
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
      for (const u of v.updates) u(this.time);
    }
  }

  placeRocket(rw, dt) {
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
    g.visible = !this.crashed && this.mode === 'flight';
    void dt;
  }

  updateEffects(dt, rw) {
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
    void rw;
  }

  updateCamera(dt) {
    const cam = this.camera;
    const f = this.flight;
    const s = f.state;
    if (this.mode === 'flight') {
      const up = Math.atan2(s.y, s.x);
      const target = new THREE.Vector3(Math.cos(up), Math.sin(up), 0);
      this.camUp.lerp(target, 1 - Math.exp(-dt * 4)).normalize();
      const alt = Math.max(0, f.altitude);
      const auto = THREE.MathUtils.clamp(26 + alt * 0.85, 26, 6000);
      const dist = auto * this.zoom;
      const axis = new THREE.Vector3(Math.cos(s.angle), Math.sin(s.angle), 0);
      const centre = this.crashed ? new THREE.Vector3() : axis.multiplyScalar(this.rocket.height * 0.5);
      cam.up.copy(this.camUp);
      cam.position.copy(centre).addScaledVector(this.camUp, dist * 0.3).add(new THREE.Vector3(0, 0, dist * 0.95));
      cam.lookAt(centre.clone().addScaledVector(this.camUp, dist * 0.12));
      cam.near = Math.max(0.2, dist * 0.01);
    } else {
      const dist = this.mapDist * this.mapZoom;
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
      if (!v.atmosphere) continue;
      d.copy(sun).sub(v.group.position).normalize().transformDirection(view);
      v.atmosphere.material.uniforms.sunDir.value.copy(d);
    }
  }

  /** Anchor (world position minus origin) that a predicted segment is drawn around. */
  segmentAnchors() {
    const pred = this.prediction;
    const s = this.flight.state;
    const out = [];
    if (!pred) return out;
    let prev = null;
    for (const seg of pred.segments) {
      let a;
      if (!prev) {
        const w = seg.body.worldPos(s.t, {});
        a = { x: w.x - this.origin.x, y: w.y - this.origin.y };
      } else if (seg.body.parent === prev.seg.body) {
        const p = seg.body.relPos(seg.t0);
        a = { x: prev.a.x + p.x, y: prev.a.y + p.y };
      } else {
        const p = prev.seg.body.relPos(seg.t0);
        a = { x: prev.a.x - p.x, y: prev.a.y - p.y };
      }
      out.push(a);
      prev = { seg, a };
    }
    return out;
  }

  updateLines() {
    const map = this.mode === 'map';
    const s = this.flight.state;
    // Planet orbits (map only).
    for (const [b, line] of this.orbitLines) {
      line.visible = map;
      if (!map) continue;
      const w = b.parent.worldPos(s.t, this.tmp2);
      line.position.set(w.x - this.origin.x, w.y - this.origin.y, 0);
      line.material.opacity = b === this.target ? 0.9 : 0.35;
      line.material.linewidth = b === this.target ? 3 : 2;
    }
    // Predicted path (geometry only rebuilt when the prediction changes).
    const pred = this.prediction;
    const anchors = this.segmentAnchors();
    const segs = pred ? pred.segments : [];
    const rebuild = pred !== this.drawnPrediction;
    this.drawnPrediction = pred;
    for (let i = 0; i < Math.max(segs.length, this.segLines.length); i++) {
      if (i >= segs.length) {
        this.segLines[i].visible = false;
        continue;
      }
      const seg = segs[i];
      let line = this.segLines[i];
      if (rebuild || !line) {
        const pts2 = segmentPoints(seg, seg.body.kind === 'star' ? 400 : 200);
        const pts = [];
        for (let k = 0; k < pts2.length; k += 2) pts.push(pts2[k], pts2[k + 1], 0);
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
      line.material.linewidth = map ? 3.5 : 2.5;
      line.position.set(anchors[i].x, anchors[i].y, 0);
      // Show the moon where we'll meet it.
      if (seg.end === 'encounter') {
        const p = seg.next.relPos(seg.t1);
        this.showGhost(seg.next, anchors[i].x + p.x, anchors[i].y + p.y);
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
    if (map) {
      for (const v of this.visuals) {
        const b = v.body;
        const el = this.marker(`body-${b.id}`, 'body-label', `<span class="icon">${b.icon}</span><span class="name">${b.name}</span>`);
        if (!el.onclick) el.onclick = (e) => { e.stopPropagation(); this.app.audio.play('tap'); this.setTarget(b); };
        el.classList.toggle('targeted', b === this.target);
        b.worldPos(s.t, tmp);
        const sc = this.mapScale(b);
        this.placeMarker(el, tmp.x - this.origin.x, tmp.y - this.origin.y - b.radius * sc * 1.05);
      }
      const segs = this.prediction?.segments || [];
      const anchors = this.segmentAnchors();
      segs.forEach((seg, i) => {
        const el = seg.el;
        const a = anchors[i];
        const span = seg.t1 - seg.t0;
        if (el.e < 1 && el.ra < seg.body.soi && el.timeToAp !== null && (seg.closed || el.timeToAp < span)) {
          const p = pointAt(el, Math.PI);
          this.placeMarker(this.marker(`ap-${i}`, 'apsis', '▲'), a.x + p.x, a.y + p.y);
        }
        if (el.timeToPe !== null && (seg.closed || el.timeToPe < span)) {
          const p = pointAt(el, 0);
          this.placeMarker(this.marker(`pe-${i}`, 'apsis low', '▼'), a.x + p.x, a.y + p.y);
        }
        if (seg.end === 'impact') {
          this.placeMarker(this.marker(`impact-${i}`, 'event', '💥'), a.x + seg.endState.x, a.y + seg.endState.y);
        }
        if (seg.end === 'encounter' && seg.next === this.target) {
          const p = seg.next.relPos(seg.t1);
          this.placeMarker(this.marker(`meet-${i}`, 'event meet', `✨ ${seg.next.name}!`), a.x + p.x, a.y + p.y - seg.next.radius * this.mapScale(seg.next) * 1.4);
        }
      });
      const closest = this.prediction?.closest;
      const meets = segs.some((seg) => seg.body === this.target);
      if (closest && this.target && !meets) {
        const w = closest.body.worldPos(s.t, {});
        this.placeMarker(this.marker('near', 'event near', '🎯'), w.x - this.origin.x + closest.rocket.x, w.y - this.origin.y + closest.rocket.y);
      }
      if (this.autopilot.marker) {
        const m = this.autopilot.marker;
        const w = m.body.worldPos(s.t, {});
        this.placeMarker(this.marker('burn', 'event burn', '🔥'), w.x - this.origin.x + m.x, w.y - this.origin.y + m.y);
      }
    }
    // Rocket icon: always in the map; in flight when the rocket is too small to see.
    const rw = this.flight.worldPos({});
    const rel = { x: rw.x - this.origin.x, y: rw.y - this.origin.y };
    const camDist = this.camera.position.distanceTo(new THREE.Vector3(rel.x, rel.y, 0));
    const tiny = camDist > 900;
    if ((map || tiny) && !this.crashed) {
      const el = this.marker('rocket', 'rocket-marker', '<div class="arrow"></div>');
      const scr = this.placeMarker(el, rel.x, rel.y);
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

  clearMarkers() {
    for (const el of this.markers.values()) el.remove();
    this.markers.clear();
  }
}
