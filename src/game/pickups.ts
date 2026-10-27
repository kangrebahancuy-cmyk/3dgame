import type { ItemId } from './items';

export interface Pickup {
  readonly uid: number;
  readonly id: ItemId;
  readonly qty: number;
  readonly x: number;
  readonly z: number;
}

/** Distance (m) within which E picks something up. */
export const INTERACT_RANGE = 2.0;

/** Items lying in the world. Pure data: the renderer subscribes to add/remove events. */
export class PickupSystem {
  private readonly items = new Map<number, Pickup>();
  private nextUid = 1;
  private readonly addListeners = new Set<(p: Pickup) => void>();
  private readonly removeListeners = new Set<(p: Pickup) => void>();

  get count(): number {
    return this.items.size;
  }

  all(): IterableIterator<Pickup> {
    return this.items.values();
  }

  has(uid: number): boolean {
    return this.items.has(uid);
  }

  onAdd(cb: (p: Pickup) => void): void {
    this.addListeners.add(cb);
  }

  onRemove(cb: (p: Pickup) => void): void {
    this.removeListeners.add(cb);
  }

  spawn(id: ItemId, qty: number, x: number, z: number): Pickup {
    const p: Pickup = { uid: this.nextUid++, id, qty, x, z };
    this.items.set(p.uid, p);
    for (const cb of this.addListeners) cb(p);
    return p;
  }

  /** Removes a pickup. Returns false if it was already gone (so it can never be collected twice). */
  remove(uid: number): boolean {
    const p = this.items.get(uid);
    if (!p) return false;
    this.items.delete(uid);
    for (const cb of this.removeListeners) cb(p);
    return true;
  }

  /** Closest pickup within `range` of (x, z), or null. Allocation-free (called every frame). */
  nearest(x: number, z: number, range: number = INTERACT_RANGE): Pickup | null {
    let best: Pickup | null = null;
    let bestD2 = range * range;
    for (const p of this.items.values()) {
      const dx = p.x - x, dz = p.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = p;
      }
    }
    return best;
  }
}
