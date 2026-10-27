/* Browser check of the character UI (DOM only, no WebGL).  Needs playwright + esbuild, which are NOT project dependencies:
 *   NODE_PATH=<dir with playwright> ESBUILD=<path to esbuild> node tools/ui_harness/run.cjs [outDir]
 * Screenshots land in <outDir>/ui/. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const ROOT = path.resolve(__dirname, '..', '..');
const S = process.argv[2] || path.join(ROOT, 'tools', 'ui_harness', 'out');
fs.mkdirSync(path.join(S, 'ui'), { recursive: true });
// Build the page: index.html's body + src/style.css + a bundle of the REAL GameUi/InputController/GameSession (no Babylon).
const esbuild = process.env.ESBUILD || 'esbuild';
execFileSync(esbuild, [path.join(__dirname, 'entry.ts'), '--bundle', '--format=iife', '--outfile=' + path.join(S, 'ui', 'bundle.js')], { stdio: 'inherit' });
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
fs.writeFileSync(path.join(S, 'ui', 'page.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + fs.readFileSync(path.join(ROOT, 'src', 'style.css'), 'utf8') + '</style></head><body>' + body + '</body></html>');
(async () => {
  const b = await chromium.launch();
  const errors = [];
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.goto('file://' + S + '/ui/page.html');
  await p.addScriptTag({ path: S + '/ui/bundle.js' });
  await p.evaluate(() => { document.getElementById('loading').classList.add('done'); document.getElementById('game').focus(); });
  const txt = (sel) => p.locator(sel).first().innerText();
  const H = (fn, arg) => p.evaluate(fn, arg);

  // 1. status panel
  assert.match(await txt('.status-panel'), /Adventurer/);
  assert.match(await txt('.bar-row:nth-child(2) .bar-text'), /70 \/ 100/);
  assert.equal(await p.locator('.inv-panel').isVisible(), false, 'inventory starts closed');
  assert.equal(await p.locator('.prompt').isVisible(), false);
  await p.screenshot({ path: S + '/ui/s1_start.png' });

  // 2. walk next to a potion -> prompt -> E
  await H(() => h.setPose(2.0, 1.4));
  assert.match(await txt('.prompt'), /E\s+Pick up Health Potion/);
  await p.keyboard.press('e');
  assert.equal(await H(() => h.session.state.inventory.countOf('health_potion')), 1);
  assert.equal(await H(() => h.session.pickups.count), 9);
  await H(() => h.frame()); // the game calls ui.update() every frame
  assert.equal(await p.locator('.prompt').isVisible(), false, 'prompt gone after pickup');
  assert.match(await txt('.toast'), /Picked up Health Potion/);
  // holding E must not pick several items (auto-repeat): second pickup needs a new key press
  await H(() => h.setPose(-2.6, -2.0));
  await p.keyboard.down('e'); await p.keyboard.down('e'); await p.keyboard.down('e'); await p.keyboard.up('e');
  assert.equal(await H(() => h.session.state.inventory.countOf('health_potion')), 3, 'potion x2 taken once (stacked with the first)');

  // 3. open inventory with I, use potion
  await p.keyboard.press('i');
  assert.equal(await p.locator('.inv-panel').isVisible(), true);
  await p.locator('.grid .slot').first().click();
  assert.match(await txt('.details'), /Health Potion ×3/);
  await p.screenshot({ path: S + '/ui/s2_potion.png' });
  await p.getByRole('button', { name: 'Use', exact: true }).click();
  assert.equal(await H(() => h.session.state.profile.hp), 100, '70 + 40 clamped to 100');
  assert.equal(await H(() => h.session.state.inventory.countOf('health_potion')), 2);
  assert.equal(await p.getByRole('button', { name: 'Use', exact: true }).isDisabled(), true, 'Use disabled at full HP');
  assert.match(await txt('.bar-row:nth-child(2) .bar-text'), /100 \/ 100/);

  // 4. collect everything, equip all four
  for (const [x, z] of [[0.2, 3.6], [-3.8, 2.8], [3.6, -3.4], [-4.2, -3.6], [1.4, -5], [5.4, -1], [-1.4, 5.2], [-5.6, 0.4]]) {
    await H(([x, z]) => h.setPose(x, z), [x, z]);
    await p.keyboard.press('e');
  }
  assert.equal(await H(() => h.session.pickups.count), 0, 'all ten pickups collected');
  const names = ['Wooden Sword', 'Iron Helmet', 'Traveler Armor', 'Leather Boots'];
  for (const n of names) {
    await p.locator(`.grid .slot[aria-label="${n}"]`).click();
    await p.getByRole('button', { name: 'Equip', exact: true }).click();
  }
  assert.deepEqual(await H(() => h.session.state.equipment.snapshot()), { weapon: 'wooden_sword', helmet: 'iron_helmet', armor: 'traveler_armor', boots: 'leather_boots' });
  const statsText = await txt('.stats-grid');
  assert.match(statsText, /Attack\s*13\s*\(\+4\)/);
  assert.match(statsText, /Defense\s*12\s*\(\+9\)/);
  assert.match(statsText, /Move speed\s*108%\s*\(\+8%\)/);
  assert.equal(await p.locator('.worn .slot.filled').count(), 4);
  await p.screenshot({ path: S + '/ui/s3_equipped.png' });
  // tooltip of an equipped item
  assert.match(await p.locator('.worn .slot.filled').nth(3).getAttribute('title'), /Leather Boots[\s\S]*\+8% Move speed/);

  // 5. unequip + drop
  await p.locator('.worn .slot.filled').first().click();
  await p.getByRole('button', { name: 'Unequip' }).click();
  assert.equal(await H(() => h.session.state.equipment.get('weapon')), null);
  await p.locator(`.grid .slot[aria-label="Wooden Sword"]`).click();
  await H(() => { h.pose.x = 0; h.pose.z = 0; });
  await p.getByRole('button', { name: 'Drop', exact: true }).click();
  assert.equal(await H(() => h.session.pickups.count), 1);
  assert.equal(await H(() => h.session.state.inventory.countOf('wooden_sword')), 0);
  await H(() => h.setPose(0, 1.1));
  assert.match(await txt('.prompt'), /Pick up Wooden Sword/);
  await p.keyboard.press('e');
  assert.equal(await H(() => h.session.state.inventory.countOf('wooden_sword')), 1);
  // stack: drop 1 of the wood
  await p.locator('.grid .slot[aria-label^="Wood ×"]').click();
  const woodBefore = await H(() => h.session.state.inventory.countOf('wood'));
  await p.getByRole('button', { name: 'Drop 1' }).click();
  assert.equal(await H(() => h.session.state.inventory.countOf('wood')), woodBefore - 1);

  // 6. full inventory: pickup refused, unequip refused
  await H(() => { h.session.debugFillInventory(); });
  await H(() => h.session.pickups.spawn('stone', 1, 0.3, 0.3));
  await H(() => h.setPose(0.3, 0.3));
  const stones = await H(() => h.session.state.inventory.countOf('stone'));
  await p.keyboard.press('e');
  // stone stack still has room (5 + 1), so it is accepted even when no slot is free
  assert.equal(await H(() => h.session.state.inventory.countOf('stone')), stones + 1);
  await H(() => h.session.pickups.spawn('health_potion', 1, 0.3, 0.3));
  await H(() => h.setPose(0.31, 0.3));
  // potion stack (2) also has room... use a sword-like item that cannot stack instead
  await H(() => h.session.pickups.spawn('iron_helmet', 1, 0.3, 0.3));
  await H(() => { for (const q of [...h.session.pickups.all()]) if (q.id !== 'iron_helmet') h.session.pickups.remove(q.uid); });
  await p.keyboard.press('e');
  assert.equal(await H(() => h.session.pickups.count), 1, 'helmet stays in the world');
  assert.match(await txt('.toast:last-child'), /Inventory full/);
  await p.locator('.worn .slot.filled').first().click();
  assert.equal(await p.getByRole('button', { name: 'Unequip' }).isDisabled(), true, 'unequip disabled while the bag is full');
  await p.screenshot({ path: S + '/ui/s4_full.png' });

  // 7. typing in the rename field must not trigger shortcuts or movement
  await p.locator('.name-btn').click();
  const inputBox = p.locator('.name-input');
  assert.equal(await inputBox.isVisible(), true);
  await inputBox.fill('');
  await p.keyboard.type('Zoe Iie w');
  assert.equal(await p.locator('.inv-panel').isVisible(), true, 'typing "i" did not toggle the inventory');
  assert.equal(await H(() => h.session.pickups.count), 1, 'typing "e" did not interact');
  const mv = await H(() => h.frame());
  assert.deepEqual(mv, { forward: 0, right: 0 }, 'typing w/a/s/d does not move the character');
  await p.keyboard.press('Enter');
  assert.equal(await txt('.name-btn'), 'Zoe Iie w');
  // empty names are rejected
  await p.locator('.name-btn').click();
  await p.locator('.name-input').fill('   ');
  await p.keyboard.press('Enter');
  assert.equal(await txt('.name-btn'), 'Zoe Iie w');
  // XSS-ish name is shown as text
  await p.locator('.name-btn').click();
  await p.locator('.name-input').fill('<img src=x onerror=alert(1)>');
  await p.keyboard.press('Enter');
  assert.equal(await p.locator('.status-panel img').count(), 0);

  // 8. movement keys still work when not typing; Escape and I close
  await p.keyboard.down('w');
  assert.deepEqual(await H(() => h.frame()), { forward: 1, right: 0 });
  await p.keyboard.up('w');
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('.inv-panel').isVisible(), false, 'Escape closes');
  await p.keyboard.press('i');
  assert.equal(await p.locator('.inv-panel').isVisible(), true);
  await p.keyboard.press('i');
  assert.equal(await p.locator('.inv-panel').isVisible(), false);
  await p.locator('.inv-toggle').click();
  assert.equal(await p.locator('.inv-panel').isVisible(), true, 'toggle button works');
  await p.locator('.inv-panel .icon-btn').click();
  assert.equal(await p.locator('.inv-panel').isVisible(), false, 'close button works');

  // 9. HP bar updates live; low-HP style
  await H(() => h.session.state.damage(90));
  assert.match(await txt('.bar-row:nth-child(2) .bar-text'), /10 \/ 100/);
  assert.equal(await p.locator('.fill.hp.low').count(), 1);
  await H(() => h.session.state.gainXp(150));
  assert.match(await txt('.level'), /Lv 2/);
  await p.screenshot({ path: S + '/ui/s5_lowhp.png' });

  // 10. mobile layout
  await p.setViewportSize({ width: 390, height: 844 });
  await p.keyboard.press('i');
  await p.screenshot({ path: S + '/ui/s6_mobile.png' });
  const box = await p.locator('.inv-panel').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390 + 0.5, 'panel fits the phone width');
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(sw <= 390, 'no horizontal scroll');

  console.log('UI checks passed. page errors:', JSON.stringify(errors));
  await b.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
