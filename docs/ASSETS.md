# Asset inspection report

Everything below was measured from the files in `assets/` (44 `.fbx`, 5 `.png`), not assumed.

## What the packs contain

| Pack | Characters | Texture |
|---|---|---|
| `Adventure_Free` | Adventurer, Healer, Monk | `Texture/Texture.png` 512×512 |
| `Fantasy_Heroes_Free` | **Hero**, Knight, Paladin, Wizard, Necromancer, Elf_Archer, Dwarf_Warrior (+ `Hero_Axe` in `Characters/`) | `Texture/Texture.png` 256×256 |
| `Bandits_Free` | Poacher, Scavenger, Thug | `Texture/Texture.png` 512×512 |
| `Orc_Free` (folder is spelled `Chatacters`) | Ash_Walker, Bone_Whittler, Ironbound_Marauder | `Texture/Texture.png` 256×256 |
| `Villager NPC Free` | Blacksmith, Child, Hunter | `Texture/Villagers_Texture.png` 256×256 |

* All FBX files are **binary FBX v7400**, Blender-exported, `UnitScaleFactor = 100`, Z-up in the file with a −90° X rotation on the armature.
* Every character has the **same 27-bone humanoid skeleton** (Blender "metarig" naming: `spine … spine.006`, `shoulder/upper_arm/forearm/hand.L/R`, `thigh/shin/foot/toe.L/R`, `pelvis.L/R`, `heel.02.L/R`) and per-mesh skin clusters.
* Textures are tiny colour-palette atlases; the model UVs point at flat colour cells.
* There are **no documentation or license files** anywhere in the repository. Check the licence of the original packs before shipping anything built from them.

## Animations: there are none

Parsing every FBX object table: **0** `AnimationStack`, `AnimationLayer`, `AnimationCurveNode` or `AnimationCurve` objects in all 44 files. The characters are rigged and skinned, but no Idle, Walk, Run or any other clip exists in the repository.

Because the brief forbids pretending otherwise, the clips used by the game are **authored by this project** (see below) and are not part of the uploaded packs.

## Selected player model

* **`assets/Fantasy_Heroes_Free/FBX/Characters/Hero.fbx`** — texture `assets/Fantasy_Heroes_Free/Texture/Texture.png`.
* Why: the cleanest base humanoid (1 mesh, 688 vertices / 1 372 triangles, 27 joints, 1.94 m tall, T-pose, no weapons or armour baked in), so it is the best "blank" player and cheap to render. All other characters share its skeleton, so they can be swapped in later with the same pipeline.

## Conversion (FBX → GLB)

Blender and the FBX SDK were not available, so `tools/fbx_to_glb.py` converts directly with a small dependency-free (numpy only) FBX parser and GLB writer.

```
npm run convert:character
# = python3 tools/fbx_to_glb.py "assets/Fantasy_Heroes_Free/FBX/Characters/Hero.fbx" \
#                               "assets/Fantasy_Heroes_Free/Texture/Texture.png" public/models/hero.glb
```

Requirements: Python 3 + numpy (Pillow only for `tools/preview.py`). The converter is deterministic (re-running produces a byte-identical file).

What it does:

* reads the node hierarchy (FBX `Lcl Translation/Rotation/Scaling`, XYZ Euler order), mesh, UVs, normals and skin clusters;
* verifies the forward-kinematics bind pose reproduces the FBX `TransformLink` matrices (max error 7e-7);
* un-welds per-corner normals/UVs into an indexed glTF mesh, keeps the 4 strongest bone influences per vertex and renormalises (the FBX has up to 8; the strongest-4 drop at most 23 % of a vertex's weight);
* lifts the model 8.6 mm so the lowest vertex sits exactly on `y = 0`;
* embeds the **original PNG byte-for-byte** (checked by a test) with NEAREST sampling for the palette texture;
* writes `hero.glb` (+ `hero.meta.json` with clip metadata) into `public/models/`.

The original FBX and PNG files are untouched. Only `Hero.fbx` + its texture needed converting.

## Authored animation clips

`tools/gait.py` generates the clips on the real skeleton and bakes them into `hero.glb` (60 Hz keys, linear interpolation, loops seamlessly):

| Clip | Duration | Reference speed | Distance / cycle | Notes |
|---|---|---|---|---|
| `Idle` | 3.2 s | – | – | planted feet, breathing, tiny arm sway |
| `Walk` | 0.60 s | 1.20 m/s | 0.72 m | planted-foot gait, counter-swinging arms |
| `Run` | 0.42 s | 3.40 m/s | 1.43 m | flight phase, 13° lean, bent elbows |

Method: 2-bone analytic IK on both legs with a forward knee pole; during stance each ankle moves backwards at exactly the reference ground speed (verified: stance speed 1.2000 / 3.4272 m/s, ankle height constant, zero IK reach error), pelvis height from the reach limits, FK for spine/arms. At runtime the gait phase advances by `speed × dt / distancePerCycle`, so planted feet move at exactly the character's ground speed — no foot sliding at any speed.

`docs/clips-preview.png` shows frames of all three clips rendered from the GLB alone by `tools/preview.py` (a software rasteriser — **not** Babylon.js).

These are procedural, low-effort clips meant to make the movement system testable. For production, replace them with hand-authored or retargeted mocap clips on the same 27-bone skeleton (the loader only needs clips named `Idle`, `Walk`, `Run` and a matching `distancePerCycle` in `hero.meta.json`).

## Kenney Nature Kit (forest map)

`assets/kenney_nature-kit/Models/GLTF format/` holds 329 self-contained GLBs (flat material colours only: no textures, no animations, no skins).
148 of them are catalogued for the forest map (106 are placed in the current layout), listed in `tools/nature_catalog.py`. `python3 tools/nature_catalog.py` (or `npm run catalog`) measures every
file (bounding box, footprint, trunk radius, SHA-1), fails loudly if a file is missing or not self-contained, writes
`src/world/forest/NatureCatalog.ts` and copies exactly those files, unchanged, to `public/models/nature/` so Vite serves them. The originals are never modified.
Note Kenney's own spelling `tree_fat_darkh`. The kit's authored colours are a stylised teal/orange palette (`Preview.png`); the game recolours by material name unless `?palette=kenney` is used.

## Monsters (combat)

* **`assets/Orc_Free/FBX/Chatacters/{Ash_Walker,Bone_Whittler,Ironbound_Marauder}.fbx`** — texture `assets/Orc_Free/Texture/Texture.png`
  (the folder name really is spelled `Chatacters`).
* `npm run convert:monsters` writes `public/models/monsters/*.glb` + `*.meta.json`.
* These characters are split into a body mesh plus armour/weapon parts skinned to the same skeleton, so
  `tools/fbx_to_glb.py` now **merges every skinned mesh into one primitive** (one texture, one skeleton). A single-mesh
  character such as the Hero converts byte-for-byte as before.
* They carry the same 27-bone humanoid skeleton, so the authored Idle/Walk/Run clips work unchanged; there is still no
  Attack/Hit/Death clip, so those are procedural (`src/combat/pose.ts`).
