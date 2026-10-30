import { Color3, Mesh, MeshBuilder, StandardMaterial, VertexData, type InstancedMesh, type Scene } from '@babylonjs/core';

/**
 * Flat fan / ring geometry on the ground plane (y = 0), centred on the +Z axis so that `rotation.y = yaw` points it
 * along a heading (forward = (sin yaw, cos yaw), the project convention). `inner` = 0 gives a filled sector/disc.
 */
export function buildFan(scene: Scene, name: string, opts: { inner: number; outer: number; arc: number; segments: number }): Mesh {
  const { inner, outer, arc, segments } = opts;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = -arc / 2 + (arc * i) / segments;
    const s = Math.sin(a), c = Math.cos(a);
    positions.push(s * inner, 0, c * inner, s * outer, 0, c * outer);
    if (i > 0) {
      const k = (i - 1) * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
  vd.indices = indices;
  vd.applyToMesh(mesh);
  mesh.isPickable = false;
  return mesh;
}

export function glowMaterial(scene: Scene, name: string, color: Color3, alpha = 1): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.emissiveColor = color;
  m.alpha = alpha;
  m.backFaceCulling = false;
  m.disableLighting = true;
  return m;
}

type ParticleKind = 'hit' | 'crit' | 'hurt' | 'dust';

interface Particle {
  mesh: InstancedMesh;
  vx: number; vy: number; vz: number;
  life: number;
  max: number;
  size: number;
  active: boolean;
  gravity: number;
}

interface Slash {
  mesh: InstancedMesh;
  life: number;
  reach: number;
  active: boolean;
}

const POOL_SIZE: Record<ParticleKind, number> = { hit: 28, crit: 24, hurt: 20, dust: 24 };
const SLASHES = 3;
const SLASH_LIFE = 0.2;

/**
 * Short-lived visual effects: hit sparks, dust puffs and the sweep of a melee swing. Everything is a pooled instance of
 * a few shared template meshes (one pool per kind), so a fight allocates nothing per frame. Templates are never drawn.
 */
export class CombatEffects {
  private readonly templates: Record<ParticleKind, Mesh>;
  private readonly slashTemplate: Mesh;
  private readonly pools: Record<ParticleKind, Particle[]> = { hit: [], crit: [], hurt: [], dust: [] };
  private readonly slashes: Slash[] = [];
  private seed = 1;

  constructor(scene: Scene) {
    const box = (name: string, color: Color3): Mesh => {
      const m = MeshBuilder.CreateBox(name, { size: 0.12 }, scene);
      m.material = glowMaterial(scene, `${name}-mat`, color);
      m.isPickable = false;
      m.isVisible = false; // only the instances are drawn
      return m;
    };
    const dust = MeshBuilder.CreateSphere('fx-dust', { diameter: 0.32, segments: 4 }, scene);
    dust.material = glowMaterial(scene, 'fx-dust-mat', new Color3(0.62, 0.6, 0.52), 0.7);
    dust.isPickable = false;
    dust.isVisible = false;
    this.templates = {
      hit: box('fx-hit', new Color3(1, 0.93, 0.6)),
      crit: box('fx-crit', new Color3(1, 0.55, 0.15)),
      hurt: box('fx-hurt', new Color3(0.95, 0.2, 0.2)),
      dust,
    };
    this.slashTemplate = buildFan(scene, 'fx-slash', { inner: 0.35, outer: 1, arc: 1.9, segments: 14 });
    this.slashTemplate.material = glowMaterial(scene, 'fx-slash-mat', new Color3(1, 1, 0.9), 0.55);
    this.slashTemplate.isVisible = false;

    for (const kind of Object.keys(this.pools) as ParticleKind[]) {
      for (let i = 0; i < POOL_SIZE[kind]; i++) {
        const mesh = this.templates[kind].createInstance(`fx-${kind}-${i}`);
        mesh.isPickable = false;
        mesh.setEnabled(false);
        this.pools[kind].push({ mesh, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, active: false, gravity: 9 });
      }
    }
    for (let i = 0; i < SLASHES; i++) {
      const mesh = this.slashTemplate.createInstance(`fx-s-${i}`);
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.slashes.push({ mesh, life: 0, reach: 1, active: false });
    }
  }

