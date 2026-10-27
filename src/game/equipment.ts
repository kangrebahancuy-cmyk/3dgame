import { EQUIP_SLOTS, equipSlotOf, getItem, type EquipSlot, type ItemDef, type ItemId } from './items';

/** The four equipment slots. Holds item ids only; bonuses are looked up from the definitions when needed. */
export class Equipment {
  private readonly worn: Record<EquipSlot, ItemId | null> = { weapon: null, helmet: null, armor: null, boots: null };

  get(slot: EquipSlot): ItemId | null {
    return this.worn[slot];
  }

  /** Whether `id` is allowed in `slot` (the item type must match the slot). */
  static accepts(slot: EquipSlot, id: ItemId): boolean {
    return equipSlotOf(getItem(id)) === slot;
  }

  /** Sets a slot and returns what was there before. Rejects (returns undefined) if the item does not fit the slot. */
  set(slot: EquipSlot, id: ItemId | null): ItemId | null | undefined {
    if (id !== null && !Equipment.accepts(slot, id)) return undefined;
    const prev = this.worn[slot];
    this.worn[slot] = id;
    return prev;
  }

  /** Definitions of everything currently worn, in slot order (empty slots are skipped). */
  items(): ItemDef[] {
    const out: ItemDef[] = [];
    for (const s of EQUIP_SLOTS) {
      const id = this.worn[s];
      if (id) out.push(getItem(id));
    }
    return out;
  }

  snapshot(): Record<EquipSlot, ItemId | null> {
    return { ...this.worn };
  }
}
