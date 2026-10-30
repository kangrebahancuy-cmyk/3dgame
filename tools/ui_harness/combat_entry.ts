// DOM-only harness for the combat UI: the REAL CombatSystem, CombatUi, GameUi, InputController and shortcuts, wired the
// way Game.ts wires them, but with a fake "camera" (top-down projection) instead of Babylon. Nothing here renders 3D.
import { CombatSystem } from '../../src/combat/CombatSystem';
import type { MonsterSpawn } from '../../src/combat/MonsterConfig';
import { GameSession } from '../../src/game/session';
import { hotbarSlot } from '../../src/input/shortcuts';
import { InputController } from '../../src/input/InputController';
import { CombatUi } from '../../src/ui/CombatUi';
import { GameUi } from '../../src/ui/GameUi';

const session = new GameSession();
session.spawnInitialPickups();
const pose = { x: 0, z: 0, yaw: 0 };
const root = document.getElementById('game-ui')!;
const ui = new GameUi(root, session, () => pose);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = new InputController(canvas);
const spawns: MonsterSpawn[] = [
  { type: 'ash_walker', x: 0, z: 2.6 },
  { type: 'bone_whittler', x: 30, z: 30 },
  { type: 'ironbound_marauder', x: -30, z: -30 },
];
const combat = new CombatSystem({ state: session.state, pickups: session.pickups, spawns, seed: 11 });

const useSkill = (id: string): void => void combat.useSkill(id);
const combatUi = new CombatUi(root, combat, session.state, {
  // a flat top-down "camera": 24 px per metre around the middle of the viewport
  project: (x, y, z, out) => {
    out.x = window.innerWidth / 2 + x * 24;
    out.y = window.innerHeight / 2 - z * 24 - y * 10;
    out.visible = out.x > 0 && out.x < window.innerWidth && out.y > 0 && out.y < window.innerHeight;
  },
  notify: (m) => ui.notify(m),
  useSkill,
  respawn: () => void combat.respawnPlayer(),
  clearTarget: () => combat.clearTarget(),
});
input.onAction((a) => {
  const slot = hotbarSlot(a);
  if (a === 'toggleInventory') ui.toggleInventory();
  else if (a === 'closePanels') {
    const had = ui.isOpen;
    ui.closePanels();
    if (!had) combat.clearTarget();
  } else if (a === 'interact') session.interact(pose.x, pose.z);
  else if (a === 'cycleTarget') combat.cycleTarget();
  else if (slot !== null) {
    const def = combat.skills.bySlot(slot);
    if (def) useSkill(def.id);
  }
});

(window as unknown as Record<string, unknown>).h = {
  session, ui, combat, combatUi, input, pose,
  setPose(x: number, z: number) { pose.x = x; pose.z = z; },
  /** One game frame, like Game.tick(): combat, then the UIs. */
  step(dt = 1 / 60, n = 1) {
    for (let i = 0; i < n; i++) {
      input.poll();
      combat.update(dt, pose);
      ui.update(pose.x, pose.z);
      combatUi.update(dt);
    }
  },
  disposeAll() { combatUi.dispose(); combat.dispose(); input.dispose(); },
};
