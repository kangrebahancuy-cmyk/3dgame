/**
 * Colours for the Kenney models, chosen by glTF MATERIAL NAME (the kit has no textures - every model is flat colours).
 *
 * - 'forest' (default): natural greens / browns / greys that sit well on the painted forest floor. The GEOMETRY is still
 *   the real Kenney mesh; only the flat colour per material is replaced. This is a deliberate, documented recolour.
 * - 'kenney': the colours exactly as authored in the GLB files (Kenney's stylised teal leaves and orange wood, see
 *   assets/kenney_nature-kit/Preview.png). Select it with ?palette=kenney in the URL to compare.
 *
 * Values are 0..1 sRGB-ish and are used as vertex colours on a lit StandardMaterial (gamma-space lighting).
 */
export type PaletteName = 'forest' | 'kenney';
export type RGB = readonly [number, number, number];

export const FOREST_PALETTE: Readonly<Record<string, RGB>> = {
  leafsGreen: [0.2, 0.43, 0.16],
  leafsDark: [0.1, 0.3, 0.15],
  leafsFall: [0.68, 0.4, 0.12],
  wood: [0.4, 0.27, 0.16],
  woodBark: [0.36, 0.24, 0.14],
  woodBarkDark: [0.26, 0.17, 0.1],
  woodDark: [0.28, 0.19, 0.11],
  woodInner: [0.66, 0.5, 0.32],
  woodBirch: [0.78, 0.76, 0.68],
  stone: [0.5, 0.5, 0.5],
  dirt: [0.42, 0.31, 0.2],
  grass: [0.27, 0.5, 0.18],
  colorPurple: [0.58, 0.4, 0.82],
  colorRed: [0.82, 0.22, 0.2],
  colorTan: [0.78, 0.64, 0.46],
  colorWhite: [0.9, 0.9, 0.86],
  colorYellow: [0.96, 0.76, 0.2],
  _defaultMat: [0.62, 0.62, 0.6],
};

/** Colour of one material. `authored` is the factor read from the GLB (used by the 'kenney' palette). */
export function paletteColor(preset: PaletteName, materialName: string, authored: RGB): RGB {
  if (preset === 'kenney') return authored;
  const c = FOREST_PALETTE[materialName];
  if (!c) throw new Error(`NaturePalette: no forest colour for material "${materialName}"`);
  return c;
}
