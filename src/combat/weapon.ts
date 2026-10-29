import type { Equipment } from '../game/equipment';
import { getItem, type WeaponStats } from '../game/items';

export interface WeaponProfile extends WeaponStats {
  readonly name: string;
}

/** What the basic attack uses when no weapon is equipped. */
export const UNARMED: WeaponProfile = { name: 'Fists', range: 1.9, cooldown: 1.0 };

/** The combat profile of whatever is in the weapon slot (reach and attack interval; the damage comes from the Attack stat). */
export function weaponProfile(equipment: Pick<Equipment, 'get'>): WeaponProfile {
  const id = equipment.get('weapon');
  if (!id) return UNARMED;
  const def = getItem(id);
  return def.weapon ? { name: def.name, ...def.weapon } : { name: def.name, range: UNARMED.range, cooldown: UNARMED.cooldown };
}
