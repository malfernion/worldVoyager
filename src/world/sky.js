// Starfield with a soft milky band and a couple of dusky nebula clouds. It follows the camera,
// so it always looks infinitely far away.
import * as THREE from 'three';
import { mulberry32 } from '../physics/noise.js';
import { glowTexture } from './materials.js';

export function createSky(radius = 400000) {
  const group = new THREE.Group();
  const rand = mulberry32(1234);
  const count = 4000;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  // The band is tilted so it crosses the sky in both map and flight views.
  const band = new THREE.Vector3(0.3, 0.55, 0.78).normalize();
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    let tries = 0;
    do {
      v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
      if (v.lengthSq() > 1 || v.lengthSq() < 0.01) continue;
      v.normalize();
      // Prefer stars near the band.
      if (rand() < 0.45 || Math.abs(v.dot(band)) < 0.18) break;
    } while (tries++ < 20);
    pos.set([v.x * radius, v.y * radius, v.z * radius], i * 3);
    const warm = rand();
    c.setHSL(warm < 0.5 ? 0.6 : 0.1, 0.5, 0.7 + rand() * 0.3);
    const b = 0.35 + Math.pow(rand(), 3) * 0.9;
    col.set([c.r * b, c.g * b, c.b * b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 2.2, sizeAttenuation: false, vertexColors: true, depthWrite: false, fog: false,
  }));
  stars.renderOrder = -10;
  group.add(stars);

  const nebulae = [
    ['rgba(120,90,200,0.55)', new THREE.Vector3(0.6, 0.5, -0.6)],
    ['rgba(220,120,120,0.35)', new THREE.Vector3(-0.7, -0.3, 0.4)],
    ['rgba(80,160,200,0.35)', band.clone().cross(new THREE.Vector3(0, 0, 1)).normalize()],
  ];
  for (const [color, dir] of nebulae) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(color, 'rgba(0,0,0,0)', 256), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
    }));
    s.position.copy(dir.normalize().multiplyScalar(radius * 0.9));
    s.scale.setScalar(radius * 0.9);
    s.renderOrder = -9;
    group.add(s);
  }
  return group;
}
