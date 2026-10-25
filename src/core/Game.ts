import { Engine, Scene } from '@babylonjs/core';
import { GameCamera } from '../camera/GameCamera';
import { CharacterLoadError, loadCharacter } from '../character/CharacterLoader';
import { Player } from '../character/Player';
import type { GameConfig } from '../config';
import { InputController } from '../input/InputController';
import type { Hud } from '../ui/Hud';
import { World } from '../world/World';

/** Wires engine, scene, world, input, player, camera and HUD together and owns the frame loop. */
export class Game {
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private world: World | null = null;
  private cam: GameCamera | null = null;
  private input: InputController | null = null;
  private player: Player | null = null;
  private loading = false;
  private fpsTimer = 0;
  private readonly dir = { x: 0, z: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hud: Hud,
    private readonly cfg: GameConfig,
  ) {
    hud.onRestart(() => this.restart());
    hud.onRetry(() => void this.loadPlayer());
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

    this.hud.showLoading('Building the world…', 0.05);
    this.world = new World(scene, this.cfg.world);
    this.cam = new GameCamera(scene, this.cfg.camera);
    this.cam.snap(0, 0, 0);
    this.input = new InputController(this.canvas);

    scene.onBeforeRenderObservable.add(() => this.tick());
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
    this.canvas.focus();

    await this.loadPlayer();
    (window as unknown as { __game?: unknown }).__game = { getState: () => this.debugState() };
  }

  /** Loads the character (shows progress and a readable error with a retry button on failure). */
  private async loadPlayer(): Promise<void> {
    if (this.loading || !this.scene || !this.world || !this.cam) return;
    this.loading = true;
    this.hud.showLoading('Loading character…', 0.1);
    try {
      const character = await loadCharacter(this.scene, this.cfg.character, (f) => this.hud.showLoading('Loading character…', 0.1 + 0.85 * f));
      for (const m of character.meshes) this.world.addShadowCaster(m);
      this.player = new Player(character, this.cfg, this.world.collision);
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
    } else {
      cam.update(dt, 0, 0, 0, wheel);
    }
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
    };
  }
}
