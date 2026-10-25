import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAccessor, readGlb } from './glbClips';

const GLB = new URL('../public/models/hero.glb', import.meta.url).pathname;
const g = readGlb(GLB);
const j = g.json;

test('GLB structure: scene, one skinned mesh, embedded PNG texture, no external URIs', () => {
  assert.equal(j.asset.version, '2.0');
  assert.equal(j.meshes.length, 1);
  assert.equal(j.skins.length, 1);
  assert.equal(j.images.length, 1);
  assert.equal(j.images[0].mimeType, 'image/png');
  const v = j.bufferViews[j.images[0].bufferView];
  const png = g.bin.subarray(v.byteOffset, v.byteOffset + v.byteLength);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const original = readFileSync(new URL('../assets/Fantasy_Heroes_Free/Texture/Texture.png', import.meta.url));
  assert.ok(png.equals(original), 'embedded texture is byte-identical to the original asset');
  assert.ok(!JSON.stringify(j).includes('"uri"'), 'self-contained, nothing to 404');
});

test('every accessor and buffer view lies inside the binary chunk', () => {
  for (const v of j.bufferViews) assert.ok(v.byteOffset + v.byteLength <= g.bin.length);
  for (const [i, a] of j.accessors.entries()) {
    const v = j.bufferViews[a.bufferView];
    const size = { 5126: 4, 5123: 2, 5125: 4, 5121: 1 }[a.componentType as 5126]!;
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type as 'SCALAR']!;
    assert.ok((a.byteOffset ?? 0) + a.count * n * size <= v.byteLength, `accessor ${i}`);
  }
});

test('mesh data: valid indices, unit normals, UVs in range, weights normalised, joints in range', () => {
  const p = j.meshes[0].primitives[0];
  const pos = readAccessor(g, p.attributes.POSITION);
  const nrm = readAccessor(g, p.attributes.NORMAL);
  const uv = readAccessor(g, p.attributes.TEXCOORD_0);
  const jn = readAccessor(g, p.attributes.JOINTS_0);
  const wt = readAccessor(g, p.attributes.WEIGHTS_0);
  const idx = readAccessor(g, p.indices);
  const nv = pos.length / 3;
  assert.equal(nrm.length, pos.length);
  assert.ok(idx.every((i) => i < nv));
  for (let i = 0; i < nv; i++) {
    assert.ok(Math.abs(Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) - 1) < 1e-3);
    assert.ok(uv[i * 2] >= 0 && uv[i * 2] <= 1 && uv[i * 2 + 1] >= 0 && uv[i * 2 + 1] <= 1);
    const s = wt[i * 4] + wt[i * 4 + 1] + wt[i * 4 + 2] + wt[i * 4 + 3];
    assert.ok(Math.abs(s - 1) < 1e-4, `vertex ${i} weights sum ${s}`);
    for (let k = 0; k < 4; k++) assert.ok(jn[i * 4 + k] < j.skins[0].joints.length);
  }
});

test('character stands on y=0 and is about 1.94 m tall; faces +Z', () => {
  const p = j.meshes[0].primitives[0];
  const pos = readAccessor(g, p.attributes.POSITION);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < pos.length; i += 3) { minY = Math.min(minY, pos[i]); maxY = Math.max(maxY, pos[i]); }
  assert.ok(Math.abs(minY) < 1e-5, `lowest vertex y=${minY}`);
  assert.ok(Math.abs(maxY - 1.94) < 0.02);
  const names = j.nodes.map((n: any) => n.name);
  const world = (name: string) => {
    let n = j.nodes.findIndex((x: any) => x.name === name);
    const parent = new Map<number, number>();
    j.nodes.forEach((x: any, i: number) => (x.children ?? []).forEach((c: number) => parent.set(c, i)));
    // translation-only chain is not enough (rotations) -> accumulate with quaternions
    let m = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    const chain: number[] = [];
    for (let c: number | undefined = n; c !== undefined; c = parent.get(c)) chain.unshift(c);
    const mul = (a: number[][], b: number[][]) => a.map((r, i) => b[0].map((_, k) => r.reduce((s, _v, t) => s + a[i][t] * b[t][k], 0)));
    for (const c of chain) {
      const nd = j.nodes[c];
      const [x, y, z, w] = nd.rotation ?? [0, 0, 0, 1];
      const t = nd.translation ?? [0, 0, 0];
      const R = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), t[0]],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), t[1]],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), t[2]],
        [0, 0, 0, 1],
      ];
      m = mul(m, R);
    }
    return [m[0][3], m[1][3], m[2][3]];
  };
  assert.ok(names.includes('toe.L'));
  const toe = world('toe.L'), foot = world('foot.L');
  assert.ok(toe[2] - foot[2] > 0.05, 'toes are in front of the ankle along +Z');
});

test('animation sampler data is well-formed (times ascending, shared time accessor per clip)', () => {
  for (const a of j.animations) {
    for (const ch of a.channels) {
      const s = a.samplers[ch.sampler];
      const t = readAccessor(g, s.input);
      for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1]);
      const out = readAccessor(g, s.output);
      assert.equal(out.length / (ch.target.path === 'rotation' ? 4 : 3), t.length);
    }
  }
});
