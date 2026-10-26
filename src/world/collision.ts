/** Anything that can be pushed out of obstacles: position + velocity on the ground plane. */
export interface Body2D {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/**
 * Static circle obstacles plus a circular world boundary. Pure 2D math, no engine types.
 * Contacts push the body out along the contact normal and remove the velocity component pointing
 * into the obstacle, so the character slides smoothly along trees and rocks instead of sticking.
 */
export class CollisionWorld {
  private cx: number[] = [];
  private cz: number[] = [];
  private cr: number[] = [];
  /** Radius (m) of the walkable area around the origin. Infinity = unbounded. */
  boundsRadius = Infinity;
  /** Half extents (m) of an axis-aligned rectangular walkable area centred on the origin. Infinity = unbounded. */
  private halfX = Infinity;
  private halfZ = Infinity;

  /** Restricts the walkable area to the rectangle |x| <= halfX, |z| <= halfZ (the forest map is a square). */
  setRectBounds(halfX: number, halfZ: number): void {
    this.halfX = halfX;
    this.halfZ = halfZ;
  }

  get count(): number {
    return this.cr.length;
  }

  clear(): void {
    this.cx.length = 0;
    this.cz.length = 0;
    this.cr.length = 0;
  }

  addCircle(x: number, z: number, radius: number): void {
    this.cx.push(x);
    this.cz.push(z);
    this.cr.push(radius);
  }

  /** True if a circle of `radius` at (x, z) overlaps any obstacle. */
  overlaps(x: number, z: number, radius: number): boolean {
    for (let i = 0; i < this.cr.length; i++) {
      const dx = x - this.cx[i];
      const dz = z - this.cz[i];
      const r = radius + this.cr[i];
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  /** Resolves penetration of `body` (a circle of `radius`). Returns true if any contact occurred. */
  resolve(body: Body2D, radius: number): boolean {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (let i = 0; i < this.cr.length; i++) {
        let dx = body.x - this.cx[i];
        let dz = body.z - this.cz[i];
        const minDist = radius + this.cr[i];
        const d2 = dx * dx + dz * dz;
        if (d2 >= minDist * minDist) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-6) {
          dx = 1;
          dz = 0;
          d = 1;
        }
        const nx = dx / d;
        const nz = dz / d;
        const push = minDist - d;
        body.x += nx * push;
        body.z += nz * push;
        const into = body.vx * nx + body.vz * nz;
        if (into < 0) {
          body.vx -= into * nx;
          body.vz -= into * nz;
        }
        moved = true;
        hit = true;
      }
      if (this.boundsRadius !== Infinity) {
        const maxR = this.boundsRadius - radius;
        const r = Math.hypot(body.x, body.z);
        if (r > maxR) {
          const nx = -body.x / r;
          const nz = -body.z / r;
          body.x += nx * (r - maxR);
          body.z += nz * (r - maxR);
          const into = body.vx * -nx + body.vz * -nz; // velocity along the outward normal
          if (into > 0) {
            body.vx -= into * -nx;
            body.vz -= into * -nz;
          }
          moved = true;
          hit = true;
        }
      }
      if (this.halfX !== Infinity) {
        const mx = this.halfX - radius;
        if (body.x > mx) { body.x = mx; if (body.vx > 0) body.vx = 0; moved = hit = true; }
        else if (body.x < -mx) { body.x = -mx; if (body.vx < 0) body.vx = 0; moved = hit = true; }
      }
      if (this.halfZ !== Infinity) {
        const mz = this.halfZ - radius;
        if (body.z > mz) { body.z = mz; if (body.vz > 0) body.vz = 0; moved = hit = true; }
        else if (body.z < -mz) { body.z = -mz; if (body.vz < 0) body.vz = 0; moved = hit = true; }
      }
      if (!moved) break;
    }
    return hit;
  }
}
