import { damp, dampAngle } from '../math/scalar';
import type { CollisionWorld } from '../world/collision';
import type { Monster } from './Monster';

/**
 * The monster brain: a small finite state machine, advanced with delta time.
 *
 *   idle ──(player within aggroRange, or provoked)──▶ aggro ──(0.35 s alert)──▶ chase
 *   chase ──(within reach)──▶ attack ◀─▶ chase (target steps out of reach)
 *   chase / attack ──(player dead · beyond chaseRange from home · lost for returnTime · stuck)──▶ return
 *   return ──(arrived home)──▶ idle          any ──(HP 0)──▶ dead (Monster.takeDamage)
 *
 * Attack phases: ready → windup (the telegraph; the blow lands when it ends) → recover → ready. The blow lands exactly
 * once per windup (it is a phase change, not a per-frame check), so one attack can never hurt twice.
 *
 * Movement uses the same CollisionWorld as the player (circle colliders + map boundary, sliding response) and the same
 * sub-stepping, so monsters never walk through trees and never tunnel at low frame rates.
 * Cost: a few multiplications per monster per frame; the only "perception" work (idle monsters looking for the player)
 * runs every THINK_INTERVAL seconds, staggered per monster.
 */
export const AI = {
  /** Seconds between perception checks of an idle monster. */
  thinkInterval: 0.2,
  /** Alert pause between noticing the player and starting to chase. */
  aggroDelay: 0.35,
  /** Chase speed factor while walking home (it is in a hurry, but not teleporting). */
  returnSpeedFactor: 1.4,
  /** A monster that is "lost" is further than this × aggroRange from the player. */
  lostFactor: 1.25,
  /** Attack starts at this fraction of attackRange and ends (back to chase) beyond `leaveFactor` × attackRange. */
  engageFactor: 0.9,
  leaveFactor: 1.15,
  /** Extra reach (m) of a 'single' blow at the moment it lands, so a player moving at running speed is still hit. */
  strikeTolerance: 0.35,
  recoverTime: 0.35,
  /** Stuck seconds in a row before a chasing monster gives up / a returning one snaps home. */
  chaseStuckLimit: 3,
  returnStuckLimit: 4,
  /** Fraction of max HP regained per second while walking home. */
  returnRegen: 0.25,
  accelLambda: 9,
  turnLambda: 10,
  maxTurnRate: 10,
  maxStepDistance: 0.12,
  patrolSpeedFactor: 0.35,
  /** While touching an obstacle the heading is turned by this angle (rad) to one side, so a trunk straight ahead is walked around. */
  avoidAngle: 0.9,
} as const;

export interface AiTarget {
  readonly x: number;
  readonly z: number;
  readonly alive: boolean;
}

export interface AiHooks {
  aggro(m: Monster): void;
  attackStarted(m: Monster): void;
  /** The blow lands. `connected` says whether the target was inside its reach at this very moment. Called once per attack. */
  strike(m: Monster, connected: boolean): void;
}

export interface AiEnv {
  readonly world: CollisionWorld | null;
  readonly rng: () => number;
  readonly hooks: AiHooks;
}

