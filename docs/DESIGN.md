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
| Tumble | Uranus (and Neptune) | an ice giant tipped on its side, rolling round the Sun |
| Flip | Triton | a moon that goes round backwards; icy geysers |
| Ducky | comet 67P (where Philae landed) | a rubber-duck comet whose tail always points away from the Sun |

## Design pillars

1. **Real physics, kid-sized.** Orbits are computed exactly: Kepler motion via universal
   variables, with SOI hand-offs. Distances are compressed (Homestead has a 300 m radius, low
   orbit takes about 45 s, a trip to Ringo about 20 minutes of game time, to Tumble about half an hour) and time warp covers
   the waits. The Kepler solver keeps its root bracketed so it can't run away, and each flight
   substep is checked (finite, energy kept while coasting) before it is committed; a bad one
   is redone with a small hand integrator, or else falls back to the last good state, rather
   than flinging the rocket off (#30).
2. **You fly it; Pip helps when you ask** (#36). The player flies. Pip only flies when asked,
   and coaching helps a child get started and helps when they ask; it isn't a mode that stays
   on, and it never guesses when to switch on or step in.
   - *Manual:* ⟲ ⟳ to aim, hold **GO** to burn, map, time warp, rewind.
   - *Autopilot* (🤖, "Pip, do this for me"): 🌀 Orbit, 🛬 Land and the map card's 🤖 Take me
     there. They always fly, whether or not coaching is on, and wear a small 🤖 on their corner
     (🚙 Drive has none: the player drives the buggy). The hold-to-burn speed buttons were
     dropped, since the player flies. The status chip at the top shows 🤖 while Pip flies.
   - *Coach* (🧭, "tell me what to do"): Pip plans the climb, the transfer and the landing and
     says what to do; the player flies. An arrow shows where to point, the right turn button
     glows, and GO says **HOLD!** / **LET GO!**. The player does the launch, gravity turn,
     transfer burn, capture brake and landing. The coached landing is: point up at the arrow,
     then HOLD / LET GO to keep the descent gentle (with hysteresis so cues don't flicker, and a
     short look-ahead for reaction time). Pip does only the tiny correction nudges, the last
     little bit of going round and of a capture brake (a late LET GO on a tiny moon is enough to
     fall out of orbit or fly off), dropping from a high or moon-crossing orbit to a cosy one,
     the comet catch, emergency ground-avoidance, and takes over a landing that would be too
     fast ("Whoa, too fast! I'll catch us this time."). The status chip shows 🧭.
   Coaching and the autopilot are separate things that run the same closed-loop programs
   (`autopilot.js`, `coach: true` or not), so imperfect flying still works out. How coaching
   starts depends on where the child is:
   - *During the starter journey*, the 🧭 in the helper row is an on/off toggle
     (`settings.coach`, remembered): green, pushed in, with a glowing green light when on; grey
     with the light off when off (green rather than the yellow of a running helper, so it never
     looks busy). While it's on, Pip coaches each starter step as it comes: the launch into
     orbit (on the pad it starts at once, waiting for the child's GO), the landing at home (from
     the pad, after a crash: up, round and down), the landing on Pebble (once round Pebble), and
     the flight home. **Flying to Pebble isn't coached by the toggle**: it's the map's choice, so
     the journey teaches the choice used for the rest of the game (tapping the toggle on then,
     Pip adds "Open the map and tap Pebble."). On: "Okay! I'll tell you what to do while you
     fly." Off: "Okay! I'll stop telling you what to do. You're the pilot!", and coaching stops
     wherever it is, even before lift-off; the rocket carries on under the child's control and
     the autopilot never takes over. Both lines are a cue keyed `coach-switch`, so they answer
     the tap at once and a newer one replaces an older one.
   - *On the very first launch* Pip explains the choice once, after the first goal: "You're the
     pilot! Want me to tell you what to do? Tap the compass. Or tap the swirly button, and I'll
     fly us round for you!" (`FIRST_FLIGHT`, `Progress.launchLine()`), with the 🧭 glowing.
   - *Every trip* (and, after the journey, the only way in): the map card offers **🤖 Take me
     there** and **🧭 Show me how**. Show me how coaches the whole action: from a pad, take-off,
     getting into orbit, the trip and the landing; from orbit, the trip and the landing. Picking
     the world you're flying round means landing on it (🤖 lands with the autopilot, 🧭 coaches
     you down); on its ground, or round a gas giant, there's nothing to do there, so it isn't
     picked and Pip says "We're at …!". During the journey Show me how also turns the toggle
     on (the child asked to be coached), and it stays on after arriving. After the journey, while
     Show me how coaches, the 🧭 shows lit in the helper row and the goal banner shows where
     we're going ("🧭 Fly to Dusty and land!", from `goalShown()`). Tapping the lit 🧭 dismisses
     the coach for good ("Okay! I'll stop telling you what to do. You're the pilot!"); the world
     stays picked, so the child flies there alone, and only a new Show me how coaches again.
     Landing there ends it by itself ("You landed all by yourself! Great flying!"), and the 🧭
     and the banner go. A crash or rewind doesn't end it (it picks up again from where the
     rocket is, launch pad included); going back to the workshop does.
   - *Autopilot during coaching:* tapping 🌀 or 🛬 makes coaching go quiet (no cues, arrow or
     glow) while Pip flies, then it picks up again, towards the same place, without its opener.
     🤖 Take me there ends a Show me how: Pip is taking us there now. Driving the buggy is quiet
     too.
   - *In orbit with nothing picked* (and the toggle off, or after the journey), the coach does
     nothing: it never starts by itself.
   How: `FlightScene.coachWant()` says what to coach now (a Show me how, else the toggle's
   starter step), and `updateCoaching()` starts it every frame there's nothing flying, so a
   quieted action simply starts again (`resume`, no opener) when the autopilot is done. An action
   that ended by itself isn't restarted until something changes (`coachSpent`). Asked for (the
   toggle turned on, Show me how) it starts at once on the ground, where the rocket waits for
   GO anyway, and in flight once Pip has said "Okay!", so its first cue doesn't cut that off.
   The next starter step, starting by itself, waits for Pip to finish what she's saying (the
   sticker, "Next: …", "You landed all by yourself!"), up to 20 s. This replaced #32's single switch that turned every helper into a lesson and
   handed a running helper over when flipped: a child couldn't ask Pip to fly one thing while
   being coached on another, and "who flies" changed under them.
