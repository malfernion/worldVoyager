// The campfire workshop: drag (or just tap) parts to build a rocket, tap parts to paint
// them, drag them off to throw them away.
import * as THREE from 'three';
import { PARTS, PAINTS, TRAY_ORDER, HOLDS_RADIAL, defaultDesign, randomDesign, rocketStats } from '../rocket/parts.js';
import { buildRocket, partIndexOf } from '../rocket/rocketMesh.js';
import { partThumb } from '../world/thumbs.js';
import { createSky } from '../world/sky.js';
import { toon, glowTexture, woodTexture, withOutline } from '../world/materials.js';
import { mulberry32 } from '../physics/noise.js';

const PROBLEMS = {
  crew: 'Pip needs a cabin! Add a Cabin or a Bubble.',
  engine: 'Add an engine so we can fly!',
  heavy: 'Too heavy! Add more engines or boosters.',
};

export class BuilderScene {
  constructor(app) {
    this.app = app;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 3000);
    this.design = app.progress.design || defaultDesign();
    this.spin = 0;
    this.time = 0;
    this.drag = null;
    this.buildBackdrop();

    this.indicator = new THREE.Mesh(
      new THREE.TorusGeometry(1.45, 0.14, 10, 40),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 }),
    );
    this.indicator.rotation.x = Math.PI / 2;
    this.indicator.visible = false;
    this.scene.add(this.indicator);

    this.rocketHolder = new THREE.Group();
    this.scene.add(this.rocketHolder);
    this.raycaster = new THREE.Raycaster();

    this.buildTray();
    this.bindUi();
    this.rebuild(false);
  }

  buildBackdrop() {
    const s = this.scene;
    // Dusky sky dome.
    const dome = new THREE.SphereGeometry(1500, 32, 20);
    const cols = [];
    const top = new THREE.Color(0x0d1024), mid = new THREE.Color(0x3b2a55), low = new THREE.Color(0xe0875a);
    const p = dome.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 1500;
      const c = y > 0.15 ? mid.clone().lerp(top, Math.min(1, (y - 0.15) / 0.5)) : low.clone().lerp(mid, Math.max(0, (y + 0.05) / 0.2));
      cols.push(c.r, c.g, c.b);
    }
    dome.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    s.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })));
    const stars = createSky(1400);
    stars.children.forEach((c) => {
      if (c.isSprite) c.visible = false;
    });
    s.add(stars);

    // A big ringed planet hanging in the sky, and Pebble.
    const ringo = this.app.visuals.find((v) => v.body.id === 'ringo');
    const bg = ringo.group.clone(true);
    bg.traverse((o) => {
      if (o.userData.atmosphere) o.visible = false;
    });
    bg.scale.setScalar(0.05);
    bg.position.set(-170, 190, -620);
    bg.rotation.set(0.3, 0.5, -0.2);
    s.add(bg);
    const pebble = this.app.visuals.find((v) => v.body.id === 'pebble');
    const moon = new THREE.Mesh(pebble.mesh.geometry, pebble.mesh.material);
    moon.scale.setScalar(0.18);
    moon.position.set(130, 95, -380);
    s.add(moon);

    s.add(new THREE.HemisphereLight(0xa9b8ff, 0x3a2a40, 1.1));
    const moonLight = new THREE.DirectionalLight(0xdfe6ff, 1.6);
    moonLight.position.set(-30, 40, 30);
    s.add(moonLight);

    // Grassy hill, wooden deck, trees and a campfire.
    const hill = new THREE.Mesh(new THREE.SphereGeometry(80, 48, 24), toon(0x4f7f3a));
    hill.position.y = -80.4;
    hill.scale.set(1.6, 1, 1.6);
    s.add(hill);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.6, 0.8, 24), toon(0xffffff, { map: woodTexture() }));
    deck.position.y = -0.4;
    s.add(withOutline(deck, 0.06));
    const rand = mulberry32(3);
    const foliage = new THREE.ConeGeometry(1, 1, 7);
    foliage.translate(0, 0.5, 0);
    for (let i = 0; i < 60; i++) {
      const a = rand() * Math.PI * 2;
      const r = 16 + rand() * 60;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (z > -12 && Math.abs(x) < 40) continue;
      const h = 5 + rand() * 7;
      const tree = new THREE.Mesh(foliage, toon(new THREE.Color().setHSL(0.28 + rand() * 0.06, 0.4, 0.22 + rand() * 0.1)));
      tree.scale.set(h * 0.33, h, h * 0.33);
      tree.position.set(x, -0.8 - r * r * 0.0006, z);
      s.add(tree);
    }
    const fire = new THREE.Group();
    this.fireSprites = [];
    for (const [sz, c, y] of [[2.6, 'rgba(255,140,40,1)', 0.9], [1.6, 'rgba(255,220,120,1)', 0.7]]) {
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(c, 'rgba(255,80,20,0)'), blending: THREE.AdditiveBlending, depthWrite: false }));
      f.scale.set(sz, sz * 1.4, 1);
      f.position.y = y;
      fire.add(f);
      this.fireSprites.push(f);
    }
    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.6, 6), toon(0x5c3d24));
      log.rotation.z = Math.PI / 2 - 0.5;
      log.rotation.y = (i / 4) * Math.PI * 2;
      log.position.y = 0.3;
      fire.add(log);
    }
    this.fireLight = new THREE.PointLight(0xff9a4a, 40, 40, 1.4);
    this.fireLight.position.y = 1.6;
    fire.add(this.fireLight);
    fire.position.set(8.5, -0.8, 3);
    s.add(fire);
  }

  // ---- UI ----------------------------------------------------------------

  buildTray() {
    const tray = document.getElementById('tray');
    tray.innerHTML = '';
    for (const type of TRAY_ORDER) {
      const def = PARTS[type];
      const card = document.createElement('div');
      card.className = 'part-card';
      card.dataset.type = type;
      const img = document.createElement('img');
      img.src = partThumb(type, def.paint, def.slot === 'radial');
      img.alt = def.name;
      card.append(img, document.createTextNode(def.name));
      card.addEventListener('pointerdown', (e) => this.trayDown(e, type));
      tray.appendChild(card);
      def.thumb = img.src;
    }
  }

  bindUi() {
    const $ = (id) => document.getElementById(id);
    $('random-btn').addEventListener('click', () => {
      this.design = randomDesign();
      this.app.audio.play('snap');
      this.rebuild();
    });
    $('clear-btn').addEventListener('click', () => {
      this.design = { stack: [] };
      this.app.audio.play('remove');
      this.rebuild();
      this.app.pip('A fresh start! Drag or tap parts to build.', { speak: true });
    });
    $('launch-btn').addEventListener('click', () => {
      const stats = rocketStats(this.design);
      if (!stats.canFly) {
        this.app.audio.play('boing');
        this.app.pip(PROBLEMS[stats.problem], { speak: true });
        return;
      }
      this.app.launch(this.design);
    });
  }

  rebuild(save = true) {
    this.rocketHolder.clear();
    this.rocket = buildRocket(this.design);
    this.rocketHolder.add(this.rocket.group);
    if (save) {
      this.app.progress.design = this.design;
      this.app.progress.save();
    }
    const st = rocketStats(this.design);
    const set = (stat, v, bad = false) => {
      const i = document.querySelector(`.meter[data-stat="${stat}"] i`);
      i.style.width = `${Math.round(Math.max(0.04, Math.min(1, v)) * 100)}%`;
      i.classList.toggle('bad', bad);
    };
    set('power', st.power / 3, st.power < 1.05);
    set('turn', st.turnRate / 3.2);
    set('legs', st.legs ? 1 : 0.15);
    document.getElementById('problem').textContent = st.problem ? PROBLEMS[st.problem] : '';
    document.getElementById('launch-btn').classList.toggle('disabled', !st.canFly);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- building actions --------------------------------------------------

  /** Sensible spot for a tapped (not dragged) part. */
  autoPlace(type) {
    const stack = this.design.stack;
    const def = PARTS[type];
    const paint = def.paint;
    if (def.slot === 'radial') {
      const holders = stack.map((p, i) => ({ p, i })).filter(({ p }) => HOLDS_RADIAL.has(p.type));
      if (!holders.length) {
        this.app.pip(`${def.name} need a tube to hold on to. Add a tube first!`, { speak: true });
        return false;
      }
      const free = holders.filter(({ p }) => !p.radial);
      const pick = (free.length ? free : holders)[type === 'fins' || type === 'legs' ? (free.length ? free : holders).length - 1 : 0];
      pick.p.radial = { type, paint };
      return true;
    }
    const part = { type, paint };
    const firstEngine = stack.findIndex((p) => PARTS[p.type].thrust);
    if (type === 'nose') stack.unshift(part);
    else if (def.crew) stack.splice(stack[0]?.type === 'nose' ? 1 : 0, 0, part);
    else if (def.thrust) stack.push(part);
    else stack.splice(firstEngine < 0 ? stack.length : firstEngine, 0, part);
    return true;
  }

  // ---- dragging ----------------------------------------------------------

  trayDown(e, type) {
    this.app.audio.start();
    const start = { x: e.clientX, y: e.clientY };
    const card = e.currentTarget;
    let started = false;
    const move = (ev) => {
      if (started) return;
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      const far = Math.hypot(dx, dy) > 10;
      if (far && (ev.pointerType === 'mouse' || dy < -Math.abs(dx) * 0.6)) {
        started = true;
        cleanup();
        const def = PARTS[type];
        this.startDrag({ type, paint: def.paint, radial: def.slot === 'radial', thumb: def.thumb, fresh: true }, ev);
      } else if (far) {
        cleanup(); // horizontal: let the tray scroll
      }
    };
    const up = () => {
      cleanup();
      if (!started) {
        if (this.autoPlace(type)) {
          this.app.audio.play('snap');
          this.rebuild();
        } else {
          this.app.audio.play('boing');
        }
      }
    };
    const cleanup = () => {
      card.removeEventListener('pointermove', move);
      card.removeEventListener('pointerup', up);
      card.removeEventListener('pointercancel', cleanup);
    };
    card.addEventListener('pointermove', move);
    card.addEventListener('pointerup', up);
    card.addEventListener('pointercancel', cleanup);
  }

  /** Pointer down on the 3D view: maybe paint, maybe pick up a part. */
  canvasDown(e) {
    this.app.audio.start();
    const hit = this.pick(e.clientX, e.clientY);
    if (!hit) return;
    const start = { x: e.clientX, y: e.clientY };
    const onMove = (ev) => {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 10) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const part = this.design.stack[hit.index];
      let item;
      if (hit.radial) {
        item = { ...part.radial, radial: true, thumb: PARTS[part.radial.type].thumb };
        delete part.radial;
      } else {
        this.design.stack.splice(hit.index, 1);
        item = { type: part.type, paint: part.paint, radial: false, carried: part.radial, thumb: PARTS[part.type].thumb };
      }
      this.app.audio.play('grab');
      this.rebuild(false);
      this.startDrag(item, ev);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // A tap paints the part a new colour.
      const part = this.design.stack[hit.index];
      const target = hit.radial ? part.radial : part;
      const i = PAINTS.findIndex((p) => p.id === target.paint);
      target.paint = PAINTS[(i + 1) % PAINTS.length].id;
      this.app.audio.play('paint');
      this.rebuild();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  pick(x, y) {
    const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.rocket.group, true);
    for (const h of hits) {
      if (h.object.userData.isOutline) continue;
      const index = partIndexOf(h.object);
      if (index < 0) continue;
      let radial = false;
      for (let o = h.object; o; o = o.parent) if (o.userData.radial) radial = true;
      return { index, radial };
    }
    return null;
  }

  startDrag(item, ev) {
    const ghost = document.createElement('img');
    ghost.id = 'drag-ghost';
    ghost.src = item.thumb;
    document.body.appendChild(ghost);
    this.drag = { item, ghost, drop: null };
    document.getElementById('trash').classList.toggle('hidden', !!item.fresh);
    const move = (e) => this.dragMove(e.clientX, e.clientY);
    const up = (e) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.dragEnd(e.clientX, e.clientY);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    this.dragMove(ev.clientX, ev.clientY);
  }

  screenY(y) {
    const v = new THREE.Vector3(0, y, 0).project(this.camera);
    return (-v.y * 0.5 + 0.5) * window.innerHeight;
  }

  dragMove(x, y) {
    const d = this.drag;
    if (!d) return;
    d.ghost.style.transform = `translate(${x - 48}px, ${y - 60}px)`;
    const trayTop = document.getElementById('tray').getBoundingClientRect().top;
    const trash = document.getElementById('trash');
    trash.classList.toggle('over', y > trayTop - 60);
    d.drop = null;
    this.indicator.visible = false;
    if (y > trayTop - 20) return;
    const parts = [...this.rocket.parts].sort((a, b) => a.index - b.index);
    if (d.item.radial) {
      const holders = parts.filter((p) => HOLDS_RADIAL.has(this.design.stack[p.index].type));
      if (!holders.length) return;
      let best = holders[0], bestD = Infinity;
      for (const p of holders) {
        const top = this.screenY(p.y1), bottom = this.screenY(p.y0);
        const dist = y < top ? top - y : y > bottom ? y - bottom : 0;
        if (dist < bestD) {
          bestD = dist;
          best = p;
        }
      }
      d.drop = { radialOn: best.index };
      this.indicator.position.y = (best.y0 + best.y1) / 2;
      this.indicator.scale.setScalar(1.35);
    } else {
      let index = 0;
      for (const p of parts) if (this.screenY((p.y0 + p.y1) / 2) < y) index = p.index + 1;
      d.drop = { index };
      const byIndex = (i) => parts.find((p) => p.index === i);
      const yy = parts.length === 0 ? 0 : index === 0 ? byIndex(0).y1 : byIndex(index - 1).y0;
      this.indicator.position.y = yy;
      this.indicator.scale.setScalar(1);
    }
    this.indicator.visible = true;
  }

  dragEnd(x, y) {
    const d = this.drag;
    if (!d) return;
    this.dragMove(x, y);
    d.ghost.remove();
    this.drag = null;
    this.indicator.visible = false;
    document.getElementById('trash').classList.add('hidden');
    const it = d.item;
    if (!d.drop) {
      if (!it.fresh) this.app.audio.play('remove');
      this.rebuild();
      return;
    }
    if (d.drop.radialOn !== undefined) {
      this.design.stack[d.drop.radialOn].radial = { type: it.type, paint: it.paint };
    } else {
      const part = { type: it.type, paint: it.paint };
      if (it.carried && HOLDS_RADIAL.has(it.type)) part.radial = it.carried;
      this.design.stack.splice(d.drop.index, 0, part);
    }
    this.app.audio.play('snap');
    this.rebuild();
  }

  // ---- frame -------------------------------------------------------------

  update(dt) {
    this.time += dt;
    if (!this.drag) this.spin += dt * 0.35;
    this.rocket.group.rotation.y = Math.sin(this.spin) * 0.6;
    const h = Math.max(4, this.rocket.height);
    const hh = window.innerHeight;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const fitH = (h * 0.5 + 2.2) / tan;
    const fitW = (3.2 + 1.5) / (tan * this.camera.aspect);
    const dist = Math.max(fitH, fitW) * 1.35 + 4;
    const visH = 2 * dist * tan;
    const shift = visH * (70 / hh);
    const sway = Math.sin(this.time * 0.2) * 0.12;
    this.camera.position.set(Math.sin(sway) * dist, h * 0.5 + dist * 0.12, Math.cos(sway) * dist);
    this.camera.lookAt(0, h * 0.5 - shift, 0);
    const k = 1 + Math.sin(this.time * 13) * 0.08 + Math.sin(this.time * 7.3) * 0.08;
    this.fireSprites[0].scale.set(2.6 * k, 3.6 * (2 - k), 1);
    this.fireSprites[1].scale.set(1.6 * (2 - k), 2.2 * k, 1);
    this.fireLight.intensity = 34 + 10 * Math.sin(this.time * 17) * Math.sin(this.time * 5);
    if (this.indicator.visible) this.indicator.material.opacity = 0.6 + 0.4 * Math.sin(this.time * 8);
    for (const [i, l] of this.rocket.lights.entries()) l.visible = Math.sin(this.time * 3 + i * 1.7) > -0.3;
  }
}
