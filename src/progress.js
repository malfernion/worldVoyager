// Goals, stickers and saved stuff (localStorage, wrapped so private mode never breaks the game).

const KEY = 'worldVoyager.v1';

// The starter journey (#36): these goals, in order, then the goals end and the game is open.
// Only these are goals; every other world's visit and landing stickers are just stickers.
export const GOALS = [
  { id: 'space', icon: '🚀', text: 'Fly up into space!', hint: 'Hold the big GO button to blast off!' },
  { id: 'orbit', icon: '🌀', text: 'Go all the way around Homestead!', hint: 'Once you are high up, tip sideways and hold GO. Or tap the swirly button and I\'ll fly! Turn on the compass and I\'ll show you how!' },
  { id: 'land-homestead', icon: '🏡', text: 'Come home and land softly!', hint: 'Slow down gently before you touch the ground. Or tap the landing button.' },
  { id: 'visit-pebble', icon: '🌕', text: 'Fly to Pebble, the moon!', hint: 'Open the map and tap Pebble.' },
  { id: 'land-pebble', icon: '🌕', text: 'Land on Pebble!', hint: 'Slow down gently before you touch the ground. Or tap the landing button.' },
  // Earned landing on Homestead once `land-pebble` is done (FlightScene's 'landed' event).
  { id: 'home-again', icon: '🏡', text: 'Fly home and land!', hint: 'Open the map and tap Homestead.' },
];

/** The starter journey's last goal: once it's done, the journey is finished (`Progress.starterDone`). */
export const STARTER_END = GOALS[GOALS.length - 1].id;

/** What Pip says when the starter journey is finished, right after its last sticker line. */
export const JOURNEY_DONE = 'You can fly anywhere now! Pick a world on the map. I can fly you there, or show you how!';

/**
 * The goal the chip (builder) and banner (flight) show, or null to hide them (#36): the current
 * starter goal during the journey, nothing after it. The one place that decides, so a later
 * rule (e.g. a coached trip's destination) goes here.
 */
export function goalShown(progress) {
  return progress.currentGoal;
}

/**
 * Older saves (#36): before the starter journey ended with `home-again`, the goals went on to the
 * later worlds. A save that landed on Pebble and then explored beyond it (any other world's
 * visit or landing sticker) has clearly finished the journey, so it goes straight into the open
 * game. A save that got only as far as Pebble gets the new last goal (fly home and land); one
 * partway through carries on. Changes `done` in place; returns true if it did.
 */
export function migrate(done) {
  if (done[STARTER_END] || !done['land-pebble']) return false;
  const beyond = Object.keys(done).some((id) => /^(visit|land)-/.test(id) && !/-(homestead|pebble)$/.test(id));
  if (!beyond) return false;
  done[STARTER_END] = done['land-pebble'];
  return true;
}

