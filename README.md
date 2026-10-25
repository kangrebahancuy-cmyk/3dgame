# 3DGAME — smooth character movement prototype

Browser prototype of an Albion-Online-inspired fantasy MMORPG: one playable 3D character, an isometric follow
camera and a small test world. Babylon.js + TypeScript + Vite. No backend.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build (http://localhost:4173)
npm test           # 34 unit tests of movement, collision, camera, blending, terrain and the GLB
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
* Collision with trees, rocks and bushes (circle colliders, slide along them) and a circular world boundary.
* Grounding from the same analytic height function that builds the terrain mesh.
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
  world/terrain.ts          analytic height + terrain mesh data
  world/collision.ts        pure circle colliders
  world/layout.ts           deterministic prop placement
  world/World.ts            ground, lights, shadows, low-poly props
  ui/Hud.ts                 DOM overlay
tools/                      FBX→GLB converter, gait generator, software preview (Python + numpy)
tests/                      node:test suites (run with tsx)
public/models/hero.glb      converted player model with Idle/Walk/Run (+ hero.meta.json)
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

* All pure-logic modules type-check under `strict` TypeScript and **34/34 unit tests pass** (`npm test`).
* `hero.glb` structure, skinning data, texture, clip looping and gait foot-planting were validated programmatically and visually (`docs/clips-preview.png`).

**Not verified here:** `npm install`, `npm run dev`, `npm run build`, the Babylon.js / Vite glue (`CharacterLoader`, `World`,
`GameCamera`, `Game`, …) and any real browser run. The sandbox blocks the npm registry (HTTP 403), so Babylon.js and Vite
could not be installed and those files were never compiled or executed. Run `npm install && npm run build && npm run dev`
and expect to fix small API or type mismatches, then use `window.__game.getState()` in the console to inspect position,
speed, blend weights and camera while testing.
