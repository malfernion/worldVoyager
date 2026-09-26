// Buttons, readouts and touch gestures for flying.
import { sliderToDist, distToSlider } from './zoom.js';

const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);

export class FlightHud {
  constructor(app) {
    this.app = app;
    this.el = (id) => document.getElementById(id);
    this.timer = 0;
    this.bindHold('go-btn', (on) => (this.scene.input.go = on));
    this.bindHold('left-btn', (on) => (this.scene.input.left = on));
    this.bindHold('right-btn', (on) => (this.scene.input.right = on));
    for (const btn of document.querySelectorAll('.helper[data-helper]')) {
      const mode = btn.dataset.helper;
      if (btn.classList.contains('hold')) {
        this.bindHold(btn, (on) => this.scene.holdHelper(mode, on));
      } else {
        btn.addEventListener('click', () => {
          this.app.audio.play('tap');
          this.scene.helper(mode);
        });
      }
    }
    const click = (id, fn) => this.el(id).addEventListener('click', () => {
      this.app.audio.play('tap');
      fn();
    });
    click('map-btn', () => this.scene.toggleMap());
    click('drive-btn', () => this.scene.drive.deploy());
    click('home-btn', () => this.scene.drive.goHome());
    this.bindHold('reverse-btn', (on) => (this.scene.input.back = on));
    this.bindHold('jump-btn', (on) => (this.scene.input.jump = on));
    click('warp-btn', () => this.scene.setWarp(1));
    click('slower-btn', () => this.scene.setWarp(-1));
    click('normal-btn', () => this.scene.setWarp(0, true));
    click('rewind-btn', () => this.scene.rewind());
    click('build-btn', () => this.app.toBuilder());
    click('goto-btn', () => this.scene.helper('goto'));
    click('coach-toggle', () => this.scene.setCoaching(!this.scene.coaching));
    click('target-close', () => this.scene.setTarget(null));
    click('center-btn', () => this.scene.focusMapOn(this.scene.flight.state.body, true));
    click('crash-rewind', () => this.scene.rewind());
    click('crash-pad', () => this.scene.resetToPad());
    click('crash-build', () => this.app.toBuilder());
    this.el('goal-banner').addEventListener('click', () => {
      const g = this.app.progress.currentGoal;
      if (g) this.app.pip(g.hint, { speak: true, key: 'goal' });
    });
    this.bindKeys();
    this.bindZoomSlider();
  }

