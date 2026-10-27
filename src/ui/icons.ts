import type { IconShape } from '../game/items';

/** Placeholder item icons: simple inline SVG shapes (32×32), tinted with the item's colour. Our own constants only. */
const SHAPES: Readonly<Record<IconShape, (c: string) => string>> = {
  potion: (c) =>
    `<path d="M12 3h8v2h-1.5v5.2l5.2 9.6A6 6 0 0 1 18.4 28h-4.8a6 6 0 0 1-5.3-8.2l5.2-9.6V5H12z" fill="#dfe9ee" fill-opacity=".35" stroke="#e8f0f2" stroke-width="1.4" stroke-linejoin="round"/>` +
    `<path d="M10.2 19.5h11.6l1.4 2.6A4.2 4.2 0 0 1 19.5 26.4h-7a4.2 4.2 0 0 1-3.7-4.3z" fill="${c}"/>`,
  sword: (c) =>
    `<path d="M24.5 3.5 28.5 7.5 14 22 10 18z" fill="${c}" stroke="#2b1c10" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<path d="M8.2 19.8l4 4-2 2-4-4z" fill="#6b4a2c" stroke="#2b1c10" stroke-width="1.2"/><path d="M5 27l2.5-2.5" stroke="#2b1c10" stroke-width="2.4" stroke-linecap="round"/>`,
  helmet: (c) =>
    `<path d="M5 20a11 11 0 0 1 22 0v6H5z" fill="${c}" stroke="#25303a" stroke-width="1.3" stroke-linejoin="round"/>` +
    `<path d="M5 20h22v3H5z" fill="#000" fill-opacity=".18"/><path d="M14 20v6M18 20v6" stroke="#25303a" stroke-width="1.3"/><path d="M16 9v5" stroke="#25303a" stroke-width="1.3"/>`,
  armor: (c) =>
    `<path d="M10 4l6 3 6-3 7 5-3 5-3-1v14H9V13l-3 1-3-5z" fill="${c}" stroke="#16261c" stroke-width="1.3" stroke-linejoin="round"/>` +
    `<path d="M13 7l3 2.5L19 7" fill="none" stroke="#16261c" stroke-width="1.3"/><path d="M9 21h14" stroke="#16261c" stroke-width="1.3" opacity=".6"/>`,
  boots: (c) =>
    `<path d="M9 4h8v13l8 3.2c2 .8 3 2.2 3 4.3V27H7V4z" fill="${c}" stroke="#2c1a10" stroke-width="1.3" stroke-linejoin="round"/>` +
    `<path d="M7 23h21" stroke="#2c1a10" stroke-width="2"/><path d="M9 9h8" stroke="#2c1a10" stroke-width="1.3" opacity=".6"/>`,
  wood: (c) =>
    `<g stroke="#3a2412" stroke-width="1.2"><rect x="3" y="17" width="26" height="9" rx="4.5" fill="${c}"/><rect x="6" y="8" width="20" height="9" rx="4.5" fill="${c}"/></g>` +
    `<circle cx="24.5" cy="21.5" r="2.6" fill="#e0b98a" stroke="#3a2412" stroke-width="1"/><circle cx="21.5" cy="12.5" r="2.6" fill="#e0b98a" stroke="#3a2412" stroke-width="1"/>`,
  stone: (c) =>
    `<path d="M6 21 10 10l8-4 9 6 2 9-6 5H11z" fill="${c}" stroke="#2a2f33" stroke-width="1.3" stroke-linejoin="round"/>` +
    `<path d="M10 10l8 3 9-1M18 13l-3 13" fill="none" stroke="#2a2f33" stroke-width="1.1" opacity=".55"/>`,
};

export function iconSvg(shape: IconShape, color: string): string {
  return `<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true" focusable="false">${SHAPES[shape](color)}</svg>`;
}

/** Faint silhouette shown in an empty equipment slot. */
export function slotSilhouette(shape: IconShape): string {
  return iconSvg(shape, '#ffffff');
}