3. **Failure is funny and cheap.** Crashes are cartoon explosions with bouncing parts. **↺ Rewind**
   goes back 5 seconds, or you can go back to the pad or the workshop.
4. **Readable without reading.** Emoji icons, a height meter with a space line, a spoken narrator
   (recorded lines, browser speech for the rest, can be turned off), and stickers.
   Pip says **one line at a time** (#31): a new line waits for the current one to finish, then
   a short pause, so a child hears every sentence to the end. Only what can't wait cuts in:
   a crash or safety takeover, and the coach's HOLD / LET GO cues (a newer cue replaces an
   older one). Idle hints are dropped if Pip is busy, and the queue stays short, so Pip never
   reads out a backlog of old news. Stickers pop up when Pip gets to them.

5. **Every icon explains itself** (#33). The map's markers each mean one thing: the path line
   (where we'll go), ▲ highest, ▼ lowest, 💥 where we'd crash, ✨ where we'll meet the world we
   picked (over its ghost), 🎯 closest we'll get to it, 🔥 where Pip plans to fire the engine,
   and the orange arrow for the rocket (also in flight when the rocket is too small to see).
   The first time a kind shows, the game pauses gently: the marker glows (and the map glides it
   out from under Pip's bubble), Pip says one short line, and play carries on by itself when
   she's done, or at any tap. Only when nothing urgent is happening: never over a coach cue, a
   safety takeover, a burn, a coached launch or a coached landing; otherwise it waits. Each kind
   is explained once (saved); after that, tapping a marker says it again, without pausing.
   The autopilot buttons explain themselves once too (#36), the first time Pip flies one for
   you: "This button flies us all the way round the planet!" (🌀), "This button lands us nice
   and softly!" (🛬), "This button flies us all the way there!" (🤖 Take me there). No pause:
   the helper starts flying at once and its own first line follows the explanation. Not when the
   helper is only going to say no (🛬 over a gas giant), nor for 🤖 on the world we're at (it
   lands; it explains itself on a real trip).
   ▲ ▼ are only drawn where we are now and at the world we picked (one pair per path piece made
   a trip a clutter of triangles). The coach's arrow isn't tappable or explained this way: the
   coach's own cues already say "follow the arrow". World labels on the map keep out of each
   other's way: in order of importance (the picked world, where we are, the map's focus,
   planets and Ducky, Ember, then moons) each is shown in full if it fits, else as just its
   icon, else hidden until you zoom in.

6. **Fast travel to a moment on the path** (#27). On the map, tapping the path drops a ⏰
   there, and time zooms along at once until the rocket gets there; then the game pauses
   ("We're here! Take your time.") until any tap, turn or GO. Dropping it *is* starting it: one
   tap, one thing happens, so a child doesn't have to learn a second step (tap the ⏰ to go)
   before anything moves. Tapping the ⏰ takes it away, and its line (said the first time it's
   dropped, while the map glides it into view) says so: "Tap it to stop." A later tap on the path
   moves it. Steering, GO, the time buttons, rewind and crashing all stop the trip too: the
   child took over.
   - *Where it may go:* anywhere on the drawn path from a moment ahead of the rocket to its end,
     but not in the last 3 s before a crash. The tap is hit-tested on screen (within 28 px, and a
     finger that moved more than 10 px was panning, not tapping) against the path sampled in
     time, then refined along the true curve. Where the path crosses itself, the nearer bit wins,
     then the sooner. On a round orbit, a tap by the rocket means once round.
   - *How fast:* the biggest warp level that still leaves 0.3 s of real time to go, so it
     steps down 1000, 300, 100… as the ⏰ comes near, and the last frame steps exactly onto the
     moment (a test checks it lands within 0.1 ms of game time). The usual slow-down before a
     new world or the ground still applies.
   - *When the path changes:* the ⏰ keeps its time, so it slides along with the path. If the
     path no longer gets there (a crash now comes first, or we've landed), it goes and time
     drops to normal, so we never warp into the ground.
   - *Helpers:* they run the clock themselves, so while one is flying (or coaching), tapping the
     path does nothing, and starting one takes the ⏰ away. Simplest, and it keeps "who's in
     charge of time" clear.
   - The pause is the same one Pip uses to explain a marker (`FlightScene.pause`), just without
     the time limit.

## Structure

```
src/physics/   pure, headless, unit-tested
  orbit.js       universal-variable propagation, elements, conic geometry
  bodies.js      the solar system (on-rails orbits, round or stretched, SOIs, surfaces)
  terrain.js     terrain height + colour functions shared by physics and meshes
  sim.js         Flight: thrust, patched-conic stepping, landing/crash, rewind snapshots
  predict.js     multi-patch trajectory prediction (impact / escape / encounter)
  autopilot.js   helpers: orbit, land, goto (planner + coach mode)
src/world/     three.js visuals: planets, rings, atmospheres, sky, effects, thumbnails
src/rocket/    parts catalogue + stats, procedural rocket meshes
src/scenes/    builder (drag & drop workshop) and flight (flight cam + map)
src/ui/        flight HUD & gestures, narrator + its speech queue
src/audio/     procedural campfire music + sound effects (WebAudio, no asset files), and the
               iPad/iPhone unlock (first tap anywhere starts the sound, later taps resume it)
```

Key techniques:
- **Floating origin.** Every frame the world is drawn relative to the rocket (or the map focus),
  so float32 precision holds from 1 m to the ~65 km out to Tumble.
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
- **Leaving a big world.** The first guess for a trip's burn aims for the speed we'll have at the
  *edge* of the world's SOI (patched conics keep that speed), not the speed "infinitely far
  away", with at least a brisk exit (`escapeBurn()`). Aiming for the far-away speed was fine for
  small worlds but flung us out of big Tumble backwards round Ember, to meet Dusty head-on at
  150 m/s (#11). (Also counting the slow climb out to the edge in the Hohmann window looked
  right but made the search miss good paths from Homestead, so it isn't.) With Flip, the
  longest route is up, across and down, so a trip gets 12 tries at a leg instead of 8.
  Turning an orbit round (`flipOrbit`) leans up against gravity, since halfway through we're
  hardly going round at all.
- **Tumble and Flip (#11): the backwards moon.** Every body has an orbit direction
  (`Body.orbitDir`: -1 clockwise, +1 for Flip, like Triton). `angularSpeed` carries the sign,
  so positions, velocities, SOI hand-offs, prediction and the Hohmann phase maths all follow.
  The planner prefers arriving at a world going the way its moons go, so trips to Tumble end
  up going round it backwards; if we're going the wrong way before dropping to a moon, Pip
  turns the orbit round (`flipOrbit`). Tumble is tipped on its side like Uranus only in the
  visuals (its stripes, faint rings and spin share a sideways axis, `TUMBLE_AXIS`); the flight
  stays in the plane. Flip's frosty geysers use the same clock-driven instanced billboards as
  Sizzle's plumes (`src/world/ambient.js`), blowing downwind over dark streaks painted on the
  ice (`FLIP_GEYSERS` in `terrain.js`).
- **Ducky, the comet (#13).** The one world on a stretched orbit: a Kepler ellipse from 7000
  (inside Homestead's orbit) out to 46000 (past Ringo's), round in about 45 minutes of game
  time, so it swings close by every so often. Its position comes from a few Newton steps on
  Kepler's equation (cached, since prediction asks for it every step), and every
  "where is it" question goes through `relPos` / `relVel` / `distAt` / `angleAt`, so SOI
  hand-offs and prediction just work; the map draws the ellipse. It's tiny (radius 40, SOI
  220), and a trip across the whole system can't hit that: the Hohmann-style guess for when
  to leave is a search (`stretchedWindow()`: try leaving at each moment, keep the ones where
  a half ellipse meets the comet, prefer gentle departures and arrivals; it usually waits for
  the comet to be far out and slow), the trip only has to pass within 8 km, and then Pip
  homes in (`catchComet()`, closed-loop like docking: in towards a cosy height, never faster
  than we could stop, then round at orbit speed, and only done once the orbit is really round:
the duck's lumps stick up a long way, and a lopsided orbit skimmed them). Pip always flies that bit, even when
  coaching ("Comets are tricky to catch!"); the kid still flies the big burn and the landing.
  Leaving it works like leaving any world, with the same window search. Its look: two lobes
  in the flight plane (so the rocket's view shows the duck), dark dusty ice with bright frost,
  gas jets fizzing from little vents (`DUCKY_JETS`), and two tails that grow as it nears Ember
  and always point away from it: a curved creamy dust tail lagging behind and a straight blue
  gas tail, plus a glowing coma (`src/world/ambient.js`; up to 1.4 km long, and on the map
  drawn at most 8× longer, like the worlds are drawn bigger).
- **Music.** Karplus–Strong banjo and guitar, a reedy harmonica, saw-pad strings and a triangle
  bass, played by a generative sequencer with a lazy swing. Three moods (campfire, space,
  discovery) crossfade at bar lines. Pip's friends (#16) each add a part on top, as loud as
  where you are says (below).

## Breakdown (as built)

1. Orbital core + tests (RK4 cross-check, apsis timing) ✅
2. Flight sim: thrust, SOI, landing/crash, rewind ✅
3. Predictor + map rendering: patched segments, ghosts, ▲▼ markers, 💥 impact ✅
4. Helpers: orbit, land, goto; mission tests from pad to every world ✅
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
map goes from about 3× the focused world's radius out to the whole solar system (out past
Tumble, `SYSTEM_EXTENT`; Ember's default view shows every planet's orbit); re-fitting
picks a new default view inside that range without changing it.

## The starter journey (#36)

A new player gets a short run of goals, one at a time, that teaches the whole game: 🚀 fly up
into space, 🌀 go all the way round Homestead, 🏡 land at home, 🌕 fly to Pebble, 🌕 land on
Pebble, and 🏡 fly home and land (`home-again`, earned landing on Homestead once `land-pebble`
is done). Then the goals **end**: Pip says "You can fly anywhere now! Pick a world on the map. I
can fly you there, or show you how!" (queued right after the last sticker's line), the goal chip
and banner go away, and Pip no longer says "Next: …" or reads a goal on the pad.

- *Why end:* a long checklist (it used to go on through every world) turned the open solar
  system into chores, and a child who wanted Ringo was told to go to Dusty. After Pebble they
  know every step of a trip (launch, orbit, fly there, land, come back), so the rest is theirs.
- *The later worlds* (Dusty, Nibble, Ringo, Sizzle, Frosty, Tumble, Flip, Ducky) keep their
  visit and landing stickers, with the same ids, so they're still there to collect; they just
  aren't goals. Discoveries (#15) and friends (#16) are unchanged.
- *One source of truth:* `Progress.starterDone` (the last goal, `STARTER_END`, is done).
  `currentGoal` is null after it, and `goalShown()` in `progress.js` decides what the builder's
  chip and the flight banner show: the current starter goal, and after the journey only the
  destination of a 🧭 Show me how while it coaches (`goalShown(progress, showing)`).
- *Older saves:* `migrate()` in `progress.js`. A save that landed on Pebble **and** has any other
  world's visit or landing sticker explored beyond Pebble, so it has finished the journey
  (`home-again` is set, dated as its Pebble landing) and goes straight into the open game. A
  save that stopped at Pebble is asked to fly home and land; any other save carries on from its
  first goal not done.
- *Hints* describe the player flying, with the autopilot buttons as the alternative and the 🧭
  for being shown how: "Once you are high up, tip sideways and hold GO. Or tap the swirly button
  and I'll fly! Turn on the compass and I'll show you how!", "Slow down gently before you touch
  the ground. Or tap the landing button.", "Open the map and tap Pebble."

## Buggies

A **Garage** section holds one buggy. You choose its type and colour in the workshop:
Rover (easy), Monster Truck (big bouncy wheels, climbs), or Hopper (light, can jump).
After landing on solid ground, 🚙 Drive rolls it down a ramp.

- **Legs on the garage** (#42, `holdsRadial()` in `parts.js`). The garage looks like it
  belongs at the bottom, so it can hold landing legs. Only legs: they stand on the
  diagonals, clear of the door, but a fin, booster or light would block it. Legs lift the
  garage about 1.1 m, so the ramp is fitted to the garage's height when the rocket is built
  (`fitRamp()` in `rocketMesh.js`): it tilts down 20-40° and lengthens as needed so its end
  reaches the ground. (Before #42 the open ramp tilted 20° *up*; nobody noticed because the
  buggy glides out in a straight line.)

- **Driving is fully 3D over the globe** (`src/physics/buggy.js`). It's arcade car physics:
  real radial gravity, ground normals taken from the same terrain functions as the planet
  mesh, tyre grip (less on icy Frosty), slower in Homestead's water, and bumping around the
  parked rocket. Low-gravity moons get "sticky tyres" near the ground so crests don't fling you.
- **Trees and rocks are things to bump into** (#6). Homestead's ~900 trees and the moons'
  boulders (`src/world/rocks.js`: Pebble 50, Nibble 24, Dusty 110, Sizzle 70, Frosty 80, Flip 60, one
  InstancedMesh + ink outline per world, so 2 draw calls each, in each world's colours; Ducky 36) are
  circle colliders: trunk (or most of a bush's / rock's width) plus the buggy's `reach` from
  `BUGGIES`. Rocks keep a narrower strip in front of the flight plane clear than trees do
  (z from -4 to 16 m, as they're low), and stay off Sizzle's vents, Flip's geysers and Dusty's caldera.
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
- **Driving back in** (#37, `GARAGE`, `atGarage()` and `Garage` in `buggy.js`). The rocket is
  solid all round: a circle collider at its foot (radius 1.5 plus the buggy's `reach`, so the
  buggy stops about 2.5 m from the middle, where the lowered ramp ends), bonking like a tree,
  and only a super hop clears it. The garage door (it faces +z, towards the flight camera)
  stays open with its ramp down the whole time the buggy is out, and a box in front of it
  takes the buggy in: from 0.5 to 6.5 m out from the rocket's middle and 3 m to either side
  (the door is 1.3 m wide), measured flat along the ground at the rocket. It counts when the
  buggy is in the box, on the ground (wheels within 0.5 m, not orbiting), facing the door
  within 60° and not backing away from it faster than 0.5 m/s; any speed, even stopped, is
  fine. So a child only has to get roughly in front and point at it, while bumping the side or
  back (facing sideways, or outside the box) just bonks, and so does driving across the front
  or hopping over the ramp. The buggy rolls out 6 m in front of the door, inside the box, so
  `Garage` only arms once it has been outside the box. Then it's the same 1 s roll-in as 🏠
  from close by, with a quick banjo strum (`garage`) and the door's snap; no new Pip line, the
  sound and the door closing say it. 🏠 still works from anywhere (driving in from close by,
  the sparkly whoosh from further). Close by (within 30 m) but beside or behind the rocket, the
  home compass points at a spot 7 m in front of the door instead (`homeAim()`), so it leads
  round to the front rather than into the back.
- **Compasses follow the ground** (#41). The 🏠, ✨ and 🎵 arrows point along the start of the
  great circle to the target (`groundHeading()` in `buggy.js`), projected onto the screen from
  just above the buggy, not at the target's own screen position. Once a target was more than
  about a quarter of the way round a world, the straight line to it ran through the planet
  and the arrow drifted, up to 140° off near the far side of Nibble. The rocket distance
  under the 🏠 is measured round the world too.
- **Never orbit.** Top speed is capped at 70% of the world's orbit speed, and airborne
  speed at 75% of local circular speed, so every jump comes back down.
- **Ducky's gas jets** (#13, `JETS` in `buggy.js`). Driving over one of the comet's vents,
  the gas pushes the buggy up (2.6 × the local gravity, which varies a lot on the lumpy duck)
  and outwards, fading out 6 m above the ground: a floaty 4-10 m hop lasting 10-20 s. Being
  pushed counts as flying, so the sticky tyres let go, and the airborne cap above still holds,
  so it always floats back down. The first time, Pip says "Whee! Gas from the comet is
  pushing us up!" The rocket stays
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
  - **Jump works mid-bounce** (#40). At full speed Nibble's lumps throw the Hopper into the
    air about half the time, and a press used to count only on the ground, so a kid's jump
    was ignored half the time. Now, if the Hopper left the ground fast enough
    (`hopSpeed`), pressing jump in the air is the same super hop.
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
- **The Hopper's jets** (#40, `BOOST` in `buggy.js`). On any world, holding jump in the air
  fires the jets: forwards at 2.5 m/s² and up at 1.3 × the local gravity (so it gently
  rises), for 1.2 s per hop, refilled on landing. Flames and a whoosh come out of the jets.
  Held from a jump on the ground, the jets wait a quarter of a second (`BOOST.wait`), so a
  tap is exactly the old hop: jets mark the buggy as flying, which turns off the extra
  pull that keeps ordinary hops low, so even two frames of jets used to double a hop.
  The ordinary airborne cap (75% of circular speed) still holds, so a boost never reaches
  orbit. On Nibble, holding jump from a slow start boosts the Hopper up to speed and then
  into the super hop: the "keep boosting into orbit" a kid tries first.
- **Getting home.** 🏠 drives back into the garage when close, or whisks you back with
  sparkles when far. A HUD compass always points to the rocket.
- **Driving all the way round the world** (#29; `WorldLap` in `buggy.js`). The worlds are
  little globes, so a kid naturally drives "that way" until the rocket comes back into view.
  - **What counts** is what counts on Earth: crossing every line of longitude round some axis
    and coming back, i.e. the *net* angle swept round the axis. Wobbly steering still adds up;
    driving back and forth, or halfway and back, adds up to nothing (it's the net angle, not
    the distance). The axis isn't fixed in advance: three axes, square to each other, are set
    where the lap starts (one square to the way the buggy faces, so straight ahead goes round
    its equator), and any great circle stays at least 35° from the poles of one of them,
    so a kid who turns off onto some other way round still gets there. Near an axis's pole
    (`ROUND.cap`: within about 32°) that axis starts again; a lap must also cross that axis's
    equator and be at least 80% of the way round in distance (`ROUND.far`), so driving in
    circles never counts unless the circle is nearly as big as the world. After a lap the
    next one starts from there. A single axis picked from the first heading was simpler but
    too strict: one big turn (round a rock, say) and the lap was spoiled. Counting "visited
    regions" would count wandering about, and "came back to the rocket from the other side"
    would miss loops that don't pass the rocket.
  - **Jumps count, orbits don't.** Hops, crests and Ducky's gas jets are still driving; a super
    hop round Nibble is flying and has its own sticker, so the lap starts again where the
    Hopper comes down.
  - **Feedback.** From a quarter of the way round, the ring next to the rocket compass (the
    orbit secret's) fills with the world's icon in the middle; Pip says "Halfway round! Keep
    going!" once a lap (the orbit secret's line); all the way round is the discovery chime,
    sparkles and, the first time on any world, the 🌍 Round the World sticker ("…Long ago, a
    ship called Victoria was the first to sail all the way around the Earth. It took three
    years!"), afterwards "We drove all the way round again!". Each world driven round gets a
    🌍 on its page in the sticker book (`progress.rounds`, saved; older saves have none). One
    sticker, not one per world, to keep the book uncluttered. Gas giants and Ember have no
    ground, so they can't be driven round; a lap of Homestead takes about 3 minutes, Nibble
    about one.
  - In narrow portrait the compass chip (with the ring and the ✨) is wide, so while driving the
    zoom slider sits a little lower.
- **Buggy dust** (#26; the sim in `src/physics/dust.js`, drawn by `src/world/dust.js`). Tyres
  throw up dust the colour of the ground under each wheel, and it falls with the world's real
  gravity, so it tells you where you are without a word.
  - **Where it comes from.** Every wheel whose tyre is on the ground (not hanging over a dip)
    throws dust at `dustRate(speed, slip, push)`: nothing below a crawl (1.2 m/s), more the
    faster it rolls, and much more when sliding sideways (Frosty's ice, a hard turn) or
    speeding up or braking hard (the forward acceleration, smoothed so bumps don't count).
    Rolling flings it backwards; braking sprays it a little forwards; sliding throws it out to
    the side. Landing makes a ring-shaped thump of dust for every buggy, bigger the harder it
    comes down (with a soft `thump` sound and a little shake above 3 m/s).
  - **What colour.** `dustColor()` asks `terrain.js` for the same colour the ground mesh is
    painted with (no reading pixels), a little paler as fine dust is, and paler still on dark
    ground so it reads. Grass throws up some earth too. Homestead's seas splash blue-white
    instead. Each wheel samples again once it has moved half a metre, and each grain varies a
    little. The billboards are lit by the sun like the ambient puffs, so dust dims at night.
  - **How it falls.** Each grain feels mu / r² towards the middle, so it hangs in slow, clean
    arcs on Pebble (2 m/s²) and Nibble (0.9) and drops at once on Homestead (10). Airless worlds
    have no drag, so they're true ballistic arcs and small, sharp grains; where there's air
    (Homestead, Dusty) the dust is slowed, grows into soft puffs and fades within about a
    second. A grain never goes into the ground: it's checked against `terrain.js` heights
    (every flying grain near the ground, plus a few others round robin, at most 160 a frame),
    and one that lands stops on the surface and fades out.
  - **The Hopper.** A hop bursts a ring of dust out along the ground and flashes both jets
    (the nozzles point down); holding jump while it rises flickers the jets, and close to the
    ground the blast blows dust out from underneath. The Nibble super hop's burst is bigger,
    with a jet blast backwards, and the orbit jets (holding jump) and brake jets (reverse)
    puff flames and a little grey smoke, lifting dust when they fire low over the ground.
    Ducky's fizz and bumping a rock use the same pool.
  - **Cheap.** One fixed pool (384 particles, typed arrays, a free-list: nothing allocated per
    frame, and when it's full new grains are simply skipped) for every buggy effect, drawn as
    two instanced billboard meshes (lit dust, additive flames) in the world's group: two draw
    calls however much dust there is, and only the live grains are uploaded. Typical driving
    keeps 30-150 alive; the sim costs a few hundredths of a millisecond a frame on a laptop.
    (Falling leaves and the whoosh-home sparkles still use the flight scene's sprite
    particles: they're rare.)

## Discoveries (#15)

Small secrets tucked round the solar system, in the spirit of Outer Wilds: curiosity is
rewarded, and there's no checklist (discovery stickers are never goals). Each one is a real
bit of space science. Finding one plays a chime and sparkles, pops a sticker (with its
world's picture), and Pip says the fact in short sentences.

| World | Discovery | Found by | Sticker |
|---|---|---|---|
| Homestead | an old wooden observatory on a hilltop ~130 m behind the village; once found, its telescope swings round to point at Ringo | buggy within 9 m | 🔭 Stargazer (Galileo thought Saturn's rings were ears) |
| Pebble | a flag, a little lander base and footprints | buggy within 7 m | 👣 Footprint Finder (no wind, so footprints last millions of years) |
| Pebble | a laser mirror that glints; once found a red laser flickers up to it | parked within 5 m | 🔦 Laser Bouncer |
| Dusty | a sleepy old rover with dusty panels; it beeps, then a light blinks | buggy within 7 m | 🤖 Rover Buddy (Opportunity) |
| Dusty | four dust devils wandering the plains (~1.5 m/s) | driving through one | 🌪️ Dust Devil |
| Nibble | a giant crater nearly as big as the moon (like Stickney), paler floor, crossing the flight plane | landing or driving inside | 💫 Future Ring (Phobos may become a ring) |
| Ringo | the gap between the clouds and the inner edge of the rings | the rocket crossing the ring plane there, still flying 4 s later | 🤿 Ring Diver (Cassini's 22 dives) |
| Sizzle | the biggest vent's plume | buggy within 9 m | 💨 Plume Chaser |
| Frosty | fresh cracks with a faint blue glow, only at night | parked within 6 m of a crack where Ember is below the horizon | 🐙 Ocean Spotter (Europa's ocean) |
| Ember | a solar flare: a loop of glowing gas that rises for 50 s every 150 s of flight time | the rocket within 6 × Ember's radius while it flares | 🌞 Flare Watcher (auroras) |
| Flip | the dark streaks the geysers' dust leaves downwind | buggy within 8 m of one | 🌬️ Streak Spotter (Voyager 2 at Triton) |
| Ducky | Philae, tipped over in a shady hollow by a big boulder | buggy within 6 m | 📡 Lander Finder |

- **Night is real.** The worlds don't spin, so which side is dark only changes as they go
  round Ember. Frosty has four glowing cracks spread round it, so one is always on the night
  side, and the glow only shows there (and only counts there).
- **The ✨ compass.** While driving, a ✨ next to the rocket compass points at the nearest
  secret still to find on this world (night-only ones only while it's night there; the dust
  devils where they are now). It grows and glows as you get close, twinkles when you're
  nearly there, and a ✨ floats over the spot within 60 m. The first time (until a first
  discovery) Pip says "Psst! Follow the sparkles to find a secret!" The compass takes a list
  of `{ id, p, icon }` targets, so Pip's friends (#16) join it with a 🎵. A headless test
  drives a pretend kid along it from four landing spots on each world and finds everything.
- **Landing counts too.** A rocket landing by (or in) a discovery finds it; the landmarks
  keep clear of the flight plane so they never hide the rocket, so in practice that's
  Nibble's crater and Flip's streaks.
- **The ring gap** is judged where the rocket crossed the ring plane (the line where it meets
  the flight plane), interpolating the radius, not the chord, so top time warp can't cut the
  corner. A cosy orbit round Ringo is inside the gap, so most visits find it: that's fine, it's
  Pip's cue to tell the Cassini story.
- **Cheap:** each world's still landmark parts are one merged vertex-coloured mesh plus its ink
  outline (and one un-inked mesh for flat things like footprints), sharing one material. Only
  the telescope, glints, glows, laser and flare are separate. Dust devils are clock-driven
  billboards like the other ambient effects (one unshaded mesh, so they show at night too).
  Trees and rocks keep clear of landmarks; the solid ones (observatory, flag, lander bases,
  rover, Philae and its boulder) are in the buggy's `ObstacleGrid`.
- **The sticker book** has a ✨ Discoveries section: found ones show their sticker; the rest show
  their world's icon with a ❓. Tapping one has Pip say the fact again, or a gentle hint ("I
  heard a strange hum on Frosty. Park by a deep crack when it is dark!").

## Pip's friends: the space band (#16)

Like Outer Wilds' travellers: a warm, musical reason to visit every world. Pip plays the banjo
(the sequencer's banjo is Pip's part), and five friends are camped by little campfires, each
with an instrument, a look of their own and a campfire prop. Since #43 they're little space
travellers in the Outer Wilds mood (`src/world/friendMesh.js`): a padded suit with a chest
panel, a backpack with Pip's antenna and bobble on top, their helmet off and set down by their
boots (so a child sees their faces), both hands on their instrument, and a hat or face that
keeps who they are:

| World | Friend | Instrument | Their part in the music |
|---|---|---|---|
| Pebble | Mossy, a sleepy moon-hermit (nightcap, tent) | harmonica | soft two-note breaths (third and fifth) on the beats |
| Dusty | Bolt, a rover-mechanic (goggles, toolbox) | hand drum | doum on one, dum on four, teks between |
| Nibble | Crumb, a tiny critter (big ears) | kalimba (thumb piano) | a twinkly broken chord on the off-beats, high up |
| Sizzle | Toasty, a lava-watcher who likes it warm (sunglasses) | double bass | a plucked (Karplus-Strong) walking line |
| Frosty | Flurry, an ice-fisher (bobble hat, fishing hole) | tin whistle | a little two-bar tune |

Flip, Ducky and Tumble have no friend: five is a band a child can find, and Tumble has no ground.

- **Same key, same chords.** Every friend's note is a chord tone of the sequencer's current chord
  (the moods' progressions are all in G), so any mix of friends fits. A test plays minutes of
  every mood with every part on and checks each note.
- **How loud** (`friendLevel()` in `src/physics/friends.js`, pure and tested), as a gain and a
  brightness (each part's low-pass filter opens from 500 Hz to 8 kHz with it):
  - on their world's ground (landed or driving): 0.12 far away, rising to 1 by the fire, as the
    square of how far along you are between 160 m and 8 m (about 0.65 at 40 m, 0.35 at 80 m), so
    every few metres closer is clearly louder, and clearer as it gets louder: you can find them
    by ear;
  - flying in their world's space: 0.12, swelling to at most 0.3 (still muffled) over the fire;
  - at home (on Homestead below the space line, or in the workshop): every friend found plays
    at 0.55 (0.85 for 45 s after the Full Band); tapping a found friend in the sticker book
    plays them at 1 for a few seconds;
  - anywhere else: silent.
  The app works this out ten times a second and hands it to the engine, which glides each
  part's gain and filter there (`setTargetAtTime`, 0.5 s) only when it really changes, and
  schedules no notes at all for silent parts. Parts feed the music bus, so the music switch
  and the ducking under Pip's voice apply. The loudest moment (every part's loudest note
  together, at the party level) is about as loud as the campfire band's own, and the master
  compressor catches the rest.
- **Finding them.** Each campfire has a big soft glow you can spot on the world's face from low
  orbit. While driving, the on-planet compass (#15) also lists friends still to meet, with a 🎵
  instead of ✨, and a 🎵 floats over the fire within 60 m. The first time the compass points
  at a friend Pip says "Listen! Can you hear music? Follow the notes!"
- **Saying hello:** the buggy within 8 m of the fire, or the rocket landing within 28 m (the
  campfires sit about 17 m in front of the flight plane, so landing right below one counts).
  They wave (they also wave whenever the buggy is close), a chime and a banjo strum, sparkles,
  their sticker pops, and Pip introduces them ("Hello, Mossy! … Now Mossy is in our band!").
  From then on their part plays in the campfire song at home, and they sit round Homestead's
  campfire by the launch pad and the workshop's fire, playing along.
- **Full Band:** with all five met, Pip says "That's everyone! Let's go home to the campfire!"
  Being on Homestead's ground (landed anywhere, or driving) for 4 s then brings everyone
  together: a big strum with drums and a whistle flourish, confetti, the 🎶 Full Band sticker,
  the friends bounce round the campfire and the whole band plays louder for 45 s. Launching
  from the pad counts too, so an older save with everyone found gets it on the next launch.
- **Saved** as ordinary stickers (`friend-…`, `full-band`) in the same `done` map, so older saves
  just load with none found. Not goals: no checklist. The sticker book's 🎵 Band section shows Pip
  and each friend (or their world and a ❓, with a spoken hint), then Full Band.
- **Cheap:** each campfire's logs, stones and prop join the world's merged landmark mesh; each
  friend is one merged vertex-coloured body (instrument and helmet included) plus two arms, each
  with its ink: 6 draw calls and about 8-9k triangles (twice that with ink; a test keeps it under
  10k). Their arms are posed by a little two-bone reach to where the instrument wants the hands;
  saying hello swaps in a raised arm (hidden otherwise). Glows are sprites (no extra lights,
  which would recompile every material).

## Ideas for later

Tracked as [GitHub Issues](https://github.com/malfernion/worldVoyager/issues).
