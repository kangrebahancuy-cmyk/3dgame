import { Engine, Scene } from '@babylonjs/core';
import { GameCamera } from '../camera/GameCamera';
import { CharacterLoadError, loadCharacter } from '../character/CharacterLoader';
import { Player } from '../character/Player';
import type { GameConfig } from '../config';
import { GameSession } from '../game/session';
import { PickupView } from '../game/PickupView';
import { InputController } from '../input/InputController';
import { GameUi } from '../ui/GameUi';
import type { Hud } from '../ui/Hud';
import { NatureLoadError } from '../world/forest/NatureAssetLoader';
import { World } from '../world/World';

/** Wires engine, scene, world, input, player, camera and HUD together and owns the frame loop. */
export class Game {
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private world: World | null = null;
  private cam: GameCamera | null = null;
  private input: InputController | null = null;
  private player: Player | null = null;
  private readonly session = new GameSession();
  private ui: GameUi | null = null;
  private pickupView: PickupView | null = null;
  private loading = false;
  private fpsTimer = 0;
  private readonly dir = { x: 0, z: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hud: Hud,
    private readonly cfg: GameConfig,
  ) {
    hud.onRestart(() => this.restart());
    hud.onRetry(() => void this.loadContent());
  }

  async start(): Promise<void> {
    this.hud.showLoading('Starting engine…', 0.02);
    try {
      this.engine = new Engine(this.canvas, true, { stencil: true, preserveDrawingBuffer: false }, true);
    } catch (e) {
      this.hud.showError('Your browser could not start WebGL, which this game needs. Try a current version of Chrome, Edge or Firefox with hardware acceleration enabled.', e);
      return;
    }
    const engine = this.engine;
    if (window.devicePixelRatio > 2) engine.setHardwareScalingLevel(window.devicePixelRatio / 2); // cap pixel load on phones
    const scene = new Scene(engine);
    scene.skipPointerMovePicking = true;
    this.scene = scene;

    this.hud.showLoading('Building the world…', 0.03);
    this.world = new World(scene, this.cfg.world);
    this.cam = new GameCamera(scene, this.cfg.camera);
    this.cam.snap(0, 0, 0);
    this.input = new InputController(this.canvas);

    // Character system: items lying in the world, the DOM UI, and the keyboard shortcuts (I, E, Esc).
    this.pickupView = new PickupView(scene, this.session.pickups);
    this.session.spawnInitialPickups();
    const uiRoot = document.getElementById('game-ui');
    if (!uiRoot) throw new Error('index.html is missing #game-ui');
    this.ui = new GameUi(uiRoot, this.session, () => ({ x: this.player?.x ?? 0, z: this.player?.z ?? 0, yaw: this.player?.movement.yaw ?? 0 }));
    this.input.onAction((a) => {
      const p = this.player;
      if (a === 'toggleInventory') this.ui?.toggleInventory();
      else if (a === 'closePanels') this.ui?.closePanels();
      else if (a === 'interact' && p) this.session.interact(p.x, p.z);
    });
    this.session.state.onChange(() => this.applyEquipmentSpeed());

    scene.onBeforeRenderObservable.add(() => this.tick());
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
    this.canvas.focus();

    await this.loadContent();
    (window as unknown as { __game?: unknown }).__game = { getState: () => this.debugState(), dev: this.devTools() };
  }

  /** Equipment speed bonus -> movement. Explicit (config.character.equipmentSpeedBonus) and 1.0 when switched off. */
  private applyEquipmentSpeed(): void {
    if (!this.player) return;
    const mult = this.cfg.character.equipmentSpeedBonus ? this.session.state.stats.moveSpeedMultiplier : 1;
    this.player.movement.speedScale = mult;
  }

  /** Console helpers for manual testing: window.__game.dev.damage(30), .gainXp(500), .fillInventory(), .state */
  private devTools(): Record<string, unknown> {
    const s = this.session;
    return {
      session: s,
      state: s.state,
      damage: (n: number) => s.state.damage(n),
      heal: (n: number) => s.state.heal(n),
      gainXp: (n: number) => s.state.gainXp(n),
      fillInventory: () => s.debugFillInventory(),
    };
  }

