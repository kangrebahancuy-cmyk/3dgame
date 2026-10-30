import type { CombatEvents } from './events';
import type { Monster } from './Monster';
import type { MonsterSystem } from './MonsterSystem';

/** Monsters further than this (m) cannot be selected with Tab / a click. */
export const MAX_SELECT_DISTANCE = 30;
/** A selected target that gets further than this is dropped automatically. */
export const MAX_KEEP_DISTANCE = 40;

export interface Ray3 {
  readonly ox: number; readonly oy: number; readonly oz: number;
  /** Direction (need not be normalised). */
  readonly dx: number; readonly dy: number; readonly dz: number;
}

/** Distance along the ray to a sphere, or null. */
function raySphere(r: Ray3, cx: number, cy: number, cz: number, radius: number): number | null {
  const len = Math.hypot(r.dx, r.dy, r.dz);
  if (len < 1e-9) return null;
  const dx = r.dx / len, dy = r.dy / len, dz = r.dz / len;
  const mx = r.ox - cx, my = r.oy - cy, mz = r.oz - cz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - radius * radius;
  if (c > 0 && b > 0) return null; // ray starts outside and points away
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : 0;
}

/**
 * Which monster the player has selected. Pure: it knows monsters and distances, never the mouse or the camera
 * (the Babylon glue turns a click into a Ray3 and calls pickByRay).
 */
export class TargetingSystem {
  private id: number | null = null;

  constructor(
    private readonly monsters: MonsterSystem,
    private readonly events: CombatEvents,
  ) {}

  get targetId(): number | null {
    return this.id;
  }

  /** The selected monster if it still exists and is alive; a dead or missing one is dropped on the spot. */
  get target(): Monster | null {
    if (this.id === null) return null;
    const m = this.monsters.get(this.id);
    if (!m || !m.alive) {
      this.clear();
      return null;
    }
    return m;
  }

  /** Selects a living monster. Returns false (selection unchanged) for unknown or dead ones. */
  select(id: number): boolean {
    const m = this.monsters.get(id);
    if (!m || !m.alive) return false;
    if (this.id !== id) {
      this.id = id;
      this.events.emit({ type: 'targetChanged', targetId: id });
    }
    return true;
  }

  clear(): void {
    if (this.id === null) return;
    this.id = null;
    this.events.emit({ type: 'targetChanged', targetId: null });
  }

  /** Tab: the next living monster within MAX_SELECT_DISTANCE, nearest first, wrapping around. Returns its id or null. */
  cycle(x: number, z: number): number | null {
    const near = this.monsters.within(x, z, MAX_SELECT_DISTANCE);
    if (near.length === 0) {
      this.clear();
      return null;
    }
    const cur = near.findIndex((m) => m.id === this.id);
    const next = near[(cur + 1) % near.length];
    this.select(next.id);
    return next.id;
  }

  /** Called every frame: drops a dead target or one that wandered too far away. */
  validate(x: number, z: number): void {
    const t = this.target; // clears a dead/missing one itself
    if (t && Math.hypot(t.x - x, t.z - z) > MAX_KEEP_DISTANCE) this.clear();
  }

  /**
   * The nearest living monster hit by a picking ray (monsters are approximated by three stacked spheres, generous
   * enough to click comfortably). Selects nothing; returns the id or null.
   */
  pickByRay(ray: Ray3): number | null {
    let best: number | null = null;
    let bestT = Infinity;
    for (const m of this.monsters.all) {
      if (!m.alive) continue;
      const h = m.height;
      const r = Math.max(m.config.radius * 1.15, h * 0.26);
      for (const f of [0.25, 0.55, 0.85]) {
        const t = raySphere(ray, m.x, h * f, m.z, r);
        if (t !== null && t < bestT) {
          bestT = t;
          best = m.id;
        }
      }
    }
    return best;
  }
}
