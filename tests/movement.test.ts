import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config';
import { MovementModel } from '../src/character/MovementModel';
import { CollisionWorld } from '../src/world/collision';
import { shortestAngle } from '../src/math/scalar';

const M = DEFAULT_CONFIG.movement;

function run(m: MovementModel, seconds: number, fps: number, dx: number, dz: number, runFlag = true, world?: CollisionWorld) {
  const dt = 1 / fps;
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) m.step(dt, dx, dz, runFlag, world);
}

test('steady-state speed is identical in all 16 headings, diagonals included', () => {
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const m = new MovementModel(M);
    // un-normalised input on purpose: (1,1) must not be faster than (1,0)
    run(m, 2, 60, Math.sin(a) * 3, Math.cos(a) * 3);
    assert.ok(Math.abs(m.speed - M.runSpeed) < 1e-3, `heading ${k}: speed ${m.speed}`);
  }
  const d = new MovementModel(M);
  run(d, 2, 60, 1, 1);
  assert.ok(Math.abs(d.speed - M.runSpeed) < 1e-3);
});

test('walk and run speeds are honoured', () => {
  const w = new MovementModel(M);
  run(w, 2, 60, 0, 1, false);
  assert.ok(Math.abs(w.speed - M.walkSpeed) < 1e-3);
});

test('acceleration is smooth: monotonic, no overshoot, no instant jump', () => {
  const m = new MovementModel(M);
  let prev = 0;
  let first = -1;
  for (let i = 0; i < 90; i++) {
    m.step(1 / 60, 0, 1, true);
    if (first < 0) first = m.speed;
    assert.ok(m.speed >= prev - 1e-9, 'speed must not decrease while accelerating');
    assert.ok(m.speed <= M.runSpeed + 1e-9, 'no overshoot');
    prev = m.speed;
  }
  assert.ok(first < M.runSpeed * 0.3, `first frame must not jump to full speed (got ${first})`);
});

test('deceleration is smooth and stops exactly without sliding or reversing', () => {
  const m = new MovementModel(M);
  run(m, 2, 60, 0, 1);
  const z0 = m.z;
  let prev = m.speed;
  let stopFrame = -1;
  for (let i = 0; i < 120; i++) {
    m.step(1 / 60, 0, 0, true);
    assert.ok(m.speed <= prev + 1e-9);
    assert.ok(m.vz >= 0, 'never reverses');
    prev = m.speed;
    if (m.speed === 0 && stopFrame < 0) stopFrame = i;
  }
  assert.ok(stopFrame >= 0 && stopFrame < 60, `must come to rest within 1 s (frame ${stopFrame})`);
  const z1 = m.z;
  run(m, 2, 60, 0, 0);
  assert.equal(m.z, z1, 'no creeping after rest');
  assert.ok(z1 - z0 < 0.6, `stopping distance ${z1 - z0} m should be short`);
});

test('movement is frame-rate independent (30/60/144 fps and jittery frames)', () => {
  const results: number[] = [];
  for (const fps of [30, 60, 144, 240]) {
    const m = new MovementModel(M);
    run(m, 1, fps, 0, 1);
    run(m, 1, fps, 0, 0);
    results.push(m.z);
  }
  const lo = Math.min(...results);
  const hi = Math.max(...results);
  assert.ok((hi - lo) / hi < 0.02, `distances differ too much: ${results.join(', ')}`);
  // irregular frame times
  const j = new MovementModel(M);
  let t = 0;
  let i = 0;
  while (t < 1) {
    const dt = i++ % 2 ? 1 / 20 : 1 / 100;
    j.step(dt, 0, 1, true);
    t += Math.min(dt, M.maxFrameTime);
  }
  assert.ok(Math.abs(j.vz - M.runSpeed * (1 - Math.exp(-M.accelLambda * t))) < 0.02);
});

test('huge frame time is clamped (no teleporting after a tab switch)', () => {
  const m = new MovementModel(M);
  m.step(5, 0, 1, true);
  assert.ok(m.z < 0.1, `z=${m.z}`);
});

