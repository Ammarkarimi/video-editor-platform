import { findFontFamily, FONT_CATALOG, type ProjectDoc } from '@vep/core';

/**
 * Loads bundled font files into `document.fonts` on demand. Every face of a family is loaded
 * together so the browser's font matching sees the same faces the server renderer registers.
 */
export class FontLoader {
  private readonly requested = new Set<string>();
  private readonly listeners = new Set<() => void>();

  onLoad(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  ensureFamily(family: string): void {
    if (this.requested.has(family) || typeof FontFace === 'undefined') return;
    const info = findFontFamily(family);
    if (!info) return;
    this.requested.add(family);
    const loads = info.faces.map((face) => {
      const fontFace = new FontFace(info.family, `url(/fonts/${face.file})`, {
        weight: String(face.weight),
        style: face.style,
      });
      document.fonts.add(fontFace);
      return fontFace.load();
    });
    void Promise.allSettled(loads).then(() => {
      for (const listener of this.listeners) listener();
    });
  }

  ensureForDocument(doc: ProjectDoc): void {
    for (const track of doc.tracks) {
      for (const clip of track.clips)
        if (clip.type === 'text') this.ensureFamily(clip.style.fontFamily);
    }
  }

  ensureAll(): void {
    for (const family of FONT_CATALOG) this.ensureFamily(family.family);
  }
}

export const fontLoader = new FontLoader();
