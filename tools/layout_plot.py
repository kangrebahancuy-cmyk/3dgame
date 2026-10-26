#!/usr/bin/env python3
"""Top-down schematic of the generated forest layout (Pillow only):  python3 tools/layout_plot.py layout.json out.png

Brown = paths, dark green = tree trunk colliders, grey = rock colliders, blue = exit marker rocks, red = signs,
orange = campfire; small dots = non-solid decoration. Red circles around solids are exactly what the player collides with.
"""
import json
import math
import sys

from PIL import Image, ImageDraw


def main():
    d = json.load(open(sys.argv[1]))
    half = d['map']['size'] / 2
    K = 12
    W = int((d['map']['size'] + 24) * K)
    im = Image.new('RGB', (W, W), (118, 156, 88))
    dr = ImageDraw.Draw(im)

    def P(x, z):
        return W / 2 + x * K, W / 2 - z * K

    # paths (sampled from the same polyline definition via simple Catmull-Rom on the control points)
    for p in d['map']['paths']:
        pts = p['points']
        n = len(pts)

        def at(i):
            if i < 0:
                return [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]]
            if i >= n:
                return [2 * pts[-1][0] - pts[-2][0], 2 * pts[-1][1] - pts[-2][1]]
            return pts[i]

        for i in range(n - 1):
            p0, p1, p2, p3 = at(i - 1), at(i), at(i + 1), at(i + 2)
            for s in range(40):
                t = s / 40
                t2, t3 = t * t, t * t * t
                q = [0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3) for k in (0, 1)]
                r = p['width'] / 2 * K
                x, y = P(*q)
                dr.ellipse([x - r, y - r, x + r, y + r], fill=(190, 160, 110))
    dr.rectangle([*P(-half, half), *P(half, -half)], outline=(0, 0, 0), width=2)
    col = {'tree': (20, 90, 30), 'outer-tree': (62, 118, 62), 'rock': (110, 110, 115), 'marker-rock': (60, 60, 200), 'sign': (230, 0, 0),
           'camp': (255, 120, 0), 'bush': (70, 170, 60), 'flower': (255, 200, 0), 'grass': (100, 190, 80), 'rock-small': (150, 150, 150),
           'log': (100, 60, 20), 'stump': (100, 60, 20), 'mushroom': (200, 40, 40)}
    for o in d['objects']:
        if o['colliders']:
            continue
        x, y = P(o['x'], o['z'])
        r = 2 if o['kind'] in ('grass', 'flower') else 4
        dr.ellipse([x - r, y - r, x + r, y + r], fill=col[o['kind']])
    for o in d['objects']:
        for c in o['colliders']:
            x, y = P(c['x'], c['z'])
            r = c['r'] * K
            dr.ellipse([x - r, y - r, x + r, y + r], fill=col[o['kind']], outline=(255, 255, 255))
    x, y = P(0, 0)
    dr.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(255, 255, 255), outline=(0, 0, 0))
    dr.text((8, 8), 'N (+Z) up, E (+X) right - white dot = spawn', fill=(0, 0, 0))
    im.save(sys.argv[2])
    print('saved', sys.argv[2])


if __name__ == '__main__':
    main()