test('turning: shortest path, no overshoot, bounded rate, wraps across +-PI', () => {
  const m = new MovementModel(M);
  m.teleport(0, 0, 0);
  let prev = m.yaw;
  let maxStep = 0;
  for (let i = 0; i < 120; i++) {
    m.step(1 / 60, 0, -1, true); // face -Z = yaw PI : a 180 degree reversal
    maxStep = Math.max(maxStep, Math.abs(shortestAngle(prev, m.yaw)));
    assert.ok(Math.abs(shortestAngle(m.yaw, Math.PI)) <= Math.abs(shortestAngle(prev, Math.PI)) + 1e-9, 'monotonic approach');
    prev = m.yaw;
  }
  assert.ok(Math.abs(shortestAngle(m.yaw, Math.PI)) < 0.01);
  assert.ok(maxStep <= M.maxTurnRate / 60 + 1e-9, 'turn rate cap respected');
  const w = new MovementModel(M);
  w.teleport(0, 0, Math.PI - 0.1);
  w.step(1 / 60, -0.2, -1, true); // target just past PI on the other side: must go the short way
  assert.ok(Math.abs(shortestAngle(Math.PI - 0.1, w.yaw)) < 0.5);
});

test('facing follows the movement direction (+X => yaw PI/2)', () => {
  const m = new MovementModel(M);
  run(m, 2, 60, 1, 0);
  assert.ok(Math.abs(m.yaw - Math.PI / 2) < 1e-3);
});

test('collision: head-on into a tree never penetrates, even at 20 fps with a thin obstacle', () => {
  for (const [fps, radius] of [[60, 0.45], [20, 0.45], [20, 0.1]] as const) {
    const w = new CollisionWorld();
    w.addCircle(0, 5, radius);
    const m = new MovementModel(M);
    run(m, 4, fps, 0, 1, true, w);
    const d = Math.hypot(m.x, m.z - 5);
    assert.ok(d >= radius + M.playerRadius - 1e-6, `penetrated at ${fps} fps: ${d}`);
    assert.ok(m.z < 5, 'stopped in front of the obstacle');
    assert.ok(m.speed < 0.5, 'speed after head-on collision is ~0');
  }
});

test('collision: glancing hit slides along the obstacle and keeps going', () => {
  const w = new CollisionWorld();
  w.addCircle(0.3, 5, 0.6);
  const m = new MovementModel(M);
  run(m, 4, 60, 0, 1, true, w);
  assert.ok(m.z > 6, `should have slid past (z=${m.z})`);
  assert.ok(m.x < 0, 'pushed to the side away from the obstacle');
});

test('world boundary keeps the character inside', () => {
  const w = new CollisionWorld();
  w.boundsRadius = 10;
  const m = new MovementModel(M);
  m.teleport(8, 0, 0);
  let worst = 0;
  let slideSpeed = 0;
  for (let i = 0; i < 360; i++) {
    m.step(1 / 60, 0.6, 1, true, w); // oblique approach: should slide along the circular boundary
    worst = Math.max(worst, Math.hypot(m.x, m.z));
    if (m.blocked) slideSpeed = Math.max(slideSpeed, m.speed);
  }
  assert.ok(worst <= 10 - M.playerRadius + 1e-6, `left the play area: ${worst}`);
  assert.ok(slideSpeed > 1.5, `slides along the boundary rather than sticking (${slideSpeed} m/s)`);
  // it creeps asymptotically toward the point where the boundary normal is parallel to the input
  // direction (no tangential component left) and must never pass it
  const ang = Math.atan2(m.z, m.x);
  assert.ok(ang > 0.9 && ang <= Math.atan2(1, 0.6) + 1e-3, `ended at ${ang} rad`);
  // and walking straight at it stops dead without jitter
  const h = new MovementModel(M);
  run(h, 6, 60, 1, 0, true, w);
  assert.ok(h.speed < 0.5 && Math.hypot(h.x, h.z) <= 10 - M.playerRadius + 1e-6);
});
