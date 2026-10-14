import { existsSync } from 'node:fs';
import path from 'node:path';
import { GlobalFonts } from '@napi-rs/canvas';
import { FONT_CATALOG } from '@vep/core';

let registeredDir: string | null = null;

/**
 * Registers the bundled fonts with Skia under their catalog family names, so server-side
 * rendering resolves `"Inter"` etc. to the very same files the browser loads.
 */
export function registerFonts(fontsDir: string): void {
  if (registeredDir === fontsDir) return;
  for (const family of FONT_CATALOG) {
    for (const face of family.faces) {
      const file = path.join(fontsDir, face.file);
      if (existsSync(file)) GlobalFonts.registerFromPath(file, family.family);
    }
  }
  registeredDir = fontsDir;
}
