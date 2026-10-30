import type { CollisionWorld } from '../world/collision';
import type { CombatEvents } from './events';
import { Monster } from './Monster';
import { stepMonster, type AiEnv, type AiTarget } from './MonsterAI';
import { MONSTER_TYPES, type MonsterSpawn, type MonsterTypeConfig, type MonsterTypeId } from './MonsterConfig';

/** Longest slice (s) the AI is advanced by in one go: a 10 FPS frame is simulated as two 0.05 s slices, not one blind 0.1 s jump. */
export const AI_SLICE = 0.05;
/** One update never simulates more than this (s), so returning to a background tab cannot run a whole minute of AI. */
export const AI_MAX_FRAME = 0.25;
/** A dead monster does not respawn while the player stands this close to its home. */
export const RESPAWN_CLEARANCE = 8;

/**
 * Owns every monster: creates them from the spawn list, advances their AI, handles respawns and keeps them from
 * standing inside each other. Pure data and rules (no engine, no DOM).
 */
export class MonsterSystem {
  private readonly list: Monster[] = [];
  private readonly byId = new Map<number, Monster>();
  private readonly env: AiEnv;

  constructor(
    private readonly events: CombatEvents,
    private readonly world: CollisionWorld | null,
    rng: () => number,
    private readonly spawns: readonly MonsterSpawn[],
    onStrike: (m: Monster, connected: boolean) => void,
    private readonly types: Readonly<Record<MonsterTypeId, MonsterTypeConfig>> = MONSTER_TYPES,
  ) {
    this.env = {
      world,
      rng,
      hooks: {
        aggro: (m) => this.events.emit({ type: 'monsterAggro', monsterId: m.id }),
        attackStarted: (m) =>
          this.events.emit({
            type: 'monsterAttackStarted',
            monsterId: m.id,
            windup: m.config.attack.windup,
            area: m.config.attack.shape === 'area' ? m.config.attack.areaRadius : 0,
          }),
        strike: onStrike,
      },
    };
    this.populate();
  }

  private populate(): void {
    let id = 1;
    for (const s of this.spawns) {
      const m = new Monster(id++, this.types[s.type], s);
      this.list.push(m);
      this.byId.set(m.id, m);
    }
  }

  get all(): readonly Monster[] {
    return this.list;
  }

  get count(): number {
    return this.list.length;
  }

  get aliveCount(): number {
    let n = 0;
    for (const m of this.list) if (m.alive) n++;
    return n;
  }

  get(id: number): Monster | undefined {
    return this.byId.get(id);
  }

  /** Marks a monster as provoked by the player (it reacts on its next AI step). */
  provoke(m: Monster): void {
    if (m.alive) m.provoked = true;
  }

  /** Living monsters whose surface is within `range` of (x, z), nearest first. Allocates only the result array. */
  within(x: number, z: number, range: number): Monster[] {
    const out: Array<{ m: Monster; d: number }> = [];
    for (const m of this.list) {
      if (!m.alive) continue;
      const d = Math.hypot(m.x - x, m.z - z) - m.config.radius;
      if (d <= range) out.push({ m, d });
    }
    out.sort((a, b) => a.d - b.d);
    return out.map((o) => o.m);
  }

  update(dt: number, target: AiTarget): void {
    if (!(dt > 0)) return;
    let left = Math.min(dt, AI_MAX_FRAME);
    while (left > 1e-9) {
      const h = Math.min(left, AI_SLICE);
      left -= h;
      for (const m of this.list) {
        stepMonster(m, h, target, this.env);
        if (m.state === 'dead') this.tryRespawn(m, target);
      }
      this.separate(h);
    }
  }

  private tryRespawn(m: Monster, target: AiTarget): void {
    const t = m.config.respawnTime;
    if (!(t > 0) || m.deadTime < t) return;
    if (target.alive && Math.hypot(target.x - m.home.x, target.z - m.home.z) < RESPAWN_CLEARANCE) return;
    m.respawn();
    this.events.emit({ type: 'monsterRespawned', monsterId: m.id });
  }

  /** Gently pushes overlapping living monsters apart (n is small, so the O(n²) pass is cheap). */
  private separate(h: number): void {
    const k = Math.min(1, h * 10);
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.list.length; j++) {
        const b = this.list[j];
        if (!b.alive) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const min = a.config.radius + b.config.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        const nx = d > 1e-4 ? dx / d : 1;
        const nz = d > 1e-4 ? dz / d : 0;
        const push = (min - d) * 0.5 * k;
        a.x -= nx * push; a.z -= nz * push;
        b.x += nx * push; b.z += nz * push;
      }
    }
    if (this.world) for (const m of this.list) if (m.alive) this.world.resolve(m, m.config.radius);
  }

  /** Every monster back to a fresh life at home (used by reset). */
  resetAll(): void {
    for (const m of this.list) m.respawn();
  }

  /** Removes all monsters (used by dispose). */
  clear(): void {
    this.list.length = 0;
    this.byId.clear();
  }
}
