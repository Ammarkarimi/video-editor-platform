export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Parses `#RRGGBB` / `#RRGGBBAA` (alpha 0..1). Falls back to opaque black. */
export function parseHexColor(hex: string): RGBA {
  if (!HEX_COLOR_PATTERN.test(hex)) return { r: 0, g: 0, b: 0, a: 1 };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
  return { r, g, b, a };
}

/** Converts a document color into a CSS color string every canvas implementation understands. */
export function toCssColor(hex: string, alphaMultiplier = 1): string {
  const { r, g, b, a } = parseHexColor(hex);
  const alpha = Math.round(a * alphaMultiplier * 1000) / 1000;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function colorAlpha(hex: string): number {
  return parseHexColor(hex).a;
}

export function toHex6(hex: string): string {
  return hex.slice(0, 7).toLowerCase();
}

/** Returns `#RRGGBBAA` from a 6-digit color and an alpha in 0..1. */
export function withAlpha(hex6: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex6.slice(0, 7)}${a}`;
}
