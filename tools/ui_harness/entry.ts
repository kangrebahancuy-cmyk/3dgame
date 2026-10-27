import { GameSession } from '../../src/game/session';
import { GameUi } from '../../src/ui/GameUi';
import { InputController } from '../../src/input/InputController';
const session = new GameSession();
session.spawnInitialPickups();
const pose = { x: 0, z: 0, yaw: 0 };
const ui = new GameUi(document.getElementById('game-ui')!, session, () => pose);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = new InputController(canvas);
// exactly the wiring Game.ts uses
input.onAction((a) => {
  if (a === 'toggleInventory') ui.toggleInventory();
  else if (a === 'closePanels') ui.closePanels();
  else if (a === 'interact') session.interact(pose.x, pose.z);
});
(window as any).h = {
  session, ui, input, pose,
  setPose(x: number, z: number) { pose.x = x; pose.z = z; ui.update(x, z); },
  frame() { input.poll(); ui.update(pose.x, pose.z); return { forward: input.forward, right: input.right }; },
};
