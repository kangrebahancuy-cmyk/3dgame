import { Engine, Scene, type AbstractMesh } from '@babylonjs/core';
import { GameCamera } from '../camera/GameCamera';
import { CharacterLoadError, loadCharacter } from '../character/CharacterLoader';
import { Player } from '../character/Player';
import { CombatSystem } from '../combat/CombatSystem';
import { CombatView } from '../combat/CombatView';
import type { GameConfig } from '../config';
import { GameSession } from '../game/session';
import { PickupView } from '../game/PickupView';
import { InputController } from '../input/InputController';
import { hotbarSlot } from '../input/shortcuts';
import { dampAngle } from '../math/scalar';
import { CombatUi } from '../ui/CombatUi';
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
  private uiRoot: HTMLElement | null = null;
  private pickupView: PickupView | null = null;
  private combat: CombatSystem | null = null;
  private combatView: CombatView | null = null;
  private combatUi: CombatUi | null = null;
  /** Combat only runs once the monster models are in (invisible monsters must not attack). */
  private combatReady = false;
  /** Heading the player turns toward after attacking a target, and for how long (s) it still applies. */
  private faceYaw: number | null = null;
  private faceTime = 0;
  private readonly onResize = (): void => this.engine?.resize();
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
    this.uiRoot = uiRoot;
    this.input.onAction((a) => {
      const p = this.player;
      const slot = hotbarSlot(a);
      if (a === 'toggleInventory') this.ui?.toggleInventory();
      else if (a === 'closePanels') {
        const hadPanel = this.ui?.isOpen ?? false;
        this.ui?.closePanels();
        if (!hadPanel) this.combat?.clearTarget(); // Esc: close the inventory first, otherwise drop the target
      } else if (a === 'interact' && p) this.session.interact(p.x, p.z);
      else if (a === 'cycleTarget') this.combat?.cycleTarget();
      else if (slot !== null) {
        const def = this.combat?.skills.bySlot(slot);
        if (def) this.useSkill(def.id);
      }
    });
    this.input.onClick((x, y) => this.onCanvasClick(x, y));
    this.session.state.onChange(() => this.applyEquipmentSpeed());

    scene.onBeforeRenderObservable.add(() => this.tick());
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', this.onResize);
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

  /**
   * Console helpers for manual testing: window.__game.dev.damage(30), .gainXp(500), .fillInventory(), .state,
   * .combat (the CombatSystem), .tp(x, z) to walk-free teleport, .kill(monsterId).
   */
  private devTools(): Record<string, unknown> {
    const s = this.session;
    return {
      session: s,
      state: s.state,
      damage: (n: number) => s.state.damage(n),
      heal: (n: number) => s.state.heal(n),
      gainXp: (n: number) => s.state.gainXp(n),
      fillInventory: () => s.debugFillInventory(),
      combat: this.combat,
      tp: (x: number, z: number) => this.player?.movement.teleport(x, z, this.player.movement.yaw),
      kill: (id: number) => this.combat?.monsters.get(id)?.takeDamage(1e9),
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
      if (!this.combat) await this.setupCombat();
      this.hud.showRestart(true);
      this.hud.hideLoading();
    } catch (e) {
      const message = e instanceof CharacterLoadError ? e.message : 'The character could not be loaded.';
      this.hud.showError(message, e instanceof CharacterLoadError && e.cause ? e.cause : e);
    } finally {
      this.loading = false;
    }
  }

  /** Creates the combat system, its 3D view and its DOM UI, and streams in the monster models. Runs once. */
  private async setupCombat(): Promise<void> {
    const { scene, world, cam, engine, uiRoot } = this;
    if (!scene || !world || !cam || !engine || !uiRoot || this.combat) return;
    const collision = world.collision;
    const combat = new CombatSystem({
      state: this.session.state,
      pickups: this.session.pickups,
      world: collision,
      isBlocked: (x, z) => collision.overlaps(x, z, 0.4),
    });
    this.combat = combat;
    const view = new CombatView(scene, engine, this.canvas, cam.camera, this.cfg, combat, () => this.player);
    this.combatView = view;
    this.combatUi = new CombatUi(uiRoot, combat, this.session.state, {
      project: (x, y, z, out) => view.project(x, y, z, out),
      notify: (m) => this.ui?.notify(m),
      useSkill: (id) => this.useSkill(id),
      respawn: () => void combat.respawnPlayer(),
      clearTarget: () => combat.clearTarget(),
    });
    combat.events.on((e) => {
      if (e.type === 'playerRespawned') this.placeAtStart();
    });
    await view.populate(
      (m: AbstractMesh) => world.addShadowCaster(m),
      (done, total) => this.hud.showLoading(`Loading monsters (${done}/${total})…`, 0.9 + 0.09 * (done / total)),
    );
    this.combatReady = true;
  }

  /** The player used a skill (hotbar key or button): run it and turn toward the target it hit. */
  private useSkill(id: string): void {
    const combat = this.combat, p = this.player;
    if (!combat || !p || !this.combatReady) return;
    const r = combat.useSkill(id);
    if (!r.ok || r.targetIds.length === 0) return;
    const t = combat.monsters.get(r.targetIds[0]);
    if (!t) return;
    this.faceYaw = Math.atan2(t.x - p.x, t.z - p.z);
    this.faceTime = 0.4;
  }

  /** A click on the 3D view: select the monster under the cursor; clicking the selected one again attacks it. */
  private onCanvasClick(clientX: number, clientY: number): void {
    const combat = this.combat;
    if (!combat || !this.combatReady || combat.playerDead) return;
    const id = this.combatView?.pickAt(clientX, clientY);
    if (id === null || id === undefined) return;
    if (combat.targeting.targetId === id) {
      const basic = combat.skills.bySlot(1);
      if (basic) this.useSkill(basic.id);
    } else {
      combat.selectTarget(id);
    }
  }

  restart(): void {
    if (this.combat?.playerDead) {
      this.combat.respawnPlayer(); // its event puts the player back at the start
      return;
    }
    this.placeAtStart();
  }

  private placeAtStart(): void {
    if (!this.player || !this.cam) return;
    // Face away from the camera, i.e. "up" on the screen.
    this.player.respawn(Math.atan2(this.cam.rig.forwardX, this.cam.rig.forwardZ));
    this.cam.snap(this.player.x, this.player.y, this.player.z);
  }

  /** Stops the game: combat, input listeners, the scene and the engine. Safe to call once. */
  dispose(): void {
    this.combatReady = false;
    this.combatUi?.dispose();
    this.combatView?.dispose();
    this.combat?.dispose();
    this.combatUi = null;
    this.combatView = null;
    this.combat = null;
    this.input?.dispose();
    this.input = null;
    window.removeEventListener('resize', this.onResize);
    this.engine?.stopRenderLoop();
    this.scene?.dispose();
    this.engine?.dispose();
    this.scene = null;
    this.engine = null;
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
      if (this.combat?.playerDead) {
        this.dir.x = 0; // a defeated character does not walk
        this.dir.z = 0;
      }
      const moving = this.dir.x !== 0 || this.dir.z !== 0;
      if (moving) this.faceYaw = null;
      else if (this.faceYaw !== null) {
        p.movement.yaw = dampAngle(p.movement.yaw, this.faceYaw, 25, 25, dt); // turn toward what was just attacked
        this.faceTime -= dt;
        if (this.faceTime <= 0) this.faceYaw = null;
      }
      p.update(dt, this.dir.x, this.dir.z, !input.walk); // run by default, Shift = walk
      cam.update(dt, p.x, p.y, p.z, wheel); // camera is updated AFTER the character moved: no one-frame lag/jitter
      this.ui?.update(p.x, p.z);
      if (this.combat && this.combatReady) {
        this.combat.update(dt, { x: p.x, z: p.z, yaw: p.movement.yaw });
        this.combatView?.update(dt);
        this.combatUi?.update(dt);
      }
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
      combat: this.combat
        ? {
            ready: this.combatReady,
            target: this.combat.targeting.targetId,
            playerDead: this.combat.playerDead,
            state: this.combat.playerCombatState,
            monsters: this.combat.monsters.all.map((m) => ({ id: m.id, name: m.name, state: m.state, hp: m.hp, x: m.x, z: m.z })),
          }
        : null,
    };
  }
}
