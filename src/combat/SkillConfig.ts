/**
 * Data-driven skills. A new skill is one more entry here: the SkillSystem (validation, cooldowns, mana) and the
 * CombatSystem (damage) are generic, and the hotbar builds itself from this list.
 */
export type SkillIcon = 'slash' | 'strike' | 'whirl';

export interface SkillDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Hotbar slot, 1-based; the keyboard key is the matching digit. */
  readonly slot: number;
  readonly icon: SkillIcon;
  /** Seconds. 'weapon' = the equipped weapon's attack interval (the basic attack). */
  readonly cooldown: number | 'weapon';
  readonly manaCost: number;
  /** 'enemy' needs the selected target within reach; 'around' hits every living monster within areaRadius of the player. */
  readonly target: 'enemy' | 'around';
  /** Added to the weapon's reach (m) for 'enemy' skills. */
  readonly rangeBonus: number;
  /** Radius (m, from the player's centre to the monster's surface) of an 'around' skill. */
  readonly areaRadius: number;
  /** Multiplies the Attack stat in the damage rule. */
  readonly multiplier: number;
}

/** After ANY skill the player cannot start another one for this long (s): no key-mashing multi-hits in one frame. */
export const GLOBAL_COOLDOWN = 0.6;

export const SKILLS: readonly SkillDef[] = [
  {
    id: 'basic_attack', name: 'Attack', slot: 1, icon: 'slash',
    description: 'A swing with the equipped weapon. Reach and speed depend on the weapon.',
    cooldown: 'weapon', manaCost: 0, target: 'enemy', rangeBonus: 0, areaRadius: 0, multiplier: 1,
  },
  {
    id: 'power_strike', name: 'Power Strike', slot: 2, icon: 'strike',
    description: 'A heavy blow for 220 % damage with a little extra reach.',
    cooldown: 6, manaCost: 12, target: 'enemy', rangeBonus: 0.6, areaRadius: 0, multiplier: 2.2,
  },
  {
    id: 'whirlwind', name: 'Whirlwind', slot: 3, icon: 'whirl',
    description: 'Spin and hit every enemy around you for 140 % damage. No target needed.',
    cooldown: 10, manaCost: 20, target: 'around', rangeBonus: 0, areaRadius: 3.2, multiplier: 1.4,
  },
];
