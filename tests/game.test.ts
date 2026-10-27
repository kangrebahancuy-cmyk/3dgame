import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config';
import { MovementModel } from '../src/character/MovementModel';
import { Equipment } from '../src/game/equipment';
import { Inventory } from '../src/game/inventory';
import { EQUIP_SLOTS, equipSlotOf, getItem, ITEM_IDS, ITEMS, type ItemId } from '../src/game/items';
import { INTERACT_RANGE, PickupSystem } from '../src/game/pickups';
import { PlayerState, type GameMessage } from '../src/game/playerState';
import { GameSession, INITIAL_PICKUPS } from '../src/game/session';
import { deriveStats, MAX_MOVE_SPEED_BONUS, newCharacter, sanitizeName, xpForLevel } from '../src/game/stats';
import { actionForKey, isTypingTarget } from '../src/input/shortcuts';
import { generateForestLayout } from '../src/world/forest/ForestLayout';
import { FOREST_MAP } from '../src/world/forest/MapConfiguration';

function fresh(): { s: PlayerState; msgs: GameMessage[]; changes: () => number } {
  const s = new PlayerState();
  const msgs: GameMessage[] = [];
  let n = 0;
  s.onMessage((m) => msgs.push(m));
  s.onChange(() => n++);
  return { s, msgs, changes: () => n };
}
const slotOf = (s: PlayerState, id: ItemId): number => {
  for (let i = 0; i < s.inventory.capacity; i++) if (s.inventory.at(i)?.id === id) return i;
  return -1;
};

// ------------------------------------------------------------------------------------------ definitions

test('items: central registry with unique ids, sane stacks, and every required sample item', () => {
  for (const id of ['health_potion', 'wooden_sword', 'iron_helmet', 'traveler_armor', 'leather_boots', 'wood', 'stone']) assert.ok(ITEMS[id as ItemId], id);
  assert.equal(new Set(ITEM_IDS).size, ITEM_IDS.length);
  for (const id of ITEM_IDS) {
    const d = getItem(id);
    assert.equal(d.id, id);
    assert.ok(d.name && d.description && d.icon.shape && d.icon.color);
    assert.ok(Number.isInteger(d.maxStack) && d.maxStack >= 1);
    if (equipSlotOf(d)) assert.equal(d.maxStack, 1, `${id}: equipment must not stack`);
    if (d.type === 'material') assert.ok(d.maxStack > 1, `${id} materials stack`);
  }
  assert.ok((ITEMS.leather_boots.bonus?.moveSpeed ?? 0) > 0, 'boots carry the optional speed bonus');
  assert.equal(equipSlotOf(ITEMS.health_potion), null);
  assert.deepEqual(EQUIP_SLOTS, ['weapon', 'helmet', 'armor', 'boots']);
});

// ------------------------------------------------------------------------------------------ character

test('character: sensible start data, HP in range, XP curve grows', () => {
  const { s } = fresh();
  assert.equal(s.profile.name, 'Adventurer');
  assert.equal(s.profile.level, 1);
  assert.ok(s.profile.hp > 0 && s.profile.hp < s.stats.maxHp, 'starts hurt so the potion can be tested');
  assert.ok(s.profile.xp >= 0 && s.profile.xp < s.stats.xpToNext);
  assert.equal(s.stats.maxHp, 100);
  for (let l = 1; l < 49; l++) assert.ok(xpForLevel(l + 1) > xpForLevel(l));
});

test('character: HP never goes below 0 or above max, whatever happens', () => {
  const { s } = fresh();
  s.damage(1e9);
  assert.equal(s.profile.hp, 0);
  s.heal(1e9);
  assert.equal(s.profile.hp, s.stats.maxHp);
  s.damage(-50); s.heal(-50); s.damage(NaN); s.heal(NaN);
  assert.equal(s.profile.hp, s.stats.maxHp, 'negative / NaN amounts are ignored');
  s.profile.hp = 9999; // corrupted on purpose
  s.profile.mana = -5;
  s.refresh();
  assert.equal(s.profile.hp, s.stats.maxHp);
  assert.equal(s.profile.mana, 0);
});

