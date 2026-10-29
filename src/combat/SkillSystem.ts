import { GLOBAL_COOLDOWN, SKILLS, type SkillDef } from './SkillConfig';
import type { SkillFailReason } from './events';
import type { WeaponProfile } from './weapon';

/** Everything the validation needs to know, gathered by the CombatSystem (so this file stays free of game state). */
export interface SkillContext {
  readonly playerAlive: boolean;
  readonly mana: number;
  readonly weapon: WeaponProfile;
  /** The selected monster, if any. `surfaceDistance` is measured from the player's centre to the monster's surface. */
  readonly target: { readonly alive: boolean; readonly surfaceDistance: number } | null;
  /** Living monsters inside the skill's area (only used by 'around' skills). */
  readonly enemiesInArea: number;
}

export type SkillCheck = { readonly ok: true } | { readonly ok: false; readonly reason: SkillFailReason; readonly message: string };

const fail = (reason: SkillFailReason, message: string): SkillCheck => ({ ok: false, reason, message });

/** Cooldowns, the global cooldown and the rules for when a skill may be used. It never deals damage itself. */
export class SkillSystem {
  private readonly defs = new Map<string, SkillDef>();
  private readonly left = new Map<string, number>();
  private readonly total = new Map<string, number>();
  private gcd = 0;

  constructor(skills: readonly SkillDef[] = SKILLS) {
    for (const s of skills) {
      if (this.defs.has(s.id)) throw new Error(`duplicate skill id: ${s.id}`);
      this.defs.set(s.id, s);
    }
  }

  all(): readonly SkillDef[] {
    return [...this.defs.values()].sort((a, b) => a.slot - b.slot);
  }

  get(id: string): SkillDef | undefined {
    return this.defs.get(id);
  }

  bySlot(slot: number): SkillDef | undefined {
    for (const s of this.defs.values()) if (s.slot === slot) return s;
    return undefined;
  }

  /** Reach (m) of an 'enemy' skill with this weapon. */
  rangeOf(def: SkillDef, weapon: WeaponProfile): number {
    return weapon.range + def.rangeBonus;
  }

  cooldownSeconds(def: SkillDef, weapon: WeaponProfile): number {
    return def.cooldown === 'weapon' ? weapon.cooldown : def.cooldown;
  }

  /** Seconds until the skill can be used again (own cooldown or the global one, whichever is longer). */
  remaining(id: string): number {
    return Math.max(this.left.get(id) ?? 0, this.gcd);
  }

  /** 0 = ready … 1 = just used; for the hotbar overlay. Uses the skill's own cooldown, or the global one if that is longer. */
  fraction(id: string): number {
    const own = this.left.get(id) ?? 0;
    const ownTotal = this.total.get(id) ?? 1;
    const f = own > 0 ? own / ownTotal : 0;
    const g = this.gcd > 0 ? this.gcd / GLOBAL_COOLDOWN : 0;
    return Math.min(1, Math.max(f, g));
  }

  tick(dt: number): void {
    if (!(dt > 0)) return;
    if (this.gcd > 0) this.gcd = Math.max(0, this.gcd - dt);
    for (const [id, v] of this.left) {
      if (v > 0) this.left.set(id, Math.max(0, v - dt));
    }
  }

  /** The validation order is fixed: alive, cooldown, target, reach, resource. A failed check changes nothing. */
  check(def: SkillDef, ctx: SkillContext): SkillCheck {
    if (!ctx.playerAlive) return fail('playerDead', 'You are defeated.');
    const cd = this.remaining(def.id);
    if (cd > 0) return fail('cooldown', `${def.name} is not ready (${cd.toFixed(1)}s).`);
    if (def.target === 'enemy') {
      if (!ctx.target) return fail('noTarget', 'No target selected.');
      if (!ctx.target.alive) return fail('invalidTarget', 'Target is already defeated.');
      if (ctx.target.surfaceDistance > this.rangeOf(def, ctx.weapon)) return fail('outOfRange', 'Target is too far away.');
    } else if (ctx.enemiesInArea <= 0) {
      return fail('noTarget', 'No enemies close enough.');
    }
    if (ctx.mana < def.manaCost) return fail('noMana', `Not enough mana for ${def.name} (${def.manaCost}).`);
    return { ok: true };
  }

  /** Starts the cooldowns. Call exactly once, after the skill was really used. */
  commit(def: SkillDef, weapon: WeaponProfile): void {
    const cd = this.cooldownSeconds(def, weapon);
    this.left.set(def.id, cd);
    this.total.set(def.id, cd);
    this.gcd = GLOBAL_COOLDOWN;
  }

  reset(): void {
    this.left.clear();
    this.total.clear();
    this.gcd = 0;
  }
}
