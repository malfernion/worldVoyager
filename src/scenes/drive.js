// Buggy mode: roll out of the garage, drive anywhere on the globe with a chase camera,
// then head home to the rocket. The rocket stays parked on its flight plane the whole time.
import * as THREE from 'three';
import { Buggy, vec } from '../physics/buggy.js';
import { BUGGIES, DEFAULT_BUGGY, garageOf } from '../rocket/parts.js';
import { buildBuggy } from '../rocket/buggyMesh.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

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
    this.world = { x: 0, y: 0 };
  }

  canDeploy() {
    const fs = this.fs;
    const s = fs.flight?.state;
    return !!s && !this.active && !fs.crashed && s.landed && s.body.solid && !!garageOf(fs.design) && !fs.autopilot.active;
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
    this.fs.rocket.group.traverse((o) => {
      if (o.userData.door) o.userData.doorTarget = open ? 1.35 : 0;
      if (o.userData.ramp) o.userData.rampTarget = open ? 1 : 0;
    });
  }

  animateDoor(dt) {
    const k = 1 - Math.exp(-dt * 6);
    this.fs.rocket.group.traverse((o) => {
      if (o.userData.door) {
        const t = o.userData.doorTarget ?? 0;
        o.position.y += (t - o.position.y) * k;
      }
      if (o.userData.ramp) {
        const t = o.userData.rampTarget ?? 0;
        o.userData.rampOpen = (o.userData.rampOpen ?? 0) + (t - (o.userData.rampOpen ?? 0)) * k;
        o.visible = o.userData.rampOpen > 0.02;
        o.rotation.x = -Math.PI / 2 + o.userData.rampOpen * (Math.PI / 2 - 0.35);
      }
    });
  }

  deploy() {
    if (!this.canDeploy()) return;
    const fs = this.fs;
    const s = fs.flight.state;
    const body = s.body;
    const choice = garageOf(fs.design).buggy || DEFAULT_BUGGY;
    this.choice = choice;
    this.kind = BUGGIES[choice.kind] || BUGGIES.rover;
    this.buggy = new Buggy(body, this.kind);
    const foot = this.rocketFoot();
    // Roll out in front of the garage door (it faces the camera, +z).
    this.buggy.spawn(vec.add(foot, [0, 0, 6]), [0, 0, 1]);
    this.buggy.obstacles = [{ p: foot, r: 2.6 }];
    this.mesh = buildBuggy(choice.kind, choice.paint);
    fs.scene.add(this.mesh.group);
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

  /** Back to the rocket: drive in if close, otherwise whoosh back with sparkles. */
  goHome() {
    if (!this.active || this.phase !== 'drive') return;
    const fs = this.fs;
    const d = vec.len(vec.sub(this.buggy.p, this.rocketFoot()));
    if (d > 12) {
      fs.app.pip('Whoosh! Back to the rocket!', { speak: false });
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
    }

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
    const body = b.body;
    const back = vec.sub(b.p, vec.mul(b.f, 1.3));
    if (b.grounded && b.speed > 2.5 && Math.random() < dt * (b.inWater ? 18 : 7)) {
      const side = vec.cross(b.n, b.f);
      const sp = 1 + Math.random() * 2;
      const pos = vec.add(back, vec.mul(side, (Math.random() - 0.5) * 2));
      const vel = vec.add(vec.mul(b.n, sp), vec.mul(b.f, -sp));
      fs.particles.spawn('puff', body, pos[0], pos[1], pos[2], vel[0], vel[1], vel[2], {
        size: b.inWater ? 0.8 : 0.6, grow: 1.1, life: 0.8, drag: 2.5,
        color: b.inWater ? 0xcfefff : body.id === 'homestead' ? 0xd9ccb0 : body.color,
      });
    }
    if (b.jumped) {
      b.jumped = false;
      fs.app.audio.play('boing');
      for (let i = 0; i < 12; i++) {
        const pos = vec.sub(b.p, vec.mul(b.n, 0.5));
        const vel = vec.mul(vec.norm(vec.add(vec.mul(b.n, -1), [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5])), 4);
        fs.particles.spawn(i % 2 ? 'spark' : 'puff', body, pos[0], pos[1], pos[2], vel[0], vel[1], vel[2], { size: 0.9, grow: 1.2, life: 0.8, drag: 2.5 });
      }
    }
    this.orbitEffects(dt);
    fs.app.audio.setEngine(b.grounded && (input.go || input.back) ? 0.25 : b.braking ? 0.2 : 0.06);
  }

  /** The Nibble orbit secret: jets, Pip's hints and the sticker. */
  orbitEffects(dt) {
    const b = this.buggy;
    const fs = this.fs;
    const app = fs.app;
    if (b.superHop) {
      b.superHop = false;
      this.halfway = false;
      app.audio.play('whoosh');
      if (!this.hinted) {
        this.hinted = true;
        app.pip('Super hop! Tap jump again to fire the jets!', { speak: true });
      }
    }
    if (b.puffed) {
      b.puffed = false;
      app.audio.play('whoosh');
      for (let i = 0; i < 10; i++) this.jetPuff(-1, 3 + Math.random() * 3);
    }
    if (b.braking && Math.random() < dt * 25) this.jetPuff(1, 3);
    if (b.orbiting && !this.halfway && b.lap > Math.PI && !app.progress.has('orbit-nibble')) {
      this.halfway = true;
      app.pip('Halfway round! Keep going!', { speak: true });
    }
    if (b.orbited) {
      b.orbited = false;
      if (!app.progress.earn('orbit-nibble')) app.pip('All the way round Nibble again!', { speak: true });
    }
  }

  /** A puff of flame from the Hopper's jets, blowing backwards (dir -1) or forwards (+1). */
  jetPuff(dir, speed) {
    const b = this.buggy;
    const up = b.up;
    const side = vec.cross(up, b.f);
    const x = Math.random() < 0.5 ? -0.55 : 0.55;
    const pos = vec.add(vec.add(b.p, vec.mul(side, x)), vec.add(vec.mul(up, -0.3), vec.mul(b.f, dir > 0 ? 1.2 : -1.2)));
    const jitter = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
    const vel = vec.add(vec.add(b.v, vec.mul(b.f, dir * speed)), jitter);
    this.fs.particles.spawn('puff', b.body, pos[0], pos[1], pos[2], vel[0], vel[1], vel[2], {
      size: 0.5, grow: 1.4, life: 0.6, drag: 1.5, color: Math.random() < 0.5 ? 0xffb347 : 0xffe08a,
    });
  }

  updateCamera(dt, camera) {
    const b = this.buggy;
    const k = (r) => 1 - Math.exp(-dt * r);
    this.camF.lerp(V(b.f), k(2.5)).normalize();
    this.camUp.lerp(V(b.up), k(3)).normalize();
    const f = this.camF.clone().sub(this.camUp.clone().multiplyScalar(this.camF.dot(this.camUp))).normalize();
    // Pull back while orbiting so Nibble curves away underneath.
    this.wide += ((b.orbiting ? 1.8 : 1) - this.wide) * k(0.8);
    const dist = (this.kind.wheel > 0.8 ? 15 : 12) * this.zoom * this.wide;
    const buggyPos = this.mesh ? this.mesh.group.position.clone() : new THREE.Vector3();
    const target = buggyPos.clone().addScaledVector(this.camUp, 1.2);
    const offset = f.clone().multiplyScalar(-dist).addScaledVector(this.camUp, dist * 0.42);
    // Keep the camera above the hills.
    const local = vec.add(b.p, [offset.x, offset.y, offset.z + 1.2]);
    const minR = b.groundRadius(vec.norm(local)) + 1.5;
    const r = vec.len(local);
    if (r < minR) offset.add(V(vec.mul(vec.norm(local), minR - r)));
    camera.up.copy(this.camUp);
    camera.position.copy(target).add(offset);
    camera.lookAt(target.clone().addScaledVector(f, 3));
    camera.near = 0.2;
  }

  get distanceToRocket() {
    return this.buggy ? vec.len(vec.sub(this.buggy.p, this.rocketFoot())) : 0;
  }
}
