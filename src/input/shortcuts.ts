/** Pure helpers for the UI shortcuts (I, E, Escape), kept apart from the DOM so they can be unit-tested. */

export type GameAction = 'toggleInventory' | 'interact' | 'closePanels';

const KEY_TO_ACTION: Readonly<Record<string, GameAction>> = {
  KeyI: 'toggleInventory',
  KeyE: 'interact',
  Escape: 'closePanels',
};

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
  return a;
}
