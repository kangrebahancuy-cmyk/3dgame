import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config';
import { AnimationBlender } from '../src/character/AnimationBlender';
import { MovementModel } from '../src/character/MovementModel';
import { loadClips, readGlb } from './glbClips';

const GLB = new URL('../public/models/hero.glb', import.meta.url).pathname;
const g = readGlb(GLB);
const { clips, rest, boneNames } = loadClips(g);
const M = DEFAULT_CONFIG.movement;
const cfg = { walkSpeed: M.walkSpeed, runSpeed: M.runSpeed, blendLambda: DEFAULT_CONFIG.character.blendLambda, idleToWalkFraction: DEFAULT_CONFIG.character.idleToWalkFraction };
const mk = () => new AnimationBlender(clips, rest, cfg);
const nb = rest.length;

test('GLB really contains the three clips and a 27-joint skeleton', () => {
  assert.equal(boneNames.length, 27);
  assert.deepEqual(g.json.animations.map((a: any) => a.name).sort(), ['Idle', 'Run', 'Walk']);
  assert.ok(clips.idle.duration > 3 && clips.walk.duration > 0.5 && clips.run.duration > 0.3);
  assert.ok(clips.walk.distancePerCycle > 0.5 && clips.run.distancePerCycle > clips.walk.distancePerCycle);
});

test('clips loop seamlessly (first key == last key)', () => {
  for (const clip of [clips.idle, clips.walk, clips.run]) {
    for (const tr of clip.tracks) {
      const k = tr.path === 'rotation' ? 4 : 3;
      const n = tr.times.length;
      for (let i = 0; i < k; i++) {
        const a = tr.values[i], b = tr.values[(n - 1) * k + i];
        // quaternions: q and -q are the same rotation, but make_continuous may flip -> compare up to sign
        const sameDir = tr.path === 'rotation' ? Math.abs(Math.abs(a) - Math.abs(b)) : Math.abs(a - b);
        assert.ok(sameDir < 1e-4, `${clip.name}/${boneNames[tr.bone]}/${tr.path}`);
      }
    }
  }
});

test('target weights: idle at rest, walk at walkSpeed, run at runSpeed, always sum to 1', () => {
  const b = mk();
  const w: [number, number, number] = [0, 0, 0];
  b.targetWeights(0, w);
  assert.deepEqual(w, [1, 0, 0]);
  b.targetWeights(M.walkSpeed, w);
  assert.deepEqual(w, [0, 1, 0]);
  b.targetWeights(M.runSpeed, w);
  assert.deepEqual(w, [0, 0, 1]);
  b.targetWeights(M.runSpeed * 2, w);
  assert.deepEqual(w, [0, 0, 1]);
  for (let s = 0; s <= 5; s += 0.05) {
    b.targetWeights(s, w);
    assert.ok(Math.abs(w[0] + w[1] + w[2] - 1) < 1e-12 && w.every((x) => x >= 0));
  }
});

test('simulated run: idle -> run -> stop produces valid unit quaternions and finite positions every frame', () => {
  const b = mk();
  const m = new MovementModel(M);
  const rot = new Float32Array(nb * 4);
  const pos = new Float32Array(nb * 3);
  let sawWalkBlend = false;
  let sawRun = false;
  for (let i = 0; i < 60 * 8; i++) {
    const t = i / 60;
    const input = t > 0.5 && t < 4.5 ? 1 : 0;
    m.step(1 / 60, 0, input, true);
    b.update(1 / 60, m.speed);
    b.apply(rot, pos);
    for (const bone of b.animatedBones) {
      const l = Math.hypot(rot[bone * 4], rot[bone * 4 + 1], rot[bone * 4 + 2], rot[bone * 4 + 3]);
      assert.ok(Math.abs(l - 1) < 1e-5, `frame ${i} bone ${boneNames[bone]} |q|=${l}`);
      assert.ok(Number.isFinite(pos[bone * 3 + 1]));
    }
    if (b.weightWalk > 0.2 && b.weightWalk < 0.8) sawWalkBlend = true;
    if (b.weightRun > 0.99) sawRun = true;
    assert.ok(Math.abs(b.weightIdle + b.weightWalk + b.weightRun - 1) < 1e-9);
  }
  assert.ok(sawWalkBlend, 'passes through a walk blend while accelerating');
  assert.ok(sawRun, 'reaches pure run');
  assert.ok(b.weightIdle > 0.999, 'ends in pure idle');
});