  // Zoom slider: logarithmic in real camera distance, left = close up, right = far away.
  // Pinch, wheel and the slider all go through the scene's setViewDist, so they stay in sync.
  bindZoomSlider() {
    const slider = this.el('zoom-slider');
    slider.addEventListener('input', () => {
      const s = this.scene;
      s.setViewDist(sliderToDist(+slider.value, s.zoomLimits()));
    });
    slider.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  syncZoomSlider() {
    const slider = this.el('zoom-slider');
    if (document.activeElement === slider) return;
    const s = this.scene;
    slider.value = String(Math.round(distToSlider(s.viewDist(), s.zoomLimits())));
  }

  get scene() {
    return this.app.flightScene;
  }

  bindHold(idOrEl, fn) {
    const el = typeof idOrEl === 'string' ? this.el(idOrEl) : idOrEl;
    const on = (e) => {
      e.preventDefault();
      this.app.audio.start();
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('pressed');
      fn(true);
    };
    const off = () => {
      if (!el.classList.contains('pressed')) return;
      el.classList.remove('pressed');
      fn(false);
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', off);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindKeys() {
    const map = {
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
      Space: 'go', ArrowUp: 'go', KeyW: 'go', ArrowDown: 'back', KeyS: 'back',
    };
    const handle = (e, down) => {
      if (this.app.screen !== 'flight') return;
      let k = map[e.code];
      if (this.scene.mode === 'drive' && e.code === 'Space') k = 'jump';
      if (down && e.code === 'KeyB') {
        if (this.scene.mode === 'drive') this.scene.drive.goHome();
        else this.scene.drive.deploy();
      }
      if (k) {
        e.preventDefault();
        this.scene.input[k] = down;
        return;
      }
      if (!down) return;
      if (e.code === 'KeyM' || e.code === 'Tab') {
        e.preventDefault();
        this.scene.toggleMap();
      }
      if (e.code === 'Period') this.scene.setWarp(1);
      if (e.code === 'Comma') this.scene.setWarp(-1);
      if (e.code === 'Slash') this.scene.setWarp(0, true);
      if (e.code === 'Backspace' || e.code === 'KeyR') this.scene.rewind();
      if (e.code === 'KeyO') this.scene.helper('orbit');
      if (e.code === 'KeyL') this.scene.helper('land');
    };
    window.addEventListener('keydown', (e) => handle(e, true));
    window.addEventListener('keyup', (e) => handle(e, false));
  }

  /** Pinch / wheel zoom and map panning on the 3D view. */
  bindGestures(canvas) {
    const pts = new Map();
    let pinch = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (this.app.screen !== 'flight') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.app.screen !== 'flight' || !pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      const cur = { x: e.clientX, y: e.clientY };
      pts.set(e.pointerId, cur);
      const s = this.scene;
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoomBy(pinch / d);
        pinch = d;
      } else if (pts.size === 1 && s.mode === 'map') {
        const worldPerPx = (2 * s.camera.position.z * Math.tan((s.camera.fov * Math.PI) / 360)) / window.innerHeight;
        s.mapEase = false;
        s.pan.x -= (cur.x - prev.x) * worldPerPx;
        s.pan.y += (cur.y - prev.y) * worldPerPx;
      }
    });
    const end = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      if (this.app.screen !== 'flight') return;
      e.preventDefault();
      this.zoomBy(Math.exp(e.deltaY * 0.0015));
    }, { passive: false });
  }

  zoomBy(k) {
    const s = this.scene;
    s.setViewDist(s.viewDist() * k);
  }

  showTarget(body) {
    const card = this.el('target-card');
    card.classList.toggle('hidden', !body);
    if (!body) return;
    this.el('target-img').src = this.app.thumbs[body.id];
    this.el('target-name').textContent = `${body.icon} ${body.name}`;
  }

  /**
   * Layout check (#22): which visible HUD controls overlap, poke off screen or are too small
   * to tap. Run `app.hud.layoutProblems()` in the console at each screen size and mode.
   */
  layoutProblems() {
    const items = [...document.querySelectorAll('#flight-screen .btn, #flight-screen > .chip, #readout, #zoom-box, #height-meter, #vel-dial, #target-card, #crash-card')]
      .filter((el) => el.getClientRects().length && !el.closest('.hidden'))
      .map((el) => ({ el, r: el.getBoundingClientRect(), name: el.id || el.dataset.helper || el.className }));
    const out = [];
    const W = window.innerWidth, H = window.innerHeight;
    for (const a of items) {
      if (a.r.left < 0 || a.r.top < 0 || a.r.right > W || a.r.bottom > H) out.push(`${a.name} is off screen`);
      if (a.el.matches('.helper, .steer, .go-btn') && Math.min(a.r.width, a.r.height) < 56) out.push(`${a.name} is small (${Math.round(a.r.width)} px)`);
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 1 && h > 1) out.push(`${a.name} overlaps ${b.name}`);
      }
    }
    return out;
  }

  showCrash() {
    this.el('crash-card').classList.remove('hidden');
  }

  hideCrash() {
    this.el('crash-card').classList.add('hidden');
  }

  /** Coaching cues: glow the right turn button and tell them when to hold or let go. */
  updateCoach() {
    const s = this.scene;
    const ap = s.autopilot;
    const st = s.flight.state;
    const on = ap.coachSession && !ap.driving && !s.crashed;
    let turn = 0, hint = '';
    if (on && ap.cmd.angle !== null && !st.landed) {
      const d = Math.atan2(Math.sin(ap.cmd.angle - st.angle), Math.cos(ap.cmd.angle - st.angle));
      if (Math.abs(d) > 0.12) turn = Math.sign(d);
    }
    if (on) {
      if (ap.cmd.throttle > 0 && turn === 0) hint = 'HOLD!';
      else if (ap.cmd.throttle > 0) hint = 'Turn first';
      else if (s.input.go) hint = 'LET GO!';
    }
    this.el('left-btn').classList.toggle('coach-glow', turn > 0);
    this.el('right-btn').classList.toggle('coach-glow', turn < 0);
    this.el('go-btn').classList.toggle('coach-glow', hint === 'HOLD!');
    const h = this.el('go-hint');
    h.classList.toggle('hidden', !hint);
    h.textContent = hint;
    h.className = hint ? (hint === 'HOLD!' ? 'hold' : hint === 'LET GO!' ? 'letgo' : 'wait') : 'hidden';
  }

  /** Little dial under the height meter: which way we're moving, how fast. */
  updateVelocity() {
    const v = this.scene.velocity;
    const dial = this.el('vel-dial');
    dial.classList.toggle('hidden', !v);
    if (!v) return;
    dial.dataset.zone = v.zone;
    dial.firstChild.style.transform = `rotate(${v.screenAngle}rad)`;
    this.el('vel-num').textContent = Math.round(v.speed);
  }

  update(dt) {
    this.updateCoach();
    this.updateVelocity();
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    const s = this.scene;
    const f = s.flight;
    const st = f.state;
    const b = st.body;
    const alt = Math.max(0, f.altitude);
    const driving = s.mode === 'drive';
    // Classes the CSS lays the HUD out by: driving, map, and crashed (only the crash card's choices).
    const screen = this.el('flight-screen');
    screen.classList.toggle('driving', driving);
    screen.classList.toggle('map', s.mode === 'map');
    screen.classList.toggle('crashed', s.crashed);
    // Only the helpers that make sense now: on the ground, 🚙 Drive and 🌀 Orbit (plus the 🧭 switch).
    for (const id of ['faster', 'slower', 'land']) {
      document.querySelector(`.helper[data-helper="${id}"]`).classList.toggle('hidden', st.landed);
    }
    this.el('drive-btn').classList.toggle('hidden', !s.drive.canDeploy());
    this.el('jump-btn').classList.toggle('hidden', !(driving && s.drive.kind?.jump));
    const compass = this.el('home-compass');
    compass.classList.toggle('hidden', !driving || !s.homeCompass);
    if (driving && s.homeCompass) {
      compass.firstChild.style.transform = `rotate(${s.homeCompass.angle}rad)`;
      this.el('home-dist').textContent = `${fmt(s.drive.distanceToRocket)} m`;
      // Super hopping round Nibble, or driving round the world (#29): the ring fills as we go.
      const bg = s.drive.buggy;
      const ring = this.el('orbit-ring');
      const lap = bg?.orbiting ? Math.min(1, bg.lap / (2 * Math.PI)) : s.drive.roundShown ? bg.round.progress : -1;
      ring.classList.toggle('hidden', lap < 0);
      if (lap >= 0) {
        ring.style.setProperty('--lap', lap.toFixed(3));
        if (ring.firstChild.textContent !== b.icon) ring.firstChild.textContent = b.icon;
      }
    }
    // The ✨ compass (#15): points at the nearest secret on this world, glowing brighter up close.
    const secret = this.el('secret-compass');
    const sc = driving ? s.secretCompass : null;
    secret.classList.toggle('hidden', !sc);
    if (sc) {
      secret.firstChild.style.transform = `rotate(${sc.angle}rad)`;
      secret.lastChild.textContent = sc.icon;
      secret.style.setProperty('--near', sc.near.toFixed(2));
      secret.classList.toggle('close', sc.near > 0.75);
    }
    if (driving) {
      this.el('where').textContent = `${b.icon} ${b.name}`;
      this.el('alt').textContent = `🚙 ${s.drive.kind?.name ?? ''}`;
      this.el('spd').textContent = `💨 ${fmt(s.drive.buggy?.speed ?? 0)}`;
      this.syncZoomSlider();
      return;
    }
    this.el('where').textContent = `${b.icon} ${b.name}`;
    this.el('alt').textContent = st.landed ? '🛬 landed' : `⬆ ${fmt(alt)}`;
    this.el('spd').textContent = `💨 ${fmt(f.speed)}`;
    const warp = Math.round(s.warp);
    // ⏸ while Pip pauses to explain a marker (#33).
    this.el('warp-label').textContent = s.explaining ? '⏸' : `×${warp}`;
    this.el('speed').classList.toggle('fast', warp > 1);
    this.el('normal-btn').classList.toggle('lit', warp <= 1);
    this.syncZoomSlider();
    const meter = this.el('height-meter');
    meter.classList.toggle('hidden', b.kind === 'star' || s.mode === 'map');
    meter.querySelector('.fill').style.height = `${Math.min(100, (alt / (b.spaceLine * 1.5)) * 100)}%`;
    this.el('map-btn').textContent = s.mode === 'map' ? '🚀' : '🗺️';
    this.el('map-tools').classList.toggle('hidden', s.mode !== 'map');
    for (const btn of document.querySelectorAll('.helper')) btn.classList.toggle('active', s.autopilot.mode === btn.dataset.helper);
    // One trip button; what it does follows the coach switch.
    const coach = s.coaching;
    const toggle = this.el('coach-toggle');
    toggle.classList.toggle('on', coach);
    toggle.classList.toggle('coach-glow', !!s.coachNudge && !coach && !this.app.progress.has('space'));
    toggle.setAttribute('aria-pressed', String(coach));
    toggle.lastChild.textContent = coach ? 'Coach on' : 'Coach off';
    this.el('goto-btn').textContent = s.tripRunning ? '✋ Stop' : coach ? '🧭 Let\'s go!' : '🤖 Take me there!';
    const status = this.el('status-line');
    status.classList.toggle('hidden', !s.autopilot.status);
    // Who's flying: 🧭 you (Pip coaches) or 🤖 Pip.
    status.textContent = s.autopilot.status ? `${s.autopilot.coachSession ? '🧭' : '🤖'} ${s.autopilot.status}` : '';
    const g = this.app.progress.currentGoal;
    this.el('goal-banner').textContent = g ? `${g.icon} ${g.text}` : '🌟 You explored everything! Fly anywhere!';
  }
}
