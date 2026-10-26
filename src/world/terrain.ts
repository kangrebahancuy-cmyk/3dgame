import { smoothstep } from '../math/scalar';

/**
 * Hill amplitude multiplier. The first forest map is flat (0): walkable ground is exactly y = 0 everywhere, so
 * the ground quad, the character's feet and the camera clearance can never disagree. Raise it for rolling hills.
 */
export const TERRAIN_AMPLITUDE: number = 0;

/** Analytic terrain height; the character's feet and the camera clearance are placed with it. */
export function heightAt(x: number, z: number): number {
  if (TERRAIN_AMPLITUDE === 0) return 0;
  const hills =
    TERRAIN_AMPLITUDE *
    (0.32 * Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.09 - 0.4) +
      0.22 * Math.sin((x + z) * 0.05 + 2.1) +
      0.1 * Math.sin(x * 0.23) * Math.sin(z * 0.19 + 0.7));
  const r = Math.hypot(x, z);
  return hills * smoothstep((r - 6) / 10);
}
