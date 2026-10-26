/** All tunable gameplay parameters live here. Angles are in degrees unless the name says rad. */

export interface MovementConfig {
  /** Walking speed in m/s (hold Shift). */
  walkSpeed: number;
  /** Running speed in m/s (default). */
  runSpeed: number;
  /** Exponential smoothing rate (1/s) while input is held. Higher = snappier start. */
  accelLambda: number;
  /** Exponential smoothing rate (1/s) after release. Higher = shorter stop. */
  decelLambda: number;
  /** Below this speed (m/s) with no input the character snaps to rest: no endless creeping. */
  stopSpeed: number;
  /** Exponential smoothing rate (1/s) of the facing direction. */
  turnLambda: number;
  /** Hard cap on turn speed (rad/s). */
  maxTurnRate: number;
  /** Collision radius of the player on the ground plane (m). */
  playerRadius: number;
  /** Frame time is clamped to this (s) so a tab switch can never launch the character. */
  maxFrameTime: number;
  /** A movement sub-step never exceeds this distance (m); keeps collision exact at any frame rate. */
  maxStepDistance: number;
}

export interface CameraConfig {
  /** Compass direction the camera looks toward, as a yaw (0 = +Z, 90 = +X). */
  azimuthDeg: number;
  /** Angle of the view ray below the horizon. */
  elevationDeg: number;
  distance: number;
  minDistance: number;
  maxDistance: number;
  fovDeg: number;
  /** Exponential smoothing rate (1/s) of the follow point. Lower = floatier. */
  followLambda: number;
  zoomLambda: number;
  /** The camera looks at a point this high above the character's feet (m). */
  focusHeight: number;
  /** The camera never goes closer than this to the terrain (m). */
  minClearance: number;
}

export interface WorldConfig {
  seed: number;
  /** Radius (m) of the walkable play area. */
  playRadius: number;
  /** Side length (m) of the square ground mesh. */
  groundSize: number;
  groundSegments: number;
  /** Radius (m) around the origin kept free of random props. */
  startClearRadius: number;
  treeCount: number;
  rockCount: number;
  bushCount: number;
  shadowMapSize: number;
}

export interface CharacterConfig {
  modelUrl: string;
  /** Extra yaw (rad) added on top of the auto-detected model forward correction. */
  yawOffsetRad: number;
  /** Extra vertical offset (m) if a different model has a baked-in ground gap. */
  groundOffset: number;
  /** Rate (1/s) at which animation blend weights follow their targets. */
  blendLambda: number;
  /** Rate (1/s) at which the speed that drives animation follows the real speed. */
  animSpeedLambda: number;
  /** Speed (as a fraction of walkSpeed) at which idle has fully blended into walk. */
  idleToWalkFraction: number;
}

export interface GameConfig {
  movement: MovementConfig;
  camera: CameraConfig;
  world: WorldConfig;
  character: CharacterConfig;
}

export const DEFAULT_CONFIG: GameConfig = {
  movement: {
    walkSpeed: 1.7,
    runSpeed: 4.2,
    accelLambda: 11,
    decelLambda: 13,
    stopSpeed: 0.06,
    turnLambda: 14,
    maxTurnRate: 14,
    playerRadius: 0.38,
    maxFrameTime: 0.05,
    maxStepDistance: 0.12,
  },
  camera: {
    azimuthDeg: 45,
    elevationDeg: 50,
    distance: 19,
    minDistance: 9,
    maxDistance: 30,
    fovDeg: 36,
    followLambda: 7,
    zoomLambda: 9,
    focusHeight: 1.0,
    minClearance: 1.5,
  },
  world: {
    seed: 20260,
    playRadius: 34,
    groundSize: 180,
    groundSegments: 180,
    startClearRadius: 5,
    treeCount: 26,
    rockCount: 14,
    bushCount: 22,
    shadowMapSize: 2048,
  },
  character: {
    modelUrl: 'models/hero.glb',
    yawOffsetRad: 0,
    groundOffset: 0,
    blendLambda: 16,
    animSpeedLambda: 14,
    idleToWalkFraction: 0.35,
  },
};
