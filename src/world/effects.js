// Rocket flames, puffs of smoke, confetti and cartoon explosions.
import * as THREE from 'three';
import { glowTexture, puffTexture } from './materials.js';

export function createFlame(scale = 1) {
  const g = new THREE.Group();
  const mk = (r, h, color, opacity) => {
    // Cone base at the nozzle (y = 0), tip pointing down to y = -h.
    const geo = new THREE.ConeGeometry(r, h, 18, 1, true);
    geo.rotateX(Math.PI);
    geo.translate(0, -h / 2, 0);
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
  };
  const outer = mk(0.62, 3.2, 0xff7a2a, 0.75);
  const inner = mk(0.36, 2.0, 0xffe39a, 0.95);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,190,90,1)', 'rgba(255,90,30,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  glow.scale.setScalar(3.2);
  glow.position.y = -0.6;
  g.add(outer, inner, glow);
  g.scale.setScalar(scale);
  g.visible = false;
  return {
    group: g,
    update(throttle, time) {
      g.visible = throttle > 0.02;
      if (!g.visible) return;
      const flick = 1 + Math.sin(time * 47 + scale * 9) * 0.12 + (Math.random() - 0.5) * 0.18;
      const len = (0.35 + 0.65 * throttle) * flick;
      outer.scale.set(1, len, 1);
      inner.scale.set(1, len * (0.9 + Math.random() * 0.2), 1);
      glow.material.opacity = 0.5 + 0.5 * throttle;
    },
  };
}

// Pool of sprites living in some body's frame (so smoke stays put on the ground).
export class Particles {
  constructor(scene, max = 260) {
    this.scene = scene;
    this.list = [];
    this.pool = [];
    this.puffMat = new THREE.SpriteMaterial({ map: puffTexture(), transparent: true, depthWrite: false });
    this.sparkMat = new THREE.SpriteMaterial({
      map: glowTexture('rgba(255,220,140,1)', 'rgba(255,120,40,0)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    this.max = max;
    this.tmp = {};
  }

  spawn(kind, body, x, y, z, vx, vy, vz, opts = {}) {
    if (this.list.length >= this.max) return;
    let sprite = this.pool.pop();
    const mat = kind === 'spark' ? this.sparkMat : kind === 'confetti' ? null : this.puffMat;
    if (!sprite) {
      sprite = new THREE.Sprite();
      this.scene.add(sprite);
    }
    if (kind === 'confetti') {
      sprite.material = new THREE.SpriteMaterial({ color: opts.color ?? 0xffffff, transparent: true, depthWrite: false });
    } else {
      sprite.material = mat.clone();
      if (opts.color) sprite.material.color.set(opts.color);
    }
    sprite.visible = true;
    this.list.push({
      sprite, kind, body, x, y, z, vx, vy, vz,
      life: 0, maxLife: opts.life ?? 2, size: opts.size ?? 1, grow: opts.grow ?? 1.5, drag: opts.drag ?? 0.6,
      gravity: opts.gravity ?? 0, spin: (Math.random() - 0.5) * 4,
    });
  }

  update(dt, t, origin) {
    const tmp = this.tmp;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.sprite.visible = false;
        p.sprite.material.dispose();
        this.pool.push(p.sprite);
        this.list.splice(i, 1);
        continue;
      }
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp; p.vy *= damp; p.vz *= damp;
      if (p.gravity) {
        // Toward the middle of the world in 3D (buggy effects happen far off the flight plane).
        const r = Math.hypot(p.x, p.y, p.z) || 1;
        p.vx -= (p.x / r) * p.gravity * dt;
        p.vy -= (p.y / r) * p.gravity * dt;
        p.vz -= (p.z / r) * p.gravity * dt;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.body.worldPos(t, tmp);
      p.sprite.position.set(tmp.x + p.x - origin.x, tmp.y + p.y - origin.y, p.z);
      const k = p.life / p.maxLife;
      const size = p.size * (1 + p.grow * k);
      p.sprite.scale.set(size, size, 1);
      p.sprite.material.opacity = Math.min(1, (1 - k) * 1.6);
      p.sprite.material.rotation += p.spin * dt;
    }
  }

  clear() {
    for (const p of this.list) {
      p.sprite.visible = false;
      this.pool.push(p.sprite);
    }
    this.list.length = 0;
  }
}

/** Flying rocket bits after a crash. Parts keep their looks and tumble away. */
export class Debris {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.tmp = {};
  }

  explode(rocket, body, localPos, angle, upAngle) {
    this.clear();
    const up = new THREE.Vector2(Math.cos(upAngle), Math.sin(upAngle));
    for (const part of rocket.parts) {
      const obj = part.group.clone(true);
      const worldAngle = angle - Math.PI / 2;
      const cy = (part.y0 + part.y1) / 2;
      const px = localPos.x + Math.cos(angle) * cy;
      const py = localPos.y + Math.sin(angle) * cy;
      const speed = 8 + Math.random() * 10;
      const dirA = upAngle + (Math.random() - 0.5) * 2.4;
      const holder = new THREE.Group();
      holder.add(obj);
      obj.position.set(0, -(part.y1 - part.y0) / 2, 0);
      holder.rotation.z = worldAngle;
      this.scene.add(holder);
      this.items.push({
        holder, body, x: px, y: py, z: 0,
        vx: Math.cos(dirA) * speed + up.x * 4, vy: Math.sin(dirA) * speed + up.y * 4, vz: (Math.random() - 0.5) * 12,
        spin: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8),
        life: 0,
      });
    }
  }

  update(dt, t, origin) {
    const tmp = this.tmp;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      d.life += dt;
      const r = Math.hypot(d.x, d.y) || 1;
      const g = Math.min(12, d.body.mu / (r * r));
      d.vx -= (d.x / r) * g * dt;
      d.vy -= (d.y / r) * g * dt;
      d.vz *= Math.exp(-0.5 * dt);
      const nx = d.x + d.vx * dt, ny = d.y + d.vy * dt;
      const ground = d.body.solid ? d.body.surfaceAt(Math.atan2(ny, nx)) + 0.6 : 0;
      if (Math.hypot(nx, ny) < ground) {
        // Bounce!
        const ux = nx / Math.hypot(nx, ny), uy = ny / Math.hypot(nx, ny);
        const vr = d.vx * ux + d.vy * uy;
        // A sea (#44) doesn't bounce bits much: they bob about on it.
        const wet = d.body.wetAt(Math.atan2(ny, nx));
        d.vx = (d.vx - (wet ? 1.15 : 1.6) * vr * ux) * (wet ? 0.35 : 0.6);
        d.vy = (d.vy - (wet ? 1.15 : 1.6) * vr * uy) * (wet ? 0.35 : 0.6);
        d.spin.multiplyScalar(wet ? 0.5 : 0.7);
      } else {
        d.x = nx;
        d.y = ny;
      }
      d.z += d.vz * dt;
      d.holder.rotation.x += d.spin.x * dt;
      d.holder.rotation.y += d.spin.y * dt;
      d.holder.rotation.z += d.spin.z * dt;
      d.body.worldPos(t, tmp);
      d.holder.position.set(tmp.x + d.x - origin.x, tmp.y + d.y - origin.y, d.z);
    }
  }

  clear() {
    for (const d of this.items) this.scene.remove(d.holder);
    this.items.length = 0;
  }
}
