/* Browser check of the COMBAT UI (DOM only, no WebGL): real CombatSystem + CombatUi + GameUi in Chromium.
 *   NODE_PATH=<dir with playwright> ESBUILD=<path to esbuild> node tools/ui_harness/combat_run.cjs [outDir]
 * Screenshots land in <outDir>/combat/. The 3D side (models, effects, picking) is NOT covered here. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const ROOT = path.resolve(__dirname, '..', '..');
const S = process.argv[2] || path.join(ROOT, 'tools', 'ui_harness', 'out');
fs.mkdirSync(path.join(S, 'combat'), { recursive: true });
const esbuild = process.env.ESBUILD || 'esbuild';
execFileSync(esbuild, [path.join(__dirname, 'combat_entry.ts'), '--bundle', '--format=iife', '--outfile=' + path.join(S, 'combat', 'bundle.js')], { stdio: 'inherit' });
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
fs.writeFileSync(path.join(S, 'combat', 'page.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + fs.readFileSync(path.join(ROOT, 'src', 'style.css'), 'utf8') + '</style></head><body>' + body + '</body></html>');

const overlap = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function open(browser, w, h) {
  const errors = [];
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.goto('file://' + S + '/combat/page.html');
  await p.addScriptTag({ path: S + '/combat/bundle.js' });
  await p.evaluate(() => { document.getElementById('loading').classList.add('done'); document.getElementById('game').focus(); });
  return { p, errors };
}

(async () => {
  const b = await chromium.launch();
  const { p, errors } = await open(b, 1280, 720);
  const H = (fn, arg) => p.evaluate(fn, arg);
  const txt = (sel) => p.locator(sel).first().innerText();
  const box = (sel) => p.locator(sel).first().boundingBox();

  // 1. initial state: hotbar with the three data-driven skills, no target frame, no death overlay
  assert.equal(await p.locator('.hotbar .skill').count(), 3);
  assert.deepEqual(await p.locator('.skill-key').allInnerTexts(), ['1', '2', '3']);
  assert.equal(await p.locator('.target-frame').isVisible(), false);
  assert.equal(await p.locator('.death-panel').isVisible(), false);
  assert.equal(await p.locator('.status-panel').isVisible(), true, 'the status panel is untouched');

  // 2. Tab selects the nearest monster -> target frame with name, level, HP
  await H(() => h.step(1 / 60, 3));
  await p.keyboard.press('Tab');
  await H(() => h.step());
  assert.equal(await p.locator('.target-frame').isVisible(), true);
  assert.match(await txt('.tf-name'), /Ash Walker/);
  assert.match(await txt('.tf-level'), /Lv 1/);
  assert.match(await txt('.tf-hp'), /40 \/ 40/);
  assert.equal(await H(() => h.combat.targeting.targetId), 1);
  assert.equal(await p.locator('.mob-bar.targeted').count(), 1, 'its health bar floats over it');

  // 3. too far: the attack is refused, with visible feedback (toast, frame state, slot shake)
  await p.keyboard.press('1');
  await H(() => h.step());
  assert.match(await txt('.toasts'), /too far/i);
  assert.equal(await p.locator('.target-frame.far').count(), 1);
  assert.match(await txt('.tf-hint'), /Out of range/);
  assert.equal(await H(() => h.combat.monsters.get(1).hp), 40);
  assert.equal(await H(() => h.combat.skills.remaining('basic_attack')), 0, 'no cooldown for a refused attack');
  await p.screenshot({ path: S + '/combat/c1_out_of_range.png' });

  // 4. step into reach, attack with the key: floating number, HP drops, slot cools down
  await H(() => { h.setPose(0, 1.2); h.step(); });
  assert.equal(await p.locator('.target-frame.far').count(), 0);
  await p.keyboard.press('1');
  await H(() => h.step(1 / 60, 2));
  const hp = await H(() => h.combat.monsters.get(1).hp);
  assert.ok(hp < 40 || (await p.locator('.dmg.miss').count()) === 1, 'damage or an honest miss');
  assert.ok((await p.locator('.dmg').count()) >= 1, 'a floating number appeared');
  assert.match(await txt('.tf-hp'), new RegExp(`${Math.ceil(hp)} / 40`));
  assert.equal(await p.locator('.skill[data-skill="basic_attack"].cooling').count(), 1, 'cooldown overlay on slot 1');
  await p.screenshot({ path: S + '/combat/c2_first_hit.png' });

  // 5. active skill: costs mana (status bar follows), cooldown number, a second press is refused with a toast
  await H(() => h.step(1, 1)); // global cooldown over
  const mana0 = await H(() => h.session.state.profile.mana);
  await H(() => h.combat.monsters.get(1).hp = 400); // keep it alive for the next checks
  await p.keyboard.press('2');
  await H(() => h.step());
  assert.equal(await H(() => h.session.state.profile.mana), mana0 - 12 + 0, 'Power Strike cost 12 mana');
  assert.match(await txt('.bar-row:nth-child(3) .bar-text'), new RegExp(`${mana0 - 12} / 50`));
  assert.match(await p.locator('.skill[data-skill="power_strike"] .skill-cd-text').innerText(), /^[56]$/, 'shows the seconds left');
  await H(() => h.step(1, 1));
  await p.keyboard.press('2');
  await H(() => h.step());
  assert.match(await txt('.toasts'), /not ready/i);
  assert.equal(await p.locator('.skill[data-skill="power_strike"].fail').count(), 1);
  const used = await H(() => h.combat.skills.remaining('power_strike'));
  assert.ok(used > 3, 'the refused press did not reset the cooldown');

  // 6. not enough mana: the slot is dimmed and the use is refused without side effects
  await H(() => { h.step(8, 1); h.session.state.profile.mana = 3; h.session.state.refresh(); h.step(1 / 60, 1); });
  assert.equal(await p.locator('.skill.nomana').count(), 2, 'both costed skills are dimmed');
  const hp2 = await H(() => h.combat.monsters.get(1).hp);
  await p.locator('.skill[data-skill="whirlwind"]').click(); // by mouse
  await H(() => h.step());
  assert.match(await txt('.toasts'), /mana/i);
  assert.equal(await H(() => h.combat.monsters.get(1).hp), hp2);
  assert.equal(await H(() => h.session.state.profile.mana), 3);
  assert.equal(await H(() => document.activeElement && document.activeElement.id), 'game', 'focus returns to the game after a click');

  // 7. kill the Marauder (its loot table always drops a potion): notifications, XP once, level-up, loot as world pickups
  await H(() => { h.session.state.profile.mana = 50; h.session.state.refresh(); h.setPose(-30, -27.6); h.step(1 / 60, 2); h.combat.selectTarget(3); h.combat.monsters.get(3).hp = 1; h.combat.skills.reset(); });
  const pickups0 = await H(() => h.session.pickups.count);
  for (let i = 0; i < 8 && (await H(() => h.combat.monsters.get(3).alive)); i++) {
    await p.keyboard.press('1');
    await H(() => h.step(1.1, 1));
  }
  assert.equal(await H(() => h.combat.monsters.get(3).alive), false);
  assert.equal(await p.locator('.target-frame').isVisible(), false, 'target frame hides for a dead monster');
  assert.equal(await H(() => [h.session.state.profile.level, h.session.state.profile.xp]).then((v) => v.join(',')), '2,95', '35 + 160 XP = level 2 with 95, granted once');
  const toasts = (await p.locator('.toast').allInnerTexts()).join(' | ');
  assert.match(toasts, /Ironbound Marauder defeated · \+160 XP/);
  assert.match(toasts, /Loot: .*Health Potion/);
  assert.match(toasts, /Level up/);
  assert.ok((await H(() => h.session.pickups.count)) > pickups0, 'loot pickups were added to the world');
  await p.screenshot({ path: S + '/combat/c3_kill.png' });
  await H(() => h.step(2, 1));
  await p.keyboard.press('1'); // nothing to attack now
  await H(() => h.step());
  assert.match(await txt('.toasts'), /No target/);
  await H(() => { h.setPose(0, 1.2); h.step(); });

  // 8. typing a name with digits must not fire skills
  await p.locator('.name-btn').click();
  const before = await H(() => h.combat.skills.remaining('basic_attack'));
  await p.keyboard.type('12 3');
  assert.equal(await H(() => h.combat.skills.remaining('basic_attack')), before);
  await p.keyboard.press('Enter');

  // 9. the inventory UI works next to the combat UI, and Esc closes it before dropping a target
  await p.keyboard.press('i');
  assert.equal(await p.locator('.inv-panel').isVisible(), true);
  assert.equal(await p.locator('.hotbar').isVisible(), true);
  const inv = await box('.inv-panel'), bar = await box('.hotbar'), tf = await box('.status-panel');
  assert.ok(!overlap(inv, bar), 'inventory does not cover the hotbar (desktop)');
  assert.ok(!overlap(tf, bar));
  await p.screenshot({ path: S + '/combat/c4_with_inventory.png' });
  await H(() => h.combat.selectTarget(2) || true);
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('.inv-panel').isVisible(), false);
  await H(() => h.combat.targeting.select(2));
  await p.keyboard.press('Escape');
  assert.equal(await H(() => h.combat.targeting.targetId), null, 'second Esc clears the target');

  // 10. layout: hotbar, help line, restart button, prompt and toasts do not sit on top of each other
  await H(() => { h.setPose(2.0, 1.4); h.step(); });
  await p.keyboard.press('e'); // a toast + prompt scenario
  const help = await box('#help'), hot = await box('.hotbar'), rs = (await p.locator('#restart').isVisible()) ? await box('#restart') : null;
  assert.ok(!overlap(help, hot), 'help line vs hotbar');
  if (rs) assert.ok(!overlap(rs, hot));
  await H(() => h.step(1 / 60, 2));
  if (await p.locator('.prompt').isVisible()) assert.ok(!overlap(await box('.prompt'), hot), 'pickup prompt vs hotbar');
  assert.ok(!overlap(await box('.toasts'), hot), 'toasts vs hotbar');

  // 11. defeat: overlay, countdown, no actions, inventory untouched, then respawn by button
  const bag = await H(() => JSON.stringify([...Array(24).keys()].map((i) => h.session.state.inventory.at(i))));
  await H(() => { h.session.state.damage(9999); h.step(1 / 60, 2); });
  assert.equal(await p.locator('.death-panel').isVisible(), true);
  assert.match(await txt('.death-panel'), /You were defeated/);
  assert.match(await txt('.death-count'), /Respawning in 1[12] s/);
  assert.equal(await p.locator('.hotbar.disabled').count(), 1);
  assert.match((await p.locator('.toast').allInnerTexts()).join('|'), /defeated/);
  await p.screenshot({ path: S + '/combat/c5_defeated.png' });
  await p.keyboard.press('1');
  assert.equal(await H(() => h.combat.skills.remaining('basic_attack')) <= 1.1, true);
  assert.equal(await H(() => JSON.stringify([...Array(24).keys()].map((i) => h.session.state.inventory.at(i)))), bag, 'inventory untouched by death');
  await p.getByRole('button', { name: 'Respawn now' }).click();
  await H(() => h.step());
  assert.equal(await p.locator('.death-panel').isVisible(), false);
  assert.equal(await H(() => h.session.state.profile.hp), await H(() => Math.round(h.session.state.stats.maxHp * 0.5)), 'respawn with half HP');
  assert.equal(await p.locator('.hotbar.disabled').count(), 0);

  // 12. floating numbers are recycled, never unbounded
  await H(() => { h.combat.reset(); h.setPose(0, 1.2); h.combat.monsters.get(1).hp = 1e6; h.combat.monsters.get(1).config.maxHp; });
  await H(() => { h.combat.selectTarget(1); for (let i = 0; i < 60; i++) { h.combat.skills.reset(); h.combat.useSkill('basic_attack'); h.session.state.profile.mana = 50; } h.step(); });
  assert.ok((await p.locator('.dmg').count()) <= 24, 'bounded pool');

  // 13. cleanup: no listeners, DOM layer gone, keys do nothing
  await H(() => h.disposeAll());
  assert.equal(await H(() => h.combat.events.listenerCount), 0);
  assert.equal(await p.locator('.combat-layer').count(), 0);
  await p.keyboard.press('1');
  assert.equal(await H(() => h.combat.monsters.count), 0);
  assert.deepEqual(errors, [], 'no page errors');
  await p.close();

  // 14. phone layout: target frame between title and fps, hotbar above the help line, nothing overlapping
  const m = await open(b, 390, 780);
  await m.p.evaluate(() => { h.setPose(0, 1.2); h.step(1 / 60, 2); h.combat.selectTarget(1); h.combat.useSkill('basic_attack'); h.step(1 / 60, 3); });
  const T = await m.p.locator('.target-frame').boundingBox();
  const Hb = await m.p.locator('.hotbar').boundingBox();
  const Hp = await m.p.locator('#help').boundingBox();
  const St = await m.p.locator('.status-panel').boundingBox();
  const Ti = await m.p.locator('#title').boundingBox();
  const Fp = await m.p.locator('#fps').boundingBox();
  await m.p.screenshot({ path: S + '/combat/c6_phone.png' });
  const Ts = await m.p.locator('.toasts').boundingBox();
  assert.ok(T && Hb && Hp && St);
  assert.ok(!overlap(T, St), 'target frame clear of the status panel');
  assert.ok(!Ts || Ts.height === 0 || !overlap(Ts, St), 'toasts clear of the status panel');
  assert.ok(T.x >= 0 && T.x + T.width <= 390, 'target frame inside the screen');
  assert.ok(!overlap(T, Ti) && !overlap(T, Fp), 'target frame clear of title and fps');
  assert.ok(!overlap(Hb, Hp), 'hotbar clear of the help line');
  assert.ok(Hb.x >= 0 && Hb.x + Hb.width <= 390);
  assert.deepEqual(m.errors, [], 'no page errors (phone)');
  await b.close();
  console.log('Combat UI checks passed.');
})().catch((e) => { console.error(e); process.exit(1); });
