// Hither's cracked grey ice (#62): Yonder's crack pattern on Charon's fractured plains, drawn by
// Hither's ground shader from a weight baked per vertex. Only the cracks (no blades, no pits);
// Yonder's ground shader and every other world's are exactly what they were; Hither's ground
// (its height, and so the physics) is untouched; the cracks are strongest on the smooth
// southern plains, fainter in the north, and never on the red cap's middle, down a chasm, on
// Kubrick or inside a crater.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSystem } from '../src/physics/bodies.js';
import { HITHER_MOUNT } from '../src/physics/terrain.js';
import { ROCKY_LOOK, YONDER_GROUND, HITHER_GROUND, richRocky } from '../src/world/richLook.js';

globalThis.document ??= { getElementById: () => null };

const sys = createSystem();
const { hither } = sys.byId;
const ter = hither.terrainFn;
const R = hither.radius;

function* sphere(n) {
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n, a = i * 2.399963, k = Math.sqrt(1 - z * z);
    yield [k * Math.cos(a), k * Math.sin(a), z];
  }
}

// The rocky ground shader with its snippets, as the renderer would build it.
function built(body) {
  const mat = richRocky(new THREE.MeshToonMaterial({ vertexColors: true }), body, new THREE.Vector3(1, 0, 0));
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: THREE.ShaderLib.toon.fragmentShader };
  mat.onBeforeCompile?.(shader);
  return { mat, shader };
}

