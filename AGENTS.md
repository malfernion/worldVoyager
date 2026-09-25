# AGENTS.md: working on World Voyager

World Voyager is a three.js space game for **5-year-olds**: build a rocket, fly it with real
orbital mechanics (KSP-style), explore a tiny cartoon solar system (Outer Wilds mood), drive a
buggy on other worlds. It's mobile-first and deployed to GitHub Pages at
https://malfernion.github.io/worldVoyager/.

Read this file, then [`docs/DESIGN.md`](docs/DESIGN.md) (design, reasoning, architecture) and
the [README](README.md) (how to play).

## What to work on next

1. Open the pinned **Roadmap** issue (#17, label `roadmap`): `gh issue view 17`.
2. Take the **first unchecked item**; read it with `gh issue view <n>`.
3. Unscheduled issues are only picked up when the owner asks.

## Keep the docs current

These docs are how the next person or agent picks up the work, so **update them in the same
commit as the change they describe**:

| If you change… | Update |
|---|---|
| Files, modules, or what lives where | Code map in `AGENTS.md` |
| A rule the code relies on (physics plane, speed caps, surfaces, performance budget…) | Invariants in `AGENTS.md`, and the reasoning in `docs/DESIGN.md` |
| Commands, scripts, CI, deploy | Commands in `AGENTS.md` and the `README.md` Develop section |
| Controls, features, anything a player notices | `README.md` How to play; `docs/DESIGN.md` for bigger features |
| The voice pipeline or its settings | Pip's voice section in `AGENTS.md` |
| You hit a surprising problem | Add it to Gotchas in `AGENTS.md` |
| Finish, add, reorder or drop backlog work | The Roadmap issue (#17): tick, add or reorder items |

When reviewing an agent's work before merging, check that the docs moved with the code.

## Commands

```bash
npm install
npm run dev          # Vite dev server (--host, so phones on the LAN can connect)
npm test             # vitest: physics, autopilot missions, coach flights, buggy, speech, zoom
npm run build        # static site in dist/
npm run voice:check  # which of Pip's sentences still need recording
npm run stress       # "take me there" sweep: every pair of worlds, many start times, tours,
                     # autopilot + pretend kid; prints failure rates by kind (~1.5 min, all cores)
```

**Pushing to `main` deploys** (`.github/workflows/deploy.yml`: test, build, GitHub Pages).
Only push work that is tested and ready for players.

## Workflow

- **One issue at a time.** Each issue is one focused commit (or a small series). When
  orchestrating sub-agents, run one at a time in a git worktree, then review, merge, test and push
  before starting the next.
- **Worktrees start from the pushed `main`**, so push after each merge. Agent worktrees live
  in `.claude/` (git-ignored, excluded from vitest).
- **Commit messages:** a summary line, a short body, then a blank line, `Closes #<n>`, then
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The deploy then closes the issue.
  Tick the item in the roadmap issue.
- **Before pushing:** `npm test` green, `npm run build` succeeds, a visual check in a
  browser (see below), and the docs updated (see "Keep the docs current"). Report anything you
  couldn't verify.
- Match the code style: plain ES modules, 2-space indent, single quotes, short comments that
  say *why*, no framework, no over-engineering.

## Code map

```
src/main.js            App shell: renderer, screens (title / builder / flight), Pip bubbles, stickers, journal, settings
src/progress.js        Goals, stickers, saved design + settings (incl. the 🧭 coach switch; localStorage)
src/physics/           Pure, headless, unit-tested; no three.js here
  orbit.js             Universal-variable Kepler propagation, orbital elements, conic geometry
  bodies.js            The solar system: circular on-rails orbits, SOIs, per-world surfaces
  terrain.js           Height + colour functions per world (shared by physics and meshes)
  sim.js               Flight: thrust, patched-conic stepping, SOI hand-offs, landing/crash, rewind
  predict.js           Multi-segment trajectory prediction (impact / escape / encounter)
  autopilot.js         Helpers (orbit, land, faster/slower, goto) + coach mode + transfer planner
  buggy.js             Buggy physics on the 3D globe (arcade car + real radial gravity, tree/rock bumps via ObstacleGrid)
src/world/             three.js visuals: planets, ambient (plumes/dust), trees, rocks (moon boulders), effects, sky, materials, thumbnails
src/rocket/            Parts catalogue + stats, procedural rocket and buggy meshes
src/scenes/            builder.js (workshop), flight.js (flight + map views), drive.js (buggy mode)
src/ui/                flightHud.js (controls, readouts, gestures, which helpers show, HUD layout check), narrator.js (Pip's voice), speech.js (sentence splitting),
                       zoom.js (pure zoom maths: real camera distances with fixed limits per mode, slider mapping)
src/audio/audio.js     All sound is generated live: music sequencer, SFX, voice channel + music ducking
public/voice/          Pip's recorded lines (one clip per sentence) + manifest.json
tools/voice/           Recording pipeline for Pip's voice (see below)
test/                  vitest suites; missions.js has the shared headless flights (autopilot, pretend kid, trips, tours)
tools/stress.mjs       Stress sweep for "take me there" (npm run stress), built on test/missions.js
```

## Invariants: don't break these

- **Flight happens in one plane (z = 0).** Rockets, planets and orbits are 2D (patched
  conics); the 3D is visual. Only the buggy uses full 3D, on the surface of one world, while the
  rocket stays parked on the plane.
- **Buggies can never reach orbit.** Speeds are capped below orbital speed so every jump
  comes back down. The one deliberate exception is the Nibble orbit secret (#5, `ORBIT` in
  `buggy.js`): only the Hopper on Nibble can super hop into orbit, and there speed is capped
  by energy so the orbit stays bound (highest point ≤ 2 × `ORBIT.maxA` = 100, SOI 170) and
  sags back down after a lap once the jets stop. Keep both caps if you touch buggy speeds.
- **The physics ground is the visible mesh.** Planet meshes come from `terrain.js`, then the
  physics surface is rebuilt from the mesh's z = 0 slice (`surfaceFromMesh`).
- **Floating origin.** Every frame the scene is positioned relative to the rocket, buggy or map
  focus. Never put raw world coordinates (up to ~40 km) into three.js positions.
- **Kid-first UX.** Everything must work without reading: icons, big buttons, Pip speaks.
  Failure is funny and cheap (rewind). Spoken lines are short and cheerful.
- **Phones first.** Watch draw calls and triangle counts (instancing, shared materials,
  no per-frame allocation in hot paths). Trees and rocks are one InstancedMesh (+ ink) per
  shape; the buggy finds nearby ones through a grid built once per world (`ObstacleGrid`),
  never by looping over all of them each step.
- **Zoom is in real distances with fixed limits** (`src/ui/zoom.js`, #18). Pinch, wheel and the
  slider all go through `FlightScene.viewDist()` / `setViewDist()`. The flight camera keeps a
  multiplier on the automatic follow distance but is clamped to [12, 15000] m; the map's range
  depends only on the focused world and the screen, never on `fitMap()`'s default view.
- **Helpers are closed-loop.** Autopilot and coach react to the real state each frame, so
  imperfect flying still works. In coach mode the player flies; Pip only does tiny nudges and
  safety takeovers (`ap.driving`).

## Verifying your work

- **Physics, autopilot and coach:** headless vitest missions in `test/physics.test.js`.
  `kidFlies()` simulates a late-reacting child (binary GO, 8-frame lag) following the coach
  cues. Any coach feature should have a test like it. `test/stress.test.js` replays a few trips
  that used to fail; after touching the planner or capture, run the full `npm run stress`
  (add `--verbose` to list failures, `--phases 24 --tours 60` for a bigger sweep).
- **Visual check:** run `npm run dev` and open it in a browser. `window.app` is the debug
  handle (`app.flightScene`, `app.builder`, `app.system`, `app.progress`).
  **Background tabs pause `requestAnimationFrame`**, so when driving the page from a script,
  step frames yourself:
  ```js
  const step = (n) => { for (let i = 0; i < n; i++) { app.last = performance.now() - 1000 / 60; app.frame(); } };
  document.getElementById('play-btn').click(); document.getElementById('launch-btn').click();
  app.flightScene.helper('orbit'); step(60 * 15);
  ```
  Useful: `app.flightScene.toggleMap()`, `.focusMapOn(app.system.byId.sizzle)`,
  `.setTarget(body)`, `.setCoaching(true)` (the 🧭 switch), `.helper('goto', { coach: true })`, `.drive.deploy()`,
  `app.newAdventure()`. Watch the console for shader errors.
- **HUD layout (#22):** at each screen size run `app.hud.layoutProblems()` in the console; it
  lists visible HUD controls that overlap, poke off screen, or are smaller than 56 px (helpers,
  steering, GO). Check 375×667, 390×844, 667×375, 844×390, 1024×768 and 768×1024 in flight, on
  the pad (🚙 with a garage), the map with the target card, the crash card and driving. The
  thumb row's sizes are CSS variables on `#flight-screen` (`--steer`, `--go`, `--tool`), so
  change sizes there and the helper row, target card and GO hint follow.
- After deploying, GitHub Pages can serve the old version for a few minutes; hard-refresh
  (or add `?v=2`).

## Pip's voice

Pip's lines are pre-recorded with **Orpheus TTS** (3B, run locally in llama.cpp), voice
**jess**, one clip per *sentence*. `src/ui/narrator.js` splits messages into sentences
(`src/ui/speech.js`) and plays the matching clips, falling back to browser speech for anything
unrecorded. **Adding or changing spoken text means recording new clips.**

```bash
# One-time setup (macOS, Apple Silicon)
brew install llama.cpp
mkdir -p ~/models/orpheus && curl -L -o ~/models/orpheus/orpheus-3b-0.1-ft-Q8_0.gguf \
  https://huggingface.co/unsloth/orpheus-3b-0.1-ft-GGUF/resolve/main/orpheus-3b-0.1-ft-Q8_0.gguf   # 3.5 GB
python3 -m venv tools/voice/.venv && tools/voice/.venv/bin/pip install snac numpy   # SNAC decoder downloads on first use

# Each time
llama-server -m ~/models/orpheus/orpheus-3b-0.1-ft-Q8_0.gguf -ngl 99 -c 8192 --port 8089
npm run voice:check                                         # lists missing sentences
tools/voice/.venv/bin/python tools/voice/record.py --voice jess   # records only what's missing
```

- Sampling uses the reference Orpheus settings (`REFERENCE` in `tools/voice/orpheus.py`:
  top-k 50, no min-p, long repeat window). They sounded clearly better than llama.cpp's defaults.
- `<gasp>` and `<chuckle>` tags are OK with jess but **use them sparingly** (the `PERFORMANCE`
  map in `record.py`). No `<laugh>`.
- Sentences come from scanning the source for spoken strings plus goals, stickers and world
  facts (`tools/voice/lines.mjs`); world names in templates are expanded. Keep spoken text
  in plain string literals so the scanner finds it.
- `tools/voice/lines.json` is generated (by `voice:check` / `voice:lines`) and **committed**:
  commit it whenever it changes, even if you can't record the new lines yourself. List the new
  sentences (and the issue they came from) in a comment on the rolling **Record Pip's pending
  voice lines** issue (#34), which always stays last on the roadmap, so the owner records them
  on the next local run.
- **Re-recording a bad take:** the seeds are fixed, so pick a new take:
  `record.py --voice jess --only "^Exact sentence start" --redo --take 1` (then 2, 3…).
  After a full run, very short or long takes are worth a listen: exclamations and lines with a
  gasp or chuckle are naturally slow; a long sentence said very fast may be clipped.
- A full `record.py` run also prunes clips for sentences that no longer exist.
- `tools/voice/compare.py` renders side-by-side takes for auditioning voices or settings.
- Generation runs at about a quarter of real time on an M4: roughly 10 s per sentence.

## Gotchas we've hit

- llama-server rejects `repeat_last_n: -1`; use a large number instead.
- Vitest will pick up tests inside `.claude/` worktrees unless excluded (it is, in `vite.config.js`).
- `MeshToonMaterial` ignores `flatShading` in this three.js version; build facets into geometry.
- Ink outlines (`withOutline` in `src/world/materials.js`) are an inverted hull pushed out along the
  geometry's `normal` attribute. Don't use `objectNormal` there: MeshBasicMaterial doesn't declare it,
  and the shader silently fails (all outlines vanished until this was fixed). Don't outline **open**
  shapes such as engine bells and nozzles; the hull shows through the opening as a black blob.
- Check the console for `Shader Error` after visual changes. three.js logs it once and carries on.
- Flying straight up gives a **degenerate conic** (p ≈ 0, e ≈ 1): anything built from p and e
  (`pointAt`, `radiusAt`, `timeToAp`) collapses to the planet's centre or is nonsense. The
  prediction is still right (it's an impact). `segmentPoints()` samples near-radial segments
  (`nearRadial()`: p < 0.1 × start radius) in time with `propagate()`, and the ▲ marker uses
  `radialApex()`. Use those rather than conic geometry for anything that can be vertical (#19).
- `src/style.css` has several `@media` blocks for small screens, and a plain rule further down
  the file beats an earlier media rule of the same specificity (the landscape `#vel-dial` fix
  silently did nothing for a while). HUD overrides for small screens go in the last section of
  the file.
- Headless Chromium (Playwright, SwiftShader WebGL) is too slow for the animation loop: call
  `app.renderer.setAnimationLoop(null)` and step frames yourself before taking screenshots. It
  can't decode the `.m4a` clips either, so `[pip] no recording for:` warnings there are expected.
- Line2 / LineMaterial widths are in pixels; update `resolution` on resize (flight.js does).
- Sprites and custom shaders need the logarithmic depth buffer chunks (see `atmosphere()` and
  `src/world/ambient.js` for examples).
