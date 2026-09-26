// A world's liquid layer (#44): one mesh per world, a shell at the liquid's level with a small
// shader for gentle waves, colour by depth (from a baked per-vertex attribute: the ground's
// height under each vertex, never worked out per frame) and foam along the shore. What the
// liquid is (its level, and what kind) is in src/physics/terrain.js; how each kind looks is in
// LOOKS below, so a new kind (#45 lava, #46 methane) is one more entry here.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * How each kind of liquid looks. shallow / deep: colours by the shore and far out (deep at
 * `depth` metres); foam: the shoreline's colour; alpha: see-through in the shallows, nearly
 * solid far out; waves: how high the waves bob (m) and how fast; glow: how much it shines by
 * itself (0: lit by the sun only; lava will glow); fog: the colour when the camera is under it.
 */
export const LOOKS = {
  water: {
    shallow: 0x4cc4d6, deep: 0x1f5fa8, depth: 5, foam: 0xf4fbff,
    alpha: [0.5, 0.88], waves: 0.07, speed: 1, glow: 0, fog: 0x2d7fa8, fogFar: 36,
  },
};

// Under the liquid (camera or buggy): the triangles that are all well under dry land are left
// out, so the mesh is only the seas and their shores (much less to draw).
const SHORE = 2.5;

/**
 * The liquid's mesh for `body` (null if it has none): a subdivided sphere at the liquid's level,
 * with each vertex's depth (level - ground height there) baked in. `sunDir` is the planet's
 * shared view-space sun direction (kept fresh by the flight scene).
 */
export function createLiquid(body, detail, sunDir) {
  if (!body.liquid) return null;
  const look = LOOKS[body.liquid.kind] ?? LOOKS.water;
  const t = body.terrainFn;
  const R = body.liquidR;
  let geo = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const pos = geo.attributes.position;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const l = Math.hypot(x, y, z);
    x /= l; y /= l; z /= l;
    depth[i] = body.liquid.level - t.height(x, y, z);
    pos.setXYZ(i, x * R, y * R, z * R);
  }
  // Keep only the triangles where some corner is near or under the liquid.
  const src = geo.index.array;
  const keep = [];
  for (let f = 0; f < src.length; f += 3) {
    const a = src[f], b = src[f + 1], c = src[f + 2];
    if (depth[a] > -SHORE || depth[b] > -SHORE || depth[c] > -SHORE) keep.push(a, b, c);
  }
  geo.setIndex(keep);
  geo.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
  geo.computeBoundingSphere();

  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        time: { value: 0 },
        shallow: { value: new THREE.Color(look.shallow) },
        deep: { value: new THREE.Color(look.deep) },
        foam: { value: new THREE.Color(look.foam) },
        alphaRange: { value: new THREE.Vector2(look.alpha[0], look.alpha[1]) },
        deepAt: { value: look.depth },
        waveHeight: { value: look.waves },
        glow: { value: look.glow },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      attribute float depth;
      uniform float time;
      uniform float waveHeight;
      varying float vDepth;
      varying vec3 vN;
      varying vec3 vP;
      varying vec3 vObj;
      void main() {
        vec3 n = normalize(position);
        // Gentle swell: two slow waves crossing, none at the shore (so the shoreline stays put).
        float w = sin(dot(position, vec3(0.31, 0.17, 0.12)) + time * 1.1)
                + sin(dot(position, vec3(-0.11, 0.23, 0.27)) + time * 0.8);
        vec3 p = position + n * w * waveHeight * clamp(depth, 0.0, 1.0);
        vDepth = depth;
        vObj = position;
        vN = normalize(normalMatrix * n);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        vP = mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      #include <logdepthbuf_pars_fragment>
      uniform float time;
      uniform vec3 shallow;
      uniform vec3 deep;
      uniform vec3 foam;
      uniform vec2 alphaRange;
      uniform float deepAt;
      uniform float glow;
      uniform vec3 sunDir;
      varying float vDepth;
      varying vec3 vN;
      varying vec3 vP;
      varying vec3 vObj;
      void main() {
        #include <logdepthbuf_fragment>
        // Ripples: tilt the normal a little with a few moving sines (in view space, cheaply).
        float r1 = sin(vObj.x * 0.9 + vObj.y * 0.4 + time * 1.7);
        float r2 = sin(vObj.y * 0.7 - vObj.z * 0.8 - time * 1.3);
        float r3 = sin(vObj.z * 1.3 + vObj.x * 0.5 + time * 2.1);
        vec3 N = normalize(vN + 0.06 * vec3(r1, r2, r3));
        if (!gl_FrontFacing) N = -N;
        float d = max(vDepth, 0.0);
        vec3 col = mix(shallow, deep, smoothstep(0.0, deepAt, d));
        // Toon-ish sun: day, dusk and night bands like the ground.
        float lit = dot(N, sunDir);
        float day = 0.28 + 0.72 * smoothstep(-0.15, 0.2, lit);
        col *= mix(day, 1.0, glow);
        // A glint of sunlight on the ripples.
        vec3 V = normalize(-vP);
        float spec = pow(max(dot(reflect(-sunDir, N), V), 0.0), 40.0);
        col += vec3(1.0, 0.97, 0.9) * step(0.55, spec) * 0.55 * (1.0 - glow);
        // Foam along the shore, wobbling in and out.
        float edge = 0.07 + 0.04 * sin(time * 1.4 + vObj.x * 0.5 + vObj.z * 0.4);
        float f = 1.0 - smoothstep(edge, edge + 0.08, vDepth);
        col = mix(col, foam * day, f * 0.85);
        float a = mix(alphaRange.x, alphaRange.y, smoothstep(0.3, deepAt, d));
        a = max(a, f * 0.9);
        // Seen from underneath: a bright, see-through ceiling.
        if (!gl_FrontFacing) { col = mix(col, shallow, 0.5) * 1.1; a = 0.55; }
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  // The planet's sun direction, shared (the flight scene updates it in place).
  mat.uniforms.sunDir = { value: sunDir };
  const mesh = new THREE.Mesh(geo, mat);
  // Drawn after the ground and the trees, before the buggy's dust (renderOrder 2).
  mesh.renderOrder = 1;
  mesh.userData.liquid = true;
  return {
    mesh,
    look,
    update(time) {
      mat.uniforms.time.value = time * look.speed;
    },
  };
}
