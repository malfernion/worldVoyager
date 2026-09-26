// Buggy mode: roll out of the garage, drive anywhere on the globe with a chase camera,
// then head home to the rocket. The rocket stays parked on its flight plane the whole time.
import * as THREE from 'three';
import { Buggy, ObstacleGrid, Garage, homeAim, vec } from '../physics/buggy.js';
import { BUGGIES, DEFAULT_BUGGY, garageOf } from '../rocket/parts.js';
import { buildBuggy } from '../rocket/buggyMesh.js';
import { DustPool, BuggyDust } from '../physics/dust.js';
import { createDustMesh } from '../world/dust.js';
import { clamp, DRIVE_ZOOM } from '../ui/zoom.js';
import { buggyFinds, discoveryTargets, nearestTarget, sunDirection } from '../physics/discoveries.js';
import { buggyMeets, friendTargets } from '../physics/friends.js';
import { DISCOVERY_IDS, FRIEND_IDS } from '../progress.js';

const LEAVES = [0x5d8c3a, 0x7aa84a, 0x3f6b2e, 0xd08a3a];

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// The garage door faces +z in the rocket's frame (towards the flight camera).
const DOOR_DIR = [0, 0, 1];

export class DriveMode {
  constructor(flightScene) {
    this.fs = flightScene;
    this.active = false;
    this.zoom = 1;
    this.camF = new THREE.Vector3(0, 0, 1);
    this.camUp = new THREE.Vector3(0, 1, 0);
    this.visUp = new THREE.Vector3(0, 1, 0);
    this.steerVis = 0;
    this.wide = 1; // camera pull-back while orbiting Nibble
    this.dive = 0; // 0..1: how far the camera has followed the buggy under a sea (#44)
    this.world = { x: 0, y: 0 };
    this.shake = 0; // camera wobble after a bump
    this.bonkWait = 0;
    this.shakeOffset = new THREE.Vector3();
    // The on-planet compass (#15): targets still to find on this world, and the nearest one.
    this.targets = [];
    this.nearest = null;
    this.seekWait = 0;
    this.toSun = { x: 1, y: 0, z: 0 };
    // Tyre dust, jump bursts and jets (#26): one pool for every buggy effect, drawn in the world's group.
    this.dustPool = new DustPool();
    this.dustMesh = null;
    this.dust = null;
  }

  canDeploy() {
    const fs = this.fs;
    const s = fs.flight?.state;
    // A coached launch waiting for the player's GO doesn't stop them driving first (#36); Pip flying does.
    return !!s && !this.active && !fs.crashed && s.landed && s.body.solid && !!garageOf(fs.design) && !fs.autopilot.driving;
  }

  /** Where the rocket stands, in the world's own frame. */
  rocketFoot() {
    const s = this.fs.flight.state;
    const r = s.body.surfaceAt(s.landAngle);
    return [Math.cos(s.landAngle) * r, Math.sin(s.landAngle) * r, 0];
  }

  /** The garage door, in the world's own frame. */
  garageDoor() {
    const foot = this.rocketFoot();
    const up = vec.norm(foot);
    const rocket = this.fs.rocket;
    const idx = this.fs.design.stack.findIndex((p) => p.type === 'garage');
    const part = rocket.parts.find((p) => p.index === idx);
    const y = part ? part.y0 + 0.9 : 1;
    return vec.add(vec.add(foot, vec.mul(up, y)), [0, 0, 1.3]);
  }

  setDoor(open) {
    this.doorMoving = true;
    this.fs.rocket.group.traverse((o) => {
      if (o.userData.door) o.userData.doorTarget = open ? 1.35 : 0;
      if (o.userData.ramp) o.userData.rampTarget = open ? 1 : 0;
    });
  }