  private forestLoaded = false;

  /** Loads the forest (once) and then the character; each stage reports its own readable error with a retry. */
  private async loadContent(): Promise<void> {
    if (!this.forestLoaded && this.world) {
      try {
        await this.world.load((text, f) => this.hud.showLoading(text, 0.05 + 0.6 * f));
        this.forestLoaded = true;
      } catch (e) {
        if (e instanceof NatureLoadError) {
          this.hud.showError(`The forest could not be loaded. ${e.message}`, e.detail); // exact file names + errors
        } else {
          this.hud.showError('The forest map could not be built.', e);
        }
        return;
      }
    }
    await this.loadPlayer();
  }

  /** Loads the character (shows progress and a readable error with a retry button on failure). */
  private async loadPlayer(): Promise<void> {
    if (this.loading || !this.scene || !this.world || !this.cam) return;
    this.loading = true;
    this.hud.showLoading('Loading character…', 0.7);
    try {
      const character = await loadCharacter(this.scene, this.cfg.character, (f) => this.hud.showLoading('Loading character…', 0.7 + 0.28 * f));
      for (const m of character.meshes) this.world.addShadowCaster(m);
      this.player = new Player(character, this.cfg, this.world.collision);
      this.applyEquipmentSpeed();
      this.restart();
      this.hud.showRestart(true);
      this.hud.hideLoading();
    } catch (e) {
      const message = e instanceof CharacterLoadError ? e.message : 'The character could not be loaded.';
      this.hud.showError(message, e instanceof CharacterLoadError && e.cause ? e.cause : e);
    } finally {
      this.loading = false;
    }
  }

  restart(): void {
    if (!this.player || !this.cam) return;
    // Face away from the camera, i.e. "up" on the screen.
    this.player.respawn(Math.atan2(this.cam.rig.forwardX, this.cam.rig.forwardZ));
    this.cam.snap(this.player.x, this.player.y, this.player.z);
  }

  private tick(): void {
    const engine = this.engine, cam = this.cam, input = this.input;
    if (!engine || !cam || !input) return;
    const dt = Math.min(engine.getDeltaTime() / 1000, this.cfg.movement.maxFrameTime);
    input.poll();
    const wheel = input.consumeWheel();
    const p = this.player;
    if (p) {
      cam.rig.moveDirection(input.forward, input.right, this.dir);
      p.update(dt, this.dir.x, this.dir.z, !input.walk); // run by default, Shift = walk
      cam.update(dt, p.x, p.y, p.z, wheel); // camera is updated AFTER the character moved: no one-frame lag/jitter
      this.ui?.update(p.x, p.z);
    } else {
      cam.update(dt, 0, 0, 0, wheel);
    }
    this.pickupView?.update(dt);
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.25) {
      this.fpsTimer = 0;
      this.hud.setFps(engine.getFps());
    }
  }

  /** Snapshot for manual / automated browser testing (window.__game.getState()). */
  private debugState(): Record<string, unknown> | null {
    const p = this.player;
    if (!p || !this.cam) return null;
    return {
      x: p.x, y: p.y, z: p.z,
      speed: p.movement.speed, yaw: p.movement.yaw, blocked: p.movement.blocked,
      weights: p.animation.weights, phase: p.animation.phase,
      camera: { x: this.cam.camera.position.x, y: this.cam.camera.position.y, z: this.cam.camera.position.z },
      fps: this.engine?.getFps(),
      height: p.character.height, forwardCorrection: p.character.forwardCorrection,
      speedScale: p.movement.speedScale,
      character: { ...this.session.state.profile }, stats: { ...this.session.state.stats }, equipment: this.session.state.equipment.snapshot(),
      pickupsInWorld: this.session.pickups.count,
    };
  }
}
