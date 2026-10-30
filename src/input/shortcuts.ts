/** Pure helpers for the UI shortcuts (I, E, Escape, Tab, 1-6), kept apart from the DOM so they can be unit-tested. */

export const HOTBAR_SLOTS = 6;
export type HotbarAction = `hotbar${1 | 2 | 3 | 4 | 5 | 6}`;
export type GameAction = 'toggleInventory' | 'interact' | 'closePanels' | 'cycleTarget' | HotbarAction;

const KEY_TO_ACTION: Readonly<Record<string, GameAction>> = {
  KeyI: 'toggleInventory',
  KeyE: 'interact',
  Escape: 'closePanels',
  Tab: 'cycleTarget',
  Digit1: 'hotbar1', Digit2: 'hotbar2', Digit3: 'hotbar3', Digit4: 'hotbar4', Digit5: 'hotbar5', Digit6: 'hotbar6',
  Numpad1: 'hotbar1', Numpad2: 'hotbar2', Numpad3: 'hotbar3', Numpad4: 'hotbar4', Numpad5: 'hotbar5', Numpad6: 'hotbar6',
};

/** The hotbar slot (1-based) of a hotbar action, or null for any other action. */
export function hotbarSlot(a: GameAction): number | null {
  return a.startsWith('hotbar') ? Number(a.slice(6)) : null;
}

export interface KeyLike {
  code: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: unknown;
}

/** True when the event target is something the player types into: shortcuts and movement keys must not fire. */
export function isTypingTarget(target: unknown): boolean {
  const t = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!t || typeof t !== 'object') return false;
  const tag = typeof t.tagName === 'string' ? t.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true;
}

/**
 * The game action for a key press, or null. Ignored while typing, with Ctrl/Meta/Alt held (browser shortcuts)
 * and for auto-repeat (holding E must not pick up several items).
 */
export function actionForKey(e: KeyLike): GameAction | null {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return null;
  const a = KEY_TO_ACTION[e.code] ?? null;
  if (a === null) return null;
  // Escape must still work to leave a text field; it is handled by that field itself, so skip it here too.
  if (isTypingTarget(e.target)) return null;
  // Tab is also how keyboard users move between buttons: only take it when focus is on the game itself, not on a control.
  if (a === 'cycleTarget') {
    const tag = (e.target as { tagName?: string } | null)?.tagName?.toUpperCase();
    if (tag !== undefined && tag !== 'CANVAS' && tag !== 'BODY' && tag !== 'HTML') return null;
  }
  return a;
}
