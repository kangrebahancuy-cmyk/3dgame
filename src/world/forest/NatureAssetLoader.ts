import {
  Color3,
  Mesh,
  Scene,
  SceneLoader,
  StandardMaterial,
  VertexBuffer,
  VertexData,
  Vector3,
  type AbstractMesh,
  type InstancedMesh,
  type Material,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { resolveAssetUrl } from '../../character/CharacterLoader';
import { NATURE_CATALOG } from './NatureCatalog';
import { paletteColor, type PaletteName, type RGB } from './NaturePalette';

/** One model that could not be loaded or did not match its catalog entry: the exact file and the real error. */
export interface NatureFailure {
  readonly file: string;
  readonly url: string;
  readonly message: string;
  readonly cause?: unknown;
}

export class NatureLoadError extends Error {
  constructor(readonly failures: readonly NatureFailure[]) {
    super(
      `${failures.length} forest model${failures.length === 1 ? '' : 's'} could not be loaded: ` +
        failures.slice(0, 4).map((f) => f.file).join(', ') + (failures.length > 4 ? ', …' : ''),
    );
    this.name = 'NatureLoadError';
  }

  /** Multi-line technical detail for the error panel / console: one "file - error" line per failure. */
  get detail(): string {
    return this.failures.map((f) => `${f.file}  (${f.url})\n    ${f.message}`).join('\n');
  }
}

/** Geometry of one model after the glTF import: world-space, per-vertex colour already applied. */
interface RawModel {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
  min: [number, number, number];
  max: [number, number, number];
}

interface Template {
  readonly id: string;
  readonly raw: RawModel;
  /** The one real mesh of this model, visible at the FIRST placement; every later placement is an instance of it. */
  master: Mesh | null;
  placements: number;
}

const CASTS_SHADOW = new Set(['conifer', 'broadleaf', 'rock_large', 'rock_tall', 'log', 'stump', 'camp', 'sign']);
const SMALL = new Set(['rock_small', 'bush', 'plant', 'grass', 'flower', 'mushroom']);

const FRAMES: ReadonlyArray<readonly [number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Loads every Kenney GLB the map needs EXACTLY ONCE, bakes each into a single vertex-coloured mesh template
 * (one draw call per model type, no per-frame work) and then places the map's objects as instances of it.
 *
 * What it checks, because a filename proves nothing:
 *  - the file is downloaded and parsed (HTTP/parse failures are reported with the exact file name and error),
 *  - its bounding box matches the measurements in NatureCatalog.ts (so it IS the file that was catalogued),
 *  - every material name has a palette entry,
 *  - the glTF loader's coordinate convention (handedness) is detected from the data and corrected, so the
 *    collision offsets computed from the catalog line up with what is drawn.
 */
export class NatureAssetLoader {
  private readonly templates = new Map<string, Template>();
  private readonly material: StandardMaterial;
  private frame: readonly [number, number] = [1, 1];
  private instanceCounter = 0;

  constructor(
    private readonly scene: Scene,
    private readonly palette: PaletteName,
    /** Folder (relative to the site root) that holds the GLBs; copied from the Kenney kit by tools/nature_catalog.py. */
    private readonly folder = 'models/nature/',
  ) {
    const m = new StandardMaterial('forest-vertex-colour', scene);
    m.diffuseColor = Color3.White();
    m.specularColor = Color3.Black();
    m.backFaceCulling = false; // robust against any winding differences; the meshes are closed low-poly solids anyway
    m.freeze();
    this.material = m;
  }

  /**
   * Downloads and bakes all `ids` (a few at a time). Resolves when every model is ready; rejects with a
   * NatureLoadError naming every file that failed. `onProgress(done, total, file)` drives the loading indicator.
   */
  async load(ids: readonly string[], onProgress?: (done: number, total: number, file: string) => void): Promise<void> {
    const failures: NatureFailure[] = [];
    const total = ids.length;
    let done = 0, next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= total) return;
        const id = ids[i];
        const entry = NATURE_CATALOG[id];
        const url = resolveAssetUrl(`${this.folder}${id}.glb`);
        try {
          if (!entry) throw new Error('not in the verified catalog (NatureCatalog.ts)');
          this.templates.set(id, { id, raw: await this.importAndBake(url), master: null, placements: 0 });
        } catch (e) {
          failures.push({ file: `${id}.glb`, url: url.pathname, message: e instanceof Error ? `${e.name}: ${e.message}` : String(e), cause: e });
          console.error(`[3DGAME] forest model ${id}.glb failed`, e);
        }
        onProgress?.(++done, total, `${id}.glb`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, total) }, worker));
    if (failures.length === 0) failures.push(...this.detectFrameAndVerify());
    if (failures.length > 0) {
      failures.sort((a, b) => a.file.localeCompare(b.file));
      throw new NatureLoadError(failures);
    }
  }

  has(id: string): boolean {
    return this.templates.has(id);
  }

  /**
   * Puts one object into the scene. The first placement of a model turns its template into the visible master mesh;
   * all others are InstancedMesh copies that share its geometry and the single material.
   */
  place(id: string, x: number, y: number, z: number, yaw: number, scale: number): AbstractMesh {
    const t = this.templates.get(id);
    if (!t) throw new Error(`NatureAssetLoader.place: "${id}" was not loaded`);
    let node: Mesh | InstancedMesh;
    if (!t.master) {
      t.master = this.buildMaster(t);
      node = t.master;
    } else {
      node = t.master.createInstance(`${id}#${this.instanceCounter++}`);
    }
    t.placements++;
    node.position.set(x, y, z);
    node.rotation.y = yaw;
    node.scaling.setAll(scale);
    node.isPickable = false;
    node.freezeWorldMatrix();
    node.doNotSyncBoundingInfo = true;
    return node;
  }

  /** Master meshes (one per model type that was actually placed): these are what the shadow generator needs. */
  masters(): Array<{ id: string; mesh: Mesh; castsShadow: boolean }> {
    const out: Array<{ id: string; mesh: Mesh; castsShadow: boolean }> = [];
    for (const t of this.templates.values()) {
      if (t.master) out.push({ id: t.id, mesh: t.master, castsShadow: CASTS_SHADOW.has(NATURE_CATALOG[t.id].category) });
    }
    return out;
  }

  /** Model types loaded, model types placed, total placements - for the console summary and the final report. */
  stats(): { loaded: number; placedTypes: number; placements: number } {
    let placedTypes = 0, placements = 0;
    for (const t of this.templates.values()) {
      if (t.placements > 0) placedTypes++;
      placements += t.placements;
    }
    return { loaded: this.templates.size, placedTypes, placements };
  }

  /** Frees the raw geometry copies once everything is placed (the GPU buffers live on in the masters). */
  releaseRaw(): void {
    for (const t of this.templates.values()) {
      t.raw.positions.length = t.raw.normals.length = t.raw.colors.length = t.raw.indices.length = 0;
    }
  }

  // ------------------------------------------------------------------------------------------------ internals

  private async importAndBake(url: URL): Promise<RawModel> {
    const slash = url.href.lastIndexOf('/');
    const result = await SceneLoader.ImportMeshAsync('', url.href.slice(0, slash + 1), url.href.slice(slash + 1), this.scene, undefined, '.glb');
    try {
      return this.bake(result.meshes);
    } finally {
      // The imported nodes were only a transport for the geometry; the baked template replaces them.
      const mats = new Set<Material>();
      for (const m of result.meshes) {
        if (m.material) {
          const mm = m.material as Material & { subMaterials?: Array<Material | null> };
          mats.add(mm);
          mm.subMaterials?.forEach((s) => s && mats.add(s));
        }
      }
      result.transformNodes.forEach((n) => n.dispose());
      result.meshes.forEach((m) => m.dispose(false, false));
      mats.forEach((m) => m.dispose());
      result.skeletons.forEach((s) => s.dispose());
      result.animationGroups.forEach((g) => g.dispose());
    }
  }

  /** Flattens every sub-mesh (in world space, as the glTF loader placed it) into one vertex-coloured model. */
  private bake(meshes: AbstractMesh[]): RawModel {
    const raw: RawModel = { positions: [], normals: [], colors: [], indices: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    const tmp = new Vector3();
    let any = false;
    for (const node of meshes) {
      if (!(node instanceof Mesh) || node.getTotalVertices() === 0) continue;
      node.computeWorldMatrix(true);
      const wm = node.getWorldMatrix();
      const pos = node.getVerticesData(VertexBuffer.PositionKind);
      const nrm = node.getVerticesData(VertexBuffer.NormalKind);
      const idx = node.getIndices();
      if (!pos || !idx) throw new Error('mesh without positions or indices');
      const subs = node.subMeshes && node.subMeshes.length > 0 ? node.subMeshes : null;
      const ranges = subs
        ? subs.map((s) => ({ start: s.indexStart, count: s.indexCount, material: s.getMaterial() }))
        : [{ start: 0, count: idx.length, material: node.material }];
      for (const r of ranges) {
        const mat = r.material as (Material & { albedoColor?: Color3; diffuseColor?: Color3 }) | null;
        if (!mat) throw new Error(`mesh "${node.name}" has no material`);
        const authored: RGB = mat.albedoColor ? [mat.albedoColor.r, mat.albedoColor.g, mat.albedoColor.b] : mat.diffuseColor ? [mat.diffuseColor.r, mat.diffuseColor.g, mat.diffuseColor.b] : [1, 1, 1];
        const col = paletteColor(this.palette, mat.name, authored);
        const remap = new Map<number, number>();
        const base = raw.positions.length / 3;
        let added = 0;
        for (let k = r.start; k < r.start + r.count; k++) {
          const v = idx[k];
          let nv = remap.get(v);
          if (nv === undefined) {
            nv = base + added++;
            remap.set(v, nv);
            Vector3.TransformCoordinatesFromFloatsToRef(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], wm, tmp);
            raw.positions.push(tmp.x, tmp.y, tmp.z);
            if (tmp.x < raw.min[0]) raw.min[0] = tmp.x;
            if (tmp.y < raw.min[1]) raw.min[1] = tmp.y;
            if (tmp.z < raw.min[2]) raw.min[2] = tmp.z;
            if (tmp.x > raw.max[0]) raw.max[0] = tmp.x;
            if (tmp.y > raw.max[1]) raw.max[1] = tmp.y;
            if (tmp.z > raw.max[2]) raw.max[2] = tmp.z;
            if (nrm) Vector3.TransformNormalFromFloatsToRef(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2], wm, tmp);
            else tmp.set(0, 1, 0);
            tmp.normalize();
            raw.normals.push(tmp.x, tmp.y, tmp.z);
            raw.colors.push(col[0], col[1], col[2], 1);
          }
          raw.indices.push(nv);
        }
        any = true;
      }
    }
    if (!any) throw new Error('the file contains no renderable mesh');
    return raw;
  }

  /**
   * Compares every baked model with its catalog entry. The glTF loader may mirror or rotate the model to convert
   * handedness; the data tells us which of the four horizontal conventions was used, and we correct for it once.
   */
  private detectFrameAndVerify(): NatureFailure[] {
    const failures: NatureFailure[] = [];
    const url = (id: string): string => resolveAssetUrl(`${this.folder}${id}.glb`).pathname;
    const errFor = (t: Template, f: readonly [number, number]): number => {
      const c = NATURE_CATALOG[t.id].center;
      const cx = (t.raw.min[0] + t.raw.max[0]) / 2, cz = (t.raw.min[2] + t.raw.max[2]) / 2;
      return Math.abs(cx - f[0] * c[0]) + Math.abs(cz - f[1] * c[1]);
    };
    let best = FRAMES[0], bestErr = Infinity;
    for (const f of FRAMES) {
      let e = 0;
      for (const t of this.templates.values()) e += errFor(t, f);
      if (e < bestErr) { bestErr = e; best = f; }
    }
    this.frame = best;
    if (best[0] !== 1 || best[1] !== 1) console.info(`[3DGAME] glTF loader convention detected: x*${best[0]}, z*${best[1]} (corrected)`);
    for (const t of this.templates.values()) {
      const a = NATURE_CATALOG[t.id];
      const size = [t.raw.max[0] - t.raw.min[0], t.raw.max[1] - t.raw.min[1], t.raw.max[2] - t.raw.min[2]];
      const sizeErr = Math.max(Math.abs(size[0] - a.size[0]), Math.abs(size[1] - a.size[1]), Math.abs(size[2] - a.size[2]));
      const yErr = Math.abs(t.raw.min[1] - a.min[1]);
      const cErr = errFor(t, best);
      if (sizeErr > 0.02 || yErr > 0.02 || cErr > 0.03) {
        failures.push({
          file: a.file, url: url(t.id),
          message: `loaded geometry does not match the catalog (size off by ${sizeErr.toFixed(3)}, base by ${yErr.toFixed(3)}, centre by ${cErr.toFixed(3)} units) - the file may have changed; run "npm run catalog"`,
        });
      }
    }
    return failures;
  }

  /** Turns a baked template into the actual GPU mesh, in the catalog's coordinate frame (see detectFrameAndVerify). */
  private buildMaster(t: Template): Mesh {
    const [sx, sz] = this.frame;
    const positions = new Float32Array(t.raw.positions);
    const normals = new Float32Array(t.raw.normals);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] *= sx;
      positions[i + 2] *= sz;
      normals[i] *= sx;
      normals[i + 2] *= sz;
    }
    const indices = new Uint32Array(t.raw.indices);
    if (sx * sz < 0) for (let i = 0; i < indices.length; i += 3) { const b = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = b; }
    const mesh = new Mesh(t.id, this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.colors = new Float32Array(t.raw.colors);
    vd.indices = indices;
    vd.applyToMesh(mesh, false);
    mesh.material = this.material;
    const cat = NATURE_CATALOG[t.id].category;
    mesh.receiveShadows = !SMALL.has(cat) || cat === 'rock_small';
    return mesh;
  }
}
