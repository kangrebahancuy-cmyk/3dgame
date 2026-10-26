import { Color3, Color4, DirectionalLight, HemisphericLight, Scene, ShadowGenerator, Vector3, type AbstractMesh } from '@babylonjs/core';
import type { WorldConfig } from '../config';
import { CollisionWorld } from './collision';
import { DEFAULT_FOREST_OPTIONS, ForestMap } from './forest/ForestMap';
import { FOREST_MAP } from './forest/MapConfiguration';

type RGB = [number, number, number];
const SKY: RGB = [0.62, 0.8, 0.93];

/**
 * Lighting, shadows, fog and the collision world. The level itself (ground, forest, obstacles) is the ForestMap:
 * the ground is built immediately, the Kenney models stream in through `load()`.
 */
export class World {
  readonly collision = new CollisionWorld();
  readonly shadows: ShadowGenerator;
  readonly map: ForestMap;
  private readonly sun: DirectionalLight;

  constructor(scene: Scene, cfg: WorldConfig) {
    scene.clearColor = new Color4(SKY[0], SKY[1], SKY[2], 1);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = new Color3(SKY[0], SKY[1], SKY[2]);
    scene.fogStart = 40;
    scene.fogEnd = 90;

    const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
    ambient.intensity = 0.7;
    ambient.diffuse = new Color3(0.95, 0.97, 1);
    ambient.groundColor = new Color3(0.42, 0.5, 0.38);
    ambient.specular = Color3.Black();

    const sun = new DirectionalLight('sun', new Vector3(-0.55, -1, -0.35).normalize(), scene);
    sun.intensity = 1.0;
    sun.diffuse = new Color3(1, 0.96, 0.86);
    sun.specular = Color3.Black();
    this.sun = sun;

    const sg = new ShadowGenerator(cfg.shadowMapSize, sun);
    sg.usePercentageCloserFiltering = true;
    sg.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    sg.bias = 0.0006;
    sg.normalBias = 0.02;
    sg.setDarkness(0.3);
    this.shadows = sg;

    this.map = new ForestMap(scene, FOREST_MAP, { ...DEFAULT_FOREST_OPTIONS, palette: cfg.palette });
    this.map.buildGround();
  }

  /** Streams in the forest models. Rejects with a NatureLoadError that lists every failing file and its error. */
  async load(onProgress: (text: string, fraction: number) => void): Promise<void> {
    await this.map.populate(this.collision, this.shadows, this.sun, onProgress);
  }

  addShadowCaster(mesh: AbstractMesh): void {
    this.shadows.addShadowCaster(mesh);
  }
}
