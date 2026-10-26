import type { PathDefinition } from './MapConfiguration';

interface Polyline {
  readonly id: string;
  readonly halfWidth: number;
  readonly xs: Float64Array;
  readonly zs: Float64Array;
}

/** Uniform Catmull-Rom sampling of a control polygon; passes through every control point. */
export function sampleCurve(points: ReadonlyArray<readonly [number, number]>, step: number): Array<[number, number]> {
  const n = points.length;
  const out: Array<[number, number]> = [];
  const P = (i: number): readonly [number, number] => {
    if (i < 0) return [2 * points[0][0] - points[1][0], 2 * points[0][1] - points[1][1]];
    if (i >= n) return [2 * points[n - 1][0] - points[n - 2][0], 2 * points[n - 1][1] - points[n - 2][1]];
    return points[i];
  };
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(2, Math.ceil(len / step));
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push([points[n - 1][0], points[n - 1][1]]);
  return out;
}

/**
 * The dirt paths as dense polylines, with distance queries. The ground painter, the decoration placer and
 * the tests all use this one object, so what is painted as path is exactly what is kept free of obstacles.
 */
export class PathNetwork {
  private readonly lines: Polyline[] = [];

  constructor(paths: readonly PathDefinition[], step = 0.5) {
    for (const p of paths) {
      const pts = sampleCurve(p.points, step);
      this.lines.push({
        id: p.id,
        halfWidth: p.width / 2,
        xs: Float64Array.from(pts, (q) => q[0]),
        zs: Float64Array.from(pts, (q) => q[1]),
      });
    }
  }

  get ids(): string[] {
    return this.lines.map((l) => l.id);
  }

  /** Dense centre-line samples of one path (for painting). */
  centreLine(id: string): { halfWidth: number; xs: Float64Array; zs: Float64Array } {
    const l = this.lines.find((q) => q.id === id);
    if (!l) throw new Error(`unknown path "${id}"`);
    return l;
  }

  /** Distance (m) from (x, z) to the nearest path's EDGE: negative inside a path, 0 on its edge. */
  edgeDistance(x: number, z: number): number {
    let best = Infinity;
    for (const l of this.lines) {
      const xs = l.xs, zs = l.zs;
      let d2 = Infinity;
      for (let i = 0; i < xs.length - 1; i++) {
        const ax = xs[i], az = zs[i];
        const bx = xs[i + 1] - ax, bz = zs[i + 1] - az;
        const len2 = bx * bx + bz * bz;
        let t = len2 > 0 ? ((x - ax) * bx + (z - az) * bz) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x - (ax + bx * t), dz = z - (az + bz * t);
        const q = dx * dx + dz * dz;
        if (q < d2) d2 = q;
      }
      const d = Math.sqrt(d2) - l.halfWidth;
      if (d < best) best = d;
    }
    return best;
  }
}
