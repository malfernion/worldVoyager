// Chunky low-poly boulders for the moons. One InstancedMesh (plus its ink outline) per world
// keeps it to two draw calls however many rocks there are.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, outlineMaterial } from './materials.js';
import { mulberry32 } from '../physics/noise.js';

const OUTLINE = 0.05; // In unit-rock space, so big boulders get proportionally thicker ink.
const TOP = 0.42; // how far the unit rock reaches above its base point
const SINK = 0.14; // how far it's buried, so it sits in the ground on slopes

let kit = null;
function rockKit() {
  if (kit) return kit;
  // A lumpy squashed icosahedron: jitter the shared corners so the shell stays closed.
  let g = new THREE.IcosahedronGeometry(0.5, 0);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const rand = mulberry32(5);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = 0.8 + rand() * 0.35;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.75, pos.getZ(i) * k);
  }
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y - SINK, 0);
  g.computeBoundingBox();
  const faceted = g.toNonIndexed();
  faceted.computeVertexNormals();
  // The ink gets welded smooth normals so the pushed-out shell has no cracks.
  const ink = g.clone();
  ink.computeVertexNormals();
  kit = { geo: faceted, ink, mat: toon(0xffffff), top: g.boundingBox.max.y };
  return kit;
}

/**
 * Scatter boulders. spots: [{ position, up, size }] (position on the ground, up the unit
 * "up" there, size a typical width); palette: hex colours to pick from. Returns
 * { group, rocks } with rocks = [{ position, up, height, radius }] for collisions.
 */
export function createRocks(spots, rand, palette) {
  const { geo, ink, mat, top } = rockKit();
  const n = spots.length;
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const outline = new THREE.InstancedMesh(ink, outlineMaterial(OUTLINE), n);
  outline.instanceMatrix = mesh.instanceMatrix;
  outline.userData.isOutline = true;
  outline.raycast = () => {};
  mesh.add(outline);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const upY = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const rocks = [];
  spots.forEach(({ position, up, size }, i) => {
    const sx = size * (0.8 + rand() * 0.5), sz = size * (0.8 + rand() * 0.5), sy = size * (0.6 + rand() * 0.5);
    q.setFromUnitVectors(upY, up).multiply(spin.setFromAxisAngle(upY, rand() * Math.PI * 2));
    m.compose(position, q, s.set(sx, sy, sz));
    mesh.setMatrixAt(i, m);
    col.set(palette[Math.floor(rand() * palette.length)]);
    col.offsetHSL(0, 0, (rand() - 0.5) * 0.08);
    mesh.setColorAt(i, col);
    // Collide with most of its width (a little less than the widest corner, so it feels fair).
    rocks.push({ position: position.clone(), up: up.clone(), height: sy * top, radius: Math.max(sx, sz) * 0.42 });
  });
  const group = new THREE.Group();
  group.name = 'rocks';
  if (n) group.add(mesh);
  return { group, rocks };
}
