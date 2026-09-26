// Collect every sentence Pip can say, so each one can be recorded once.
//
// Messages are split into sentences exactly the way the in-game narrator does it, so
// "We made it to Pebble! Tap the landing button to land!" becomes two reusable clips.
// Lines are found by scanning the game source for spoken strings; `${...name}` placeholders
// are expanded for every world, and data lines (goals, stickers and their hints, world facts) come straight
// from the game's own modules.
//
//   node tools/voice/lines.mjs            -> writes tools/voice/lines.json
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BODY_DEFS } from '../../src/physics/bodies.js';
import { GOALS, STICKERS } from '../../src/progress.js';
import { PARTS } from '../../src/rocket/parts.js';
import { sentencesOf, keyOf } from '../../src/ui/speech.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const names = BODY_DEFS.map((b) => b.name);
const radialNames = Object.values(PARTS).filter((p) => p.slot === 'radial').map((p) => p.name);

// Files that contain spoken lines, and how to spot them.
const FILES = ['src/main.js', 'src/scenes/flight.js', 'src/scenes/builder.js', 'src/scenes/drive.js', 'src/physics/autopilot.js', 'src/ui/markers.js'];
// Status text shown on screen but never spoken.
const NOT_SPOKEN = /^(Flying up|Coasting|Going around!$|Thinking|Waiting|Blast off!$|Flying to|Fixing|Little push|Arriving|Steering away|Slowing down$|Moving closer|Turning around|Getting into orbit|Landing$)/;

const PLACEHOLDERS = [
  [/\$\{[^}]*\.icon\}/g, () => ['']],
  [/\$\{def\.name\}/g, () => radialNames],
  [/\$\{[^}]*\.name\}/g, () => names],
];

function expand(template) {
  let out = [template];
  for (const [re, values] of PLACEHOLDERS) {
    const next = [];
    for (const t of out) {
      if (!re.test(t)) {
        next.push(t);
        continue;
      }
      re.lastIndex = 0;
      for (const v of values()) next.push(t.replace(re, v));
      re.lastIndex = 0;
    }
    out = next;
  }
  return out.filter((t) => !t.includes('${'));
}

const messages = new Set();
const skipped = [];

for (const file of FILES) {
  const src = readFileSync(path.join(root, file), 'utf8');
  // Any quoted string that reads like a sentence (several words, ends in punctuation).
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(src))) {
    const raw = (m[1] ?? m[2] ?? m[3]).replace(/\\'/g, "'").replace(/\\"/g, '"');
    if (!/[a-z]/i.test(raw) || !/\s/.test(raw) || !/[.!?]$/.test(raw.trim())) continue;
    if (/^[\w-]+(\s[\w-]+)*$/.test(raw) && !/[.!?]/.test(raw)) continue;
    if (raw.includes('<') || raw.includes('=>') || NOT_SPOKEN.test(raw)) continue;
    const variants = expand(raw);
    if (!variants.length) skipped.push(raw);
    for (const v of variants) messages.add(v);
  }
}

// Data-driven lines.
for (const g of GOALS) {
  messages.add(`${g.text} ${g.hint}`);
  messages.add(g.hint);
  messages.add(`Next: ${g.text}`);
}
for (const [id, s] of Object.entries(STICKERS)) if (!id.startsWith('land-')) messages.add(s.say || s.name);
for (const s of Object.values(STICKERS)) if (s.hint) messages.add(s.hint); // discoveries' sticker-book hints (#15)
for (const b of BODY_DEFS) {
  messages.add(b.blurb);
  messages.add(`You landed on ${b.name}! ${b.blurb}`);
}

// World-name expansion makes some impossible lines; drop them.
const MOONS = 'Pebble|Nibble|Sizzle|Frosty|Flip';
const GAS = 'Ringo|Tumble';
const DROP = [
  new RegExp(`^(?!${GAS})\\w+ is made of clouds`), // only the gas giants
  /(drive on|land on|landed on|Welcome to|made it to|flew to|fly to|way to|path to|going around|orbit around|We're at|That's) Ember/,
  new RegExp(`(drive on|land on|landed on) (${GAS})`),
  new RegExp(`^(?!${MOONS})\\w+ goes the other way`), // only moons can be the "other way"
  new RegExp(`^(${MOONS}|Ember) is behind us`), // only planets are left behind
  /^Start a brand new adventure|^Your rocket, stickers and progress/, // confirm dialog, not spoken
];

const sentences = new Map();
for (const msg of messages) {
  for (const s of sentencesOf(msg)) {
    if (DROP.some((re) => re.test(s))) continue;
    const key = keyOf(s);
    if (key && !sentences.has(key)) sentences.set(key, s);
  }
}

const list = [...sentences.entries()].map(([key, text]) => ({ key, text })).sort((a, b) => a.key.localeCompare(b.key));
writeFileSync(path.join(root, 'tools/voice/lines.json'), JSON.stringify(list, null, 1) + '\n');
console.log(`${messages.size} messages -> ${list.length} sentences`);
if (skipped.length) console.log('Templates not expanded (check these):\n  ' + skipped.join('\n  '));
