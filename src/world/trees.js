// Cartoon trees shared by Homestead and the workshop backdrop: stacked-cone pines, round
// leafy trees and little bushes. One InstancedMesh per shape (plus its ink outline) keeps
// draw calls flat however many trees there are.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, outlineMaterial } from './materials.js';

// Every shape is modelled one unit tall with its base at y = 0, then scaled by tree height.
// trunk: [width factor, height as a fraction of tree height] (bushes have none).
const KINDS = {
  pine: { weight: 0.45, size: [0.9, 1.3], trunk: [0.9, 0.34] },
  round: { weight: 0.35, size: [0.75, 1.05], trunk: [1, 0.5] },
  bush: { weight: 0.2, size: [0.25, 0.4], trunk: null },
};
const TRUNK_R = 0.08;
const OUTLINE = 0.02; // In unit-tree space, so big trees get proportionally thicker ink.

let kit = null;
function treeKit() {
  if (kit) return kit;
  const cone = (r, h, y) => new THREE.ConeGeometry(r, h, 7).translate(0, y + h / 2, 0);
  // Three stacked cones; the lowest starts well above the ground so the trunk shows.
  const pine = mergeGeometries([cone(0.36, 0.42, 0.26), cone(0.28, 0.36, 0.48), cone(0.19, 0.3, 0.7)]);
  const round = new THREE.IcosahedronGeometry(0.36, 1).scale(1, 0.9, 1).translate(0, 0.66, 0);
  const bush = new THREE.DodecahedronGeometry(0.5, 0).scale(1, 0.7, 1).translate(0, 0.3, 0);
  // Unit-tree width (not unit radius) so its outline stays as thick as the leaves'. No caps:
  // the bottom is in the ground and the top in the leaves.
  const trunk = new THREE.CylinderGeometry(TRUNK_R * 0.75, TRUNK_R, 1, 6, 1, true).translate(0, 0.5, 0);
  // Faceted normals for the chunky low-poly leaves; the ink gets welded smooth ones so the
  // pushed-out shell has no cracks at the edges.
  const faceted = (g) => {
    const f = g.index ? g.toNonIndexed() : g.clone();
    f.computeVertexNormals();
    return f;
  };
  const smooth = (g) => {
    const s = g.clone();
    s.deleteAttribute('normal');
    s.deleteAttribute('uv');
    const w = mergeVertices(s);
    w.computeVertexNormals();
    return w;
  };
  const leaf = (g) => [faceted(g), smooth(g)];
  kit = {
    geos: { pine: leaf(pine), round: leaf(round), bush: leaf(bush), trunk: [trunk, trunk] },
    leaves: toon(0xffffff),
    bark: toon(0xffffff),
  };
  return kit;
}

function pickKind(rand) {
  let x = rand();
  for (const k in KINDS) {
    x -= KINDS[k].weight;
    if (x < 0) return k;
  }
  return 'pine';
}

function leafColor(kind, rand, out) {
  if (kind === 'pine') return out.setHSL(0.36 + rand() * 0.06, 0.42, 0.2 + rand() * 0.08);
  // A few round trees are turning amber, for that end-of-summer campfire feeling.
  if (kind === 'round' && rand() < 0.12) return out.setHSL(0.07 + rand() * 0.04, 0.6, 0.42 + rand() * 0.08);
  if (kind === 'round') return out.setHSL(0.24 + rand() * 0.06, 0.45, 0.3 + rand() * 0.1);
  return out.setHSL(0.27 + rand() * 0.06, 0.4, 0.26 + rand() * 0.08);
}

/** An InstancedMesh with an instanced ink outline that shares its matrices. */
function instanced([geo, inkGeo], mat, count) {
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const ink = new THREE.InstancedMesh(inkGeo, outlineMaterial(OUTLINE), count);
  ink.instanceMatrix = mesh.instanceMatrix;
  ink.userData.isOutline = true;
  ink.raycast = () => {};
  mesh.add(ink);
  mesh.count = ink.count = 0;
  return mesh;
}

/**
 * Plant a forest. spots: [{ position, up, size }] where position is the tree base, up the
 * unit "up" direction there and size a typical tree height. Kind, exact height and colour
 * come from rand. Returns { group, trees } with trees = [{ kind, position, up, height,
 * radius }]; radius is the trunk (or bush) radius, ready for collisions.
 */
export function createForest(spots, rand) {
  const { geos, leaves, bark } = treeKit();
  const n = spots.length;
  const meshes = { pine: instanced(geos.pine, leaves, n), round: instanced(geos.round, leaves, n), bush: instanced(geos.bush, leaves, n) };
  const trunks = instanced(geos.trunk, bark, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const upY = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const trees = [];
  for (const { position, up, size } of spots) {
    const kind = pickKind(rand);
    const k = KINDS[kind];
    const height = size * (k.size[0] + rand() * (k.size[1] - k.size[0]));
    // A random spin about "up" so the chunky facets don't all line up.
    q.setFromUnitVectors(upY, up).multiply(new THREE.Quaternion().setFromAxisAngle(upY, rand() * Math.PI * 2));
    const mesh = meshes[kind];
    m.compose(position, q, s.setScalar(height));
    mesh.setMatrixAt(mesh.count, m);
    mesh.setColorAt(mesh.count, leafColor(kind, rand, col));
    mesh.count++;
    let radius = height * 0.45; // Bushes: most of their width.
    if (k.trunk) {
      const w = height * k.trunk[0];
      m.compose(position, q, s.set(w, height * k.trunk[1], w));
      trunks.setMatrixAt(trunks.count, m);
      trunks.setColorAt(trunks.count, col.setHSL(0.07 + rand() * 0.02, 0.4, 0.2 + rand() * 0.06));
      trunks.count++;
      radius = w * TRUNK_R;
    }
    trees.push({ kind, position: position.clone(), up: up.clone(), height, radius });
  }
  const group = new THREE.Group();
  group.name = 'forest';
  for (const mesh of [...Object.values(meshes), trunks]) {
    mesh.children[0].count = mesh.count;
    if (mesh.count) group.add(mesh);
  }
  return { group, trees };
}
