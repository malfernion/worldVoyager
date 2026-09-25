# 🚀 World Voyager

A tiny space adventure for small explorers. Build a wooden rocket by the campfire, blast off,
get into orbit, and fly to moons and planets with real orbital mechanics. Pip will help as much
(or as little) as you like.

Built with [three.js](https://threejs.org), runs in the browser, and works on phones and tablets.

## How to play

- **Workshop:** tap a part to add it, or drag it onto the rocket. Tap a part on the rocket to
  paint it. Drag a part off the rocket to throw it away. 🎲 builds a surprise rocket.
- **Fly:** ⟲ ⟳ turn, hold **GO** to fire the engine. 🗺️ opens the map, ⏩ speeds up time,
  ↺ rewinds a few seconds.
- **Zoom:** pinch, scroll, or the slider on the right. The camera follows further back as you
  climb, but you can always zoom right up to the rocket (about 12 m) or out to see a whole
  world; on the map, from one world up close out to the whole solar system.
- **🧭 Coach switch** (first of the helper buttons): choose how the helpers help. It's remembered.
  - **On** (bright, green light): "I'll tell you when to hold GO!" You fly: an arrow shows
    where to point, the right turn button glows, and GO says HOLD! / LET GO!.
  - **Off** (dim): "I'll fly, you watch!" The helpers fly the rocket for you.
  On your very first launch Pip offers it ("Tap the compass!"); tapping it then starts a
  coached launch into orbit. Flipping it while a helper is running switches that helper over.
- **Helpers:** 🌀 Orbit, 🛬 Land (tap again to stop), ⏫ Faster / ⏬ Slower (hold; always flown
  for you). They sit in a row between the turn buttons and GO (just above them on narrow
  phones). Only the useful ones show: on the ground that's 🧭, 🌀 Orbit and 🚙 Drive; Land,
  Faster and Slower appear once you're flying. With the coach on, Orbit teaches the launch
  and Land teaches the landing: point up at the arrow, then HOLD / LET GO to keep the descent
  gentle (Pip steps in if it gets too fast). After a crash only the three choices show: go
  back, launch pad, or build.
- **Go somewhere:** open the map, tap a world, then the trip button: **🧭 Let's go!** with the
  coach on (you fly there and land, Pip tells you how) or **🤖 Take me there!** with it off
  (Pip flies, you watch). Tap it again (✋ Stop) to stop.
- **Buggy:** add a **Garage** to your rocket and pick a Rover, Monster Truck or Hopper (and
  its colour). After landing, tap 🚙 **Drive** to roll out and explore the whole world. The
  compass points back to your rocket, and 🏠 takes you home. Bonk! Trees and moon rocks are
  in the way: back up and steer around them (or hop over the small ones). (Psst: on tiny
  Nibble, drive the Hopper really fast, then jump and hold it…)
- **Keyboard:** ←/→ or A/D turn, Space/↑/W fire, M map, `.`/`,` warp, `/` normal speed,
  R rewind, O orbit, L land, B buggy out / home. When driving: ↑/W go, ↓/S reverse,
  Space jump (Hopper).

The farthest world is **Tumble**, a sideways ice giant. Its moon **Flip** goes round the wrong
way, so to catch it you have to go round Tumble backwards too (Pip turns you round if you
don't).

**Ducky** is a comet shaped like a rubber duck, on a long, stretched orbit: it zooms in close
to Ember (and grows a tail that always points away from it), then drifts slowly out past
Ringo. It's tiny and hard to catch, so Pip waits for a good moment to set off, and when you
get close Pip steers you in. Drive over its fizzy gas jets and they'll bounce your buggy up!

**Discoveries:** little secrets hide around the solar system, each one a real bit of space
science: an old observatory on a hill near home, footprints and a flag and a shiny laser mirror
on Pebble, a sleepy rover and swirly dust devils on Dusty, Nibble's giant crater, the gap
between Ringo and its rings, Sizzle's biggest volcano, Frosty's glowing cracks (park by one
at night), Ember's solar flares (fly close, not too close), Flip's dark geyser streaks and a
little lander hiding in the shade on Ducky. While you drive, a ✨ next to the rocket compass
points to the nearest secret still to find on that world, and grows and twinkles as you get
close. Finding one plays a chime, pops a sticker and Pip tells you the real fact.

Collect stickers for reaching space, orbiting, landing on every world and your discoveries. Tap
a world in the 📖 sticker book to hear a real space fact. Tap a discovery to hear its fact
again, or a ❓ one for a hint from Pip.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173 (also on your LAN for phone testing)
npm test         # physics, autopilot missions, coach-mode flights, buggy, discoveries
npm run build    # static site in dist/
npm run stress   # fly "take me there" between every pair of worlds and count failures
```

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`: tests → build → GitHub Pages.
In the repo settings, set **Pages → Source** to **GitHub Actions**.

See [docs/DESIGN.md](docs/DESIGN.md) for the research, design and architecture notes.

## Backlog

Planned work and ideas live in [GitHub Issues](https://github.com/malfernion/worldVoyager/issues),
labelled `visuals`, `gameplay`, `audio`, `polish` and `devices`. The order is in the pinned
[Roadmap issue](https://github.com/malfernion/worldVoyager/issues/17).

Working on the code (human or AI agent)? Start with [AGENTS.md](AGENTS.md).
