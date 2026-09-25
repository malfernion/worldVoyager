// Shared cartoon materials: stepped toon lighting, ink outlines and a hand-made wood grain.
import * as THREE from 'three';

let gradient = null;
export function toonGradient() {
  if (gradient) return gradient;
  const data = new Uint8Array([70, 70, 70, 255, 140, 140, 140, 255, 205, 205, 205, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

let woodTex = null;
export function woodTexture() {
  if (woodTex) return woodTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c99a63';
  g.fillRect(0, 0, 256, 256);
  const planks = 8;
  for (let i = 0; i < planks; i++) {
    const x = (i * 256) / planks;
    const shade = 180 + ((i * 37) % 40);
    g.fillStyle = `rgb(${shade + 20}, ${shade - 30}, ${shade - 90})`;
    g.fillRect(x + 1, 0, 256 / planks - 2, 256);
    g.strokeStyle = 'rgba(90, 55, 25, 0.35)';
    g.lineWidth = 1.5;
    for (let k = 0; k < 5; k++) {
      g.beginPath();
      const ox = x + 4 + k * 5;
      g.moveTo(ox, 0);
      for (let y = 0; y <= 256; y += 16) g.lineTo(ox + Math.sin(y * 0.05 + i + k) * 2, y);
      g.stroke();
    }
    g.fillStyle = 'rgba(60, 35, 15, 0.8)';
    g.fillRect(x, 0, 2, 256);
    g.fillStyle = '#5a4630';
    g.beginPath();
    g.arc(x + 256 / planks / 2, 30 + (i * 53) % 200, 2.5, 0, Math.PI * 2);
    g.fill();
  }
  woodTex = new THREE.CanvasTexture(c);
  woodTex.colorSpace = THREE.SRGBColorSpace;
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  return woodTex;
}

export function toon(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
}

const outlineCache = new Map();
/** Inverted-hull outline: a back-facing copy pushed out along its normals. */
export function outlineMaterial(thickness = 0.06, color = 0x2a1d17) {
  const key = `${thickness}:${color}`;
  if (outlineCache.has(key)) return outlineCache.get(key);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\ntransformed += normalize(normal) * ${thickness.toFixed(3)};`,
    );
  };
  m.customProgramCacheKey = () => key;
  outlineCache.set(key, m);
  return m;
}

export function withOutline(mesh, thickness = 0.06) {
  const o = new THREE.Mesh(mesh.geometry, outlineMaterial(thickness));
  o.userData.isOutline = true;
  o.raycast = () => {};
  mesh.add(o);
  return mesh;
}

/** Soft round glow sprite texture (for flames, sun, sparks). */
const glowCache = new Map();
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128) {
  const key = inner + outer + size;
  if (glowCache.has(key)) return glowCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.55)'));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  glowCache.set(key, t);
  return t;
}

/** Fluffy cartoon cloud puff texture (for smoke). */
let puffTex = null;
export function puffTexture() {
  if (puffTex) return puffTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const blobs = [[64, 70, 38], [40, 72, 26], [88, 74, 26], [56, 50, 26], [80, 52, 22]];
  g.fillStyle = '#fff';
  for (const [x, y, r] of blobs) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-atop';
  const grd = g.createLinearGradient(0, 20, 0, 110);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(1, '#c9c2d6');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  puffTex = new THREE.CanvasTexture(c);
  puffTex.colorSpace = THREE.SRGBColorSpace;
  return puffTex;
}
