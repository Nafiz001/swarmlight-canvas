# Swarmlight

A survivors-like where you are the last light — 1,500 enemies at 60 fps on a single canvas, zero dependencies.

**Play it:** https://nafiz001.github.io/swarmlight-canvas/

You are a lantern-spirit holding back a tide of darkness for ten minutes. Your weapons fire on their own; you decide where to stand and what to become. Everything on screen — every sprite, every glow, every sound — is generated in code at runtime. The `dependencies` field in `package.json` is empty, and the production bundle is 54 kB (18.5 kB gzipped).

## Features

- Ten-minute arena survival with a data-driven difficulty curve: 8 wave phases, 5 surge events, and bosses at 5:00 and 9:30
- Five auto-firing weapons with 5 levels each: piercing bolts, orbiting wards, radial novas, homing wisps and chain lightning
- Five stacking passives, level-up draft (3 weighted cards, no duplicates, hard caps), and elite enemies that drop free level-ups
- Five enemy archetypes with distinct behavior, including a telegraph-then-dash attacker and a splitter that bursts into swarmers
- Seeded runs: a Daily Run seeded from the UTC date, plus `?seed=` URL sharing — wave composition and upgrade drafts are fully deterministic per seed no matter how the run is played, verified by cross-input tests
- Synthesized audio: every effect from shot blips to the boss roar is built from oscillators and filtered noise at runtime, no audio files
- Procedural art: pre-baked glow atlases, an infinite hash-based parallax starfield, pooled damage numbers drawn from a digit atlas
- Performance HUD (F3): fps, frame-time sparkline, live entity counts, spatial-hash pair checks per frame and pool utilization
- Touch support via a procedurally drawn virtual joystick; best-run stats persisted to versioned localStorage

## Tech stack

| Layer       | Choice                                | Why                                                        |
| ----------- | ------------------------------------- | ---------------------------------------------------------- |
| Language    | TypeScript 5.9, `strict` + `noUncheckedIndexedAccess` | Hot-loop indexing must be an explicit, visible assertion, never a silent assumption |
| Build       | Vite 7                                | Instant dev server, `base: './'` build runs on any static host |
| Rendering   | Canvas2D, hand-rolled                 | The constraint is the point — no engine, no WebGL          |
| Audio       | Web Audio API                         | Oscillators + noise buffers, created after first gesture   |
| Tests       | Vitest 3, node environment            | The whole simulation runs headless — see `tests/game.test.ts` |
| Runtime deps| none                                  | `"dependencies": {}`                                       |

## The three hardest problems

### 1. 1,500 enemies that don't walk through each other

Collision is the classic survivors-like killer. Three systems need to ask "what is near this point?" every frame: projectile hits, player contact, and enemy-vs-enemy separation (the thing that makes a horde look like a crowd instead of a stack of paper dolls). Naively, separation alone for 1,500 enemies is ~1.1 million pairwise distance checks per frame. At 60 fps that budget does not exist.

The fix is a uniform-grid spatial hash (`engine/spatialHash.ts`), rebuilt from scratch every frame — clearing and re-inserting 1,500 circles is far cheaper than maintaining an incremental structure. Entities live in flat `Float32Array`s; buckets map a packed 32-bit cell key to slot indices, and bucket arrays are reused across frames so steady-state operation allocates nothing. The hash tracks which buckets were written each frame, so `clear()` resets exactly those — its cost follows the live entity count, not every cell ever visited — and when a long wandering run grows the visited-cell set past a bound, the bucket map is evicted wholesale and rebuilt from the working set. Cell size was tuned to 48 px (about 2× the median enemy diameter): smaller cells meant more bucket writes per insert, larger cells meant more false candidates per query. An entity spanning multiple cells would be reported once per cell, so queries dedup with a generation stamp — one integer compare per candidate instead of building a `Set` per query.

Two gameplay-level tricks cut the remaining cost. Each enemy caps separation at 6 neighbors (the 7th overlapping neighbor changes nothing visually), and separation runs on alternating frames for each half of the horde with doubled strength — same equilibrium, half the queries. The F3 HUD displays pair checks live: a saturated 2,000-enemy horde against a fully maxed build averages ~42k checks per frame, with peaks near 200k when a full flight of homing wisps retargets inside the swarm — versus well over a million for brute force. Because the simulation is deterministic, those are exact reproductions, not wall-clock estimates: a headless benchmark in the test suite replays that scene and asserts the counter stays under 60k average / 250k peak.

