import { smoothstep } from '../../math/scalar';
import { mulberry32 } from '../rng';
import type { ForestMapConfiguration } from './MapConfiguration';
import { NATURE_CATALOG } from './NatureCatalog';
import type { NatureAsset, NatureCategory } from './NatureTypes';
import { PathNetwork } from './PathNetwork';

export interface Circle {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

export type PlacedKind =
  | 'tree' | 'outer-tree' | 'rock' | 'rock-small' | 'bush' | 'grass' | 'flower' | 'mushroom'
  | 'log' | 'stump' | 'camp' | 'sign' | 'marker-rock';

export interface PlacedObject {
  /** Key into NATURE_CATALOG (= the GLB file name without ".glb"). */
  readonly assetId: string;
  readonly kind: PlacedKind;
  readonly x: number;
  readonly z: number;
  /** Rotation about +Y in radians (same convention as the player heading: forward = (sin, cos)). */
  readonly yaw: number;
  /** Uniform scale applied to the model's native size. */
  readonly scale: number;
  /** Solid collision circles (empty for purely decorative objects). */
  readonly colliders: readonly Circle[];
}

export interface ForestLayout {
  readonly objects: readonly PlacedObject[];
  /** Every solid circle, flattened (what the CollisionWorld receives). */
  readonly solids: readonly Circle[];
  readonly stats: Readonly<Record<string, number>>;
}

/**
 * World scale per category. Kenney's models are tiny (a tree is ~1.5 units); the character is 1.94 m tall,
 * so everything is scaled up to give the Albion-like proportion of "big trees, small hero".
 */
export const CATEGORY_SCALE: Readonly<Record<NatureCategory, number>> = {
  conifer: 3.6,
  broadleaf: 3.5,
  rock_large: 3.4,
  rock_tall: 2.6,
  rock_small: 2.8,
  bush: 3.0,
  plant: 3.0,
  grass: 2.8,
  flower: 3.2,
  mushroom: 3.0,
  log: 3.0,
  stump: 3.0,
  camp: 3.0,
  sign: 3.0,
};

const CONIFER_TALL = ['tree_pineTallA', 'tree_pineTallB', 'tree_pineTallC', 'tree_pineTallD', 'tree_pineTallA_detailed', 'tree_pineTallB_detailed', 'tree_pineTallC_detailed', 'tree_pineTallD_detailed'];
const CONIFER_ROUND = ['tree_pineRoundA', 'tree_pineRoundB', 'tree_pineRoundC', 'tree_pineRoundD', 'tree_pineRoundE', 'tree_pineRoundF'];
const CONIFER_DEFAULT = ['tree_pineDefaultA', 'tree_pineDefaultB', 'tree_cone', 'tree_cone_dark'];
const CONIFER_SMALL = ['tree_pineSmallA', 'tree_pineSmallB', 'tree_pineSmallC', 'tree_pineSmallD'];
const BROAD_LIGHT = ['tree_default', 'tree_oak', 'tree_thin', 'tree_small', 'tree_simple', 'tree_fat', 'tree_tall', 'tree_detailed'];
const BROAD_DARK = ['tree_default_dark', 'tree_oak_dark', 'tree_detailed_dark', 'tree_tall_dark', 'tree_fat_darkh', 'tree_simple_dark', 'tree_thin_dark'];
const BROAD_FALL = ['tree_default_fall', 'tree_oak_fall', 'tree_detailed_fall', 'tree_thin_fall', 'tree_fat_fall', 'tree_tall_fall', 'tree_cone_fall'];

type GroupName = 'tall' | 'round' | 'default' | 'small' | 'light' | 'dark' | 'fall';
const GROUPS: Record<GroupName, readonly string[]> = {
  tall: CONIFER_TALL, round: CONIFER_ROUND, default: CONIFER_DEFAULT, small: CONIFER_SMALL,
  light: BROAD_LIGHT, dark: BROAD_DARK, fall: BROAD_FALL,
};

/** Species mix per region (weights are relative). North = dark conifer forest, west = light broadleaf, east = autumn mix. */
const REGION_MIX: Record<'north' | 'south' | 'east' | 'west' | 'corner', Partial<Record<GroupName, number>>> = {
  north: { tall: 0.35, round: 0.2, default: 0.1, dark: 0.25, small: 0.1 },
  south: { light: 0.5, dark: 0.1, round: 0.12, default: 0.13, fall: 0.15 },
  east: { light: 0.3, round: 0.15, default: 0.1, fall: 0.28, dark: 0.17 },
  west: { light: 0.68, fall: 0.1, small: 0.12, dark: 0.1 },
  corner: { dark: 0.4, tall: 0.25, round: 0.2, default: 0.15 },
};

const ROCK_LARGE = ['rock_largeA', 'rock_largeB', 'rock_largeC', 'rock_largeD', 'rock_largeE', 'rock_largeF'];
const STONE_LARGE = ['stone_largeA', 'stone_largeB', 'stone_largeC', 'stone_largeD', 'stone_largeE', 'stone_largeF'];
const ROCK_TALL = ['rock_tallA', 'rock_tallB', 'rock_tallC', 'rock_tallD', 'rock_tallE', 'rock_tallF', 'rock_tallG', 'rock_tallH', 'rock_tallI', 'rock_tallJ'];
const STONE_TALL = ['stone_tallA', 'stone_tallB', 'stone_tallC', 'stone_tallD', 'stone_tallE', 'stone_tallF', 'stone_tallG', 'stone_tallH', 'stone_tallI', 'stone_tallJ'];
const ROCK_SMALL = ['rock_smallA', 'rock_smallB', 'rock_smallC', 'rock_smallD', 'rock_smallE', 'rock_smallF', 'rock_smallG', 'rock_smallH', 'rock_smallI', 'rock_smallFlatA', 'rock_smallFlatB', 'rock_smallFlatC', 'rock_smallTopA', 'rock_smallTopB', 'stone_smallA', 'stone_smallB', 'stone_smallC', 'stone_smallD', 'stone_smallE', 'stone_smallF'];
const BUSHES = ['plant_bush', 'plant_bushDetailed', 'plant_bushLarge', 'plant_bushLargeTriangle', 'plant_bushSmall', 'plant_bushTriangle'];
const GRASS = ['grass', 'grass_large', 'grass_leafs', 'grass_leafsLarge', 'plant_flatShort', 'plant_flatTall'];
const FLOWERS = ['flower_purpleA', 'flower_purpleB', 'flower_purpleC', 'flower_redA', 'flower_redB', 'flower_redC', 'flower_yellowA', 'flower_yellowB', 'flower_yellowC'];
const MUSHROOMS = ['mushroom_red', 'mushroom_redGroup', 'mushroom_redTall', 'mushroom_tan', 'mushroom_tanGroup', 'mushroom_tanTall'];
const LOGS = ['log', 'log_large', 'stump_old', 'stump_oldTall', 'stump_round', 'stump_roundDetailed', 'stump_square', 'stump_squareDetailed'];

type Catalog = Readonly<Record<string, NatureAsset>>;
type Rnd = () => number;

function hash2(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}
function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smoothstep(x - ix), fz = smoothstep(z - iz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Rotates a model-space horizontal offset by the object's yaw (forward = (sin yaw, cos yaw)). */
function rotate(ox: number, oz: number, yaw: number): [number, number] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [ox * c + oz * s, -ox * s + oz * c];
}

/** Region weights in [0, 1], smooth so densities blend instead of changing at hard borders. */
function regionWeights(x: number, z: number): { n: number; s: number; e: number; w: number; corner: number } {
  return {
    n: smoothstep((z - 4) / 16),
    s: smoothstep((-z - 4) / 16),
    e: smoothstep((x - 4) / 16),
    w: smoothstep((-x - 4) / 16),
    corner: smoothstep((Math.abs(x) + Math.abs(z) - 36) / 16),
  };
}

/** Target distance between neighbouring trees at (x, z): small = dense forest, large = light vegetation. */
function treeSpacing(x: number, z: number, half: number): number {
  const r = regionWeights(x, z);
  let s = 4.6;
  s += r.n * (2.9 - 4.6) + r.w * (7.4 - 4.6) + r.s * 0.2 + r.e * (4.2 - 4.6);
  s *= 1 - 0.25 * r.corner;
  if (Math.max(Math.abs(x), Math.abs(z)) > half - 5) s = Math.min(s, 3.1); // dense wall of trees along the edge
  return s;
}

function pickWeighted<T>(items: ReadonlyArray<readonly [T, number]>, rnd: Rnd): T {
  let total = 0;
  for (const [, w] of items) total += w;
  let t = rnd() * total;
  for (const [v, w] of items) {
    t -= w;
    if (t <= 0) return v;
  }
  return items[items.length - 1][0];
}

function pickTreeId(x: number, z: number, rnd: Rnd): string {
  const r = regionWeights(x, z);
  const weights: Record<string, number> = {};
  const add = (mix: Partial<Record<GroupName, number>>, k: number): void => {
    for (const [g, w] of Object.entries(mix)) weights[g] = (weights[g] ?? 0) + (w ?? 0) * k;
  };
  add(REGION_MIX.north, r.n);
  add(REGION_MIX.south, r.s);
  add(REGION_MIX.east, r.e);
  add(REGION_MIX.west, r.w);
  add(REGION_MIX.corner, r.corner * 1.5);
  if (Object.keys(weights).length === 0) add(REGION_MIX.south, 1);
  const group = pickWeighted(Object.entries(weights) as Array<[GroupName, number]>, rnd);
  const list = GROUPS[group];
  return list[Math.floor(rnd() * list.length)];
}

/** Collision circles for the TRUNK of a tree (never the canopy). */
function trunkCollider(a: NatureAsset, x: number, z: number, yaw: number, scale: number): Circle {
  const tc = a.trunkCenter ?? a.center;
  const [ox, oz] = rotate(tc[0] * scale, tc[1] * scale, yaw);
  const tr = a.trunkRadius ?? 0.1;
  return { x: x + ox, z: z + oz, r: Math.max(0.22, tr * scale * 0.95) };
}

/** One circle for a roundish footprint, two for an elongated one; sized slightly inside the visible hull. */
function footprintColliders(a: NatureAsset, x: number, z: number, yaw: number, scale: number): Circle[] {
  const w = a.size[0] * scale, d = a.size[2] * scale;
  const [cx, cz] = rotate(a.center[0] * scale, a.center[1] * scale, yaw);
  const long = Math.max(w, d), short = Math.min(w, d);
  if (long / short < 1.5) return [{ x: x + cx, z: z + cz, r: Math.max(0.3, 0.4 * (w + d) / 2) }];
  const r = Math.max(0.3, 0.44 * short);
  const off = (long / 2 - r) * 0.85;
  const axis: [number, number] = w >= d ? [1, 0] : [0, 1];
  const [ax, az] = rotate(axis[0] * off, axis[1] * off, yaw);
  return [
    { x: x + cx + ax, z: z + cz + az, r },
    { x: x + cx - ax, z: z + cz - az, r },
  ];
}

export function generateForestLayout(map: ForestMapConfiguration, catalog: Catalog = NATURE_CATALOG): ForestLayout {
  const half = map.size / 2;
  const net = new PathNetwork(map.paths);
  const objects: PlacedObject[] = [];
  const solids: Circle[] = [];
  const { clearing } = map;

  const asset = (id: string): NatureAsset => {
    const a = catalog[id];
    if (!a) throw new Error(`ForestLayout references "${id}", which is not in the verified Nature catalog`);
    return a;
  };
  const baseScale = (id: string): number => CATEGORY_SCALE[asset(id).category];
  const inClearing = (x: number, z: number, pad: number): boolean =>
    Math.hypot(x - clearing.x, z - clearing.z) < clearing.radius + pad;
  const fitsSolids = (cs: readonly Circle[], gap: number): boolean => {
    for (const c of cs) for (const s of solids) if (Math.hypot(c.x - s.x, c.z - s.z) < c.r + s.r + gap) return false;
    return true;
  };
  const inside = (c: Circle, margin: number): boolean => Math.abs(c.x) <= half - margin && Math.abs(c.z) <= half - margin;
  const commit = (o: PlacedObject): void => {
    objects.push(o);
    solids.push(...o.colliders);
  };
  const decor = (id: string, kind: PlacedKind, x: number, z: number, yaw: number, scale: number): void => {
    objects.push({ assetId: id, kind, x, z, yaw, scale, colliders: [] });
  };
  /** A decorative object is kept off trunks/rocks, off path cores, and out of the central spawn area. */
  const decorOk = (x: number, z: number, radius: number, pathPad: number): boolean =>
    Math.abs(x) <= half - 0.3 && Math.abs(z) <= half - 0.3 &&
    net.edgeDistance(x, z) >= pathPad &&
    fitsSolids([{ x, z, r: radius }], 0.15);

  // ------------------------------------------------------------------ 1. exit markers (placed first so they own their space)
  {
    const rnd = mulberry32(map.seed + 1);
    for (const e of map.exits) {
      const [ox, oz] = e.outward;
      const lx = -oz, lz = ox; // lateral unit vector
      const along = (d: number, lat: number): [number, number] => [e.x - ox * d + lx * lat, e.z - oz * d + lz * lat];
      for (const side of [-1, 1]) {
        const id = pickWeighted<string>([['stone_tallA', 1], ['stone_tallC', 1], ['rock_tallB', 1], ['rock_tallE', 1], ['stone_tallG', 1]], rnd);
        const a = asset(id);
        const scale = baseScale(id) * (0.95 + rnd() * 0.25);
        const [x, z] = along(1.6, side * (e.width / 2 + 2.1));
        const yaw = rnd() * Math.PI * 2;
        commit({ assetId: id, kind: 'marker-rock', x, z, yaw, scale, colliders: footprintColliders(a, x, z, yaw, scale) });
      }
      // The sign stands beside the path (which wanders), 4.5 m before its end, facing back into the map.
      const cl = net.centreLine(e.id);
      const last = cl.xs.length - 1;
      let k = last;
      while (k > 0 && Math.hypot(cl.xs[k] - cl.xs[last], cl.zs[k] - cl.zs[last]) < 4.5) k--;
      const tx = cl.xs[Math.min(k + 1, last)] - cl.xs[Math.max(k - 1, 0)], tz = cl.zs[Math.min(k + 1, last)] - cl.zs[Math.max(k - 1, 0)];
      const tl = Math.hypot(tx, tz) || 1;
      const sx = cl.xs[k] - (tz / tl) * (cl.halfWidth + 0.9), sz = cl.zs[k] + (tx / tl) * (cl.halfWidth + 0.9);
      const yaw = Math.atan2(-ox, -oz);
      const a = asset('sign');
      commit({ assetId: 'sign', kind: 'sign', x: sx, z: sz, yaw, scale: baseScale('sign'), colliders: [{ x: sx, z: sz, r: Math.max(0.2, 0.3 * a.size[0] * baseScale('sign')) }] });
    }
  }

  // ------------------------------------------------------------------ 2. campfire + log seats in the clearing
  {
    const rnd = mulberry32(map.seed + 2);
    const cx = clearing.x + 4.2, cz = clearing.z + 4.2;
    const a = asset('campfire_stones');
    const sc = baseScale('campfire_stones') * 1.1;
    commit({ assetId: 'campfire_stones', kind: 'camp', x: cx, z: cz, yaw: rnd() * 6.28, scale: sc,
      colliders: [{ x: cx, z: cz, r: Math.max(0.45, 0.4 * (a.size[0] + a.size[2]) / 2 * sc) }] });
    for (let i = 0; i < 3; i++) {
      const ang = 0.9 + i * 2.0 + rnd() * 0.3;
      const rr = 2.3;
      decor(i === 1 ? 'log_large' : 'log', 'log', cx + Math.cos(ang) * rr, cz + Math.sin(ang) * rr, -ang + Math.PI / 2 + (rnd() - 0.5) * 0.3, baseScale('log') * 0.9);
    }
  }

  // ------------------------------------------------------------------ 3. trees (variable-density Poisson sampling)
  const treeSpacingAt: number[] = [];
  const treeCentres: Circle[] = [];
  {
    const rnd = mulberry32(map.seed + 3);
    const pickRnd = mulberry32(map.seed + 33);
    const limit = half - 0.9;
    for (let attempt = 0; attempt < 40000; attempt++) {
      const x = (rnd() * 2 - 1) * limit;
      const z = (rnd() * 2 - 1) * limit;
      const edgeBand = Math.max(Math.abs(x), Math.abs(z)) > half - 5;
      if (!edgeBand && valueNoise(x * 0.085 + 11, z * 0.085 - 7) > 0.8) continue; // natural glades in the forest
      const id = pickTreeId(x, z, pickRnd);
      const a = asset(id);
      const scale = baseScale(id) * (0.82 + rnd() * 0.5);
      const canopyHalf = 0.5 * Math.max(a.size[0], a.size[2]) * scale;
      if (net.edgeDistance(x, z) < map.pathClearance + canopyHalf * 0.55) continue; // keep the paths open
      if (inClearing(x, z, 1.8 + canopyHalf * 0.5)) continue; // keep the clearing open
      const yaw = rnd() * Math.PI * 2;
      const col = trunkCollider(a, x, z, yaw, scale);
      if (!inside(col, 0.2)) continue;
      const sp = treeSpacing(x, z, half);
      let ok = fitsSolids([col], map.minSolidGap);
      for (let i = 0; ok && i < treeCentres.length; i++) {
        const t = treeCentres[i];
        if (Math.hypot(x - t.x, z - t.z) < 0.5 * (sp + treeSpacingAt[i])) ok = false;
      }
      if (!ok) continue;
      treeSpacingAt.push(sp);
      treeCentres.push({ x, z, r: col.r });
      commit({ assetId: id, kind: 'tree', x, z, yaw, scale, colliders: [col] });
    }
  }

  // ------------------------------------------------------------------ 4. rock clusters (large solid rocks + small decorative ones)
  {
    const rnd = mulberry32(map.seed + 4);
    const centres: Array<[number, number]> = [];
    const east = net.centreLine('east');
    for (const t of [0.3, 0.45, 0.62, 0.78]) {
      const i = Math.floor(t * (east.xs.length - 1));
      const side = rnd() < 0.5 ? -1 : 1;
      centres.push([east.xs[i] + 0, east.zs[i] + side * (east.halfWidth + 3 + rnd() * 3)]);
    }
    centres.push([-24, 21], [25, -22], [-23, -24], [24, 23], [-11, 14], [13, -13], [-5, -26]);
    for (const [cx, cz] of centres) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const x = cx + (rnd() - 0.5) * 5, z = cz + (rnd() - 0.5) * 5;
        const id = pickWeighted<string>([
          ...ROCK_LARGE.map((r) => [r, 1] as const), ...STONE_LARGE.map((r) => [r, 0.5] as const),
          ...ROCK_TALL.map((r) => [r, 0.8] as const), ...STONE_TALL.map((r) => [r, 0.4] as const),
        ], rnd);
        const a = asset(id);
        const scale = baseScale(id) * (0.8 + rnd() * 0.5);
        const yaw = rnd() * Math.PI * 2;
        const cols = footprintColliders(a, x, z, yaw, scale);
        const ext = Math.max(a.size[0], a.size[2]) * scale * 0.5;
        if (net.edgeDistance(x, z) < map.pathClearance + ext * 0.6 || inClearing(x, z, 1.5 + ext)) continue;
        if (!cols.every((c) => inside(c, 0.3)) || !fitsSolids(cols, map.minSolidGap)) continue;
        commit({ assetId: id, kind: 'rock', x, z, yaw, scale, colliders: cols });
        const n = 2 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const ang = rnd() * Math.PI * 2, rr = ext + 0.5 + rnd() * 1.8;
          const sx = x + Math.cos(ang) * rr, sz = z + Math.sin(ang) * rr;
          const sid = ROCK_SMALL[Math.floor(rnd() * ROCK_SMALL.length)];
          if (decorOk(sx, sz, 0.3, 0.5)) decor(sid, 'rock-small', sx, sz, rnd() * 6.28, baseScale(sid) * (0.7 + rnd() * 0.6));
        }
        break;
      }
    }
  }

  // ------------------------------------------------------------------ 5. undergrowth: bushes, mushrooms, logs, flowers, grass
  {
    const rnd = mulberry32(map.seed + 5);
    // bushes around tree trunks
    for (const o of objects.filter((q) => q.kind === 'tree')) {
      if (rnd() > 0.5) continue;
      const n = 1 + (rnd() < 0.35 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const ang = rnd() * Math.PI * 2, rr = o.colliders[0].r + 0.9 + rnd() * 1.8;
        const x = o.x + Math.cos(ang) * rr, z = o.z + Math.sin(ang) * rr;
        const id = BUSHES[Math.floor(rnd() * BUSHES.length)];
        if (decorOk(x, z, 0.45, 0.9) && !inClearing(x, z, 0.5)) decor(id, 'bush', x, z, rnd() * 6.28, baseScale(id) * (0.8 + rnd() * 0.7));
      }
    }
    // bushes lining the paths
    for (const pid of net.ids) {
      const cl = net.centreLine(pid);
      for (let i = 6; i < cl.xs.length - 2; i += 5 + Math.floor(rnd() * 5)) {
        if (rnd() > 0.55) continue;
        const dx = cl.xs[i + 1] - cl.xs[i], dz = cl.zs[i + 1] - cl.zs[i];
        const l = Math.hypot(dx, dz) || 1;
        const side = rnd() < 0.5 ? -1 : 1;
        const off = cl.halfWidth + 0.7 + rnd() * 1.3;
        const x = cl.xs[i] - (dz / l) * side * off, z = cl.zs[i] + (dx / l) * side * off;
        const id = BUSHES[Math.floor(rnd() * BUSHES.length)];
        if (decorOk(x, z, 0.45, 0.5) && !inClearing(x, z, 0.5)) decor(id, 'bush', x, z, rnd() * 6.28, baseScale(id) * (0.7 + rnd() * 0.6));
      }
    }
    // mushrooms at the foot of northern trees
    for (const o of objects.filter((q) => q.kind === 'tree' && q.z > 8)) {
      if (rnd() > 0.16) continue;
      const ang = rnd() * Math.PI * 2, rr = o.colliders[0].r + 0.45 + rnd() * 0.6;
      const x = o.x + Math.cos(ang) * rr, z = o.z + Math.sin(ang) * rr;
      const id = MUSHROOMS[Math.floor(rnd() * MUSHROOMS.length)];
      if (decorOk(x, z, 0.2, 0.8)) decor(id, 'mushroom', x, z, rnd() * 6.28, baseScale(id) * (0.8 + rnd() * 0.5));
    }
    // logs and stumps beside the paths and around the clearing
    for (let n = 0, attempt = 0; n < 14 && attempt < 400; attempt++) {
      const x = (rnd() * 2 - 1) * (half - 2), z = (rnd() * 2 - 1) * (half - 2);
      const ed = net.edgeDistance(x, z);
      const ring = Math.hypot(x - clearing.x, z - clearing.z) - clearing.radius;
      if (!((ed > 0.9 && ed < 4.5) || (ring > -1.2 && ring < 1.2 && ed > 0.9))) continue;
      const id = LOGS[Math.floor(rnd() * LOGS.length)];
      if (!decorOk(x, z, 0.7, 0.8)) continue;
      decor(id, id.startsWith('log') ? 'log' : 'stump', x, z, rnd() * 6.28, baseScale(id) * (0.8 + rnd() * 0.4));
      n++;
    }
    // flowers: a ring in the clearing, meadow patches in the open west, a few elsewhere
    const flower = (x: number, z: number): void => {
      const id = FLOWERS[Math.floor(rnd() * FLOWERS.length)];
      if (decorOk(x, z, 0.2, 0.7) && Math.hypot(x - clearing.x, z - clearing.z) > 2.5) decor(id, 'flower', x, z, rnd() * 6.28, baseScale(id) * (0.8 + rnd() * 0.5));
    };
    for (let i = 0; i < 26; i++) {
      const ang = rnd() * Math.PI * 2, rr = clearing.radius - 2.4 + rnd() * 2.6;
      flower(clearing.x + Math.cos(ang) * rr, clearing.z + Math.sin(ang) * rr);
    }
    for (let p = 0; p < 9; p++) {
      const cx = -(9 + rnd() * 21), cz = (rnd() * 2 - 1) * 22;
      for (let k = 0; k < 4 + Math.floor(rnd() * 5); k++) flower(cx + (rnd() - 0.5) * 3.6, cz + (rnd() - 0.5) * 3.6);
    }
    for (let i = 0; i < 28; i++) flower((rnd() * 2 - 1) * (half - 2), (rnd() * 2 - 1) * (half - 2));
    // grass tufts, denser in the open west and along path verges
    for (let n = 0, attempt = 0; n < 420 && attempt < 4000; attempt++) {
      const x = (rnd() * 2 - 1) * (half - 0.6), z = (rnd() * 2 - 1) * (half - 0.6);
      const w = regionWeights(x, z);
      const ed = net.edgeDistance(x, z);
      const p = 0.35 + 0.5 * w.w + (ed > 0 && ed < 2.5 ? 0.3 : 0);
      if (rnd() > p || ed < 0.3 || Math.hypot(x - clearing.x, z - clearing.z) < 3) continue;
      const id = GRASS[Math.floor(rnd() * GRASS.length)];
      if (!decorOk(x, z, 0.3, 0.3)) continue;
      decor(id, 'grass', x, z, rnd() * 6.28, baseScale(id) * (0.7 + rnd() * 0.7));
      n++;
    }
  }

  // ------------------------------------------------------------------ 6. outer forest (visual only, outside the walkable square)
  {
    const rnd = mulberry32(map.seed + 6);
    const pickRnd = mulberry32(map.seed + 66);
    const placed: Circle[] = [];
    const outer = half + map.outerForest;
    for (let attempt = 0; attempt < 5000; attempt++) {
      const x = (rnd() * 2 - 1) * outer, z = (rnd() * 2 - 1) * outer;
      if (Math.abs(x) < half + 0.8 && Math.abs(z) < half + 0.8) continue;
      let blocked = false;
      for (const e of map.exits) {
        const lat = Math.abs((x - e.x) * -e.outward[1] + (z - e.z) * e.outward[0]);
        const out = (x - e.x) * e.outward[0] + (z - e.z) * e.outward[1];
        if (out > -3 && lat < e.width / 2 + 2.2) blocked = true;
      }
      if (blocked) continue;
      const id = pickTreeId(x * 1.2, z * 1.2, pickRnd);
      asset(id); // validates the id
      const scale = baseScale(id) * (0.85 + rnd() * 0.55);
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 3.4)) continue;
      placed.push({ x, z, r: 0 });
      decor(id, 'outer-tree', x, z, rnd() * 6.28, scale);
    }
  }

  const stats: Record<string, number> = { objects: objects.length, solids: solids.length };
  for (const o of objects) stats[o.kind] = (stats[o.kind] ?? 0) + 1;
  return { objects, solids, stats };
}

/** Dark leaf-litter patches for the ground painter: under every tree trunk and large rock. */
export function groundMarks(layout: ForestLayout, catalog: Catalog = NATURE_CATALOG): Array<{ x: number; z: number; radius: number }> {
  const out: Array<{ x: number; z: number; radius: number }> = [];
  for (const o of layout.objects) {
    if (o.kind !== 'tree' && o.kind !== 'rock' && o.kind !== 'marker-rock') continue;
    const a = catalog[o.assetId];
    out.push({ x: o.x, z: o.z, radius: Math.max(0.9, 0.55 * 0.5 * Math.max(a.size[0], a.size[2]) * o.scale + 0.5) });
  }
  return out;
}
