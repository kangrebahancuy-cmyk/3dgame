import { ArcRotateCamera, Vector3, type Scene } from '@babylonjs/core';
import type { CameraConfig } from '../config';
import { DEG2RAD } from '../math/scalar';
import { heightAt } from '../world/terrain';
import { FollowRig } from './FollowRig';

/**
 * Babylon adapter for FollowRig. The ArcRotateCamera has no user inputs attached; each frame we place it
 * from the rig's smoothed focus point using its documented spherical-coordinate convention
 * (position = target + radius * (cos a * sin b, cos b, sin a * sin b)).
 */
export class GameCamera {
  readonly rig: FollowRig;
  readonly camera: ArcRotateCamera;
  private readonly focus = new Vector3();

  constructor(scene: Scene, cfg: CameraConfig) {
    this.rig = new FollowRig(cfg, heightAt, 'left'); // Babylon's default coordinate system is left-handed
    this.camera = new ArcRotateCamera('camera', 0, 1, cfg.distance, this.focus, scene);
    this.camera.fov = cfg.fovDeg * DEG2RAD;
    this.camera.minZ = 0.5;
    this.camera.maxZ = 300;
    this.camera.inputs.clear();
    this.camera.lowerBetaLimit = 0.05;
    this.camera.upperBetaLimit = Math.PI - 0.05;
    this.camera.lowerRadiusLimit = 0.5;
    scene.activeCamera = this.camera;
  }

  snap(x: number, y: number, z: number): void {
    this.rig.snap(x, y, z);
    this.apply();
  }

  update(dt: number, x: number, y: number, z: number, wheel: number): void {
    if (wheel !== 0) this.rig.zoom(wheel * 0.01);
    this.rig.update(dt, x, y, z);
    this.apply();
  }

  private apply(): void {
    const r = this.rig;
    const ox = r.posX - r.focusX;
    const oy = r.posY - r.focusY;
    const oz = r.posZ - r.focusZ;
    const radius = Math.hypot(ox, oy, oz);
    this.focus.copyFromFloats(r.focusX, r.focusY, r.focusZ);
    this.camera.setTarget(this.focus);
    this.camera.alpha = Math.atan2(oz, ox);
    this.camera.beta = Math.acos(Math.min(1, Math.max(-1, oy / radius)));
    this.camera.radius = radius;
  }
}