test('character: XP levels up (several levels at once), refills HP, and stats follow the level', () => {
  const { s, msgs } = fresh();
  const maxBefore = s.stats.maxHp;
  s.gainXp(10);
  assert.equal(s.profile.level, 1);
  s.gainXp(xpForLevel(1) + xpForLevel(2)); // enough for two levels
  assert.equal(s.profile.level, 3);
  assert.ok(s.profile.xp >= 0 && s.profile.xp < s.stats.xpToNext);
  assert.ok(s.stats.maxHp > maxBefore);
  assert.equal(s.profile.hp, s.stats.maxHp);
  assert.ok(msgs.some((m) => m.text.includes('Level up')));
  s.gainXp(1e12);
  assert.equal(s.profile.level, 50, 'level cap');
  assert.ok(s.profile.xp < s.stats.xpToNext);
});

test('character: names are sanitised (length, control characters, empty rejected)', () => {
  assert.equal(sanitizeName('  Aria\u0000  \n the   Bold and very long name '), 'Aria the Bold an');
  const { s } = fresh();
  assert.equal(s.rename('   ').ok, false);
  assert.equal(s.profile.name, 'Adventurer');
  assert.equal(s.rename('<b>Zed</b>').ok, true);
  assert.equal(s.profile.name, '<b>Zed</b>', 'stored verbatim; the UI only ever uses textContent');
});

// ------------------------------------------------------------------------------------------ inventory

test('inventory: 24 slots, stacking follows maxStack, split across slots, merges back', () => {
  const inv = new Inventory();
  assert.equal(inv.capacity, 24);
  assert.equal(inv.add('wood', 30).added, 30);
  assert.equal(inv.add('wood', 30).added, 30); // 50 + 10 -> two stacks
  assert.deepEqual([inv.at(0)?.qty, inv.at(1)?.qty], [50, 10]);
  assert.equal(inv.countOf('wood'), 60);
  inv.add('wood', 40); // tops the second stack up to 50
  assert.deepEqual([inv.at(0)?.qty, inv.at(1)?.qty, inv.at(2)], [50, 50, null]);
  inv.add('wooden_sword', 1);
  inv.add('wooden_sword', 1);
  assert.equal(inv.freeSlots, 24 - 4, 'swords never stack');
  assert.equal(inv.add('health_potion', 25).added, 25, '10 + 10 + 5');
  assert.equal(inv.countOf('health_potion'), 25);
});

test('inventory: adding is all-or-nothing and a full inventory is safe', () => {
  const inv = new Inventory(3);
  inv.add('wooden_sword', 1);
  inv.add('iron_helmet', 1);
  inv.add('wood', 49);
  assert.ok(inv.isFull);
  assert.equal(inv.add('wood', 1).added, 1, 'fits into the partial stack');
  assert.equal(inv.add('wood', 1).added, 0, 'now truly full');
  const before = inv.snapshot();
  assert.equal(inv.add('stone', 1).added, 0);
  assert.equal(inv.add('wood', 5).added, 0);
  assert.deepEqual(inv.snapshot(), before, 'a refused add changes nothing');
  for (const bad of [0, -1, 1.5, NaN]) assert.equal(inv.canAdd('wood', bad), false);
  assert.equal(inv.take(0, 0), null);
  assert.equal(inv.take(99, 1), null);
});

test('inventory: take removes exactly what was asked and frees emptied slots', () => {
  const inv = new Inventory();
  inv.add('wood', 7);
  assert.deepEqual(inv.take(0, 3), { id: 'wood', qty: 3 });
  assert.equal(inv.at(0)?.qty, 4);
  assert.deepEqual(inv.take(0, 100), { id: 'wood', qty: 4 });
  assert.equal(inv.at(0), null);
  assert.equal(inv.totalItems(), 0);
});

// ------------------------------------------------------------------------------------------ potion

test('potion: heals, is consumed, and cannot be used at full HP (and then is NOT consumed)', () => {
  const { s, msgs } = fresh();
  s.pickUp('health_potion', 2);
  const slot = slotOf(s, 'health_potion');
  s.profile.hp = 30;
  let r = s.use(slot);
  assert.equal(r.ok, true);
  assert.equal(s.profile.hp, 70);
  assert.equal(s.inventory.at(slot)?.qty, 1);
  s.profile.hp = 90;
  r = s.use(slot);
  assert.equal(s.profile.hp, 100, 'heal is clamped to max HP');
  assert.equal(s.inventory.at(slot), null, 'last potion consumed');
  s.pickUp('health_potion', 1);
  const again = slotOf(s, 'health_potion');
  r = s.use(again);
  assert.equal(r.ok, false);
  assert.match(r.message, /full/i);
  assert.equal(s.inventory.at(again)?.qty, 1, 'refused use keeps the potion');
  assert.equal(msgs.at(-1)?.kind, 'error');
});

