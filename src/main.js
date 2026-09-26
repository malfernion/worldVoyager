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
import { SpeechQueue } from './ui/speechQueue.js';
import { AudioEngine } from './audio/audio.js';
import { Progress, STICKERS, DISCOVERY_IDS, BAND_IDS, JOURNEY_DONE, goalShown } from './progress.js';
import { friendLevels, FRIEND_BY_ID } from './physics/friends.js';
import { defaultDesign } from './rocket/parts.js';

const $ = (id) => document.getElementById(id);

class App {
  constructor() {
    this.canvas = $('scene');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.progress = new Progress();
    this.audio = new AudioEngine();
    this.audio.listen(); // the first tap anywhere starts the sound (#24)
    if (/[?&]audiodebug/.test(location.search)) this.audio.showDebug();
    this.narrator = new Narrator(this.audio);
    // Pip says one line at a time (#31): the bubble shows the line being said.
    this.speech = new SpeechQueue({
      play: (item) => this.showLine(item),
      stop: () => this.narrator.stop(),
      onEnd: (item) => this.lineEnded(item),
    });
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

    // Pip's friends' parts in the music (#16): where we're listening from, and how loud each is.
    this.where = { body: null, p: [0, 0, 0], ground: false, home: false, party: false, solo: null };
    this.levels = [];
    this.has = (id) => this.progress.has(id);
    this.bandTimer = 0;
    this.solo = { id: null, until: 0 };

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
      this.narrator.preload();
      this.toBuilder();
      const g = this.progress.currentGoal;
      this.pip(g && g.id === 'space'
        ? 'Howdy, space explorer! I\'m Pip. Let\'s build a rocket! Tap or drag parts, then press Fly!'
        : 'Welcome back, explorer! Let\'s build a rocket!', { speak: true, key: 'hello' });
    });
    $('journal-btn').addEventListener('click', () => {
      this.audio.play('tap');
      this.openJournal();
    });
    $('journal-close').addEventListener('click', () => {
      this.audio.play('tap');
      $('journal-screen').classList.add('hidden');
    });
    const openSettings = () => {
      this.audio.play('tap');
      // Pause the flight while the menu is open.
      if (this.screen === 'flight') this.flightScene.input = { left: false, right: false, go: false };
      const st = this.progress.settings;
      $('set-music').checked = st.music;
      $('set-sfx').checked = st.sfx;
      $('set-voice').checked = st.voice;
      $('settings-card').classList.remove('hidden');
    };
    for (const [id, key] of [['set-music', 'music'], ['set-sfx', 'sfx'], ['set-voice', 'voice']]) {
      $(id).addEventListener('change', (e) => {
        this.progress.settings[key] = e.target.checked;
        this.progress.save();
        this.applySettings();
      });
    }
    $('settings-btn').addEventListener('click', openSettings);
    $('flight-settings-btn').addEventListener('click', openSettings);
    $('settings-close').addEventListener('click', () => $('settings-card').classList.add('hidden'));
    $('reset-btn').addEventListener('click', () => {
      if (!window.confirm('Start a brand new adventure? Your rocket, stickers and progress will be cleared.')) return;
      this.newAdventure();
    });
  }

  /** Wipe the adventure and start again from the title screen, as on the very first visit. */
  newAdventure() {
    this.progress.reset();
    this.speech.clear({ actions: true });
    clearTimeout(this.pipTimer);
    clearTimeout(this.stickerTimer);
    for (const id of ['settings-card', 'garage-panel', 'journal-screen', 'sticker-pop', 'pip']) $(id).classList.add('hidden');

    const b = this.builder;
    b.design = defaultDesign();
    b.pendingGarage = false;
    b.rebuild(false);

    const fs = this.flightScene;
    fs.drive.cancel();
    fs.autopilot.stop();
    fs.input = { left: false, right: false, go: false };
    fs.flight = null; // so the clock (and the planets) start from the beginning again
    fs.start(b.design);
    fs.setTarget(null);
    fs.zoom = 2.2;
    this.audio.setEngine(0);
    this.show('title');
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
    this.flightScene.drive?.cancel();
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
    // The starter goal, and the very first time the choice explained after it (#36), with the
    // 🧭 glowing. After the starter journey Pip says nothing on the pad: there's no goal to read.
    const line = this.progress.launchLine();
    this.flightScene.introGlow = !!line?.first;
    if (line) this.pip(line.text, { speak: true, key: 'goal' });
  }

  /** The builder's goal chip: shown only while there's a goal to show (`goalShown`, #36). */
  updateGoalChip() {
    const g = goalShown(this.progress);
    // Hidden, not removed, so the ⚙️ button stays on the right of the top bar.
    $('goal-chip').style.visibility = g ? '' : 'hidden';
    $('goal-chip').textContent = g ? `${g.icon} Next: ${g.text}` : '';
  }

  /**
   * Pip says something (#31): it waits its turn in the speech queue, and the bubble shows it
   * while it's said. `pri`: 'urgent' (crash, safety), 'cue' (the coach's HOLD / LET GO),
   * 'normal', or 'chatter' (dropped if Pip is busy). `key`: lines of one kind replace each other.
   * `duration`: keep the bubble up at least this long (ms). `from`: who said it ('helper': the autopilot, 'coach': a coached program), so
   * those lines can be dropped when they no longer apply. Returns false if dropped.
   */
  pip(text, { speak = false, duration, pri = 'normal', key = null, stale, onStart, keep, from } = {}) {
    return this.speech.push(text, { pri, key, stale, speak, duration, onStart, keep, from });
  }

  /** Run fn once Pip has finished what's already queued (e.g. the next sticker after this one). */
  afterPip(fn) {
    this.speech.action(fn);
  }

  /** Stop talking now and drop waiting lines (a crash makes them old news). */
  hush() {
    this.speech.clear();
    clearTimeout(this.pipTimer);
    this.pipTimer = setTimeout(() => $('pip').classList.add('hidden'), 1500);
  }

  /** The speech queue starts a line: show the bubble, and say it (if the voice is on). */
  showLine(item) {
    const box = $('pip');
    $('pip-text').textContent = item.text;
    box.classList.remove('hidden');
    box.style.animation = 'none';
    void box.offsetWidth;
    box.style.animation = '';
    clearTimeout(this.pipTimer);
    this.pipTimer = null;
    return item.speak ? this.narrator.say(item.text) : false;
  }

  /** A line has been said: the bubble lingers a little (and at least its own minimum). */
  lineEnded(item) {
    const shown = performance.now() - item.started * 1000;
    const min = item.duration ?? 2500 + item.text.length * 55;
    const box = $('pip');
    this.pipTimer = setTimeout(() => box.classList.add('hidden'), Math.max(1500, min - shown));
  }

  onSticker(id) {
    const st = STICKERS[id];
    // Landing, visiting and discovery (#15) stickers show their world.
    const bodyId = id.startsWith('land-') || id.startsWith('visit-') ? id.split('-')[1] : st.world ?? null;
    const body = bodyId ? this.system.byId[bodyId] : null;
    // The sticker pops up when Pip gets to it, so it matches what Pip is saying.
    const pop = () => {
      this.audio.play('sticker');
      const img = $('sticker-img');
      if (body) img.src = this.thumbs[body.id];
      else img.removeAttribute('src');
      $('sticker-icon').textContent = st.icon;
      $('sticker-name').textContent = st.name;
      const el = $('sticker-pop');
      el.classList.remove('hidden');
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
      clearTimeout(this.stickerTimer);
      this.stickerTimer = setTimeout(() => el.classList.add('hidden'), 3200);
    };
    const line = id.startsWith('land-') ? `You landed on ${body.name}! ${body.blurb}` : st.say || st.name;
    // A sticker is worth waiting for: it keeps longer in the queue than other news, and a full
    // queue drops other lines before it (a first landing can bring a sticker, a discovery and a friend).
    this.pip(line, { speak: true, duration: Math.max(7000, line.length * 70), stale: 60, onStart: pop, keep: true });
    // Then, once that's been said, the next starter goal, or that the journey is finished (#36):
    // queued behind the sticker line, never on a timer. The journey's end is kept like a sticker.
    for (const next of this.progress.afterSticker(id)) {
      this.pip(next, { speak: true, key: 'goal', ...(next === JOURNEY_DONE && { stale: 60, keep: true }) });
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
      // 👀 visited, 🚩 landed, 🌍 driven all the way round (#29).
      const badges = [this.progress.has(`visit-${b.id}`) ? '👀' : '', this.progress.has(`land-${b.id}`) ? '🚩' : '', this.progress.rounds[b.id] ? '🌍' : ''].join(' ');
      card.innerHTML = `<img src="${this.thumbs[b.id]}" alt=""><b>${visited ? b.name : '???'}</b><div class="badges">${badges}</div>`;
      card.addEventListener('click', () => {
        this.audio.play('tap');
        this.pip(visited ? b.blurb : 'We haven\'t been there yet. Let\'s go exploring!', { speak: true, duration: 8000, key: 'journal' });
      });
      worlds.appendChild(card);
    }
    const stickers = $('journal-stickers');
    stickers.innerHTML = '';
    for (const [id, st] of Object.entries(STICKERS)) {
      if (DISCOVERY_IDS.includes(id) || BAND_IDS.includes(id)) continue;
      const d = document.createElement('div');
      d.className = `mini-sticker${this.progress.has(id) ? '' : ' locked'}`;
      d.innerHTML = `<span>${st.icon}</span>${this.progress.has(id) ? st.name : '?'}`;
      stickers.appendChild(d);
    }
    // Discoveries (#15): found ones show their sticker; ones still hidden show their world and
    // a ?. Tap either and Pip says the fact again, or gives a gentle hint.
    const found = $('journal-discoveries');
    found.innerHTML = '';
    for (const id of DISCOVERY_IDS) {
      const st = STICKERS[id];
      const has = this.progress.has(id);
      const world = this.system.byId[st.world];
      const d = document.createElement('div');
      d.className = `mini-sticker${has ? '' : ' locked'}`;
      d.innerHTML = `<span>${has ? st.icon : world.icon}</span>${has ? st.name : world.name}`;
      d.addEventListener('click', () => {
        this.audio.play('tap');
        const line = has ? st.say : st.hint;
        this.pip(line, { speak: true, duration: Math.max(6000, line.length * 70), key: 'journal' });
      });
      found.appendChild(d);
    }
    // The band (#16): Pip on banjo, then each friend (found: their sticker, and tapping one has
    // Pip say hello again while their part plays up loud; not yet: their world and a hint),
    // then Full Band.
    const band = $('journal-band');
    band.innerHTML = '';
    const pip = document.createElement('div');
    pip.className = 'mini-sticker';
    pip.innerHTML = '<span>🪕</span>Pip';
    pip.addEventListener('click', () => {
      this.audio.play('tap');
      this.pip('That\'s me! I play the banjo.', { speak: true, key: 'journal' });
    });
    band.appendChild(pip);
    for (const id of BAND_IDS) {
      const st = STICKERS[id];
      const has = this.progress.has(id);
      const world = this.system.byId[st.world];
      const d = document.createElement('div');
      d.className = `mini-sticker${has ? '' : ' locked'}`;
      d.innerHTML = `<span>${has ? st.icon : world.icon}</span>${has ? st.name : world.name}`;
      d.addEventListener('click', () => {
        this.audio.play('tap');
        const line = has ? st.say : st.hint;
        this.pip(line, { speak: true, duration: Math.max(6000, line.length * 70), key: 'journal' });
        if (has && FRIEND_BY_ID[id]) this.solo = { id, until: performance.now() + 9000 };
      });
      band.appendChild(d);
    }
    $('journal-screen').classList.remove('hidden');
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.flightScene.resize(w, h);
    this.builder.resize(w, h);
  }

  /**
   * A few times a second: how loud is each friend's part from where we are (#16)? In the
   * workshop we're home at the campfire; otherwise we listen from the rocket or the buggy.
   */
  updateBand(dt, now) {
    this.bandTimer -= dt;
    if (this.bandTimer > 0) return;
    this.bandTimer = 0.1;
    const w = this.where;
    if (this.screen === 'builder') {
      w.body = null;
      w.home = true;
      w.party = this.flightScene.time < this.flightScene.bandUntil;
    } else {
      this.flightScene.listener(w);
    }
    w.solo = now < this.solo.until ? this.solo.id : null;
    friendLevels(w, this.has, this.levels);
    this.audio.setFriendLevels(this.levels);
  }

  frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.updateBand(dt, now);
    if (this.screen === 'builder') {
      this.builder.update(dt);
      this.renderer.render(this.builder.scene, this.builder.camera);
    } else {
      const fs = this.flightScene;
      if (this.screen === 'flight' && !$('settings-card').classList.contains('hidden')) {
        this.audio.setEngine(0);
        this.renderer.render(fs.scene, fs.camera);
        return;
      }
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
