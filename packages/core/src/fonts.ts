/**
 * Curated font catalog shared by the browser preview and the server renderer.
 *
 * Every face is a static TrueType file in `assets/fonts/` (SIL Open Font License / Apache 2.0),
 * so text renders with identical metrics in the editor and in exported videos.
 */
export type FontCategory = 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace';
export type FontStyle = 'normal' | 'italic';

export interface FontFaceInfo {
  weight: number;
  style: FontStyle;
  /** File name inside `assets/fonts/`. */
  file: string;
}

export interface FontFamilyInfo {
  family: string;
  category: FontCategory;
  faces: FontFaceInfo[];
}

interface FamilySpec {
  family: string;
  category: FontCategory;
  weights: number[];
  italicWeights?: number[];
}

const FAMILY_SPECS: FamilySpec[] = [
  { family: 'Inter', category: 'sans-serif', weights: [400, 700, 900], italicWeights: [400, 700] },
  { family: 'Roboto', category: 'sans-serif', weights: [400, 700], italicWeights: [400, 700] },
  {
    family: 'Montserrat',
    category: 'sans-serif',
    weights: [400, 700, 900],
    italicWeights: [400, 700],
  },
  { family: 'Poppins', category: 'sans-serif', weights: [400, 700] },
  { family: 'Oswald', category: 'display', weights: [400, 700] },
  { family: 'Bebas Neue', category: 'display', weights: [400] },
  { family: 'Anton', category: 'display', weights: [400] },
  { family: 'Archivo Black', category: 'display', weights: [400] },
  {
    family: 'Playfair Display',
    category: 'serif',
    weights: [400, 700],
    italicWeights: [400, 700],
  },
  { family: 'Merriweather', category: 'serif', weights: [400, 700] },
  { family: 'Lobster', category: 'handwriting', weights: [400] },
  { family: 'Pacifico', category: 'handwriting', weights: [400] },
  { family: 'Dancing Script', category: 'handwriting', weights: [400, 700] },
  { family: 'Permanent Marker', category: 'handwriting', weights: [400] },
  { family: 'Roboto Mono', category: 'monospace', weights: [400, 700] },
];

export function fontFileName(family: string, weight: number, style: FontStyle): string {
  return `${family.replace(/\s+/g, '')}-${weight}${style === 'italic' ? '-italic' : ''}.ttf`;
}

export const FONT_CATALOG: FontFamilyInfo[] = FAMILY_SPECS.map((spec) => ({
  family: spec.family,
  category: spec.category,
  faces: [
    ...spec.weights.map((weight) => ({
      weight,
      style: 'normal' as const,
      file: fontFileName(spec.family, weight, 'normal'),
    })),
    ...(spec.italicWeights ?? []).map((weight) => ({
      weight,
      style: 'italic' as const,
      file: fontFileName(spec.family, weight, 'italic'),
    })),
  ],
}));

export const DEFAULT_FONT_FAMILY = 'Inter';

export function findFontFamily(family: string): FontFamilyInfo | undefined {
  return FONT_CATALOG.find((f) => f.family === family);
}

/**
 * Picks the closest available face for a requested weight/style, mirroring the CSS font matching
 * algorithm closely enough that the browser and the server choose the same file.
 */
export function resolveFontFace(
  family: string,
  weight: number,
  style: FontStyle,
): { family: FontFamilyInfo; face: FontFaceInfo } {
  const fam = findFontFamily(family) ?? findFontFamily(DEFAULT_FONT_FAMILY)!;
  const sameStyle = fam.faces.filter((f) => f.style === style);
  const candidates = sameStyle.length > 0 ? sameStyle : fam.faces;
  let best = candidates[0]!;
  for (const face of candidates) {
    if (Math.abs(face.weight - weight) < Math.abs(best.weight - weight)) best = face;
  }
  return { family: fam, face: best };
}
