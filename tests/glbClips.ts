import { readFileSync } from 'node:fs';
import type { BoneRest, ClipData, LocomotionClips, TrackData } from '../src/character/AnimationBlender';

export interface Glb {
  json: any;
  bin: Buffer;
}

export function readGlb(path: string): Glb {
  const b = readFileSync(path);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('bad GLB magic');
  if (b.readUInt32LE(4) !== 2) throw new Error('GLB version != 2');
  if (b.readUInt32LE(8) !== b.length) throw new Error('GLB length mismatch');
  let pos = 12;
  let json: any;
  let bin = Buffer.alloc(0);
  while (pos < b.length) {
    const len = b.readUInt32LE(pos);
    const type = b.readUInt32LE(pos + 4);
    const chunk = b.subarray(pos + 8, pos + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    pos += 8 + len;
  }
  return { json, bin };
}

const COMP: Record<number, { size: number; read: (b: Buffer, o: number) => number }> = {
  5126: { size: 4, read: (b, o) => b.readFloatLE(o) },
  5123: { size: 2, read: (b, o) => b.readUInt16LE(o) },
  5125: { size: 4, read: (b, o) => b.readUInt32LE(o) },
  5121: { size: 1, read: (b, o) => b.readUInt8(o) },
};
const NCOMP: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readAccessor(g: Glb, index: number): Float32Array {
  const a = g.json.accessors[index];
  const v = g.json.bufferViews[a.bufferView];
  const c = COMP[a.componentType];
  const n = NCOMP[a.type];
  const out = new Float32Array(a.count * n);
  const base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  for (let i = 0; i < out.length; i++) out[i] = c.read(g.bin, base + i * c.size);
  return out;
}

/** Builds engine-independent clip data from the GLB, exactly as the runtime adapter does from Babylon. */
export function loadClips(g: Glb): { clips: LocomotionClips; rest: BoneRest[]; boneNames: string[]; nodeToBone: Map<number, number> } {
  const skin = g.json.skins[0];
  const nodeToBone = new Map<number, number>();
  const boneNames: string[] = [];
  const rest: BoneRest[] = [];
  skin.joints.forEach((nodeIdx: number, bone: number) => {
    nodeToBone.set(nodeIdx, bone);
    const n = g.json.nodes[nodeIdx];
    boneNames.push(n.name);
    rest.push({ rotation: n.rotation ?? [0, 0, 0, 1], translation: n.translation ?? [0, 0, 0] });
  });
  const meta = JSON.parse(readFileSync(new URL('../public/models/hero.meta.json', import.meta.url), 'utf8'));
  const byName: Record<string, ClipData> = {};
  for (const anim of g.json.animations) {
    const tracks: TrackData[] = [];
    let duration = 0;
    for (const ch of anim.channels) {
      const bone = nodeToBone.get(ch.target.node);
      if (bone === undefined) continue;
      const s = anim.samplers[ch.sampler];
      const times = readAccessor(g, s.input);
      duration = Math.max(duration, times[times.length - 1]);
      tracks.push({ bone, path: ch.target.path, times, values: readAccessor(g, s.output) });
    }
    byName[anim.name] = { name: anim.name, duration, distancePerCycle: meta.clips[anim.name].distancePerCycle, tracks };
  }
  return { clips: { idle: byName.Idle, walk: byName.Walk, run: byName.Run }, rest, boneNames, nodeToBone };
}
