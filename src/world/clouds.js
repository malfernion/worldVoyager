// Cartoon clouds (#54): a layer of puffy clouds drifting slowly round a world, with soft
// shadows on its ground. Driven by CLOUD_LOOK per world (only Homestead so far), so other
// worlds can have their own layer later (thin high clouds, haze bands, streaks).
//
// Cheap for phones: every puff of every cloud is one instanced billboard, in two draw calls
// (the solid clouds, and the faded ones as a veil). The whole layer turns as one about the z
// axis (the flight plane's normal), so nothing is moved per puff on the CPU: the mesh's
// rotation is the drift. Each puff is a flat-bottomed ball (a disc shaded as a sphere with two
// toon tones, cut off at its cloud's base), so from space the clouds are round puffy blobs and
// from the ground they have the flat bottoms of cumulus. The ground's shadows come from a small
// cube map baked once (the layer's footprint), turned by the drift in the terrain's toon shader.
//
// Readability: each cloud fades out when the camera comes close (or goes through it), and fades
// to a thin veil when it sits between the camera and the rocket, the ground under the rocket
// or the buggy (`cloudFade()`, pure; a few multiplies per cloud per frame).
import * as THREE from 'three';
import { mulberry32 } from '../physics/noise.js';

/**
 * Each world's clouds. `alt`: the clouds' flat bases, metres above the world's radius (the
 * tallest peaks may poke through; tops under the space line, so a launch climbs through them); `size`: a
 * cloud's length (m); `puffs`: puffs per cloud. Where they are, as bands of z (metres off the
 * flight plane; the flight and map cameras sit on the +z side): `sky` is the band behind the
 * plane that the landed and launch views see as their sky, `plane` the clouds right round the
 * flight plane a launch flies past, and `spread` more anywhere else (the globe seen from space,
 * driving elsewhere; `front` on the camera's side, `back` behind, with their own `size`).
 * `drift`: how fast the layer turns (rad/s, real time). Colours: `lit`, `shade` (the toon
 * shadow side and flat bottoms), `line` (multiplies the colour in the puffs' soft outlines),
 * `night` (multiplies them all on the night side); `shadow`: how much of the direct sunlight a
 * cloud's shadow takes off the ground.
 */
export const CLOUD_LOOK = {
  homestead: {
    seed: 54,
    alt: [30, 40],
    size: [24, 42],
    puffs: [5, 9],
    sky: { count: 16, z: [-170, -35] },
    plane: { count: 7, z: [-28, 12] },
    spread: { front: 18, back: 10, size: [34, 58] },
    drift: 0.004,
    lit: 0xffffff,
    shade: 0xc3d0ee,
    line: 0xc6cfe8,
    night: 0x5a6aa8,
    shadow: 0.5,
  },
};

// Puff attributes: centre x, y, z (the layer's frame), size (radius, m), lift (how far the
// centre sits above its cloud's base), cloud index, phase (for its slow breathing).
export const PUFF_STRIDE = 7;

/**
 * Where every cloud and puff goes (pure, seeded). Returns `clouds`: per cloud its centre at its
 * base (x, y, z, layer frame), its reach `r` (m, from the centre to its furthest puff edge) and
 * its base radius `base`; and `puffs`, PUFF_STRIDE numbers per puff, sorted far-to-near for a
 * camera on the +z side (so their soft edges blend the right way round in the flight views).
 */
