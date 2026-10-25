import type { CameraConfig } from '../config';
import { DEG2RAD, clamp, damp } from '../math/scalar';

export type HeightFn = (x: number, z: number) => number;

/** Babylon.js is left-handed by default; the pure logic supports both so it can be tested either way. */
export type Handedness = 'left' | 'right';

/**
 * Engine-independent isometric-style follow camera. A smoothed focus point trails the character
 * (exponential smoothing => identical feel at any frame rate); the camera sits at a fixed
 * azimuth/elevation from that point. Because the offset is fixed there is no rotation jitter.
 */
export class FollowRig {
  focusX = 0;
  focusY = 0;
  focusZ = 0;
  posX = 0;
  posY = 0;
  posZ = 0;
  distance: number;
  private targetDistance: number;
  /** Ground-plane unit vector the camera looks along: (sin az, cos az). */
  readonly forwardX: number;
  readonly forwardZ: number;
  private readonly cosEl: number;
  private readonly sinEl: number;

  constructor(
    private readonly cfg: CameraConfig,
    private readonly heightAt: HeightFn,
    private readonly handedness: Handedness = 'left',
  ) {
    const az = cfg.azimuthDeg * DEG2RAD;
    const el = cfg.elevationDeg * DEG2RAD;
    this.forwardX = Math.sin(az);
    this.forwardZ = Math.cos(az);
    this.cosEl = Math.cos(el);
    this.sinEl = Math.sin(el);
    this.distance = this.targetDistance = cfg.distance;
  }

  zoom(delta: number): void {
    this.targetDistance = clamp(this.targetDistance + delta, this.cfg.minDistance, this.cfg.maxDistance);
  }

  /** Jump straight onto the target (used on start and restart). */
  snap(tx: number, ty: number, tz: number): void {
    this.focusX = tx;
    this.focusY = ty + this.cfg.focusHeight;
    this.focusZ = tz;
    this.distance = this.targetDistance;
    this.place();
  }

  update(dt: number, tx: number, ty: number, tz: number): void {
    const c = this.cfg;
    this.focusX = damp(this.focusX, tx, c.followLambda, dt);
    this.focusY = damp(this.focusY, ty + c.focusHeight, c.followLambda, dt);
    this.focusZ = damp(this.focusZ, tz, c.followLambda, dt);
    this.distance = damp(this.distance, this.targetDistance, c.zoomLambda, dt);
    this.place();
  }

  private place(): void {
    const horiz = this.distance * this.cosEl;
    this.posX = this.focusX - this.forwardX * horiz;
    this.posZ = this.focusZ - this.forwardZ * horiz;
    const minY = this.heightAt(this.posX, this.posZ) + this.cfg.minClearance;
    this.posY = Math.max(this.focusY + this.distance * this.sinEl, minY);
  }

  /**
   * Converts keyboard axes into a world-space move direction relative to the camera.
   * `forward` +1 = away from the camera ("up" on screen), `right` +1 = screen right.
   * Result is normalised (length 1) or (0,0) when there is no input, so diagonals are not faster.
   */
  moveDirection(forward: number, right: number, out: { x: number; z: number }): void {
    const fx = this.forwardX;
    const fz = this.forwardZ;
    // Screen-right on the ground plane, +Y up. Left-handed (Babylon default): looking along +Z,
    // right is +X, so right = (fz, -fx). Right-handed: looking along -Z, right is +X: (-fz, fx).
    const s = this.handedness === 'left' ? 1 : -1;
    const rx = s * fz;
    const rz = -s * fx;
    let x = fx * forward + rx * right;
    let z = fz * forward + rz * right;
    const l = Math.hypot(x, z);
    if (l > 1e-6) {
      x /= l;
      z /= l;
    } else {
      x = 0;
      z = 0;
    }
    out.x = x;
    out.z = z;
  }
}
