import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/config';
import { MovementModel } from '../src/character/MovementModel';
import { CollisionWorld } from '../src/world/collision';
import { generateForestLayout, groundMarks } from '../src/world/forest/ForestLayout';
import { groundUv, paintedSize, paintGround, worldToPixel } from '../src/world/forest/GroundPainter';
import { FOREST_MAP } from '../src/world/forest/MapConfiguration';
import { NATURE_CATALOG, NATURE_CATALOG_COUNT } from '../src/world/forest/NatureCatalog';
import { FOREST_PALETTE, paletteColor } from '../src/world/forest/NaturePalette';
import { PathNetwork } from '../src/world/forest/PathNetwork';

const ROOT = join(import.meta.dirname, '..');
const KENNEY = join(ROOT, 'assets', 'kenney_nature-kit', 'Models', 'GLTF format');
const PUBLIC = join(ROOT, 'public', 'models', 'nature');
const R = DEFAULT_CONFIG.movement.playerRadius;
const HALF = FOREST_MAP.size / 2;

const layout = generateForestLayout(FOREST_MAP);
const net = new PathNetwork(FOREST_MAP.paths);

function buildWorld(): CollisionWorld {
  const w = new CollisionWorld();
  for (const c of layout.solids) w.addCircle(c.x, c.z, c.r);
  w.setRectBounds(HALF, HALF);
  return w;
}

test('catalog: every referenced Kenney file exists, matches its recorded size/hash and is self-contained', () => {
  const ids = Object.keys(NATURE_CATALOG);
  assert.equal(ids.length, NATURE_CATALOG_COUNT);
  for (const id of ids) {
    const a = NATURE_CATALOG[id];
    assert.equal(a.file, `${id}.glb`);
    const orig = join(KENNEY, a.file);
    assert.ok(existsSync(orig), `missing original ${a.file}`);
    assert.equal(statSync(orig).size, a.bytes, `${a.file} size`);
    const sha = createHash('sha1').update(readFileSync(orig)).digest('hex').slice(0, 12);
    assert.equal(sha, a.sha1, `${a.file} sha1`);
    // the served copy must be byte-identical to the original
    const copy = join(PUBLIC, a.file);
    assert.ok(existsSync(copy), `missing public copy ${a.file} (run "npm run catalog")`);
    assert.ok(readFileSync(copy).equals(readFileSync(orig)), `${a.file}: public copy differs from the original`);
    // GLB header + no external URIs
    const buf = readFileSync(orig);
    assert.equal(buf.readUInt32LE(0), 0x46546c67, `${a.file} magic`);
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as { images?: Array<{ uri?: string }>; buffers?: Array<{ uri?: string }> };
    for (const x of [...(json.images ?? []), ...(json.buffers ?? [])]) assert.ok(!x.uri || x.uri.startsWith('data:'), `${a.file} references an external file`);
    assert.ok(a.size[1] > 0 && a.size[0] > 0, `${a.file} has a size`);
  }
});

test('catalog: trees have a measured trunk radius, other categories do not need one', () => {
  for (const a of Object.values(NATURE_CATALOG)) {
    if (a.category === 'conifer' || a.category === 'broadleaf') assert.ok((a.trunkRadius ?? 0) > 0.02 && (a.trunkRadius ?? 9) < 0.6, `${a.file} trunk`);
  }
});

test('layout: deterministic and only references verified catalog assets', () => {
  const again = generateForestLayout(FOREST_MAP);
  assert.deepEqual(again, layout);
  for (const o of layout.objects) assert.ok(NATURE_CATALOG[o.assetId], `${o.assetId} not in catalog`);
});

