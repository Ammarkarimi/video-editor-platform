import { defaultFilters } from '../model/defaults.js';
import type { Filters } from '../model/schema.js';

/**
 * Builds a CSS filter string. Canvas filter lengths are in device pixels and ignore the current
 * transform, so the blur radius is multiplied by the output scale.
 */
export function buildCssFilter(
  filters: Filters,
  extraBlur: number,
  outputScale: number,
): string | null {
  const parts: string[] = [];
  if (filters.brightness !== 1) parts.push(`brightness(${round(filters.brightness)})`);
  if (filters.contrast !== 1) parts.push(`contrast(${round(filters.contrast)})`);
  if (filters.saturation !== 1) parts.push(`saturate(${round(filters.saturation)})`);
  if (filters.hue !== 0) parts.push(`hue-rotate(${round(filters.hue)}deg)`);
  if (filters.grayscale > 0) parts.push(`grayscale(${round(filters.grayscale)})`);
  if (filters.sepia > 0) parts.push(`sepia(${round(filters.sepia)})`);
  if (filters.invert > 0) parts.push(`invert(${round(filters.invert)})`);
  const blur = (filters.blur + extraBlur) * outputScale;
  if (blur >= 0.05) parts.push(`blur(${round(blur)}px)`);
  return parts.length > 0 ? parts.join(' ') : null;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function filtersAreDefault(filters: Filters): boolean {
  const d = defaultFilters();
  return (Object.keys(d) as Array<keyof Filters>).every((k) => filters[k] === d[k]);
}

export interface FilterPreset {
  id: string;
  label: string;
  filters: Partial<Filters>;
}

export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'none', label: 'Original', filters: {} },
  { id: 'vivid', label: 'Vivid', filters: { contrast: 1.15, saturation: 1.45 } },
  { id: 'warm', label: 'Warm', filters: { sepia: 0.3, saturation: 1.25, brightness: 1.05 } },
  {
    id: 'cool',
    label: 'Cool',
    filters: { hue: 12, saturation: 0.85, brightness: 1.05, contrast: 1.05 },
  },
  { id: 'bw', label: 'Black & white', filters: { grayscale: 1, contrast: 1.2 } },
  {
    id: 'vintage',
    label: 'Vintage',
    filters: { sepia: 0.5, contrast: 0.9, brightness: 1.1, saturation: 0.8, vignette: 0.4 },
  },
  {
    id: 'noir',
    label: 'Noir',
    filters: { grayscale: 1, contrast: 1.6, brightness: 0.85, vignette: 0.6 },
  },
  { id: 'dreamy', label: 'Dreamy', filters: { blur: 2, brightness: 1.15, saturation: 1.2 } },
  { id: 'faded', label: 'Faded', filters: { contrast: 0.8, brightness: 1.1, saturation: 0.75 } },
  {
    id: 'dramatic',
    label: 'Dramatic',
    filters: { contrast: 1.4, saturation: 1.1, brightness: 0.9, vignette: 0.5 },
  },
  { id: 'invert', label: 'Invert', filters: { invert: 1 } },
];

export function applyFilterPreset(preset: FilterPreset): Filters {
  return { ...defaultFilters(), ...preset.filters };
}