/** Advances one monster by `dt` seconds (callers keep dt small, see MonsterSystem). */
export function stepMonster(m: Monster, dt: number, target: AiTarget, env: AiEnv): void {
  if (m.state === 'dead') {
    m.deadTime += dt;
    return;
  }
  m.stateTime += dt;
  if (m.hurtTime > 0) m.hurtTime = Math.max(0, m.hurtTime - dt);
  if (m.attackCooldown > 0) m.attackCooldown = Math.max(0, m.attackCooldown - dt);

  const cfg = m.config;
  const dx = target.x - m.x;
  const dz = target.z - m.z;
  const d = Math.hypot(dx, dz);
  const hx = m.home.x - m.x;
  const hz = m.home.z - m.z;
  const homeD = Math.hypot(hx, hz);

  if (m.provoked) {
    m.provoked = false;
    if (target.alive && (m.state === 'idle' || (m.state === 'return' && homeD <= cfg.chaseRange * 0.5))) startAggro(m, env);
  }

  switch (m.state) {
    case 'idle': {
      m.thinkTimer -= dt;
      if (m.thinkTimer <= 0) {
        m.thinkTimer += AI.thinkInterval;
        if (target.alive && d <= cfg.aggroRange) {
          startAggro(m, env);
          break;
        }
      }
      wander(m, dt, env);
      break;
    }

    case 'aggro': {
      if (!target.alive) { m.enter('return'); break; }
      faceToward(m, dx, dz, dt);
      moveBody(m, 0, 0, 0, dt, env.world);
      if (m.stateTime >= AI.aggroDelay) m.enter(homeD > cfg.chaseRange ? 'return' : 'chase');
      break;
    }

    case 'chase': {
      if (!target.alive || homeD > cfg.chaseRange) { m.enter('return'); break; }
      if (d > cfg.aggroRange * AI.lostFactor) {
        m.lostTime += dt;
        if (m.lostTime >= cfg.returnTime) { m.enter('return'); break; }
      } else {
        m.lostTime = 0;
      }
      if (d <= cfg.attackRange * AI.engageFactor) {
        m.enter('attack');
        break;
      }
      moveBody(m, dx / d, dz / d, cfg.moveSpeed, dt, env.world);
      if (checkStuck(m, dt, d, AI.chaseStuckLimit)) m.enter('return');
      break;
    }

    case 'attack': {
      if (!target.alive) { m.enter('return'); break; }
      moveBody(m, 0, 0, 0, dt, env.world);
      if (m.phase !== 'recover') faceToward(m, dx, dz, dt);
      if (m.phase === 'ready') {
        if (homeD > cfg.chaseRange) { m.enter('return'); break; }
        if (d > cfg.attackRange * AI.leaveFactor) { m.enter('chase'); break; }
        if (m.attackCooldown <= 0) {
          m.phase = 'windup';
          m.phaseTime = cfg.attack.windup;
          env.hooks.attackStarted(m);
        }
      } else if (m.phase === 'windup') {
        m.phaseTime -= dt;
        if (m.phaseTime <= 0) {
          const connected = cfg.attack.shape === 'area' ? d <= cfg.attack.areaRadius : d <= cfg.attackRange + AI.strikeTolerance;
          m.attackCooldown = cfg.attackCooldown;
          m.phase = 'recover';
          m.phaseTime = AI.recoverTime;
          env.hooks.strike(m, connected);
        }
      } else {
        m.phaseTime -= dt;
        if (m.phaseTime <= 0) m.phase = 'ready';
      }
      break;
    }

    case 'return': {
      m.heal(cfg.maxHp * AI.returnRegen * dt);
      m.thinkTimer -= dt;
      if (m.thinkTimer <= 0) {
        m.thinkTimer += AI.thinkInterval;
        if (target.alive && d <= cfg.aggroRange && homeD <= cfg.chaseRange * 0.5) { startAggro(m, env); break; }
      }
      if (homeD <= 0.5) {
        m.vx = 0;
        m.vz = 0;
        m.enter('idle');
        m.wanderWait = 1 + env.rng() * 2;
        break;
      }
      moveBody(m, hx / homeD, hz / homeD, cfg.moveSpeed * AI.returnSpeedFactor, dt, env.world);
      if (checkStuck(m, dt, homeD, AI.returnStuckLimit)) {
        // Wedged between obstacles for seconds: the only place a monster is ever put somewhere without walking there.
        m.x = m.home.x;
        m.z = m.home.z;
        m.vx = 0;
        m.vz = 0;
        m.enter('idle');
      }
      break;
    }
  }
}

function startAggro(m: Monster, env: AiEnv): void {
  m.enter('aggro');
  m.lostTime = 0;
  env.hooks.aggro(m);
}

function faceToward(m: Monster, dx: number, dz: number, dt: number): void {
  if (dx * dx + dz * dz < 1e-6) return;
  m.yaw = dampAngle(m.yaw, Math.atan2(dx, dz), AI.turnLambda, AI.maxTurnRate, dt);
}

