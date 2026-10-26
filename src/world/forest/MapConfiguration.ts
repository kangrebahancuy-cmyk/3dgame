/**
 * Data-only description of the first forest map. Everything that decides "where things are" lives here
 * so a future zone (another square map) can be described with the same structure.
 *
 * Coordinates are metres on the ground plane. North = +Z, East = +X, South = -Z, West = -X; the map is a
 * square centred on the origin. The camera looks toward +X/+Z (azimuth 45 deg), so north-east is "up" on screen.
 */
export type CardinalDirection = 'north' | 'south' | 'east' | 'west';

export interface PathDefinition {
  readonly id: string;
  /** Full width of the dirt path in metres. */
  readonly width: number;
  /** Control points (x, z) of a smooth curve (Catmull-Rom); the first point is inside the clearing. */
  readonly points: ReadonlyArray<readonly [number, number]>;
}

/** Placeholder for a future zone transition. Only data + a visual cue here, no transition logic. */
export interface ExitDefinition {
  readonly id: CardinalDirection;
  /** Centre of the opening on the map edge. */
  readonly x: number;
  readonly z: number;
  /** Unit vector pointing out of the map. */
  readonly outward: readonly [number, number];
  readonly width: number;
}

export interface ForestMapConfiguration {
  readonly id: string;
  /** Side length of the walkable square (m). */
  readonly size: number;
  readonly spawn: { readonly x: number; readonly z: number };
  readonly clearing: { readonly x: number; readonly z: number; readonly radius: number };
  readonly paths: readonly PathDefinition[];
  readonly exits: readonly ExitDefinition[];
  readonly seed: number;
  /** Width (m) of the extra, non-walkable forest drawn outside the walkable square. */
  readonly outerForest: number;
  /** Minimum free gap (m) between two solid obstacles so the player can never get wedged between them. */
  readonly minSolidGap: number;
  /** Solids keep at least this distance (m) from a path's edge so paths read clearly and stay open. */
  readonly pathClearance: number;
  /** Half of the side length (m) of the huge plain ground plane under everything (so no edge of the world is ever visible). */
  readonly groundHalf: number;
}

export const FOREST_MAP: ForestMapConfiguration = {
  id: 'forest-1',
  size: 64,
  spawn: { x: 0, z: 0 },
  clearing: { x: 0, z: 0, radius: 7.5 },
  paths: [
    { id: 'south', width: 6.0, points: [[0, 0], [1.5, -8], [-1.2, -16], [0.8, -24], [0, -32]] },
    { id: 'north', width: 3.4, points: [[0, 0], [-1, 8], [1.6, 17], [-0.6, 25], [0, 32]] },
    { id: 'east', width: 4.4, points: [[0, 0], [8, 1], [15, -1.5], [24, 1.5], [32, 0]] },
    { id: 'west', width: 4.6, points: [[0, 0], [-9, -1], [-17, 2], [-25, -1.5], [-32, 0.5]] },
  ],
  exits: [
    { id: 'south', x: 0, z: -32, outward: [0, -1], width: 6.0 },
    { id: 'north', x: 0, z: 32, outward: [0, 1], width: 3.4 },
    { id: 'east', x: 32, z: 0, outward: [1, 0], width: 4.4 },
    { id: 'west', x: -32, z: 0.5, outward: [-1, 0], width: 4.6 },
  ],
  seed: 40417,
  outerForest: 12,
  minSolidGap: 1.6,
  pathClearance: 1.8,
  groundHalf: 96,
};
