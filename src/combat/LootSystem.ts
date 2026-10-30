import { getItem, type ItemId } from '../game/items';
import type { PickupSystem } from '../game/pickups';
import type { LootEntry } from './MonsterConfig';

export interface LootDrop {
  readonly id: ItemId;
  readonly name: string;
  readonly qty: number;
}

/** Rolls a loot table: every entry independently succeeds with its `chance`, then a quantity in [min, max]. */
export function rollLoot(table: readonly LootEntry[], rng: () => number): Array<{ item: ItemId; qty: number }> {
  const out: Array<{ item: ItemId; qty: number }> = [];
  for (const e of table) {
    if (rng() >= e.chance) continue;
    const lo = Math.max(1, Math.floor(e.min));
    const hi = Math.max(lo, Math.floor(e.max));
    out.push({ item: e.item, qty: lo + Math.floor(rng() * (hi - lo + 1)) });
  }
  return out;
}

/**
 * Turns a loot table into world pickups. Loot is ALWAYS spawned as ordinary pickups (PickupSystem), so the existing
 * "E to pick up" rules decide what fits: a full backpack leaves the stack lying on the ground (nothing is lost or
 * duplicated), and stacking is the inventory's own. One call = one set of pickups; the CombatSystem calls it once per kill.
 */
export class LootSystem {
  constructor(
    private readonly pickups: PickupSystem,
    private readonly rng: () => number,
    /** True where a pickup must not be placed (tree, rock). Optional. */
    private readonly isBlocked: (x: number, z: number) => boolean = () => false,
    /** Walkable half-size of the map; drops are kept inside. */
    private readonly mapHalf = 32,
  ) {}

  dropAt(x: number, z: number, table: readonly LootEntry[]): LootDrop[] {
    const rolled = rollLoot(table, this.rng);
    const out: LootDrop[] = [];
    const base = this.rng() * Math.PI * 2;
    rolled.forEach((r, i) => {
      const spot = this.freeSpot(x, z, base + i * 2.4, 0.8 + 0.2 * i);
      this.pickups.spawn(r.item, r.qty, spot.x, spot.z);
      out.push({ id: r.item, name: getItem(r.item).name, qty: r.qty });
    });
    return out;
  }

  /** The first free spot on a widening spiral around (x, z); the corpse's own position if everything nearby is blocked. */
  private freeSpot(x: number, z: number, angle: number, radius: number): { x: number; z: number } {
    const lim = this.mapHalf - 0.6;
    for (let k = 0; k < 8; k++) {
      const a = angle + k * 0.8;
      const r = radius + k * 0.15;
      const px = Math.max(-lim, Math.min(lim, x + Math.sin(a) * r));
      const pz = Math.max(-lim, Math.min(lim, z + Math.cos(a) * r));
      if (!this.isBlocked(px, pz)) return { x: px, z: pz };
    }
    return { x: Math.max(-lim, Math.min(lim, x)), z: Math.max(-lim, Math.min(lim, z)) };
  }
}
