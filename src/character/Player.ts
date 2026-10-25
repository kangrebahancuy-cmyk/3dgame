import { Quaternion, Vector3 } from '@babylonjs/core';
import type { GameConfig } from '../config';
import { damp } from '../math/scalar';
import type { CollisionWorld } from '../world/collision';
import { heightAt } from '../world/terrain';
import { CharacterAnimator } from './CharacterAnimator';
import type { LoadedCharacter } from './CharacterLoader';
import { MovementModel } from './MovementModel';

const UP = Vector3.Up();

/**
 * The playable character: engine-independent MovementModel + animator + the Babylon transform node
 * that carries the model. The node itself is moved every frame (the camera follows it, never the reverse).
 */
export class Player {
  readonly movement: MovementModel;
  private readonly animator: CharacterAnimator;
  private animSpeed = 0;

  constructor(
    readonly character: LoadedCharacter,
    private readonly cfg: GameConfig,
    private readonly world: CollisionWorld,
  ) {
    this.movement = new MovementModel(cfg.movement);
    this.animator = new CharacterAnimator(character, cfg);
    this.respawn();
  }

  get x(): number { return this.movement.x; }
  get z(): number { return this.movement.z; }
  get y(): number { return this.character.root.position.y; }
  get animation(): CharacterAnimator { return this.animator; }

  /** Puts the character back at the start, standing still and facing the camera's forward direction. */
  respawn(yaw = 0): void {
    this.movement.teleport(0, 0, yaw);
    this.animSpeed = 0;
    this.syncNode();
    this.animator.update(0, 0);
  }

  update(dt: number, dirX: number, dirZ: number, run: boolean): void {
    const dtc = Math.min(dt, this.cfg.movement.maxFrameTime);
    this.movement.step(dtc, dirX, dirZ, run, this.world);
    // Animation follows a lightly smoothed speed so a one-frame collision spike never flickers the pose.
    this.animSpeed = damp(this.animSpeed, this.movement.speed, this.cfg.character.animSpeedLambda, dtc);
    if (this.movement.speed === 0 && this.animSpeed < 0.02) this.animSpeed = 0;
    this.syncNode();
    this.animator.update(dtc, this.animSpeed);
  }

  private syncNode(): void {
    const m = this.movement;
    const node = this.character.root;
    // Feet are placed with the same analytic function the ground mesh is built from: no sinking, no floating.
    node.position.copyFromFloats(m.x, heightAt(m.x, m.z), m.z);
    Quaternion.RotationAxisToRef(UP, m.yaw, node.rotationQuaternion!);
  }
}
