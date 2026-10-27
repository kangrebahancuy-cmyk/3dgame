import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  type AbstractMesh,
  type InstancedMesh,
  type Scene,
} from '@babylonjs/core';
import { getItem, type IconShape, type ItemId } from './items';
import type { Pickup, PickupSystem } from './pickups';

interface View {
  readonly pickup: Pickup;
  readonly body: InstancedMesh;
  readonly ring: InstancedMesh;
  readonly phase: number;
}

const BASE_HEIGHT = 0.55;

/**
 * Draws the items lying in the world (Babylon side only; the data lives in PickupSystem). Placeholder shapes, one
 * shared template mesh + material per item type and one InstancedMesh per pickup. Per frame it only rewrites the
 * position/rotation numbers of the few visible pickups: nothing is allocated.
 */
export class PickupView {
  private readonly views = new Map<number, View>();
  private readonly active: View[] = [];
  private readonly templates = new Map<ItemId, Mesh>();
  private readonly ringTemplate: Mesh;
  private time = 0;

  constructor(private readonly scene: Scene, pickups: PickupSystem) {
    const ringMat = new StandardMaterial('pickup-ring-mat', scene);
    ringMat.diffuseColor = Color3.Black();
    ringMat.emissiveColor = new Color3(1, 0.88, 0.4);
    ringMat.specularColor = Color3.Black();
    ringMat.alpha = 0.5;
    ringMat.backFaceCulling = false;
    const ring = MeshBuilder.CreateDisc('pickup-ring', { radius: 0.5, tessellation: 24 }, scene);
    ring.rotation.x = Math.PI / 2; // lie flat on the ground
    ring.bakeCurrentTransformIntoVertices();
    ring.material = ringMat;
    ring.isPickable = false;
    ring.isVisible = false; // the template itself is never drawn; its instances are (setEnabled(false) would hide them too)
    this.ringTemplate = ring;

    pickups.onAdd((p) => this.add(p));
    pickups.onRemove((p) => this.remove(p));
    for (const p of pickups.all()) this.add(p);
  }

  /** Call once per frame with the frame time in seconds. */
  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    for (let i = 0; i < this.active.length; i++) {
      const v = this.active[i];
      v.body.position.y = BASE_HEIGHT + Math.sin(t * 2.2 + v.phase) * 0.08;
      v.body.rotation.y = t * 1.1 + v.phase;
    }
  }

  private add(p: Pickup): void {
    if (this.views.has(p.uid)) return;
    const body = this.template(p.id).createInstance(`pickup-${p.uid}`);
    const ring = this.ringTemplate.createInstance(`pickup-ring-${p.uid}`);
    ring.position.set(p.x, 0.03, p.z);
    body.position.set(p.x, BASE_HEIGHT, p.z);
    for (const m of [body, ring] as AbstractMesh[]) m.isPickable = false;
    ring.freezeWorldMatrix();
    const view: View = { pickup: p, body, ring, phase: (p.uid * 1.7) % 6.28 };
    this.views.set(p.uid, view);
    this.active.push(view);
  }

  private remove(p: Pickup): void {
    const v = this.views.get(p.uid);
    if (!v) return;
    v.body.dispose();
    v.ring.dispose();
    this.views.delete(p.uid);
    const i = this.active.indexOf(v);
    if (i >= 0) this.active.splice(i, 1);
  }

  private template(id: ItemId): Mesh {
    let m = this.templates.get(id);
    if (m) return m;
    const def = getItem(id);
    m = buildShape(def.icon.shape, this.scene);
    m.name = `pickup-template-${id}`;
    const mat = new StandardMaterial(`pickup-mat-${id}`, this.scene);
    const c = Color3.FromHexString(def.icon.color);
    mat.diffuseColor = c;
    mat.emissiveColor = c.scale(0.35); // a little glow so items read well in the shade of the forest
    mat.specularColor = Color3.Black();
    m.material = mat;
    m.isPickable = false;
    m.isVisible = false; // only the instances are drawn
    this.templates.set(id, m);
    return m;
  }
}

/** Simple placeholder geometry, roughly 0.4 m in size, origin at its centre. */
function buildShape(shape: IconShape, scene: Scene): Mesh {
  switch (shape) {
    case 'potion':
      return MeshBuilder.CreateCylinder('p', { height: 0.38, diameterTop: 0.1, diameterBottom: 0.26, tessellation: 12 }, scene);
    case 'sword': {
      const m = MeshBuilder.CreateBox('p', { width: 0.09, height: 0.7, depth: 0.03 }, scene);
      m.rotation.z = Math.PI / 5;
      m.bakeCurrentTransformIntoVertices();
      return m;
    }
    case 'helmet':
      return MeshBuilder.CreateSphere('p', { diameter: 0.4, segments: 8, slice: 0.5 }, scene);
    case 'armor':
      return MeshBuilder.CreateBox('p', { width: 0.42, height: 0.46, depth: 0.2 }, scene);
    case 'boots':
      return MeshBuilder.CreateBox('p', { width: 0.26, height: 0.2, depth: 0.42 }, scene);
    case 'wood': {
      const m = MeshBuilder.CreateCylinder('p', { height: 0.5, diameter: 0.17, tessellation: 10 }, scene);
      m.rotation.z = Math.PI / 2;
      m.bakeCurrentTransformIntoVertices();
      return m;
    }
    case 'stone':
      return MeshBuilder.CreatePolyhedron('p', { type: 2, size: 0.2 }, scene);
  }
}
