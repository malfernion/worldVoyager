// Misty's haze bands (#54, stage 4), like Titan's: from space its orange haze is layered, a few
// soft lighter and darker bands round its spin axis whose wavy edges drift slowly (each band at
// its own speed, so they shear past each other), a darker hood over the pole the cameras see, and
// at the edge Titan's detached haze layer: a thin pale ring standing clear of the main haze,
// with a darker gap between.
//
// Nothing new is drawn: it's a few lines in the glowing shell's shader (planets.js
// `atmosphere()`), so no draw call, no overdraw and no CPU work beyond one uniform (the real
// clock). `bandAt()` / `detachedAt()` are the shader's sums in JS for the tests: change both
// together. The shell is gone down in the haze, so these are only seen from outside.

/**
 * Each world's haze bands (only Misty). `axis`: the bands go round it (tilted towards the
 * cameras on +z, so from the flight views they're gentle arcs across the disc, not a
 * bullseye). `bands`: each one's middle (`lat`, rad), half-width (`w`, rad), how much lighter
 * (k > 0) or darker (k < 0), its drift (`speed`, rad/s round the axis, real time) and its edge's
 * waves (`amp` rad, `n` round the world, `ph`). `hood`: the dark cap over the facing pole from
 * `lat` up (and `k`). `wisp`: how much the noise streaks the bands (0..1). `light`: the colour a
 * lighter band adds; a darker band dims what's behind the shell (up to `dark`) and thins the
 * shell's own glow (by `thin`), or the nearly saturated haze would hide it. `face`: the bands fade
 * out between these shares of the shell's radius (see `detached`), so the glowing ring round the
 * edge keeps its look. `detached`: the
 * detached layer, as shares of the shell's radius counted by how close a line of sight passes
 * to the world's middle (the ground's edge is at the ground's radius over the shell's): the pale
 * ring's middle `at` and half-width `w`, its brightness `k`, and the darker `gap` just inside it
 * ([from, to], how much darker `gapK`).
 */
export const BAND_LOOK = {
  misty: {
    axis: [0.28, 0.78, 0.56],
    bands: [
      { lat: 0.72, w: 0.13, k: 0.4, speed: 0.0018, amp: 0.06, n: 3, ph: 0.4 },
      { lat: 0.42, w: 0.12, k: -0.45, speed: 0.0026, amp: 0.07, n: 4, ph: 2.1 },
      { lat: 0.1, w: 0.15, k: 0.32, speed: 0.0033, amp: 0.05, n: 5, ph: 4.0 },
      { lat: -0.25, w: 0.12, k: -0.42, speed: 0.0029, amp: 0.07, n: 4, ph: 1.2 },
      { lat: -0.6, w: 0.16, k: 0.36, speed: 0.0021, amp: 0.06, n: 3, ph: 5.3 },
    ],
    hood: { lat: 1.0, k: -0.4 },
    wisp: 0.6,
    light: 0xffd49a,
    dark: 0.5,
    thin: 1,
    face: [0.7, 0.84],
    detached: { at: 0.972, w: 0.011, k: 0.55, gap: [0.925, 0.958], gapK: 0.35 },
  },
};

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The bands' frame: the axis and two directions across it (for the longitude), once per look.
const frames = new Map();
export function bandFrame(look) {
  let f = frames.get(look);
  if (f) return f;
  const l = Math.hypot(...look.axis);
  const a = look.axis.map((c) => c / l);
  // Any direction across the axis: the one nearest x.
  let b = [1 - a[0] * a[0], -a[0] * a[1], -a[0] * a[2]];
  const bl = Math.hypot(...b);
  b = b.map((c) => c / bl);
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  f = { a, b, c };
  frames.set(look, f);
  return f;
}

/**
 * How much lighter (> 0) or darker (< 0) the haze is at unit direction (x, y, z) (the world's
 * frame), `time` s on (real time), before the shader's noise wisps (pure). The sum of the bands
 * (each a soft bump across its wavy middle) and the hood.
 */
export function bandAt(look, x, y, z, time) {
  const { a, b, c } = bandFrame(look);
  const s = Math.max(-1, Math.min(1, x * a[0] + y * a[1] + z * a[2]));
  const lat = Math.asin(s);
  const lon = Math.atan2(x * c[0] + y * c[1] + z * c[2], x * b[0] + y * b[1] + z * b[2]);
  let k = 0;
  for (const bd of look.bands) {
    const mid = bd.lat + bd.amp * Math.sin(bd.n * (lon - bd.speed * time) + bd.ph);
    k += bd.k * (1 - smooth(0, 1, Math.abs(lat - mid) / bd.w));
  }
  k += look.hood.k * smooth(look.hood.lat, look.hood.lat + 0.25, lat);
  return k;
}

