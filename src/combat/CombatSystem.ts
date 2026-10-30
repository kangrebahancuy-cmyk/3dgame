import type { PickupSystem } from '../game/pickups';
import type { PlayerState } from '../game/playerState';
import { mulberry32 } from '../world/rng';
import type { CollisionWorld } from '../world/collision';
import { playerCritChance, playerEvasion, PLAYER_ACCURACY, rollDamage } from './DamageCalculator';
import { CombatEvents, type ActorRef, type SkillFailReason } from './events';
import { LootSystem } from './LootSystem';
import type { Monster } from './Monster';
import { MONSTER_SPAWNS, MONSTER_TYPES, type MonsterSpawn, type MonsterTypeConfig, type MonsterTypeId } from './MonsterConfig';
import { MonsterSystem } from './MonsterSystem';
import { SKILLS, type SkillDef } from './SkillConfig';
import { SkillSystem } from './SkillSystem';
import { TargetingSystem } from './TargetingSystem';
import { weaponProfile } from './weapon';

export interface PlayerPose {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** What the player character is doing in combat (for animation and UI). */
export type PlayerCombatState = 'idle' | 'attacking' | 'hurt' | 'dead';

export type SkillResult =
  | { readonly ok: true; readonly skillId: string; readonly targetIds: readonly number[] }
  | { readonly ok: false; readonly reason: SkillFailReason; readonly message: string };

export interface CombatOptions {
  readonly state: PlayerState;
  readonly pickups: PickupSystem;
  readonly world?: CollisionWorld | null;
  readonly seed?: number;
  readonly spawns?: readonly MonsterSpawn[];
  readonly types?: Readonly<Record<MonsterTypeId, MonsterTypeConfig>>;
  readonly skills?: readonly SkillDef[];
  /** Where a pickup must not be placed (trees, rocks). */
  readonly isBlocked?: (x: number, z: number) => boolean;
  /** Mana regained per second while alive. */
  readonly manaRegen?: number;
}

const ATTACK_ANIM = 0.4;
const HURT_ANIM = 0.3;
/** A defeated player is brought back automatically after this long (a button can do it earlier). */
export const AUTO_RESPAWN_SECONDS = 12;
export const RESPAWN_HP_FRACTION = 0.5;

/**
 * The combat rules in one place: the player's skills against monsters, monsters' blows against the player, deaths,
 * rewards. It composes the other modules (Targeting, Skill, Monster, Loot) and reports everything through `events`.
 * No DOM, no Babylon: it is driven by `update(dt, pose)` and by `useSkill(id)`.
 */
export class CombatSystem {
  readonly events = new CombatEvents();
  readonly monsters: MonsterSystem;
  readonly targeting: TargetingSystem;
  readonly skills: SkillSystem;
  readonly loot: LootSystem;

  private readonly rng: () => number;
  private readonly state: PlayerState;
  private readonly manaRegen: number;
  private pose: PlayerPose = { x: 0, z: 0, yaw: 0 };
  private dead = false;
  private deathTime = 0;
  private attackAnim = 0;
  private hurtAnim = 0;
  private manaAcc = 0;
  private disposed = false;

  constructor(opts: CombatOptions) {
    this.state = opts.state;
    const seed = opts.seed ?? 0x5eed;
    this.rng = mulberry32(seed);
    this.manaRegen = opts.manaRegen ?? 2;
    this.skills = new SkillSystem(opts.skills ?? SKILLS);
    this.monsters = new MonsterSystem(
      this.events,
      opts.world ?? null,
      mulberry32(seed + 1),
      opts.spawns ?? MONSTER_SPAWNS,
      (m, connected) => this.onMonsterStrike(m, connected),
      opts.types ?? MONSTER_TYPES,
    );
    this.targeting = new TargetingSystem(this.monsters, this.events);
    this.loot = new LootSystem(opts.pickups, mulberry32(seed + 2), opts.isBlocked);
  }

  // ------------------------------------------------------------------------------------------------ queries

  /** The player's equipment (the basic attack's reach and speed come from the weapon in it). */
  get equipment(): PlayerState['equipment'] {
    return this.state.equipment;
  }

  get playerDead(): boolean {
    return this.dead;
  }

  get playerCombatState(): PlayerCombatState {
    if (this.dead) return 'dead';
    if (this.hurtAnim > 0) return 'hurt';
    if (this.attackAnim > 0) return 'attacking';
    return 'idle';
  }

