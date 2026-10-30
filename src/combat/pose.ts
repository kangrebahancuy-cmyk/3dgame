import { clamp, smoothstep } from '../math/scalar';
import { AI } from './MonsterAI';
import type { Monster } from './Monster';

/**
 * Procedural body language for the characters. The assets contain no attack/hit/death clips (see docs/ASSETS.md),
 * so the views tilt and nudge the whole model instead. These functions are pure (numbers in, numbers out) so they
 * can be unit-tested; the Babylon side only applies the result.
 *
 * Conventions: `pitch` > 0 bows forward, < 0 leans back (radians, about the feet); `lunge` is metres along the
 * facing direction; `sink` is metres below the ground; `flash` is 0…1 hit-flash intensity.
 */
export interface BodyPose {
  pitch: number;
  lunge: number;
  sink: number;
  flash: number;
  /** False once a corpse has been lying around long enough to be removed from view. */
  visible: boolean;
}

/** How long a corpse stays visible (s). */
export const CORPSE_TIME = 4.2;
const FALL_TIME = 0.7;
const FALL_PITCH = -1.45;
const HURT_TIME = 0.25;

export function monsterPose(m: Monster, out: BodyPose): BodyPose {
  out.pitch = 0;
  out.lunge = 0;
  out.sink = 0;
  out.flash = 0;
  out.visible = true;

  if (m.state === 'dead') {
    const t = clamp(m.deadTime / FALL_TIME, 0, 1);
    out.pitch = FALL_PITCH * (1 - (1 - t) * (1 - t)); // ease-out: drops fast, settles slowly
    out.sink = clamp((m.deadTime - 2.4) / 1.6, 0, 1) * 0.9;
    out.visible = m.deadTime < CORPSE_TIME;
    return out;
  }

  if (m.state === 'aggro') {
    out.pitch = -0.18 * Math.sin(Math.PI * clamp(m.stateTime / AI.aggroDelay, 0, 1)); // rears up: "I saw you"
  } else if (m.state === 'attack') {
    if (m.phase === 'windup') {
      const u = clamp(1 - m.phaseTime / Math.max(1e-3, m.config.attack.windup), 0, 1);
      out.pitch = -0.34 * smoothstep(u); // leans back, gathering for the blow
      out.lunge = -0.12 * smoothstep(u);
    } else if (m.phase === 'recover') {
      const u = clamp(1 - m.phaseTime / AI.recoverTime, 0, 1);
      const k = (1 - u) * (1 - u);
      out.pitch = 0.55 * k; // the blow: snaps forward, then straightens
      out.lunge = 0.38 * k;
    }
  }
  const h = clamp(m.hurtTime / HURT_TIME, 0, 1);
  out.pitch -= 0.2 * h;
  out.flash = h;
  return out;
}

const SWING_TIME = 0.34;

/** The player's swing / flinch / fall, driven by events from the combat system. */
export class PlayerPoseDriver {
  private swing = 0;
  private hurt = 0;
  private fall = 0;
  private readonly pose: BodyPose = { pitch: 0, lunge: 0, sink: 0, flash: 0, visible: true };

  /** The player used a skill. */
  swingNow(): void {
    this.swing = SWING_TIME;
  }

  /** The player was hit. */
  hurtNow(): void {
    this.hurt = HURT_TIME;
  }

  update(dt: number, dead: boolean): BodyPose {
    this.swing = Math.max(0, this.swing - dt);
    this.hurt = Math.max(0, this.hurt - dt);
    this.fall = clamp(this.fall + (dead ? dt / 0.5 : -dt / 0.3), 0, 1);
    const p = this.pose;
    p.pitch = 0;
    p.lunge = 0;
    p.sink = 0;
    if (this.swing > 0) {
      const u = 1 - this.swing / SWING_TIME;
      if (u < 0.3) p.pitch = -0.18 * smoothstep(u / 0.3); // wind-up
      else if (u < 0.55) p.pitch = -0.18 + 0.68 * smoothstep((u - 0.3) / 0.25); // the swing
      else p.pitch = 0.5 * (1 - smoothstep((u - 0.55) / 0.45)); // recover
      p.lunge = 0.25 * Math.sin(Math.PI * clamp((u - 0.3) / 0.7, 0, 1));
    }
    p.pitch -= 0.2 * (this.hurt / HURT_TIME);
    const f = this.fall * (2 - this.fall); // ease-out
    p.pitch = p.pitch * (1 - f) + FALL_PITCH * f;
    p.flash = this.hurt / HURT_TIME;
    return p;
  }
}