test('layout: contains every required element of the brief', () => {
  const kinds = (k: string) => layout.objects.filter((o) => o.kind === k).length;
  assert.ok(kinds('tree') >= 120, 'forest trees');
  assert.ok(kinds('rock') >= 6, 'large rocks');
  assert.ok(kinds('bush') >= 40 && kinds('grass') >= 100 && kinds('flower') >= 20, 'undergrowth');
  assert.equal(kinds('sign'), 4, 'one exit sign per exit');
  assert.equal(kinds('camp'), 1);
  assert.ok(kinds('outer-tree') >= 80, 'outer visual forest');
  // north is the dense forest, west the light one
  const count = (f: (x: number, z: number) => boolean) => layout.objects.filter((o) => o.kind === 'tree' && f(o.x, o.z)).length;
  const north = count((x, z) => z > 12 && Math.abs(x) < 20);
  const west = count((x, z) => x < -12 && Math.abs(z) < 20);
  assert.ok(north > west * 1.6, `north (${north}) should be much denser than west (${west})`);
});

test('layout: collision only for trunks and big rocks - canopies and small plants never block', () => {
  for (const o of layout.objects) {
    const solid = o.colliders.length > 0;
    const mayBeSolid = o.kind === 'tree' || o.kind === 'rock' || o.kind === 'marker-rock' || o.kind === 'sign' || o.kind === 'camp';
    assert.equal(solid, mayBeSolid, `${o.kind} ${o.assetId} solid=${solid}`);
    if (o.kind === 'tree') {
      assert.equal(o.colliders.length, 1);
      const a = NATURE_CATALOG[o.assetId];
      const canopyHalf = 0.5 * Math.max(a.size[0], a.size[2]) * o.scale;
      assert.ok(o.colliders[0].r <= 1.2 && o.colliders[0].r < 0.7 * canopyHalf, `${o.assetId}: collider ${o.colliders[0].r.toFixed(2)} must be trunk-sized, canopy radius is ${canopyHalf.toFixed(2)}`);
    }
  }
  assert.equal(layout.solids.length, layout.objects.reduce((n, o) => n + o.colliders.length, 0));
});

test('layout: solids never overlap and keep a passable gap (no trapping pockets)', () => {
  const s = layout.solids;
  const need = 2 * R + 0.3; // the player (diameter 0.76 m) must fit with room to spare
  let tightest = Infinity;
  for (let i = 0; i < s.length; i++)
    for (let j = i + 1; j < s.length; j++) {
      const gap = Math.hypot(s[i].x - s[j].x, s[i].z - s[j].z) - s[i].r - s[j].r;
      tightest = Math.min(tightest, gap);
      assert.ok(gap >= need, `solids ${i} and ${j} leave only ${gap.toFixed(2)} m`);
    }
  assert.ok(tightest >= need);
  for (const c of s) assert.ok(Math.abs(c.x) + c.r <= HALF && Math.abs(c.z) + c.r <= HALF, 'solid inside the map');
});

test('layout: spawn clearing and every path corridor are free of solids', () => {
  const w = buildWorld();
  const { clearing } = FOREST_MAP;
  // the only solid allowed inside the clearing is the campfire (a deliberate landmark); the spawn point itself is wide open
  for (const o of layout.objects) {
    if (o.colliders.length === 0 || o.kind === 'camp') continue;
    for (const c of o.colliders) assert.ok(Math.hypot(c.x - clearing.x, c.z - clearing.z) - c.r > clearing.radius - 0.5, `${o.assetId} intrudes into the clearing`);
  }
  for (let a = 0; a < Math.PI * 2; a += 0.2)
    for (let r = 0; r <= 3.5; r += 0.5) assert.ok(!w.overlaps(clearing.x + Math.cos(a) * r, clearing.z + Math.sin(a) * r, R), `blocked near the spawn at r=${r}`);
  for (const id of net.ids) {
    const cl = net.centreLine(id);
    for (let i = 0; i < cl.xs.length; i++) {
      // the whole path width (not just the centre line) must be free for the player body
      assert.ok(!w.overlaps(cl.xs[i], cl.zs[i], cl.halfWidth - 0.3), `path ${id} blocked at sample ${i}`);
    }
  }
});

