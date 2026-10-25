#!/usr/bin/env python3
"""Software preview of a skinned GLB (numpy + Pillow only).

Reads ONLY the GLB (never the FBX), applies linear-blend skinning, optionally samples one of the
embedded animation clips, and rasterises with a z-buffer. Used to verify the converter output and
the authored clips without a GPU/browser.

    python3 tools/preview.py model.glb out.png [--clip Walk --times 0,0.1,0.2] [--view front|side|three]
"""
import io
import math
import os
import sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_writer import read_glb, read_accessor
from qmath import quat_to_mat3


class Model:
    def __init__(self, path):
        self.g, self.b = read_glb(path)
        g = self.g
        self.nodes = g['nodes']
        self.parent = {}
        for i, n in enumerate(self.nodes):
            for c in n.get('children', []):
                self.parent[c] = i
        self.name_to_node = {n['name']: i for i, n in enumerate(self.nodes)}
        prim = g['meshes'][0]['primitives'][0]
        at = prim['attributes']
        self.pos = read_accessor(g, self.b, at['POSITION']).astype(np.float64)
        self.nrm = read_accessor(g, self.b, at['NORMAL']).astype(np.float64)
        self.uv = read_accessor(g, self.b, at['TEXCOORD_0']).astype(np.float64)
        self.j = read_accessor(g, self.b, at['JOINTS_0']).astype(np.int64)
        self.w = read_accessor(g, self.b, at['WEIGHTS_0']).astype(np.float64)
        self.idx = read_accessor(g, self.b, prim['indices']).astype(np.int64).reshape(-1, 3)
        skin = g['skins'][0]
        self.joints = skin['joints']
        self.ibm = read_accessor(g, self.b, skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
        img = g['images'][0]
        v = g['bufferViews'][img['bufferView']]
        png = self.b[v['byteOffset']:v['byteOffset'] + v['byteLength']]
        self.tex = np.array(Image.open(io.BytesIO(png)).convert('RGBA'))
        self.clips = {}
        for a in g.get('animations', []):
            tracks = {}
            for ch in a['channels']:
                s = a['samplers'][ch['sampler']]
                t = read_accessor(g, self.b, s['input'])
                o = read_accessor(g, self.b, s['output'])
                tracks.setdefault(ch['target']['node'], {})[ch['target']['path']] = (t, o)
            self.clips[a['name']] = tracks

    def local_rest(self, i):
        n = self.nodes[i]
        t = np.array(n.get('translation', [0, 0, 0]), dtype=np.float64)
        q = np.array(n.get('rotation', [0, 0, 0, 1]), dtype=np.float64)
        s = np.array(n.get('scale', [1, 1, 1]), dtype=np.float64)
        return t, q, s

    def sample(self, clip, time):
        """Return {node: (t or None, q or None)} for a clip at `time` (looped)."""
        tracks = self.clips[clip]
        out = {}
        for node, trk in tracks.items():
            res = {}
            for path, (times, vals) in trk.items():
                dur = times[-1]
                tt = time % dur if dur > 0 else 0
                k = int(np.searchsorted(times, tt, side='right') - 1)
                k = max(0, min(k, len(times) - 2))
                f = (tt - times[k]) / (times[k + 1] - times[k])
                a, b = vals[k].astype(np.float64), vals[k + 1].astype(np.float64)
                if path == 'rotation':
                    if np.dot(a, b) < 0:
                        b = -b
                    r = a * (1 - f) + b * f
                    res['q'] = r / np.linalg.norm(r)
                else:
                    res['t'] = a * (1 - f) + b * f
            out[node] = res
        return out

    def globals(self, pose=None):
        pose = pose or {}
        cache = {}

        def rec(i):
            if i in cache:
                return cache[i]
            t, q, s = self.local_rest(i)
            ov = pose.get(i, {})
            if 'q' in ov:
                q = ov['q']
            if 't' in ov:
                t = ov['t']
            m = np.eye(4)
            m[:3, :3] = quat_to_mat3(q) @ np.diag(s)
            m[:3, 3] = t
            if i in self.parent:
                m = rec(self.parent[i]) @ m
            cache[i] = m
            return m
        return [rec(i) for i in range(len(self.nodes))]

    def skinned(self, pose=None):
        G = self.globals(pose)
        jm = np.array([G[j] @ self.ibm[k] for k, j in enumerate(self.joints)])  # (J,4,4)
        M = np.einsum('vk,vkab->vab', self.w, jm[self.j])
        p = np.einsum('vab,vb->va', M[:, :3, :3], self.pos) + M[:, :3, 3]
        n = np.einsum('vab,vb->va', M[:, :3, :3], self.nrm)
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
        return p, n, G


def render(model, pose, yaw_deg, pitch_deg, size=420, scale=None, center=None, ss=2, bg=(226, 232, 222), ground=True):
    p, n, G = model.skinned(pose)
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    # camera rotation: yaw around Y then pitch around X; world -> view
    cy, sy, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
    Ry = np.array([[cy, 0, -sy], [0, 1, 0], [sy, 0, cy]])
    Rx = np.array([[1, 0, 0], [0, cp, sp], [0, -sp, cp]])
    R = Rx @ Ry
    if center is None:
        center = np.array([0.0, 0.95, 0.0])
    v = (p - center) @ R.T
    nv = n @ R.T
    S = size * ss
    sc = scale or (S / 2.5)
    xs = v[:, 0] * sc + S / 2
    ys = -v[:, 1] * sc + S / 2
    zs = v[:, 2]  # camera looks toward -z? we put +z toward viewer
    img = np.zeros((S, S, 3), dtype=np.float64)
    img[:] = bg
    zbuf = np.full((S, S), -1e9)
    light = np.array([0.35, 0.8, 0.55])
    light /= np.linalg.norm(light)
    tex = model.tex
    th, tw = tex.shape[:2]
    if ground:
        # simple ground line/shadow disc so grounding is visible: y=0 plane projected
        gy = (-(np.array([0, 0, 0]) - center) @ R.T)[1] * sc + S / 2
        g0 = (np.array([0.0, 0.0, 0.0]) - center) @ R.T
        gyp = -g0[1] * sc + S / 2
        img[int(gyp):, :] = (bg[0] * 0.86, bg[1] * 0.9, bg[2] * 0.84)
    for tri in model.idx:
        a, b, c = tri
        x0, y0, x1, y1, x2, y2 = xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(den) < 1e-9:
            continue
        minx, maxx = int(max(min(x0, x1, x2), 0)), int(min(max(x0, x1, x2), S - 1))
        miny, maxy = int(max(min(y0, y1, y2), 0)), int(min(max(y0, y1, y2), S - 1))
        if maxx < minx or maxy < miny:
            continue
        px, py = np.meshgrid(np.arange(minx, maxx + 1) + 0.5, np.arange(miny, maxy + 1) + 0.5)
        l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / den
        l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / den
        l2 = 1 - l0 - l1
        inside = (l0 >= -1e-6) & (l1 >= -1e-6) & (l2 >= -1e-6)
        if not inside.any():
            continue
        z = l0 * zs[a] + l1 * zs[b] + l2 * zs[c]
        sub = zbuf[miny:maxy + 1, minx:maxx + 1]
        vis = inside & (z > sub)
        if not vis.any():
            continue
        uvc = (model.uv[a] + model.uv[b] + model.uv[c]) / 3
        tx = int(np.clip(uvc[0] * tw, 0, tw - 1))
        ty = int(np.clip(uvc[1] * th, 0, th - 1))
        col = tex[ty, tx, :3].astype(np.float64)
        nn = (nv[a] + nv[b] + nv[c])
        nn /= np.linalg.norm(nn) + 1e-12
        # world-space light: transform light into view space too
        lv = R @ light
        shade = 0.45 + 0.55 * max(0.0, float(np.dot(nn, lv)))
        out = np.clip(col * shade, 0, 255)
        sub[vis] = z[vis]
        region = img[miny:maxy + 1, minx:maxx + 1]
        region[vis] = out
    im = Image.fromarray(img.astype(np.uint8))
    return im.resize((size, size), Image.LANCZOS)


def sheet(images, cols, label=None):
    w, h = images[0].size
    rows = (len(images) + cols - 1) // cols
    out = Image.new('RGB', (w * cols, h * rows), (255, 255, 255))
    for i, im in enumerate(images):
        out.paste(im, ((i % cols) * w, (i // cols) * h))
    return out


VIEWS = {'front': (0, 0), 'side': (-90, 0), 'three': (-35, 18), 'back': (180, 0), 'top': (0, 55)}

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    glb, outp = args[0], args[1]
    opt = {}
    for i, a in enumerate(sys.argv):
        if a.startswith('--') and i + 1 < len(sys.argv):
            opt[a[2:]] = sys.argv[i + 1]
    m = Model(glb)
    view = opt.get('view', 'three')
    yaw, pitch = VIEWS[view]
    ims = []
    if 'clip' in opt:
        for t in [float(x) for x in opt.get('times', '0').split(',')]:
            ims.append(render(m, m.sample(opt['clip'], t), yaw, pitch, size=int(opt.get('size', 300))))
    else:
        for vn in opt.get('views', 'front,side,three,back').split(','):
            ims.append(render(m, None, *VIEWS[vn], size=int(opt.get('size', 420))))
    sheet(ims, min(len(ims), int(opt.get('cols', 4)))).save(outp)
    print('saved', outp)
