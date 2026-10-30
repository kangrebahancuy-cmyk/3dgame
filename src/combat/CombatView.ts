import { Color3, Matrix, Vector3, type AbstractMesh, type ArcRotateCamera, type Engine, type Mesh, type Scene } from '@babylonjs/core';
import type { Player } from '../character/Player';
import type { GameConfig } from '../config';
import type { ScreenPoint } from '../ui/CombatUi';
import { buildFan, CombatEffects, glowMaterial } from './CombatEffects';
import type { CombatSystem } from './CombatSystem';
import type { CombatEvent } from './events';
import { MonsterView } from './MonsterView';
import { PlayerPoseDriver } from './pose';
import { weaponProfile } from './weapon';

/**
 * Everything the player SEES of combat, driven by the combat events and the monsters' state: monster models, hit sparks,
 * swing sweeps, death dust, the target ring, the player's swing/flinch/fall pose. Also the camera helpers the DOM UI
 * and the mouse need (world -> screen, screen -> picking ray). Holds no gameplay rules.
 */
export class CombatView {
  private readonly effects: CombatEffects;
  private readonly views = new Map<number, MonsterView>();
  private readonly poseDriver = new PlayerPoseDriver();
  private readonly ring: Mesh;
  private readonly identity = Matrix.Identity();
  private readonly offEvents: Array<() => void> = [];
  private rect = { left: 0, top: 0, width: 1, height: 1 };
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly engine: Engine,
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: ArcRotateCamera,
    cfg: GameConfig,
    private readonly combat: CombatSystem,
    private readonly getPlayer: () => Player | null,
  ) {
    this.effects = new CombatEffects(scene);
    this.ring = buildFan(scene, 'target-ring', { inner: 0.86, outer: 1, arc: Math.PI * 2, segments: 32 });
    this.ring.material = glowMaterial(scene, 'target-ring-mat', new Color3(1, 0.85, 0.25), 0.95);
    this.ring.position.y = 0.05;
    this.ring.setEnabled(false);

    for (const m of combat.monsters.all) this.views.set(m.id, new MonsterView(m, scene, cfg));
    this.offEvents.push(combat.events.on((e) => this.onEvent(e)));
  }

  /** Loads the monster models one after the other (the loader shares global plugin hooks), never throwing. */
  async populate(addShadow: (m: AbstractMesh) => void, onProgress?: (done: number, total: number) => void): Promise<void> {
    let done = 0;
    for (const v of this.views.values()) {
      if (this.disposed) return;
      await v.load(addShadow);
      onProgress?.(++done, this.views.size);
    }
  }

  private onEvent(e: CombatEvent): void {
    const player = this.getPlayer();
    switch (e.type) {
      case 'skillUsed': {
        this.poseDriver.swingNow();
        const def = this.combat.skills.get(e.skillId);
        if (!player || !def) break;
        const px = player.x, pz = player.z;
        if (def.target === 'around') {
          for (let i = 0; i < 3; i++) this.effects.slash(px, pz, (i * Math.PI * 2) / 3, def.areaRadius);
        } else {
          const t = e.targetIds.length > 0 ? this.combat.monsters.get(e.targetIds[0]) : undefined;
          const yaw = t ? Math.atan2(t.x - px, t.z - pz) : player.movement.yaw;
          this.effects.slash(px, pz, yaw, this.combat.skills.rangeOf(def, weaponProfile(this.combat.equipment)) * 0.9);
        }
        break;
      }
      case 'damage':
        if (e.target.kind === 'monster') this.effects.hit(e.x, e.height * 0.55, e.z, e.crit);
        else {
          this.effects.hurt(e.x, 1.1, e.z);
          this.poseDriver.hurtNow();
        }
        break;
      case 'monsterKilled': {
        const m = this.combat.monsters.get(e.monsterId);
        this.effects.puff(e.x, e.z, m ? m.config.model.scale : 1);
        break;
      }
      default:
        break;
    }
  }

  /** Call once per frame (after the combat update). */
  update(dt: number): void {
    if (this.disposed) return;
    this.rect = this.canvas.getBoundingClientRect();
    this.effects.update(dt);
    for (const v of this.views.values()) v.update(dt);

    const t = this.combat.targeting.target;
    if (t) {
      const r = t.config.radius * 1.5;
      this.ring.position.x = t.x;
      this.ring.position.z = t.z;
      this.ring.scaling.set(r, 1, r);
      if (!this.ring.isEnabled()) this.ring.setEnabled(true);
    } else if (this.ring.isEnabled()) {
      this.ring.setEnabled(false);
    }

    const player = this.getPlayer();
    if (player) {
      const bp = this.poseDriver.update(dt, this.combat.playerDead);
      player.setCombatPose(bp.pitch, bp.lunge, bp.sink);
    }
  }

  /** World point -> CSS pixels in the viewport. `visible` is false behind the camera or off screen. */
  project(x: number, y: number, z: number, out: ScreenPoint): void {
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    const vp = this.camera.viewport.toGlobal(w, h);
    const v = Vector3.Project(new Vector3(x, y, z), this.identity, this.scene.getTransformMatrix(), vp);
    out.x = this.rect.left + (v.x * this.rect.width) / w;
    out.y = this.rect.top + (v.y * this.rect.height) / h;
    out.visible = v.z > 0 && v.z < 1 && out.x > -40 && out.x < this.rect.left + this.rect.width + 40 && out.y > -40 && out.y < this.rect.top + this.rect.height + 40;
  }

  /** The monster under a mouse position (client pixels), or null. Does not select it. */
  pickAt(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const px = ((clientX - rect.left) * this.engine.getRenderWidth()) / rect.width;
    const py = ((clientY - rect.top) * this.engine.getRenderHeight()) / rect.height;
    const ray = this.scene.createPickingRay(px, py, this.identity, this.camera);
    return this.combat.targeting.pickByRay({
      ox: ray.origin.x, oy: ray.origin.y, oz: ray.origin.z,
      dx: ray.direction.x, dy: ray.direction.y, dz: ray.direction.z,
    });
  }

  get viewCount(): number {
    return this.views.size;
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.offEvents) off();
    this.offEvents.length = 0;
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.effects.dispose();
    this.ring.dispose();
    this.getPlayer()?.setCombatPose(0, 0, 0);
  }
}
