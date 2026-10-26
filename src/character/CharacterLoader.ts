import {
  AbstractMesh,
  Color3,
  PBRMaterial,
  Quaternion,
  SceneLoader,
  TransformNode,
  Vector3,
  type ISceneLoaderProgressEvent,
  type Scene,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import type { CharacterConfig } from '../config';
import type { BoneRest, ClipData, LocomotionClips, TrackData } from './AnimationBlender';

/** Thrown for every character-loading failure; `message` is written for the player, `cause` for the console. */
export class CharacterLoadError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'CharacterLoadError';
  }
}

export interface LoadedCharacter {
  /** Parent this node to move/rotate the whole character. Its origin is on the ground between the feet. */
  readonly root: TransformNode;
  /** Meshes that should cast shadows. */
  readonly meshes: AbstractMesh[];
  /** Rig bones in the order used by `rest` and the clip tracks. */
  readonly bones: TransformNode[];
  readonly rest: BoneRest[];
  readonly clips: LocomotionClips;
  /** Model height in metres (bind pose). */
  readonly height: number;
  /** Rotation (rad) applied to the model so that it faces +Z at yaw 0. */
  readonly forwardCorrection: number;
  dispose(): void;
}

interface ClipMeta {
  distancePerCycle: number;
}

const REQUIRED_CLIPS = ['Idle', 'Walk', 'Run'] as const;

/** Resolves a path against Vite's BASE_URL and the document, so it works in dev, preview and any sub-path. */
export function resolveAssetUrl(path: string): URL {
  return new URL(path, new URL(import.meta.env.BASE_URL, document.baseURI));
}

function forceWorldMatrix(node: TransformNode): void {
  const parent = node.parent;
  if (parent instanceof TransformNode) forceWorldMatrix(parent);
  node.computeWorldMatrix(true);
}

async function fetchMeta(url: URL): Promise<Record<string, ClipMeta>> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new CharacterLoadError(`Could not download the animation metadata (${url.pathname}). Check your connection.`, e);
  }
  if (!res.ok) throw new CharacterLoadError(`The animation metadata ${url.pathname} was not found (HTTP ${res.status}).`);
  try {
    const json = (await res.json()) as { clips?: Record<string, ClipMeta> };
    if (!json.clips) throw new Error('missing "clips"');
    return json.clips;
  } catch (e) {
    throw new CharacterLoadError(`The animation metadata ${url.pathname} is not valid JSON.`, e);
  }
}

/**
 * Loads a skinned GLB character (see tools/fbx_to_glb.py for how the repository FBX assets become GLB),
 * turns its animation groups into engine-independent ClipData, disables Babylon's own animation playback
 * (we blend poses ourselves, so there is exactly ONE animation controller per skeleton) and works out
 * the model's facing direction and ground contact from the rig itself instead of assuming them.
 */
