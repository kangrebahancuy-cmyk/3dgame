import { clamp, damp, smoothstep } from '../math/scalar';

/** One animated channel of a clip. `bone` indexes the rig's bone array. */
export interface TrackData {
  bone: number;
  path: 'rotation' | 'translation';
  times: Float32Array;
  /** Flat keyframe values: 4 floats (x,y,z,w) per key for rotation, 3 for translation. */
  values: Float32Array;
}

export interface ClipData {
  name: string;
  duration: number;
  /** Metres travelled per full left+right gait cycle (0 for Idle). */
  distancePerCycle: number;
  tracks: TrackData[];
}

export interface BoneRest {
  rotation: [number, number, number, number];
  translation: [number, number, number];
}

export interface BlendConfig {
  walkSpeed: number;
  runSpeed: number;
  blendLambda: number;
  idleToWalkFraction: number;
}

export interface LocomotionClips {
  idle: ClipData;
  walk: ClipData;
  run: ClipData;
}

const EPS = 1e-4;

/** Index k such that times[k] <= t < times[k+1], clamped to [0, n-2]. */
function findKey(times: Float32Array, t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Engine-independent locomotion animation mixer for Idle / Walk / Run.
 *
 *  - Blend weights are derived from the character's ground speed (idle -> walk -> run) and then
 *    smoothed, so transitions are continuous and follow acceleration/deceleration for free.
 *  - The walk/run gait phase advances by (speed * dt / metres-per-cycle), so a planted foot moves
 *    backwards at exactly the ground speed (no foot sliding) and the cadence scales with speed.
 *    Walk and run share one phase (both are authored with left-foot touchdown at phase 0), which
 *    keeps the legs in step while the two are cross-faded.
 *  - Writes into caller-owned typed arrays; nothing is allocated per frame.
 */
export class AnimationBlender {
  weightIdle = 1;
  weightWalk = 0;
  weightRun = 0;
  /** Gait phase in [0, 1). */
  phase = 0;
  idleTime = 0;

  private readonly clipList: ClipData[];
  /** For each clip, for each bone: index into clip.tracks (or -1). */
  private readonly rotIdx: Int32Array[];
  private readonly posIdx: Int32Array[];
  /** Bones that have at least one track in any clip. */
  readonly animatedBones: Int32Array;

  constructor(
    private readonly clips: LocomotionClips,
    private readonly rest: BoneRest[],
    private readonly cfg: BlendConfig,
  ) {
    this.clipList = [clips.idle, clips.walk, clips.run];
    const nb = rest.length;
    this.rotIdx = [];
    this.posIdx = [];
    const used = new Set<number>();
    for (const clip of this.clipList) {
      const r = new Int32Array(nb).fill(-1);
      const p = new Int32Array(nb).fill(-1);
      clip.tracks.forEach((tr, i) => {
        if (tr.bone < 0 || tr.bone >= nb) throw new Error(`clip ${clip.name}: bone ${tr.bone} out of range`);
        (tr.path === 'rotation' ? r : p)[tr.bone] = i;
        used.add(tr.bone);
      });
      this.rotIdx.push(r);
      this.posIdx.push(p);
    }
    this.animatedBones = Int32Array.from([...used].sort((a, b) => a - b));
    if (!(clips.walk.distancePerCycle > 0) || !(clips.run.distancePerCycle > 0)) {
      throw new Error('walk/run clips need distancePerCycle > 0');
    }
  }

  /** Target (unsmoothed) weights for a given ground speed. Pure; exposed for tests. */
  targetWeights(speed: number, out: [number, number, number]): void {
    const { walkSpeed, runSpeed, idleToWalkFraction } = this.cfg;
    if (speed < walkSpeed) {
      const w = smoothstep(speed / Math.max(EPS, idleToWalkFraction * walkSpeed));
      out[0] = 1 - w;
      out[1] = w;
      out[2] = 0;
    } else {
      const r = smoothstep((speed - walkSpeed) / Math.max(EPS, runSpeed - walkSpeed));
      out[0] = 0;
      out[1] = 1 - r;
      out[2] = r;
    }
  }

  private readonly tw: [number, number, number] = [1, 0, 0];

  update(dt: number, speed: number): void {
    this.targetWeights(speed, this.tw);
    this.weightIdle = damp(this.weightIdle, this.tw[0], this.cfg.blendLambda, dt);
    this.weightWalk = damp(this.weightWalk, this.tw[1], this.cfg.blendLambda, dt);
    this.weightRun = damp(this.weightRun, this.tw[2], this.cfg.blendLambda, dt);
    const sum = this.weightIdle + this.weightWalk + this.weightRun;
    this.weightIdle /= sum;
    this.weightWalk /= sum;
    this.weightRun /= sum;

    this.idleTime = (this.idleTime + dt) % this.clips.idle.duration;

    const gw = this.weightWalk + this.weightRun;
    const stride = gw > EPS
      ? (this.weightWalk * this.clips.walk.distancePerCycle + this.weightRun * this.clips.run.distancePerCycle) / gw
      : this.clips.walk.distancePerCycle;
    this.phase = (this.phase + (speed * dt) / stride) % 1;
  }

  private sampleRot(track: TrackData, t: number, out: Float32Array, o: number): void {
    const k = findKey(track.times, t);
    const t0 = track.times[k];
    const t1 = track.times[k + 1];
    const f = t1 > t0 ? clamp((t - t0) / (t1 - t0), 0, 1) : 0;
    const v = track.values;
    const a = k * 4;
    const b = a + 4;
    const dot = v[a] * v[b] + v[a + 1] * v[b + 1] + v[a + 2] * v[b + 2] + v[a + 3] * v[b + 3];
    const s = dot < 0 ? -1 : 1;
    let x = v[a] + (s * v[b] - v[a]) * f;
    let y = v[a + 1] + (s * v[b + 1] - v[a + 1]) * f;
    let z = v[a + 2] + (s * v[b + 2] - v[a + 2]) * f;
    let w = v[a + 3] + (s * v[b + 3] - v[a + 3]) * f;
    const l = Math.hypot(x, y, z, w) || 1;
    out[o] = x / l;
    out[o + 1] = y / l;
    out[o + 2] = z / l;
    out[o + 3] = w / l;
  }

  private readonly tmp = new Float32Array(4);

  /**
   * Writes the blended pose. `outRot` holds 4 floats per bone, `outPos` 3 floats per bone.
   * Only entries listed in `animatedBones` are written.
   */
  apply(outRot: Float32Array, outPos: Float32Array): void {
    const weights = [this.weightIdle, this.weightWalk, this.weightRun];
    const times = [
      this.idleTime,
      this.phase * this.clips.walk.duration,
      this.phase * this.clips.run.duration,
    ];
    const tmp = this.tmp;
    for (let n = 0; n < this.animatedBones.length; n++) {
      const b = this.animatedBones[n];
      const rest = this.rest[b];
      let ax = 0;
      let ay = 0;
      let az = 0;
      let aw = 0;
      let px = 0;
      let py = 0;
      let pz = 0;
      let wsum = 0;
      for (let c = 0; c < 3; c++) {
        const w = weights[c];
        if (w < EPS) continue;
        wsum += w;
        // rotation
        const ri = this.rotIdx[c][b];
        if (ri >= 0) this.sampleRot(this.clipList[c].tracks[ri], times[c], tmp, 0);
        else {
          tmp[0] = rest.rotation[0];
          tmp[1] = rest.rotation[1];
          tmp[2] = rest.rotation[2];
          tmp[3] = rest.rotation[3];
        }
        // Align to the accumulated quaternion's hemisphere so the weighted sum takes the short way.
        const d = tmp[0] * ax + tmp[1] * ay + tmp[2] * az + tmp[3] * aw;
        const sg = d < 0 ? -1 : 1;
        ax += sg * tmp[0] * w;
        ay += sg * tmp[1] * w;
        az += sg * tmp[2] * w;
        aw += sg * tmp[3] * w;
        // translation
        const pi = this.posIdx[c][b];
        if (pi >= 0) {
          const tr = this.clipList[c].tracks[pi];
          const k = findKey(tr.times, times[c]);
          const t0 = tr.times[k];
          const t1 = tr.times[k + 1];
          const f = t1 > t0 ? clamp((times[c] - t0) / (t1 - t0), 0, 1) : 0;
          const i0 = k * 3;
          const i1 = i0 + 3;
          px += (tr.values[i0] + (tr.values[i1] - tr.values[i0]) * f) * w;
          py += (tr.values[i0 + 1] + (tr.values[i1 + 1] - tr.values[i0 + 1]) * f) * w;
          pz += (tr.values[i0 + 2] + (tr.values[i1 + 2] - tr.values[i0 + 2]) * f) * w;
        } else {
          px += rest.translation[0] * w;
          py += rest.translation[1] * w;
          pz += rest.translation[2] * w;
        }
      }
      const l = Math.hypot(ax, ay, az, aw) || 1;
      outRot[b * 4] = ax / l;
      outRot[b * 4 + 1] = ay / l;
      outRot[b * 4 + 2] = az / l;
      outRot[b * 4 + 3] = aw / l;
      const inv = wsum > EPS ? 1 / wsum : 1;
      outPos[b * 3] = px * inv;
      outPos[b * 3 + 1] = py * inv;
      outPos[b * 3 + 2] = pz * inv;
    }
  }
}
