# Combat & monsters

Real-time combat against three monster types in the forest, built on the existing systems (player state, stats,
equipment, inventory, pickups, collision, loader/animator). **Controls**

| Input | Action |
|---|---|
| Click a monster | select it (click the selected one again = basic attack) |
| `Tab` | select the next monster, nearest first (only while the game itself has focus) |
| `1` `2` `3` (or hotbar buttons) | Attack · Power Strike (12 mana, 6 s) · Whirlwind (20 mana, 10 s) |
| `Esc` | close the inventory; if nothing is open, clear the target |
| `E` / `I` | pick up (loot included) / inventory, as before |

## Architecture (`src/combat/`, no DOM and no Babylon unless stated)

| Module | Job |
|---|---|
| `DamageCalculator` | the one damage rule, both directions: `attack × skill × (0.9…1.1) × 25/(25+defense)`, min 1; hit chance = accuracy − evasion; crit ×1.5 |
| `weapon` | reach/swing speed of the equipped weapon (`ItemDef.weapon`; fists when none) |
| `SkillConfig` / `SkillSystem` | data-driven skills (add one entry = new skill + hotbar slot); cooldowns, global cooldown (0.6 s), mana, validation order: alive → cooldown → target → reach → mana. A refused use changes nothing |
| `TargetingSystem` | selection, Tab cycling, auto-drop when dead/too far, ray picking (3 stacked spheres) |
| `MonsterConfig` | per-type data: HP, damage, defense, evasion/accuracy, move speed, aggro/attack/chase ranges, attack cooldown, wind-up, area, return time, respawn, XP, loot table, model; plus the spawn list |
| `Monster` | one monster's data + invariants (HP in [0,max], dies once, `rewardClaimed`) |
| `MonsterAI` | FSM idle → aggro → chase → attack → return → dead (below) |
| `MonsterSystem` | owns the monsters, advances AI in ≤ 0.05 s slices (a frame is clamped to 0.25 s), respawns, separation |
| `LootSystem` | rolls the loot table with a seeded rng and spawns ordinary world pickups |
| `CombatSystem` | rules in one place: player skills vs monsters, monster blows vs the player, death, rewards; everything is reported through `events` |
| `pose` | pure procedural body language (lean/lunge/fall) because the assets have no attack/hit/death clips |
| `CombatView`, `MonsterView`, `CombatEffects` (**Babylon**) | monster models, hit sparks, swing sweep, death dust, target ring, telegraph disc; world → screen and screen → ray helpers |
| `src/ui/CombatUi` (**DOM**) | target frame, monster bars, floating numbers, hotbar with cooldown overlays, hit flash, defeat/respawn panel, notifications (via the existing toasts) |

Wiring: `Game.setupCombat()` (after the player loads), `Game.tick()` (input → player → `combat.update` → view → UI) and
`Game.dispose()`. `CombatSystem.dispose()` / `CombatUi.dispose()` / `CombatView.dispose()` remove listeners, DOM, meshes.

## Monster AI

```
idle ──(player within aggroRange / provoked)──▶ aggro ──0.35 s──▶ chase
chase ──(within 0.9·attackRange)──▶ attack ◀──▶ chase   (target leaves 1.15·attackRange)
chase/attack ──(player dead · farther than chaseRange from home · lost for returnTime · stuck)──▶ return ──▶ idle
any ──(HP 0)──▶ dead  (corpse 4.2 s, then respawnTime; waits while the player stands within 8 m of its home)
```

* **One blow = one phase change.** attack: ready → *windup* (telegraph) → the blow lands once → recover. A blow connects
  if the target is within `attackRange + 0.35` (`single`) or `areaRadius` (`area`) **at the moment it lands**, so
  stepping away during the wind-up dodges it. Damage is applied once per blow, never per frame.
* **Movement** uses the same `CollisionWorld` as the player (circle colliders, boundary, sliding) with 0.12 m sub-steps,
  exponential acceleration and turn damping, all in `dt`. While touching an obstacle the heading bends to one side
  (a trunk dead ahead is walked around). **Anti-stuck:** a second spent touching obstacles without getting 0.4 m closer to
  the goal counts as stuck (flips the side); 3 in a row → return. A *returning* monster stuck for 4 s is put at home
  (the single place a monster is placed without walking).
* **Cost:** a few multiplications per monster; idle perception runs every 0.2 s, staggered per monster.

| | Ash Walker | Bone Whittler | Ironbound Marauder |
|---|---|---|---|
| role | weak starter | aggressive chaser | elite, area slam |
| HP / dmg / def | 40 / 7 / 1 | 75 / 12 / 3 | 170 / 24 / 6 |
| move speed | 2.3 | 3.7 | 2.6 |
| aggro / chase leash | 7 / 16 m | 12 / 24 m | 10 / 20 m |
| attack | 0.45 s wind-up, every 1.8 s | 0.35 s, every 1.3 s | **0.95 s wind-up, 3 m ground area**, every 2.8 s |
| XP | 22 | 48 | 160 |

The model assets are the three Orc_Free characters; the names are the asset names (there is no slime/boar/guardian model
in the repository), the roles are those of the brief. Convert with `npm run convert:monsters`.

## Rewards and loot

On the blow that empties the bar: `Monster.rewardClaimed` is set (a second call is a no-op), XP goes through
`PlayerState.gainXp` (level-ups included), the loot table is rolled with a seeded rng and **every drop becomes a normal
world pickup** near the corpse. Picking it up is the existing `E` rule (`PlayerState.pickUp`: stacking, all-or-nothing).
With a full backpack the stack simply stays on the ground (the player is told); nothing is lost or duplicated.

## Death

HP 0 → `playerDied` once, the target is cleared, monsters walk home, skills are refused, the character lies down. A panel
offers *Respawn now* (automatic after 12 s). Respawn = half HP, full mana, back at the start clearing. Inventory,
equipment and XP are never touched; potions cannot be used while defeated.

## Tests

`npm test` (`tests/combat.test.ts`, pure logic in Node): damage rule, reach, cooldowns, dead targets, AI states,
return home, anti-stuck, obstacle avoidance, 10/30/60/144 FPS equivalence, one-damage-per-blow, death & respawn,
reward once, loot determinism, full-backpack handling, skills (cooldown/mana/area/data-driven), lifecycle, pose, input.
`npm run test:ui` (needs Playwright + esbuild, which are not project dependencies, see the header of the scripts) drives
the real `CombatSystem`/`CombatUi`/`GameUi` in Chromium with a fake camera: target frame, cooldowns, floating numbers,
notifications, defeat panel, desktop and phone layout (no overlaps), cleanup.

**Not covered by any automated test:** everything that needs Babylon/WebGL (model loading and animation of the monsters,
picking, effects, projection of the bars). That code was only type-checked against loose stubs of the Babylon API.
