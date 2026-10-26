import {
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
  VertexBuffer,
  VertexData,
  type AbstractMesh,
} from '@babylonjs/core';
import type { WorldConfig } from '../config';
import { CollisionWorld } from './collision';
import { generateLayout, type Prop, type PropKind } from './layout';
import { buildTerrainData, heightAt } from './terrain';

type RGB = [number, number, number];
interface Part {
  mesh: Mesh;
  color: RGB;
}

const SKY: RGB = [0.62, 0.8, 0.93];

/** Merges flat-shaded, vertex-coloured primitives into one low-poly mesh (one draw call per prop). */
function mergeParts(name: string, parts: Part[], material: StandardMaterial): Mesh {
  for (const { mesh, color } of parts) {
    mesh.convertToFlatShadedMesh();
    const n = mesh.getTotalVertices();
    const colors = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) colors.set([color[0], color[1], color[2], 1], i * 4);
    mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  }
  const merged = Mesh.MergeMeshes(parts.map((p) => p.mesh), true, true, undefined, false, false);
  if (!merged) throw new Error(`failed to build prop "${name}"`);
  merged.name = name;
  merged.material = material;
  merged.isPickable = false;
  return merged;
}

function cyl(h: number, dTop: number, dBottom: number, tess: number, y: number): Mesh {
  const m = MeshBuilder.CreateCylinder('part', { height: h, diameterTop: dTop, diameterBottom: dBottom, tessellation: tess });
  m.position.y = y;
  return m;
}

function blob(d: number, seg: number, x: number, y: number, z: number, sy = 1): Mesh {
  const m = MeshBuilder.CreateSphere('part', { diameter: d, segments: seg });
  m.position.set(x, y, z);
  m.scaling.y = sy;
  return m;
}

const BUILDERS: Record<PropKind, (mat: StandardMaterial) => Mesh> = {
  pine: (mat) =>
    mergeParts('pine', [
      { mesh: cyl(1.3, 0.28, 0.42, 6, 0.65), color: [0.4, 0.27, 0.16] },
      { mesh: cyl(2.0, 0, 2.0, 7, 2.0), color: [0.13, 0.38, 0.17] },
      { mesh: cyl(1.8, 0, 1.6, 7, 3.1), color: [0.16, 0.44, 0.2] },
      { mesh: cyl(1.6, 0, 1.1, 7, 4.1), color: [0.2, 0.5, 0.23] },
    ], mat),
  oak: (mat) =>
    mergeParts('oak', [
      { mesh: cyl(1.6, 0.38, 0.5, 6, 0.8), color: [0.4, 0.27, 0.16] },
      { mesh: blob(2.6, 5, 0, 2.7, 0, 0.85), color: [0.3, 0.55, 0.2] },
      { mesh: blob(1.7, 5, 0.7, 3.2, 0.2), color: [0.36, 0.62, 0.24] },
      { mesh: blob(1.5, 5, -0.7, 2.9, -0.4), color: [0.27, 0.5, 0.18] },
    ], mat),
  rock: (mat) =>
    mergeParts('rock', [
      { mesh: blob(1.7, 4, 0, 0.45, 0, 0.62), color: [0.5, 0.5, 0.52] },
      { mesh: blob(1.0, 4, 0.75, 0.28, 0.3, 0.7), color: [0.58, 0.57, 0.58] },
      { mesh: blob(0.7, 4, -0.6, 0.2, -0.5), color: [0.45, 0.46, 0.48] },
    ], mat),
  bush: (mat) =>
    mergeParts('bush', [
      { mesh: blob(1.1, 4, 0, 0.4, 0), color: [0.2, 0.46, 0.18] },
      { mesh: blob(0.8, 4, 0.5, 0.3, 0.2), color: [0.25, 0.52, 0.2] },
      { mesh: blob(0.7, 4, -0.45, 0.28, -0.3), color: [0.18, 0.42, 0.16] },
    ], mat),
};

/** Ground, lighting, shadows, props and the collision data derived from them. */
export class World {
  readonly collision = new CollisionWorld();
  readonly shadows: ShadowGenerator;
  readonly props: Prop[];
  readonly ground: Mesh;

  constructor(private readonly scene: Scene, cfg: WorldConfig) {
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

    const sg = new ShadowGenerator(cfg.shadowMapSize, sun);
    sg.usePercentageCloserFiltering = true;
    sg.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    sg.bias = 0.0006;
    sg.normalBias = 0.02;
    sg.setDarkness(0.3);
    this.shadows = sg;

    // ---- ground (vertices, normals and tints are all generated from the analytic height function)
    const t = buildTerrainData(cfg.groundSize, cfg.groundSegments);
    const vd = new VertexData();
    vd.positions = t.positions;
    vd.normals = t.normals;
    vd.colors = t.colors;
    vd.indices = t.indices;
    const ground = new Mesh('ground', scene);
    vd.applyToMesh(ground, false);
    const gm = new StandardMaterial('ground-mat', scene);
    gm.diffuseColor = Color3.White(); // multiplied by the vertex colours
    gm.specularColor = Color3.Black();
    gm.backFaceCulling = false; // visible from above regardless of the winding convention
    ground.material = gm;
    ground.receiveShadows = true;
    ground.isPickable = false;
    ground.freezeWorldMatrix();
    this.ground = ground;

    // ---- props + collision
    const propMat = new StandardMaterial('prop-mat', scene);
    propMat.diffuseColor = Color3.White();
    propMat.specularColor = Color3.Black();
    const protos = new Map<PropKind, Mesh>();
    this.props = generateLayout(cfg);
    let n = 0;
    for (const p of this.props) {
      let mesh: Mesh;
      const proto = protos.get(p.kind);
      if (!proto) {
        mesh = BUILDERS[p.kind](propMat);
        protos.set(p.kind, mesh);
      } else {
        mesh = proto.clone(`${p.kind}-${n}`);
      }
      n++;
      const sink = p.kind === 'rock' ? 0.06 * p.scale : 0;
      mesh.position.set(p.x, heightAt(p.x, p.z) - sink, p.z);
      mesh.rotation.y = p.rotY;
      mesh.scaling.setAll(p.scale);
      mesh.receiveShadows = true;
      mesh.freezeWorldMatrix();
      sg.addShadowCaster(mesh);
      this.collision.addCircle(p.x, p.z, p.collisionRadius);
    }
    this.collision.boundsRadius = cfg.playRadius;
  }

  addShadowCaster(mesh: AbstractMesh): void {
    this.shadows.addShadowCaster(mesh);
  }
}
