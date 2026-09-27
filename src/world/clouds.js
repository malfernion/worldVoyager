// Cartoon clouds (#54): a layer of soft clouds drifting slowly round a world, with faint soft
// shadows on its ground. Driven by CLOUD_LOOK per world (only Homestead so far), so other
// worlds can have their own layer later (thin high clouds, haze bands, streaks).
//
// Soft and diffuse, made of particles: each cloud is a loose cluster of soft sprites (big dense
// ones in its core, small faint ones round its rim, and some clouds are only thin wisps). A
// sprite is a soft falloff bent and eaten away by a small baked noise tile, so its rims are
// feathered and see-through; the noise slowly scrolls, so clouds billow a little. Shading is gentle: lit on
// the sun's side and on top, a pale periwinkle underneath, softly fading out below the cloud's
// base (so cumulus still have flattish bottoms from the ground).
//
// Cheap for phones: every sprite of every cloud is one instanced billboard in ONE draw call,
// blended (premultiplied) with no depth write. The whole layer turns as one about the z axis
// (the flight plane's normal), so nothing is moved per sprite on the CPU: the mesh's rotation
// is the drift. Overdraw is capped in the vertex shader: a sprite fades out (and is dropped
// before any pixel is drawn) as it gets close to the camera or big on screen, and big sprites
// fade towards the screen's edges, so there are never big white shapes cut off by the edges.
// The ground's shadows come from a small cube map baked once (the layer's footprint), turned by
// the drift in the terrain's toon shader.
//
// Readability: each cloud fades out when the camera comes close (or goes through it), and fades
// to a thin veil when it sits between the camera and the rocket, the ground under the rocket
// or the buggy (`cloudFade()`, pure; a few multiplies per cloud per frame).
import * as THREE from 'three';
import { mulberry32 } from '../physics/noise.js';

/**
 * Each world's clouds. `alt`: the clouds' bases, metres above the world's radius (the tallest
 * peaks may poke through; tops under the space line, so a launch climbs through them); `size`:
 * a cloud's length (m); `sprites`: how many soft sprites make one; `wisps`: the share of clouds
 * that are only thin wisps (streaks of fainter sprites). Where they are, as bands of z (metres
 * off the flight plane; the flight and map cameras sit on the +z side): `sky` is the band
 * behind the plane that the landed and launch views see as their sky, `plane` the clouds right
 * round the flight plane a launch flies past, and `spread` more anywhere else (the globe seen
 * from space, driving elsewhere; `front` on the camera's side, `back` behind, with their own
 * `size`, in fields about `field` metres across, so from space the cover is patchy). `drift`:
 * how fast the layer turns (rad/s, real time). Colours: `lit`, `shade` (the shadow side and
 * undersides), `night` (multiplies them on the night side); `shadow`: how much of the direct
 * sunlight a cloud's shadow takes off the ground at most.
 */
export const CLOUD_LOOK = {
  homestead: {
    seed: 54,
    alt: [30, 38],
    size: [24, 40],
    sprites: [14, 20],
    wisps: 0.3,
    sky: { count: 16, z: [-170, -35] },
    plane: { count: 7, z: [-28, 12] },
    spread: { front: 90, back: 30, size: [28, 50], field: 130 },
    drift: 0.004,
    lit: 0xffffff,
    shade: 0xc4cfee,
    night: 0x5a6aa8,
    shadow: 0.3,
  },
};

// Sprite numbers: centre x, y, z (the layer's frame), size (radius, m), lift (how far the
// centre sits above its cloud's base, m), cloud index, seed (0..1, where its noise comes from),
// normal x, y, z (out of the cloud's middle: for the light), density (0..1), height (0 at the
// cloud's base, 1 at its top).
export const PUFF_STRIDE = 12;

