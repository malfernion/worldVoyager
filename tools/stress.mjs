// Stress sweep for "take me there": every start world x target world, several start times,
// plus long tours from the launch pad through several worlds in a row, flown by the
// autopilot and by the pretend kid (coach mode). Prints failure rates by kind.
//
//   npm run stress                           # full sweep (a minute or two, uses every core)
//   npm run stress -- --phases 24 --tours 60 # a bigger sweep
//   npm run stress -- --verbose              # list every failed trip
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { WORLDS, gotoTrip, tour } from '../test/missions.js';

if (!isMainThread) {
  for (const job of workerData) {
    const t0 = performance.now();
    const r = job.tour ? tour(job.tour, job.t, job.coach) : gotoTrip(job.from, job.to, job.t, job.coach);
    if (job.tour) Object.assign(job, { from: `pad (tour ${job.tour.join(' ')})`, to: r.to });
    parentPort.postMessage({ ...job, kind: r.kind, strays: r.strays, detail: r.detail, ms: performance.now() - t0 });
  }
  process.exit(0);
}

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : Number(args[i + 1]);
};
const phases = opt('phases', 10);
const tours = opt('tours', 20);
const verbose = args.includes('--verbose');

// Start times spread over Ringo's moons' and Homestead's slow cycles, so the worlds line up differently.
const jobs = [];
for (const coach of [false, true]) {
  for (const from of WORLDS) {
    for (const to of WORLDS) {
      if (from === to) continue;
      for (let p = 0; p < phases; p++) jobs.push({ from, to, t: 1000 + p * 2711, coach });
    }
  }
  // Tours: five worlds in a (repeatable) random order, never the same one twice in a row.
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < tours; i++) {
    const stops = [];
    let at = 'homestead';
    while (stops.length < 5) {
      const next = WORLDS[Math.floor(rand() * WORLDS.length)];
      if (next !== at) stops.push((at = next));
    }
    jobs.push({ tour: stops, t: 500 + i * 1733, coach });
  }
}

const n = Math.min(availableParallelism(), jobs.length);
const slices = Array.from({ length: n }, (_, i) => jobs.filter((_, j) => j % n === i));
const results = [];
const started = performance.now();
await Promise.all(slices.map((slice) => new Promise((resolve, reject) => {
  const w = new Worker(new URL(import.meta.url), { workerData: slice });
  w.on('message', (r) => {
    results.push(r);
    if (verbose && r.kind !== 'ok') console.log(`${r.coach ? 'coach' : 'auto '} ${r.from} -> ${r.to} t=${r.t}: ${r.kind} (${r.detail})`);
  });
  w.on('error', reject);
  w.on('exit', resolve);
})));

for (const coach of [false, true]) {
  for (const tours of [false, true]) report(results.filter((r) => r.coach === coach && !!r.tour === tours), `${coach ? 'coach' : 'autopilot'}${tours ? ' tours' : ''}`);
}

function report(rs, name) {
  const count = {};
  for (const r of rs) count[r.kind] = (count[r.kind] ?? 0) + 1;
  const strays = rs.reduce((a, r) => a + r.strays, 0);
  const fails = rs.length - (count.ok ?? 0);
  console.log(`${name}: ${rs.length} trips, ${fails} failed (${((100 * fails) / rs.length).toFixed(1)}%)`,
    JSON.stringify(count), `stray visits: ${strays}`);
}
const slow = results.reduce((a, r) => (r.ms > a.ms ? r : a), { ms: 0 });
console.log(`${results.length} trips in ${((performance.now() - started) / 1000).toFixed(0)} s; slowest ${slow.from} -> ${slow.to} (${(slow.ms / 1000).toFixed(1)} s)`);
process.exitCode = results.every((r) => r.kind === 'ok') ? 0 : 1;