/** Largest single-frame rotation (rad) of any bone while `drive` feeds speed/input each frame. */
function maxFrameRotation(frames: number, drive: (t: number, m: MovementModel) => void, skip = 0): { worst: number; bone: string } {
  const b = mk();
  const m = new MovementModel(M);
  const rot = new Float32Array(nb * 4);
  const prev = new Float32Array(nb * 4);
  const pos = new Float32Array(nb * 3);
  let worst = 0;
  let bone = '';
  for (let i = 0; i < frames; i++) {
    drive(i / 60, m);
    b.update(1 / 60, m.speed);
    b.apply(rot, pos);
    if (i > skip)
      for (const k of b.animatedBones) {
        const d = Math.abs(rot[k * 4] * prev[k * 4] + rot[k * 4 + 1] * prev[k * 4 + 1] + rot[k * 4 + 2] * prev[k * 4 + 2] + rot[k * 4 + 3] * prev[k * 4 + 3]);
        const ang = 2 * Math.acos(Math.min(1, d));
        if (ang > worst) {
          worst = ang;
          bone = boneNames[k];
        }
      }
    prev.set(rot);
  }
  return { worst, bone };
}

test('blending adds no pops: transitions never exceed the clips\' own fastest per-frame motion', () => {
  // Reference: the fastest a bone ever moves in one 60 Hz frame inside a pure steady run / walk cycle.
  const run = maxFrameRotation(60 * 6, (_t, m) => m.step(1 / 60, 0, 1, true), 60 * 3);
  const walk = maxFrameRotation(60 * 6, (_t, m) => m.step(1 / 60, 0, 1, false), 60 * 3);
  const reference = Math.max(run.worst, walk.worst);
  // Full scenario: idle -> run -> stop -> walk -> stop, plus a 180 degree reversal while running.
  const scenario = maxFrameRotation(60 * 14, (t, m) => {
    const run1 = t > 0.3 && t < 3;
    const walk1 = t > 4.5 && t < 7;
    const rev = t > 8 && t < 11;
    const dz = rev && t > 9.5 ? -1 : 1;
    m.step(1 / 60, 0, run1 || walk1 || rev ? dz : 0, !(walk1));
  });
  assert.ok(scenario.worst <= reference * 1.1,
    `transition frame rotation ${scenario.worst.toFixed(3)} rad on ${scenario.bone} vs steady-cycle max ${reference.toFixed(3)} rad`);
});

test('gait cadence matches ground speed: phase advance per metre equals 1 / distancePerCycle', () => {
  const b = mk();
  for (let i = 0; i < 120; i++) b.update(1 / 60, M.runSpeed); // settle on pure run
  const p0 = b.phase;
  let dist = 0;
  for (let i = 0; i < 10; i++) { // 0.7 m < one 1.43 m cycle, so no wrap-around ambiguity
    b.update(1 / 60, M.runSpeed);
    dist += M.runSpeed / 60;
  }
  let dp = b.phase - p0;
  if (dp < 0) dp += 1;
  assert.ok(Math.abs(dp - dist / clips.run.distancePerCycle) < 1e-6);
});

test('standing still: the walk phase does not advance and idle keeps looping', () => {
  const b = mk();
  const p = b.phase;
  const t0 = b.idleTime;
  for (let i = 0; i < 100; i++) b.update(1 / 60, 0);
  assert.equal(b.phase, p);
  assert.ok(b.idleTime !== t0);
});
