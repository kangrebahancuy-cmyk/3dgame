import type { MovementConfig } from '../config';
import { damp, dampAngle } from '../math/scalar';
import type { CollisionWorld } from '../world/collision';

/**
 * Engine-independent character locomotion: smooth acceleration/deceleration, smooth turning,
 * frame-rate-independent integration and collision sub-stepping.
 *
 * Conventions: ground plane is (x, z); `yaw` is the heading with 0 = +Z and positive toward +X,
 * i.e. the forward vector is (sin yaw, cos yaw).
 */
export class MovementModel {
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  yaw = 0;
  /** Ground speed in m/s, measured AFTER collision resolution. */
  speed = 0;
  /** True if the last step touched an obstacle or the world boundary. */
  blocked = false;
  /**
   * Multiplier on walk/run speed. 1 = exactly the configured speeds (the default, so nothing changes unless a caller
   * opts in, e.g. for the optional boots bonus). Not part of the damping math: it only scales the target speed.
   */
  speedScale = 1;

  constructor(private readonly cfg: MovementConfig) {}

  teleport(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = 0;
    this.vz = 0;
    this.speed = 0;
    this.blocked = false;
  }

  /**
   * @param dt     seconds since the previous step
   * @param dirX   desired world-space move direction (need not be normalised; (0,0) = no input)
   * @param dirZ
   * @param run    true = runSpeed, false = walkSpeed
   */
  step(dt: number, dirX: number, dirZ: number, run: boolean, world?: CollisionWorld): void {
    const c = this.cfg;
    if (!(dt > 0)) return;
    if (dt > c.maxFrameTime) dt = c.maxFrameTime;

    const len = Math.hypot(dirX, dirZ);
    const hasInput = len > 1e-4;
    let tx = 0;
    let tz = 0;
    if (hasInput) {
      const s = (run ? c.runSpeed : c.walkSpeed) * this.speedScale;
      tx = (dirX / len) * s; // normalised => identical speed on every heading, diagonals included
      tz = (dirZ / len) * s;
    }

    const lambda = hasInput ? c.accelLambda : c.decelLambda;
    this.vx = damp(this.vx, tx, lambda, dt);
    this.vz = damp(this.vz, tz, lambda, dt);
    if (!hasInput && Math.hypot(this.vx, this.vz) < c.stopSpeed) {
      this.vx = 0;
      this.vz = 0;
    }

    if (hasInput) {
      this.yaw = dampAngle(this.yaw, Math.atan2(dirX, dirZ), c.turnLambda, c.maxTurnRate, dt);
    }

    // Integrate in sub-steps so a fast character can never tunnel through a thin obstacle.
    const dist = Math.hypot(this.vx, this.vz) * dt;
    const n = Math.max(1, Math.ceil(dist / c.maxStepDistance));
    const h = dt / n;
    this.blocked = false;
    for (let i = 0; i < n; i++) {
      this.x += this.vx * h;
      this.z += this.vz * h;
      if (world && world.resolve(this, c.playerRadius)) this.blocked = true;
    }
    this.speed = Math.hypot(this.vx, this.vz);
  }
}
