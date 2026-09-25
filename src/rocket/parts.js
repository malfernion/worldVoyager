// Rocket parts catalogue and the simple stats a design gives you.
// No fuel, no wobbly joints: parts only change how strong, how twisty and how
// safe-to-land the rocket is.

export const PAINTS = [
  { id: 'wood', hex: 0xb9844f },
  { id: 'orange', hex: 0xe8743b },
  { id: 'cream', hex: 0xf1e4c8 },
  { id: 'teal', hex: 0x3a9aa0 },
  { id: 'red', hex: 0xc8453b },
  { id: 'mustard', hex: 0xe6b43c },
  { id: 'navy', hex: 0x3d5a8a },
];

export const PARTS = {
  nose: { name: 'Nose', slot: 'stack', mass: 0.2, height: 1.5, paint: 'orange' },
  capsule: { name: 'Cabin', slot: 'stack', mass: 1.0, height: 1.9, crew: true, paint: 'cream' },
  bubble: { name: 'Bubble', slot: 'stack', mass: 0.9, height: 2.0, crew: true, paint: 'teal' },
  tube: { name: 'Tube', slot: 'stack', mass: 0.4, height: 2.0, paint: 'wood' },
  bigtube: { name: 'Tall Tube', slot: 'stack', mass: 0.6, height: 3.2, paint: 'wood' },
  engine: { name: 'Engine', slot: 'stack', mass: 0.5, height: 1.3, thrust: 45, paint: 'navy' },
  bigengine: { name: 'Big Engine', slot: 'stack', mass: 0.9, height: 1.7, thrust: 80, paint: 'navy' },
  fins: { name: 'Fins', slot: 'radial', mass: 0.1, turn: 0.45, paint: 'red' },
  legs: { name: 'Legs', slot: 'radial', mass: 0.2, legs: true, paint: 'mustard' },
  boosters: { name: 'Boosters', slot: 'radial', mass: 1.0, thrust: 50, paint: 'orange' },
  lights: { name: 'Lights', slot: 'radial', mass: 0.05, paint: 'mustard' },
};

export const TRAY_ORDER = ['capsule', 'bubble', 'nose', 'tube', 'bigtube', 'engine', 'bigengine', 'fins', 'legs', 'boosters', 'lights'];

/** Parts that can hold radial attachments. */
export const HOLDS_RADIAL = new Set(['tube', 'bigtube', 'capsule']);

export function defaultDesign() {
  return {
    stack: [
      { type: 'nose', paint: 'orange' },
      { type: 'capsule', paint: 'cream' },
      { type: 'tube', paint: 'wood', radial: { type: 'fins', paint: 'red' } },
      { type: 'tube', paint: 'teal', radial: { type: 'legs', paint: 'mustard' } },
      { type: 'engine', paint: 'navy' },
    ],
  };
}

export function randomDesign(rand = Math.random) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const paint = () => pick(PAINTS).id;
  const stack = [];
  if (rand() < 0.8) stack.push({ type: 'nose', paint: paint() });
  stack.push({ type: pick(['capsule', 'bubble']), paint: paint() });
  const tubes = 1 + Math.floor(rand() * 3);
  const radials = ['fins', 'legs', 'boosters', 'lights'];
  for (let i = 0; i < tubes; i++) {
    const part = { type: pick(['tube', 'bigtube']), paint: paint() };
    if (rand() < 0.6) part.radial = { type: pick(radials), paint: paint() };
    stack.push(part);
  }
  const last = stack[stack.length - 1];
  if (!last.radial) last.radial = { type: 'legs', paint: paint() };
  stack.push({ type: pick(['engine', 'bigengine']), paint: 'navy' });
  return { stack };
}

export function rocketStats(design, homeGravity = 10) {
  let mass = 0, thrust = 0, turn = 1.5, legs = false, crew = false, engines = 0;
  for (const p of design.stack) {
    const def = PARTS[p.type];
    mass += def.mass;
    thrust += def.thrust || 0;
    if (def.thrust) engines++;
    if (def.crew) crew = true;
    if (p.radial) {
      const r = PARTS[p.radial.type];
      mass += r.mass;
      thrust += r.thrust || 0;
      if (r.thrust) engines++;
      turn += r.turn || 0;
      if (r.legs) legs = true;
    }
  }
  const accel = mass > 0 ? thrust / mass : 0;
  const turnRate = Math.min(3.2, turn / Math.max(0.7, Math.sqrt(mass / 2.5)));
  return {
    mass, thrust, accel, legs, crew, engines,
    power: accel / homeGravity, // thrust-to-weight on Homestead
    turnRate,
    safeSpeed: legs ? 10 : 6,
    maxTilt: legs ? 0.75 : 0.45,
    canFly: crew && accel > homeGravity * 1.05,
    problem: !crew ? 'crew' : engines === 0 ? 'engine' : accel <= homeGravity * 1.05 ? 'heavy' : null,
  };
}