  /** Seconds until an automatic respawn (0 when alive). */
  get respawnIn(): number {
    return this.dead ? Math.max(0, AUTO_RESPAWN_SECONDS - this.deathTime) : 0;
  }

  /** Distance (m) from the player's centre to the surface of a monster. */
  surfaceDistance(m: Monster): number {
    return Math.hypot(m.x - this.pose.x, m.z - this.pose.z) - m.config.radius;
  }

  // ------------------------------------------------------------------------------------------------ frame update

  /** Advances combat by `dt` seconds. `pose` is where the player stands now. */
  update(dt: number, pose: PlayerPose): void {
    if (this.disposed || !(dt > 0)) return;
    this.pose = pose;
    this.syncDeath();
    this.skills.tick(dt);
    if (this.attackAnim > 0) this.attackAnim = Math.max(0, this.attackAnim - dt);
    if (this.hurtAnim > 0) this.hurtAnim = Math.max(0, this.hurtAnim - dt);
    if (this.dead) {
      this.deathTime += dt;
      if (this.deathTime >= AUTO_RESPAWN_SECONDS) this.respawnPlayer();
    } else {
      this.regenMana(dt);
      this.targeting.validate(pose.x, pose.z);
    }
    // Monsters keep running while the player is dead: they notice there is no target and walk home.
    this.monsters.update(dt, { x: pose.x, z: pose.z, alive: !this.dead });
  }

  private regenMana(dt: number): void {
    if (this.state.profile.mana >= this.state.stats.maxMana) {
      this.manaAcc = 0;
      return;
    }
    this.manaAcc += this.manaRegen * dt;
    if (this.manaAcc >= 1) { // whole points, so the DOM is not re-rendered every frame
      const whole = Math.floor(this.manaAcc);
      this.manaAcc -= whole;
      this.state.restoreMana(whole);
    }
  }

  // ------------------------------------------------------------------------------------------------ player actions

  /** Selects a monster (by id). */
  selectTarget(id: number): boolean {
    return !this.dead && this.targeting.select(id);
  }

  clearTarget(): void {
    this.targeting.clear();
  }

  cycleTarget(): number | null {
    return this.dead ? null : this.targeting.cycle(this.pose.x, this.pose.z);
  }

  /** The basic attack = the skill in hotbar slot 1 of the data (SKILLS), by default 'basic_attack'. */
  basicAttack(): SkillResult {
    return this.useSkill('basic_attack');
  }

  /** Uses a skill. Validates everything first; a failed attempt changes nothing (no cooldown, no mana). */
  useSkill(id: string): SkillResult {
    if (this.disposed) return { ok: false, reason: 'unknownSkill', message: 'Combat is not running.' };
    this.syncDeath();
    const def = this.skills.get(id);
    if (!def) return this.failed(id, 'unknownSkill', `Unknown skill: ${id}`);

    const weapon = weaponProfile(this.state.equipment);
    const target = this.targeting.target;
    const around = def.target === 'around' ? this.monsters.within(this.pose.x, this.pose.z, def.areaRadius) : [];
    const check = this.skills.check(def, {
      playerAlive: !this.dead,
      mana: this.state.profile.mana,
      weapon,
      target: target ? { alive: target.alive, surfaceDistance: this.surfaceDistance(target) } : null,
      enemiesInArea: around.length,
    });
    if (!check.ok) return this.failed(id, check.reason, check.message);

    if (!this.state.spendMana(def.manaCost)) return this.failed(id, 'noMana', `Not enough mana for ${def.name} (${def.manaCost}).`);
    this.skills.commit(def, weapon);
    this.attackAnim = ATTACK_ANIM;

    const victims = def.target === 'enemy' && target ? [target] : around;
    const ids = victims.map((v) => v.id);
    this.events.emit({ type: 'skillUsed', skillId: def.id, targetIds: ids });

    const stats = this.state.stats;
    const agility = this.state.profile.attributes.agility;
    for (const v of victims) {
      const r = rollDamage(
        {
          attack: stats.attack,
          multiplier: def.multiplier,
          defense: v.config.defense,
          accuracy: PLAYER_ACCURACY,
          evasion: v.config.evasion,
          critChance: playerCritChance(agility),
        },
        this.rng,
      );
      const where = { x: v.x, z: v.z, height: v.height };
      const source: ActorRef = { kind: 'player' };
      const tgt: ActorRef = { kind: 'monster', id: v.id };
      if (!r.hit) {
        this.events.emit({ type: 'miss', source, target: tgt, ...where });
        this.monsters.provoke(v); // swinging at it still wakes it up
        continue;
      }
      const out = v.takeDamage(r.amount);
      this.events.emit({ type: 'damage', source, target: tgt, amount: out.dealt, crit: r.crit, ...where });
      if (out.killed) this.onMonsterKilled(v);
      else this.monsters.provoke(v);
    }
    return { ok: true, skillId: def.id, targetIds: ids };
  }

