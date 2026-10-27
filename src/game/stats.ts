import { clamp } from '../math/scalar';
import type { ItemDef, StatBonus } from './items';

/** Extensible base attributes: add an id here and give it a value in `newCharacter` / `deriveStats`. */
export type AttributeId = 'strength' | 'vitality' | 'agility' | 'intellect';
export const ATTRIBUTE_IDS: readonly AttributeId[] = ['strength', 'vitality', 'agility', 'intellect'];
export const ATTRIBUTE_LABEL: Readonly<Record<AttributeId, string>> = {
  strength: 'Strength',
  vitality: 'Vitality',
  agility: 'Agility',
  intellect: 'Intellect',
};

export const MAX_LEVEL = 50;
export const MAX_NAME_LENGTH = 16;
/** Safety cap on the movement bonus from equipment (a fraction: 0.25 = +25 %). */
export const MAX_MOVE_SPEED_BONUS = 0.25;

/**
 * The persistent character data (what would be saved). Derived numbers (max HP, attack, ...) are NEVER stored:
 * they are recomputed from this plus the equipped items, so they cannot drift or stack up.
 */
export interface CharacterProfile {
  name: string;
  level: number;
  xp: number;
  /** Current HP and mana. Always kept inside [0, max] by the functions below. */
  hp: number;
  mana: number;
  attributes: Record<AttributeId, number>;
}

/** Everything derived from the profile and the equipment. */
export interface FinalStats {
  maxHp: number;
  maxMana: number;
  attack: number;
  defense: number;
  /** 1 = normal; 1.08 = +8 %. Already clamped to [1, 1 + MAX_MOVE_SPEED_BONUS]. */
  moveSpeedMultiplier: number;
  xpToNext: number;
}

export function newCharacter(name = 'Adventurer'): CharacterProfile {
  const p: CharacterProfile = {
    name: sanitizeName(name) || 'Adventurer',
    level: 1,
    xp: 35, // a little progress so the XP bar is visibly working from the start
    hp: 70, // below max on purpose, so a Health Potion can be tested right away
    mana: 50,
    attributes: { strength: 5, vitality: 5, agility: 5, intellect: 5 },
  };
  return p;
}

/** Trims, collapses whitespace and strips control characters; the name is only ever shown via textContent. */
export function sanitizeName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

/** XP needed to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  return Math.round(100 * Math.pow(Math.max(1, level), 1.4));
}

/** Sum of the bonuses of the given items. Pure: calling it twice gives the same answer, nothing accumulates. */
export function sumBonuses(items: ReadonlyArray<ItemDef | null | undefined>): Required<StatBonus> {
  const t = { attack: 0, defense: 0, maxHp: 0, moveSpeed: 0 };
  for (const it of items) {
    if (!it?.bonus) continue;
    t.attack += it.bonus.attack ?? 0;
    t.defense += it.bonus.defense ?? 0;
    t.maxHp += it.bonus.maxHp ?? 0;
    t.moveSpeed += it.bonus.moveSpeed ?? 0;
  }
  return t;
}

export function deriveStats(p: Readonly<CharacterProfile>, equipped: ReadonlyArray<ItemDef | null | undefined>): FinalStats {
  const b = sumBonuses(equipped);
  const a = p.attributes;
  return {
    maxHp: Math.round(80 + a.vitality * 4 + (p.level - 1) * 10 + b.maxHp),
    maxMana: Math.round(30 + a.intellect * 4 + (p.level - 1) * 5),
    attack: Math.round(4 + a.strength + (p.level - 1) * 1.5 + b.attack),
    defense: Math.round(a.vitality * 0.5 + (p.level - 1) * 0.5 + b.defense),
    moveSpeedMultiplier: 1 + clamp(b.moveSpeed, 0, MAX_MOVE_SPEED_BONUS),
    xpToNext: xpForLevel(p.level),
  };
}

/** Puts hp and mana back inside [0, max]. Call after anything that can change the maxima. */
export function clampVitals(p: CharacterProfile, s: Pick<FinalStats, 'maxHp' | 'maxMana'>): void {
  p.hp = clamp(Number.isFinite(p.hp) ? p.hp : 0, 0, s.maxHp);
  p.mana = clamp(Number.isFinite(p.mana) ? p.mana : 0, 0, s.maxMana);
}