test('use: only consumables; materials and equipment are refused and untouched', () => {
  const { s } = fresh();
  s.pickUp('wood', 3);
  s.pickUp('wooden_sword', 1);
  assert.equal(s.use(slotOf(s, 'wood')).ok, false);
  assert.equal(s.use(slotOf(s, 'wooden_sword')).ok, false);
  assert.equal(s.use(23).ok, false, 'empty slot');
  assert.equal(s.inventory.countOf('wood'), 3);
  assert.equal(s.inventory.countOf('wooden_sword'), 1);
});

// ------------------------------------------------------------------------------------------ equipment

test('equipment: only the matching item type fits each slot', () => {
  for (const slot of EQUIP_SLOTS) for (const id of ITEM_IDS) assert.equal(Equipment.accepts(slot, id), equipSlotOf(getItem(id)) === slot);
  const eq = new Equipment();
  assert.equal(eq.set('helmet', 'wooden_sword'), undefined, 'a sword cannot be worn as a helmet');
  assert.equal(eq.get('helmet'), null);
  assert.equal(eq.set('weapon', 'health_potion'), undefined);
  assert.equal(eq.set('weapon', 'wooden_sword'), null);
});

test('equip: item leaves the inventory, goes into the right slot, stats are applied once', () => {
  const { s } = fresh();
  const base = { ...s.stats };
  s.pickUp('wooden_sword', 1);
  s.pickUp('iron_helmet', 1);
  s.pickUp('traveler_armor', 1);
  s.pickUp('leather_boots', 1);
  for (const id of ['wooden_sword', 'iron_helmet', 'traveler_armor', 'leather_boots'] as const) assert.ok(s.equip(slotOf(s, id)).ok);
  assert.deepEqual(s.equipment.snapshot(), { weapon: 'wooden_sword', helmet: 'iron_helmet', armor: 'traveler_armor', boots: 'leather_boots' });
  assert.equal(s.inventory.totalItems(), 0, 'equipped items are not also in the inventory');
  assert.equal(s.stats.attack, base.attack + 4);
  assert.equal(s.stats.defense, base.defense + 3 + 5 + 1);
  assert.ok(Math.abs(s.stats.moveSpeedMultiplier - 1.08) < 1e-12);
  assert.equal(s.stats.maxHp, base.maxHp);
});

test('equip: non-equippable items are refused and nothing changes', () => {
  const { s } = fresh();
  s.pickUp('health_potion', 1);
  s.pickUp('wood', 5);
  const before = s.inventory.snapshot();
  assert.equal(s.equip(slotOf(s, 'health_potion')).ok, false);
  assert.equal(s.equip(slotOf(s, 'wood')).ok, false);
  assert.equal(s.equip(20).ok, false);
  assert.deepEqual(s.inventory.snapshot(), before);
  assert.deepEqual(s.equipment.snapshot(), { weapon: null, helmet: null, armor: null, boots: null });
});

test('equip over an occupied slot swaps: the old item returns to the slot just freed, nothing duplicated or lost', () => {
  const { s } = fresh();
  s.inventory.add('wooden_sword', 1); // two different weapons would need a second weapon id; use the same id twice
  s.inventory.add('wooden_sword', 1);
  const total = s.inventory.totalItems();
  assert.ok(s.equip(0).ok);
  assert.equal(s.inventory.totalItems() + 1, total);
  assert.ok(s.equip(1).ok, 'second sword swaps with the first');
  assert.equal(s.equipment.get('weapon'), 'wooden_sword');
  assert.equal(s.inventory.at(1)?.id, 'wooden_sword', 'the replaced sword took the freed slot');
  assert.equal(s.inventory.totalItems() + 1, total, 'still exactly one sword worn plus one in the bag');
  assert.equal(s.stats.attack, deriveStats(s.profile, []).attack + 4, 'the bonus is NOT applied twice');
});