// One number for everything about a world's built ground shader: its source, program key and uniforms.
function signature(body) {
  const { mat, shader } = built(body);
  const u = Object.keys(shader.uniforms).sort().map((k) => `${k}=${JSON.stringify(shader.uniforms[k].value)}`).join(';');
  const s = `${shader.vertexShader}\n--\n${shader.fragmentShader}\n--\n${mat.customProgramCacheKey?.() ?? ''}\n--\n${u}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return `${s.length}:${h.toString(16)}`;
}

// Every world's ground shader but Hither's, as built before Hither's cracks (main at 42db3b3):
// Yonder's crack machinery was split into parts so Hither could take only the cracks, and joined
// back it's byte for byte the same. (Changing a world's look on purpose? Update its line.)
const BEFORE = {
  ember: '2904:b85ce44a',
  homestead: '8219:c7e4f57b',
  pebble: '8342:bc642c75',
  dusty: '8316:62153010',
  nibble: '8215:79ffbd57',
  ringo: '2904:b85ce44a',
  sizzle: '8202:8d10ed9c',
  frosty: '11689:5ab6aa30',
  misty: '8221:6f056165',
  tumble: '2904:b85ce44a',
  flip: '8222:b493400c',
  ducky: '8295:f57c4054',
  yonder: '20424:2216264f',
};

describe('Hither\'s cracked ice (#62)', () => {
  it('leaves every other world\'s ground shader, Yonder\'s included, exactly as it was', () => {
    const got = {};
    for (const b of sys.bodies) if (b.id !== 'hither') got[b.id] = signature(b);
    expect(got).toEqual(BEFORE);
  });

  it('is Yonder\'s cracks only: no blades, no pits, its own program', () => {
    expect(ROCKY_LOOK.hither.ground).toBe(HITHER_GROUND);
    expect(HITHER_GROUND.blade).toBeUndefined();
    expect(HITHER_GROUND.pit).toBeUndefined();
    const { mat, shader } = built(hither);
    const f = shader.fragmentShader;
    expect(f.includes('rlCracks(rlObj / rlCrack.x')).toBe(true);
    expect(f.includes('rlCracks(rlObj / rlCrackFine')).toBe(true);
    expect(f.includes('rlCrater')).toBe(false);
    expect(f.includes('rlBladeTrough')).toBe(false);
    expect(f.includes('rlPitCell')).toBe(false);
    expect(shader.vertexShader.includes('attribute vec4 groundMark')).toBe(true);
    expect('rlCrack' in shader.uniforms && 'rlCrackC' in shader.uniforms && 'rlCrackFine' in shader.uniforms).toBe(true);
    expect('rlBlade' in shader.uniforms || 'rlPitCell' in shader.uniforms).toBe(false);
    // (Its own program: a shader with Yonder's defines but other source must never share one.)
    const key = mat.customProgramCacheKey();
    expect(key.includes('RL_GROUND') && key.includes('RL_CRACKS_ONLY')).toBe(true);
    expect(built(sys.byId.yonder).mat.customProgramCacheKey()).not.toBe(key);
    // No heart here, and no clock: nothing to update per frame.
    expect(shader.vertexShader.includes('heartMark')).toBe(false);
    expect(mat.userData.richUpdate).toBeUndefined();
    // Every world but Yonder and Hither has none of it.
    for (const b of sys.bodies) {
      if (b.id === 'yonder' || b.id === 'hither') continue;
      expect(built(b).shader.fragmentShader.includes('rlCracks'), b.id).toBe(false);
    }
  });

  it('suits grey ice: darker blue-grey lines, cells a little smaller than Yonder\'s', () => {
    const c = HITHER_GROUND.crack, y = YONDER_GROUND.crack;
    // Darker than Yonder's, and bluish (blue the least darkened).
    expect(c.color.reduce((a, b) => a + b)).toBeLessThan(y.color.reduce((a, b) => a + b));
    expect(c.color[2]).toBeGreaterThan(c.color[0]);
    expect(c.cell).toBeLessThan(y.cell);
    expect(c.cell).toBeGreaterThan(y.cell * 0.6);
    // The fine net stays well inside the big polygons, and the big ones are many metres across
    // (the cracks fade before they're only a few pixels apart, like Yonder's).
    expect(c.fine[0]).toBeLessThan(c.cell / 3);
    expect(c.cell * c.width).toBeGreaterThan(0.5); // (a crack about 3/4 m wide close up)
  });

  it('doesn\'t touch the ground: heights and colours are the same whether or not the cracks are asked', () => {
    const fresh = sys.byId.hither.terrainFn;
    const pts = [...sphere(3000)];
    const plain = pts.map((p) => { const h = fresh.height(...p); return [h, ...fresh.color(...p, h)]; });
    const mk = new Array(5).fill(0);
    pts.forEach((p, i) => {
      fresh.groundMarks(...p, mk);
      const h = fresh.height(...p);
      fresh.groundMarks(...p, mk);
      expect([h, ...fresh.color(...p, h)]).toEqual(plain[i]);
      expect(mk.slice(1)).toEqual([0, 0, 0, 0]);
      expect(mk[0]).toBe(fresh.land(...p).crack);
    });
  });

  it('is strongest on the plains, fainter in the north, and nowhere it would spoil a landmark', () => {
    let plains = 0, plainsK = 0, north = 0, northK = 0, cracked = 0, n = 0, capMid = 0, chasm = 0, kub = 0, bowl = 0;
    const M = HITHER_MOUNT;
    for (const [x, y, z] of sphere(40000)) {
      const k = ter.land(x, y, z).crack;
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(1);
      n++;
      if (k > 0.4) cracked++;
      const cap = ter.cap(x, y, z), deep = ter.canyon(x, y, z), mount = ter.mount(x, y, z);
      const inPit = ter.pits.some((c) => Math.acos(Math.min(1, x * c.x + y * c.y + z * c.z)) < c.radius * 0.9);
      const onKubrick = Math.acos(Math.min(1, x * M.x + y * M.y + z * M.z)) * R < 15 || mount > 2; // (its massif, and its foothills above 2 m)
      // The red cap's middle, a chasm's floor, Kubrick's massif and a crater's bowl: clean.
      if (cap > 0.5) { capMid++; expect(k).toBe(0); }
      if (deep > 0.2) { chasm++; expect(k).toBe(0); }
      if (onKubrick) { kub++; expect(k).toBeLessThan(0.02); }
      if (inPit) { bowl++; expect(k).toBe(0); }
      if (cap > 0.01 || deep > 0 || inPit || onKubrick || ter.bare(x, y, z)) continue;
      const pl = ter.plains(x, y, z);
      if (pl > 0.95) { plains++; plainsK += k; }
      if (pl < 0.05) { north++; northK += k; }
    }
    expect(capMid).toBeGreaterThan(500);
    expect(chasm).toBeGreaterThan(100);
    expect(kub).toBeGreaterThan(50);
    expect(bowl).toBeGreaterThan(500);
    expect(plainsK / plains).toBeGreaterThan(0.9); // the smooth southern plains: fully cracked
    expect(northK / north).toBeGreaterThan(0.4); // the rugged north: fainter, but there
    expect(northK / north).toBeLessThan(plainsK / plains - 0.2);
    expect(cracked / n).toBeGreaterThan(0.45); // most of the grey ice
  });

  it('fades out across the red cap\'s ragged edge (no hard line)', () => {
    // Part way in, the cracks are part way faded: never full, never gone.
    let edge = 0;
    for (const [x, y, z] of sphere(40000)) {
      const k = ter.cap(x, y, z);
      if (k < 0.15 || k > 0.35 || ter.canyon(x, y, z) > 0 || ter.bare(x, y, z)) continue;
      if (ter.pits.some((c) => Math.acos(Math.min(1, x * c.x + y * c.y + z * c.z)) < c.radius * 3)) continue;
      edge++;
      const l = ter.land(x, y, z).crack;
      const pl = 0.55 + 0.45 * ter.plains(x, y, z);
      expect(l).toBeGreaterThan(0.1 * pl);
      expect(l).toBeLessThan(0.95 * pl);
    }
    expect(edge).toBeGreaterThan(80);
  });
});
