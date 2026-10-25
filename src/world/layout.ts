import type { WorldConfig } from '../config';

export type PropKind = 'pine' | 'oak' | 'rock' | 'bush';

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  scale: number;
  rotY: number;
  /** Radius (m) of the solid collision circle on the ground plane. */
  collisionRadius: number;
}

/** Collision radius per unit scale. */
export const BASE_COLLISION_RADIUS: Record<PropKind, number> = {
  pine: 0.45,
  oak: 0.5,
  rock: 0.95,
  bush: 0.55,
};

/** Deterministic PRNG so the world is identical on every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A few hand-placed obstacles close to the start so collisions are easy to test straight away. */
const FIXED: Array<[PropKind, number, number, number]> = [
  ['pine', 6.5, 5.5, 1.3],
  ['pine', 8.5, 2.5, 1.1],
  ['oak', -7.5, 4.5, 1.1],
  ['rock', 4.5, -6.5, 1.3],
  ['rock', -5.5, -6.5, 1.0],
  ['rock', 0, 9.5, 1.4],
  ['bush', -3, 7, 1.0],
  ['bush', 7.5, -2, 1.0],
];

export function generateLayout(cfg: WorldConfig): Prop[] {
  const rnd = mulberry32(cfg.seed);
  const props: Prop[] = [];
  const place = (kind: PropKind, x: number, z: number, scale: number): void => {
    props.push({ kind, x, z, scale, rotY: rnd() * Math.PI * 2, collisionRadius: BASE_COLLISION_RADIUS[kind] * scale });
  };
  for (const [k, x, z, s] of FIXED) place(k, x, z, s);

  const margin = 2.5;
  const maxR = cfg.playRadius - margin;
  const tryAdd = (kind: PropKind, scaleMin: number, scaleMax: number): void => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const r = cfg.startClearRadius + Math.sqrt(rnd()) * (maxR - cfg.startClearRadius);
      const a = rnd() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const scale = scaleMin + rnd() * (scaleMax - scaleMin);
      const rad = BASE_COLLISION_RADIUS[kind] * scale;
      if (Math.hypot(x, z) - rad < cfg.startClearRadius) continue;
      if (props.some((p) => Math.hypot(p.x - x, p.z - z) < p.collisionRadius + rad + 1.4)) continue;
      place(kind, x, z, scale);
      return;
    }
  };
  for (let i = 0; i < cfg.treeCount; i++) tryAdd(i % 3 === 2 ? 'oak' : 'pine', 0.9, 1.5);
  for (let i = 0; i < cfg.rockCount; i++) tryAdd('rock', 0.7, 1.6);
  for (let i = 0; i < cfg.bushCount; i++) tryAdd('bush', 0.8, 1.3);
  return props;
}
