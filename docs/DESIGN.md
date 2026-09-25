# World Voyager — design notes

A mobile-first, five-year-old-friendly take on the core Kerbal Space Program loop, dressed in
Outer Wilds' campfire-and-cosmos mood.

## Research: what we're borrowing

**Kerbal Space Program: the core loop.** Build a rocket from parts → launch → gravity turn →
circularise into orbit → plan a transfer (Hohmann burn at the right *phase angle*) → coast →
capture burn at periapsis → deorbit → suicide-burn landing. KSP simulates this with *patched
conics*: only one body pulls on you at a time, and you switch bodies at the edge of each
"sphere of influence" (SOI). The map shows your predicted conic, apoapsis/periapsis, future SOI
patches and a "ghost" of the moon where you'll meet it. We keep all of that. Paths are drawn
from the conic's geometry, except near-vertical ones (a squashed conic whose geometry
degenerates to the planet's centre), which are sampled in time instead: a kid sees the
straight up-and-down line, ▲ at the top and 💥 at the bottom, from the moment of liftoff.

**What KSP makes hard, and we drop:** fuel and staging (every rocket has endless fuel), structural
wobble, aerodynamics and heat, maneuver-node editing, inclination (everything is in one
plane, so no plane changes).

**Outer Wilds: the mood.** Tiny, hand-made worlds you can take in at a glance (Timber Hearth is
roughly 250 m across). Wooden, home-made rockets. A campfire village as home. Warm dusk light
against deep space. A banjo/acoustic score that feels lonely and hopeful at the same time. We
borrow the vibe, not the content: all names, worlds and music are original.

**Real worlds as inspiration** (each world's journal entry teaches the real fact):
| Game world | Inspired by | Kid fact |
|---|---|---|
| Homestead | Earth | home, oceans, campfire |
| Pebble | the Moon | craters, astronauts walked there |
| Dusty | Mars | red rust, biggest volcano |
| Nibble | Phobos | a potato-shaped moon |
| Ringo | Saturn | rings of ice; light enough to float |
| Sizzle | Io | the most volcanic place in the solar system |
| Frosty | Europa | a hidden ocean under the ice |

## Design pillars

1. **Real physics, kid-sized.** Orbits are computed exactly: Kepler motion via universal
   variables, with SOI hand-offs. Distances are compressed (Homestead has a 300 m radius, low
   orbit takes about 45 s, a trip to Ringo about 20 minutes of game time) and time warp covers
   the waits.
2. **You fly it; Pip helps as much as you want.** There are three levels of help:
   - *Manual:* ⟲ ⟳ to aim, hold **GO** to burn, map, time warp, rewind.
   Coach or autopilot is one remembered choice, the 🧭 switch on the flight HUD
   (`settings.coach`), and it applies to every helper: 🌀 Orbit, 🛬 Land and the target card's
   single trip button ("🧭 Let's go!" / "🤖 Take me there!"). One switch instead of a second
   button on every helper keeps the choice in one place a 5-year-old can see (bright with a
   green light = Pip coaches, dim = Pip flies), and helpers behave the same way every time.
   Flipping it mid-helper restarts that helper in the other mode (they're closed-loop, so they
   carry on from wherever the rocket is). ⏫ Faster / ⏬ Slower are hold-to-burn and always
   fly for you. Pip offers the coach once, on the very first launch, with the switch glowing;
   saying yes starts a coached launch to orbit.
   - *Coach*: Pip plans the climb, the transfer, then the landing, and tells you what to do. An arrow shows
     where to point, the right turn button glows, and GO says **HOLD!** / **LET GO!**. You do the
     launch, gravity turn, transfer burn, capture brake and landing. The coached landing is: point
     up at the arrow, then HOLD / LET GO to keep the descent gentle (with hysteresis so cues don't
     flicker, and a short look-ahead for reaction time). Pip does only the tiny correction nudges,
     the last little bit of going round and of a capture brake (a late LET GO on a tiny moon is
     enough to fall out of orbit or fly off), dropping from a high or moon-crossing orbit to a cosy one, emergency
     ground-avoidance, and takes over a landing that would be too fast.
   - *Autopilot* (coach off): Pip flies Orbit, Land and trips; watch and learn.
   Helpers run closed-loop on the real state, so imperfect flying still works out.
3. **Failure is funny and cheap.** Crashes are cartoon explosions with bouncing parts. **↺ Rewind**
   goes back 5 seconds, or you can go back to the pad or the workshop.
4. **Readable without reading.** Emoji icons, a height meter with a space line, a spoken narrator
   (speech synthesis, can be turned off), and stickers.

## Structure

```
src/physics/   pure, headless, unit-tested
  orbit.js       universal-variable propagation, elements, conic geometry
  bodies.js      the solar system (circular on-rails orbits, SOIs, surfaces)
  terrain.js     terrain height + colour functions shared by physics and meshes
  sim.js         Flight: thrust, patched-conic stepping, landing/crash, rewind snapshots
  predict.js     multi-patch trajectory prediction (impact / escape / encounter)
  autopilot.js   helpers: orbit, land, faster/slower, goto (planner + coach mode)
src/world/     three.js visuals: planets, rings, atmospheres, sky, effects, thumbnails
src/rocket/    parts catalogue + stats, procedural rocket meshes
src/scenes/    builder (drag & drop workshop) and flight (flight cam + map)
src/ui/        flight HUD & gestures, narrator
src/audio/     procedural campfire music + sound effects (WebAudio, no asset files)
```

Key techniques:
- **Floating origin.** Every frame the world is drawn relative to the rocket (or the map focus),
  so float32 precision holds from 1 m to 40 km.
- **Physics surface = visible mesh.** After meshing a planet we slice the mesh at z = 0 and use
  that exact outline as the ground, so legs touch what you see.
- **Transfer planner.** For each leg (up to a parent, across to a sibling, or down to a moon) it
  estimates a Hohmann window, then grid-searches burn time × burn size with the real predictor,
  refines, and scores arrivals. Low periapsis, arriving past periapsis, hitting a moon first, going
  the wrong way round and parking inside a moon's path all score worse; meeting a moon (or the
  ground) before the brake at the low point scores much worse. Course corrections happen en route.