### 2. Making 1,500 things glow without `shadowBlur`

The art direction calls for everything to glow — and Canvas2D has an API for that, `ctx.shadowBlur`, which is a trap. It applies a Gaussian blur per draw call; a few hundred shadowed draws costs tens of milliseconds and scales with blur radius. My first prototype spent ~40 ms per frame on rendering alone with a fraction of the target entity count.

The replacement is a boot-time sprite atlas (`render/sprites.ts`). Every archetype gets three small offscreen canvases: a dark silhouette with a colored rim and eyes, a white version for hit-flashes, and a radial-gradient glow. The render loop is then two batched passes: all silhouettes with default compositing, then one switch to `globalCompositeOperation = 'lighter'` for every glow, projectile, gem, and particle in the scene — additive blending makes overlapping glows brighten naturally, which is what sells the swarm-of-embers look. The only per-frame geometry is a handful of shockwave rings and the chain-lightning polylines (drawn as a wide soft stroke under a bright core stroke — a fake glow that costs two path strokes). The same scene that took ~40 ms renders in under 6 ms on the same machine: ~6,000 `drawImage` calls of pre-baked sprites per frame is comfortable for Canvas2D; per-pixel filter work is not.

Even the damage numbers avoid text rendering: digits 0–9 are rasterized into an atlas once, and values are decomposed numerically (`value % 10` in a loop) so drawing a number allocates no string.

### 3. Zero allocations in steady state

A GC pause at 60 fps is a dropped frame, and a survivors-like generates brutal object churn: hundreds of enemies, projectiles and particles born and dying every second. The discipline that fixed it has three parts.

First, generational pools (`engine/pool.ts`): live objects occupy `items[0..liveCount-1]`, and release is an O(1) swap-remove that parks the object just past the boundary, where the next acquire reuses it. Releasing during reverse iteration is safe by construction. Second, particles don't deserve objects at all — `engine/particles.ts` is struct-of-arrays over nine preallocated typed arrays; spawning writes fields at an index, death is a swap of array slots. Third, every hot query writes into a reused scratch buffer (`out.length = 0` then push) instead of returning fresh arrays, and the few callbacks passed into hot loops are hoisted to fields so no closures are created per frame.

The honest caveats are documented because they are part of the engineering story: pools grow during the opening ramp (capacity is amortized — the enemy pool reaches its working set in the first minutes and never shrinks), `Map` bucket creation in the spatial hash happens only when the camera reaches virgin cells, and a run that wanders very far triggers an occasional wholesale bucket eviction (one Map clear, then the working set reallocates) so memory stays bounded instead of accreting every cell ever visited. After warm-up, a heap snapshot during a max-density scene shows a flat sawtooth-free allocation profile. Supporting decisions follow the same rule: enemies that fall too far behind are teleported back to the spawn ring instead of being freed and respawned, and when the gem pool saturates, new XP folds into a random live gem — or is granted directly if no gem is live — rather than allocating past the cap.

## How it works

The simulation never touches the DOM. `src/game/` and `src/engine/` (minus the browser adapters: input, audio, and the rAF loop) are pure logic over pools and typed arrays — `main.ts` injects an input frame each tick and subscribes to a narrow event interface for audio and UI. This is why the entire game, including a five-second bot run to game-over, executes under Vitest in node.

- `engine/loop.ts` — fixed 60 Hz accumulator, clamped to 250 ms so a backgrounded tab can never trigger a catch-up spiral; render interpolation alpha; `timeScale` drives the 0.05× level-up slow-mo
- `game/game.ts` — the orchestrator: a state machine (`title / running / levelup / paused / gameover / victory`) over a frame pipeline: spawn → rebuild hash → weapons → projectiles → enemies → pickups → particles → death sweep. Deaths are swept only after all hash queries complete, so slot ids stay valid for exactly one frame
- `game/waves.ts` — the difficulty curve as data: contiguous phases with rising spawn budget, surge events, boss schedule. Tests assert monotonicity and boss timing
- `game/weapons.ts` — weapon definitions and firing logic against a `CombatWorld` interface that `Game` implements, so weapon behavior is isolated and testable
- `render/renderer.ts` — camera with shake and interpolated follow, culled batched draws in the order: dust, gems, enemies, player, projectiles, particles, damage numbers; baked vignette
- `ui/` — DOM overlays (title, level-up draft, pause, results) with hand-written CSS; HUD writes to the DOM only when a displayed value changes

