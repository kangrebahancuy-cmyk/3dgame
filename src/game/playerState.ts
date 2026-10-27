import { clamp } from '../math/scalar';
import { Equipment } from './equipment';
import { Inventory, type ItemStack } from './inventory';
import { equipSlotOf, getItem, ITEM_TYPE_LABEL, type EquipSlot, type ItemId } from './items';
import {
  clampVitals, deriveStats, MAX_LEVEL, newCharacter, sanitizeName, xpForLevel,
  type CharacterProfile, type FinalStats,
} from './stats';

export type MessageKind = 'info' | 'success' | 'warning' | 'error';
export interface GameMessage {
  readonly kind: MessageKind;
  readonly text: string;
}
export interface ActionResult {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * THE single source of truth for the player: profile (name, level, xp, hp, attributes), inventory and equipment.
 * The UI only reads from here and calls these actions; derived stats are recomputed from scratch on every change
 * (never added to), so swapping equipment any number of times cannot make the numbers drift.
 *
 * Every action is all-or-nothing, reports one message and notifies listeners once.
 */
export class PlayerState {
  readonly profile: CharacterProfile;
  readonly inventory: Inventory;
  readonly equipment = new Equipment();

  private statsCache: FinalStats;
  private readonly changeListeners = new Set<() => void>();
  private readonly messageListeners = new Set<(m: GameMessage) => void>();

  constructor(profile: CharacterProfile = newCharacter(), inventory: Inventory = new Inventory()) {
    this.profile = profile;
    this.inventory = inventory;
    this.statsCache = deriveStats(this.profile, this.equipment.items());
    clampVitals(this.profile, this.statsCache);
  }

  /** Final stats (base + level + equipment). Cached; recomputed whenever anything changes. */
  get stats(): Readonly<FinalStats> {
    return this.statsCache;
  }

  onChange(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }

  onMessage(cb: (m: GameMessage) => void): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  // ---------------------------------------------------------------------------------------------- actions

  rename(raw: string): ActionResult {
    const name = sanitizeName(raw);
    if (!name) return this.fail('The name cannot be empty.');
    this.profile.name = name;
    this.changed();
    return { ok: true, message: `Name set to ${name}.` };
  }

  /** Adds items to the inventory (used by pickups). All-or-nothing: if it does not all fit, nothing is added. */
  pickUp(id: ItemId, qty: number): ActionResult {
    const def = getItem(id);
    if (!this.inventory.canAdd(id, qty)) {
      return this.fail(`Inventory full: could not take ${def.name}${qty > 1 ? ` ×${qty}` : ''}.`);
    }
    this.inventory.add(id, qty);
    return this.ok('success', `Picked up ${def.name}${qty > 1 ? ` ×${qty}` : ''}.`);
  }

  /** Uses the consumable in an inventory slot. A potion is refused (and NOT consumed) at full HP. */
  use(slot: number): ActionResult {
    const s = this.inventory.at(slot);
    if (!s) return this.fail('Nothing in that slot.');
    const def = getItem(s.id);
    if (def.type !== 'consumable' || !def.use) return this.fail(`${def.name} cannot be used.`);
    if (def.use.healHp !== undefined) {
      if (this.profile.hp >= this.stats.maxHp) return this.fail('HP is already full.');
      const before = this.profile.hp;
      this.inventory.take(slot, 1);
      this.profile.hp = clamp(before + def.use.healHp, 0, this.stats.maxHp);
      return this.ok('success', `Used ${def.name}: +${Math.round(this.profile.hp - before)} HP.`);
    }
    return this.fail(`${def.name} cannot be used.`);
  }