test('unequip: returns the item to the inventory; refused (and unchanged) while the inventory is full', () => {
  const { s } = fresh();
  s.pickUp('iron_helmet', 1);
  s.equip(slotOf(s, 'iron_helmet'));
  assert.equal(s.unequip('helmet').ok, true);
  assert.equal(s.equipment.get('helmet'), null);
  assert.equal(s.inventory.countOf('iron_helmet'), 1);
  assert.equal(s.unequip('helmet').ok, false, 'empty slot');
  // full inventory
  s.equip(slotOf(s, 'iron_helmet'));
  while (!s.inventory.isFull) s.inventory.add('wooden_sword', 1);
  const before = s.inventory.snapshot();
  const defense = s.stats.defense;
  const r = s.unequip('helmet');
  assert.equal(r.ok, false);
  assert.match(r.message, /full/i);
  assert.equal(s.equipment.get('helmet'), 'iron_helmet', 'still worn');
  assert.deepEqual(s.inventory.snapshot(), before);
  assert.equal(s.stats.defense, defense);
  // free one slot -> now it works
  s.inventory.take(0, 1);
  s.refresh();
  assert.equal(s.unequip('helmet').ok, true);
  assert.equal(s.inventory.countOf('iron_helmet'), 1);
});

test('equipping while the inventory is full still works (the freed slot is reused)', () => {
  const { s } = fresh();
  while (!s.inventory.isFull) s.inventory.add(s.inventory.freeSlots % 2 ? 'iron_helmet' : 'leather_boots', 1);
  const slot = slotOf(s, 'iron_helmet');
  assert.ok(s.equip(slot).ok);
  assert.equal(s.equipment.get('helmet'), 'iron_helmet');
  assert.equal(s.inventory.freeSlots, 1);
});

test('stats stay consistent after equipment is changed many times (no accumulating bonuses)', () => {
  const { s } = fresh();
  const base = deriveStats(s.profile, []);
  const bag: ItemId[] = ['wooden_sword', 'iron_helmet', 'traveler_armor', 'leather_boots'];
  for (const id of bag) s.pickUp(id, 1);
  const total = s.inventory.totalItems();
  for (let round = 0; round < 200; round++) {
    const id = bag[round % 4];
    const slot = slotOf(s, id);
    if (slot >= 0) assert.ok(s.equip(slot).ok);
    else assert.ok(s.unequip(equipSlotOf(getItem(id))!).ok);
    const worn = EQUIP_SLOTS.filter((sl) => s.equipment.get(sl));
    const expected = deriveStats(s.profile, s.equipment.items());
    assert.deepEqual({ ...s.stats }, { ...expected });
    assert.equal(s.inventory.totalItems() + worn.length, total, 'items are conserved');
  }
  for (const sl of EQUIP_SLOTS) if (s.equipment.get(sl)) s.unequip(sl);
  assert.deepEqual({ ...s.stats }, { ...base }, 'back to the base stats exactly');
});

test('movement bonus is clamped and only ever from boots', () => {
  const huge = { ...ITEMS.leather_boots, bonus: { moveSpeed: 5 } };
  assert.equal(deriveStats(newCharacter(), [huge]).moveSpeedMultiplier, 1 + MAX_MOVE_SPEED_BONUS);
  const neg = { ...ITEMS.leather_boots, bonus: { moveSpeed: -1 } };
  assert.equal(deriveStats(newCharacter(), [neg]).moveSpeedMultiplier, 1, 'never slower than normal');
  assert.equal(deriveStats(newCharacter(), []).moveSpeedMultiplier, 1);
});

test('maxHp bonuses (future items) keep HP inside the new maximum when equipment is removed', () => {
  const registry = ITEMS as unknown as Record<string, unknown>;
  const original = registry.wooden_sword;
  registry.wooden_sword = { ...ITEMS.wooden_sword, bonus: { attack: 4, maxHp: 50 } };
  try {
    const s = new PlayerState();
    s.pickUp('wooden_sword', 1);
    s.equip(0);
    s.heal(1e6);
    assert.equal(s.profile.hp, 150);
    s.unequip('weapon');
    assert.equal(s.profile.hp, 100, 'HP clamped to the reduced maximum');
  } finally {
    registry.wooden_sword = original;
  }
  assert.equal(ITEMS.wooden_sword.bonus?.maxHp, undefined);
});

// ------------------------------------------------------------------------------------------ movement integration