  /** Brings a defeated player back (half HP, full mana). Returns false if the player is not defeated. */
  respawnPlayer(): boolean {
    if (!this.dead) return false;
    this.state.revive(RESPAWN_HP_FRACTION);
    this.dead = false;
    this.deathTime = 0;
    this.attackAnim = 0;
    this.hurtAnim = 0;
    this.events.emit({ type: 'playerRespawned' });
    return true;
  }

  // ------------------------------------------------------------------------------------------------ internals

  private failed(skillId: string, reason: SkillFailReason, message: string): SkillResult {
    this.events.emit({ type: 'skillFailed', skillId, reason, message });
    return { ok: false, reason, message };
  }

  /** The HP in PlayerState is the single truth for "dead"; this keeps the combat flag and the events in step with it. */
  private syncDeath(): void {
    if (this.state.isDead && !this.dead) {
      this.dead = true;
      this.deathTime = 0;
      this.targeting.clear();
      this.events.emit({ type: 'playerDied' });
    } else if (!this.state.isDead && this.dead) {
      this.dead = false; // revived from outside (e.g. a developer helper)
      this.deathTime = 0;
      this.events.emit({ type: 'playerRespawned' });
    }
  }

  /** The AI calls this exactly once per monster attack, at the moment the blow lands. */
  private onMonsterStrike(m: Monster, connected: boolean): void {
    this.events.emit({ type: 'monsterAttackStruck', monsterId: m.id, connected });
    if (this.dead || !connected) return;
    const s = this.state.stats;
    const r = rollDamage(
      {
        attack: m.config.damage,
        multiplier: 1,
        defense: s.defense,
        accuracy: m.config.accuracy,
        evasion: playerEvasion(this.state.profile.attributes.agility),
        critChance: 0.05,
      },
      this.rng,
    );
    const source: ActorRef = { kind: 'monster', id: m.id };
    const target: ActorRef = { kind: 'player' };
    const where = { x: this.pose.x, z: this.pose.z, height: 1.9 };
    if (!r.hit) {
      this.events.emit({ type: 'miss', source, target, ...where });
      return;
    }
    this.state.damage(r.amount);
    this.hurtAnim = HURT_ANIM;
    this.events.emit({ type: 'damage', source, target, amount: r.amount, crit: r.crit, ...where });
    this.syncDeath();
  }

  /** XP and loot, once per life of a monster: the `rewardClaimed` flag makes a second call a no-op. */
  private onMonsterKilled(m: Monster): void {
    if (m.rewardClaimed) return;
    m.rewardClaimed = true;
    if (this.targeting.targetId === m.id) this.targeting.clear();
    const cfg = m.config;
    this.events.emit({ type: 'monsterKilled', monsterId: m.id, name: cfg.name, xp: cfg.xp, x: m.x, z: m.z });
    this.state.gainXp(cfg.xp);
    const drops = this.loot.dropAt(m.x, m.z, cfg.loot);
    if (drops.length > 0) {
      const full = drops.some((d) => !this.state.inventory.canAdd(d.id, d.qty));
      this.events.emit({ type: 'lootDropped', monsterId: m.id, drops, backpackFull: full });
    }
  }

  // ------------------------------------------------------------------------------------------------ lifecycle

  /** Back to the start: every monster alive at home, no target, cooldowns cleared. Listeners stay subscribed. */
  reset(): void {
    this.monsters.resetAll();
    this.targeting.clear();
    this.skills.reset();
    this.dead = false;
    this.deathTime = 0;
    this.attackAnim = 0;
    this.hurtAnim = 0;
    this.manaAcc = 0;
  }

  /** Stops combat for good: no listeners, no monsters. Every later call is a harmless no-op. */
  dispose(): void {
    this.disposed = true;
    this.events.clear();
    this.monsters.clear();
    this.targeting.clear();
    this.skills.reset();
  }
}
