import { getItem, type ItemId } from './items';

export interface ItemStack {
  readonly id: ItemId;
  qty: number;
}

export interface AddResult {
  /** How many were stored. Always either 0 or the full amount: adding is all-or-nothing. */
  added: number;
}

export const DEFAULT_CAPACITY = 24;

/**
 * A fixed number of slots, each empty or holding one stack. Pure data structure; the only place that knows the
 * stacking rules. Operations are all-or-nothing, so a failed action can never leave half an item behind.
 */
export class Inventory {
  private readonly slots: Array<ItemStack | null>;

  constructor(readonly capacity: number = DEFAULT_CAPACITY) {
    this.slots = new Array<ItemStack | null>(capacity).fill(null);
  }

  /** Read-only view of a slot (do not mutate the returned stack). */
  at(index: number): Readonly<ItemStack> | null {
    return this.slots[index] ?? null;
  }

  get freeSlots(): number {
    let n = 0;
    for (const s of this.slots) if (!s) n++;
    return n;
  }

  get isFull(): boolean {
    return this.freeSlots === 0;
  }

  firstEmpty(): number {
    return this.slots.findIndex((s) => s === null);
  }

  countOf(id: ItemId): number {
    let n = 0;
    for (const s of this.slots) if (s?.id === id) n += s.qty;
    return n;
  }

  /** Room for `qty` more of `id`: space in partial stacks first, then empty slots. */
  canAdd(id: ItemId, qty: number): boolean {
    if (!Number.isInteger(qty) || qty <= 0) return false;
    const max = getItem(id).maxStack;
    let room = 0;
    for (const s of this.slots) {
      if (!s) room += max;
      else if (s.id === id) room += max - s.qty;
      if (room >= qty) return true;
    }
    return room >= qty;
  }

  /** Adds `qty` of `id` (filling existing stacks first) or changes nothing if it does not all fit. */
  add(id: ItemId, qty: number): AddResult {
    if (!this.canAdd(id, qty)) return { added: 0 };
    const max = getItem(id).maxStack;
    let left = qty;
    for (const s of this.slots) {
      if (left === 0) break;
      if (s && s.id === id && s.qty < max) {
        const n = Math.min(max - s.qty, left);
        s.qty += n;
        left -= n;
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (this.slots[i] === null) {
        const n = Math.min(max, left);
        this.slots[i] = { id, qty: n };
        left -= n;
      }
    }
    return { added: qty };
  }

  /** Removes up to `qty` from a slot and returns what was removed (null if the slot is empty / qty invalid). */
  take(index: number, qty: number): ItemStack | null {
    const s = this.slots[index];
    if (!s || !Number.isInteger(qty) || qty <= 0) return null;
    const n = Math.min(qty, s.qty);
    s.qty -= n;
    const out: ItemStack = { id: s.id, qty: n };
    if (s.qty === 0) this.slots[index] = null;
    return out;
  }

  /** Puts a whole stack into a specific EMPTY slot (used to swap equipment into the slot just vacated). */
  place(index: number, id: ItemId, qty: number): boolean {
    if (this.slots[index] !== null || qty <= 0 || qty > getItem(id).maxStack) return false;
    this.slots[index] = { id, qty };
    return true;
  }

  /** Total number of items (sum of quantities); handy for invariants in tests. */
  totalItems(): number {
    let n = 0;
    for (const s of this.slots) if (s) n += s.qty;
    return n;
  }

  snapshot(): Array<ItemStack | null> {
    return this.slots.map((s) => (s ? { ...s } : null));
  }
}
