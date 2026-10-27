/** Central item definitions. Everything else refers to items by `ItemId` only; nothing is hard-coded elsewhere. */

export type ItemType = 'consumable' | 'weapon' | 'helmet' | 'armor' | 'boots' | 'material';
export type EquipSlot = 'weapon' | 'helmet' | 'armor' | 'boots';

export const EQUIP_SLOTS: readonly EquipSlot[] = ['weapon', 'helmet', 'armor', 'boots'];

/** Stat bonuses an equipped item gives. `moveSpeed` is a FRACTION (0.08 = +8 %). Add new keys here to extend. */
export interface StatBonus {
  attack?: number;
  defense?: number;
  maxHp?: number;
  moveSpeed?: number;
}

export interface ItemUse {
  /** HP restored when used. */
  healHp?: number;
}

export interface ItemDef {
  /** Unique, stable identity (never shown to the player). */
  readonly id: string;
  readonly name: string;
  readonly type: ItemType;
  readonly description: string;
  /** How many fit in one inventory slot. 1 = not stackable. */
  readonly maxStack: number;
  readonly bonus?: StatBonus;
  readonly use?: ItemUse;
  /** Placeholder icon: a shape key (see ui/icons.ts) and its colour. */
  readonly icon: { readonly shape: IconShape; readonly color: string };
}

export type IconShape = 'potion' | 'sword' | 'helmet' | 'armor' | 'boots' | 'wood' | 'stone';

function define<const T extends Record<string, Omit<ItemDef, 'id'>>>(defs: T): { [K in keyof T]: ItemDef & { readonly id: K } } {
  const out: Record<string, ItemDef> = {};
  for (const [id, d] of Object.entries(defs)) out[id] = { id, ...d };
  return out as { [K in keyof T]: ItemDef & { readonly id: K } };
}

export const ITEMS = define({
  health_potion: {
    name: 'Health Potion',
    type: 'consumable',
    description: 'A small red vial. Restores 40 HP. Cannot be used at full health.',
    maxStack: 10,
    use: { healHp: 40 },
    icon: { shape: 'potion', color: '#e5484d' },
  },
  wooden_sword: {
    name: 'Wooden Sword',
    type: 'weapon',
    description: 'A sturdy training sword. +4 Attack.',
    maxStack: 1,
    bonus: { attack: 4 },
    icon: { shape: 'sword', color: '#c8935a' },
  },
  iron_helmet: {
    name: 'Iron Helmet',
    type: 'helmet',
    description: 'Dented but dependable. +3 Defense.',
    maxStack: 1,
    bonus: { defense: 3 },
    icon: { shape: 'helmet', color: '#9fb0bf' },
  },
  traveler_armor: {
    name: 'Traveler Armor',
    type: 'armor',
    description: 'Layered cloth and leather for the road. +5 Defense.',
    maxStack: 1,
    bonus: { defense: 5 },
    icon: { shape: 'armor', color: '#4f8f6a' },
  },
  leather_boots: {
    name: 'Leather Boots',
    type: 'boots',
    description: 'Light boots. +1 Defense, +8 % movement speed.',
    maxStack: 1,
    bonus: { defense: 1, moveSpeed: 0.08 },
    icon: { shape: 'boots', color: '#8a5a3c' },
  },
  wood: {
    name: 'Wood',
    type: 'material',
    description: 'A bundle of logs. Crafting material (stacks to 50).',
    maxStack: 50,
    icon: { shape: 'wood', color: '#a8764a' },
  },
  stone: {
    name: 'Stone',
    type: 'material',
    description: 'A rough grey stone. Crafting material (stacks to 50).',
    maxStack: 50,
    icon: { shape: 'stone', color: '#8e949b' },
  },
});

export type ItemId = keyof typeof ITEMS;

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

export function isItemId(id: string): id is ItemId {
  return Object.prototype.hasOwnProperty.call(ITEMS, id);
}

export function getItem(id: ItemId): ItemDef {
  return ITEMS[id];
}

/** The equipment slot an item goes into, or null if it cannot be equipped. */
export function equipSlotOf(def: ItemDef): EquipSlot | null {
  return def.type === 'weapon' || def.type === 'helmet' || def.type === 'armor' || def.type === 'boots' ? def.type : null;
}

export const ITEM_TYPE_LABEL: Readonly<Record<ItemType, string>> = {
  consumable: 'Consumable',
  weapon: 'Weapon',
  helmet: 'Helmet',
  armor: 'Armor',
  boots: 'Boots',
  material: 'Material',
};