/** Flood fill over the walkable area with the real player radius; returns the reachable mask. */
function flood(step: number): { reach: Uint8Array; free: Uint8Array; n: number; at: (x: number, z: number) => number } {
  const w = buildWorld();
  const n = Math.round((2 * HALF) / step) + 1;
  const at = (x: number, z: number): number => Math.round((z + HALF) / step) * n + Math.round((x + HALF) / step);
  const free = new Uint8Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = -HALF + i * step, z = -HALF + j * step;
      free[j * n + i] = Math.abs(x) <= HALF - R && Math.abs(z) <= HALF - R && !w.overlaps(x, z, R) ? 1 : 0;
    }
  const reach = new Uint8Array(n * n);
  const stack = [at(FOREST_MAP.spawn.x, FOREST_MAP.spawn.z)];
  assert.equal(free[stack[0]], 1, 'spawn is free');
  reach[stack[0]] = 1;
  while (stack.length) {
    const k = stack.pop()!;
    const i = k % n, j = (k - i) / n;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const nk = nj * n + ni;
      if (free[nk] && !reach[nk]) { reach[nk] = 1; stack.push(nk); }
    }
  }
  return { reach, free, n, at };
}

test('reachability: the spawn connects to all four exits and to (almost) every free spot - nothing walkable is a trap', () => {
  const step = 0.25;
  const { reach, free, at } = flood(step);
  for (const e of FOREST_MAP.exits) {
    const x = e.x - e.outward[0] * (R + 0.1), z = e.z - e.outward[1] * (R + 0.1);
    assert.equal(reach[at(x, z)], 1, `exit ${e.id} is reachable`);
  }
  let freeN = 0, reachN = 0;
  for (let k = 0; k < free.length; k++) { freeN += free[k]; reachN += reach[k]; }
  assert.ok(reachN / freeN > 0.97, `only ${(100 * reachN / freeN).toFixed(2)} % of the free ground is reachable`);
});

test('reachability: the player can walk from the spawn right up to every map edge', () => {
  const step = 0.25;
  const { reach, n } = flood(step);
  const band = 4; // cells within 1 m of the wall
  const touched = { n: false, s: false, e: false, w: false };
  for (let k = 0; k < n; k++)
    for (let d = 0; d < band; d++) {
      if (reach[(n - 1 - d) * n + k]) touched.n = true;
      if (reach[d * n + k]) touched.s = true;
      if (reach[k * n + (n - 1 - d)]) touched.e = true;
      if (reach[k * n + d]) touched.w = true;
    }
  assert.deepEqual(touched, { n: true, s: true, e: true, w: true });
});

test('walking: the real MovementModel runs from the spawn along every path to its exit without ever sticking', () => {
  const w = buildWorld();
  for (const id of net.ids) {
    const cl = net.centreLine(id);
    const m = new MovementModel(DEFAULT_CONFIG.movement);
    m.teleport(FOREST_MAP.spawn.x, FOREST_MAP.spawn.z, 0);
    let idx = 0, blockedFrames = 0, frames = 0;
    for (; frames < 60 * 60 && idx < cl.xs.length - 1; frames++) {
      // steer toward a point 1.5 m ahead on the centre line, like a player following the path
      while (idx < cl.xs.length - 1 && Math.hypot(cl.xs[idx] - m.x, cl.zs[idx] - m.z) < 1.5) idx++;
      const dx = cl.xs[idx] - m.x, dz = cl.zs[idx] - m.z, l = Math.hypot(dx, dz) || 1;
      m.step(1 / 60, dx / l, dz / l, true, w);
      if (m.blocked) blockedFrames++;
    }
    const last = cl.xs.length - 1;
    assert.ok(Math.hypot(m.x - cl.xs[last], m.z - cl.zs[last]) < 2.2, `path ${id}: ended at (${m.x.toFixed(1)}, ${m.z.toFixed(1)}) after ${frames} frames`);
    assert.ok(frames < 60 * 20, `path ${id} took ${(frames / 60).toFixed(1)} s`);
    assert.equal(blockedFrames, 0, `path ${id}: ${blockedFrames} frames touched an obstacle while following the path`);
  }
});