test('speed multiplier is opt-in: MovementModel is unchanged at 1 and scales cruise speed when set', () => {
  const cruise = (mult: number | null): number => {
    const m = new MovementModel(DEFAULT_CONFIG.movement);
    if (mult !== null) m.speedScale = mult;
    for (let i = 0; i < 300; i++) m.step(1 / 60, 0, 1, true);
    return m.speed;
  };
  const base = cruise(null);
  assert.ok(Math.abs(base - DEFAULT_CONFIG.movement.runSpeed) < 0.01);
  assert.equal(cruise(1), base);
  assert.ok(Math.abs(cruise(1.08) / base - 1.08) < 1e-6);
});

// ------------------------------------------------------------------------------------------ drop + pickups

test('drop: removes from the inventory and creates exactly one world pickup (nothing duplicated)', () => {
  const g = new GameSession();
  g.state.pickUp('wood', 5);
  g.state.pickUp('wooden_sword', 1);
  const woodSlot = slotOf(g.state, 'wood');
  assert.equal(g.drop(woodSlot, 1, 0, 0, 0), true);
  assert.equal(g.state.inventory.countOf('wood'), 4);
  assert.equal(g.pickups.count, 1);
  const p = [...g.pickups.all()][0];
  assert.deepEqual([p.id, p.qty], ['wood', 1]);
  assert.ok(Math.abs(p.z - 1.1) < 1e-9 && Math.abs(p.x) < 1e-9, 'lands in front of the player (yaw 0 = +z)');
  assert.equal(g.drop(woodSlot, 'all', 0, 0, 0), true);
  assert.equal(g.state.inventory.countOf('wood'), 0);
  assert.equal([...g.pickups.all()].reduce((n, q) => n + (q.id === 'wood' ? q.qty : 0), 0), 5, 'the 5 wood are conserved in the world');
  assert.equal(g.drop(woodSlot, 'all', 0, 0, 0), false, 'empty slot');
  assert.equal(g.drop(0, 0, 0, 0, 0), false, 'qty 0');
  // equipped items cannot be dropped
  g.state.equip(slotOf(g.state, 'wooden_sword'));
  assert.equal(g.state.equipment.get('weapon'), 'wooden_sword');
  assert.equal(g.drop(slotOf(g.state, 'wooden_sword'), 'all', 0, 0, 0), false);
});

test('drop near the map edge stays inside the walkable square', () => {
  const g = new GameSession();
  g.state.pickUp('stone', 1);
  g.drop(0, 1, 31.9, 31.9, Math.PI / 4);
  const p = [...g.pickups.all()][0];
  assert.ok(Math.abs(p.x) <= 32 && Math.abs(p.z) <= 32);
});

test('pickup: E takes the nearest item in range, removes it from the world, and never twice', () => {
  const g = new GameSession();
  g.pickups.spawn('health_potion', 1, 5, 5);
  const near = g.pickups.spawn('stone', 2, 1, 0);
  g.pickups.spawn('wood', 1, 1.5, 0);
  assert.equal(g.promptTarget(0, 0)?.uid, near.uid, 'closest first');
  assert.equal(g.promptTarget(20, 20), null);
  assert.equal(g.interact(0, 0), true);
  assert.equal(g.state.inventory.countOf('stone'), 2);
  assert.equal(g.pickups.has(near.uid), false);
  assert.equal(g.pickups.count, 2);
  assert.equal(g.promptTarget(0, 0)?.id, 'wood', 'next one becomes the target');
  assert.ok(INTERACT_RANGE >= 1 && INTERACT_RANGE <= 3);
  assert.equal(g.pickups.remove(near.uid), false, 'cannot be removed twice');
});

test('pickup: with a full inventory the item stays in the world and the player is told', () => {
  const g = new GameSession();
  const msgs: GameMessage[] = [];
  g.state.onMessage((m) => msgs.push(m));
  g.debugFillInventory();
  assert.ok(g.state.inventory.isFull);
  const p = g.pickups.spawn('health_potion', 1, 0.5, 0.5);
  assert.equal(g.interact(0, 0), false);
  assert.ok(g.pickups.has(p.uid), 'pickup still lying there');
  assert.match(msgs.at(-1)?.text ?? '', /Inventory full/);
  assert.equal(msgs.at(-1)?.kind, 'error');
  // a stack that still fits into an existing partial stack is accepted even though no slot is free
  const g2 = new GameSession();
  g2.state.pickUp('wood', 10);
  g2.debugFillInventory();
  g2.pickups.spawn('wood', 5, 0.5, 0.5);
  assert.equal(g2.interact(0, 0), true);
  assert.equal(g2.state.inventory.countOf('wood'), 15);
});

