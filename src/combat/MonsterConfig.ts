import type { ItemId } from '../game/items';

/**
 * Data for every monster type. Adding a monster = adding one entry here (plus a GLB, see docs/ASSETS.md); no code changes.
 * Distances are metres, times are seconds. The models are the real Orc_Free characters converted by tools/fbx_to_glb.py.
 */
export type MonsterTypeId = 'ash_walker' | 'bone_whittler' | 'ironbound_marauder';
export type MonsterTier = 'normal' | 'aggressive' | 'elite';

export interface LootEntry {
  readonly item: ItemId;
  /** 0…1 chance that this entry drops when the monster dies. */
  readonly chance: number;
  readonly min: number;
  readonly max: number;
}

export interface AttackPattern {
  /** Seconds between the start of the telegraph and the blow landing. The player can step out during it. */
  readonly windup: number;
  /** 'single' hits the target if it is within attackRange (+ a small tolerance); 'area' hits everything within areaRadius. */
  readonly shape: 'single' | 'area';
  /** Radius (m) around the monster of an 'area' blow. Ignored for 'single'. */
  readonly areaRadius: number;
}

export interface MonsterTypeConfig {
  readonly id: MonsterTypeId;
  readonly name: string;
  readonly tier: MonsterTier;
  readonly level: number;
  readonly maxHp: number;
  /** Attack value fed into the shared damage rule (DamageCalculator). */
  readonly damage: number;
  readonly defense: number;
  /** Chance (0…1) that a player attack misses it. */
  readonly evasion: number;
  /** Chance (0…1) before the player's evasion is subtracted. */
  readonly accuracy: number;
  readonly moveSpeed: number;
  /** A monster notices the player within this distance (from the monster). */
  readonly aggroRange: number;
  /** Reach of its blow, measured from its centre to the player's centre. */
  readonly attackRange: number;
  /** It never goes further than this from its home while chasing; beyond it the monster gives up and walks back. */
  readonly chaseRange: number;
  readonly attackCooldown: number;
  readonly attack: AttackPattern;
  /**
   * "Return time": how long a monster keeps chasing a target it can no longer reach or perceive (further than
   * 1.25 × aggroRange, or not getting any closer) before it gives up and walks home.
   */
  readonly returnTime: number;
  /** After death the monster is gone this long, then a fresh one appears at its home. 0 = never. */
  readonly respawnTime: number;
  /** XP given once per kill (through PlayerState.gainXp). */
  readonly xp: number;
  readonly loot: readonly LootEntry[];
  /** Wandering radius around home while idle (0 = stands still). */
  readonly patrolRadius: number;
  /** Collision radius on the ground (m), already including `scale`. */
  readonly radius: number;
  readonly model: { readonly url: string; readonly scale: number };
}

export const MONSTER_TYPES: Readonly<Record<MonsterTypeId, MonsterTypeConfig>> = {
  // The weak starter monster: slow, short reach, simple quick swing.
  ash_walker: {
    id: 'ash_walker', name: 'Ash Walker', tier: 'normal', level: 1,
    maxHp: 40, damage: 7, defense: 1, evasion: 0.02, accuracy: 0.9,
    moveSpeed: 2.3, aggroRange: 7, attackRange: 1.7, chaseRange: 16,
    attackCooldown: 1.8, attack: { windup: 0.45, shape: 'single', areaRadius: 0 },
    returnTime: 4, respawnTime: 40, xp: 22, patrolRadius: 3,
    loot: [
      { item: 'wood', chance: 0.6, min: 1, max: 2 },
      { item: 'stone', chance: 0.4, min: 1, max: 2 },
      { item: 'health_potion', chance: 0.15, min: 1, max: 1 },
    ],
    radius: 0.5,
    model: { url: 'models/monsters/Ash_Walker.glb', scale: 0.8 },
  },
  // The aggressive chaser: wide aggro range, fast, quick bites, sparse patrol.
  bone_whittler: {
    id: 'bone_whittler', name: 'Bone Whittler', tier: 'aggressive', level: 3,
    maxHp: 75, damage: 12, defense: 3, evasion: 0.05, accuracy: 0.92,
    moveSpeed: 3.7, aggroRange: 12, attackRange: 1.8, chaseRange: 24,
    attackCooldown: 1.3, attack: { windup: 0.35, shape: 'single', areaRadius: 0 },
    returnTime: 5, respawnTime: 55, xp: 48, patrolRadius: 2,
    loot: [
      { item: 'wood', chance: 0.7, min: 1, max: 3 },
      { item: 'health_potion', chance: 0.3, min: 1, max: 1 },
      { item: 'leather_boots', chance: 0.1, min: 1, max: 1 },
    ],
    radius: 0.55,
    model: { url: 'models/monsters/Bone_Whittler.glb', scale: 0.9 },
  },
  // The strong guard: big, slow, long telegraphed ground slam that hits an area; stand still and you are hit.
  ironbound_marauder: {
    id: 'ironbound_marauder', name: 'Ironbound Marauder', tier: 'elite', level: 5,
    maxHp: 170, damage: 24, defense: 6, evasion: 0.0, accuracy: 0.95,
    moveSpeed: 2.6, aggroRange: 10, attackRange: 2.4, chaseRange: 20,
    attackCooldown: 2.8, attack: { windup: 0.95, shape: 'area', areaRadius: 3.0 },
    returnTime: 6, respawnTime: 90, xp: 160, patrolRadius: 0,
    loot: [
      { item: 'health_potion', chance: 1, min: 1, max: 2 },
      { item: 'iron_helmet', chance: 0.4, min: 1, max: 1 },
      { item: 'traveler_armor', chance: 0.35, min: 1, max: 1 },
      { item: 'wooden_sword', chance: 0.3, min: 1, max: 1 },
      { item: 'stone', chance: 0.8, min: 2, max: 4 },
    ],
    radius: 0.9,
    model: { url: 'models/monsters/Ironbound_Marauder.glb', scale: 1.2 },
  },
};

export interface MonsterSpawn {
  readonly type: MonsterTypeId;
  readonly x: number;
  readonly z: number;
}

/**
 * Where monsters live. Kept off the spawn clearing (the first 10 m around the origin are safe) and off trees/rocks;
 * tests/combat.test.ts checks both against the real forest layout.
 */
export const MONSTER_SPAWNS: readonly MonsterSpawn[] = [
  { type: 'ash_walker', x: 12, z: 3 },
  { type: 'ash_walker', x: 14, z: -3 },
  { type: 'ash_walker', x: -15, z: 11 },
  { type: 'ash_walker', x: -11, z: -13 },
  { type: 'bone_whittler', x: 4, z: 19 },
  { type: 'bone_whittler', x: -18, z: -2 },
  { type: 'bone_whittler', x: 20, z: -17 },
  { type: 'ironbound_marauder', x: -4, z: 23 },
];
