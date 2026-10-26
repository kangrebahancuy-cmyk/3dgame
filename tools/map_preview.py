#!/usr/bin/env python3
"""Offline software render of the forest map from the REAL Kenney GLBs (numpy + Pillow only).

It is NOT the game's renderer (no Babylon, no shadows, no fog) - it only lets us look at the layout, the model
proportions and the camera framing without a GPU/browser:

    tsx tools/dump_forest.ts layout.json
    python3 tools/map_preview.py layout.json ground.png out.png [--at x,z] [--az 45] [--el 50] [--dist 19] [--fov 36]
                                 [--radius 26] [--size 1100x680]

The camera defaults are the game's (azimuth 45, elevation 50, distance 19, fov 36). The hero (hero.glb, 1.94 m) is
drawn at --at for scale. Coordinates follow the game: left-handed, yaw forward = (sin, cos), screen-right = (fz, -fx).
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from glb_writer import read_accessor, read_glb  # noqa: E402
from nature_catalog import MODEL_DIR, local_matrix  # noqa: E402
from preview import Model  # noqa: E402

ROOT = os.path.dirname(HERE)


def load_triangles(path, palette):
    """[(Nx3x3 triangle vertices in model space, colour)] per primitive."""
    gltf, binc = read_glb(path)
    out = []

    def walk(i, parent):
        n = gltf['nodes'][i]
        m = parent @ local_matrix(n)
        if 'mesh' in n:
            for p in gltf['meshes'][n['mesh']]['primitives']:
                v = read_accessor(gltf, binc, p['attributes']['POSITION']).astype(np.float64)
                idx = read_accessor(gltf, binc, p['indices']).astype(np.int64).reshape(-1, 3)
                v = v @ m[:3, :3].T + m[:3, 3]
                name = gltf['materials'][p['material']]['name']
                out.append((v[idx], np.array(palette[name])))
        for c in n.get('children', []):
            walk(c, m)

    for r in gltf['scenes'][gltf.get('scene', 0)]['nodes']:
        walk(r, np.eye(4))
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opt = {a[2:]: sys.argv[i + 2] for i, a in enumerate(sys.argv[1:]) if a.startswith('--') and i + 2 < len(sys.argv)}
    data = json.load(open(args[0]))
    ground = np.array(Image.open(args[1]).convert('RGB')).astype(np.float64)
    fx_, fz_ = [float(x) for x in opt.get('at', '0,0').split(',')]
    az, el = math.radians(float(opt.get('az', 45))), math.radians(float(opt.get('el', 50)))
    dist, fov = float(opt.get('dist', 19)), math.radians(float(opt.get('fov', 36)))
    radius = float(opt.get('radius', 26))
    W, H = [int(x) for x in opt.get('size', '1100x680').split('x')]
    focus = np.array([fx_, 1.0, fz_])
    f = np.array([math.sin(az) * math.cos(el), -math.sin(el), math.cos(az) * math.cos(el)])
    r = np.array([f[2], 0, -f[0]]); r /= np.linalg.norm(r)
    u = np.cross(r, f)
    if u[1] < 0:
        u = -u
    cam = focus - f * dist
    th = math.tan(fov / 2)
    asp = W / H
    sun = np.array([-0.55, -1.0, -0.35]); sun /= np.linalg.norm(sun)
    sky = np.array([158, 204, 237.0])
    pal = data['palette']
    pm = data['map']
    S = pm['size'] + 32

    img = np.zeros((H, W, 3)); img[:] = sky
    zb = np.full((H, W), 0.0)  # stores 1/z (bigger = nearer)

    # ---- ground: intersect every pixel ray with y = 0 and sample the painted texture
    xs, ys = np.meshgrid((np.arange(W) + 0.5) / W * 2 - 1, 1 - (np.arange(H) + 0.5) / H * 2)
    d = f[None, None, :] + r[None, None, :] * (xs * th * asp)[..., None] + u[None, None, :] * (ys * th)[..., None]
    t = -cam[1] / d[..., 1]
    ok = (d[..., 1] < -1e-6) & (t > 0)
    gx = cam[0] + d[..., 0] * t
    gz = cam[2] + d[..., 2] * t
    tu = np.clip(((gx + S / 2) / S * ground.shape[1]).astype(int), 0, ground.shape[1] - 1)
    tv = np.clip(((S / 2 - gz) / S * ground.shape[0]).astype(int), 0, ground.shape[0] - 1)
    gc = ground[tv, tu] * 0.92 + 8
    outside = (np.abs(gx) > S / 2) | (np.abs(gz) > S / 2)
    gc[outside] = np.array([69, 102, 51.0])
    img[ok] = gc[ok]
    zc = (d @ f) * t
    zb[ok] = 1.0 / zc[ok]

    # ---- triangles
    def project(p):
        q = p - cam
        zc = q @ f
        return W / 2 + (q @ r) / zc / (th * asp) * W / 2, H / 2 - (q @ u) / zc / th * H / 2, zc

    def draw(tris, colour_fn):
        n = tris.shape[0]
        e1, e2 = tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]
        nrm = np.cross(e1, e2)
        nl = np.linalg.norm(nrm, axis=1, keepdims=True); nl[nl == 0] = 1
        nrm /= nl
        flip = (nrm @ f) > 0  # two-sided: face the normal toward the camera
        nrm[flip] *= -1
        shade = 0.5 + 0.62 * np.clip(-(nrm @ sun), 0, 1)
        for k in range(n):
            tri = tris[k]
            px, py, zc = project(tri)
            if (zc <= 0.1).any():
                continue
            x0, x1 = int(max(px.min(), 0)), int(min(px.max(), W - 1))
            y0, y1 = int(max(py.min(), 0)), int(min(py.max(), H - 1))
            if x1 < x0 or y1 < y0:
                continue
            den = (py[1] - py[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (py[0] - py[2])
            if abs(den) < 1e-9:
                continue
            gxx, gyy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            l0 = ((py[1] - py[2]) * (gxx - px[2]) + (px[2] - px[1]) * (gyy - py[2])) / den
            l1 = ((py[2] - py[0]) * (gxx - px[2]) + (px[0] - px[2]) * (gyy - py[2])) / den
            l2 = 1 - l0 - l1
            ins = (l0 >= -1e-6) & (l1 >= -1e-6) & (l2 >= -1e-6)
            if not ins.any():
                continue
            iz = l0 / zc[0] + l1 / zc[1] + l2 / zc[2]
            sub = zb[y0:y1 + 1, x0:x1 + 1]
            vis = ins & (iz > sub)
            if not vis.any():
                continue
            sub[vis] = iz[vis]
            img[y0:y1 + 1, x0:x1 + 1][vis] = np.clip(colour_fn(k) * shade[k], 0, 255)

    cache = {}
    objs = [o for o in data['objects'] if math.hypot(o['x'] - fx_, o['z'] - fz_) < radius]
    objs.sort(key=lambda o: -math.hypot(o['x'] - cam[0], o['z'] - cam[2]))
    for o in objs:
        if o['assetId'] not in cache:
            cache[o['assetId']] = load_triangles(os.path.join(MODEL_DIR, o['assetId'] + '.glb'), pal)
        c, s = math.cos(o['yaw']), math.sin(o['yaw'])
        R = np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]])  # row-vector convention: x' = x c + z s, z' = -x s + z c
        for tris, col in cache[o['assetId']]:
            w = (tris * o['scale']) @ R + np.array([o['x'], 0, o['z']])
            draw(w, lambda k, col=col: col * 255)

    # ---- the hero for scale (1.94 m)
    hero = Model(os.path.join(ROOT, 'public', 'models', 'hero.glb'))
    p, _, _ = hero.skinned(None)
    yaw = az  # facing away from the camera, like the game's respawn
    c, s = math.cos(yaw), math.sin(yaw)
    R = np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]])
    wp = p @ R + np.array([fx_, 0, fz_])
    tris = wp[hero.idx]
    uv = hero.uv[hero.idx].mean(1)
    th_, tw_ = hero.tex.shape[:2]
    cols = hero.tex[np.clip((uv[:, 1] * th_).astype(int), 0, th_ - 1), np.clip((uv[:, 0] * tw_).astype(int), 0, tw_ - 1), :3].astype(np.float64)
    draw(tris, lambda k: cols[k])

    if 'colliders' in opt:  # --colliders 1: outline every solid collision circle (and the player's, at its spawn) in red
        pts = []
        for c_ in data['solids'] + [{'x': fx_, 'z': fz_, 'r': 0.38}]:
            a_ = np.linspace(0, 2 * math.pi, 40, endpoint=False)
            pts.append(np.stack([c_['x'] + c_['r'] * np.cos(a_), np.full_like(a_, 0.06), c_['z'] + c_['r'] * np.sin(a_)], 1))
        px, py, zc = project(np.vstack(pts))
        for x_, y_, z_ in zip(px, py, zc):
            if z_ > 0.1 and 0 <= int(x_) < W - 1 and 0 <= int(y_) < H - 1:
                img[int(y_):int(y_) + 2, int(x_):int(x_) + 2] = (255, 40, 40)
    Image.fromarray(img.astype(np.uint8)).save(args[2])
    print('saved', args[2], f'({len(objs)} objects)')


if __name__ == '__main__':
    main()