  /** Glide the door and ramp towards open or shut. Only while they're moving (it runs every frame). */
  animateDoor(dt) {
    if (!this.doorMoving) return;
    const k = 1 - Math.exp(-dt * 6);
    let moving = false;
    this.fs.rocket.group.traverse((o) => {
      if (o.userData.door) {
        const t = o.userData.doorTarget ?? 0;
        o.position.y += (t - o.position.y) * k;
        if (Math.abs(t - o.position.y) > 1e-3) moving = true;
        else o.position.y = t;
      }
      if (o.userData.ramp) {
        const t = o.userData.rampTarget ?? 0;
        let r = (o.userData.rampOpen ?? 0) + (t - (o.userData.rampOpen ?? 0)) * k;
        if (Math.abs(t - r) > 1e-3) moving = true;
        else r = t;
        o.userData.rampOpen = r;
        o.visible = r > 0.02;
        // Folded up (-90°) to open, sloping down to the ground by rampTilt (it used to tilt up, #42).
        o.rotation.x = -Math.PI / 2 + r * (Math.PI / 2 + (o.userData.rampTilt ?? 0.35));
      }
    });
    this.doorMoving = moving;
  }

  deploy() {
    if (!this.canDeploy()) return;
    const fs = this.fs;
    // Coaching is quiet while we drive, and picks up again back at the rocket (#36).
    fs.quietCoach?.();
    const s = fs.flight.state;
    const body = s.body;
    const choice = garageOf(fs.design).buggy || DEFAULT_BUGGY;
    this.choice = choice;
    this.kind = BUGGIES[choice.kind] || BUGGIES.rover;
    this.buggy = new Buggy(body, this.kind);
    const foot = this.rocketFoot();
    // Roll out in front of the garage door (it faces the camera, +z).
    this.buggy.spawn(vec.add(foot, vec.mul(DOOR_DIR, 6)), DOOR_DIR);
    // The rocket is solid all round (bonk!); only driving at its open door takes us in (#37).
    this.buggy.obstacles = [{ p: foot, r: 1.5, top: fs.rocket.height + 0.5 }];
    this.garage = new Garage(foot, DOOR_DIR);
    this.buggy.grid = this.obstacleGrid(body);
    this.nearest = null;
    this.targets.length = 0;
    this.seekWait = 0;
    this.halfRound = false;
    this.roundShown = false;
    this.mesh = buildBuggy(choice.kind, choice.paint);
    fs.scene.add(this.mesh.group);
    this.attachDust(body);
    this.active = true;
    this.phase = 'out';
    this.anim = 0;
    this.from = this.garageDoor();
    this.setDoor(true);
    this.camF.copy(V(this.buggy.f));
    this.camUp.copy(V(this.buggy.up));
    this.visUp.copy(this.camUp);
    fs.mode = 'drive';
    fs.warpIndex = 0;
    fs.app.audio.play('snap');
    const first = fs.app.progress.earn('drive');
    if (!first) fs.app.pip(`Let's go for a drive on ${body.name}!`, { speak: true });
  }

  /** Dust for this buggy, drawn in its world's group (so it moves with the world). */
  attachDust(body) {
    this.dustPool.setWorld(body);
    this.dustPool.clear();
    this.dust = new BuggyDust(this.dustPool, this.buggy, this.mesh.wheels.map((w) => [w.x, w.z]), this.mesh.jets);
    const v = this.fs.visuals.find((x) => x.body === body);
    if (!v) return;
    this.dustMesh ??= createDustMesh(this.dustPool, v.sunDir, body.radius);
    this.dustMesh.attach(v.group, v.sunDir, body.radius);
  }

  dropDust() {
    this.dustPool.clear();
    this.dustMesh?.update();
    this.dust = null;
  }

  /** This world's trees or rocks as a lookup grid for the buggy (built once per world). */
  obstacleGrid(body) {
    const v = this.fs.visuals.find((x) => x.body === body);
    if (!v) return null;
    if (!v.obstacleGrid) {
      const plain = (list, tree) => list.map((o) => ({ p: [o.position.x, o.position.y, o.position.z], up: [o.up.x, o.up.y, o.up.z], r: o.radius, h: o.height, tree }));
      const landmarks = v.landmarks?.obstacles || [];
      v.obstacleGrid = new ObstacleGrid([...plain(v.trees || [], true), ...plain(v.rocks || [], false), ...plain(landmarks, false)]);
    }
    return v.obstacleGrid;
  }

  /** Where the home compass points (#37): the rocket, or round to the front of its door. */
  homeAim(foot = this.rocketFoot()) {
    return homeAim(this.buggy.p, foot, DOOR_DIR);
  }

  /** Driven in through the garage door (#37): the same roll-in as 🏠 from close by. */
  driveIn() {
    this.fs.app.audio.play('garage');
    this.phase = 'in';
    this.anim = 0;
    this.from = this.buggy.p.slice();
    this.far = false;
  }