export const STICKERS = {
  space: { icon: '🚀', name: 'Space Cadet', say: 'You made it to space! Space starts way up high where the sky turns black.' },
  orbit: { icon: '🌀', name: 'Round and Round', say: 'You are in orbit! That means you are falling around the planet so fast you keep missing the ground!' },
  'land-homestead': { icon: '🏡', name: 'Home Sweet Home', say: 'Welcome home, space explorer!' },
  'visit-pebble': { icon: '🌕', name: 'Moon Visitor', say: 'Hello Pebble!' },
  'land-pebble': { icon: '🌕', name: 'Moonwalker' },
  // The starter journey's last goal (#36); `world` shows Homestead on the sticker.
  'home-again': { icon: '🎒', name: 'Round Tripper', world: 'homestead', say: 'Home again, all the way from Pebble!' },
  // The later worlds' stickers (#36: no longer goals, same ids so old saves keep them).
  'visit-dusty': { icon: '🔴', name: 'Red Planet Rider', say: 'Hello Dusty, the red planet!' },
  'land-dusty': { icon: '🔴', name: 'Dusty Boots' },
  'land-nibble': { icon: '🥔', name: 'Potato Pilot' },
  'visit-ringo': { icon: '🪐', name: 'Ring Ranger', say: 'Wow, look at those rings! They are made of ice and rock.' },
  'land-sizzle': { icon: '🌋', name: 'Hot Feet' },
  'land-frosty': { icon: '❄️', name: 'Ice Skater' },
  'visit-tumble': { icon: '🔵', name: 'Far Flyer', say: 'You flew all the way to Tumble! It is tipped over on its side.' },
  'visit-flip': { icon: '🔄', name: 'Wrong Way Round', say: 'Flip goes around Tumble backwards, so we did too!' },
  'land-flip': { icon: '⛲', name: 'Geyser Jumper' },
  'visit-ducky': { icon: '☄️', name: 'Comet Catcher', say: 'You caught a comet! When it zooms close to Ember it grows a tail, and the tail always points away from Ember.' },
  'land-ducky': { icon: '🦆', name: 'Comet Lander' },
  splash: { icon: '🌊', name: 'Splashdown!', say: 'Splash! You landed in the ocean!' },
  dive: { icon: '☁️', name: 'Cloud Diver', say: 'Whoosh! Giant planets are all clouds, there is no ground to land on!' },
  sun: { icon: '☀️', name: 'Sunburnt', say: 'That is close enough to Ember! Stars are super hot.' },
  drive: { icon: '🚙', name: 'Off-Roader', say: 'Vroom! Your first drive in the buggy! Steer with the arrows and hold GO to drive.' },
  // Drive all the way round any world (#29, WorldLap in physics/buggy.js). Which worlds: `rounds`.
  'round-world': { icon: '🌍', name: 'Round the World', say: 'We drove all the way round the world! Long ago, a ship called Victoria was the first to sail all the way around the Earth. It took three years!' },
  // A secret: super hop the Hopper all the way round Nibble (see ORBIT in physics/buggy.js).
  'orbit-nibble': { icon: '🛰️', name: 'Moon Orbiter', say: 'You orbited Nibble in your buggy! When you go sideways fast enough, you keep falling around the moon and never hit the ground!' },
  kaboom: { icon: '💥', name: 'Kaboom Club', say: 'Kaboom! Every great explorer crashes sometimes. Let\'s try again!' },

  // Discoveries (#15): secrets on the worlds, each a real bit of space science (where they are
  // and what finds them: src/physics/discoveries.js). `world` is where it hides, and `hint` is
  // what Pip says when a locked one is tapped in the sticker book.
  'find-observatory': {
    icon: '🔭', name: 'Stargazer', world: 'homestead',
    say: 'You found an old telescope! Look, it is pointing at Ringo. Long ago, Galileo looked at Saturn with a tiny telescope. He saw the rings, but he thought they were ears!',
    hint: 'I spotted something wooden on a hilltop, not far from home.',
  },
  'find-footprints': {
    icon: '👣', name: 'Footprint Finder', world: 'pebble',
    say: 'Footprints and a flag! Another explorer was here before us. There is no wind on the Moon. So footprints there can last for millions of years!',
    hint: 'Somebody left something on Pebble. Can you find it in the buggy?',
  },
  'find-mirror': {
    icon: '🔦', name: 'Laser Bouncer', world: 'pebble',
    say: 'A shiny mirror! Astronauts left mirrors like this on the Moon. Scientists shine lasers at them from Earth. The light bounces back and tells them how far away the Moon is!',
    hint: 'Something on Pebble is very shiny. Park right next to it!',
  },
  'find-rover': {
    icon: '🤖', name: 'Rover Buddy', world: 'dusty',
    say: 'Beep boop! A sleepy old rover! A real rover called Opportunity explored Mars. It drove farther than a marathon! And it kept going for almost fifteen years.',
    hint: 'Something is sleeping in the dust on Dusty. Can you wake it up?',
  },
  'find-dust-devil': {
    icon: '🌪️', name: 'Dust Devil', world: 'dusty',
    say: 'Whoosh! We drove through a dust devil! Mars has dust devils taller than mountains. Sometimes they blow the dust off a rover\'s solar panels, like a giant broom!',
    hint: 'Swirly winds dance across Dusty. Can you drive through one?',
  },
  'find-crater': {
    icon: '💫', name: 'Future Ring', world: 'nibble',
    say: 'What a giant crater! It is nearly as big as Nibble. Phobos, a moon of Mars, is slowly falling closer to Mars. One day it may break up and turn into a ring!',
    hint: 'Nibble has a giant hole in it. Can you land in it, or drive in?',
  },
  'find-ring-gap': {
    icon: '🤿', name: 'Ring Diver', world: 'ringo',
    say: 'Whee! We flew through the gap between Ringo and its rings! A spacecraft called Cassini dived through the gap next to Saturn twenty two times!',
    hint: 'Could a rocket fit between Ringo and its rings? Let\'s find out!',
  },
  'find-plume': {
    icon: '💨', name: 'Plume Chaser', world: 'sizzle',
    say: 'Wow, Sizzle\'s biggest volcano! On Io, volcanoes throw plumes way up into space. Some go four hundred kilometres high!',
    hint: 'Sizzle\'s biggest volcano is puffing away. Drive right up to it!',
  },
  'find-ocean': {
    icon: '🐙', name: 'Ocean Spotter', world: 'frosty',
    say: 'Look, a glow deep in the crack! There is an ocean under the ice. Europa\'s hidden ocean has more water than all of Earth\'s oceans put together. Could something live down there?',
    hint: 'I heard a strange hum on Frosty. Park by a deep crack when it is dark!',
  },
  'find-flare': {
    icon: '🌞', name: 'Flare Watcher', world: 'ember',
    say: 'Whoa, a solar flare! Ember threw out a giant loop of glowing gas. Flares from the Sun can make the lights in Earth\'s sky glow. They are called auroras!',
    hint: 'Sometimes Ember flares up! Fly close to it, but not too close!',
  },
  'find-streak': {
    icon: '🌬️', name: 'Streak Spotter', world: 'flip',
    say: 'A long dark streak! The wind blew the geyser\'s dust across the ice. Voyager 2 saw streaks like this on Triton. It is the only spacecraft that ever went there!',
    hint: 'Flip\'s geysers leave dark marks on the ice. Can you drive onto one?',
  },
  'find-philae': {
    icon: '📡', name: 'Lander Finder', world: 'ducky',
    say: 'A little lander, hiding in the shade! A real lander called Philae landed on a comet. It bounced twice and stopped in a shady spot. Then its solar panels could not get enough sunlight.',
    hint: 'Something bounced on Ducky and hid in the shade. Can you find it?',
  },

  // Pip's friends, the space band (#16): where they are, what they play and how loud they are is
  // src/physics/friends.js. `say` is Pip's hello (and again when tapped in the sticker book);
  // `hint` is what Pip says when one still to find is tapped.
  'friend-mossy': {
    icon: '😴', name: 'Mossy', world: 'pebble',
    say: 'Hello, Mossy! Mossy was having a nap on Pebble. Listen, Mossy plays the harmonica! Now Mossy is in our band!',
    hint: 'I can hear a harmonica on Pebble. Who is playing it?',
  },
  'friend-bolt': {
    icon: '🥁', name: 'Bolt', world: 'dusty',
    say: 'Hello, Bolt! Bolt fixes rovers on Dusty. Listen, Bolt plays the drum! Now Bolt is in our band!',
    hint: 'Boom, boom! Somebody is drumming on Dusty.',
  },
  'friend-crumb': {
    icon: '🐭', name: 'Crumb', world: 'nibble',
    say: 'Hello, Crumb! Crumb is tiny, just like Nibble. Listen, Crumb plays the thumb piano! Now Crumb is in our band!',
    hint: 'Something tiny is making music on Nibble.',
  },
  'friend-toasty': {
    icon: '🎻', name: 'Toasty', world: 'sizzle',
    say: 'Hello, Toasty! Toasty loves to watch the warm lava. Listen, Toasty plays the big bass! Now Toasty is in our band!',
    hint: 'Somebody on Sizzle plays a big, deep bass.',
  },
  'friend-flurry': {
    icon: '🎣', name: 'Flurry', world: 'frosty',
    say: 'Hello, Flurry! Flurry goes fishing in the ice on Frosty. Listen, Flurry plays the whistle! Now Flurry is in our band!',
    hint: 'A whistle is tooting on Frosty. Follow the music!',
  },
  'full-band': {
    icon: '🎶', name: 'Full Band', world: 'homestead',
    say: 'Everyone is here! I play the banjo, and all our friends play too. This is the best campfire song ever!',
    hint: 'Find all our friends, then come home to the campfire!',
  },
};

