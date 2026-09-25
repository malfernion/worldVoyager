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
- **Go somewhere:** open the map and tap a world.
  - **🧭 Show me how:** Pip tells you when to turn and when to burn. You fly!
  - **🤖 Fly me there:** Pip flies, you watch.
- **Helpers:** 🌀 Orbit, ⏫ Faster / ⏬ Slower (hold), 🛬 Land. After a "Show me how" trip, Pip
  carries straight on and coaches the landing too: point up at the arrow, then HOLD / LET GO to
  keep the descent gentle (Pip steps in if it gets too fast). Land coaches you if you've been
  using "Show me how"; tap it again to let Pip land for you.
- **Buggy:** add a **Garage** to your rocket and pick a Rover, Monster Truck or Hopper (and
  its colour). After landing, tap 🚙 **Drive** to roll out and explore the whole world. The
  compass points back to your rocket, and 🏠 takes you home.
- **Keyboard:** ←/→ or A/D turn, Space/↑/W fire, M map, `.`/`,` warp, `/` normal speed,
  R rewind, O orbit, L land, B buggy out / home. When driving: ↑/W go, ↓/S reverse,
  Space jump (Hopper).

Collect stickers for reaching space, orbiting, and landing on every world. Tap a world in the 📖
sticker book to hear a real space fact.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173 (also on your LAN for phone testing)
npm test         # physics, autopilot missions, coach-mode flights
npm run build    # static site in dist/
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
