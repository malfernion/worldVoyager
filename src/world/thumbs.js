// Little picture icons (planets, rocket parts) rendered once with a tiny offscreen renderer.
import * as THREE from 'three';
import { buildRocket } from '../rocket/rocketMesh.js';
import { buildBuggy } from '../rocket/buggyMesh.js';

let renderer = null;
function getRenderer(size) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
  }
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  return renderer;
}

function snap(scene, camera, size) {
  const r = getRenderer(size);
  r.render(scene, camera);
  return r.domElement.toDataURL('image/png');
}

function lights(scene, sunDir = new THREE.Vector3(1, 0.6, 0.8)) {
  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x3a2a40, 1.1));
  const d = new THREE.DirectionalLight(0xfff0d8, 2.6);
  d.position.copy(sunDir);
  scene.add(d);
}

export function planetThumb(visual, size = 160) {
  const scene = new THREE.Scene();
  const body = visual.body;
  const obj = new THREE.Group();
  if (body.kind === 'star') {
    obj.add(new THREE.Mesh(visual.mesh.geometry, visual.mesh.material));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(body.radius * 1.15, 32, 16), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.3 }));
    obj.add(glow);
  } else {
    obj.add(new THREE.Mesh(visual.mesh.geometry, visual.mesh.material));
    // Homestead's seas (#44) are their own mesh.
    if (visual.liquid) obj.add(new THREE.Mesh(visual.liquid.mesh.geometry, visual.liquid.mesh.material));
    for (const child of visual.group.children) {
      if (child.geometry && child.geometry.type === 'RingGeometry') obj.add(child.clone());
    }
  }
  scene.add(obj);
  lights(scene);
  const extent = body.rings ? body.radius * body.rings.outer : body.maxSurface || body.radius;
  const camera = new THREE.PerspectiveCamera(30, 1, extent * 0.1, extent * 20);
  camera.position.set(0, 0, extent * 3.9);
  // Face the more interesting side for the launch planet.
  obj.rotation.x = body.id === 'homestead' ? 0.5 : 0.25;
  obj.rotation.y = -0.4;
  camera.lookAt(0, 0, 0);
  return snap(scene, camera, size);
}

export function buggyThumb(kind, paint, size = 128) {
  const scene = new THREE.Scene();
  const b = buildBuggy(kind, paint);
  b.group.rotation.y = -0.7;
  scene.add(b.group);
  lights(scene, new THREE.Vector3(0.6, 0.8, 1));
  const box = new THREE.Box3().setFromObject(b.group);
  const centre = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() * 0.5;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(centre.x, centre.y + r * 1.2, centre.z + r * 3.2);
  camera.lookAt(centre);
  return snap(scene, camera, size);
}

export function partThumb(type, paint, radial = false, size = 128) {
  const scene = new THREE.Scene();
  const design = radial
    ? { stack: [{ type: 'tube', paint: 'cream', radial: { type, paint } }] }
    : { stack: [{ type, paint }] };
  const rocket = buildRocket(design);
  scene.add(rocket.group);
  lights(scene, new THREE.Vector3(0.6, 0.8, 1));
  const box = new THREE.Box3().setFromObject(rocket.group);
  const centre = box.getCenter(new THREE.Vector3());
  const dims = box.getSize(new THREE.Vector3());
  const r = Math.max(dims.x, dims.y, dims.z) * 0.62;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(centre.x + r * 1.2, centre.y + r * 1.1, centre.z + r * 3.4);
  camera.lookAt(centre);
  return snap(scene, camera, size);
}
