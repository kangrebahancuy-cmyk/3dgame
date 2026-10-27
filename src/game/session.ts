import type { ItemId } from './items';
import { PickupSystem, type Pickup } from './pickups';
import { PlayerState } from './playerState';

/** Where the starting pickups lie: inside the spawn clearing, on open ground (a test checks nothing solid is there). */
export const INITIAL_PICKUPS: ReadonlyArray<readonly [ItemId, number, number, number]> = [
  ['health_potion', 1, 2.4, 1.6],
  ['health_potion', 2, -2.8, -2.2],
  ['wooden_sword', 1, 0.2, 3.6],
  ['iron_helmet', 1, -3.8, 2.8],
  ['traveler_armor', 1, 3.6, -3.4],
  ['leather_boots', 1, -4.2, -3.6],
  ['wood', 3, 1.4, -5.0],
  ['wood', 2, 5.4, -1.0],
  ['stone', 2, -1.4, 5.2],
  ['stone', 3, -5.6, 0.4],
];

/** How far in front of the player a dropped item lands, and the walkable half-size it is kept inside. */
const DROP_DISTANCE = 1.1;

/** Ties the player's state to the items lying in the world. Both the UI and the 3D view go through this. */
export class GameSession {
  readonly state: PlayerState;
  readonly pickups = new PickupSystem();

  constructor(state: PlayerState = new PlayerState(), private readonly mapHalf = 32) {
    this.state = state;
  }

  spawnInitialPickups(): void {
    for (const [id, qty, x, z] of INITIAL_PICKUPS) this.pickups.spawn(id, qty, x, z);
  }

  /** The pickup E would collect from (x, z), if any. */
  promptTarget(x: number, z: number): Pickup | null {
    return this.pickups.nearest(x, z);
  }

  /** E pressed at (x, z): take the nearest pickup if it fits; otherwise it stays in the world. */
  interact(x: number, z: number): boolean {
    const p = this.pickups.nearest(x, z);
    if (!p || !this.pickups.has(p.uid)) return false;
    const r = this.state.pickUp(p.id, p.qty);
    if (r.ok) this.pickups.remove(p.uid);
    return r.ok;
  }

  /** Drops `qty` (or the whole stack) from an inventory slot in front of a player standing at (x, z) facing `yaw`. */
  drop(slot: number, qty: number | 'all', x: number, z: number, yaw: number): boolean {
    const s = this.state.inventory.at(slot);
    if (!s) return false;
    const n = qty === 'all' ? s.qty : qty;
    const r = this.state.removeForDrop(slot, n);
    if (!r.ok || !r.stack) return false;
    const lim = this.mapHalf - 0.6;
    const px = Math.max(-lim, Math.min(lim, x + Math.sin(yaw) * DROP_DISTANCE));
    const pz = Math.max(-lim, Math.min(lim, z + Math.cos(yaw) * DROP_DISTANCE));
    this.pickups.spawn(r.stack.id, r.stack.qty, px, pz);
    return true;
  }

  /** Developer helper (exposed as window.__game.dev): fills every free slot with a non-stackable item. */
  debugFillInventory(): number {
    let n = 0;
    while (!this.state.inventory.isFull) {
      this.state.inventory.add('wooden_sword', 1);
      n++;
    }
    this.state.refresh();
    return n;
  }
}
