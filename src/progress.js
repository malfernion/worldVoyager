// Goals, stickers and saved stuff (localStorage, wrapped so private mode never breaks the game).

const KEY = 'worldVoyager.v1';

export const GOALS = [
  { id: 'space', icon: '🚀', text: 'Fly up into space!', hint: 'Hold the big GO button to blast off!' },
  { id: 'orbit', icon: '🌀', text: 'Go all the way around Homestead!', hint: 'Once you are high up, tip sideways and hold GO. Or tap the swirly orbit helper!' },
  { id: 'land-homestead', icon: '🏡', text: 'Come home and land softly!', hint: 'Tap the landing helper, or slow down gently before you touch the ground.' },
  { id: 'visit-pebble', icon: '🌕', text: 'Fly to Pebble, the moon!', hint: 'Open the map and tap Pebble. Then tap Show me how!' },
  { id: 'land-pebble', icon: '🌕', text: 'Land on Pebble!', hint: 'Tap the landing helper when you are going around Pebble.' },
  { id: 'visit-dusty', icon: '🔴', text: 'Visit Dusty, the red planet!', hint: 'Open the map and tap Dusty.' },
  { id: 'land-dusty', icon: '🔴', text: 'Land on Dusty!', hint: 'Dusty has a giant volcano. Can you find it?' },
  { id: 'land-nibble', icon: '🥔', text: 'Land on Nibble, the potato moon!', hint: 'Nibble goes around Dusty. It is tiny!' },
  { id: 'visit-ringo', icon: '🪐', text: 'Fly to Ringo, the ringed giant!', hint: 'Ringo is far, far away. Open the map and tap Ringo.' },
  { id: 'land-sizzle', icon: '🌋', text: 'Land on Sizzle, the volcano moon!', hint: 'Sizzle goes around Ringo.' },
  { id: 'land-frosty', icon: '❄️', text: 'Land on Frosty, the icy moon!', hint: 'Frosty goes around Ringo too.' },
];

export const STICKERS = {
  space: { icon: '🚀', name: 'Space Cadet', say: 'You made it to space! Space starts way up high where the sky turns black.' },
  orbit: { icon: '🌀', name: 'Round and Round', say: 'You are in orbit! That means you are falling around the planet so fast you keep missing the ground!' },
  'land-homestead': { icon: '🏡', name: 'Home Sweet Home', say: 'Welcome home, space explorer!' },
  'visit-pebble': { icon: '🌕', name: 'Moon Visitor', say: 'Hello Pebble!' },
  'land-pebble': { icon: '🌕', name: 'Moonwalker' },
  'visit-dusty': { icon: '🔴', name: 'Red Planet Rider', say: 'Hello Dusty, the red planet!' },
  'land-dusty': { icon: '🔴', name: 'Dusty Boots' },
  'land-nibble': { icon: '🥔', name: 'Potato Pilot' },
  'visit-ringo': { icon: '🪐', name: 'Ring Ranger', say: 'Wow, look at those rings! They are made of ice and rock.' },
  'land-sizzle': { icon: '🌋', name: 'Hot Feet' },
  'land-frosty': { icon: '❄️', name: 'Ice Skater' },
  splash: { icon: '🌊', name: 'Splashdown!', say: 'Splash! You landed in the ocean!' },
  dive: { icon: '☁️', name: 'Cloud Diver', say: 'Whoosh! Ringo is all clouds, there is no ground to land on!' },
  sun: { icon: '☀️', name: 'Sunburnt', say: 'That is close enough to Ember! Stars are super hot.' },
  drive: { icon: '🚙', name: 'Off-Roader', say: 'Vroom! Your first drive in the buggy! Steer with the arrows and hold GO to drive.' },
  // A secret: super hop the Hopper all the way round Nibble (see ORBIT in physics/buggy.js).
  'orbit-nibble': { icon: '🛰️', name: 'Moon Orbiter', say: 'You orbited Nibble in your buggy! When you go sideways fast enough, you keep falling around the moon and never hit the ground!' },
  kaboom: { icon: '💥', name: 'Kaboom Club', say: 'Kaboom! Every great explorer crashes sometimes. Let\'s try again!' },
};

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export class Progress {
  constructor() {
    const d = load();
    this.done = d.done || {};
    this.design = d.design || null;
    this.settings = { music: true, sfx: true, voice: true, ...(d.settings || {}) };
    this.listeners = [];
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ done: this.done, design: this.design, settings: this.settings }));
    } catch {
      // Storage may be unavailable (private mode); progress just won't persist.
    }
  }

  has(id) {
    return !!this.done[id];
  }

  /** Mark a goal/sticker as earned. Returns true the first time. */
  earn(id) {
    if (this.done[id] || !STICKERS[id]) return false;
    this.done[id] = Date.now();
    this.save();
    for (const fn of this.listeners) fn(id);
    return true;
  }

  on(fn) {
    this.listeners.push(fn);
  }

  get currentGoal() {
    return GOALS.find((g) => !this.done[g.id]) || null;
  }

  /** Forget everything about this adventure (stickers, goals, saved rocket). Settings stay. */
  reset() {
    this.done = {};
    this.design = null;
    this.save();
  }
}
