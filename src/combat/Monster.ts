import type { Body2D } from '../world/collision';
import type { MonsterSpawn, MonsterTypeConfig } from './MonsterConfig';

/** The finite states of a monster (see MonsterAI.ts for the transitions). */
export type MonsterAiState = 'idle' | 'aggro' | 'chase' | 'attack' | 'return' | 'dead';
/** Sub-phase while in the 'attack' state. */
export type AttackPhase = 'ready' | 'windup' | 'recover';

export interface DamageOutcome {
  /** HP actually removed (never more than the monster had). */
  readonly dealt: number;
  /** True for exactly ONE call per life: the one that took the last HP. */
  readonly killed: boolean;
}

/**
 * One monster: pure data + the few rules that protect its invariants (HP in [0, max], dying once, rewarding once).
 * No engine types: the view reads x/z/yaw/state and draws it. It is a Body2D so the shared CollisionWorld can resolve it.
 */
export class Monster implements Body2D {
  hp: number;
  x: number;
  z: number;
  vx = 0;
  vz = 0;
  yaw = 0;
  state: MonsterAiState = 'idle';
  /** Seconds spent in the current state. */
  stateTime = 0;
  phase: AttackPhase = 'ready';
  /** Seconds left in the current attack phase. */
  phaseTime = 0;
  /** Seconds until the next blow may start. */
  attackCooldown = 0;
  /** Seconds since the monster last saw the player inside its give-up distance (drives "return time"). */
  lostTime = 0;
  /** Seconds the chase made no progress (drives the anti-stuck rule). */
  stuckTime = 0;
  /** Distance to the goal at the last progress sample, seconds until the next sample, and seconds spent touching obstacles since (anti-stuck check). */
  sampleDistance = Infinity;
  sampleTimer = 1;
  blockedTime = 0;
  /** Seconds until the next perception check (staggered per monster so they never all think in the same frame). */
  thinkTimer: number;
  /** Idle wandering: current destination and the pause before the next leg. */
  wanderX: number;
  wanderZ: number;
  wanderWait = 0;
  wanderTime = 0;
  /** True when the last movement step touched an obstacle (drives the side-step steering). */
  blocked = false;
  /** Which way (+1 / -1) the monster steps around an obstacle in its way; flips when it gets stuck. */
  avoidSide: 1 | -1;
  /** Seconds the last hit flinch lasts (visual only). */
  hurtTime = 0;
  /** Seconds since death (corpse timer / respawn). */
  deadTime = 0;
  /** True once the kill reward (XP + loot) was handed out for this life. Reset by respawn(). */
  rewardClaimed = false;
  /** Set when the player provoked it; consumed by the AI. */
  provoked = false;
  /** Counts lives, so tests/views can tell a respawn from the same life. */
  life = 1;

  constructor(
    readonly id: number,
    readonly config: MonsterTypeConfig,
    readonly home: MonsterSpawn,
  ) {
    this.hp = config.maxHp;
    this.x = home.x;
    this.z = home.z;
    this.wanderX = home.x;
    this.wanderZ = home.z;
    this.avoidSide = id % 2 === 0 ? 1 : -1;
    this.wanderWait = 1 + (id % 4);
    this.thinkTimer = (id * 0.071) % 0.2;
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  get name(): string {
    return this.config.name;
  }

  get maxHp(): number {
    return this.config.maxHp;
  }

  /** Approximate body height (m) for health bars and damage numbers. */
  get height(): number {
    return 2.2 * this.config.model.scale;
  }

  /** Removes HP. Dead monsters take no damage, and only the blow that empties the bar reports `killed`. */
  takeDamage(amount: number): DamageOutcome {
    if (!this.alive || !(amount > 0)) return { dealt: 0, killed: false };
    const dealt = Math.min(this.hp, amount);
    this.hp -= dealt;
    this.hurtTime = 0.25;
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
      return { dealt, killed: true };
    }
    return { dealt, killed: false };
  }

  heal(amount: number): void {
    if (!this.alive || !(amount > 0)) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  enter(state: MonsterAiState): void {
    this.state = state;
    this.stateTime = 0;
    this.phase = 'ready';
    this.phaseTime = 0;
    this.stuckTime = 0;
    this.sampleDistance = Infinity;
    this.sampleTimer = 1;
    this.blockedTime = 0;
    if (state !== 'chase' && state !== 'aggro') this.lostTime = 0;
  }

  private die(): void {
    this.enter('dead');
    this.vx = 0;
    this.vz = 0;
    this.deadTime = 0;
    this.provoked = false;
  }

  /** A fresh life at home: full HP, idle, reward flag cleared. */
  respawn(): void {
    this.hp = this.maxHp;
    this.x = this.home.x;
    this.z = this.home.z;
    this.vx = 0;
    this.vz = 0;
    this.blocked = false;
    this.attackCooldown = 0;
    this.hurtTime = 0;
    this.deadTime = 0;
    this.rewardClaimed = false;
    this.provoked = false;
    this.wanderX = this.home.x;
    this.wanderZ = this.home.z;
    this.wanderWait = 1;
    this.life++;
    this.enter('idle');
  }
}