/**
 * The detached layer at `rho` (how close the line of sight passes to the world's middle, as a
 * share of the shell's radius), pure: `ring` (0..1, the pale ring) and `gap` (0..1 darker).
 */
export function detachedAt(look, rho) {
  const d = look.detached;
  const ring = 1 - smooth(0, 1, Math.abs(rho - d.at) / d.w);
  const g = d.gap;
  const gap = smooth(g[0], g[0] + 0.4 * (g[1] - g[0]), rho) * (1 - smooth(g[1] - 0.3 * (g[1] - g[0]), g[1], rho));
  return { ring, gap: gap * d.gapK };
}

const f = (v) => v.toFixed(4);

/**
 * The shell shader's extra lines for a look: declarations (`pars`) and the body (`main`), which
 * reads `vO` (the object-space normal), `rho`, `fade`, `day`, `time`, `noiseMap` and sets
 * `light` (added) and `dark` (how much of what's behind is dimmed).
 */
export function bandShader(look) {
  const { a, b, c } = bandFrame(look);
  const v3 = (v) => `vec3(${v.map(f).join(', ')})`;
  const bands = look.bands.map((bd) => `
      {
        float mid = ${f(bd.lat)} + (${f(bd.amp)} + wob) * sin(${bd.n.toFixed(1)} * (lon - ${bd.speed.toFixed(5)} * time) + ${f(bd.ph)});
        k += ${f(bd.k)} * (1.0 - smoothstep(0.0, 1.0, abs(lat - mid) / ${f(bd.w)}));
      }`).join('');
  const d = look.detached, g = d.gap;
  return {
    pars: /* glsl */ `
      uniform float time;
      uniform sampler2D noiseMap;
      uniform vec3 bandLight;
      varying vec3 vO;`,
    main: /* glsl */ `
      vec3 o = normalize(vO);
      float lat = asin(clamp(dot(o, ${v3(a)}), -1.0, 1.0));
      float lon = atan(dot(o, ${v3(c)}), dot(o, ${v3(b)}));
      // Streaky wisps along the bands (the noise stretched round the axis, drifting with them;
      // fading out towards the pole, where the longitude pinches).
      float pole = 1.0 - smoothstep(1.1, 1.4, abs(lat));
      vec2 nq = vec2(lon * ${f(2 / (2 * Math.PI))} - 0.0008 * time, lat * 3.2);
      float nz = texture2D(noiseMap, nq).r;
      float nz2 = texture2D(noiseMap, nq * vec2(2.0, 3.0) + 0.37).r;
      float wob = 0.05 * (nz - 0.5) * pole;
      float k = 0.0;${bands}
      k += ${f(look.hood.k)} * smoothstep(${f(look.hood.lat)}, ${f(look.hood.lat + 0.25)}, lat);
      k *= mix(1.0, 0.45 + 1.1 * nz2, ${f(look.wisp)} * pole);
      // Only over the face: the glowing ring round it stays as it was.
      k *= 1.0 - smoothstep(${f(look.face[0])}, ${f(look.face[1])}, rho);
      // Titan's detached layer: a pale thin ring clear of the main haze, a darker gap inside it
      // (as wide as a pixel or two at least: never shimmering).
      float fw = fwidth(rho);
      float rw = max(${f(d.w)}, 1.5 * fw);
      float ring = (1.0 - smoothstep(0.0, 1.0, abs(rho - ${f(d.at)}) / rw)) * ${f(d.w)} / rw;
      float gap = smoothstep(${f(g[0])}, ${f(g[0] + 0.4 * (g[1] - g[0]))}, rho) * (1.0 - smoothstep(${f(g[1] - 0.3 * (g[1] - g[0]))}, ${f(g[1])}, rho)) * ${f(d.gapK)};
      light = bandLight * (max(k, 0.0) * 0.9 + ring * ${f(d.k)}) * day * fade;
      dark = min(${f(look.dark)}, max(-k, 0.0)) * day * fade;
      // (A darker band thins the glow too, or the saturated haze would hide it.)
      shellK = (1.0 - gap) * (1.0 - ${f(look.thin)} * min(1.0, max(-k, 0.0)));`,
  };
}
