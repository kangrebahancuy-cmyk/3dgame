import { Color3, Mesh, MeshBuilder, PBRMaterial, Quaternion, StandardMaterial, TransformNode, type AbstractMesh, type Scene } from '@babylonjs/core';
import { CharacterAnimator } from '../character/CharacterAnimator';
import { loadCharacter, type LoadedCharacter } from '../character/CharacterLoader';
import type { GameConfig } from '../config';
import { heightAt } from '../world/terrain';
import { buildFan, glowMaterial } from './CombatEffects';
import type { Monster } from './Monster';
import { monsterPose, type BodyPose } from './pose';

const FLASH = new Color3(0.85, 0.12, 0.1);
const TIER_COLOR = { normal: new Color3(0.45, 0.55, 0.35), aggressive: new Color3(0.7, 0.45, 0.2), elite: new Color3(0.6, 0.25, 0.3) } as const;

/**
 * Draws one monster (Babylon side only; the rules and the state live in Monster / MonsterAI). The real model is the
 * converted Orc_Free GLB, loaded with the same loader and animator as the player (Idle / Walk / Run, blended by speed).
 * There is no attack / hit / death clip in the assets, so the body language comes from the pure `monsterPose`.
 * If the model cannot be loaded a plain cylinder stands in, so combat still works and the game never fails to start.
 */
export class MonsterView {
  readonly root: TransformNode;
  private character: LoadedCharacter | null = null;
  private animator: CharacterAnimator | null = null;
  private placeholder: Mesh | null = null;
  private readonly telegraph: { ring: Mesh; fill: Mesh } | null;
  private readonly materials: PBRMaterial[] = [];
  private readonly pose: BodyPose = { pitch: 0, lunge: 0, sink: 0, flash: 0, visible: true };
  private lastFlash = -1;
  private lastLife: number;
  private shown = true;
  private disposed = false;

  constructor(
    readonly monster: Monster,
    private readonly scene: Scene,
    private readonly cfg: GameConfig,
  ) {
    this.root = new TransformNode(`monster-${monster.id}`, scene);
    this.root.rotationQuaternion = Quaternion.Identity();
    this.lastLife = monster.life;
    const a = monster.config.attack;
    if (a.shape === 'area') {
      const ring = buildFan(scene, `telegraph-ring-${monster.id}`, { inner: a.areaRadius - 0.12, outer: a.areaRadius, arc: Math.PI * 2, segments: 40 });
      ring.material = glowMaterial(scene, `telegraph-ring-mat-${monster.id}`, new Color3(1, 0.25, 0.15), 0.9);
      const fill = buildFan(scene, `telegraph-fill-${monster.id}`, { inner: 0, outer: a.areaRadius, arc: Math.PI * 2, segments: 40 });
      fill.material = glowMaterial(scene, `telegraph-fill-mat-${monster.id}`, new Color3(1, 0.2, 0.1), 0.35);
      for (const m of [ring, fill]) {
        m.position.y = 0.06;
        m.setEnabled(false);
      }
      this.telegraph = { ring, fill };
    } else {
      this.telegraph = null;
    }
  }

  /** Loads the model (never throws: falls back to a placeholder). `addShadow` registers the meshes as shadow casters. */
  async load(addShadow: (m: AbstractMesh) => void): Promise<void> {
    const mc = this.monster.config;
    try {
      const ch = await loadCharacter(this.scene, { ...this.cfg.character, modelUrl: mc.model.url, equipmentSpeedBonus: false });
      if (this.disposed) {
        ch.dispose();
        return;
      }
      ch.root.parent = this.root;
      ch.root.position.setAll(0);
      ch.root.scaling.setAll(mc.model.scale);
      this.character = ch;
      this.animator = new CharacterAnimator(ch, this.cfg);
      for (const m of ch.meshes) {
        addShadow(m);
        if (m.material instanceof PBRMaterial && !this.materials.includes(m.material)) this.materials.push(m.material);
      }
    } catch (e) {
      console.warn(`[3DGAME] monster model ${mc.model.url} could not be loaded; using a placeholder body.`, e);
      this.buildPlaceholder();
    }
  }

  private buildPlaceholder(): void {
    const m = this.monster;
    const body = MeshBuilder.CreateCylinder(`monster-body-${m.id}`, { height: m.height, diameter: m.config.radius * 2, tessellation: 12 }, this.scene);
    body.position.y = m.height / 2;
    const mat = new StandardMaterial(`monster-body-mat-${m.id}`, this.scene);
    mat.diffuseColor = TIER_COLOR[m.config.tier];
    mat.specularColor = Color3.Black();
    body.material = mat;
    body.isPickable = false;
    body.parent = this.root;
    this.placeholder = body;
  }

  /** Call once per frame. */
  update(dt: number): void {
    const m = this.monster;
    if (m.life !== this.lastLife) {
      this.lastLife = m.life; // a respawn: the model stands up again
      this.lastFlash = -1;
    }
    monsterPose(m, this.pose);
    const p = this.pose;
    if (p.visible !== this.shown) {
      this.shown = p.visible;
      this.root.setEnabled(p.visible);
    }
    if (!p.visible) {
      this.setTelegraph(false, 0);
      return;
    }

    const scale = m.config.model.scale;
    const sx = Math.sin(m.yaw), cz = Math.cos(m.yaw);
    this.root.position.copyFromFloats(m.x + sx * p.lunge, heightAt(m.x, m.z) - p.sink, m.z + cz * p.lunge);
    Quaternion.RotationYawPitchRollToRef(m.yaw, p.pitch, 0, this.root.rotationQuaternion!);

    if (this.animator && m.alive) this.animator.update(dt, Math.hypot(m.vx, m.vz) / scale); // ground speed in model units
    this.applyFlash(p.flash);

    const windingUp = m.state === 'attack' && m.phase === 'windup';
    this.setTelegraph(windingUp, windingUp ? 1 - m.phaseTime / Math.max(1e-3, m.config.attack.windup) : 0);
    if (this.telegraph && windingUp) {
      this.telegraph.ring.position.x = this.telegraph.fill.position.x = m.x;
      this.telegraph.ring.position.z = this.telegraph.fill.position.z = m.z;
    }
  }

  private applyFlash(f: number): void {
    const q = Math.round(f * 10) / 10; // avoid touching materials every frame for tiny changes
    if (q === this.lastFlash) return;
    this.lastFlash = q;
    for (const mat of this.materials) mat.emissiveColor = FLASH.scale(q * 0.8);
  }

  private setTelegraph(on: boolean, t: number): void {
    const tg = this.telegraph;
    if (!tg) return;
    if (tg.ring.isEnabled() !== on) {
      tg.ring.setEnabled(on);
      tg.fill.setEnabled(on);
    }
    if (on) tg.fill.scaling.setAll(Math.max(0.02, t)); // the fill grows to the full area when the blow lands
  }

  dispose(): void {
    this.disposed = true;
    this.character?.dispose();
    this.placeholder?.dispose();
    this.telegraph?.ring.dispose();
    this.telegraph?.fill.dispose();
    this.root.dispose();
    this.character = null;
    this.animator = null;
    this.materials.length = 0;
  }
}