test('pickup: a drop followed by a pickup returns exactly the dropped amount', () => {
  const g = new GameSession();
  g.state.pickUp('wood', 12);
  const total = g.state.inventory.countOf('wood');
  g.drop(0, 5, 3, 3, 0);
  g.drop(0, 'all', 3, 3, 0);
  assert.equal(g.state.inventory.countOf('wood'), 0);
  for (let i = 0; i < 5; i++) g.interact(3, 4.1);
  assert.equal(g.state.inventory.countOf('wood'), total);
  assert.equal(g.pickups.count, 0);
});

test('pickup system: nearest() is allocation-free and handles empty worlds', () => {
  const ps = new PickupSystem();
  assert.equal(ps.nearest(0, 0), null);
  ps.spawn('wood', 1, 0, 1.9);
  assert.ok(ps.nearest(0, 0));
  assert.equal(ps.nearest(0, 0, 1.8), null, 'range is respected');
});

test('initial pickups: all sample items exist, lie on open ground inside the spawn clearing, and are reachable', () => {
  const ids = new Set(INITIAL_PICKUPS.map((p) => p[0]));
  for (const id of ['health_potion', 'wooden_sword', 'iron_helmet', 'traveler_armor', 'leather_boots', 'wood', 'stone'] as const) assert.ok(ids.has(id), id);
  const layout = generateForestLayout(FOREST_MAP);
  const { clearing } = FOREST_MAP;
  for (const [id, qty, x, z] of INITIAL_PICKUPS) {
    assert.ok(qty >= 1 && qty <= getItem(id).maxStack);
    assert.ok(Math.hypot(x - clearing.x, z - clearing.z) < clearing.radius - 1, `${id} inside the clearing`);
    for (const c of layout.solids) assert.ok(Math.hypot(x - c.x, z - c.z) > c.r + DEFAULT_CONFIG.movement.playerRadius + 0.8, `${id} at (${x}, ${z}) is next to a solid`);
  }
  // the starter gear alone must fit the bag
  const g = new GameSession();
  g.spawnInitialPickups();
  assert.equal(g.pickups.count, INITIAL_PICKUPS.length);
  for (const p of [...g.pickups.all()]) assert.ok(g.state.pickUp(p.id, p.qty).ok);
});

// ------------------------------------------------------------------------------------------ input guard

test('shortcuts: I, E and Escape map to actions; modifiers, key repeat and typing are ignored', () => {
  const key = (code: string, extra: Partial<Parameters<typeof actionForKey>[0]> = {}) =>
    actionForKey({ code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: { tagName: 'CANVAS' }, ...extra });
  assert.equal(key('KeyI'), 'toggleInventory');
  assert.equal(key('KeyE'), 'interact');
  assert.equal(key('Escape'), 'closePanels');
  assert.equal(key('KeyW'), null);
  assert.equal(key('KeyE', { repeat: true }), null, 'holding E does not pick up repeatedly');
  assert.equal(key('KeyI', { ctrlKey: true }), null);
  assert.equal(key('KeyI', { target: { tagName: 'INPUT' } }), null, 'typing "i" in a text field');
  assert.equal(key('KeyE', { target: { tagName: 'textarea' } }), null);
  assert.equal(key('KeyE', { target: { tagName: 'DIV', isContentEditable: true } }), null);
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
});

// ------------------------------------------------------------------------------------------ events

test('every successful action notifies listeners exactly once; failures never touch state', () => {
  const { s, changes, msgs } = fresh();
  const c0 = changes();
  s.pickUp('health_potion', 1);
  assert.equal(changes(), c0 + 1);
  s.use(0);
  assert.equal(changes(), c0 + 2);
  const c1 = changes();
  s.use(5); // empty slot
  s.equip(5);
  s.unequip('weapon');
  assert.equal(changes(), c1, 'failed actions do not fire change events');
  assert.equal(msgs.filter((m) => m.kind === 'error').length, 3);
});
