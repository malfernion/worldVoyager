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
npm test             # vitest: the starter journey's goals (+ older saves), physics, autopilot missions, coach flights (+ the 🧭 switch), buggy (+ driving round the world, its dust), discoveries, friends (+ the band's music), speech (+ the speech queue), markers, fast travel, zoom, audio unlock
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
src/progress.js        The starter journey's goals (`GOALS`, `starterDone`, `goalShown()`, older saves' `migrate()`; #36), stickers (incl. discoveries' facts and hints, friends' hellos and hints), saved design + settings (incl. the 🧭 coach switch),
                       which screen markers Pip has explained (#33), which worlds were driven round (#29; localStorage)
src/physics/           Pure, headless, unit-tested; no three.js here
  orbit.js             Universal-variable Kepler propagation, orbital elements, conic geometry
  bodies.js            The solar system: on-rails orbits (round, or Ducky the comet's Kepler ellipse), SOIs, per-world surfaces
  terrain.js           Height + colour functions per world (shared by physics and meshes), gas giants' spin axes, vents, geysers and the comet's gas jets,
                       and the ground discoveries shape (observatory hilltop, Nibble's giant crater, Frosty's glowing cracks)
  discoveries.js       Discoveries (#15): where each secret is, what finds it (buggy near/parked/at night, landing, dust devils,
                       the ring gap, flares), and the ✨ compass's targets
  friends.js           Pip's friends, the space band (#16): where each campfire is, saying hello (buggy near / landing next to),
                       the 🎵 compass targets, how loud each friend's part is from where you are, Full Band
  sim.js               Flight: thrust, patched-conic stepping, SOI hand-offs, landing/crash, rewind
  predict.js           Multi-segment trajectory prediction (impact / escape / encounter)
  autopilot.js         Helpers (orbit, land, goto) + coach mode + transfer planner (+ comet windows and homing)
  buggy.js             Buggy physics on the 3D globe (arcade car + real radial gravity, tree/rock bumps via ObstacleGrid, comet gas jets),
                       WorldLap: have we driven all the way round the world? (#29)
  dust.js              Buggy dust (#26): a fixed pool of particles in typed arrays (tyre dust, landing thumps, the Hopper's
                       jump bursts and jets) with real gravity, air drag and ground stops; emission rates; dust colour from terrain.js
src/world/             three.js visuals: planets (incl. rings), ambient (plumes/dust/dust devils/geysers/jets, comet tails), dust (draws the
                       buggy dust pool: two instanced billboard meshes), trees, rocks (moon boulders),
                       landmarks (the discoveries' observatory, flag, mirror, rover, lander, crack glows, Ember's flares; the friends' campfires
                       and the band round Homestead's fire), friendMesh (the friends: Pip-style critters with instruments), effects, sky, materials, thumbnails
src/rocket/            Parts catalogue + stats, procedural rocket and buggy meshes
src/scenes/            builder.js (workshop), flight.js (flight + map views), drive.js (buggy mode)
src/ui/                flightHud.js (controls, readouts, gestures, which helpers show, HUD layout check), narrator.js (Pip's voice), speech.js (sentence splitting),
                       speechQueue.js (pure: one line at a time, gap, priorities, stall timeout; #31),
                       markers.js (pure: what each screen marker means, when it's safe to pause and explain one, label decluttering; #33;
                       what each autopilot button says the first time it flies for us; #36),
                       fastTravel.js (pure: tapping the map's path for a ⏰, where it may go, the travel warp that lands on it; #27),
                       zoom.js (pure zoom maths: real camera distances with fixed limits per mode, slider mapping)
src/audio/audio.js     All sound is generated live: music sequencer (+ the friends' parts, #16), SFX, voice channel + music ducking
src/audio/unlock.js    The AudioContext's life on iPad/iPhone WebKit (#24): playback audio session, tap-to-resume,
                       silent unlock buffer, older-iOS silent <audio>, promise-safe decoding, debugState()
public/voice/          Pip's recorded lines (one clip per sentence) + manifest.json
tools/voice/           Recording pipeline for Pip's voice (see below)
test/                  vitest suites; missions.js has the shared headless flights (autopilot, pretend kid, trips, tours);
                       roundWorld.test.js drives real buggies round (and not round) the worlds (#29)
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
  Ducky's gas jets (#13, `JETS` in `buggy.js`) push buggies up, but only within a few metres
  of the ground, and the airborne cap (75% of circular speed) still applies, so they float
  back down.
- **The physics ground is the visible mesh.** Planet meshes come from `terrain.js`, then the
  physics surface is rebuilt from the mesh's z = 0 slice (`surfaceFromMesh`).
- **Floating origin.** Every frame the scene is positioned relative to the rocket, buggy or map
  focus. Never put raw world coordinates (up to ~65 km, out to Tumble) into three.js positions.
- **Orbits can go either way.** `Body.orbitDir` is -1 (clockwise) for almost everything and +1
  for Flip, Tumble's backwards moon (#11); `angularSpeed` carries the sign. Never assume
  clockwise: use `orbitDir` / `angularSpeed` (the planner's arrival direction, `flipOrbit`,
  `parkAt` in the missions all do). Moving a world further out than Tumble? Raise
  `SYSTEM_EXTENT` / `SYSTEM_VIEW` in `zoom.js` (a test checks them).
- **Orbits aren't always round.** Ducky the comet (#13) is on a Kepler ellipse (`Body.ecc`,
  `periArg`; `orbitRadius` is then the semi-major axis and `phase` the mean anomaly at t = 0).
  Ask a body where it is with `relPos` / `relVel` / `distAt` / `angleAt`, and for its range
  with `periapsis` / `apoapsis`; never use `orbitRadius` as a distance, or
  `phase + angularSpeed * t` as an angle (for the comet `angularSpeed` is only the average).
  The ellipse is solved with a few Newton steps on Kepler's equation, cached per time, since
  prediction asks a lot.
- **Kid-first UX.** Everything must work without reading: icons, big buttons, Pip speaks.
  Failure is funny and cheap (rewind). Spoken lines are short and cheerful.
- **Phones first.** Watch draw calls and triangle counts (instancing, shared materials,
  no per-frame allocation in hot paths). Trees and rocks are one InstancedMesh (+ ink) per
  shape; the buggy finds nearby ones through a grid built once per world (`ObstacleGrid`),
  never by looping over all of them each step. Every buggy particle effect (tyre dust, jumps,
  jets, landing, fizz) goes into the one fixed `DustPool` (#26, `src/physics/dust.js`): no
  per-particle objects or materials, two draw calls. Add new buggy effects there, not as
  sprites in the flight scene's `Particles`.
- **Zoom is in real distances with fixed limits** (`src/ui/zoom.js`, #18). Pinch, wheel and the
  slider all go through `FlightScene.viewDist()` / `setViewDist()`. The flight camera keeps a
  multiplier on the automatic follow distance but is clamped to [12, 15000] m; the map's range
  depends only on the focused world and the screen, never on `fitMap()`'s default view.
- **The sim never commits a broken state** (#30). `Flight.step()` checks every substep
  (finite numbers, coasting keeps its orbital energy, not absurdly far away). If Kepler
  propagation fails the check, that substep is integrated by hand (`leapfrog()`) so the rocket
  keeps flying; only if that fails too does it keep the last good state. It should never fire;
  if it does, fix the cause in `orbit.js`.
- **Discoveries live in one table** (#15, `DISCOVERIES` in `src/physics/discoveries.js`), keyed
  by the same ids as their stickers in `progress.js` (`find-…`: icon, name, `world`, the fact
  Pip says and the sticker book's `hint`). Landmarks sit on the `terrain.js` ground and keep
  clear of the strip in front of the flight plane (so they never hide the rocket); trees and
  rocks keep clear of them (as of vents and geysers). Solid ones go into the buggy's
  `ObstacleGrid`. Each world's still landmark parts are one merged vertex-coloured mesh (plus
  ink); only moving or glowing bits are separate. The ✨ compass takes a list of
  `{ id, p, icon }` targets (`discoveryTargets()`), so other kinds of target (#16) can join it.
  Discovery stickers are never goals: no checklist.
- **Pip's friends live in one table too** (#16, `FRIENDS` in `src/physics/friends.js`, stickers
  `friend-…` and `full-band` in `progress.js`). Campfires sit about 17 m in front of the flight
  plane (outside the rocks' strip, close enough to land next to), clear of discoveries, vents
  and craters; rocks keep 8 m clear. Each friend's music part has its own gain and low-pass
  (`FRIEND_PARTS` in `audio.js`) feeding the music bus, so the music switch and the voice
  ducking apply. How loud is decided only by the pure `friendLevels()` (tested), a few times a
  second (`App.updateBand`); the engine only glides (`setTargetAtTime`) when a level really
  changes and schedules no notes for silent parts. Friends' parts play **only chord tones** of
  the sequencer's current chord (a test checks), so any mix of them fits.
- **Goals are only the starter journey** (#36, `GOALS` in `progress.js`: space, orbit, land
  at home, Pebble, land on Pebble, `home-again`). `Progress.starterDone` is the one answer to
  "is the journey finished?"; after it `currentGoal` is null, there's no "Next: …" and no goal
  line on the pad, and what the goal chip / banner show comes only from `goalShown()`. Every
  other world's `visit-` / `land-` ids are plain stickers (same ids, so old saves keep them);
  don't add goals past `home-again`. Older saves go through `migrate()` on load.
- **Pip says one line at a time** (#31). Every spoken line goes through `App.pip(text, { pri, key })`
  and the speech queue (`src/ui/speechQueue.js`); never call `narrator.say()` directly, and never
  chain lines with `setTimeout` (that's what cut lines off). To do something after Pip's
  current lines (the next sticker), use `app.afterPip(fn)`. Give each new line a priority on
  purpose (see "Pip's voice").
- **Driving round the world counts net angle, never distance** (#29, `WorldLap` in `buggy.js`).
  It's the angle swept round three axes set where the lap starts, each dropped near its poles, and
  a lap must also cross that axis's equator and be at least `ROUND.far` of the way round in
  distance. So there-and-back and circles never add up, and any real loop round the world does.
  The Nibble orbit secret doesn't count (the lap starts again where the buggy comes down). The
  tests drive real buggies (straight, wobbly, there and back, circles, the orbit); keep them
  green if you touch buggy speeds or steering.
- **Screen markers explain themselves** (#33). Every marker a child can see over the view is made
  with `FlightScene.kindMarker(key, class, html, kind, x, y)`, with a line in `MARKER_LINES`
  (`src/ui/markers.js`): it's tappable (a 48 px hit area; HUD buttons sit above `#labels`, so
  markers never steal their taps) and glows while Pip explains it. Kinds in `FIRST_SIGHT` pause
  the sim once, the first time they're on screen, but only when `calmToExplain()` says so
  (Pip quiet, engine off, not steering, no helper burning or at a tricky bit, never in a coach
  lesson or coached landing, one explanation at a time). The pause only stops the sim and the
  helper stepping; it ends when the line has been said (`afterPip`), on any tap, or after
  `MAX_PAUSE`. Explained kinds are saved in `progress.markers`. Adding a marker kind? Add its
  line (and record it), and decide whether it belongs in `FIRST_SIGHT`. The autopilot buttons
  (🌀 🛬 and the map's 🤖 Take me there, #36) explain themselves the same way, once, when first
  used to fly for us (`BUTTON_LINES`, `buttonExplanation()`, saved as `button-<mode>` in
  `progress.markers`): `FlightScene.explainButton()` queues the line (a helper line, key
  `button`) just before the helper starts, so the helper flies at once and its own opener
  waits its turn behind it. Not in coach mode. Every button in the helper row that Pip flies is an
  autopilot action with the small 🤖 badge (class `auto`); the 🧭 switch and 🚙 Drive (the player
  drives) have none.
- **The game has one pause** (`FlightScene.pause`): `{ why: 'explain' }` for a marker (#33) or
  `{ why: 'arrived' }` when fast travel gets to its ⏰ (#27). It only stops the sim, the helper
  and prediction (`fly()`); any tap, steering or GO ends it. Don't add another pause flag.
- **Fast travel is the child's clock, never a helper's** (#27, `src/ui/fastTravel.js`). A ⏰ is
  just a game time on the path (`FlightScene.clock`); dropping it starts the trip, and it's
  gone when we get there, when it's tapped, on steering / GO / the time buttons / rewind / a
  crash, when a helper starts, and when the path no longer reaches it (`clockOnPath`: a crash
  now comes first, or we landed). Taps on the path are ignored while a helper is on
  (`clockAllowed`). The travel warp (`travelWarp`) steps down the warp levels as it gets close
  and the last frame steps exactly onto the time; the usual slow-down before a new world or the
  ground still applies on top.
- **Helpers are closed-loop.** Autopilot and coach react to the real state each frame, so
  imperfect flying still works. In coach mode the player flies; Pip only does tiny nudges and
  safety takeovers (`ap.driving`).

## Verifying your work

- **Physics, autopilot and coach:** headless vitest missions in `test/physics.test.js`.
  `test/fastTravel.test.js` taps the path of a real orbit through `FlightScene.tapMap`, travels
  with `fly()` and checks it pauses right on the ⏰'s time. `test/coachSwitch.test.js` flips the 🧭 switch in each context (idle, a helper or trip in
  each mode, the first-launch nudge) through the real `FlightScene` methods and a speech queue
  on a fake clock, and checks what Pip says and who ends up flying.
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
  Useful: `app.flightScene.toggleMap()`, `.tapMap(x, y)` (a tap on the map; `.screenAt(.segmentFrames(), t)`
  says where the path is at time t), `.focusMapOn(app.system.byId.sizzle)`,
  `.setTarget(body)`, `.setCoaching(true)` (the 🧭 switch), `.helper('goto', { coach: true })`, `.drive.deploy()`,
  `app.newAdventure()`. Watch the console for shader errors.
- **HUD layout (#22):** at each screen size run `app.hud.layoutProblems()` in the console; it
  lists visible HUD controls that overlap, poke off screen, or are smaller than 56 px (helpers,
  steering, GO). Check 375×667, 390×844, 667×375, 844×390, 1024×768 and 768×1024 in flight, on
  the pad (🚙 with a garage), the map with the target card, the crash card and driving. The
  thumb row's sizes are CSS variables on `#flight-screen` (`--steer`, `--go`, `--tool`), so
  change sizes there and the helper row, target card and GO hint follow.
- **Sound on iPad / iPhone (#24):** every iPad browser, Chrome included, is WebKit, and we
  can't emulate its audio rules here, so this needs the real device. On the iPad open the game
  with `?audiodebug` (e.g. `https://malfernion.github.io/worldVoyager/?audiodebug`): a small
  readout in the top-left shows `app.audio.debugState()`. Or, with a Mac: iPad Settings → (Apps →)
  Safari → Advanced → Web Inspector on (Chrome: Settings → Content Settings → Web Inspector),
  plug in, Mac Safari → Develop → *the iPad* → the page, and run `app.audio.debugState()` in
  the console. Check:
  1. Before any tap: `ctxState: 'none'`. On iPadOS 16.4+ `audioSession: 'playback'`,
     `sessionSet: true`; older: `audioSession: 'unsupported'`, `silentAudio: 'ready'`.
  2. Tap Play: music and Pip. `ctxState: 'running'`, `unlocked: true` (older iOS:
     `silentAudio: 'playing'`), `lastError: null`.
  3. **Silent mode on** (Control Centre bell, or the switch on older devices): still sound.
  4. **Switch apps and come back** (and try a Siri request or a call): the readout may show
     `suspended` / `interrupted`; one tap anywhere must bring the sound back (`resumes` goes up).
     Nothing should keep playing, or show a player on the lock screen, while the game is hidden.
  5. Fly and land: sound effects, rocket rumble, and Pip's recorded voice (not the robot
     fallback voice).
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

- **The speech queue** (#31, `src/ui/speechQueue.js`, pure and tested; `App.pip` in `main.js`
  drives it, the bubble shows the line being said). One line at a time; the next starts
  `GAP` (0.4 s) after the last ends. Priorities (`pri`):
  - `urgent`: crash, safety takeovers (too fast, too low). Cuts in and drops the queue.
  - `cue`: the coach's in-flight HOLD / LET GO / turn / tiny-push lines (`CUE` in
    `autopilot.js`), the first-flight "Blast off" (only when you fly it; with Pip flying it waits its turn, #36), the super hop. Jumps the queue and cuts the
    current line off, unless it ends within `CUE_WAIT` (2 s). Stale after 3 s.
  - `normal` (default): waits its turn. Stale after 30 s (stickers 60 s).
  - `chatter`: only if Pip is free, else dropped and `pip()` returns false (idle hints, the
    compass hints, bonk, "We're at…"). Once-only hints set their flag from that return value.
  - The 🧭 switch's line (#32, `FlightScene.setCoaching`) is a `cue` with key `coach-switch`,
    so it answers the tap at once and a newer flip replaces it. Helper lines are pushed with
    `from: 'helper'`; handing a helper over calls `app.speech.drop()` on them, so nothing the
    old pilot was told is said afterwards. The restarted helper gets `{ handover: true }` and
    skips its opener.
  A `key` groups lines of one kind (`coach`, `goal`, `target`, `build`, `journal`…): a new one
  replaces a waiting one, and a newer `cue` cuts off a playing one of the same key. The first
  step of a coach lesson (the rocket waits for the player) is `normal` with key `coach`
  (`COACH`), so it doesn't cut off a sticker line but is dropped if a cue overtakes it. At most
  `CAP` (3) lines wait; the least important, oldest go first, and sticker lines (`keep`) last of all. With the voice off (or no sound
  yet, or speech failing) a line is paced by `estimateDuration()` (fitted to the clips); a line
  that never ends is given up after `stallTimeout()`. Music stays ducked across the gap.
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
- `propagate()`'s hyperbolic starting guess (a log formula meant for long hops) comes out with
  the **wrong sign for short steps** on near-radial escape paths, e.g. blasting straight up off
  tiny Nibble faster than its escape speed. The unguarded solver then ran off to a huge chi where
  sinh/cosh explode: the rocket landed at ~1e33 km (#30). The iteration now keeps the root
  bracketed (F rises with chi, F(0) = -sqrt(mu)·dt) and bisects when a step leaves the bracket.
- `src/style.css` has several `@media` blocks for small screens, and a plain rule further down
  the file beats an earlier media rule of the same specificity (the landscape `#vel-dial` fix
  silently did nothing for a while). HUD overrides for small screens go in the last section of
  the file.
- Headless Chromium (Playwright, SwiftShader WebGL) is too slow for the animation loop: call
  `app.renderer.setAnimationLoop(null)` and step frames yourself before taking screenshots. It
  can't decode the `.m4a` clips either, so `[pip] no recording for:` warnings there are expected.
- Line2 / LineMaterial widths are in pixels; update `resolution` on resize (flight.js does).
- **Leaving a world's SOI, patched conics keep the speed at the SOI edge**, not the speed
  "at infinity". Tumble is big with a small SOI, so a burn sized for the speed at infinity left
  far too fast (backwards round Ember). `escapeBurn()` in `autopilot.js` sizes the first guess
  for the edge (#11).
- **Tiny SOIs far from the middle get stepped over.** Prediction steps are about 2% of the
  distance from the body we're in, so in Ember's space a step is hundreds of metres, more than
  the comet's whole SOI (220). `trace()` in `predict.js` shortens steps near "small" worlds
  (SOI < 5% of their closest distance: only the comet). And aiming a whole trip at such a
  small, fast target is hopeless (a 0.1 m/s error misses by kilometres), so the planner only
  aims to pass within `CATCH_RANGE`, then `catchComet()` homes in closed-loop (#13).
- The Orbit helper's "going round" burn pushes sideways against gravity; on the comet (gravity
  under 1 m/s²) it ran away and flung the rocket out, so on a comet `catchComet()` does that
  part too.
- **iPad/iPhone audio (#24).** All iPad browsers are WebKit. It mutes Web Audio in silent mode
  unless we ask for `navigator.audioSession.type = 'playback'` (iOS 16.4+; older iOS: a looping
  silent `<audio>`, only started there), and it only starts or resumes a context inside a
  tap, and a touch `pointerdown` doesn't count (use `touchend` / `pointerup` / `click`). A
  context can also go `interrupted` (calls, Siri). So `AudioEngine.listen()` resumes on every
  tap anywhere (`AudioUnlock.gesture()`, cheap once running), not only on some buttons, and
  resuming from `visibilitychange` alone isn't enough. Decode clips with `decodeAudio()`: older
  WebKit only has the callback form of `decodeAudioData`. Headless Chromium can't check any
  of this; see "Sound on iPad / iPhone" above.
- **Headless screenshots time out after many stepped frames**: SwiftShader seems to queue every
  frame's GL work until the screenshot. Stub `app.renderer.render = () => {}` while stepping and
  put it back just before the shot (#33).
- **Screen markers: don't animate `scale` on the marker itself.** Markers are placed with
  `transform: translate(...)`, and CSS applies the `scale` property on top of that, so a
  bobbing marker drifted away from its spot by up to 30% of its screen position (the 🚀 pin
  did, #15). Wrap the content in a `<span>` and animate that.
- **Friends' campfire glow in daylight:** an additive glow sprite is nearly invisible on a bright
  day-side surface at low opacity; the orbit glow needs ~0.7 opacity and a deep orange to show.
- **Browser speech doesn't always say it's finished**: Chrome sometimes never fires `onend`
  (or `onerror`), and before the first tap it fails at once. `Narrator.speakFallback()` gives up
  after `stallTimeout()`, and the speech queue has its own watchdog, so Pip never goes quiet
  for good (#31).
- Sprites and custom shaders need the logarithmic depth buffer chunks (see `atmosphere()` and
  `src/world/ambient.js` for examples).
