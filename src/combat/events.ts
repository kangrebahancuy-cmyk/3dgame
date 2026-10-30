/**
 * Typed event bus of the combat system. Gameplay code only ever EMITS these; the views (floating numbers, hit sparks,
 * health bars, DOM UI) subscribe. Nothing in src/combat depends on the DOM or on Babylon.
 */

export type ActorRef = { readonly kind: 'player' } | { readonly kind: 'monster'; readonly id: number };

export type SkillFailReason =
  | 'playerDead'
  | 'unknownSkill'
  | 'cooldown'
  | 'noTarget'
  | 'invalidTarget'
  | 'outOfRange'
  | 'noMana';

export type CombatEvent =
  | { readonly type: 'targetChanged'; readonly targetId: number | null }
  | { readonly type: 'skillUsed'; readonly skillId: string; readonly targetIds: readonly number[] }
  | { readonly type: 'skillFailed'; readonly skillId: string; readonly reason: SkillFailReason; readonly message: string }
  /** Damage dealt to `target`; (x, z) is where the target stands, `height` its approximate height in metres. */
  | { readonly type: 'damage'; readonly source: ActorRef; readonly target: ActorRef; readonly amount: number; readonly crit: boolean; readonly x: number; readonly z: number; readonly height: number }
  | { readonly type: 'miss'; readonly source: ActorRef; readonly target: ActorRef; readonly x: number; readonly z: number; readonly height: number }
  /** A monster starts its wind-up (the telegraph). `area` > 0 means a ground area of that radius around it. */
  | { readonly type: 'monsterAttackStarted'; readonly monsterId: number; readonly windup: number; readonly area: number }
  /** The wind-up ended: the blow lands now (whether or not it connected is reported by damage / miss events). */
  | { readonly type: 'monsterAttackStruck'; readonly monsterId: number; readonly connected: boolean }
  | { readonly type: 'monsterAggro'; readonly monsterId: number }
  | { readonly type: 'monsterKilled'; readonly monsterId: number; readonly name: string; readonly xp: number; readonly x: number; readonly z: number }
  | { readonly type: 'monsterRespawned'; readonly monsterId: number }
  | { readonly type: 'lootDropped'; readonly monsterId: number; readonly drops: ReadonlyArray<{ readonly id: string; readonly name: string; readonly qty: number }>; readonly backpackFull: boolean }
  | { readonly type: 'playerDied' }
  | { readonly type: 'playerRespawned' };

export type CombatEventType = CombatEvent['type'];

/** A tiny synchronous emitter. `clear()` drops every listener (used by dispose / reset). */
export class CombatEvents {
  private readonly listeners = new Set<(e: CombatEvent) => void>();

  get listenerCount(): number {
    return this.listeners.size;
  }

  on(cb: (e: CombatEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(e: CombatEvent): void {
    // iterate a snapshot: a listener may unsubscribe itself while handling the event
    for (const cb of [...this.listeners]) cb(e);
  }

  clear(): void {
    this.listeners.clear();
  }
}