export function cloudPlan(look, radius) {
  const rand = mulberry32(look.seed);
  const between = ([a, b]) => a + rand() * (b - a);
  const spots = [];
  // Clouds keep a little clear of each other.
  const clear = (base, z, lon, L) => spots.every((o) => {
    const k1 = Math.sqrt(Math.max(0, 1 - (z / base) ** 2)), k2 = Math.sqrt(Math.max(0, 1 - (o.z / o.base) ** 2));
    const d = Math.hypot(k1 * base * Math.cos(lon) - k2 * o.base * Math.cos(o.lon), k1 * base * Math.sin(lon) - k2 * o.base * Math.sin(o.lon), z - o.z);
    return d > (L + o.L) * 0.55;
  });
  const band = ({ count, z: zs }) => {
    for (let i = 0; i < count; i++) {
      const base = radius + between(look.alt);
      const L = between(look.size);
      const lon = ((i + 0.2 + rand() * 0.6) / count) * Math.PI * 2;
      spots.push({ base, z: Math.max(-base, Math.min(base, between(zs))), lon, L });
    }
  };
  band(look.sky);
  band(look.plane);
  // The rest on the camera's side of the world and round the back (evenly by area: uniform in z),
  // outside those bands.
  const lo = Math.min(look.sky.z[0], look.plane.z[0]) - 20, hi = Math.max(look.sky.z[1], look.plane.z[1]) + 20;
  const { front, back } = look.spread;
  for (const [count, side] of [[front, 1], [back, -1]]) {
    for (let n = 0, tries = 0; n < count && tries < 2000; tries++) {
      const base = radius + between(look.alt);
      const L = between(look.spread.size);
      const z = side > 0 ? hi + rand() * (base - hi) : -base + rand() * (lo + base);
      const lon = rand() * Math.PI * 2;
      if (!clear(base, z, lon, L)) continue;
      spots.push({ base, z, lon, L });
      n++;
    }
  }
  const clouds = [];
  const puffs = [];
  spots.forEach(({ base, z, lon, L }, ci) => {
    const k = Math.sqrt(Math.max(0, 1 - (z / base) ** 2));
    const up = [k * Math.cos(lon), k * Math.sin(lon), z / base];
    // East: along the drift (round z); near the poles any tangent will do.
    let e = [-up[1], up[0], 0];
    let el = Math.hypot(e[0], e[1]);
    if (el < 0.05) { e = [1, 0, 0]; el = 1; }
    e = e.map((c) => c / el);
    const nx = [up[1] * e[2] - up[2] * e[1], up[2] * e[0] - up[0] * e[2], up[0] * e[1] - up[1] * e[0]];
    const W = L * (0.4 + rand() * 0.25);
    const count = Math.round(between(look.puffs));
    const centre = up.map((c) => c * base);
    let reach = 0;
    const mine = [];
    for (let j = 0; j < count; j++) {
      // Along the cloud, with some jitter; big high puffs in the middle, small low ones at the ends.
      const u = ((j + 0.5) / count - 0.5) * L * 0.85 + (rand() - 0.5) * L * 0.08;
      const v = (rand() - 0.5) * W * 0.7;
      const mid = 1 - Math.min(1, Math.abs((2 * u) / L));
      const size = L * (0.13 + 0.14 * mid + rand() * 0.05);
      const lift = size * (0.12 + 0.5 * mid * (0.7 + rand() * 0.3));
      const p = [0, 1, 2].map((a) => centre[a] + e[a] * u + nx[a] * v + up[a] * lift);
      reach = Math.max(reach, Math.hypot(u, v, lift) + size);
      mine.push([p[0], p[1], p[2], size, lift, ci, rand() * Math.PI * 2]);
    }
    // One middle puff on top, the biggest: the cloud's crown.
    const crown = L * (0.2 + rand() * 0.06);
    const cu = (rand() - 0.5) * L * 0.15;
    const cl = crown * (0.75 + rand() * 0.2);
    mine.push([0, 1, 2].map((a) => centre[a] + e[a] * cu + up[a] * cl).concat([crown, cl, ci, rand() * Math.PI * 2]));
    reach = Math.max(reach, Math.hypot(cu, cl) + crown);
    clouds.push({ x: centre[0], y: centre[1], z: centre[2], r: reach, base });
    puffs.push(...mine);
  });
  puffs.sort((a, b) => a[2] - b[2]);
  return { clouds, puffs: Float32Array.from(puffs.flat()) };
}

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// What's left of a cloud between the camera and something we must see: a thin veil.
export const VEIL = 0.18;

/**
 * How much of a cloud shows (0..1), pure. The cloud: centre (cx, cy, cz) and reach r; the camera
 * at (ex, ey, ez); `foci`: n points (x, y, z packed) that must never be hidden (the rocket, the
 * ground under it, the buggy), with `pad` metres of margin round each. It fades out as the
 * camera comes within about two reaches of its middle (gone inside it), and to VEIL when it's
 * in front of a focus, across the line from the camera to it.
 */
export function cloudFade(cx, cy, cz, r, ex, ey, ez, foci, n, pad = 8) {
  const dx = cx - ex, dy = cy - ey, dz = cz - ez;
  const d = Math.hypot(dx, dy, dz);
  let k = smooth(r * 0.9, r * 2.2, d);
  for (let i = 0; i < n; i++) {
    const vx = foci[i * 3] - ex, vy = foci[i * 3 + 1] - ey, vz = foci[i * 3 + 2] - ez;
    const len = Math.hypot(vx, vy, vz) || 1;
    // Along the line of sight: the cloud's middle this far from the camera...
    const along = (dx * vx + dy * vy + dz * vz) / len;
    // ...clearly behind the focus (even its nearest puffs): it can't hide it.
    if (along > len + r) continue;
    const t = Math.max(0, Math.min(len, along));
    const px = ex + (vx * t) / len - cx, py = ey + (vy * t) / len - cy, pz = ez + (vz * t) / len - cz;
    const off = Math.hypot(px, py, pz);
    k = Math.min(k, VEIL + (1 - VEIL) * smooth(r * 0.7, r + pad, off));
  }
  return k;
}

const VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 offset;
  attribute vec4 puff; // size, lift, cloud, phase
  uniform float fades[CLOUDS];
  uniform float time;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying float vH;
  varying float vSize;
  varying float vDay;
  varying float vAlpha;
  varying vec3 vUp;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(offset, 1.0);
    // Sized in world units (the map draws worlds bigger); each puff breathes a little.
    float scale = length(modelMatrix[0].xyz);
    float s = puff.x * scale * (1.0 + 0.04 * sin(time * 0.5 + puff.w));
    vec2 corner = position.xy * 2.0;
    mvPosition.xy += corner * s;
    vec3 up = normalize((modelViewMatrix * vec4(offset, 0.0)).xyz);
    vUp = up;
    // Metres above the cloud's flat base, at this corner (the base cuts the ball off).
    vH = puff.y * scale + dot(corner, up.xy) * s;
    vSize = s;
    vDay = smoothstep(-0.7, 0.3, dot(up, sunDir));
    vAlpha = fades[int(puff.z + 0.5)];
    vUv = corner;
    gl_Position = projectionMatrix * mvPosition;
    // Each cloud is drawn by one of the two meshes: solid, or faded (the veil). Skip the other.
    #ifdef VEIL
      if (vAlpha > 0.98 || vAlpha < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    #else
      if (vAlpha <= 0.98) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    #endif
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }`;

const FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 sunDir;
  uniform vec3 litColor;
  uniform vec3 shadeColor;
  uniform vec3 lineColor;
  uniform vec3 nightColor;
  varying vec2 vUv;
  varying float vH;
  varying float vSize;
  varying float vDay;
  varying float vAlpha;
  varying vec3 vUp;
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(vUv);
    float aa = fwidth(r) * 1.5;
    float mask = (1.0 - smoothstep(1.0 - aa, 1.0, r)) * smoothstep(0.0, fwidth(vH) * 1.5 + 0.001, vH);
    if (mask < 0.5) discard;
    // A ball's light: from the sun, and from above (the sky), plus brighter higher up the cloud.
    vec3 n = vec3(vUv, sqrt(max(0.0, 1.0 - r * r)));
    float light = 0.55 * dot(n, sunDir) + 0.4 * dot(n, vUp) + 0.5 * clamp(vH / (vSize * 1.2), 0.0, 1.0) - 0.12;
    float shade = 1.0 - smoothstep(-0.03, 0.03, light);
    vec3 c = mix(litColor, shadeColor, shade);
    // A soft outline round each puff (so the bumps read where puffs overlap).
    float edge = smoothstep(0.84, 0.84 + aa + 0.03, r);
    c = mix(c, c * lineColor, edge);
    c *= mix(nightColor, vec3(1.0), vDay);
    gl_FragColor = vec4(c, vAlpha * smoothstep(0.5, 1.0, mask));
    if (gl_FragColor.a < 0.01) discard;
    #include <fog_fragment>
    #include <colorspace_fragment>
  }`;

const quad = new THREE.PlaneGeometry(1, 1);

/**
 * A world's cloud layer, or null if it has none. `sunDir`: its view-space sun direction (the
 * flight scene keeps it fresh). Returns { mesh, update(time), fade(camera, foci, n, group),
 * shadow (what the ground's shader needs), frontAngle() (for the screenshots) }.
 */