  /** Small deterministic generator: the look of a spark burst needs no real randomness. */
  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private emit(kind: ParticleKind, x: number, y: number, z: number, count: number, speed: number, life: number, size: number, gravity: number): void {
    let made = 0;
    for (const p of this.pools[kind]) {
      if (made >= count) break;
      if (p.active) continue;
      const a = this.rand() * Math.PI * 2;
      const sp = speed * (0.5 + this.rand() * 0.7);
      p.vx = Math.sin(a) * sp;
      p.vz = Math.cos(a) * sp;
      p.vy = (0.4 + this.rand() * 0.9) * speed;
      p.life = p.max = life * (0.7 + this.rand() * 0.5);
      p.size = size;
      p.gravity = gravity;
      p.active = true;
      p.mesh.position.set(x, y, z);
      p.mesh.scaling.setAll(size);
      p.mesh.setEnabled(true);
      made++;
    }
  }

  /** Sparks where a blow lands. `y` is the impact height (m). */
  hit(x: number, y: number, z: number, crit: boolean): void {
    if (crit) this.emit('crit', x, y, z, 12, 4.2, 0.45, 1.5, 9);
    else this.emit('hit', x, y, z, 7, 3, 0.45, 1, 9);
  }

  /** Red sparks when the player is hit. */
  hurt(x: number, y: number, z: number): void {
    this.emit('hurt', x, y, z, 8, 3, 0.5, 1.2, 9);
  }

  /** A dust cloud (monster death). `scale` grows with the monster. */
  puff(x: number, z: number, scale: number): void {
    this.emit('dust', x, 0.3, z, 12, 1.6 * scale, 0.9, 1.4 * scale, -0.8);
  }

  /** The visible sweep of a swing in front of (x, z), `reach` metres long, along `yaw`. */
  slash(x: number, z: number, yaw: number, reach: number): void {
    const s = this.slashes.find((v) => !v.active) ?? this.slashes[0];
    s.active = true;
    s.life = SLASH_LIFE;
    s.reach = reach;
    s.mesh.position.set(x, 0.9, z);
    s.mesh.rotation.y = yaw;
    s.mesh.scaling.set(reach * 0.6, 1, reach * 0.6);
    s.mesh.setEnabled(true);
  }

  update(dt: number): void {
    for (const kind of Object.keys(this.pools) as ParticleKind[]) {
      for (const p of this.pools[kind]) {
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.active = false;
          p.mesh.setEnabled(false);
          continue;
        }
        p.vy -= p.gravity * dt;
        const m = p.mesh;
        m.position.x += p.vx * dt;
        m.position.y = Math.max(0.03, m.position.y + p.vy * dt);
        m.position.z += p.vz * dt;
        m.scaling.setAll(p.size * (p.life / p.max)); // shrinks away instead of fading (instances share one material)
      }
    }
    for (const s of this.slashes) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        s.mesh.setEnabled(false);
        continue;
      }
      const t = 1 - s.life / SLASH_LIFE;
      const k = s.reach * (0.6 + 0.4 * t);
      s.mesh.scaling.set(k, 1, k * (1 - 0.7 * t));
    }
  }

  dispose(): void {
    for (const kind of Object.keys(this.pools) as ParticleKind[]) {
      for (const p of this.pools[kind]) p.mesh.dispose();
      this.pools[kind].length = 0;
    }
    for (const s of this.slashes) s.mesh.dispose();
    for (const t of Object.values(this.templates)) t.dispose();
    this.slashTemplate.dispose();
    this.slashes.length = 0;
  }
}
