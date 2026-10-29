import { clamp } from '../math/scalar';

/**
 * The ONE damage rule, used in both directions (player -> monster, monster -> player):
 *
 *   raw      = attack × skillMultiplier × (0.9 … 1.1)
 *   damage   = round(raw × DEFENSE_SCALE / (DEFENSE_SCALE + defense)), at least MIN_DAMAGE
 *   critical = damage × CRIT_MULTIPLIER
 *
 * so every point of defense helps a little less than the one before (diminishing returns: 25 defense halves the damage)
 * and armor can never make someone immune. Hit chance = accuracy − evasion, kept in [MIN_HIT_CHANCE, 1].
 * Everything is pure; the dice come from an injected rng so tests are deterministic.
 */
export const DEFENSE_SCALE = 25;
export const MIN_DAMAGE = 1;
export const CRIT_MULTIPLIER = 1.5;
export const VARIANCE = 0.1;
export const MIN_HIT_CHANCE = 0.35;
export const PLAYER_ACCURACY = 0.95;
export const BASE_CRIT_CHANCE = 0.05;

/** Fraction of the damage that gets through `defense` (1 = none stopped). */
export function mitigation(defense: number): number {
  const d = Math.max(0, Number.isFinite(defense) ? defense : 0);
  return DEFENSE_SCALE / (DEFENSE_SCALE + d);
}

/** Damage with no dice at all (no variance, no crit, always hits): what tooltips and tests compare against. */
export function expectedDamage(attack: number, multiplier: number, defense: number): number {
  return Math.max(MIN_DAMAGE, Math.round(attack * multiplier * mitigation(defense)));
}

export function hitChance(accuracy: number, evasion: number): number {
  return clamp(accuracy - evasion, MIN_HIT_CHANCE, 1);
}

/** The player's dodge chance from Agility (1 % per point, at most 20 %). */
export function playerEvasion(agility: number): number {
  return clamp(agility * 0.01, 0, 0.2);
}

/** The player's critical chance from Agility. */
export function playerCritChance(agility: number): number {
  return clamp(BASE_CRIT_CHANCE + agility * 0.005, 0, 0.5);
}

export interface DamageInput {
  /** The attacker's attack value (player: Attack stat incl. weapon; monster: its `damage`). */
  attack: number;
  /** Skill multiplier (1 = a basic attack). */
  multiplier: number;
  /** The victim's defense (player: Defense stat incl. armor; monster: its `defense`). */
  defense: number;
  accuracy: number;
  evasion: number;
  critChance: number;
}

export interface DamageResult {
  readonly hit: boolean;
  readonly crit: boolean;
  /** Whole points of damage; 0 on a miss. */
  readonly amount: number;
}

/** Rolls one attack. Order of dice (so tests can script them): hit, variance, crit. */
export function rollDamage(i: DamageInput, rng: () => number): DamageResult {
  if (rng() >= hitChance(i.accuracy, i.evasion)) return { hit: false, crit: false, amount: 0 };
  const raw = i.attack * i.multiplier * (1 - VARIANCE + 2 * VARIANCE * rng());
  const crit = rng() < clamp(i.critChance, 0, 1);
  const base = Math.max(MIN_DAMAGE, Math.round(raw * mitigation(i.defense)));
  return { hit: true, crit, amount: crit ? Math.max(MIN_DAMAGE, Math.round(base * CRIT_MULTIPLIER)) : base };
}
