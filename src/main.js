// World Voyager: app shell. Owns the renderer, switches between title, workshop and flight,
// and handles Pip's speech bubbles, stickers and the sticker book.
import * as THREE from 'three';
import { createSystem } from './physics/bodies.js';
import { createBodyVisual } from './world/planets.js';
import { planetThumb } from './world/thumbs.js';
import { FlightScene } from './scenes/flight.js';
import { BuilderScene } from './scenes/builder.js';
import { FlightHud } from './ui/flightHud.js';
import { Narrator } from './ui/narrator.js';
import { AudioEngine } from './audio/audio.js';
import { Progress, GOALS, STICKERS } from './progress.js';

const $ = (id) => document.getElementById(id);

class App {
  constructor() {
    this.canvas = $('scene');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.progress = new Progress();
    this.audio = new AudioEngine();
    this.narrator = new Narrator();
    this.applySettings();

    this.system = createSystem();
    this.visuals = this.system.bodies.map((b) => createBodyVisual(b));
    this.thumbs = Object.fromEntries(this.visuals.map((v) => [v.body.id, planetThumb(v)]));

    this.flightScene = new FlightScene(this);
    this.builder = new BuilderScene(this);
    this.hud = new FlightHud(this);
    this.hud.bindGestures(this.canvas);
    this.progress.on((id) => this.onSticker(id));

    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.screen === 'builder') this.builder.canvasDown(e);
    });
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.bindMenus();

    // The title screen shows the launch pad at dusk.
    this.flightScene.start(this.progress.design || this.builder.design);
    this.flightScene.zoom = 2.2;
    this.show('title');
    $('loading').textContent = '';

    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  applySettings() {
    const st = this.progress.settings;
    this.audio.setMusic(st.music);
    this.audio.setSfx(st.sfx);
    this.narrator.enabled = st.voice;
  }

  bindMenus() {
    $('play-btn').addEventListener('click', () => {
      this.audio.start();
      this.audio.play('tap');
      this.toBuilder();
      const g = this.progress.currentGoal;
      this.pip(g && g.id === 'space'
        ? 'Howdy, space explorer! I\'m Pip. Let\'s build a rocket! Tap or drag parts, then press Fly!'
        : 'Welcome back, explorer! Let\'s build a rocket!', { speak: true });
    });
    $('journal-btn').addEventListener('click', () => {
      this.audio.play('tap');
      this.openJournal();
    });
    $('journal-close').addEventListener('click', () => {
      this.audio.play('tap');
      $('journal-screen').classList.add('hidden');
    });
    $('settings-btn').addEventListener('click', () => {
      this.audio.play('tap');
      const st = this.progress.settings;
      $('set-music').checked = st.music;
      $('set-sfx').checked = st.sfx;
      $('set-voice').checked = st.voice;
      $('settings-card').classList.remove('hidden');
    });
    for (const [id, key] of [['set-music', 'music'], ['set-sfx', 'sfx'], ['set-voice', 'voice']]) {
      $(id).addEventListener('change', (e) => {
        this.progress.settings[key] = e.target.checked;
        this.progress.save();
        this.applySettings();
      });
    }
    $('settings-close').addEventListener('click', () => $('settings-card').classList.add('hidden'));
    $('reset-btn').addEventListener('click', () => {
      if (!window.confirm('Start a brand new adventure? Your stickers will be cleared.')) return;
      this.progress.reset();
      $('settings-card').classList.add('hidden');
      this.updateGoalChip();
    });
  }

  show(name) {
    this.screen = name;
    for (const s of ['title', 'builder', 'flight']) $(`${s}-screen`).classList.toggle('hidden', s !== name);
    $('journal-screen').classList.add('hidden');
    if (name !== 'flight') this.flightScene.clearMarkers();
    this.updateGoalChip();
  }

  toBuilder() {
    this.flightScene.input = { left: false, right: false, go: false };
    this.flightScene.autopilot?.stop();
    this.audio.setEngine(0);
    this.audio.setMood('camp');
    this.show('builder');
  }

  launch(design) {
    this.audio.play('whoosh');
    this.flightScene.start(design);
    this.flightScene.setTarget(null);
    this.show('flight');
    const g = this.progress.currentGoal;
    if (g) this.pip(`${g.text} ${g.hint}`, { speak: true });
  }

  updateGoalChip() {
    const g = this.progress.currentGoal;
    $('goal-chip').textContent = g ? `${g.icon} Next: ${g.text}` : '🌟 You explored everything!';
  }

  pip(text, { speak = false, duration } = {}) {
    const box = $('pip');
    $('pip-text').textContent = text;
    box.classList.remove('hidden');
    box.style.animation = 'none';
    void box.offsetWidth;
    box.style.animation = '';
    clearTimeout(this.pipTimer);
    this.pipTimer = setTimeout(() => box.classList.add('hidden'), duration ?? 2500 + text.length * 55);
    if (speak) this.narrator.say(text);
  }

  onSticker(id) {
    const st = STICKERS[id];
    const bodyId = id.startsWith('land-') || id.startsWith('visit-') ? id.split('-')[1] : null;
    const body = bodyId ? this.system.byId[bodyId] : null;
    this.audio.play('sticker');
    const img = $('sticker-img');
    if (body) img.src = this.thumbs[body.id];
    else img.removeAttribute('src');
    $('sticker-icon').textContent = st.icon;
    $('sticker-name').textContent = st.name;
    const pop = $('sticker-pop');
    pop.classList.remove('hidden');
    pop.style.animation = 'none';
    void pop.offsetWidth;
    pop.style.animation = '';
    clearTimeout(this.stickerTimer);
    this.stickerTimer = setTimeout(() => pop.classList.add('hidden'), 3200);
    const line = id.startsWith('land-') ? `You landed on ${body.name}! ${body.blurb}` : st.say || st.name;
    this.pip(line, { speak: true, duration: 7000 });
    const next = this.progress.currentGoal;
    if (next && GOALS.some((g) => g.id === id)) {
      setTimeout(() => this.pip(`Next: ${next.text}`, { speak: true }), 7500);
    }
    this.updateGoalChip();
  }

  openJournal() {
    const worlds = $('journal-worlds');
    worlds.innerHTML = '';
    for (const b of this.system.bodies) {
      const visited = this.progress.has(`visit-${b.id}`) || this.progress.has(`land-${b.id}`) || b === this.system.home || b.kind === 'star';
      const card = document.createElement('div');
      card.className = `world-card${visited ? '' : ' unknown'}`;
      const badges = [this.progress.has(`visit-${b.id}`) ? '👀' : '', this.progress.has(`land-${b.id}`) ? '🚩' : ''].join(' ');
      card.innerHTML = `<img src="${this.thumbs[b.id]}" alt=""><b>${visited ? b.name : '???'}</b><div class="badges">${badges}</div>`;
      card.addEventListener('click', () => {
        this.audio.play('tap');
        this.pip(visited ? b.blurb : 'We haven\'t been there yet. Let\'s go exploring!', { speak: true, duration: 8000 });
      });
      worlds.appendChild(card);
    }
    const stickers = $('journal-stickers');
    stickers.innerHTML = '';
    for (const [id, st] of Object.entries(STICKERS)) {
      const d = document.createElement('div');
      d.className = `mini-sticker${this.progress.has(id) ? '' : ' locked'}`;
      d.innerHTML = `<span>${st.icon}</span>${this.progress.has(id) ? st.name : '?'}`;
      stickers.appendChild(d);
    }
    $('journal-screen').classList.remove('hidden');
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.flightScene.resize(w, h);
    this.builder.resize(w, h);
  }

  frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.screen === 'builder') {
      this.builder.update(dt);
      this.renderer.render(this.builder.scene, this.builder.camera);
    } else {
      const fs = this.flightScene;
      if (this.screen === 'title') {
        fs.input = { left: false, right: false, go: false };
        fs.zoom = 2.2;
      }
      fs.update(dt);
      if (this.screen === 'flight') this.hud.update(dt);
      else fs.clearMarkers();
      this.renderer.render(fs.scene, fs.camera);
    }
  }
}

window.app = new App();
