#!/usr/bin/env python3
"""Build src/world/forest/NatureCatalog.ts from the REAL Kenney Nature Kit GLB files.

    python3 tools/nature_catalog.py

Nothing in the game references a Kenney file by guesswork: every id below must exist on disk, must be a
self-contained GLB (no external URIs/textures), and its measured size, footprint and trunk radius are
written into the generated catalog. The generator fails loudly if a listed file is missing.
Needs numpy only. The original assets are only read, never modified.
"""
import hashlib
import json
import os
import shutil
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from glb_writer import read_accessor, read_glb  # noqa: E402
from qmath import quat_to_mat3  # noqa: E402

ROOT = os.path.dirname(HERE)
MODEL_DIR = os.path.join(ROOT, 'assets', 'kenney_nature-kit', 'Models', 'GLTF format')
OUT = os.path.join(ROOT, 'src', 'world', 'forest', 'NatureCatalog.ts')
# Only the models the game uses are copied (byte-identical) here so Vite serves them like hero.glb. The originals stay untouched.
PUBLIC_DIR = os.path.join(ROOT, 'public', 'models', 'nature')

# (id, category).  The id is the file name without ".glb" - exactly as on disk (note Kenney's own typo "tree_fat_darkh").
def ids(prefix, names, cat):
    return [(prefix + n, cat) for n in names]

ASSETS = (
    # conifers
    ids('tree_pineTall', ['A', 'B', 'C', 'D', 'A_detailed', 'B_detailed', 'C_detailed', 'D_detailed'], 'conifer')
    + ids('tree_pineDefault', ['A', 'B'], 'conifer')
    + ids('tree_pineRound', ['A', 'B', 'C', 'D', 'E', 'F'], 'conifer')
    + ids('tree_pineSmall', ['A', 'B', 'C', 'D'], 'conifer')
    + [('tree_cone', 'conifer'), ('tree_cone_dark', 'conifer'), ('tree_cone_fall', 'conifer')]
    # broadleaf
    + [(f'tree_{n}{s}', 'broadleaf') for n in ('default', 'oak', 'detailed', 'simple', 'tall', 'thin', 'small', 'plateau', 'blocks')
       for s in ('', '_dark', '_fall')]
    + [('tree_fat', 'broadleaf'), ('tree_fat_darkh', 'broadleaf'), ('tree_fat_fall', 'broadleaf')]
    # rocks
    + ids('rock_large', list('ABCDEF'), 'rock_large')
    + ids('rock_tall', list('ABCDEFGHIJ'), 'rock_tall')
    + ids('rock_small', list('ABCDEFGHI'), 'rock_small')
    + ids('rock_smallFlat', list('ABC'), 'rock_small')
    + ids('rock_smallTop', list('AB'), 'rock_small')
    + ids('stone_large', list('ABCDEF'), 'rock_large')
    + ids('stone_tall', list('ABCDEFGHIJ'), 'rock_tall')
    + ids('stone_small', list('ABCDEFGHI'), 'rock_small')
    # plants
    + [('plant_bush', 'bush'), ('plant_bushDetailed', 'bush'), ('plant_bushLarge', 'bush'),
       ('plant_bushLargeTriangle', 'bush'), ('plant_bushSmall', 'bush'), ('plant_bushTriangle', 'bush'),
       ('plant_flatShort', 'plant'), ('plant_flatTall', 'plant'),
       ('grass', 'grass'), ('grass_large', 'grass'), ('grass_leafs', 'grass'), ('grass_leafsLarge', 'grass')]
    + [(f'flower_{c}{v}', 'flower') for c in ('purple', 'red', 'yellow') for v in 'ABC']
    + [('mushroom_red', 'mushroom'), ('mushroom_redGroup', 'mushroom'), ('mushroom_redTall', 'mushroom'),
       ('mushroom_tan', 'mushroom'), ('mushroom_tanGroup', 'mushroom'), ('mushroom_tanTall', 'mushroom')]
    # decoration
    + [('log', 'log'), ('log_large', 'log'), ('log_stack', 'log'), ('log_stackLarge', 'log'),
       ('stump_old', 'stump'), ('stump_oldTall', 'stump'), ('stump_round', 'stump'), ('stump_roundDetailed', 'stump'),
       ('stump_square', 'stump'), ('stump_squareDetailed', 'stump'),
       ('campfire_stones', 'camp'), ('campfire_logs', 'camp'), ('sign', 'sign')]
)


def local_matrix(n):
    if 'matrix' in n:
        return np.array(n['matrix']).reshape(4, 4).T
    m = np.eye(4)
    m[:3, :3] = quat_to_mat3(n.get('rotation', [0, 0, 0, 1])) @ np.diag(n.get('scale', [1, 1, 1]))
    m[:3, 3] = n.get('translation', [0, 0, 0])
    return m


