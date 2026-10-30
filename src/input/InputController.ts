import { actionForKey, isTypingTarget, type GameAction } from './shortcuts';

/** Keyboard state: WASD + arrow keys for movement, Shift to walk. Mouse wheel is exposed as a zoom delta.
 *  UI shortcuts (I, E, Escape) are reported through `onAction`. Nothing here reacts while the player types in a text field. */
const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const WALK = ['ShiftLeft', 'ShiftRight'];
const HANDLED = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, ...WALK]);
type ActionHandler = (action: GameAction) => void;
/** A primary-button press on the game canvas, in client pixels. */
type ClickHandler = (clientX: number, clientY: number) => void;

export class InputController {
  private readonly down = new Set<string>();
  private wheel = 0;
  /** +1 = forward, -1 = back (opposite keys cancel). */
  forward = 0;
  /** +1 = right, -1 = left. */
  right = 0;
  walk = false;

  private actionHandler: ActionHandler | null = null;
  private clickHandler: ClickHandler | null = null;

  /** Registers the (single) handler for UI shortcuts. */
  onAction(handler: ActionHandler): void {
    this.actionHandler = handler;
  }

  /** Registers the (single) handler for clicks on the canvas (selecting a monster). */
  onClick(handler: ClickHandler): void {
    this.clickHandler = handler;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !e.isPrimary) return;
    this.clickHandler?.(e.clientX, e.clientY);
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
    if (isTypingTarget(e.target)) {
      // typing into a UI field: no movement, no shortcuts; release anything held so the character stops
      this.down.clear();
      return;
    }
    const action = actionForKey(e);
    if (action) {
      this.actionHandler?.(action);
      if (action !== 'closePanels') e.preventDefault();
      return;
    }
    if (!HANDLED.has(e.code)) return;
    this.down.add(e.code);
    e.preventDefault(); // stops arrow keys scrolling the page
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (!HANDLED.has(e.code)) return;
    this.down.delete(e.code);
    e.preventDefault();
  };
  private readonly reset = (): void => {
    this.down.clear();
  };
  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Normalise line/page mode deltas to roughly pixels.
    this.wheel += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
  };

  constructor(private readonly canvas: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    // A key released while the window was unfocused would otherwise stay "pressed" forever.
    window.addEventListener('blur', this.reset);
    document.addEventListener('visibilitychange', this.reset);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.onPointerDown);
  }

  private any(codes: string[]): boolean {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** Call once per frame before reading the axes. */
  poll(): void {
    this.forward = (this.any(FORWARD) ? 1 : 0) - (this.any(BACK) ? 1 : 0);
    this.right = (this.any(RIGHT) ? 1 : 0) - (this.any(LEFT) ? 1 : 0);
    this.walk = this.any(WALK);
  }

  /** Accumulated wheel delta since the last call (pixels, positive = scroll down = zoom out). */
  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.reset);
    document.removeEventListener('visibilitychange', this.reset);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.actionHandler = null;
    this.clickHandler = null;
  }
}
