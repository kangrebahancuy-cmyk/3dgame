import { smoothstep } from '../math/scalar';

/**
 * Analytic terrain height. The visual ground mesh is sampled from this exact function and the
 * character's feet are placed with it, so the two can never disagree (no sinking, no floating).
 * The start area (r < 6 m) is perfectly flat and the hills fade in smoothly beyond it.
 */
export function heightAt(x: number, z: number): number {
  const hills =
    0.32 * Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.09 - 0.4) +
    0.22 * Math.sin((x + z) * 0.05 + 2.1) +
    0.1 * Math.sin(x * 0.23) * Math.sin(z * 0.19 + 0.7);
  const r = Math.hypot(x, z);
  return hills * smoothstep((r - 6) / 10);
}

export interface TerrainData {
  positions: Float32Array;
  /** Unit normals from the analytic height gradient, so lighting never depends on triangle winding. */
  normals: Float32Array;
  indices: Uint32Array;
  colors: Float32Array;
}

/** Deterministic cheap value noise in [0,1] for grass tint variation. */
function hash2(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smoothstep(x - ix);
  const fz = smoothstep(z - iz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export function buildTerrainData(size: number, segments: number): TerrainData {
  const n = segments + 1;
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 4);
  const half = size / 2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -half + (i / segments) * size;
      const z = -half + (j / segments) * size;
      const k = j * n + i;
      positions[k * 3] = x;
      positions[k * 3 + 1] = heightAt(x, z);
      positions[k * 3 + 2] = z;
      const e = 0.1;
      const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
      const gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      const il = 1 / Math.hypot(gx, 1, gz);
      normals[k * 3] = -gx * il;
      normals[k * 3 + 1] = il;
      normals[k * 3 + 2] = -gz * il;
      const t = 0.6 * valueNoise(x * 0.09, z * 0.09) + 0.4 * valueNoise(x * 0.35 + 9, z * 0.35 - 4);
      colors[k * 4] = 0.2 + 0.1 * t;
      colors[k * 4 + 1] = 0.5 + 0.2 * t;
      colors[k * 4 + 2] = 0.16 + 0.06 * t;
      colors[k * 4 + 3] = 1;
    }
  }
  const indices = new Uint32Array(segments * segments * 6);
  let p = 0;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // Counter-clockwise seen from +Y in a right-handed system (clockwise in Babylon's left-handed one).
      // The ground material renders both sides, so culling never depends on this.
      indices[p++] = a;
      indices[p++] = c;
      indices[p++] = b;
      indices[p++] = b;
      indices[p++] = c;
      indices[p++] = d;
    }
  }
  return { positions, normals, indices, colors };
}
