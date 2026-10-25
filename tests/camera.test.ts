import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config';
import { FollowRig } from '../src/camera/FollowRig';
import { heightAt } from '../src/world/terrain';

const C = DEFAULT_CONFIG.camera;
const dir = { x: 0, z: 0 };

test('screen-right is correct in both handedness conventions (left = Babylon default)', () => {
  // Left-handed, camera looking along +Z (azimuth 0): right is +X. Right-handed, looking along -Z (azimuth 180): right is +X.
  const l = new FollowRig({ ...C, azimuthDeg: 0 }, heightAt, 'left');
  l.moveDirection(0, 1, dir);
  assert.ok(Math.abs(dir.x - 1) < 1e-9 && Math.abs(dir.z) < 1e-9);
  l.moveDirection(1, 0, dir);
  assert.ok(Math.abs(dir.z - 1) < 1e-9, 'W goes into the screen (+Z)');
  const r = new FollowRig({ ...C, azimuthDeg: 180 }, heightAt, 'right');
  r.moveDirection(0, 1, dir);
  assert.ok(Math.abs(dir.x - 1) < 1e-9 && Math.abs(dir.z) < 1e-9);
  r.moveDirection(1, 0, dir);
  assert.ok(Math.abs(dir.z + 1) < 1e-9);
  // 45 degree camera: D must be 90 degrees clockwise (seen from above, +X right / +Z up) from W in the left-handed world
  const d = new FollowRig(C, heightAt, 'left');
  d.moveDirection(1, 0, dir);
  const wx = dir.x, wz = dir.z;
  d.moveDirection(0, 1, dir);
  assert.ok(wx * dir.z - wz * dir.x < 0, 'right is clockwise of forward (x-z plane, z up)');
});

test('camera-relative input: unit length, W goes away from the camera, D is screen-right', () => {
  const rig = new FollowRig(C, heightAt);
  const fx = rig.forwardX, fz = rig.forwardZ;
  rig.moveDirection(1, 0, dir);
  assert.ok(Math.abs(dir.x - fx) < 1e-9 && Math.abs(dir.z - fz) < 1e-9, 'W = camera forward on the ground');
  rig.moveDirection(-1, 0, dir);
  assert.ok(Math.abs(dir.x + fx) < 1e-9 && Math.abs(dir.z + fz) < 1e-9, 'S = toward the camera');
  rig.moveDirection(0, 1, dir);
  assert.ok(Math.abs(dir.x - fz) < 1e-9 && Math.abs(dir.z - -fx) < 1e-9, 'D = right (left-handed default)');
  assert.ok(Math.abs(dir.x * fx + dir.z * fz) < 1e-9, 'right is perpendicular to forward');
  rig.moveDirection(1, 1, dir);
  assert.ok(Math.abs(Math.hypot(dir.x, dir.z) - 1) < 1e-9, 'diagonal normalised');
  rig.moveDirection(1, -1, dir);
  assert.ok(Math.abs(Math.hypot(dir.x, dir.z) - 1) < 1e-9);
  rig.moveDirection(0, 0, dir);
  assert.equal(Math.hypot(dir.x, dir.z), 0);
  rig.moveDirection(1, 0, dir);
  const wx = dir.x, wz = dir.z;
  rig.moveDirection(-1, 0, dir);
  assert.ok(Math.abs(dir.x + wx) < 1e-9 && Math.abs(dir.z + wz) < 1e-9);
});

test('camera sits behind/above the focus at the configured elevation and distance', () => {
  const rig = new FollowRig(C, heightAt);
  rig.snap(3, 0, -4);
  const dx = rig.focusX - rig.posX, dy = rig.focusY - rig.posY, dz = rig.focusZ - rig.posZ;
  assert.ok(Math.abs(Math.hypot(dx, dy, dz) - C.distance) < 1e-9);
  assert.ok(Math.abs(Math.atan2(-dy, Math.hypot(dx, dz)) * 180 / Math.PI - C.elevationDeg) < 1e-9);
  assert.ok(Math.abs(dx / Math.hypot(dx, dz) - rig.forwardX) < 1e-9, 'looks along the azimuth');
});

test('follow is frame-rate independent and has no overshoot or jitter', () => {
  const finals: number[] = [];
  for (const fps of [30, 60, 144]) {
    const rig = new FollowRig(C, heightAt);
    rig.snap(0, 0, 0);
    let prev = rig.focusZ;
    for (let i = 0; i < fps; i++) {
      rig.update(1 / fps, 0, 0, 8); // target jumps 8 m
      assert.ok(rig.focusZ >= prev - 1e-12 && rig.focusZ <= 8 + 1e-12, 'monotonic, no overshoot');
      prev = rig.focusZ;
    }
    finals.push(rig.focusZ);
  }
  assert.ok(Math.max(...finals) - Math.min(...finals) < 1e-9, finals.join(','));
});

test('camera trailing a constantly moving target has a constant lag (no wobble)', () => {
  const rig = new FollowRig(C, heightAt);
  rig.snap(0, 0, 0);
  let z = 0;
  const lags: number[] = [];
  for (let i = 0; i < 600; i++) {
    z += 4.2 / 60;
    rig.update(1 / 60, 0, 0, z);
    if (i > 300) lags.push(z - rig.focusZ);
  }
  assert.ok(Math.max(...lags) - Math.min(...lags) < 1e-3);
  assert.ok(lags[0] < 1.0, `lag ${lags[0]} m must keep the character well inside the view`);
});

test('camera never goes below terrain + clearance; zoom is clamped and smooth', () => {
  const rig = new FollowRig({ ...C, elevationDeg: 5, minClearance: 1.5 }, () => 10);
  rig.snap(0, 0, 0);
  assert.ok(rig.posY >= 11.5 - 1e-9);
  const z = new FollowRig(C, heightAt);
  z.snap(0, 0, 0);
  z.zoom(1000);
  for (let i = 0; i < 300; i++) z.update(1 / 60, 0, 0, 0);
  assert.ok(Math.abs(z.distance - C.maxDistance) < 1e-3);
  z.zoom(-1000);
  for (let i = 0; i < 300; i++) z.update(1 / 60, 0, 0, 0);
  assert.ok(Math.abs(z.distance - C.minDistance) < 1e-3);
});