export function createClouds(body, sunDir) {
  const look = CLOUD_LOOK[body.id];
  if (!look) return null;
  const { clouds, puffs } = cloudPlan(look, body.radius);
  const count = puffs.length / PUFF_STRIDE;
  const offsets = new Float32Array(count * 3), shape = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const p = i * PUFF_STRIDE;
    offsets.set(puffs.subarray(p, p + 3), i * 3);
    shape.set(puffs.subarray(p + 3, p + 7), i * 4);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  geo.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 3));
  geo.setAttribute('puff', new THREE.InstancedBufferAttribute(shape, 4));
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), body.radius + look.alt[1] + look.size[1] * 1.5);
  const fades = new Float32Array(clouds.length).fill(1);
  const colour = (hex) => new THREE.Color(hex);
  const uniforms = {
    fades: { value: fades },
    time: { value: 0 },
    sunDir: { value: sunDir },
    litColor: { value: colour(look.lit) },
    shadeColor: { value: colour(look.shade) },
    lineColor: { value: colour(look.line) },
    nightColor: { value: colour(look.night) },
  };
  // Two draw calls over the same puffs: the clouds as they are, solid (they write depth, so
  // puffs cover each other the right way round from any side; only their thin soft edges
  // blend), and the faded ones (near the camera, or in front of the rocket) as a veil that
  // doesn't write depth, so the atmosphere's glow and the ground still show through it.
  const part = (veil) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
      defines: veil ? { CLOUDS: clouds.length, VEIL: 1 } : { CLOUDS: clouds.length },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: !veil,
      fog: true,
    });
    const m = new THREE.Mesh(geo, mat);
    m.raycast = () => {};
    return m;
  };
  const mesh = new THREE.Group();
  mesh.name = 'clouds';
  mesh.add(part(false), part(true));

  const shadow = {
    map: shadowMap(clouds, puffs),
    rot: { value: new THREE.Vector2(1, 0) }, // the layer's turn (cos, sin)
    alt: body.radius + (look.alt[0] + look.alt[1]) / 2,
    k: { value: look.shadow },
  };
  const layer = {
    mesh,
    shadow,
    clouds,
    noFade: false, // testing only (the screenshots show what the fade saves)
    spin: 0,
    update(time) {
      layer.spin = time * look.drift;
      mesh.rotation.z = layer.spin;
      shadow.rot.value.set(Math.cos(layer.spin), Math.sin(layer.spin));
      uniforms.time.value = time;
    },
    /**
     * Fade each cloud for this frame. `cam`: the camera (scene coordinates); `foci`: n points
     * that must stay visible; `group`: the world's group (floating origin and map scale).
     */
    fade(cam, foci, n, group) {
      const g = group.position, sc = group.scale.x;
      const c = Math.cos(layer.spin), s = Math.sin(layer.spin);
      for (let i = 0; i < clouds.length; i++) {
        const cl = clouds[i];
        const x = g.x + sc * (cl.x * c - cl.y * s), y = g.y + sc * (cl.x * s + cl.y * c), z = g.z + sc * cl.z;
        fades[i] = layer.noFade ? 1 : cloudFade(x, y, z, cl.r * sc, cam.x, cam.y, cam.z, foci, n);
      }
    },
    /** The flight-plane angle now of a cloud just in front of the plane, the closest to angle `near` (for the screenshots). */
    frontAngle(near = 0) {
      let best = null, bestD = Infinity;
      for (const cl of clouds) {
        if (cl.z < 0 || cl.z > 20) continue;
        const a = Math.atan2(cl.y, cl.x) + layer.spin;
        const d = 1 - Math.cos(a - near);
        if (d < bestD) { best = a; bestD = d; }
      }
      return best ?? near;
    },
  };
  return layer;
}

// The shadow map: the layer's footprint seen straight down, as a small cube map (even detail
// all round, no pole or seam), one channel. Soft-edged discs, one per puff, a bit smaller than
// the puff. Pure: six faces of N × N bytes, in WebGL's cube-face layout.
export const SHADOW_N = 128;

/** The unit direction through texel (x, y) of cube face f (WebGL's +x, -x, +y, -y, +z, -z). */
export function cubeDir(f, x, y, n, out = [0, 0, 0]) {
  const sc = ((x + 0.5) / n) * 2 - 1, tc = ((y + 0.5) / n) * 2 - 1;
  let dx, dy, dz;
  switch (f) {
    case 0: dx = 1; dy = -tc; dz = -sc; break;
    case 1: dx = -1; dy = -tc; dz = sc; break;
    case 2: dx = sc; dy = 1; dz = tc; break;
    case 3: dx = sc; dy = -1; dz = -tc; break;
    case 4: dx = sc; dy = -tc; dz = 1; break;
    default: dx = -sc; dy = -tc; dz = -1;
  }
  const l = Math.hypot(dx, dy, dz);
  out[0] = dx / l; out[1] = dy / l; out[2] = dz / l;
  return out;
}