- **Staying out of moons' way** (#10). Only burns that happen before the current orbit drifts into
  a moon are considered (after an "up" hop we still share the moon's path). A push that fell
  short (a coached player letting go early) gets a small top-up, or a fresh plan, instead of a
  loop that meets a moon. Paths are judged only once the engine has been off for a moment. While
  waiting to brake inside the new world, Pip keeps checking for a moon in the way and steers
  round it. Braking aims at a round orbit's velocity (never a dead stop), and an arrival orbit
  that crosses a moon's path is lowered before we wait there or call it done (straight away if
  we've just climbed out of that moon). Planning waits for a coached player's late LET GO.
  `npm run stress` flies every pair of worlds at several start times, plus long tours from the
  pad, with the autopilot and the pretend kid, and counts each kind of failure.
- **Music.** Karplus–Strong banjo and guitar, a reedy harmonica, saw-pad strings and a triangle
  bass, played by a generative sequencer with a lazy swing. Three moods (campfire, space,
  discovery) crossfade at bar lines.

## Breakdown (as built)

1. Orbital core + tests (RK4 cross-check, apsis timing) ✅
2. Flight sim: thrust, SOI, landing/crash, rewind ✅
3. Predictor + map rendering: patched segments, ghosts, ▲▼ markers, 💥 impact ✅
4. Helpers: orbit, land, faster/slower, goto; mission tests from pad to every world ✅
5. Coach mode, tested with a simulated player who reacts late ✅
6. Worlds: terrain, launch village, rings, atmospheres, sky ✅
7. Workshop: drag/tap to add, drag off to remove, tap to paint, live stats ✅
8. HUD, gestures, keyboard, stickers, sticker book, narrator, settings ✅
9. Procedural music + SFX ✅
10. GitHub Pages CI ✅

**Camera zoom (#18).** Zoom used to be a multiplier on automatic distances, so the closest you
could get drifted with altitude and with each map re-fit, and far out in space you couldn't
see the rocket any more. Now every mode zooms in real distances with fixed limits: the flight
camera still follows further back as you climb (a multiplier on the automatic distance), but
the result is clamped to 12 m–15 km, so a child can always pinch right back to the rocket. The
map goes from about 3× the focused world's radius out to the whole solar system; re-fitting
picks a new default view inside that range without changing it.

## Buggies

A **Garage** section holds one buggy. You choose its type and colour in the workshop:
Rover (easy), Monster Truck (big bouncy wheels, climbs), or Hopper (light, can jump).
After landing on solid ground, 🚙 Drive rolls it down a ramp.

- **Driving is fully 3D over the globe** (`src/physics/buggy.js`). It's arcade car physics:
  real radial gravity, ground normals taken from the same terrain functions as the planet
  mesh, tyre grip (less on icy Frosty), slower in Homestead's water, and bumping around the
  parked rocket. Low-gravity moons get "sticky tyres" near the ground so crests don't fling you.
- **Trees and rocks are things to bump into** (#6). Homestead's ~900 trees and the moons'
  boulders (`src/world/rocks.js`: Pebble 50, Nibble 24, Dusty 110, Sizzle 70, Frosty 80, one
  InstancedMesh + ink outline per world, so 2 draw calls each, in each world's colours) are
  circle colliders: trunk (or most of a bush's / rock's width) plus the buggy's `reach` from
  `BUGGIES`. Rocks keep a narrower strip in front of the flight plane clear than trees do
  (z from -4 to 16 m, as they're low), and stay off Sizzle's vents and Dusty's caldera.
  - The drive scene turns the visuals' lists into plain `{ p, up, r, h }` data and builds an
    `ObstacleGrid` once per world: a coarse 3D grid (cells as big as the tallest reach), so
    each physics substep looks at the 27 cells around the buggy, typically a handful.
  - The bump is friendly: only the push-in part of the velocity is removed (a little bounce
    above 3 m/s), so reversing or steering away always works. A glancing hit turns the buggy
    to slide along past (faster the more glancing); head-on it stops, and if you keep pushing
    it slowly slides off to one side. Clear the top with your wheels (Hopper jumps, flying off
    crests) and you pass over. The scene plays a soft "bonk" (plus a leafy rustle for trees),
    a gentle camera wobble, and leaves fluttering down or a puff of dust, at most every half
    second; the first bump each session Pip says "Bonk! Back up and steer around it."
- **Never orbit.** Top speed is capped at 70% of the world's orbit speed, and airborne
  speed at 75% of local circular speed, so every jump comes back down. The rocket stays
  parked on its flight plane the whole time, so driving never disturbs the flight model.
- **The one secret exception: orbiting Nibble in the Hopper** (#5, made easier in #20;
  `ORBIT` in `buggy.js`). Nibble is so tiny (radius 30, gravity 0.9) that circular speed is
  only about 5 m/s. On Nibble, a jump (a tap *or* a held jump) while the Hopper is going at
  75% or more of top speed (about 2.7 of 3.6 m/s) is a *super hop*: it leaps forward at 75%
  of local circular speed, level with the horizon, plus 1.5 m/s off the ground (on its own
  that's a big 15-30 s hop that comes back down).
  - **Jets: hold jump.** While jump is held in the air (or for 0.6 s after each tap) the jets
    fire a gentle trim (at most 0.6 m/s²) towards a round orbit at r = 46, just above Nibble's
    highest lumps (about 44): circular speed sideways, climbing or sinking at most 1.5 m/s.
    So the kid doesn't need to aim: holding jump for about 15 s, or about 20 taps at one a
    second, sets up an orbit that then coasts the rest of the way round (it took about 64
    steady taps before #20). Holding reverse in the air fires the jets backwards (2.5 m/s²)
    to come down.
  - **Hints and feedback.** Driving the Hopper on Nibble, Pip whispers "Psst! Drive really
    fast, then jump and hold it!" after 6 s (once a session, until the sticker is earned);
    after the first super hop she says to keep holding jump. While super hopping, a ring
    next to the rocket compass fills as you go round, and Pip cheers at halfway. A full lap
    without touching the ground earns the 🛰️ Moon Orbiter sticker, with Pip explaining that
    going sideways fast enough means you keep falling around the moon. (The sticker book
    has no hints, so the whisper is the hint.)
  - **Always bound.** While super hopping, speed is capped by energy rather than a fixed
    fraction: the orbit's semi-major axis can never exceed `maxA` = 50, so the highest point
    is at most 2 × 50 = 100, far inside Nibble's SOI (170); escape would need infinite `a`.
    That caps speed at 6.2 m/s at the surface (escape is 7.3). Holding jump keeps the orbit
    within about r = 48; eager tapping stays below about 52.
  - **Always comes back.** After one full lap, with the jets off, the orbit slowly sags
    (1%/s), so it lands about half a minute later unless the kid keeps the jets going.
    🏠 works from orbit too.
  - **A lap takes about 62-72 s** from the super hop. That's real physics: a circular orbit
    at r = 46 around Nibble takes 2π√(46³/810) ≈ 70 s (it was about 75 s from higher up).
    A 45-55 s lap would need r ≈ 37-41, below the highest lumps, or flying faster than a
    real orbit. The chase camera pulls back while orbiting and keeps "up" pointing away from
    Nibble's centre.
  - The low orbit often passes right over the parked rocket (kids drive straight out of the
    garage), so the rocket collider knows its real height (`top`) and only bonks an orbit
    that actually passes below its nose (it used to stretch 12 m up).
  - Only the Hopper (`superHop` in `BUGGIES`) on Nibble can do it; every other buggy and
    world keeps the caps.
- **Getting home.** 🏠 drives back into the garage when close, or whisks you back with
  sparkles when far. A HUD compass always points to the rocket.

## Ideas for later

Tracked as [GitHub Issues](https://github.com/malfernion/worldVoyager/issues).