def load_vertices(gltf, binc):
    """Return [(material_name, Nx3 vertices in model space)] for every primitive reachable from the scene."""
    out = []

    def walk(i, parent):
        n = gltf['nodes'][i]
        m = parent @ local_matrix(n)
        if 'mesh' in n:
            for p in gltf['meshes'][n['mesh']]['primitives']:
                v = read_accessor(gltf, binc, p['attributes']['POSITION']).astype(np.float64)
                # Kenney's primitives (one per material) SHARE one vertex buffer and differ only by their
                # index list, so select the vertices this primitive actually uses.
                if 'indices' in p:
                    used = np.unique(read_accessor(gltf, binc, p['indices']).astype(np.int64))
                    v = v[used]
                v = v @ m[:3, :3].T + m[:3, 3]
                mat = gltf['materials'][p['material']]['name'] if 'material' in p else '_none'
                out.append((mat, v))
        for c in n.get('children', []):
            walk(c, m)

    for r in gltf['scenes'][gltf.get('scene', 0)]['nodes']:
        walk(r, np.eye(4))
    return out


def measure(entry_id, category):
    path = os.path.join(MODEL_DIR, entry_id + '.glb')
    if not os.path.isfile(path):
        raise SystemExit(f'MISSING asset file: {path}')
    gltf, binc = read_glb(path)
    for k in ('images', 'buffers'):
        for x in gltf.get(k, []):
            if 'uri' in x and not x['uri'].startswith('data:'):
                raise SystemExit(f'{entry_id}: external {k[:-1]} uri {x["uri"]!r} (not self-contained)')
    if gltf.get('textures') or gltf.get('animations') or gltf.get('skins'):
        raise SystemExit(f'{entry_id}: unexpected textures/animations/skins')
    prims = load_vertices(gltf, binc)
    allv = np.vstack([v for _, v in prims])
    lo, hi = allv.min(0), allv.max(0)
    size = hi - lo
    entry = {
        'file': entry_id + '.glb',
        'bytes': os.path.getsize(path),
        'sha1': hashlib.sha1(open(path, 'rb').read()).hexdigest()[:12],
        'category': category,
        'min': [round(float(x), 4) for x in lo],
        'size': [round(float(x), 4) for x in size],
        'center': [round(float((lo[0] + hi[0]) / 2), 4), round(float((lo[2] + hi[2]) / 2), 4)],
        'materials': sorted({m for m, _ in prims}),
    }
    if category in ('conifer', 'broadleaf'):
        # trunk radius: horizontal spread of the bark vertices in the lowest 25 % of the tree
        bark = [v for m, v in prims if m.startswith('wood')]
        if not bark:
            raise SystemExit(f'{entry_id}: tree without a wood material')
        b = np.vstack(bark)
        low = b[b[:, 1] < lo[1] + 0.25 * size[1]]
        if len(low) < 4:
            low = b
        c = low[:, [0, 2]].mean(0)
        r = np.hypot(low[:, 0] - c[0], low[:, 2] - c[1])
        entry['trunkRadius'] = round(float(r.max()), 4)
        entry['trunkCenter'] = [round(float(c[0]), 4), round(float(c[1]), 4)]
    return entry


def ts_value(v, indent=0):
    return json.dumps(v)


def main():
    seen = set()
    entries = []
    for i, cat in ASSETS:
        if i in seen:
            raise SystemExit(f'duplicate id {i}')
        seen.add(i)
        entries.append((i, measure(i, cat)))
    lines = [
        '// GENERATED by tools/nature_catalog.py from assets/kenney_nature-kit/Models/GLTF format/*.glb - do not edit by hand.',
        '// Sizes are in the models\' native units (1 unit = 1 Kenney tile). Run "npm run catalog" to regenerate.',
        "import type { NatureAsset } from './NatureTypes';",
        '',
        'export const NATURE_CATALOG: Readonly<Record<string, NatureAsset>> = {',
    ]
    for i, e in entries:
        lines.append(f'  {i}: {json.dumps(e)},')
    lines += ['};', '', f'export const NATURE_CATALOG_COUNT = {len(entries)};', '']
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    for i, _ in entries:
        shutil.copyfile(os.path.join(MODEL_DIR, i + '.glb'), os.path.join(PUBLIC_DIR, i + '.glb'))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        f.write('\n'.join(lines))
    print(f'wrote {os.path.relpath(OUT, ROOT)}: {len(entries)} assets, all present and self-contained, copied to public/models/nature/')
    trees = [(i, e) for i, e in entries if 'trunkRadius' in e]
    for i, e in trees[:60]:
        print(f"  {i:26s} h={e['size'][1]:.2f} w={e['size'][0]:.2f}x{e['size'][2]:.2f} trunkR={e['trunkRadius']:.3f}")


if __name__ == '__main__':
    main()
