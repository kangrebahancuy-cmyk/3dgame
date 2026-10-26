import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../src/world/collision';
import { heightAt } from '../src/world/terrain';

test('the forest map is perfectly flat: walkable ground is y = 0 everywhere', () => {
  for (let x = -70; x <= 70; x += 1.3) for (let z = -70; z <= 70; z += 1.1) assert.equal(heightAt(x, z), 0);
});

test('rectangular bounds clamp the body inside the square and remove only the outward velocity', () => {
  const w = new CollisionWorld();
  w.setRectBounds(32, 32);
  const b = { x: 31.9, z: 5, vx: 3, vz: 2 };
  assert.equal(w.resolve(b, 0.38), true);
  assert.ok(Math.abs(b.x - (32 - 0.38)) < 1e-9);
  assert.equal(b.vx, 0);
  assert.equal(b.vz, 2, 'tangential velocity is kept: the player slides along the edge');
  const c = { x: -40, z: -40, vx: -1, vz: -1 };
  w.resolve(c, 0.38);
  assert.ok(Math.abs(c.x + 31.62) < 1e-9 && Math.abs(c.z + 31.62) < 1e-9);
  const inside = { x: 0, z: 0, vx: 1, vz: 1 };
  assert.equal(w.resolve(inside, 0.38), false);
});

