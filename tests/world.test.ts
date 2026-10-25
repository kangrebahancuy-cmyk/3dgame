import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config';
import { generateLayout } from '../src/world/layout';
import { buildTerrainData, heightAt } from '../src/world/terrain';

const W = DEFAULT_CONFIG.world;

test('layout is deterministic, fills the requested counts and respects the start area', () => {
  const a = generateLayout(W);
  const b = generateLayout(W);
  assert.deepEqual(a, b);
  const count = (k: string) => a.filter((p) => p.kind === k).length;
  assert.ok(count('pine') + count('oak') >= W.treeCount, 'trees');
  assert.ok(count('rock') >= W.rockCount - 1, 'rocks');
  assert.ok(count('bush') >= W.bushCount - 1, 'bushes');
  for (const p of a) {
    assert.ok(Math.hypot(p.x, p.z) - p.collisionRadius > 3, 'nothing on the spawn point');
    assert.ok(Math.hypot(p.x, p.z) + p.collisionRadius < W.playRadius, 'inside the play area');
  }
});

test('no two props overlap', () => {
  const a = generateLayout(W);
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++) {
      const d = Math.hypot(a[i].x - a[j].x, a[i].z - a[j].z);
      assert.ok(d > a[i].collisionRadius + a[j].collisionRadius, `props ${i} and ${j} overlap`);
    }
});

test('start area is perfectly flat and terrain is gentle and continuous', () => {
  for (let a = 0; a < 6.3; a += 0.3) for (const r of [0, 2, 5.5]) assert.equal(heightAt(Math.cos(a) * r, Math.sin(a) * r), 0);
  let maxSlope = 0;
  for (let x = -40; x < 40; x += 0.25)
    for (let z = -40; z < 40; z += 0.7)
      maxSlope = Math.max(maxSlope, Math.abs(heightAt(x + 0.1, z) - heightAt(x, z)) / 0.1);
  assert.ok(maxSlope < 0.25, `slope ${maxSlope}`);
});

test('terrain mesh: valid indices, upward-facing triangles, matches heightAt exactly at vertices', () => {
  const seg = 40;
  const t = buildTerrainData(W.groundSize, seg);
  const n = (seg + 1) * (seg + 1);
  assert.equal(t.positions.length, n * 3);
  assert.equal(t.colors.length, n * 4);
  assert.equal(t.normals.length, n * 3);
  for (let k = 0; k < n; k++) {
    assert.ok(Math.abs(Math.hypot(t.normals[k * 3], t.normals[k * 3 + 1], t.normals[k * 3 + 2]) - 1) < 1e-5);
    assert.ok(t.normals[k * 3 + 1] > 0.9, 'terrain normals point up');
  }
  let down = 0;
  for (let i = 0; i < t.indices.length; i += 3) {
    const [a, b, c] = [t.indices[i], t.indices[i + 1], t.indices[i + 2]];
    assert.ok(a < n && b < n && c < n);
    const ux = t.positions[b * 3] - t.positions[a * 3], uy = t.positions[b * 3 + 1] - t.positions[a * 3 + 1], uz = t.positions[b * 3 + 2] - t.positions[a * 3 + 2];
    const vx = t.positions[c * 3] - t.positions[a * 3], vy = t.positions[c * 3 + 1] - t.positions[a * 3 + 1], vz = t.positions[c * 3 + 2] - t.positions[a * 3 + 2];
    // right-handed face normal = u x v
    const ny = uz * vx - ux * vz;
    if (ny <= 0) down++;
  }
  assert.equal(down, 0, 'all triangles must face up (right-handed winding)');
  for (let k = 0; k < n; k += 37) assert.equal(t.positions[k * 3 + 1], Math.fround(heightAt(t.positions[k * 3], t.positions[k * 3 + 2])));
});

test('mesh-vs-analytic height error between vertices stays far below a centimetre', () => {
  const seg = W.groundSegments;
  const size = W.groundSize;
  const cell = size / seg;
  let worst = 0;
  for (let x = -20; x < 20; x += 0.137)
    for (let z = -20; z < 20; z += 0.171) {
      const gx = Math.floor((x + size / 2) / cell) * cell - size / 2;
      const gz = Math.floor((z + size / 2) / cell) * cell - size / 2;
      const fx = (x - gx) / cell, fz = (z - gz) / cell;
      const h00 = heightAt(gx, gz), h10 = heightAt(gx + cell, gz), h01 = heightAt(gx, gz + cell), h11 = heightAt(gx + cell, gz + cell);
      // triangles: (a,c,b) and (b,c,d) with a=(0,0) b=(1,0) c=(0,1) d=(1,1)
      const interp = fx + fz <= 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
      worst = Math.max(worst, Math.abs(interp - heightAt(x, z)));
    }
  assert.ok(worst < 0.005, `worst mesh/analytic mismatch ${worst} m`);
});
