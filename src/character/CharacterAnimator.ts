import type { GameConfig } from '../config';
import { AnimationBlender } from './AnimationBlender';
import type { LoadedCharacter } from './CharacterLoader';

/**
 * The single animation controller for the character's skeleton. Samples/blends Idle, Walk and Run
 * with `AnimationBlender` (pure logic, unit-tested) and writes the result into the bone nodes.
 */
export class CharacterAnimator {
  private readonly blender: AnimationBlender;
  private readonly rot: Float32Array;
  private readonly pos: Float32Array;

  constructor(private readonly character: LoadedCharacter, cfg: GameConfig) {
    this.blender = new AnimationBlender(character.clips, character.rest, {
      walkSpeed: cfg.movement.walkSpeed,
      runSpeed: cfg.movement.runSpeed,
      blendLambda: cfg.character.blendLambda,
      idleToWalkFraction: cfg.character.idleToWalkFraction,
    });
    this.rot = new Float32Array(character.bones.length * 4);
    this.pos = new Float32Array(character.bones.length * 3);
    this.update(0, 0); // show the idle pose immediately instead of the T-pose
  }

  get weights(): { idle: number; walk: number; run: number } {
    return { idle: this.blender.weightIdle, walk: this.blender.weightWalk, run: this.blender.weightRun };
  }

  get phase(): number {
    return this.blender.phase;
  }

  /** @param speed ground speed in m/s that drives blend weights and gait cadence */
  update(dt: number, speed: number): void {
    this.blender.update(dt, speed);
    this.blender.apply(this.rot, this.pos);
    const { rot, pos } = this;
    const bones = this.character.bones;
    const animated = this.blender.animatedBones;
    for (let n = 0; n < animated.length; n++) {
      const b = animated[n];
      const node = bones[b];
      node.rotationQuaternion!.copyFromFloats(rot[b * 4], rot[b * 4 + 1], rot[b * 4 + 2], rot[b * 4 + 3]);
      node.position.copyFromFloats(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
    }
  }
}
