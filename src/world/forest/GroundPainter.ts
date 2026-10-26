import { smoothstep } from '../../math/scalar';
import { mulberry32 } from '../rng';
import type { ForestMapConfiguration } from './MapConfiguration';
import type { PathNetwork } from './PathNetwork';

/** Anything the painter needs to know about a placed object: where it is and how wide its shadow/litter patch is. */
export interface GroundMark {
  readonly x: number;
  readonly z: number;
  /** Radius (m) of the darkened leaf-litter patch under the object. */
  readonly radius: number;
}

/** Side length (m) of the square the painted texture covers; a little larger than the walkable map so edges blend. */
export function paintedSize(map: ForestMapConfiguration): number {
  return map.size + 32;
}

/**
 * World (x, z) -> pixel. +X is to the right and +Z (north) is UP in the image. The ground quad's UVs are set up
 * so that the texture appears on the ground exactly like this when looked at from above with +Z up.
 */
export function worldToPixel(map: ForestMapConfiguration, pixels: number, x: number, z: number): [number, number] {
  const s = paintedSize(map);
  return [((x + s / 2) / s) * pixels, ((s / 2 - z) / s) * pixels];
}

/**
 * Texture coordinates of a world point on the painted ground. Babylon uploads a DynamicTexture with invertY = true, so
 * the canvas' top row is v = 1: v = 1 - pixelY / pixels. Used for the ground quad's corners, so painter and mesh
 * cannot disagree about which way is north.
 */
export function groundUv(map: ForestMapConfiguration, x: number, z: number): [number, number] {
  const s = paintedSize(map);
  return [(x + s / 2) / s, (z + s / 2) / s];
}

type Ctx = CanvasRenderingContext2D;

const rgb = (r: number, g: number, b: number, a = 1): string => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

