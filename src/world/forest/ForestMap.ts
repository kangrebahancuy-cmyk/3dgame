import {
  Color3,
  DynamicTexture,
  Mesh,
  Scene,
  StandardMaterial,
  Texture,
  VertexData,
  type DirectionalLight,
  type ShadowGenerator,
} from '@babylonjs/core';
import type { CollisionWorld } from '../collision';
import { heightAt } from '../terrain';
import { generateForestLayout, groundMarks, type ForestLayout } from './ForestLayout';
import { groundUv, paintGround, paintedSize } from './GroundPainter';
import { FOREST_MAP, type ForestMapConfiguration } from './MapConfiguration';
import { NatureAssetLoader, NatureLoadError } from './NatureAssetLoader';
import type { PaletteName } from './NaturePalette';
import { PathNetwork } from './PathNetwork';

export interface ForestMapOptions {
  palette: PaletteName;
  /** Side (px) of the painted ground texture. 2048 = ~25 px per metre. */
  groundTexturePixels: number;
}

export const DEFAULT_FOREST_OPTIONS: ForestMapOptions = { palette: 'forest', groundTexturePixels: 2048 };

/** What the map builder reports back (for the console and the final report). */
export interface ForestMapSummary {
  readonly objects: number;
  readonly solids: number;
  readonly modelTypes: number;
  readonly drawnMasters: number;
  readonly instances: number;
}

/**
 * The first playable forest map: painted flat ground, the instanced Kenney decoration, and the collision data
 * (tree trunks, large rocks, the square map boundary). Everything pure (layout, paths) comes from the engine-free
 * modules; this class only turns it into Babylon meshes.
 */
export class ForestMap {
  readonly layout: ForestLayout;
  readonly net: PathNetwork;
  summary: ForestMapSummary | null = null;
  private readonly loader: NatureAssetLoader;

  constructor(
    private readonly scene: Scene,
    readonly config: ForestMapConfiguration = FOREST_MAP,
    private readonly options: ForestMapOptions = DEFAULT_FOREST_OPTIONS,
  ) {
    this.net = new PathNetwork(config.paths);
    this.layout = generateForestLayout(config);
    this.loader = new NatureAssetLoader(scene, options.palette);
  }

  /** Cheap, synchronous part: the ground is visible immediately while the models stream in. */
  buildGround(): void {
    const cfg = this.config;
    const scene = this.scene;
    // 1. a huge plain quad under everything, so there is never a visible edge of the world
    const h = cfg.groundHalf;
    const outer = new Mesh('ground-outer', scene);
    const ovd = new VertexData();
    ovd.positions = [-h, -0.03, -h, h, -0.03, -h, h, -0.03, h, -h, -0.03, h];
    ovd.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    ovd.indices = [0, 2, 1, 0, 3, 2];
    ovd.applyToMesh(outer);
    const om = new StandardMaterial('ground-outer-mat', scene);
    om.diffuseColor = new Color3(0.31, 0.46, 0.2); // ~ the average of the painted forest floor, so the seam is invisible
    om.specularColor = Color3.Black();
    om.backFaceCulling = false;
    outer.material = om;
    outer.receiveShadows = true;
    outer.isPickable = false;
    outer.freezeWorldMatrix();

    // 2. the painted forest floor, flat at y = heightAt = 0
    const s = paintedSize(cfg) / 2;
    const corners: Array<[number, number]> = [[-s, -s], [s, -s], [s, s], [-s, s]];
    const ground = new Mesh('ground', scene);
    const vd = new VertexData();
    vd.positions = corners.flatMap(([x, z]) => [x, heightAt(x, z), z]);
    vd.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    vd.uvs = corners.flatMap(([x, z]) => groundUv(cfg, x, z));
    vd.indices = [0, 2, 1, 0, 3, 2];
    vd.applyToMesh(ground);
    const px = this.options.groundTexturePixels;
    const tex = new DynamicTexture('ground-paint', { width: px, height: px }, scene, true, Texture.TRILINEAR_SAMPLINGMODE, undefined, true);
    tex.anisotropicFilteringLevel = 8;
    tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    paintGround(tex.getContext() as CanvasRenderingContext2D, px, cfg, this.net, groundMarks(this.layout));
    tex.update(true);
    const gm = new StandardMaterial('ground-mat', scene);
    gm.diffuseTexture = tex;
    gm.specularColor = Color3.Black();
    gm.backFaceCulling = false;
    ground.material = gm;
    ground.receiveShadows = true;
    ground.isPickable = false;
    ground.freezeWorldMatrix();
  }

  /**
   * Loads the Kenney models, places everything, registers collision and shadows.
   * Throws NatureLoadError (with every failing file name and its error) if any model cannot be loaded.
   */
  async populate(collision: CollisionWorld, shadows: ShadowGenerator, sun: DirectionalLight | null, report?: (text: string, fraction: number) => void): Promise<void> {
    const ids = [...new Set(this.layout.objects.map((o) => o.assetId))].sort();
    report?.(`Loading forest models (0/${ids.length})…`, 0.1);
    await this.loader.load(ids, (done, total, file) => report?.(`Loading forest models (${done}/${total}) ${file}`, 0.1 + 0.75 * (done / total)));

    report?.('Planting the forest…', 0.9);
    for (const o of this.layout.objects) this.loader.place(o.assetId, o.x, heightAt(o.x, o.z), o.z, o.yaw, o.scale);
    for (const m of this.loader.masters()) if (m.castsShadow) shadows.addShadowCaster(m.mesh);
    this.loader.releaseRaw();

    // collision: trunks, big rocks, signs, campfire - and the square boundary of the map
    collision.clear();
    for (const c of this.layout.solids) collision.addCircle(c.x, c.z, c.r);
    collision.setRectBounds(this.config.size / 2, this.config.size / 2);

    // the shadow map covers exactly the playable square (plus a margin) instead of auto-fitting to the master meshes,
    // which would ignore instances placed outside the masters' bounding boxes
    if (sun) {
      const e = this.config.size / 2 * Math.SQRT2 + 6;
      sun.autoUpdateExtends = false;
      sun.autoCalcShadowZBounds = false;
      const d = sun.direction.normalizeToNew();
      sun.position.set(-d.x * 90, -d.y * 90, -d.z * 90);
      sun.orthoLeft = -e; sun.orthoRight = e; sun.orthoBottom = -e; sun.orthoTop = e;
      sun.shadowMinZ = 20;
      sun.shadowMaxZ = 190;
    }

    const st = this.loader.stats();
    this.summary = { objects: this.layout.objects.length, solids: this.layout.solids.length, modelTypes: st.loaded, drawnMasters: st.placedTypes, instances: st.placements - st.placedTypes };
    console.info('[3DGAME] forest map ready', this.summary);
  }
}

export { NatureLoadError };