export function shadowFaces(clouds, puffs, n = SHADOW_N) {
  // Each cloud's puffs, as unit directions with their shadows' inner and outer cosines.
  const count = puffs.length / PUFF_STRIDE;
  const per = clouds.map((c) => {
    const l = Math.hypot(c.x, c.y, c.z);
    return { x: c.x / l, y: c.y / l, z: c.z / l, ang: (c.r * 1.2) / l, puffs: [] };
  });
  for (let i = 0; i < count; i++) {
    const p = i * PUFF_STRIDE;
    const x = puffs[p], y = puffs[p + 1], z = puffs[p + 2], size = puffs[p + 3];
    const l = Math.hypot(x, y, z);
    per[puffs[p + 5]].puffs.push(x / l, y / l, z / l, Math.cos((size * 0.7) / l), Math.cos((size * 1.05) / l));
  }
  // Texels in tiles of 8 × 8: each tile only looks at the clouds that can reach it.
  const T = 8;
  const faces = [];
  const d = [0, 0, 0], e = [0, 0, 0];
  const near = [];
  for (let f = 0; f < 6; f++) {
    const data = new Uint8Array(n * n);
    for (let ty = 0; ty < n; ty += T) {
      for (let tx = 0; tx < n; tx += T) {
        cubeDir(f, tx + T / 2 - 0.5, ty + T / 2 - 0.5, n, d);
        let tile = 0;
        for (const [cx, cy] of [[tx, ty], [tx + T - 1, ty], [tx, ty + T - 1], [tx + T - 1, ty + T - 1]]) {
          cubeDir(f, cx, cy, n, e);
          tile = Math.max(tile, Math.acos(Math.min(1, d[0] * e[0] + d[1] * e[1] + d[2] * e[2])));
        }
        near.length = 0;
        for (const c of per) {
          const a = Math.acos(Math.min(1, d[0] * c.x + d[1] * c.y + d[2] * c.z));
          if (a < c.ang + tile) near.push(c);
        }
        if (!near.length) continue;
        for (let y = ty; y < ty + T; y++) {
          for (let x = tx; x < tx + T; x++) {
            cubeDir(f, x, y, n, e);
            let v = 0;
            for (const c of near) {
              const q = c.puffs;
              for (let k = 0; k < q.length; k += 5) {
                const dot = e[0] * q[k] + e[1] * q[k + 1] + e[2] * q[k + 2];
                if (dot > q[k + 4]) v = Math.max(v, smooth(q[k + 4], q[k + 3], dot));
              }
            }
            data[y * n + x] = Math.round(v * 255);
          }
        }
      }
    }
    faces.push(data);
  }
  return faces;
}

function shadowMap(clouds, puffs) {
  const faces = shadowFaces(clouds, puffs).map((data) => {
    const t = new THREE.DataTexture(data, SHADOW_N, SHADOW_N, THREE.RedFormat, THREE.UnsignedByteType);
    t.needsUpdate = true;
    return t;
  });
  const tex = new THREE.CubeTexture(faces, undefined, undefined, undefined, THREE.LinearFilter, THREE.LinearFilter, THREE.RedFormat, THREE.UnsignedByteType);
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The clouds' soft shadows on a world's ground: patches its (toon) terrain material, on top of
 * whatever it already does (richLook's shader). Along the sun's direction up to the layer, one
 * lookup in the baked map, and less direct sunlight there (so the night side is untouched).
 */
export function cloudShadows(mat, layer, sunDir) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  const { shadow } = layer;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, {
      csMap: { value: shadow.map }, csRot: shadow.rot, csAlt: { value: shadow.alt }, csK: shadow.k, csSun: { value: sunDir },
    });
    shader.vertexShader = 'uniform vec3 csSun;\nvarying vec3 csObj;\nvarying vec3 csSunObj;\n'
      + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ncsObj = position;\ncsSunObj = normalize(csSun * mat3(modelViewMatrix));');
    shader.fragmentShader = 'uniform samplerCube csMap;\nuniform vec2 csRot;\nuniform float csAlt;\nuniform float csK;\nvarying vec3 csObj;\nvarying vec3 csSunObj;\n'
      + shader.fragmentShader.replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
      {
        // Towards the sun, up to the clouds' height (not too far when the sun is low, so a
        // shadow stays near its cloud); then where that is in the turning layer.
        float pr = length(csObj);
        vec3 sun = normalize(csSunObj);
        vec3 q = csObj + sun * (max(csAlt - pr, 0.0) / max(dot(csObj / pr, sun), 0.85));
        float sh = textureCube(csMap, vec3(csRot.x * q.x + csRot.y * q.y, csRot.x * q.y - csRot.y * q.x, q.z)).r;
        // (Only by day: the toon light still lights the night side a little.)
        sh *= smoothstep(-0.1, 0.25, dot(csObj / pr, sun));
        reflectedLight.directDiffuse *= 1.0 - csK * sh;
      }`);
  };
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|clouds`;
  return mat;
}