/** Soft round blob (radial gradient) - the building block for grass variation, litter and dirt wear. */
function blob(ctx: Ctx, px: number, py: number, r: number, color: [number, number, number], alpha: number): void {
  const g = ctx.createRadialGradient(px, py, 0, px, py, r);
  g.addColorStop(0, rgb(color[0], color[1], color[2], alpha));
  g.addColorStop(1, rgb(color[0], color[1], color[2], 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Flat-topped soft disc: full colour out to `solid` (0..1 of the radius), then fading to nothing at the rim. */
function disc(ctx: Ctx, px: number, py: number, r: number, color: [number, number, number], alpha: number, solid = 0.7): void {
  const g = ctx.createRadialGradient(px, py, 0, px, py, r);
  g.addColorStop(0, rgb(color[0], color[1], color[2], alpha));
  g.addColorStop(solid, rgb(color[0], color[1], color[2], alpha));
  g.addColorStop(1, rgb(color[0], color[1], color[2], 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Paints the whole forest floor into a canvas: grass with large-scale tint variation per region, dirt paths
 * (taken from the same PathNetwork that keeps obstacles off them), the worn spawn clearing, and dark leaf litter
 * under trees and rocks. Deterministic (seeded) and runs once at load - nothing here runs per frame.
 */
export function paintGround(
  ctx: Ctx,
  pixels: number,
  map: ForestMapConfiguration,
  net: PathNetwork,
  marks: readonly GroundMark[],
): void {
  const rnd = mulberry32(map.seed + 100);
  const ppm = pixels / paintedSize(map);
  const P = (x: number, z: number): [number, number] => worldToPixel(map, pixels, x, z);

  // ---- base grass
  ctx.fillStyle = rgb(88, 128, 58);
  ctx.fillRect(0, 0, pixels, pixels);

  // ---- region tint: darker, bluer forest floor in the north, sunny meadow in the west, warm leaf-fall in the east
  const tintBlobs = 420;
  for (let i = 0; i < tintBlobs; i++) {
    const x = (rnd() * 2 - 1) * (map.size / 2 + 6), z = (rnd() * 2 - 1) * (map.size / 2 + 6);
    const [px, py] = P(x, z);
    const north = smoothstep((z - 2) / 24), west = smoothstep((-x - 2) / 24), east = smoothstep((x - 2) / 24);
    const r = (2.5 + rnd() * 5) * ppm;
    const k = rnd();
    if (k < 0.34) blob(ctx, px, py, r, [58 - 14 * north, 96 - 18 * north, 44 - 10 * north], 0.5);
    else if (k < 0.62) blob(ctx, px, py, r, [112 + 28 * west, 150 + 22 * west, 66 + 4 * west], 0.28 + 0.3 * west);
    else if (k < 0.8) blob(ctx, px, py, r, [128 + 20 * east, 108, 56], 0.1 + 0.28 * east);
    else blob(ctx, px, py, r * 0.6, [100, 140, 64], 0.35);
  }

  // ---- fine grass speckle (thousands of tiny strokes -> reads as turf at the camera distance)
  const specks = 26000;
  for (let i = 0; i < specks; i++) {
    const x = (rnd() * 2 - 1) * (paintedSize(map) / 2), z = (rnd() * 2 - 1) * (paintedSize(map) / 2);
    const [px, py] = P(x, z);
    const v = rnd();
    ctx.fillStyle = v < 0.5 ? rgb(60 + rnd() * 24, 100 + rnd() * 28, 40 + rnd() * 16, 0.5) : rgb(120 + rnd() * 30, 160 + rnd() * 26, 70 + rnd() * 20, 0.4);
    const w = (0.04 + rnd() * 0.06) * ppm, h = (0.12 + rnd() * 0.16) * ppm;
    ctx.fillRect(px, py, Math.max(1, w), Math.max(1.5, h));
  }

  // ---- leaf litter / shade under trees and rocks
  for (const m of marks) {
    const [px, py] = P(m.x, m.z);
    blob(ctx, px, py, m.radius * ppm, [34, 52, 26], 0.42);
  }

  // ---- spawn clearing: lighter, trampled grass over the whole clearing (this is where no tree may stand)
  {
    const c = map.clearing;
    const [px, py] = P(c.x, c.z);
    disc(ctx, px, py, (c.radius + 1.2) * ppm, [128, 158, 84], 0.7, 0.8);
  }

  // ---- dirt paths. Drawn as overlapping stamps along the shared centre lines (organic, slightly scalloped edges),
  // one layer for ALL paths at a time so crossings merge cleanly instead of one path's rim cutting across another.
  const layers: Array<{ grow: number; color: [number, number, number]; alpha: number; wobble: number }> = [
    { grow: 0.9, color: [112, 100, 60], alpha: 0.5, wobble: 0.3 }, // grassy fringe
    { grow: 0.28, color: [100, 78, 50], alpha: 1, wobble: 0.16 }, // dark rim
    { grow: -0.12, color: [152, 122, 84], alpha: 1, wobble: 0.1 }, // dirt body
  ];
  for (const layer of layers) {
    for (const id of net.ids) {
      const cl = net.centreLine(id);
      for (let i = 0; i < cl.xs.length; i++) {
        const wob = layer.wobble * (Math.sin(i * 0.71 + id.length) * 0.6 + Math.sin(i * 1.93 + 1.7) * 0.4);
        const [px, py] = P(cl.xs[i], cl.zs[i]);
        const r = (cl.halfWidth + layer.grow + wob) * ppm;
        ctx.fillStyle = rgb(layer.color[0], layer.color[1], layer.color[2], layer.alpha);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // worn middle of each path, then the packed-earth heart of the clearing
  for (const id of net.ids) {
    const cl = net.centreLine(id);
    for (let i = 0; i < cl.xs.length; i++) {
      const [px, py] = P(cl.xs[i], cl.zs[i]);
      disc(ctx, px, py, cl.halfWidth * 0.62 * ppm, [168, 138, 98], 0.35, 0.5);
    }
  }
  {
    const c = map.clearing;
    const [px, py] = P(c.x, c.z);
    disc(ctx, px, py, 3.4 * ppm, [158, 130, 90], 0.9, 0.55);
    disc(ctx, px, py, 1.9 * ppm, [170, 142, 100], 0.6, 0.5);
  }

  // path surface texture: pebbles and darker ruts, only where the path is
  for (const id of net.ids) {
    const cl = net.centreLine(id);
    for (let i = 0; i < cl.xs.length; i++) {
      for (let k = 0; k < 7; k++) {
        const ang = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * (cl.halfWidth - 0.2);
        const [px, py] = P(cl.xs[i] + Math.cos(ang) * rr, cl.zs[i] + Math.sin(ang) * rr);
        ctx.fillStyle = rnd() < 0.5 ? rgb(120, 98, 70, 0.55) : rgb(184, 160, 124, 0.55);
        const s = (0.03 + rnd() * 0.07) * ppm;
        ctx.fillRect(px, py, Math.max(1, s), Math.max(1, s));
      }
    }
  }

  // ---- exits: a faint lighter threshold so the edge of the map reads as "a way out"
  for (const e of map.exits) {
    const [px, py] = P(e.x - e.outward[0] * 1.5, e.z - e.outward[1] * 1.5);
    blob(ctx, px, py, (e.width * 0.9) * ppm, [190, 170, 120], 0.35);
  }
}