test('walking: pushing diagonally into a tree slides along it and never gets stuck', () => {
  const w = buildWorld();
  const tree = layout.objects.find((o) => o.kind === 'tree' && Math.hypot(o.x, o.z) < 30)!;
  const c = tree.colliders[0];
  const m = new MovementModel(DEFAULT_CONFIG.movement);
  m.teleport(c.x - 4, c.z - 0.2, 0);
  const startX = m.x;
  for (let f = 0; f < 240; f++) m.step(1 / 60, 1, 0.35, true, w); // keep pushing east-ish, slightly north
  assert.ok(m.x > startX + 3, 'made progress past the tree');
  assert.ok(Math.hypot(m.x - c.x, m.z - c.z) >= c.r + R - 1e-6 || m.x > c.x + c.r, 'never inside the trunk');
});

test('performance: layout generation stays cheap and the object count is bounded', () => {
  const t0 = performance.now();
  generateForestLayout(FOREST_MAP);
  const ms = performance.now() - t0;
  assert.ok(ms < 2500, `layout took ${ms.toFixed(0)} ms`);
  assert.ok(layout.objects.length < 2000);
  assert.ok(layout.solids.length < 400);
});

test('ground painter: world <-> pixel <-> UV mapping agree (north is up in the canvas, v = 1 at the top row)', () => {
  const px = 2048;
  const s = paintedSize(FOREST_MAP);
  assert.equal(s, FOREST_MAP.size + 32);
  for (const [x, z] of [[0, 0], [-32, 32], [32, -32], [12.5, -7.25], [-20, 20]]) {
    const [cx, cy] = worldToPixel(FOREST_MAP, px, x, z);
    const [u, v] = groundUv(FOREST_MAP, x, z);
    assert.ok(Math.abs(cx - u * px) < 1e-9, `x ${x}`);
    assert.ok(Math.abs(cy - (1 - v) * px) < 1e-9, `z ${z}`);
  }
  const [, topY] = worldToPixel(FOREST_MAP, px, 0, 20);
  const [, bottomY] = worldToPixel(FOREST_MAP, px, 0, -20);
  assert.ok(topY < bottomY, 'north (+z) is toward the top of the canvas');
  assert.deepEqual(worldToPixel(FOREST_MAP, px, 0, 0), [px / 2, px / 2]);
});

test('ground painter: draws into a canvas context using only the shared path network (recording mock)', () => {
  let arcs = 0, fills = 0;
  const grad = { addColorStop: () => undefined };
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'arc') return () => { arcs++; };
      if (k === 'fill' || k === 'fillRect') return () => { fills++; };
      if (k === 'createRadialGradient') return () => grad;
      return () => undefined;
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  paintGround(ctx, 512, FOREST_MAP, net, groundMarks(layout));
  const stamps = net.ids.reduce((n, id) => n + net.centreLine(id).xs.length, 0);
  assert.ok(arcs >= stamps * 4, `expected path stamps (got ${arcs} arcs for ${stamps} samples)`);
  assert.ok(fills > 20000, 'grass speckle drawn');
});

test('palette: every material that occurs in the catalog has a forest colour (no silent fallback)', () => {
  const names = new Set(Object.values(NATURE_CATALOG).flatMap((a) => a.materials));
  for (const n of names) assert.ok(FOREST_PALETTE[n], `no forest colour for material "${n}"`);
  assert.deepEqual(paletteColor('kenney', 'wood', [0.1, 0.2, 0.3]), [0.1, 0.2, 0.3]);
  assert.throws(() => paletteColor('forest', 'doesNotExist', [1, 1, 1]), /doesNotExist/);
});