/**
 * Where every cloud and sprite goes (pure, seeded). Returns `clouds`: per cloud its centre at
 * its base (x, y, z, layer frame), its reach `r` (m, from the centre to its furthest sprite
 * edge), its base radius `base` and whether it's a `wisp`; and `puffs`, PUFF_STRIDE numbers per
 * sprite, sorted far-to-near for a camera on the +z side (so they blend the right way round in
 * the flight views).
 */
export function cloudPlan(look, radius) {
  const rand = mulberry32(look.seed);
  const between = ([a, b]) => a + rand() * (b - a);
  const spots = [];
  // Clouds keep a little clear of each other.
  const clear = (base, z, lon, L) => spots.every((o) => {
    const k1 = Math.sqrt(Math.max(0, 1 - (z / base) ** 2)), k2 = Math.sqrt(Math.max(0, 1 - (o.z / o.base) ** 2));
    const d = Math.hypot(k1 * base * Math.cos(lon) - k2 * o.base * Math.cos(o.lon), k1 * base * Math.sin(lon) - k2 * o.base * Math.sin(o.lon), z - o.z);
    return d > (L + o.L) * 0.5;
  });
  const band = ({ count, z: zs }) => {
    for (let i = 0; i < count; i++) {
      const base = radius + between(look.alt);
      const L = between(look.size);
      const lon = ((i + 0.2 + rand() * 0.6) / count) * Math.PI * 2;
      spots.push({ base, z: Math.max(-base, Math.min(base, between(zs))), lon, L, wisp: rand() < look.wisps * 0.5 });
    }
  };
  band(look.sky);
  band(look.plane);
  // The rest on the camera's side of the world and round the back (evenly by area: uniform in z),
  // outside those bands.
  const lo = Math.min(look.sky.z[0], look.plane.z[0]) - 20, hi = Math.max(look.sky.z[1], look.plane.z[1]) + 20;
  const { front, back } = look.spread;
  // In fields of a few clouds and wisps (patchy cover from space, clear sky between), each
  // around a spot picked evenly by area.
  for (const [count, side] of [[front, 1], [back, -1]]) {
    let fz = 0, flon = 0, left = 0;
    for (let n = 0, tries = 0; n < count && tries < 4000; tries++) {
      const base = radius + between(look.alt);
      if (left <= 0) {
        fz = side > 0 ? hi + rand() * (base - hi) : -base + rand() * (lo + base);
        flon = rand() * Math.PI * 2;
        left = 3 + Math.floor(rand() * 5);
      }
      const L = between(look.spread.size);
      const z = Math.max(side > 0 ? hi : -base, Math.min(side > 0 ? base : lo, fz + (rand() - 0.5) * look.spread.field));
      const k = Math.sqrt(Math.max(0.05, 1 - (fz / base) ** 2));
      const lon = flon + ((rand() - 0.5) * look.spread.field) / (base * k);
      if (tries % 40 === 39) left = 0; // this field is full: start another
      if (!clear(base, z, lon, L)) continue;
      spots.push({ base, z, lon, L, wisp: rand() < look.wisps });
      n++;
      left--;
    }
  }
  const clouds = [];
  const puffs = [];
  spots.forEach(({ base, z, lon, L, wisp }, ci) => {
    const k = Math.sqrt(Math.max(0, 1 - (z / base) ** 2));
    const up = [k * Math.cos(lon), k * Math.sin(lon), z / base];
    // Along the drift (round z) with a random slant; near the poles any tangent will do.
    let e0 = [-up[1], up[0], 0];
    let el = Math.hypot(e0[0], e0[1]);
    if (el < 0.05) { e0 = [1, 0, 0]; el = 1; }
    e0 = e0.map((c) => c / el);
    const n0 = [up[1] * e0[2] - up[2] * e0[1], up[2] * e0[0] - up[0] * e0[2], up[0] * e0[1] - up[1] * e0[0]];
    const tilt = (rand() - 0.5) * 0.8;
    const e = e0.map((c, a) => c * Math.cos(tilt) + n0[a] * Math.sin(tilt));
    const nx = e0.map((c, a) => -c * Math.sin(tilt) + n0[a] * Math.cos(tilt));
    const centre = up.map((c) => c * base);
    // The cloud's height, and the middle its light comes out of.
    const H = wisp ? L * 0.12 : L * (0.34 + rand() * 0.1);
    const heart = up.map((c) => c * H * 0.35);
    let reach = 0;
    const mine = [];
    const put = (u, v, lift, size, dens) => {
      const off = [0, 1, 2].map((a) => e[a] * u + nx[a] * v + up[a] * lift);
      const p = off.map((c, a) => centre[a] + c);
      const nv = off.map((c, a) => c - heart[a]);
      const nl = Math.hypot(...nv) || 1;
      reach = Math.max(reach, Math.hypot(...off) + size);
      mine.push([p[0], p[1], p[2], size, lift, ci, rand(), nv[0] / nl, nv[1] / nl, nv[2] / nl, dens, Math.min(1, Math.max(0, lift / H))]);
    };
    if (wisp) {
      // A thin streak: small faint sprites along a gently bent line, thinning out at the ends.
      const count = Math.round(between(look.sprites));
      const bend = (rand() - 0.5) * 0.5;
      for (let j = 0; j < count; j++) {
        const t = (j + rand()) / count - 0.5;
        const end = 1 - Math.abs(2 * t);
        const u = t * L * 1.5;
        put(u, bend * L * (t * t * 4 - 1) * 0.3 + (rand() - 0.5) * L * 0.12, H * (0.3 + rand() * 0.5),
          L * (0.12 + 0.12 * end + rand() * 0.05), 0.35 + 0.3 * end);
      }
    } else {
      // A puffy cloud: a dome of sprites, big and dense in its core, higher in the middle,
      // smaller and fainter round its edges.
      const W = L * (0.5 + rand() * 0.35);
      const count = Math.round(between(look.sprites));
      for (let j = 0; j < count; j++) {
        // Spread along the cloud a bit more densely in the middle.
        const t = (rand() + rand() + rand()) / 3 - 0.5;
        const u = t * L * 1.1;
        const v = (rand() + rand() - 1) * W * 0.4;
        const mid = Math.max(0, 1 - (2 * Math.abs(u) / L) ** 2 - (2 * Math.abs(v) / W) ** 2 * 0.5);
        const size = L * (0.11 + 0.14 * mid + rand() * 0.06);
        // Low sprites sit near the base; higher ones only where the dome is tall.
        // (Their tops stay within a little of the dome's.)
        const lift = Math.max(size * 0.3, Math.min(rand() * H * (0.25 + 0.75 * mid), H + L * 0.1 - size));
        put(u, v, lift, size, 0.55 + 0.45 * mid);
      }
    }
    clouds.push({ x: centre[0], y: centre[1], z: centre[2], r: reach, base, wisp });
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
  let k = smooth(r * 0.6, r * 1.8, d);
  for (let i = 0; i < n; i++) {
    const vx = foci[i * 3] - ex, vy = foci[i * 3 + 1] - ey, vz = foci[i * 3 + 2] - ez;
    const len = Math.hypot(vx, vy, vz) || 1;
    // Along the line of sight: the cloud's middle this far from the camera...
    const along = (dx * vx + dy * vy + dz * vz) / len;
    // ...clearly behind the focus (even its nearest sprites): it can't hide it.
    if (along > len + r) continue;
    const t = Math.max(0, Math.min(len, along));
    const px = ex + (vx * t) / len - cx, py = ey + (vy * t) / len - cy, pz = ez + (vz * t) / len - cz;
    const off = Math.hypot(px, py, pz);
    k = Math.min(k, VEIL + (1 - VEIL) * smooth(r * 0.7, r + pad, off));
  }
  return k;
}

/**
 * How much of a sprite is drawn for where it is on screen (0..1), pure; the vertex shader does
 * the same sums. `size`: its radius (m), `depth`: its distance in front of the camera (m),
 * `focal`: the projection's y scale (1 / tan(fov / 2)), (nx, ny) its centre on screen (-1..1).
 * Gone when the camera is almost in it or when it would fill a big part of the screen (that's
 * where overdraw costs, and where a soft sprite stops looking soft), and big ones fade out
 * towards the screen's edges (never a big shape cut off there); small far ones are left alone.
 */
export const NEAR = [1.2, 3.5]; // sprite radii in front of the camera: gone .. whole
export const BIG = [0.22, 0.5]; // radius on screen (fraction of the half-height): whole .. gone
export const EDGE = [0.75, 1.0]; // how far out on screen a big sprite fades: whole .. gone
export function spriteFade(size, depth, focal, nx, ny) {
  const near = smooth(size * NEAR[0], size * NEAR[1], depth);
  const rs = (size * focal) / Math.max(depth, 1e-3);
  const big = 1 - smooth(BIG[0], BIG[1], rs);
  const edge = 1 - smooth(EDGE[0], EDGE[1], Math.max(Math.abs(nx), Math.abs(ny)) + rs) * smooth(0.04, 0.14, rs);
  return near * big * edge;
}

const VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 offset;
  attribute vec4 puff; // size, lift, cloud, seed
  attribute vec4 look; // normal (layer frame), density
  attribute float height;
  uniform float fades[CLOUDS];
  uniform float time;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying vec2 vNoise;
  varying float vH;
  varying float vSize;
  varying float vDay;
  varying float vAlpha;
  varying float vDens;
  varying float vLight;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(offset, 1.0);
    // Sized in world units (the map draws worlds bigger).
    float scale = length(modelMatrix[0].xyz);
    float s = puff.x * scale;
    // What's left of it (see spriteFade()): its cloud's fade, its density, and where it is on
    // screen. Nothing left: dropped before any pixel is drawn.
    float depth = -mvPosition.z;
    vec4 c = projectionMatrix * mvPosition;
    vec2 ndc = c.xy / max(c.w, 1e-3);
    float rs = s * projectionMatrix[1][1] / max(depth, 1e-3);
    float fade = smoothstep(s * ${NEAR[0].toFixed(2)}, s * ${NEAR[1].toFixed(2)}, depth)
      * (1.0 - smoothstep(${BIG[0].toFixed(2)}, ${BIG[1].toFixed(2)}, rs))
      * (1.0 - smoothstep(${EDGE[0].toFixed(2)}, ${EDGE[1].toFixed(2)}, max(abs(ndc.x), abs(ndc.y)) + rs) * smoothstep(0.04, 0.14, rs));
    vAlpha = fades[int(puff.z + 0.5)] * fade;
    vDens = look.w;
    vec2 corner = position.xy * 2.0;
    mvPosition.xy += corner * s;
    vec3 up = normalize((modelViewMatrix * vec4(offset, 0.0)).xyz);
    // Metres above the cloud's base, at this corner (it thins out below it).
    vH = puff.y * scale + dot(corner, up.xy) * s;
    vSize = s;
    vDay = smoothstep(-0.7, 0.3, dot(up, sunDir));
    // The sprite's own light: its side of the cloud towards the sun, and how high up it is.
    vec3 n = normalize((modelViewMatrix * vec4(look.xyz, 0.0)).xyz);
    vLight = 0.45 * dot(n, sunDir) + 0.25 * dot(n, up) + 0.55 * height - 0.2;
    // Its bit of the noise tile: a random spot and turn, slowly scrolling (the cloud billows).
    float a = puff.w * 6.2832;
    vUv = corner;
    vNoise = mat2(cos(a), sin(a), -sin(a), cos(a)) * corner * (0.3 + 0.2 * fract(puff.w * 7.0))
      + vec2(puff.w * 13.0, puff.w * 29.0) + vec2(0.006, 0.003) * time;
    gl_Position = projectionMatrix * mvPosition;
    if (vAlpha < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }`;

const FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D noiseMap;
  uniform vec3 sunDir;
  uniform vec3 litColor;
  uniform vec3 shadeColor;
  uniform vec3 nightColor;
  varying vec2 vUv;
  varying vec2 vNoise;
  varying float vH;
  varying float vSize;
  varying float vDay;
  varying float vAlpha;
  varying float vDens;
  varying float vLight;
  void main() {
    #include <logdepthbuf_fragment>
    float r2 = dot(vUv, vUv);
    if (r2 > 1.0) discard;
    // A soft falloff, bent and eaten away by the noise (so it isn't a round disc): dense in the
    // middle, feathered and see-through at the rims.
    float nz = texture2D(noiseMap, vNoise).r;
    float rr = min(1.0, r2 * (0.55 + 0.9 * nz));
    float fall = (1.0 - rr) * (1.0 - rr);
    float d = fall * (0.3 + 1.1 * nz) - 0.12;
    // Thinning out just below the cloud's base.
    d *= smoothstep(-0.35 * vSize, 0.3 * vSize, vH);
    // Fading (near the camera, big on screen, over the rocket) thins it from the rims inwards,
    // so a faded cloud evaporates into wisps rather than turning into grey discs.
    float a = smoothstep(0.0, 0.4, d * vAlpha) * sqrt(vAlpha) * vDens;
    if (a < 0.004) discard;
    // Gentle toon light: the sprite's place in its cloud, a soft ball's turn to the sun, and a
    // touch of the noise, in a soft two-tone step.
    vec3 n = vec3(vUv * 0.7, sqrt(max(0.0, 1.0 - r2 * 0.49)));
    float light = vLight + 0.12 * dot(n, sunDir) + 0.4 * (nz - 0.5);
    vec3 c = mix(shadeColor, litColor, smoothstep(-0.2, 0.25, light));
    c *= mix(nightColor, vec3(1.0), vDay);
    gl_FragColor = vec4(c, a);
    #include <fog_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb *= gl_FragColor.a; // premultiplied
  }`;

const quad = new THREE.PlaneGeometry(1, 1);

// The noise tile the sprites are eaten away by: tileable value noise, a few octaves, 0..1 (pure).
export const NOISE_N = 64;
export function noiseTile(n = NOISE_N, seed = 54) {
  const rand = mulberry32(seed);
  const out = new Float32Array(n * n);
  let amp = 1, total = 0;
  for (let cells = 4; cells <= 32; cells *= 2) {
    const g = Float32Array.from({ length: cells * cells }, () => rand());
    const at = (x, y) => g[(y % cells) * cells + (x % cells)];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const fx = (x / n) * cells, fy = (y / n) * cells;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        let tx = fx - ix, ty = fy - iy;
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        const v = (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
        out[y * n + x] += v * amp;
      }
    }
    total += amp;
    amp *= 0.55;
  }
  // Stretched to fill 0..1.
  let lo = Infinity, hi = -Infinity;
  for (const v of out) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const bytes = new Uint8Array(n * n);
  for (let i = 0; i < out.length; i++) bytes[i] = Math.round(((out[i] - lo) / (hi - lo)) * 255);
  return bytes;
}

function noiseTexture() {
  const t = new THREE.DataTexture(noiseTile(), NOISE_N, NOISE_N, THREE.RedFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

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
  const offsets = new Float32Array(count * 3), shape = new Float32Array(count * 4), lk = new Float32Array(count * 4), height = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const p = i * PUFF_STRIDE;
    offsets.set(puffs.subarray(p, p + 3), i * 3);
    shape.set(puffs.subarray(p + 3, p + 7), i * 4);
    lk.set(puffs.subarray(p + 7, p + 11), i * 4);
    height[i] = puffs[p + 11];
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 3));
  geo.setAttribute('puff', new THREE.InstancedBufferAttribute(shape, 4));
  geo.setAttribute('look', new THREE.InstancedBufferAttribute(lk, 4));
  geo.setAttribute('height', new THREE.InstancedBufferAttribute(height, 1));
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), body.radius + look.alt[1] + look.size[1] * 1.5);
  const fades = new Float32Array(clouds.length).fill(1);
  const colour = (hex) => new THREE.Color(hex);
  const uniforms = {
    fades: { value: fades },
    time: { value: 0 },
    sunDir: { value: sunDir },
    noiseMap: { value: noiseTexture() },
    litColor: { value: colour(look.lit) },
    shadeColor: { value: colour(look.shade) },
    nightColor: { value: colour(look.night) },
  };
  // One draw call: every sprite blended (premultiplied), none writing depth, so the ground,
  // the atmosphere's glow and each other all show through their soft edges.
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
    defines: { CLOUDS: clouds.length },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'clouds';
  mesh.raycast = () => {};

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
    sprites: count,
    noFade: false, // testing only: no per-cloud fades (the screenshots show what they save)
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
        if (cl.z < 0 || cl.z > 20 || cl.wisp) continue;
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
// all round, no pole or seam), one channel. A soft round blot under each sprite, as dense as
// the sprite, piling up where they overlap (so a cloud's shadow is darkest under its core and
// fades out softly; a wisp's is faint). Pure: six faces of N × N bytes, in WebGL's cube-face
// layout.
export const SHADOW_N = 96;

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
  // Each cloud's sprites, as unit directions with their blots' inner and outer cosines and density.
  const count = puffs.length / PUFF_STRIDE;
  const per = clouds.map((c) => {
    const l = Math.hypot(c.x, c.y, c.z);
    return { x: c.x / l, y: c.y / l, z: c.z / l, ang: (c.r * 1.3) / l, puffs: [] };
  });
  for (let i = 0; i < count; i++) {
    const p = i * PUFF_STRIDE;
    const x = puffs[p], y = puffs[p + 1], z = puffs[p + 2], size = puffs[p + 3];
    const l = Math.hypot(x, y, z);
    per[puffs[p + 5]].puffs.push(x / l, y / l, z / l, Math.cos((size * 0.15) / l), Math.cos((size * 1.2) / l), puffs[p + 10] * 0.6, (size * 1.2) / l);
  }
  // Texels in tiles of 8 × 8: each tile only looks at the sprites that can reach it (of the
  // clouds that can).
  const T = 8;
  const faces = [];
  const d = [0, 0, 0], e = [0, 0, 0];
  const near = new Float64Array(count * 6);
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
        let m = 0;
        for (const c of per) {
          if (Math.acos(Math.min(1, d[0] * c.x + d[1] * c.y + d[2] * c.z)) > c.ang + tile) continue;
          const q = c.puffs;
          for (let k = 0; k < q.length; k += 7) {
            if (Math.acos(Math.min(1, d[0] * q[k] + d[1] * q[k + 1] + d[2] * q[k + 2])) > q[k + 6] + tile) continue;
            for (let j = 0; j < 6; j++) near[m + j] = q[k + j];
            m += 6;
          }
        }
        if (!m) continue;
        for (let y = ty; y < ty + T; y++) {
          for (let x = tx; x < tx + T; x++) {
            cubeDir(f, x, y, n, e);
            let clear = 1;
            for (let k = 0; k < m; k += 6) {
              const dot = e[0] * near[k] + e[1] * near[k + 1] + e[2] * near[k + 2];
              if (dot > near[k + 4]) clear *= 1 - near[k + 5] * smooth(near[k + 4], near[k + 3], dot);
            }
            data[y * n + x] = Math.round((1 - clear) * 255);
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