Determinism: three independent `mulberry32` streams are seeded from the run seed. The schedule stream is consumed only by the time-driven spawn schedule (wave composition, elite rolls, spawn positions), the draft stream only by upgrade hands, and everything whose draw count depends on moment-to-moment play — loot rolls, particles, bob phases, off-screen repositions — rides a separate fx stream. The spawn ring is a fixed design-resolution constant, never the live viewport. So two players on the same seed face the same waves, the same elites and the same Nth draft hand regardless of how they play, on any window size — asserted by cross-input tests. (Entity positions still diverge with input, of course: `?seed=` shares the challenge, not a replay.)

## Project structure

```
swarmlight-canvas/
├── index.html                 inline SVG favicon, OG tags, two DOM roots
├── src/
│   ├── main.ts                bootstrap: resize/DPR, wiring, run lifecycle
│   ├── storage.ts             versioned localStorage (swarmlight.v1), guarded
│   ├── engine/
│   │   ├── loop.ts            fixed-timestep loop, accumulator clamp, timescale
│   │   ├── input.ts           keyboard + virtual joystick, blur-clears-keys
│   │   ├── rng.ts             mulberry32 PRNG, FNV-1a string hashing
│   │   ├── pool.ts            generic swap-remove object pool
│   │   ├── spatialHash.ts     uniform grid, SoA storage, stamp dedup
│   │   ├── particles.ts       SoA particle system, zero per-frame allocation
│   │   └── audio.ts           synthesized SFX, lazy AudioContext, throttling
│   ├── game/
│   │   ├── game.ts            state machine + frame pipeline (CombatWorld)
│   │   ├── player.ts          stats, XP curve, passive scaling
│   │   ├── enemies.ts         archetype data, steering, separation
│   │   ├── projectiles.ts     pooled projectiles, homing steer
│   │   ├── weapons.ts         five weapons × five levels, data-driven
│   │   ├── upgrades.ts        weighted draft without replacement
│   │   ├── waves.ts           wave table, surges, bosses, scaling
│   │   ├── pickups.ts         gems, heals, magnet, starfall, prism
│   │   ├── damageNumbers.ts   pooled, hard-capped floating numbers
│   │   └── effects.ts         shockwave rings, arc polylines
│   ├── render/
│   │   ├── sprites.ts         boot-time atlas: glows, silhouettes, digits
│   │   └── renderer.ts        camera, starfield, batched passes, culling
│   ├── ui/
│   │   ├── styles.css         all styling, hand-written
│   │   ├── hud.ts             change-gated HUD updates
│   │   └── screens.ts         title / draft / pause / result overlays
│   └── debug/
│       └── perfHud.ts         F3: fps, sparkline, counts, pair checks
└── tests/                     9 suites, 67 tests, node environment
```

## Controls

| Input                  | Action                          |
| ---------------------- | ------------------------------- |
| WASD / arrow keys      | Move (diagonals normalized)     |
| Touch, left half       | Virtual joystick                |
| 1 / 2 / 3 or click     | Pick a level-up card            |
| P or Esc               | Pause / resume                  |
| M                      | Mute (persisted)                |
| F3                     | Performance HUD                 |

## Getting started

Requires Node 22+.

```
npm install
npm run dev        # dev server with HMR
npm test           # vitest, node environment
npm run build      # tsc --noEmit, then vite build into dist/
npm run preview    # serve the production build locally
```

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes `dist/` to GitHub Pages (enable Pages with "GitHub Actions" as the source in the repository settings once). Because the Vite base is `'./'`, the same `dist/` output also deploys unchanged to Cloudflare Pages — point it at the repo with build command `npm run build` and output directory `dist`.

## License

MIT © 2026 Md. Nafiz Ahmed