  /** Back to the rocket (🏠): drive in if close, otherwise whoosh back with sparkles. */
  goHome() {
    if (!this.active || this.phase !== 'drive') return;
    const fs = this.fs;
    const d = vec.len(vec.sub(this.buggy.p, this.rocketFoot()));
    if (d > 12) {
      fs.app.pip('Whoosh! Back to the rocket!', { speak: false, pri: 'chatter' });
      fs.app.audio.play('rewind');
      this.sparkle();
    }
    this.phase = 'in';
    this.anim = 0;
    this.from = this.buggy.p.slice();
    this.far = d > 12;
  }

  sparkle() {
    const b = this.buggy;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 2 - 1;
      const dir = [Math.cos(a) * Math.sqrt(1 - e * e), Math.sin(a) * Math.sqrt(1 - e * e), e];
      this.fs.particles.spawn('spark', b.body, b.p[0], b.p[1], b.p[2], dir[0] * 5, dir[1] * 5, dir[2] * 5, { size: 1.2, grow: -0.4, life: 1, drag: 2 });
    }
  }

  finish() {
    const fs = this.fs;
    this.dropDust();
    if (this.mesh) fs.scene.remove(this.mesh.group);
    this.mesh = null;
    this.active = false;
    this.setDoor(false);
    if (fs.mode === 'drive') fs.mode = 'flight';
    fs.app.audio.play('snap');
  }

  /** Abandon driving instantly (e.g. going back to the workshop). */
  cancel() {
    if (!this.active) return;
    this.setDoor(false);
    this.dropDust();
    if (this.mesh) this.fs.scene.remove(this.mesh.group);
    this.mesh = null;
    this.active = false;
    if (this.fs.mode === 'drive') this.fs.mode = 'flight';
  }

  update(dt, input) {
    const fs = this.fs;
    const b = this.buggy;
    const s = fs.flight.state;
    this.animateDoor(dt);
    if (!this.active) return;

    let pos;
    let scale = 1;
    if (this.phase === 'out') {
      // Roll down the ramp.
      this.anim += dt;
      const t = Math.min(1, this.anim / 0.9);
      const e = t * t * (3 - 2 * t);
      pos = vec.add(vec.mul(this.from, 1 - e), vec.mul(b.p, e));
      if (t >= 1) this.phase = 'drive';
    } else if (this.phase === 'in') {
      this.anim += dt;
      const t = Math.min(1, this.anim / (this.far ? 0.5 : 1.0));
      const door = this.garageDoor();
      const e = t * t;
      pos = vec.add(vec.mul(this.far ? door : this.from, 1 - e), vec.mul(door, e));
      scale = 1 - e * 0.7;
      if (t >= 1) {
        this.finish();
        return;
      }
    } else {
      b.step(dt, {
        throttle: input.go ? 1 : input.back ? -1 : 0,
        steer: (input.left ? 1 : 0) - (input.right ? 1 : 0),
        jump: input.jump,
      });
      pos = b.p;
      this.effects(dt, input);
      // Driving up the ramp or up to the open door takes us in (#37).
      if (this.garage?.update(b)) this.driveIn();
    }
    this.dustPool.step(dt);

    const w = s.body.worldPos(s.t, {});
    this.world = { x: w.x + pos[0], y: w.y + pos[1], z: pos[2] };
    this.pos = pos;
    this.scale = scale;
    this.lastDt = dt;
  }

  /** Put the buggy mesh on screen (after the scene has picked its floating origin). */
  place(input) {
    if (!this.active || !this.mesh) return;
    const fs = this.fs;
    const b = this.buggy;
    const dt = this.lastDt || 0;
    this.dustMesh?.update();
    const g = this.mesh.group;
    g.position.set(this.world.x - fs.origin.x, this.world.y - fs.origin.y, this.pos[2]);
    g.scale.setScalar(this.scale);
    const target = V(b.grounded ? b.n : b.up);
    this.visUp.lerp(target, 1 - Math.exp(-dt * (b.grounded ? 10 : 3))).normalize();
    const fwd = V(b.f);
    fwd.sub(this.visUp.clone().multiplyScalar(fwd.dot(this.visUp))).normalize();
    const right = new THREE.Vector3().crossVectors(this.visUp, fwd).normalize();
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, this.visUp, fwd));

    const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    this.steerVis += (steer * 0.45 - this.steerVis) * (1 - Math.exp(-dt * 10));
    for (const wheel of this.mesh.wheels) {
      wheel.spin.rotation.x = b.distance / this.mesh.radius;
      if (wheel.steer) wheel.steer.rotation.y = this.steerVis;
    }
    if (this.mesh.pip) this.mesh.pip.rotation.y = Math.sin(fs.time * 1.3) * 0.3 + this.steerVis;
    if (this.mesh.flag) this.mesh.flag.userData.cloth.rotation.y = Math.PI / 2 + Math.sin(fs.time * 9) * 0.25 * Math.min(1, b.speed / 3);
  }

  effects(dt, input) {
    const b = this.buggy;
    const fs = this.fs;
    // Tyre dust and landing thumps (#26), then the jump's burst (a super hop's is bigger).
    this.dust.update(dt, input);
    // Into or out of a sea (#44): a splash (the spray and bow wave are in the dust pool).
    if (this.dust.splashed) fs.app.audio.play('splash');
    if (this.dust.landing > 3) {
      fs.app.audio.play('thump');
      this.shake = Math.max(this.shake, Math.min(0.25, this.dust.landing * 0.02));
    }
    if (b.jumped) {
      b.jumped = false;
      fs.app.audio.play('boing');
      this.dust.takeOff(b.superHop);
    }
    this.bumpEffects(dt);
    this.orbitEffects(dt);
    this.roundEffects();
    this.jetEffects(dt);
    this.seek(dt);
    fs.app.audio.setEngine(b.grounded && (input.go || input.back) ? 0.25 : b.braking || b.jets ? 0.2 : 0.06);
  }

  /** Bonk! A soft sound, a gentle shake and a few falling leaves (or a puff of dust). */
  bumpEffects(dt) {
    const b = this.buggy;
    const fs = this.fs;
    this.bonkWait = Math.max(0, this.bonkWait - dt);
    this.shake *= Math.exp(-dt * 6);
    const speed = b.bumped, o = b.bumpedInto;
    b.bumped = 0;
    b.bumpedInto = null;
    // Leaning on a tree shouldn't bonk over and over.
    if (speed < 1.2 || this.bonkWait > 0) return;
    this.bonkWait = 0.5;
    this.shake = Math.min(0.35, speed * 0.04);
    fs.app.audio.play(o?.tree ? 'bonkTree' : 'bonk');
    // A tip only helps right away: if Pip's busy, try again at the next bonk.
    if (!this.bonked) this.bonked = fs.app.pip('Bonk! Back up and steer around it.', { speak: true, pri: 'chatter' });
    if (!o?.up) return;
    const up = o.up;
    if (o.tree) {
      // Leaves flutter down from the treetop.
      const n = Math.min(10, 3 + Math.round(speed));
      for (let i = 0; i < n; i++) {
        const j = () => (Math.random() - 0.5) * o.h * 0.5;
        const pos = vec.add(vec.add(o.p, vec.mul(up, o.h * (0.6 + Math.random() * 0.3))), [j(), j(), j()]);
        const vel = vec.add(vec.mul(up, -0.8 - Math.random()), [j() * 0.4, j() * 0.4, j() * 0.4]);
        fs.particles.spawn('confetti', b.body, pos[0], pos[1], pos[2], vel[0], vel[1], vel[2], {
          size: 0.35, grow: 0, life: 2.2, drag: 1.5, gravity: 1.5, color: LEAVES[i % LEAVES.length],
        });
      }
    } else {
      this.dust.ring(8, 1.2, 1, 0.6); // a puff of dust by the wheels
    }
  }

  /** The Nibble orbit secret: jets, Pip's hints and the sticker. */
  orbitEffects(dt) {
    const b = this.buggy;
    const fs = this.fs;
    const app = fs.app;
    // Driving the Hopper on Nibble: a whispered hint, once a session until the sticker is earned.
    if (b.canOrbit && !this.whispered && !app.progress.has('orbit-nibble')) {
      this.driven = (this.driven || 0) + dt;
      // Whispered when Pip isn't busy saying something else.
      if (this.driven > 6) this.whispered = app.pip('Psst! Drive really fast, then jump and hold it!', { speak: true, pri: 'chatter' });
    }
    if (b.superHop) {
      b.superHop = false;
      this.halfway = false;
      app.audio.play('whoosh');
      if (!this.hinted) {
        this.hinted = true;
        app.pip('Super hop! Keep holding jump to fire the jets!', { speak: true, pri: 'cue', key: 'hop' });
      }
    }
    if (b.puffed) {
      b.puffed = false;
      app.audio.play('whoosh');
      for (let i = 0; i < 8; i++) this.dust.jet(-1, 3 + Math.random() * 3);
    }
    if (b.jets && Math.random() < dt * 30) this.dust.jet(-1, 3 + Math.random() * 2);
    if (b.braking && Math.random() < dt * 30) this.dust.jet(1, 3);
    if (b.orbiting && !this.halfway && b.lap > Math.PI && !app.progress.has('orbit-nibble')) {
      this.halfway = true;
      app.pip('Halfway round! Keep going!', { speak: true, stale: 5 });
    }
    if (b.orbited) {
      b.orbited = false;
      if (!app.progress.earn('orbit-nibble')) app.pip('All the way round Nibble again!', { speak: true });
    }
  }

  /**
   * Driving all the way round the world (#29, `WorldLap` in physics/buggy.js): from a quarter of
   * the way the ring by the compass fills, Pip cheers at halfway, and all the way round is a
   * chime, sparkles, a 🌍 by the world in the journal and (the first time) the sticker.
   */
  roundEffects() {
    const b = this.buggy;
    const app = this.fs.app;
    const p = b.round.progress;
    if (p >= 0.25) this.roundShown = true;
    else if (p < 0.1) this.roundShown = false;
    // Once a lap, so driving back and forth past halfway doesn't keep saying it.
    if (p >= 0.5 && !this.halfRound) {
      this.halfRound = true;
      app.pip('Halfway round! Keep going!', { speak: true, stale: 5 });
    }
    if (!b.wentRound) return;
    b.wentRound = false;
    this.halfRound = false;
    this.roundShown = false;
    app.audio.play('discover');
    this.sparkle();
    app.progress.wentRound(b.body.id);
    if (!app.progress.earn('round-world')) app.pip('We drove all the way round again!', { speak: true });
  }

  /** Ducky's gas jets (#13): fizz under the wheels, a whoosh, and the first time Pip explains. */
  jetEffects(dt) {
    const b = this.buggy;
    if (b.fizz > 0.1) {
      if (!this.fizzing) {
        this.fizzing = true;
        this.fs.app.audio.play('whoosh');
        if (!this.fizzed) {
          this.fizzed = true;
          this.fs.app.pip('Whee! Gas from the comet is pushing us up!', { speak: true, stale: 5 });
        }
      }
      if (Math.random() < dt * 30 * b.fizz) this.dust.fizz();
    } else if (b.grounded) {
      this.fizzing = false;
    }
  }

  /**
   * Discoveries (#15) and friends (#16): a few times a second, is the buggy finding one? And
   * where are the ones still to find (for the ✨ / 🎵 compass)?
   */
  seek(dt) {
    this.seekWait -= dt;
    if (this.seekWait > 0) return;
    this.seekWait = 0.1;
    const fs = this.fs;
    const app = fs.app;
    const b = this.buggy;
    const ctx = this.seekCtx ??= { time: 0, toSun: this.toSun, has: (id) => app.progress.has(id) };
    ctx.time = fs.time;
    sunDirection(b.body, fs.flight.state.t, this.toSun);
    const id = buggyFinds(b.body, b, ctx);
    if (id) this.discovered(id);
    // Pip's friends (#16): drive up to one to say hello; the compass points to them too (🎵).
    const met = buggyMeets(b.body, b.p, ctx.has);
    if (met) fs.metFriend(met);
    if (id || met) this.sought = -10; // let Pip finish before any compass hint
    discoveryTargets(b.body, ctx, this.targets);
    friendTargets(b.body, ctx.has, this.targets);
    this.nearest = nearestTarget(this.targets, b.p);
    // Until the first discovery (or friend), Pip points out the compass (once a session each).
    const friend = this.nearest?.target.icon === '🎵';
    const hinted = friend ? this.notesHinted : this.compassHinted;
    const done = friend ? FRIEND_IDS : DISCOVERY_IDS;
    if (this.nearest && !hinted && !done.some((d) => app.progress.has(d))) {
      this.sought = (this.sought || 0) + 0.1;
      if (this.sought > 3) {
        this.sought = 0;
        // Only when Pip isn't busy (else try again in a few seconds).
        if (friend) this.notesHinted = app.pip('Listen! Can you hear music? Follow the notes!', { speak: true, pri: 'chatter' });
        else this.compassHinted = app.pip('Psst! Follow the sparkles to find a secret!', { speak: true, pri: 'chatter' });
      }
    }
  }

  /** Found one! A chime and sparkles, then the sticker pops and Pip tells the real fact. */
  discovered(id) {
    const app = this.fs.app;
    app.audio.play('discover');
    if (id === 'find-rover') app.audio.play('beep');
    this.sparkle();
    this.fs.discover();
    app.progress.earn(id);
  }

  /** Chase distance: the player's multiplier on this buggy's usual distance, clamped absolutely. */
  viewDist() {
    return clamp(this.baseDist() * this.zoom, DRIVE_ZOOM[0], DRIVE_ZOOM[1]);
  }

  setViewDist(d) {
    this.zoom = clamp(d, DRIVE_ZOOM[0], DRIVE_ZOOM[1]) / this.baseDist();
  }

  baseDist() {
    return this.kind?.wheel > 0.8 ? 15 : 12;
  }

  updateCamera(dt, camera) {
    const b = this.buggy;
    const k = (r) => 1 - Math.exp(-dt * r);
    this.camF.lerp(V(b.f), k(2.5)).normalize();
    this.camUp.lerp(V(b.up), k(3)).normalize();
    const f = this.camF.clone().sub(this.camUp.clone().multiplyScalar(this.camF.dot(this.camUp))).normalize();
    // Pull back while orbiting so Nibble curves away underneath.
    this.wide += ((b.orbiting ? 1.8 : 1) - this.wide) * k(0.8);
    const dist = this.viewDist() * this.wide;
    const buggyPos = this.mesh ? this.mesh.group.position.clone() : new THREE.Vector3();
    const target = buggyPos.clone().addScaledVector(this.camUp, 1.2);
    const offset = f.clone().multiplyScalar(-dist).addScaledVector(this.camUp, dist * 0.42);
    // Keep the camera above the hills. With the buggy deep in a sea (#44), dive in after it
    // (looking down through deep water it would be lost); it comes back up as the buggy does.
    const local = vec.add(b.p, [offset.x, offset.y, offset.z + 1.2]);
    const minR = b.groundRadius(vec.norm(local)) + 1.5;
    const r = vec.len(local);
    const dive = b.depth > 1.2 && b.body.liquid ? b.body.liquidR - 0.6 : Infinity;
    this.dive += ((dive < Infinity ? 1 : 0) - this.dive) * k(3);
    if (this.dive > 0.01 && dive < Infinity && r > dive) offset.add(V(vec.mul(vec.norm(local), (dive - r) * this.dive)));
    const r2 = vec.len(vec.add(b.p, [offset.x, offset.y, offset.z + 1.2]));
    if (r2 < minR) offset.add(V(vec.mul(vec.norm(local), minR - r2)));
    camera.up.copy(this.camUp);
    camera.position.copy(target).add(offset);
    if (this.shake > 0.01) {
      const t = this.fs.time;
      this.shakeOffset.set(Math.sin(t * 53), Math.sin(t * 61 + 1), Math.sin(t * 47 + 2)).multiplyScalar(this.shake);
      camera.position.add(this.shakeOffset);
    }
    camera.lookAt(target.clone().addScaledVector(f, 3));
    camera.near = 0.2;
  }

  /** How far to drive to the rocket: round the world, the way the compass leads (#41). */
  get distanceToRocket() {
    if (!this.buggy) return 0;
    const p = this.buggy.p, foot = this.rocketFoot();
    const angle = Math.acos(Math.max(-1, Math.min(1, vec.dot(vec.norm(p), vec.norm(foot)))));
    return angle * (vec.len(p) + vec.len(foot)) / 2;
  }
}