/** Discovery stickers (#15), in sticker-book order. */
export const DISCOVERY_IDS = Object.keys(STICKERS).filter((id) => id.startsWith('find-'));

/** The band's stickers (#16): each friend, then Full Band, in sticker-book order. */
export const FRIEND_IDS = Object.keys(STICKERS).filter((id) => id.startsWith('friend-'));
export const BAND_IDS = [...FRIEND_IDS, 'full-band'];

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
    migrate(this.done); // older saves (#36); saved with the next change
    this.design = d.design || null;
    this.settings = { music: true, sfx: true, voice: true, ...(d.settings || {}) };
    // Screen markers Pip has already explained (#33), and autopilot buttons (`button-orbit`…,
    // #36): { kind: true }. Older saves have none.
    this.markers = d.markers || {};
    // Worlds driven all the way round (#29): { worldId: time }. Older saves have none.
    this.rounds = d.rounds || {};
    this.listeners = [];
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ done: this.done, design: this.design, settings: this.settings, markers: this.markers, rounds: this.rounds }));
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

  /** Has Pip explained this kind of screen marker (▲, 💥…, #33) or autopilot button (#36) yet? */
  explained(kind) {
    return !!this.markers[kind];
  }

  /** Remember a marker kind has been explained, so it only pauses the game once. */
  markExplained(kind) {
    if (this.markers[kind]) return;
    this.markers[kind] = true;
    this.save();
  }

  /** Remember we drove all the way round this world (#29). Returns true the first time. */
  wentRound(world) {
    if (this.rounds[world]) return false;
    this.rounds[world] = Date.now();
    this.save();
    return true;
  }

  /** Is the starter journey (#36) finished? Then there are no goals: the game is open. */
  get starterDone() {
    return !!this.done[STARTER_END];
  }

  /** The next starter goal, or null once the journey is finished. */
  get currentGoal() {
    if (this.starterDone) return null;
    return GOALS.find((g) => !this.done[g.id]) || null;
  }

  /**
   * What Pip says after a sticker's own line (#36): the next goal, only for a starter goal and
   * only while one remains; after the journey's last sticker, that it's finished.
   */
  afterSticker(id) {
    if (id === STARTER_END) return [JOURNEY_DONE];
    const next = this.currentGoal;
    return next && GOALS.some((g) => g.id === id) ? [`Next: ${next.text}`] : [];
  }

  /** Forget everything about this adventure (stickers, goals, saved rocket, explained markers, worlds driven round). Settings stay. */
  reset() {
    this.done = {};
    this.design = null;
    this.markers = {};
    this.rounds = {};
    this.save();
  }
}