  /** Equips the item in an inventory slot. A worn item in that slot goes back into the inventory slot just freed. */
  equip(slot: number): ActionResult {
    const s = this.inventory.at(slot);
    if (!s) return this.fail('Nothing in that slot.');
    const def = getItem(s.id);
    const target = equipSlotOf(def);
    if (!target) return this.fail(`${def.name} (${ITEM_TYPE_LABEL[def.type]}) cannot be equipped.`);
    const id = s.id;
    this.inventory.take(slot, 1); // equipment is never stackable, so this empties the slot
    const previous = this.equipment.set(target, id);
    if (previous === undefined) {
      this.inventory.place(slot, id, 1); // cannot happen for a matching type; restores state if it ever does
      return this.fail(`${def.name} does not fit the ${target} slot.`);
    }
    if (previous !== null && !this.inventory.place(slot, previous, 1) && this.inventory.add(previous, 1).added === 0) {
      // Only reachable for a (future) stackable equippable with no room for the old item: undo everything.
      this.equipment.set(target, previous);
      this.inventory.add(id, 1);
      return this.fail(`Inventory full: no room to swap out ${getItem(previous).name}.`);
    }
    return this.ok('success', previous ? `Equipped ${def.name} (replaced ${getItem(previous).name}).` : `Equipped ${def.name}.`);
  }

  /** Takes an item off. Refused while the inventory has no free slot, and then nothing changes. */
  unequip(slot: EquipSlot): ActionResult {
    const id = this.equipment.get(slot);
    if (!id) return this.fail('Nothing equipped in that slot.');
    const def = getItem(id);
    if (this.inventory.isFull) return this.fail(`Inventory full: free a slot to unequip ${def.name}.`);
    this.equipment.set(slot, null);
    this.inventory.add(id, 1);
    return this.ok('info', `Unequipped ${def.name}.`);
  }

  /**
   * Removes up to `qty` items from a slot and returns the removed stack so the caller can put it into the world.
   * (Equipped items cannot be dropped: unequip first.)
   */
  removeForDrop(slot: number, qty: number): ActionResult & { stack: ItemStack | null } {
    const s = this.inventory.at(slot);
    if (!s) return { ...this.fail('Nothing in that slot.'), stack: null };
    const def = getItem(s.id);
    const taken = this.inventory.take(slot, qty);
    if (!taken) return { ...this.fail('Nothing to drop.'), stack: null };
    return { ...this.ok('info', `Dropped ${def.name}${taken.qty > 1 ? ` ×${taken.qty}` : ''}.`), stack: taken };
  }

  /** Recompute derived stats and notify listeners (after changing the inventory directly, e.g. from a dev helper). */
  refresh(): void {
    this.changed();
  }

  // ------------------------------------------------------------------------------ vitals (used by future combat)

  damage(amount: number): void {
    if (!(amount > 0)) return;
    this.profile.hp = clamp(this.profile.hp - amount, 0, this.stats.maxHp);
    this.changed();
  }

  heal(amount: number): void {
    if (!(amount > 0)) return;
    this.profile.hp = clamp(this.profile.hp + amount, 0, this.stats.maxHp);
    this.changed();
  }

  gainXp(amount: number): void {
    if (!(amount > 0)) return;
    const p = this.profile;
    p.xp += Math.floor(amount);
    let leveled = 0;
    while (p.level < MAX_LEVEL && p.xp >= xpForLevel(p.level)) {
      p.xp -= xpForLevel(p.level);
      p.level++;
      leveled++;
    }
    if (p.level >= MAX_LEVEL) p.xp = Math.min(p.xp, xpForLevel(p.level) - 1);
    if (leveled > 0) {
      this.statsCache = deriveStats(p, this.equipment.items());
      p.hp = this.statsCache.maxHp; // a level-up restores HP and mana
      p.mana = this.statsCache.maxMana;
      this.emit({ kind: 'success', text: `Level up! You are now level ${p.level}.` });
    }
    this.changed();
  }

  // ---------------------------------------------------------------------------------------------- internals

  private ok(kind: MessageKind, text: string): ActionResult {
    this.changed();
    this.emit({ kind, text });
    return { ok: true, message: text };
  }

  private fail(text: string): ActionResult {
    this.emit({ kind: 'error', text });
    return { ok: false, message: text };
  }

  /** Recompute derived stats from scratch, clamp vitals, notify. */
  private changed(): void {
    this.statsCache = deriveStats(this.profile, this.equipment.items());
    clampVitals(this.profile, this.statsCache);
    for (const cb of this.changeListeners) cb();
  }

  private emit(m: GameMessage): void {
    for (const cb of this.messageListeners) cb(m);
  }
}
