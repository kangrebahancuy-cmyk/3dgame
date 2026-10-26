# 3DGAME — smooth character movement prototype

Browser prototype of an Albion-Online-inspired fantasy MMORPG: one playable 3D character, an isometric follow
camera and the first playable forest map (64 × 64 m, Kenney Nature Kit). Babylon.js + TypeScript + Vite. No backend.
The map is described in [docs/FOREST_MAP.md](docs/FOREST_MAP.md).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build (http://localhost:4173)
npm test           # 46 unit tests: movement, collision, camera, blending, GLB, forest layout, reachability
npm run catalog    # re-verify the Kenney models and regenerate src/world/forest/NatureCatalog.ts
```

Requires Node 18+ and a WebGL-capable browser (developed for desktop Chrome on Windows).

## Controls

| Input | Action |
|---|---|
| `W A S D` / arrow keys | move (relative to the camera; diagonals are normalised) |
| `Shift` (hold) | walk instead of run |
| Mouse wheel | zoom the camera |
| Restart button | put the character back at the start |

## What is implemented

* Acceleration/deceleration with exponential smoothing; exact stop (no sliding); smooth turning along the shortest arc with a rate cap.
* Frame-rate-independent: delta time is clamped, damping uses `exp(-λ·dt)`, movement is sub-stepped for collision.
* Same speed in all directions (input is normalised, not clamped per axis).
* Idle / Walk / Run blended by actual ground speed; gait cadence tied to ground speed (no foot sliding).
* Collision with tree trunks and large rocks only (circle colliders, slide along them) and the square map boundary.
* Flat ground (`TERRAIN_AMPLITUDE = 0`); feet and camera clearance still use the same analytic height function.
* First forest map: 4 dirt paths, spawn clearing, ~1000 real Kenney objects as instances, painted forest floor, exit placeholders.
* Isometric camera (45° azimuth, 50° elevation), smoothed follow, terrain clearance, wheel zoom.
* Directional sun + hemispheric ambient, PCF shadows, fog. HUD: title, FPS, controls, restart, loading bar, error panel with retry.

## Layout

```
src/
  config.ts                 every tunable value (speeds, smoothing, camera, world)
  main.ts                   bootstrap + global error handlers
  core/Game.ts              engine, scene, frame loop, restart, loading/error flow
  input/InputController.ts  keyboard + wheel
  character/
    MovementModel.ts        pure: accel/decel, turning, collision sub-stepping
    AnimationBlender.ts     pure: sample + blend Idle/Walk/Run, gait phase
    CharacterLoader.ts      GLB loading, forward/ground detection, clip extraction (replaceable model)
    CharacterAnimator.ts    writes the blended pose into the bones (the only animation controller)
    Player.ts               ties movement + animation to the Babylon node
  camera/FollowRig.ts       pure follow/zoom/clearance math + camera-relative input
  camera/GameCamera.ts      Babylon ArcRotateCamera adapter
  world/terrain.ts          analytic height (flat for the forest map)
  world/collision.ts        pure circle colliders + rectangular map bounds
  world/rng.ts              seeded PRNG
  world/World.ts            lights, shadows, fog, collision world; delegates the level to ForestMap
  world/forest/
    MapConfiguration.ts     the map as data: size, spawn, clearing, paths, exits, seed
    PathNetwork.ts          pure: Catmull-Rom paths + distance queries (shared by painter, layout, tests)
    ForestLayout.ts         pure: deterministic placement of trees/rocks/undergrowth + collision circles
    NatureCatalog.ts        GENERATED from the real GLBs (size, trunk radius, hash); NatureTypes.ts, NaturePalette.ts
    NatureAssetLoader.ts    loads each GLB once, bakes it into one mesh, places instances, reports exact file + error
    GroundPainter.ts        Canvas2D forest floor (grass, dirt paths, clearing, leaf litter)
    ForestMap.ts            Babylon glue: ground quads, populate, collision, shadow extents
  ui/Hud.ts                 DOM overlay
tools/                      FBX→GLB converter, gait generator, nature_catalog.py, map_preview.py, layout_plot.py (Python)
tests/                      node:test suites (run with tsx)
public/models/hero.glb      converted player model with Idle/Walk/Run (+ hero.meta.json)
public/models/nature/       the 148 verified Kenney GLBs (106 placed in the layout; byte-identical copies written by `npm run catalog`)
docs/ASSETS.md              asset inspection, selection and conversion report
```

Everything marked "pure" has no engine imports and is unit-tested in Node, including against the real clips inside `hero.glb`.

## Replacing the character

Point `character.modelUrl` in `src/config.ts` at another GLB (same rig or not). The loader needs a single skinned
skeleton and animation clips named `Idle`, `Walk` and `Run`, plus `<model>.meta.json` with each clip's
`distancePerCycle`. Facing direction and ground contact are measured from the model (`foot.*`/`toe.*` bones and the
bounding box); use `yawOffsetRad` / `groundOffset` if a model needs extra correction. To convert another character of the
same pack: `python3 tools/fbx_to_glb.py <character.fbx> <texture.png> public/models/<name>.glb`.

## Verification status — read this

Verified here (sandbox with no npm registry access):

* All pure-logic modules type-check under `strict` TypeScript and **46/46 unit tests pass** (`npm test`), including: catalog vs. the real GLB files (size, SHA-1, no external URIs, public copy identical), deterministic layout, no overlapping solids, ≥ 1.06 m between any two solids, free clearing and path corridors, flood-fill reachability of all four exits and of > 97 % of the free ground, the real `MovementModel` walking every path to its exit without touching an obstacle, and sliding along a tree.
* The ground painter was run in headless Chromium (Canvas2D) and looked at; the forest was rendered offline **from the real GLB files** with `tools/map_preview.py` (`docs/forest-preview.png`, collision circles checked against the trunks). That renderer is *not* Babylon: no shadows, no fog, different lighting.
* `hero.glb` structure, skinning data, texture, clip looping and gait foot-planting (`docs/clips-preview.png`).

**Not verified here:** `npm install`, `npm run dev`, `npm run build`, the Babylon.js / Vite glue (`CharacterLoader`, `World`, `ForestMap`,
`NatureAssetLoader`, `GameCamera`, `Game`, …) and any real browser run of the game. The sandbox blocks the npm registry (HTTP 403), so Babylon.js and Vite
could not be installed and those files were never compiled against Babylon or executed (they were only type-checked against loose stubs, which catches
typos and unused code but not wrong Babylon API use). Run `npm install && npm run build && npm run dev` and expect to fix small API or type mismatches,
then use `window.__game.getState()` in the console to inspect position, speed, blend weights and camera while testing.