export async function loadCharacter(
  scene: Scene,
  cfg: CharacterConfig,
  onProgress?: (fraction: number) => void,
): Promise<LoadedCharacter> {
  const modelUrl = resolveAssetUrl(cfg.modelUrl);
  const metaUrl = resolveAssetUrl(cfg.modelUrl.replace(/\.glb$/i, '.meta.json'));

  onProgress?.(0.02);
  const meta = await fetchMeta(metaUrl);

  // Do not let the glTF loader start any animation: we drive the bones ourselves.
  const sub = SceneLoader.OnPluginActivatedObservable.addOnce((plugin) => {
    const p = plugin as unknown as { animationStartMode?: number };
    if ('animationStartMode' in p) p.animationStartMode = 0; // GLTFLoaderAnimationStartMode.NONE
  });

  const slash = modelUrl.href.lastIndexOf('/');
  const rootUrl = modelUrl.href.slice(0, slash + 1);
  const fileName = modelUrl.href.slice(slash + 1);

  let result;
  try {
    result = await SceneLoader.ImportMeshAsync(
      '',
      rootUrl,
      fileName,
      scene,
      (e: ISceneLoaderProgressEvent) => {
        if (e.lengthComputable && e.total > 0) onProgress?.(0.05 + 0.9 * (e.loaded / e.total));
      },
      '.glb',
    );
  } catch (e) {
    SceneLoader.OnPluginActivatedObservable.remove(sub);
    throw new CharacterLoadError(
      `The character model could not be loaded from ${modelUrl.pathname}. ` +
        'Make sure the file exists (run "npm run convert:character" to regenerate it) and is a valid GLB.',
      e,
    );
  }

  const created = [...result.meshes, ...result.transformNodes];
  const cleanup = (): void => {
    result.animationGroups.forEach((g) => g.dispose());
    result.skeletons.forEach((s) => s.dispose());
    created.forEach((n) => n.dispose(false, true));
  };

  try {
    if (result.skeletons.length !== 1) {
      throw new CharacterLoadError(`Expected exactly one skeleton in the character model, found ${result.skeletons.length}.`);
    }

    // ---- clips -> engine-independent data (rest pose is read before anything could have animated it)
    const boneIndex = new Map<TransformNode, number>();
    const bones: TransformNode[] = [];
    const rest: BoneRest[] = [];
    const clipByName = new Map<string, ClipData>();
    for (const group of result.animationGroups) {
      const tracks: TrackData[] = [];
      let duration = 0;
      for (const ta of group.targetedAnimations) {
        const node = ta.target as TransformNode;
        const prop = ta.animation.targetProperty;
        if (prop !== 'rotationQuaternion' && prop !== 'position') continue;
        let bone = boneIndex.get(node);
        if (bone === undefined) {
          bone = bones.length;
          boneIndex.set(node, bone);
          bones.push(node);
          const q = node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation);
          rest.push({
            rotation: [q.x, q.y, q.z, q.w],
            translation: [node.position.x, node.position.y, node.position.z],
          });
        }
        const keys = ta.animation.getKeys();
        const fps = ta.animation.framePerSecond || 60;
        const isRot = prop === 'rotationQuaternion';
        const times = new Float32Array(keys.length);
        const values = new Float32Array(keys.length * (isRot ? 4 : 3));
        keys.forEach((k, i) => {
          times[i] = k.frame / fps;
          if (isRot) {
            const v = k.value as Quaternion;
            values.set([v.x, v.y, v.z, v.w], i * 4);
          } else {
            const v = k.value as Vector3;
            values.set([v.x, v.y, v.z], i * 3);
          }
        });
        duration = Math.max(duration, times[times.length - 1]);
        tracks.push({ bone, path: isRot ? 'rotation' : 'translation', times, values });
      }
      clipByName.set(group.name, { name: group.name, duration, distancePerCycle: meta[group.name]?.distancePerCycle ?? 0, tracks });
    }
    const missing = REQUIRED_CLIPS.filter((n) => !clipByName.has(n));
    if (missing.length) {
      throw new CharacterLoadError(
        `The character model has no "${missing.join('", "')}" animation clip. Found: ${[...clipByName.keys()].join(', ') || 'none'}.`,
      );
    }
    result.animationGroups.forEach((g) => g.dispose()); // keys are copied; drop Babylon's animatables

    // ---- model forward direction, measured from the skeleton (toes minus ankles), not assumed
    const byName = (n: string): TransformNode | undefined => result.transformNodes.find((t) => t.name === n);
    const pairs = (['L', 'R'] as const).map((s) => [byName(`foot.${s}`), byName(`toe.${s}`)] as const);
    let forwardCorrection = 0;
    if (pairs.every(([f, t]) => f && t)) {
      let fx = 0;
      let fz = 0;
      for (const [foot, toe] of pairs) {
        forceWorldMatrix(foot!);
        forceWorldMatrix(toe!);
        const a = foot!.getAbsolutePosition();
        const b = toe!.getAbsolutePosition();
        fx += b.x - a.x;
        fz += b.z - a.z;
      }
      if (Math.hypot(fx, fz) > 1e-4) forwardCorrection = -Math.atan2(fx, fz); // rotate so that forward = +Z
    } else {
      console.warn('[3DGAME] foot/toe bones not found; assuming the model already faces +Z.');
    }

    // ---- hierarchy: root (moved by the game) -> visual (forward fix + ground offset) -> model nodes
    const root = new TransformNode('player', scene);
    root.rotationQuaternion = Quaternion.Identity();
    const visual = new TransformNode('player-visual', scene);
    visual.parent = root;
    visual.rotation.y = forwardCorrection + cfg.yawOffsetRad;
    for (const n of created) if (!n.parent) n.parent = visual;
    const modelMeshes = result.meshes.filter((m) => m.getTotalVertices() > 0);

    // ---- ground contact: put the lowest point of the bind pose exactly on y = 0
    let minY = Infinity;
    let maxY = -Infinity;
    for (const m of modelMeshes) {
      forceWorldMatrix(m);
      const bb = m.getBoundingInfo().boundingBox;
      minY = Math.min(minY, bb.minimumWorld.y);
      maxY = Math.max(maxY, bb.maximumWorld.y);
    }
    if (!Number.isFinite(minY)) throw new CharacterLoadError('The character model contains no renderable mesh.');
    visual.position.y = -minY + cfg.groundOffset;
    const height = maxY - minY;

    // ---- materials: never leave the character invisible or black if a texture is missing
    for (const m of modelMeshes) {
      m.alwaysSelectAsActiveMesh = true; // skinned bounds do not follow the animation; never cull the player
      m.isPickable = false;
      const mat = m.material;
      if (mat instanceof PBRMaterial) {
        mat.metallic = 0;
        mat.roughness = 1;
        if (!mat.albedoTexture) {
          console.warn('[3DGAME] character material has no albedo texture; using a flat fallback colour.');
          mat.albedoColor = new Color3(0.55, 0.62, 0.75);
        }
      }
    }
    onProgress?.(1);

    const clips: LocomotionClips = {
      idle: clipByName.get('Idle')!,
      walk: clipByName.get('Walk')!,
      run: clipByName.get('Run')!,
    };
    return {
      root,
      meshes: modelMeshes,
      bones,
      rest,
      clips,
      height,
      forwardCorrection,
      dispose: () => {
        root.dispose(false, true);
        result.skeletons.forEach((s) => s.dispose());
      },
    };
  } catch (e) {
    cleanup();
    if (e instanceof CharacterLoadError) throw e;
    throw new CharacterLoadError('The character model loaded but could not be set up.', e);
  } finally {
    SceneLoader.OnPluginActivatedObservable.remove(sub);
  }
}