/** Idle behaviour: stand, then walk to a random point near home, pause, repeat. */
function wander(m: Monster, dt: number, env: AiEnv): void {
  const r = m.config.patrolRadius;
  if (r <= 0) {
    moveBody(m, 0, 0, 0, dt, env.world);
    return;
  }
  if (m.wanderWait > 0) {
    m.wanderWait -= dt;
    moveBody(m, 0, 0, 0, dt, env.world);
    if (m.wanderWait <= 0) {
      const a = env.rng() * Math.PI * 2;
      const rr = Math.sqrt(env.rng()) * r;
      m.wanderX = m.home.x + Math.sin(a) * rr;
      m.wanderZ = m.home.z + Math.cos(a) * rr;
      m.wanderTime = 6;
    }
    return;
  }
  m.wanderTime -= dt;
  const wx = m.wanderX - m.x;
  const wz = m.wanderZ - m.z;
  const wd = Math.hypot(wx, wz);
  if (wd < 0.4 || m.wanderTime <= 0) {
    m.wanderWait = 2 + env.rng() * 3;
    moveBody(m, 0, 0, 0, dt, env.world);
    return;
  }
  moveBody(m, wx / wd, wz / wd, m.config.moveSpeed * AI.patrolSpeedFactor, dt, env.world);
}

/**
 * Anti-stuck, once per second: if the monster spent a good part of that second touching obstacles AND got less than
 * 0.4 m closer to its goal (the target while chasing, home while returning), it counts as stuck. Sliding back and
 * forth along a wall therefore counts, while a player kiting an unobstructed monster does not. Each stuck second also
 * flips the side it tries to walk around the obstacle. Returns true when `limit` stuck seconds in a row were reached.
 */
function checkStuck(m: Monster, dt: number, goalDistance: number, limit: number): boolean {
  m.sampleTimer -= dt;
  if (m.sampleTimer > 0) return false;
  m.sampleTimer += 1;
  const closed = m.sampleDistance - goalDistance;
  const touched = m.blockedTime >= 0.25;
  m.sampleDistance = goalDistance;
  m.blockedTime = 0;
  if (touched && closed < 0.4) {
    m.stuckTime += 1;
    m.avoidSide = m.avoidSide === 1 ? -1 : 1;
  } else {
    m.stuckTime = 0;
  }
  return m.stuckTime >= limit;
}

/** Smoothly accelerates toward (dirX, dirZ)·speed, turns to face the motion and integrates in collision sub-steps. */
function moveBody(m: Monster, dirX: number, dirZ: number, speed: number, dt: number, world: CollisionWorld | null): void {
  if (speed > 0 && m.blocked) {
    // An obstacle is in the way: the collision response alone would only push straight back when the target is dead
    // ahead, so bend the heading to one side and slide around it.
    const a = m.avoidSide * AI.avoidAngle;
    const c = Math.cos(a), s = Math.sin(a);
    const nx = dirX * c + dirZ * s;
    dirZ = -dirX * s + dirZ * c;
    dirX = nx;
  }
  const tx = dirX * speed;
  const tz = dirZ * speed;
  m.vx = damp(m.vx, tx, AI.accelLambda, dt);
  m.vz = damp(m.vz, tz, AI.accelLambda, dt);
  if (speed === 0 && Math.abs(m.vx) + Math.abs(m.vz) < 0.05) {
    m.vx = 0;
    m.vz = 0;
    return;
  }
  if (speed > 0) m.yaw = dampAngle(m.yaw, Math.atan2(dirX, dirZ), AI.turnLambda, AI.maxTurnRate, dt);
  const dist = Math.hypot(m.vx, m.vz) * dt;
  const n = Math.max(1, Math.ceil(dist / AI.maxStepDistance));
  const h = dt / n;
  let hit = false;
  for (let i = 0; i < n; i++) {
    m.x += m.vx * h;
    m.z += m.vz * h;
    if (world && world.resolve(m, m.config.radius)) hit = true;
  }
  m.blocked = hit;
  if (hit) m.blockedTime += dt;
}
