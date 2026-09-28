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
The worlds' orbits are drawn too (bold on the map, faint in the flight view), but they're for
flying: they lie in the flight plane and a world's own orbit runs through its middle, so they're
hidden while driving the buggy, and in the flight view a line through the world we're at fades
out while we're close to it (#48).

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
| Misty | Titan | a thick orange haze; lakes and rain made of methane |
| Tumble | Uranus (and Neptune) | an ice giant tipped on its side, rolling round the Sun |
| Flip | Triton | a moon that goes round backwards; icy geysers |
| Ducky | comet 67P (where Philae landed) | a rubber-duck comet whose tail always points away from the Sun |
| Yonder | Pluto | a little icy world so far out that sunlight takes more than five hours to get there |

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
   - *Helpers:* while one is flying (or coaching), tapping the path does nothing, and starting
     one takes the ⏰ away. Simplest, and it keeps "who's in charge of time" clear.
   - The pause is the same one Pip uses to explain a marker (`FlightScene.pause`), just without
     the time limit.

7. **The game only slows time down by itself, never speeds it up** (#50). In a playtest,
   coaching and the autopilot sped time up on their own, and it was unpleasant: about to burn,
   and suddenly all the worlds race round. Slowing down by itself is good (before a new world,
   the ground, a burn or a coach's cue); speeding up is the child's choice (⏩, the keys, the ⏰),
   with one exception: **🤖 Take me there**, since the child asked Pip to fly them there.
   - *The rule* (`helperWarp()` in `autopilot.js`, used by `FlightScene.warp`): a helper's
     `warp` is only ever a cap on the player's own speed: 1 for a burn, a manoeuvre or a cue,
     and a little more as an event comes closer (`safeWarp()` keeps it short of a new world or
     the ground). Only a 🤖 trip (`Autopilot.trip`: `goto` flown by Pip, including its final
     landing, not coached) may go faster than the player's speed, until the player takes the
     clock (`manualWarp`: then the trip caps it too). 🌀 Orbit and 🛬 Land never speed up: they
     are short, and the child is watching the rocket closely. The slow-down before a new world or
     the ground (`fly()`) comes on top, and GO puts time back to normal, as before.
   - *Waits* (`Autopilot.coast(want, left)`: coasting to a burn, a new world, the top of the
     climb, the ground, the next HOLD) say how long is left (`waitLeft`). When a helper's wait
     ends (a burn, a cue), the speed-up the player chose for it ends too (not on a 🤖 trip,
     whose clock is the player's to keep): each wait, the child chooses again, and time never
     jumps back up after a burn by itself.
   - *Coached long waits:* at normal speed a coached trip can wait a long time for a transfer
     window or coast for minutes. When a coached wait is longer than `LONG_WAIT` (10 s at the
     player's ×1), the ⏩ glows and Pip says once (chatter, key `skip`, not again within 30 s):
     "Tap the fast button ⏩ to skip ahead!". A child who taps it gets the same speed-up the
     coach used to take by itself, and the coach's cap still slows back to ×1 before its next
     cue, so HOLD and LET GO come in time at any speed. The pretend kids in the tests
     (`kidFlies()`, the coaching tests) tap ⏩ when it glows, as a child would.

## Structure

```
src/physics/   pure, headless, unit-tested
  orbit.js       universal-variable propagation, elements, conic geometry
  bodies.js      the solar system (on-rails orbits, round or stretched, SOIs, surfaces)
  terrain.js     terrain height + colour functions shared by physics and meshes, and each world's liquid
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
- **Floating origin.** Every frame the world is drawn relative to the rocket (or the map's fixed centre, #57),
  so float32 precision holds from 1 m to the ~65 km out to Tumble.
- **Physics surface = visible mesh.** After meshing a planet we slice the mesh at z = 0 and use
  that exact outline as the ground, so legs touch what you see. A world with a liquid has two
  meshes, each sliced: the seabed for the buggy, the liquid's surface for the rocket (see
  Liquids below).
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

**The camera holds still when a new world takes over (#49).** Flying into Pebble's space used
to snap the flight camera from about 1 km to 200 m in one frame (the automatic distance is
worked out from the height above the world you're in), and the map jumped to centre and zoom
on the new world, just when a child needed a steady view to land on a small, fast moon. Now
nothing moves: the hand-off leaves a `carry` on the automatic distance that keeps the camera
where it was, and it eases back (with the view's "down" turning to the new world) only while
it's calm, never during a burn or within 30 m of the ground, over about two seconds. The map
keeps its focus and zoom, even if it was centred on the world we just left: easing it over to
the new world would slide the rocket across the screen, and following a different world is a
choice the child makes (🎯). Instead the new world's label glows for a moment.

**The map stays where you put it (#57).** The map's centre used to be "the world you were in
when you opened it, plus however far you'd dragged", so it rode along with that world round the
Sun: after taking off from Homestead the whole map (the Sun, the other worlds, the spot you'd
dragged to) slid and wobbled with Homestead, and it opened on Homestead rather than the rocket.
Now the centre is one fixed point in the Sun's frame (`FlightScene.mapAt`, world coordinates,
so the floating origin and SOI hand-offs can't move it): opening the map puts it on the rocket
(framed so the world we're in still fits), and after that only the child moves it (dragging),
or 🎯, which glides back to the rocket and then stays put again. `focusMapOn(body)` centres on
a world the same way, once. `mapFocus` is still "the world the map is about" (its zoom range,
default view, label priority), but the map never follows it: a map that follows something
moving is exactly what felt wobbly, and a kid who drags the map wants it to stay there.

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
- *The later worlds* (Dusty, Nibble, Ringo, Sizzle, Frosty, Misty, Tumble, Flip, Ducky, Yonder) keep their
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
  mesh, tyre grip (less on icy Frosty), driving along the seabed through Homestead's seas (slower and floaty; see Liquids), and bumping around the
  parked rocket. Low-gravity moons get "sticky tyres" near the ground so crests don't fling you.
- **Trees and rocks are things to bump into** (#6). Homestead's ~900 trees and the moons'
  boulders (`src/world/rocks.js`: Pebble 50, Nibble 24, Dusty 110, Sizzle 70, Frosty 80, Misty 90 (small ice cobbles), Flip 60, Yonder 70 (pale blocks of water ice, a few stained red), one
  InstancedMesh + ink outline per world, so 2 draw calls each, in each world's colours; Ducky 36) are
  circle colliders: trunk (or most of a bush's / rock's width) plus the buggy's `reach` from
  `BUGGIES`. Rocks keep a narrower strip in front of the flight plane clear than trees do
  (z from -4 to 16 m, as they're low), and stay off Sizzle's vents (and 6 m off its lava, #45), Flip's geysers and Dusty's caldera.
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
    ground so it reads. Grass throws up some earth too. Homestead's seas splash blue-white spray
    instead (and bubbles under water, #44). Each wheel samples again once it has moved half a metre, and each grain varies a
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

## Liquids (#44)

Homestead's seas are real water, Sizzle has lava pools (#45, below), and Misty, a Titan-like
moon, has methane lakes (#46, below).

- **What a liquid is.** A world's terrain (`terrain.js`) can have `liquid: { kind, level }`:
  what it is (`'water'`; later `'lava'`, `'methane'`) and its surface in metres above the
  world's base radius. That's all the physics needs. The ground keeps its real shape under it:
  Homestead's seabed is the raw terrain made a little shallower near the shore and deeper
  further out (`seabedDepth()`), so beaches are gentle (every buggy climbs out of every sea)
  and the seas are a few metres deep by the coast and about 7 m in the middle. Trees,
  landmarks, the pad and the campfire all stand on dry land.
- **Two surfaces, one rule each.** The **buggy** drives on the solid ground at any depth. The
  **rocket** touches whatever is on top along the flight plane: `Body.surface` is the higher of
  the ground (`ground`, sliced from the terrain mesh) and the liquid (`liquidTop`, sliced from
  the liquid's own mesh). Touching down where the liquid is on top (`wetAt()`) is a crash whose
  reason is the liquid's kind, so predict's 💥 lands on the water, rewind works as for any
  crash, and a new kind needs no new physics. Rockets can't float: there's no landing on a
  sea. The first splash earns the 🌊 Splashdown! sticker ("Splash! Rockets can't float. Let's
  land on the ground!"; the same id, so older saves keep theirs).
- **Landing on dry land.** The helpers work out where the rocket would come to a stop
  (sideways speed and braking); if that isn't `landableAt()` (dry with 4 m to spare either
  side) they aim for `nearestLandable()`. The autopilot's descent drifts over to it, not coming
  down before it's nearly there and never below 6 m over the liquid; a coached landing has Pip
  fly us over ("Oops, water! I'll fly us over to dry land.", like the tiny pushes), staying
  15 m up so the child still has room for the HOLD / LET GO down, and leans towards the
  spot's middle on the way down. Closed-loop, so a late kid or a weak rocket still ends dry
  (tested from 48 points round the orbit each way, with quick and lazy kids).
- **The buggy in a sea.** `Buggy.soak()` works out how deep in it is (0 wheels just wet, 1 all
  under: `WATER.deep` = 1.4 m above the wheels' bottom). The deeper, the more drag, the lower
  the top speed (half) and motor (65%), and the more buoyancy (up to 45% of its weight, so hops
  float higher and come back down; never enough to float off). Driving in and out is a
  splash of spray and a sound; in the shallows a bow wave peels off the nose; all under, the
  tyres stir up bubbles instead of dust, and bubbles rise from the buggy and pop at the surface
  (spray falling back through the surface is gone). All in the one dust pool. Laps round the
  world (#29) cross seas like anywhere else.
- **Seeing it.** One mesh per world (`src/world/liquid.js`): an icosphere at the liquid's
  level with only the triangles near or under it (the rest would sit under the land), and each
  vertex's depth baked in. A small shader bobs gentle waves (a few cm, none at the shore),
  colours shallow to deep, draws wobbling foam along the shore and glints of sun on moving
  ripples; see-through in the shallows, nearly solid far out, so it reads from orbit too. One
  extra draw call, no per-frame CPU work. From underneath it's a bright ceiling.
- **Under it.** When the camera is below the surface (driving: the chase camera dives after a
  buggy deep in a sea, since looking down through deep water it'd be lost), the scene's fog
  closes in to the liquid's colour, a tint covers the view, the stars hide, and the music and
  sound effects (not Pip) go through a low-pass. Near a sea, gentle lapping swells and fades.
- **A new kind** (as #46's methane was) is: `liquid: { kind, level }` in its terrain, a `LOOKS` entry in
  `liquid.js` (colours, see-through, waves, underwater fog), a crash line in `FlightScene` (a
  new kind's crash falls back to "Kaboom!"), a line for the coach's fly-over in
  `glideToLand()`, and any buggy rules it needs.

### Lava on Sizzle (#45)

- **Pools, still one level.** Homestead's water is a sea level; Sizzle's lava sits in pools
  and short flows by its volcanoes. Two ways to do that were: (a) keep one level per world and
  carve basins down through it, or (b) let the liquid's height vary from place to place. We
  chose (a) (`makePools()` in `terrain.js`). Sizzle's lava level is 4 m below its base radius,
  under all of its natural ground (whose lowest dip is about 2.7 m down), so on its own it
  touches nothing. Each pool (a round blob, or a flow along a short line, with a
  noise-wobbled shore) is a bowl 2 to 2.5 m deep under the level, with a bank rising from the
  shore at 0.35 (about 19°) until it meets the ground. So the lava lies in dark hollows a few
  metres down, which looks right, and everything from #44 works as it is: the physics
  (`liquidDepth`, `wetAt`, the rocket's `surface`, `landableAt` / `nearestLandable`), the
  mesh (only the triangles near the pools are kept: about 2,500) and the helpers. (b) would
  have touched all of them, plus the prediction and the meshes. The same carving will make
  #46's methane lakes. The one rule it adds: nothing else may dip below the level (a test
  checks every wet spot is in a pool).
- **Where.** Nine pools, placed by hand: clear of the vents and their plumes (at least 28 m,
  the biggest plume is a discovery), 20 m from Toasty's camp (one pool is in view of it; a
  rocket can still land right by the camp), off the x = 0 great circle that the buggy tests
  drive round, and off the rocks (they keep 6 m off the shore). Two cross the flight plane
  (about 6% of it), so a rocket can come down in lava and the helpers have something to
  avoid; 92% of the flight plane is landable, never more than 20 m from where the rocket would
  stop. Several are on the camera's side, so they glow on Sizzle's face from orbit. The banks
  are dark cooled rock with scorched orange ground beyond. Sizzle's mesh is a little finer
  than before (detail 48) so the shores are round.
- **The look.** Its own small shader in `liquid.js`: solid (not see-through), no waves, no
  foam, and lit only by itself, so it glows the same by day and night. Three crossing sine
  ridges (and a smaller copy) drift slowly: dark crust plates where they're high, bright
  yellow cracks along one contour, molten orange-red between, pulsing gently, with a hot rim
  at the shore. Where a pixel covers more than a crust plate (from orbit), the pattern fades
  to its average (`fwidth`) so it never shimmers.
- **The rocket.** Touching lava is a crash with reason `lava` (nothing new in the sim): a
  thump, a long hiss and bubbling, steam and dark smoke billowing up with a few sparks, and
  "Sizzle! Lava is much too hot to land on!". The helpers land beside it, as by the sea; a
  coached landing heading for lava has Pip say "Oops, lava! I'll fly us over to solid
  ground." (tested from 48 points round the orbit, autopilot and coached; a bigger sweep of
  720, both ways round, quick and lazy kids, all landed on solid ground).
- **The buggy can't go in** (`LAVA`, `lavaEdge()` in `buggy.js`). It's a soft wall rather
  than a bonk: from 9 m out the buggy's speed towards the shore is capped more and more
  (0.6 m/s plus 2 m/s per metre still to go), so it slows smoothly and touches the wall 2 m
  from the shore (its nose about a metre short), where its push in is taken away and it's
  nudged back at 0.8 m/s. Coming in at an angle it turns to slide along the shore, and
  steering works there even while it's stopped (on its own, steering needs rolling, and the
  nudge back would reverse it), so GO and a steer always gets away along the shore, and
  backing up always works. "Which way is out" is the slope of `shoreDist()`, the distance to
  the nearest pool's shore. A jump or the Hopper's jets may fly over a flow, but whatever
  comes down over lava lands on a cushion of steam at its surface and is popped back towards
  the nearest shore (3 m/s plus 1 m/s per metre of lava under it, and up), until it's on
  solid ground. Rolling off a bump near the shore doesn't count as a jump: the wall still
  holds. Each touch is a sizzle and a puff of steam and smoke (and sparks) from the dust pool,
  a small shake, and now and then (at most every 25 s, and only when Pip is free) "Too hot!
  Let's steer around the lava."; wisps of steam drift off the lava near the buggy and a low
  bubbling hiss rises near it (like the lapping: made once, only its level changes). The
  tests drive all three buggies straight at every pool from 16 sides, then steer away or back
  up; hop and jet over them; put a buggy down in the middle; and a pretend kid laps Sizzle
  (on the flight plane's great circle, which crosses two pools, and a tilted one) by steering
  left for a moment whenever the lava stops them.

### Methane lakes on Misty (#46)

- **The moon.** Misty goes round Ringo like Titan round Saturn, out past Frosty (orbit 6200,
  SOI 700: 450 m of space between its SOI and Frosty's, well inside Ringo's 9000). Radius 160,
  gravity 2.6 (a big moon, but low gravity, so trips and landings stay easy). The map's
  limits didn't need to move (Ringo's default view is its whole SOI), and its label is a moon's,
  so it hides behind Ringo or shrinks to its icon when crowded (#33). The stress sweep, the
  mission tests and Round the World all include it.
- **The ground** (#59). Smooth plains with a slow swell, rolling brighter uplands (Titan's
  Xanadu) and fields of long dark dunes, all from `makeMisty()` in `terrain.js`. It began as a
  belt of parallel ridges right round the middle (`sin(z)`: bands, which the owner rightly
  said looked computer-made); now:
  - One broad field (`g`, 3 octaves at 1.3) gives the plains' swell and, where it's high, the
    uplands' hills. The ground dips up to 2.2 m within about 60 m of each lake (the edge
    wobbled by noise), so the lakes sit in low ground; the lakes' banks round over into it
    (`makePools(…, soft)`, a smooth minimum, #59; Sizzle's lava keeps its crisp banks).
  - Dunes (`MISTY_DUNES`): two sets, each ridged across its own tilted axis, so the ridges'
    heading changes across the moon (mostly east-west round the middle, like Titan's), 17 and
    21 m apart, 2.2 m tall at most (no steeper than the old ones: the buggy drives over them).
    A domain warp bends them; noise stretched along the ridges makes each crest rise, fall and
    break off (30 to 150 m long); one set's fields here, the other's there, crossing only in
    a narrow strip; gaps between fields; none on the uplands, near the poles or on the lakes'
    banks. Near a set's own poles its ridges would curl into rings, so they fade out there. The
    sets are joined with a soft union (`a + b − ab`), since `max()` leaves a crease.
  - Colour: the dune fields' sand is dark (the region, not each ridge, so fields read as
    patches like Titan's sand seas), crests paler; uplands brighter; damp shores dark.
  - Region edges must be wide enough in noise units (a steep bit of Perlin noise made a sharp
    dark wedge at first). Its mesh is still detail 56 (about 63,000 triangles, like Homestead's);
    height and colour share one evaluation per vertex (the last point is kept), and baking it
    costs about 1.5× the old banded one (roughly 75 ms against 50 ms on a desktop).
- **The lakes** are carved like Sizzle's lava (`MISTY_LAKES`, `makePools()`): one methane
  level 5 m below the base radius (the natural ground never dips below about -3.5 m, #59), and ten
  basins 2.2 to 3.8 m deep, with gentle banks (0.2, so the buggy drives in and out). Like
  Titan's, most are round the poles (here z = ±1: the northern ones face the camera from
  orbit): a long northern sea with a southern arm, a round one, a small one right by the pole,
  little ones further out, and a long southern lake. Two cross the flight plane (about 4.5% of
  it, in two runs), so a rocket can come down in one and the helpers have something to avoid;
  94% of the flight plane is landable, never more than 19 m from where the rocket would stop.
  Around 4% of the whole moon is lake. The shores are dark and damp.
- **The look.** A `methane` entry in `LOOKS`, drawn by the water shader with a few new knobs
  (water's values are unchanged): dark brown to nearly black, mostly solid (a little
  see-through at the edge), tiny slow waves (2 cm), faint ripples, hardly a glint, no foam,
  and the orange haze mirrored at a slant (a Fresnel term). Under it a dark amber murk (the
  fog, and the `#underwater.amber` overlay). Splashes and the buggy's spray are amber, and the
  lapping is faint. One mesh, about 4,500 triangles (only those at or below a metre above the
  level).
- **The haze** (only the look; real atmospheres are #12). `haze` on the body makes its
  atmosphere shell thicker: further out (1.22 × radius), and tinting the whole face (`fill`),
  not only the rim, so Misty reads as a hazy orange ball from orbit with its dark lakes
  showing through. Near the ground (`FlightScene.updateHaze()`, `SKY_LOOK.misty` in `planets.js`, every frame, flying
  *and* driving): full up to 30 m above the ground, gone by 200 m, the sky turns hazy orange
  (dimmer on the night side), the stars go, and the always-there fog (#44) closes in, in the
  haze's colour. The sky is a dome round the world (`hazeSky()` in `planets.js`, 260 m above
  the ground so the camera is always inside it while there's haze; one draw call, only then):
  the fog's colour at the horizon, so the far ground melts into it, browner overhead, with the
  sun a soft bright patch, like Titan's murk. The fog is counted from what the camera follows
  (the rocket or buggy, at the floating origin): it starts 2 m beyond it and is solid 80 m
  beyond (divided by how hazy it is), so the buggy and the rocket stay clear at any zoom while
  the ground a few dozen metres off (the horizon, on a world this small, from the buggy) goes
  orange. The shell fades out as the haze comes in (it's only seen from outside: from inside,
  its back faces are culled), so going down or up nothing pops between shell, fog and dome.
  No material changes, nothing allocated per frame; under a lake the underwater fog wins.
  (#58: at first driving never updated the haze: it kept whatever the last flight frame left,
  so a zoomed-out view before 🚙, or a dip in a lake, which turns the fog off on the way out,
  left the buggy under a black, starry sky. And the fog, 18–280 m from the camera, barely
  touched ground only 20 to 60 m away.)
- **The rocket** crashes on a lake (reason `methane`): an amber splash and "Splash! That lake is
  made of methane. Let's land on the ground!". The helpers land beside the lakes as by the sea;
  coached, "Oops, a lake! I'll fly us over to dry land." (tested from 48 points round the orbit,
  autopilot and coached, and after whole trips there from the pad).
- **The buggy** drives through them like water (`METHANE` in `buggy.js`: `WATER` with less
  buoyancy, 0.2 instead of 0.45, since liquid methane is less than half as heavy as water, and a
  little less drag). Every buggy crosses every lake and climbs out; laps round Misty cross
  them. The drive camera dives after a buggy all under: it may skim closer to the bed while
  diving (the lakes are only a few metres deep), and it now works out its height from 1.2 m up
  the buggy's own up (it used to add that along z).
- **Huygens** (#15): the probe sits on ice pebbles by the flight plane's big lake, behind the
  flight plane, with its parachute spread out. No friend on Misty (a new friend needs a look,
  an instrument and a music part; five is the band).

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
| Misty | Huygens, a gold saucer-shaped probe on ice pebbles about 12 m from the flight plane's big lake, its orange-and-white parachute spread behind it | buggy within 6 m | 🪂 Probe Finder (Huygens landed on Titan in 2005 and saw pebbles of ice) |
| Ember | a solar flare: a loop of glowing gas that rises for 50 s every 150 s of flight time | the rocket within 6 × Ember's radius while it flares | 🌞 Flare Watcher (auroras) |
| Tumble | a Saturn-style six-sided storm round the pole the cameras see (#55) | seeing it: its middle on screen clear of the buttons, facing us, at least 16 px across its flat sides' radius (flight view or map; `FlightScene.hexagonInView()`) | 🐝 Hexagon Hunter (Saturn's north-pole hexagon; two Earths could fit inside it) |
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
- **Tumble's hexagon is found by looking at it** (#55), not by being somewhere: Tumble has no
  ground, and flying low over its pole the follow camera shows only the top of the planet
  (the hexagon sat under the helper buttons), so a place-based trigger had Pip describing a
  storm the child couldn't see. Opening the map on Tumble, or zooming out near it, finds it.
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

Flip, Ducky, Misty and Tumble have no friend: five is a band a child can find, and Tumble has no ground.

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

## Richer cartoon worlds (#51)

The worlds looked flat: colour only per vertex, one even toon tone per patch, fixed gas-giant
bands. The owner chose a *richer cartoon* look: keep the chunky shapes and toon light, and add
depth, detail and motion. It was tried on Ringo, Dusty and Pebble, judged from before/after
screenshots over three rounds, approved, and rolled out to every world (#52). The
game has **one look**: no player setting and no switches. Nothing changes geometry (the physics
ground stays the visible mesh), and nothing adds draw calls or textures
(`src/world/richLook.js`).

- **Rocky worlds.**
  - *Relief:* baked into the vertex colours once, when the mesh is built. Each vertex is
    compared with the average height round it at three sizes (`reliefShade()`, scaled by the
    world's own bumpiness), so crater floors and valleys are darker, and rims and ridges lighter.
    Then it's softened over each vertex's neighbours twice (#56): unsoftened, small craters on a
    coarse mesh shaded as angular, triangle-shaped patches.
  - *Detail:* wind streaks and small pale speckles, in object space (two value-noise lookups,
    crisp two-tone edges). They fade out once a pixel covers more than they do, so there's no
    grain from far away.
  - *Slopes:* the ground's slope tints steep ground rocky and flat ground dusty. It comes from
    the smooth vertex normals, blended across each triangle (#56); each triangle's own slope
    (the first version) made jagged, triangle-shaped rock patches inside small craters. The
    thresholds were re-tuned so about as much ground reads as rock as before (Dusty about 24%).
  - *Rim and night:* a sunlit rim round the world, seen from space, and a moonlight-blue fill on
    the night side. Both come from the world's round shape, not the bumps (which would light
    every slope).
- **Gas giants.**
  - *Clouds:* clean cartoon bands worked out per pixel from the planet's palette (`GAS_BANDS` in
    `terrain.js`). They have crisp edges with gentle rolling waves, a few spiral curls where
    bands meet, faint pale streaks, and a soft calm polar cap. (Domain-warped turbulence read
    as blotchy stains.)
  - *Motion:* neighbouring bands drift at different speeds, back and forth over 15 minutes, so
    the shear never builds up into sub-pixel stripes. Their clock follows game time, but never
    faster than 20× real time, so time warp doesn't strobe them.
  - *Storms:* turning ovals with spiral arms.
  - *Tumble's hexagon* (#55, `HEXAGON`): like Saturn's north-pole storm, a deep-blue jet-stream
    band with six straight sides round a pole, a dark edge and a pale core streaming along it, a
    calmer blue inside, and a little vortex with two turning spiral arms and a pale eye in the
    middle. It's a hexagon in the point's coordinates seen from straight above the pole, so its
    sides are straight on the sphere and it turns with the planet. It sits on the end of the
    axis that leans towards +z (`facingPole()` in `terrain.js`): every camera looks at the
    flight plane from the front, so that's the pole always in view (the other one never is).
    Tumble's axis lies nearly in the plane, so the hexagon is seen quite side-on near the limb,
    wrapping over the horizon close up; flat on in the sticker book's picture. It doesn't drift
    with the bands (their shear would bend its sides), and its edges are antialiased by their
    size on screen (`fwidth`), so they stay crisp and don't shimmer near the limb or in the small
    pictures. Tumble's pole is in the dark half of its year (the axis is in the plane, so the
    seasons are extreme), so the jet glows softly on the night side, like a polar aurora.
    The round dark spot (#52) stays too.
  - *Shadows:* the planet's shadow on its rings, and a gentle hint of the rings' shadow on the
    planet (at most about a third of the sunlight, with a wide soft falloff; a dark one looked
    heavy). Both are worked out analytically.
  - *Light:* the shared 4-step toon gradient cut hard straight lines across a big sphere (its
    step at half-lit was a vertical stripe down the middle). So a gas giant's day side is one
    tone, with a soft terminator and one soft step into the night, softer at the limb.
- **Every world has it** (#52). Each has an entry in `ROCKY_LOOK`
  (rock, dust, speckle, streak, rim and night colours, the night fill's and rim's strength
  `nightK` / `rimK`, the relief's strength `ao`, how rare and bright its speckles are) or in
  `GAS_LOOK` (storms, drift, rim, night), with its bands in `GAS_BANDS`. A gas giant's ring
  shadows follow from its `rings` (faint rings cast none on the planet).
  - *Worlds of many colours* (`tint`: Homestead, Nibble, Sizzle, Frosty, Flip, Ducky, Misty, Yonder)
    use rock / dust / speckle / streak as multipliers of the ground's own colour, so grass stays
    green, beaches sandy, snow white. Dusty and Pebble use the colours themselves.
  - *Where it mustn't go:* a per-vertex weight (`rich`, baked with the relief) fades relief,
    slopes and detail out below the world's liquid (seabeds and lake floors seen through water
    look as before; lava hides its pools) and round the spots in the look's `keep` list
    (Sizzle's glowing vents, Frosty's glowing cracks).
  - *Tuning* (#53): Homestead's relief is stronger (valleys, hills and coasts read from space)
    and its rim softer; Frosty's cliffs are tinted icier; the comet is darker than coal (`darken`
    darkens its dusty ice but not the bright frost, and `ambientK` takes most of the sky's blue
    light off it); Misty's dune crests are painted paler than their troughs (`terrain.js`), so
    the dunes read through the haze; Dusty's and Sizzle's night fill is slate-blue (a pure blue
    over orange read mauve); Tumble's rim is softer.
  - *Ember* has soft, slowly boiling granules and a darker orange limb (`starShimmer()`: two
    noise lookups on the star's own pixels, real time).
  - *Rims:* none from low down (the buggy's camera on tiny Nibble is two radii out); the comet
    (`rimSurface`) uses its real surface, since its lobes are far from round; Misty's is faint
    under the haze, like its night fill.
- **Cost.**
  - Rocky: two noise lookups (16 hashes) and a few mixes per pixel.
  - Gas giant: one noise lookup, an `atan` and a few `sin`s, plus the storms (and on Tumble's
    polar cap only, the hexagon: two more `atan`s and a few `sin`s; the rest of the planet skips it).
  - No textures, and the same draw calls and triangles. Three more shader programs.
  - The relief bake takes about 240 ms for all nine rocky worlds together on a desktop (Dusty and
    Homestead about 60 ms each), once at load. Softening it (#56) adds about 1 ms per world.
- **Round craters** (#56). The owner found crater rims too low-poly and the shading inside them
  angular. Besides the softer relief and slopes above:
  - *Profile:* `craterProfile()` (`terrain.js`) is smooth all the way: a bowl as round at the
    bottom as before, bending over into a level crest at the rim, and the ejecta falling away
    smoothly. The old one had a sharp crease at the rim, which the mesh showed as a ring of
    facets. Depth and rim height are unchanged (-1 and +0.35 of the crater's `deep`), so
    landing sites and Nibble's crater discovery are too.
  - *Mesh:* the cratered worlds' meshes are finer (`DETAIL` in `planets.js`): Pebble 28 → 36,
    Nibble 16 → 24, Ducky 20 → 24, so vertices are about 2.4, 1.3 and 1.8 m apart and a small
    crater has a few rings of them across. That's 27k, 12.5k and 12.5k triangles (Dusty has
    48k), and about 70 ms more mesh building at load on a desktop, most of it three.js's
    icosphere and `mergeVertices`.
  - Still faceted: the toon light's steps follow the triangles, so its band edges stay a little
    angular on the smallest worlds (Nibble, Ducky). That's the game's chunky look everywhere.

## Skies over the ground (#61)

The owner loved Misty's haze (#58) and asked for the same on Homestead and Dusty, "just so they
have a sky vs looking right at space". It's the same machinery, generalised into a table,
`SKY_LOOK` in `src/world/planets.js` (Misty's entry is its old `HAZE`, unchanged), and one look,
no setting:

- **Homestead**: a pale blue sky low down, deeper blue overhead, the sun a soft warm patch; by
  night dark navy with the stars through it; at sunrise and sunset a warm peach band along the
  horizon on the sun's side. **Dusty**: a thinner, paler butterscotch sky (like Mars), browner
  overhead, more of space through it, and a blue glow round the sun as it sets.
- **Much thinner than Misty's**: no fog at all, so the ground, the horizon, the rocket, the
  buggy and the markers stay exactly as crisp as before; only the sky changes. (Fogging would also
  have turned Pebble and the sun into flat discs of the horizon's colour.)
- **The dome** is `hazeSky()`, one draw call (~1,000 triangles), only drawn while there's sky
  to see (camera below the look's `top`: 170 m on Homestead, 120 m on Dusty; full below `low`),
  `top + 60` m up so the camera is always inside it. It's blended premultiplied: the sky's light
  is added and only a `veil` of what's behind is hidden (day: 0.93 on Homestead, 0.75 on Dusty;
  night: 0.5 and 0.35, and more low down), so by night the stars and moons shine through, the
  scene's own starfield untouched. The colours go from night to day with the sun's height where
  the camera is (`dawn`), overhead a little later (`zenithLag`), and the sunset band (`dusk`)
  peaks with the sun on the horizon. `updateHaze()` mixes them into the uniforms each frame;
  nothing allocated.
- **No pop, orbit to ground**: the dome fades in as the camera comes down, the atmosphere
  shell half fades out (`shell`, so the limb's glow stays from a low approach), and climbing out
  the pale horizon deepens to the zenith's colour as it thins (`deepen`), so a launch goes pale
  blue → deep blue → space instead of through grey. From orbit and the map nothing changes.
  Driving keeps it (the drive frame calls `updateHaze()`), and a dip in Homestead's sea hides it
  for the sea's own murk, then brings it back (`test/haze.test.js`).
- **Clouds** (#54) are drawn after the dome (it's `renderOrder` -5, and doesn't write depth), so
  they sit in the sky as before; white on the pale horizon they read a little softer than they
  did on black space, and their night tint reads as moonlit cloud on the navy.

## Rocket smoke in the air (#60)

The owner asked for "particle effects for the rocket boosters when manoeuvring in an
atmosphere". One look, no setting; only the look (the physics never sees it).

- **The air decides** (`src/physics/exhaust.js`). Each world with an atmosphere gets an `AIR`
  entry: how thick at the ground (Homestead 1, Misty 1.35, Dusty 0.4; unlisted gas giants 1
  with a pale version of their colour), its smoke colour (white steam, a dusty orange, a
  murky orange) and a wind. `airAt(body, alt)` thins it with height (`exp(-1.5 h / spaceLine)`)
  and has it gone by the space line; airless worlds have none. That one number sets how many
  trail puffs there are, how opaque (`smokeAlpha()`: faint on Dusty) and how much they swell.
  So a launch leaves a fat trail low down that thins out as the rocket climbs; in a vacuum
  there's only the flame.
- **What makes smoke.** The main engine (any power, the fine thrust #28 too) leaves puffs just
  past the flame, spread along where the rocket went this frame so a fast rocket's trail has
  no gaps; the air slows them at once, then they drift with the wind and a slow rise, swell and
  evaporate. Low down with the nozzles at the ground (`groundBlast()`, from 22 m for one engine,
  higher for big rockets) the plume turns into big clouds rolling out along the ground both ways
  (some of them the ground's own dust colour, #26's `dustColor()`), and the trail there is
  mostly replaced by them; `touchdown()` does a second of that at once when landing. Dust is
  kicked up too, and on airless worlds that's all there is: grains in clean ballistic arcs.
  Turning (by hand or any helper, found from the change in angle) puffs little clouds from the
  nose and the tail, the ways that turn it.
- **Time speed.** Particles live in real seconds, but trails thin out from ×3 and are gone by
  ×30 (`warpThin()`), so a warped burn never strings puffs across kilometres.
- **Cheap.** One ring of 400 particles in typed arrays (when full, the oldest slot is reused),
  in the frame of the world we're at (cleared when that changes, never joined across a rewind);
  `src/world/exhaust.js` copies the live ones into one instanced mesh, oldest first (the newest,
  by the rocket, on top), and only uploads that part. About 0.1 ms per frame on a desktop in
  headless Chromium, one draw call. It replaced the old pad dust, which was a Sprite with its
  own material per puff (about 85 draw calls with the engine on the pad).
- **Readable.** The clouds' soft look (#54): the same noise tile, a soft ball eaten away by
  it, a gentle two-tone light, dimmed by night, fading by thinning from the rims (never grey
  discs), and the fog (so Misty's haze swallows it). Sprites near the camera or big on screen
  are dropped (`SMOKE_BIG`, larger than the clouds' so a billow can fill part of the pad view,
  still keeping overdraw to about 1 to 2 screens at the pad and under 1 in flight; there's no
  edge fade, as the trail runs off the bottom of the screen). Anything in front of the rocket
  and over it on screen (near the line from its base to its nose) is only a thin veil; level
  with it or behind, the rocket's depth hides it. A puff's middle stays a third of its size
  above the ground and the shader thins what's below the ground, so the ground never cuts a
  billow off in a straight line. The flames draw after it (`renderOrder` 3), glowing through.
- **Weak spots.** In landscape the helper row sits just below the rocket, so on the way up the
  young trail is often behind it (zoom out or portrait shows it); soft sprites still look like
  separate puffs rather than one continuous plume at a glance; the old flame sparks are still
  the scene's `Particles` sprites.

## Clouds (#54)

The owner asked where atmosphere and particle effects could make the worlds richer; the order
agreed was Homestead's clouds, then Sizzle's embers and heat shimmer, then Dusty's dust storms.
Clouds came first (`src/world/clouds.js`), in the same one-look way as #51: no setting.

- **One layer per world, from a table.** `CLOUD_LOOK` says how high the clouds' bases are, how
  big they are, how many sprites make one, how many are thin wisps, where they go, how fast the
  layer drifts, their colours and how dark their shadows are. Homestead and Dusty (its thin
  high clouds, stage 3 below) have entries; other worlds (Misty's haze bands) can reuse it, with new shapes where they need them; Tumble's and
  Ringo's streaks turned out simpler in their own shader (stage 6).
- **Where they go.** The views all look at the flight plane from its +z side, so clouds are
  placed for them rather than evenly: a band behind the plane that the landed and launch views
  see as their sky (16 clouds), a ring right round the plane that a launch climbs past (7), and
  more over the face the map and the orbit views see (90) and round the back for driving there
  (30), those in loose fields of a few clouds each, so from space the cover is patchy with
  clear sky between. A fifth of the clouds are thin wisps.
- **Big systems.** The owner found that cover too spotty from space ("some larger cloud fronts
  would help"), so there are also five big ones (`frontPaths()`): long bands 240 to 400 m and
  50 to 84 m wide that bend gently like weather fronts, and one that winds up tighter and
  tighter into a comma-shaped swirl. They taper at their ends, go lumpy along their length
  and have the odd gap. They're made of the same soft sprites, drawn out along the band, and
  each 22 m stretch is a cloud of its own, so they fade bit by bit near the camera or the
  rocket. Four are on the camera's side and one behind; all stay more than 70 m off the flight
  plane, so the launch and landed views keep their own sky. About 15% of the face the map sees
  is under cloud, the rest clear. Their bases are 30 to 38 m up
  (Homestead's tallest peaks poke through), and their tops stay under the 70 m space line, so
  every launch climbs through the layer.
- **The look: soft, made of particles.** The first try drew each cloud as a few big toon balls
  with outlines and flat cut-off bases; the owner found them too much like solid arcs
  (popcorn from space, big white shapes cut off by the screen's edges near the camera). Now
  each cloud is a loose cluster of 14 to 20 soft sprites: big, dense ones in its core, higher
  in the middle, smaller and fainter towards its edges; a wisp is a gently bent streak of
  fainter ones, each drawn out 1.8 times along the streak so they overlap into one stroke
  rather than a string of beads. A sprite is a soft falloff bent and eaten away by a small baked noise tile
  (64 × 64 tileable value noise; each sprite reads its own turned patch, slowly scrolling, so
  clouds billow a little), so edges are feathered and see-through and no sprite looks like a
  disc. It thins out softly just below its cloud's base, so from the ground cumulus still have
  flattish bottoms. The shading is gentle rather than two crisp tones: brighter on the sun's
  side of the cloud and higher up, a pale periwinkle underneath, with a soft step between. On
  the night side they turn a soft slate-blue, in step with the ground's moonlight fill. The
  whole layer turns about z at 0.004 rad/s of real time (about a metre a second at their
  height; time warp doesn't speed them up).
- **Never big, never cut off, cheap to fill.** Many overlapping see-through sprites are what
  costs on a phone (overdraw), and a sprite that fills the screen stops looking soft. So the
  vertex shader drops a sprite (before any pixel is drawn) when the camera is within a few of
  its radii or when it would be more than about half the screen's half-height across, and
  fades any biggish sprite out before it reaches the screen's edges; small far ones are left
  alone, so the globe keeps its clouds right to the limb (seen side-on there they stand up
  above the atmosphere's glow like a row of little puffs; we tried sitting them down and
  flattening them into a thin rim, and the owner preferred the puffs). Fading thins a sprite's density
  before its alpha step, so a fading cloud evaporates from its rims inwards instead of turning
  into grey smoke over the dark sky (only the veil over the rocket is see-through as well). By
  night clouds are fainter too, so a big one overhead is a hint of moonlit cloud rather than
  a dark smudge. Measured with a counting shader over the standard views (844 × 390): 0.14
  (orbit) to 1.38 (landed at night; the globe 1.21) sprite pixels per screen pixel counting
  every rasterised pixel, 0.06 to 0.58 counting only drawn ones, at most about 38 layers in the
  thickest spot (clouds piled up at the globe's edge), against 0.03 to 0.5 for the first try's solid balls. So at worst about
  one and a half extra full-screen passes of a cheap shader (one texture read).
- **Shadows.** A soft round blot under each sprite, as dense as it and piling up where they
  overlap, baked once into a 6 × 96 × 96 one-channel cube map (even detail all round; an
  equirectangular map had its pole in the middle of the globe view and looked blocky there).
  The ground's toon shader looks along the sun's direction up to the layer (not too far when
  the sun is low, so a shadow stays near its cloud), turns that by the layer's drift and takes
  up to 30% of the direct sunlight off, so they read as soft dimming, not dark shapes. It fades
  out towards the night side, since the toon light still lights the back of the world a
  little. The sea and the trees don't get shadows (yet).
- **Readability.** Clouds must never hide the rocket, the landing site or what a marker points
  at (the markers themselves are HTML over the canvas). Each frame the flight scene fades each
  cloud (`cloudFade()`, pure and tested): it fades out as the camera comes within about two of
  its reaches (gone with the camera inside it), and down to a thin veil (18%) when it's across
  the line from the camera to the rocket, to the ground under the rocket while flying (where it
  would land), or to the buggy. A cloud behind the rocket is left alone: the rocket is drawn in
  front of it. So a launch rises past soft clouds behind it and through a faint mist of the ones
  in front.
- **One draw call.** Every sprite is blended (premultiplied alpha) and none writes depth, so the
  ground, the atmosphere's glow and the clouds behind all show through the soft edges. They are
  sorted far-to-near for the +z cameras once, at load; from other angles the order is a little
  off, but white-on-white soft sprites hide it.
- **Cost** (Homestead: 190 clouds, 2,521 sprites, 457 of them in the big systems). One draw call
  and about 5,000 triangles; the fill above; one cube-map lookup and a few multiplies per ground
  pixel for the shadows; the per-cloud fades take about 35 µs of script per frame, and nothing is
  allocated. Placing the clouds and baking the shadow map take about 35 to 50 ms at load in the
  browser (more the first time in a cold script engine).

### Sizzle's embers and heat shimmer (#54, stage 2)

The second stage of the owner's atmosphere list (`src/world/embers.js`), in the clouds' soft
style: no hard shapes, one look, no setting.

- **Embers.** Small glowing sparks rise out of every lava pool (339 sprites on Sizzle in all:
  14 per pool plus one per 20 m² of lava, and two or more haze sheets each). Two in three crowd
  round two to four bubbling spots per pool, the rest rise anywhere over it; every start is at
  most 0.65 of the way to the shore (which wobbles only 20% in), so they always come out of the
  lava. A spark rises 3 to 7 m (one in seven flies up about 12 m), fast then slowing, drifting
  off on its own wind with a little wobble, cooling from gold to red-orange, twinkling, and
  winking out; then it rests a moment and starts again somewhere else in its patch. Each spark
  is a hot core that covers a little (so it shows as an orange dot on Sizzle's bright yellow
  ground by day) in a soft glow that only adds light, brighter on the night side.
- **Heat shimmer.** A real refraction pass would cost a whole extra render of the scene, too
  much for phones. Instead each pool has a few faint haze sheets standing over it (turned round
  their up to face the camera): a soft oval of warm light thinning upwards, crossed by thin wavy
  streaks that rise and wobble, like a cartoon's heat squiggles. Seen from above a sheet is only
  a sliver, so it fades out there; it's gone from orbit.
- **All in the shader.** Every spark is a loop on the real clock (like the clouds' drift, never
  the time warp) worked out in the vertex shader from its fixed numbers; where it starts each
  time round comes from a small arithmetic hash of its seed and the loop's number (a `sin()`
  hash goes wrong on some phone GPUs for big arguments). So nothing moves on the CPU and nothing
  is spawned or allocated; the same sums in JS (`emberAt()`) are what the tests check.
- **Readability.** Sparks fade out right in front of the lens, and further than 260 to 520 m
  away: from low orbit a pool keeps a faint twinkle, the globe stays clean. A spark is never
  drawn smaller than about a pixel; further off it grows dimmer instead. Across the line of
  sight to the rocket or the buggy (the clouds' foci) sparks and haze fade to 10%.
- **Cost.** One draw call, 678 triangles, a few uniforms a frame (measured: 83 → 84 draw calls
  landed on Sizzle). The haze sheets are the only big sprites, a few per pool, faint and
  additive; everything else is a few pixels.
- **Not done:** Io's plumes reach hundreds of kilometres; Sizzle's (#1) were left as they are.

### Dusty's thin high clouds and dust storms (#54, stage 3)

The third stage (`CLOUD_LOOK.dusty` in `src/world/clouds.js`, and `src/world/storms.js`), in the
same soft style, reusing the cloud layer rather than building a parallel system.

- **Thin high clouds**, like Mars's water-ice clouds: Dusty's own `CLOUD_LOOK` entry, the same
  plan and shader with a few new knobs (all optional, so Homestead's plan is byte-for-byte the
  same; a test checks it). Almost all are wisps (`bandWisps`, `wisps` 0.93), drawn as thin
  streaks pulled out 3.2 times (`wisp`), three long streaky bands (`fronts` with `stretch`,
  `dens`, `h`) and only the rare faint clump (`puffDens`). The whole layer shows at most 58%
  (`opacity`). The first colour, a pale lilac-white, looked cold and foreign in the dusty sky;
  now they're a warm pale peach (`lit` 0xfff0e2, `shade` 0xf4c8aa), the colour they'd take
  through the dusty air: paler and pinker than the storms' ochre, so the two stay apart, and a
  dusky mauve by night. `ragged` (the shader's, 0 for Homestead) feathers their edges: finer
  noise that eats further in, so the rims are see-through wisps, and flatter light, so no
  sprite reads as a shaded ball. Their bases are 29 to 34 m up (the air's glow reaches about 31 m on Dusty; higher,
  they floated out in space as bright arcs), well above the storms' haze and under the 50 m
  space line. No shadows (`shadow: 0`: nothing baked, the ground's shader untouched).
- **Puffs at the edge, not arcs.** Seen side-on at the limb a thin layer's streaks were thin
  arcs round the planet; the owner prefers Homestead's soft puffs standing above the glow. So
  with `limbRound` the vertex shader turns a sprite that is seen side-on (its up nearly square
  to the line of sight) round, up to 2.3 times bigger and denser: at the edge the streaks merge
  into a soft band of puffs just above the glow. Homestead has no `limbRound`, so its shader
  sums are the same.
- **Dust storms from space.** Two regional storms (`STORM_LOOK`): one in the middle of the face
  the map and orbit views see, one across the flight plane (so a landing, now and then, is in
  it). Each is a lumpy ellipse (about 270 × 180 m and 200 × 145 m on a 220 m world; together
  about 6% of the surface, so most of the ground stays clear) filled with cells on a jittered
  grid, and each cell is a cloud of the cloud layer's own kind (113 in all, 539 sprites), in a
  second layer. The first version was too faint (its colours matched the ground, and it was
  thin): the owner asked for bolder storms. Now they're a light ochre-cream veil (`lit`
  0xfbe0a8) that is dense enough to hide the terrain's detail under it: inside, a low haze of
  few big sprites drawn out a little along the wind; at the back frayed streaks; and along the
  front (the edge it drifts towards) a wall of blowing dust 16 to 34 m tall (tallest right at the
  edge, their tops under the space line), so from orbit the front is a bright streaky rim and at
  the limb the storm stands up as big dusty puffs. The front was first round billowing clumps,
  which up close in the map read as cauliflower or bubbles; its sprites are now smaller, more
  of them, drawn out 2.7 times along the wind, and the storm layer is `ragged` too (feathered
  edges, flat light), so it reads as streaming dust. The cells' bases sit 11 m up
  (most hills stay under; the volcano pokes through, like Olympus Mons above Mars's storms);
  the layer is drawn before the high clouds. It turns about z at 0.002 rad/s of real time (the
  storm across the plane passes a landing site in about 8 minutes).
- **Where the storms are is pure** (`stormAt()`): the direction turned back by the drift, then a
  few multiplies per storm, soft between 55% and 100% of the way to the lumpy edge. The haze
  asks it once a frame about the camera. `stormNear()` says the same for one coming: from its
  edge out to 2.6 times as far, how close, which way along the ground and how wide it looks.
- **Seeing one coming.** Dusty is so small that its horizon is only 40 to 80 m off, and even a
  40 m wall 150 m away is below it, so the real cells only show once a storm is close. The sky
  dome (`hazeSky`, its `bank` uniforms, set in `updateHaze()`) paints a bank of billowing dust
  along the horizon the way the storm is: rounded lobes along its top that churn slowly, dark
  dusty brown at its foot and lit at the top, higher and wider as it nears, counted from the
  real horizon (which dips well below level when the camera is up high: the first try, counted
  from level, filled the whole sky). It fades as the camera goes in (the haze takes over), and
  with height. A few multiplies in the dome's shader, no extra draw call; 0 on every other
  world.
- **Down in a storm** (`SKY_LOOK.dusty.storm`, `FlightScene.updateHaze()`, only the #61 sky
  machinery): as deep as the camera is in one (full below 45 m up, gone by 110 m), the sky dome
  turns dusty tan, its sun glow and blue sunset band are smothered, it hides more of space
  (`veil` 0.96: the stars nearly go), and the distance fogs over in the horizon's colour, from
  what the camera follows out to 75 m beyond it: the far hills go soft, the buggy and rocket
  stay crisp (a mood, not a whiteout). By night it's a faint dusty glow low down under a dark
  sky, not one flat brown. The storm's own cells round the camera fade out (they're faded as if
  3.5 times bigger, so they're dropped rather than drawn faint) and the rest thin to 10%.
- **Blowing dust** (`createStreams()`): 380 streaks and 36 faint puffs in a 56 m box round what
  the camera follows (the buggy, or the ground under the rocket), 0.6 to 7 m up (buggy and
  rocket height, so they stream across the view rather than lie on the ground like marks, as the
  first try's did), blowing east on the wind. Each is a loop in the vertex shader (like the
  embers): it fades in, is carried along with its own gust, fades out and starts again
  somewhere else. They're anchored to the ground, not the camera: the CPU only adds the wind to
  an offset each frame, wrapped every 56 m (the box repeats along x, y and z, so the wrap never
  jumps). Streaks are drawn out along the wind; they fade within 1.5 to 4 m of the lens, at the
  box's sides, when too wide on screen (a streak's width, and more loosely its length; a puff's
  size), and across the line of sight to the rocket and buggy (the clouds' foci). Hidden, with
  no draw call, outside a storm.
- **Cost** (measured, 844 × 390): draw calls +2 on Dusty (the two layers; +3 in a storm), e.g. 85
  → 87 on the pad, 94 → 96 in orbit; Homestead unchanged (149). Soft-sprite overdraw of all
  three meshes: 0.06 (orbit), 0.09 (flight-view globe), 0.54 (the map's globe), 0.28 (landed
  with a storm coming), 0.48 (landed in a storm; the blowing dust alone about 0.4), 0.41 driving
  in one, and at most 0.87 landed zoomed out beside one (the wall filling the view), well within
  the clouds' budget (Homestead's worst is 1.38). (Before the fronts turned streaky it was 1.41
  there.) Per-frame script for the fades, the haze and the
  dust under 0.1 ms (both layers' ~200 cells); nothing allocated. Plans take about 20 ms at load.
- **Not done:** the storms don't grow, shrink or change shape (a rigid turn is what keeps them
  free), and the horizon bank is painted on the sky, so it doesn't sit behind nearer hills
  exactly the way the real wall would (it's at the sky's distance, behind every hill).

### Misty's haze bands and methane rain (#54, stage 4)

The fourth stage (`src/world/hazeBands.js`, `src/world/rain.js`), again adding to what's there:
the approved shell and haze (#46, #58) are kept, and the rain reuses the storms' machinery.

- **Haze bands from space** (`BAND_LOOK.misty`): Titan's haze is layered, so Misty's has five
  soft bands, darker and lighter in turn, round an axis tilted towards the cameras (so from the
  flight views they're gentle arcs across the disc, not a bullseye round the middle), and a
  darker hood over the pole the cameras see. Each band's middle wobbles in a few waves round the
  axis that drift at its own speed (0.0018 to 0.0033 rad/s of real time), so they shear slowly
  past each other; the noise tile streaks them along their length and wobbles their edges, so
  they're wispy, not stripes. They're a few lines in the shell's own shader (`bandShader()`:
  an `asin`, an `atan`, two noise lookups, five bands): no mesh, no draw call, no CPU work but
  the clock. The shell was additive, which can only brighten, and the haze over the face is
  nearly saturated, so the first try barely showed; the banded shell now blends ONE /
  ONE_MINUS_SRC_ALPHA: a darker band dims the ground behind it and thins the glow, a lighter one
  adds a pale gold. With nothing darker that's exactly the old additive glow (`colour * a * a`),
  and a shell without bands keeps the old shader (a test checks). The bands are kept to the
  face (gone by 0.84 of the shell's radius): the first try ran them into the glowing ring round
  the edge, which went murky brown; the owner had approved that ring.
- **The detached haze layer:** at the edge, Titan's famous thin haze layer standing clear of the
  main haze. `rho`, how close the line of sight passes to the world's middle as a share of the
  shell's radius, is exact whatever the camera's distance (the ground's edge is always at 0.82),
  so a pale ring at 0.972 with a slightly darker gap just inside it (0.925 to 0.958) is a thin
  line at a fixed height, widened to a pixel and a half with `fwidth` (so it never shimmers)
  and dimmed to match. It's subtle: a thin line round the ring, not a second shell.
- **Showers** (`RAIN_LOOK.misty`): five regional showers shaped as the storms are (so
  `stormShapes()` / `stormAt()` serve both), two across the flight plane (a landing is in one
  now and then), two on the face, one round the back; about 6% of the surface. They turn about z
  at 0.003 rad/s of real time, a few minutes to pass over a spot. The flight scene treats them
  exactly as Dusty's storms (`createShowers()` fills `v.storms`), so `updateHaze()`,
  `updateClouds()` and `updateStorms()` needed no new paths; the only change there is that a
  hazy world's own fog closes in towards `SKY_LOOK.misty.storm.fog` in a shower (Dusty has no
  base fog, so it's unchanged).
- **Clouds and rain shafts** (`showerPlan()`): each shower is cells on a jittered grid (204
  clouds, 607 sprites in all), each a low flat soft cloud 22 m up in a warm pale cream
  (`lit` 0xf0cf9e; the first, whiter cream looked like cotton stuck on the orange), and under the
  cells well inside it two faint shafts: sprites drawn out straight down from the clouds' base
  to the ground, their own clouds based on the ground (so the layer's shader doesn't thin them
  as "below a cloud"). Seen from the side they're grey curtains under the clouds; from above,
  nothing. The layer is drawn over the haze's glow (else it's washed out). At the globe's limb
  the shafts turned into columns of grey bubbles, so a shower is weather seen from low down: its
  clouds fade out as the camera climbs from 120 to 190 m, its shafts from 60 to 110 m (a few
  multiplies per cell on top of `cloudFade()`); from space and in the map the globe shows only
  its bands.
- **Down in a shower** (`SKY_LOOK.misty.storm`): the haze dims to a duskier, greyer orange, and
  its fog (counted from what the camera follows, as always) closes in from 80 to 58 m: a mood,
  the far side of a lake still there. No bank on the horizon (the haze hides the distance).
- **Splashes on the ground, and the rain's sound** (owner's additions after the first look):
  each drop instance falls onto a spot, then lies flat there as its splash: a quick little crown
  of spray and a soft damp spot that darkens the ground and dries over 2.6 s (on a lake, its
  ring instead), all in the same loop and the same draw call. The splash must lie on the drawn
  ground, and the terrain mesh's flat triangles (about 3 m apart) differ from the smooth terrain
  function by up to ~15 cm on the dunes, so the function wouldn't do. Instead the mesh itself is
  baked once at load into a 256² cube map of heights (`groundFaces()`: each texel's ray from the
  middle through the triangle it meets; half floats, linearly filtered; about 30 to 70 ms on a
  desktop, 1.2 cm off on average), read in the vertex shader for where the drop lands and, either
  side, for the splash's tilt with the slope; it's then pulled 6 cm towards the camera so it's
  never lost between texels. The drop now stops where it lands (no fragments under the ground).
  The sound is audio.js's `setRain()`, made like the lapping: the shared noise band-passed into a
  soft hiss that swells slowly, and two loops (5.3 s and 3.7 s) of soft plips of big drops at
  random times, rendered once. Its level is `rainVolume()`: as deep as the camera is in a
  shower, full up to 15 m and gone by 60 m, 60% from the rocket's view; nothing in the map, in
  space or with no shower; through the sound-effects channel (the 🔊 switch, the lake's muffle,
  only after the unlock), checked with the lapping every 0.4 s.
- **Drops and rings** (`createRain()`): 640 drops in a 36 m box round what the camera
  follows, each a loop in the vertex shader on the real clock (as the embers): a drop falls from
  14 m above the ground there, slowly (2.6 to 3.4 m/s, Titan's rain is slow) and a little slanted
  along the drift, lands, splashes, then starts again elsewhere. Over a lake (the baked ground
  under the lakes' level) it lands on the surface and makes a ring (two soft spreading circles);
  the first version had separate ring sprites at the lakes' level, hidden under dry ground by
  the depth test, and they looked like scattered coins; now there's one ring per drop that
  really lands there. A drop is a fat soft streak (4 to 6 cm
  wide, 3.5 to 5 times as long), never thinner than a pixel (fainter instead), dropped near the
  lens and when big on screen, and thinned across the line of sight to the rocket and buggy (the
  clouds' foci). A light shower (its edge) has fewer drops, not fainter ones. One draw call,
  hidden outside a shower.
- **Cost** (measured, 844 × 390): the bands and detached layer nothing but shader lines;
  draw calls +1 on Misty below 190 m (the showers' layer; none higher up or in the map), +2 in
  a shower (e.g. landed 80 → 82, driving 132 → 134); every other world unchanged. Soft-sprite overdraw of the two new meshes: 0.07
  landed in a shower, 0.11 driving in one, 0.05 by a lake, 0.48 on the approach, 0.55 flying
  low over one, at most 0.79 landed zoomed out beside one: within the clouds' budget (1.4).
  Per-frame script (fades, haze, rain) about 0.07 to 0.13 ms against 0.05 to 0.09 before; nothing
  allocated. The plan takes about 5 ms at load, the ground's bake 30 to 70 ms (desktop). With the
  splashes the rain's overdraw went down (0.06 landed, 0.09 driving: drops no longer fall on
  under the ground), draw calls the same.
- **Not done:** the showers don't build up and rain out (a rigid turn, like the storms).
  The lighter bands show much less than the darker ones (the face's haze is nearly saturated).

### Frosty's crack mist and ice sparkles (#54, stage 5)

Frosty is airless, like Europa and Enceladus, so no weather: its "mist" is vapour breathing out
of its glowing cracks (`FROSTY_GLOWS`), where the ocean under the ice comes closest. In the
same soft style, one look, no setting.

- **Mist** (`src/world/mist.js`). 40 wisps per crack (160 on Frosty), spread evenly along the
  glowing groove (within 17 m of its middle; the groove is full to 14 m and gone by 25 m) and
  a metre across it. Each is a loop on the real clock in the vertex shader, like the embers: it
  seeps out with its soft bottom edge about on the ground, drifts 2.5 to 6 m off to one side
  (slowing) while curling round in a lazy loop, lifts only 0.4 to 1.6 m, spreads to 2.4 times
  its size and thins away, then starts again somewhere new along its stretch. It rides at the
  height of the highest ground round its stretch, out to most of the way it drifts (the
  terrain's own heights, as the buggy uses), so it never starts in the ice or drifts into a bank
  beside the crack (the drawn mesh is too coarse to show the 1.5 m groove anyway). Wisps are
  drawn squashed along the screen's "up" (flat to the ground seen side-on, round from above),
  their bottom third fading out (a soft sprite dipping into a bank of ice showed a hard straight
  edge), and eaten well into by the clouds' noise tile, turning slowly, so they read as
  feathered wisps, not balls.
- **Day and night.** By night (`mistStrength()`: the sun's height where the wisp is) the mist
  shows in full, moonlit pale blue, tinted the cracks' cyan from below within 2.5 m of the
  ground; in full sun only a tenth of it, sunlit white (faint wisps over the bright ice).
- **Plumes** (`MIST_LOOK.frosty.plume`), like Enceladus's "tiger stripe" geysers: six vents on
  the cracks' middle lines (one or two per crack) each send up a stream of 28 puffs in the same
  mesh. A puff shoots up from its vent, slowing as it climbs 38 to 58 m, fanning out its own way
  (4 to 9 m by the top) and growing seven times as it thins away; each plume's puffs share one
  climb time and are spread evenly through it, so the column is always full. They're drawn
  stretched upwards (2.4 times, seen side-on) with the noise tile streaked along the way they
  rise, so they read as thin feathered jets, not blobs, also at the world's edge. Lit by where
  each puff really is (`sunlit()`: only the planet's shadow is dark), so over the night side a
  plume is moonlit pale blue low down and shines where it rises into sunlight; faint cyan at
  its foot at night, 45% by day. They last out to 420 to 900 m (approach and low orbit: faint
  streaks rising from the surface; the globe: only a hint). (A first try was dropped for looking
  like the rocket's smoke behind a landed rocket; the owner asked for them anyway.)
- **Ice sparkles** (`SPARKLE` in `src/world/richLook.js`, only with `#define RL_SPARKLE`, so only
  Frosty's ground shader has them; every other world's is byte-for-byte what it was). One glint
  spot per cell of a grid on the ground, at a random point in it (3D cells, so the ground only
  passes near some spots, which scatters them); a spot flashes when its facet (the ground's
  normal tilted at random, wobbling a little in time) mirrors the sun into the camera, so they
  twinkle as the camera moves and a little on their own. Only on sunlit ice (not the night side,
  the tan patches or the cracks). Frosty's lit ice is nearly white, so a white glint didn't show
  at all: each glint is a small four-pointed star a few pixels across, measured in screen pixels
  (the ground's per-pixel metres from `dFdx`/`dFdy`, a 2 × 2 solve), in icy colours (cyan, ice
  blue, some lilac, a little gold). The grid doubles with distance, cross-faded like a mip
  chain (`sparkleCell()`), so spots stay about 20 CSS pixels apart at any distance (sized in CSS
  pixels, so as big on a phone's sharp screen), and fade out as a pixel grows past 0.25 to 1.4 m:
  all of them landed and driving, a few faint ones on approach and in low orbit, none on the globe.
- **Cost** (measured, 844 × 390): draw calls +1 on Frosty (the mist and plumes are one mesh; e.g.
  80 → 81 landed, 68 → 69 driving), 656 triangles (328 sprites); no per-frame CPU work beyond a
  few uniforms (the clouds' foci are shared), nothing allocated. Overdraw of mist and plumes
  (whole sprite discs, an upper bound): 0.14 to 0.36 of a screen landed, 0.29 to 0.51 driving by
  a crack (the most parked right on it), 0.18 on approach, 0.05 in low orbit, 0.01 at the globe. The sparkles are two glint lookups
  (a few hashes each) per lit ice pixel of Frosty's ground; no difference showed in frame time in
  SwiftShader (the noise between runs was bigger).
- **Not done:** the mist doesn't know about the drawn mesh's exact shape, so a wisp can hover a
  little over a hollow, and seen across a rise the wisps over a crack beyond it float above the
  skyline like low streaks of cloud; it doesn't react to the buggy driving through
  it (it fades near the lens and in front of the buggy instead).

### Tumble's and Ringo's bright streaks and limb haze (#54, stage 6)

The last stage: the two gas giants, all in their existing shaders (no mesh, no draw call).
Their approved looks are kept: Ringo's storms and ring shadows, Tumble's dark spot and its
hexagon (#55), which are drawn over the streaks.

- **Bright cloud streaks** (`GAS_LOOK.*.streaks`, `gStreaks()` in `gasColor()`): five on Ringo
  (Saturn's white spots and streaks) and six on Tumble (Uranus's bright methane-ice clouds),
  each at a latitude along the spin axis, travelling round with its band (a whole number of
  turns per wrap of the cloud clock, `CLOUD_WRAP`, so it never jumps). Long ones (0.6 to 0.9
  radians) bow a little across the band; short ones (about 0.2) are bright spots. Across a
  streak a soft profile is eaten into by the noise tile, and it thins and fades towards its
  ends, so it reads as a feathered wisp, not a stripe. Tumble's are placed on the side the
  cameras see (its seen pole is +axis), between its dark spot and the hexagon (a test keeps
  them clear), and tinted a little cool, since white under Ember's warm light read as peach.
- **High-altitude haze at the limb** (`GAS_LOOK.*.haze`): warm pale gold on Ringo, pale cyan on
  Tumble. On the disc (`LIMB_VEIL`, `veilAt()`) a sunlit veil of it is laid over the clouds
  towards the limb, washing them out a little, never over the hexagon. Just off the limb the
  gas giants' glowing shell (planets.js `atmosphere()`, its new `limb` option,
  `limbHazeAt()`) adds the haze hugging the cloud tops and a thin detached layer standing
  clear of it, widened to a pixel and a half with `fwidth` so it never shimmers. The shell
  keeps its additive blending; every other world's shell is the same shader as before.
- **Cost:** a few lines of shader per pixel of the two giants (up to six short loops, early
  outs for pixels nowhere near a streak); no draw calls, uniforms only.
- **Not done:** on pale Tumble the streaks are subtle; the detached layer is faint at the
  distances the flight views usually show.

## Yonder, far out (#62)

The owner asked for a Pluto-like world noticeably further out than everything else, for a sense
of scale, built in stages (#62). Stage 1 is the world, its orbit and feeling the distance; the
heart plain, mountains and glaciers, the blue haze, its big twin moon Hither and slingshots
come later.

- **The orbit** (`bodies.js`): a stretched Kepler ellipse round Ember like Ducky's (`ecc`,
  `periArg`), close in 80,000, far out 140,000, 110,000 on average: twice Tumble's. Like Pluto
  it comes in near Tumble's orbit, but its closest is still 24,000 from it, far outside both
  spheres of influence (a test steps 50 laps). One lap is about 22,900 game seconds (6.4 h);
  at t = 0 it's about 89,000 out, low on the left of the system map, on its way in. Trips
  there from Homestead take 2,700 to 16,000 game seconds depending on the window (a 🤖 trip
  speeds time up to ×1000, so seconds to a quarter of a minute of real time).
- **The world**: radius 170 (a bit bigger than Frosty), gravity 2.4, SOI 3,000 (inside its
  Laplace sphere even at its closest). `makeYonder()` in `terrain.js`: smooth creamy nitrogen-ice
  plains with faint peach tints, bluish frost towards the poles, and a belt of dark reddish-brown
  tholin lands round its middle (like Cthulhu on Pluto) broken into big patches by wide-edged
  noise, with a peach edge. The belt follows `YONDER_AXIS` (`SPIN_AXES.yonder`), tipped like
  Pluto's so the pale pole faces the camera. The dark lands are the old ground: hillier, with a
  few soft craters; the plains are young and smooth. At most about 4 m high or 3 m deep, so it's
  gentle to land on and drive. Airless for the rocket's exhaust (its thin air and blue haze come
  later). Its own `ROCKY_LOOK` (cool rim, bluish-grey slopes) and `DETAIL` 44.
- **Dwarf, not planet** (`dwarf: true`): the map's default view of the system (`SYSTEM_VIEW`)
  stays the planets', the one a new player knows, with Yonder a far dot at its edge on a wide
  screen; the map zooms out to its whole orbit (`SYSTEM_EXTENT` 145,000).
- **Feeling the distance** (`FAR_LIGHT`, `farLight()` in `planets.js`,
  `FlightScene.updateFarLight()`): past 66,000 from Ember, fully by 76,000, the sunlight is dim
  (0.62 of the usual at Yonder's closest, 0.5 at its farthest) and a cooler white, and the sky's
  fill light is halved; in the flight and drive views Ember shrinks to a small white-hot disc with
  a four-pointed glint a steady size on screen (a sprite, hidden until then): a very bright star.
  It follows the rocket or buggy (on the map, the world it frames; the map draws Ember as usual).
  Nothing else ever gets that far out (Tumble's SOI, the furthest, ends at 63,000), so every
  other world's light and look is exactly as before (tested). Pip's first-visit sticker line
  notices it: "We're so far from home that Ember looks like a tiny star."
- **Getting there**: 🤖 Take me there and 🧭 Show me how use the comet's window search for
  stretched orbits (`stretchedWindow()`). The first windows tried showed that a far target can
  be a knife-edge (a path just grazing Ringo's pull): the real, not instant, burn missed and
  burning on made it worse. So a burn stops once, past the planned push, the prediction gets
  worse (the corrections on the way fix a near miss), and if no path is found near a stretched
  orbit's window, the planner tries the next two windows. There's no fuel, so any rocket that
  can fly can get there; a rocket that barely lifts off (tested) goes there and on to Pebble.
- **Cost**: Yonder's globe (about 40,000 triangles, one draw call plus ink) and rocks only draw
  when it's on screen; its orbit line is one more line (+1 draw call, 4,320 triangles in every
  view); Ember's glint is one sprite, only drawn far out. Nothing per frame but a few
  multiplies (the light is only touched when it changes).

### Yonder's heart, mountains, glaciers and blue haze (#62, stage 2)

- **The heart** (`YONDER_HEART`, `heartDist()` in terrain.js): a cartoon heart (two round lobes and
  a point, a signed-distance shape) laid on the ground in its own frame (`heartAt()` /
  `heartDir()`, true distances from its middle), placed well in on the side the cameras see and
  upright on the map (`up` is the map's +y). It doesn't reach the flight plane; the buggy drives
  to it from the landing strip. An earlier try crossed the plane, but near the limb the heart was
  foreshortened and tilted and no longer read as a heart.
- **The basin** (its left lobe, like Sputnik Planitia): smooth, pale nitrogen ice 1.8 m below the
  uplands, with **convection cells** in the ground shader (`HEART_LOOK`, `cellAt()`,
  `#define RL_HEART`, from marks baked per vertex, `marks()`): cells round slowly wandering
  middles, a little domed, with dark troughs, churning like a lava lamp on the real clock;
  antialiased with `fwidth`, faded out when only a few pixels across. The right lobe is mottled
  frost on higher ground.
- **Glaciers** (`YONDER_GLACIERS`): three tongues flowing from the right lobe's uplands west
  down into the basin, square to its shore, sliding smoothly downhill, with flow lines drawn
  along them.
- **Ice mountains** (like the Tenzing and Hillary Montes): five craggy blocks with flat tilted
  tops, 8 to 14 m tall, just outside the heart's west side, clear of the flight plane, and bare
  of boulders. The dark lands (tholin) reach up to the heart's west, like Cthulhu beside
  Pluto's; they only count near the heart (far round the world its frame still says "west",
  which once put a steep crater on the landing strip).
- **Finding it** (`find-heart`): by seeing it, like the Hexagon Hunter (#55): its middle on
  screen and clear of the buttons, facing us, at least 20 px (half its height). That's the map
  zoomed in on Yonder or close flight views; not the default map, nor from its far side.
- **The blue haze** (`HAZE_LAYERS`, `blueHazeAt()`, planets.js `hazeLayers()`): Pluto's thin
  layered blue haze from New Horizons' backlit picture: a soft glow hugging the ground and a
  few thin detached layers, only seen from space, brightest backlit. It's visual only: Yonder
  stays airless for the rocket's exhaust (#60). It's a shell of its own, one draw call.
- **Cost:** the mesh detail went to 56 (the mountains' steep sides need it); the cells and flow
  lines are shader lines on Yonder only; the haze is one draw call. Other worlds are unchanged.

## Ideas for later

Tracked as [GitHub Issues](https://github.com/malfernion/worldVoyager/issues).
