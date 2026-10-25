/** Small allocation-free math helpers shared by the pure game-logic modules. */

export const TWO_PI = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Frame-rate-independent exponential smoothing: moves `current` toward `target`
 * so that the remaining error shrinks by exp(-lambda) every second, regardless of dt.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TWO_PI;
  if (a <= 0) a += TWO_PI;
  return a - Math.PI;
}

/** Signed shortest rotation from `from` to `to`, in (-PI, PI]. */
export function shortestAngle(from: number, to: number): number {
  return wrapAngle(to - from);
}

/**
 * Smoothly turns `current` toward `target` along the shortest arc using exponential smoothing,
 * with an additional hard cap on angular speed (rad/s) so 180-degree reversals never snap.
 */
export function dampAngle(current: number, target: number, lambda: number, maxRate: number, dt: number): number {
  const diff = shortestAngle(current, target);
  let step = diff * (1 - Math.exp(-lambda * dt));
  const maxStep = maxRate * dt;
  if (step > maxStep) step = maxStep;
  else if (step < -maxStep) step = -maxStep;
  return wrapAngle(current + step);
}
