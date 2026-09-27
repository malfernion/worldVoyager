// Draws the rocket's exhaust pool (#60, src/physics/exhaust.js): one instanced mesh of soft
// sprites, so one draw call however much smoke there is. The same soft look as the clouds
// (#54): a noise-eaten falloff in a gentle two-tone light, fading by thinning from the rims
// (never grey discs). Readability, as for the clouds: sprites fade out near the camera, when
// big on screen and at the screen's edges (`spriteFade()`'s sums), and in front of the rocket
// they're only a veil (`rocketA` / `rocketB`). The mesh is placed at the middle of the world the pool is in.
import * as THREE from 'three';
import { NEAR, VEIL, noiseTexture } from './clouds.js';

const f2 = (v) => v.toFixed(2);
// A sprite this big on screen (its radius, in fractions of the half-height) is whole .. gone:
// bigger than the clouds' (a billow at the pad fills a good part of the view), but still never
// a sprite flooding the screen. No fade at the screen's edges: the trail runs off the bottom.
export const SMOKE_BIG = [0.35, 0.7];

const VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 offset;
  attribute vec4 tint; // colour, alpha
  attribute vec4 shape; // size (radius), spin, seed, fade
  attribute float lift; // how high its middle is above the ground (m)
  uniform vec3 sunDir;
  uniform vec4 rocketA; // the rocket's base (view space) and its radius (0: no rocket to keep clear)
  uniform vec3 rocketB; // its nose
  varying vec2 vUv;
  varying vec2 vNoise;
  varying vec4 vTint;
  varying float vFade;
  varying float vDay;
  varying float vH;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(offset, 1.0);
    float s = shape.x;
    float depth = -mvPosition.z;
    vec4 c = projectionMatrix * mvPosition;
    vec2 ndc = c.xy / max(c.w, 1e-3);
    float rs = s * projectionMatrix[1][1] / max(depth, 1e-3);
    // Near the camera or big on screen: gone (as the clouds' spriteFade()).
    float fade = smoothstep(s * ${f2(NEAR[0])}, s * ${f2(NEAR[1])}, depth)
      * (1.0 - smoothstep(${f2(SMOKE_BIG[0])}, ${f2(SMOKE_BIG[1])}, rs));
    // In front of the rocket and over it on screen (within its radius of the line from its base
    // to its nose): only a veil. Level with it or behind, the rocket hides it by itself.
    float veil = 1.0;
    if (rocketA.w > 0.0) {
      vec4 pa = projectionMatrix * vec4(rocketA.xyz, 1.0);
      vec4 pb = projectionMatrix * vec4(rocketB, 1.0);
      float asp = projectionMatrix[1][1] / projectionMatrix[0][0];
      vec2 q = ndc - pa.xy / pa.w, ab = pb.xy / pb.w - pa.xy / pa.w;
      q.x *= asp; ab.x *= asp;
      float t = clamp(dot(q, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
      float fd = max(-mix(rocketA.z, rocketB.z, t), 1e-3);
      float fr = rocketA.w * projectionMatrix[1][1] / fd;
      float front = 1.0 - smoothstep(fd - 1.6, fd - 0.4, depth);
      veil = mix(1.0, mix(${f2(VEIL * 0.5)}, 1.0, smoothstep(fr + 0.1 * rs, fr + 0.75 * rs, length(q - ab * t))), front);
    }
    vFade = shape.w * fade * veil;
    vTint = vec4(tint.rgb, tint.a * veil);
    vec3 up = normalize((modelViewMatrix * vec4(offset, 0.0)).xyz);
    vDay = smoothstep(-0.3, 0.35, dot(up, sunDir));
    vec2 corner = position.xy * 2.0;
    // Height above the ground at this corner, in sizes: it thins out into the ground softly
    // instead of being cut off in a straight line where the sprite meets it.
    vH = lift / s + dot(corner, up.xy);
    float a = shape.y;
    vUv = mat2(cos(a), sin(a), -sin(a), cos(a)) * corner;
    vNoise = vUv * (0.32 + 0.16 * fract(shape.z * 7.0)) + vec2(shape.z * 13.0, shape.z * 29.0);
    mvPosition.xy += corner * s;
    gl_Position = projectionMatrix * mvPosition;
    if (vFade * vTint.a < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }`;

const FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D noiseMap;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying vec2 vNoise;
  varying vec4 vTint;
  varying float vFade;
  varying float vDay;
  varying float vH;
  void main() {
    #include <logdepthbuf_fragment>
    float r2 = dot(vUv, vUv);
    if (r2 > 1.0) discard;
    // A soft ball eaten away by the noise (a puff, not a disc), dense in the middle.
    float nz = texture2D(noiseMap, vNoise).r;
    float rr = min(1.0, r2 * (0.55 + 0.9 * nz));
    float fall = (1.0 - rr) * (1.0 - rr);
    float d = fall * (0.5 + 1.1 * nz) - 0.06;
    d *= smoothstep(-0.05, 0.3, vH);
    // Fading thins it from the rims inwards, so it evaporates into wisps.
    float a = smoothstep(0.0, 0.25, d * vFade) * vTint.a;
    if (a < 0.004) discard;
    // Gentle toon light: a soft ball's turn to the sun and a touch of the noise, in two tones.
    vec3 n = vec3(vUv * 0.7, sqrt(max(0.0, 1.0 - r2 * 0.49)));
    float light = 0.55 * dot(n, sunDir) + 0.45 * (nz - 0.5) + 0.1;
    vec3 col = vTint.rgb * mix(vec3(0.64, 0.68, 0.8), vec3(1.0), smoothstep(-0.15, 0.2, light));
    col *= mix(vec3(0.28, 0.3, 0.42), vec3(1.0), vDay);
    gl_FragColor = vec4(col, a);
    #include <fog_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb *= gl_FragColor.a; // premultiplied
  }`;

const quad = new THREE.PlaneGeometry(1, 1);

/**
 * The exhaust pool's mesh. update(pool) copies the live particles in (oldest first;
 * instanceCount is only what's live). Uniforms: `sunDir` (view space), `rocketA` the rocket's
 * base in view space and its radius (w; 0 for no rocket), `rocketB` its nose.
 */
export function createExhaustMesh(capacity) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  const attr = (n) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n).setUsage(THREE.DynamicDrawUsage);
  const offset = attr(3), tint = attr(4), shape = attr(4), lift = attr(1);
  geo.setAttribute('offset', offset);
  geo.setAttribute('tint', tint);
  geo.setAttribute('shape', shape);
  geo.setAttribute('lift', lift);
  const attrs = [offset, tint, shape, lift];
  geo.instanceCount = 0;
  const uniforms = {
    noiseMap: { value: noiseTexture() },
    sunDir: { value: new THREE.Vector3(0, 0, 1) },
    rocketA: { value: new THREE.Vector4() },
    rocketB: { value: new THREE.Vector3() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'exhaust';
  mesh.frustumCulled = false; // it's wherever the rocket has been; a few hundred sprites at most
  mesh.raycast = () => {};
  // After the ground, the sea and the buggy's dust; the rocket's flames (3) glow over it.
  mesh.renderOrder = 2;
  mesh.visible = false;
  const o = offset.array, t = tint.array, s = shape.array, l = lift.array;
  return {
    mesh,
    uniforms,
    update(pool) {
      let n = 0;
      const p = pool.pos, c = pool.col;
      for (let k = 0; k < pool.count; k++) {
        const i = pool.slot(k);
        if (pool.age[i] >= pool.life[i]) continue;
        const fade = pool.fadeOf(i);
        if (fade <= 0.002) continue;
        o[n * 3] = p[i * 3]; o[n * 3 + 1] = p[i * 3 + 1]; o[n * 3 + 2] = p[i * 3 + 2];
        t[n * 4] = c[i * 3]; t[n * 4 + 1] = c[i * 3 + 1]; t[n * 4 + 2] = c[i * 3 + 2]; t[n * 4 + 3] = pool.alpha[i];
        l[n] = pool.lift[i];
        s[n * 4] = pool.sizeOf(i); s[n * 4 + 1] = pool.spin[i] + pool.age[i] * 0.25; s[n * 4 + 2] = pool.seed[i]; s[n * 4 + 3] = fade;
        n++;
      }
      geo.instanceCount = n;
      mesh.visible = n > 0;
      if (n > 0) {
        // Only the live part goes to the GPU.
        for (const a of attrs) {
          a.needsUpdate = true;
          a.clearUpdateRanges();
          a.addUpdateRange(0, n * a.itemSize);
        }
      }
      return n;
    },
  };
}
