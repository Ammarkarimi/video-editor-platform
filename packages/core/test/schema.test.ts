import { describe, expect, it } from 'vitest';
import {
  computeExportSize,
  createProjectDoc,
  createShapeClip,
  createTextClip,
  DocumentValidationError,
  formatTimecode,
  parseProjectDoc,
  parseTime,
  resolveFontFace,
  safeParseProjectDoc,
  SHAPE_PRESETS,
  TEXT_PRESETS,
} from '../src/index.js';
import { imageClip, videoClip } from './helpers.js';

describe('project document schema', () => {
  it('accepts documents built from the factories', () => {
    const doc = createProjectDoc({ width: 1080, height: 1920 });
    doc.tracks[0]!.clips.push(videoClip(0, 3), imageClip(3, 2));
    for (const preset of TEXT_PRESETS) {
      doc.tracks[0]!.clips.push(createTextClip(10, { preset, frame: doc.settings }));
    }
    for (const preset of SHAPE_PRESETS) {
      doc.tracks[0]!.clips.push(createShapeClip(20, doc.settings, preset.build(doc.settings)));
    }
    const parsed = parseProjectDoc(JSON.parse(JSON.stringify(doc)));
    expect(parsed.tracks[0]!.clips).toHaveLength(2 + TEXT_PRESETS.length + SHAPE_PRESETS.length);
  });

  it('rejects malformed documents with readable issues', () => {
    const doc = createProjectDoc() as unknown as Record<string, unknown>;
    (doc.settings as Record<string, unknown>).fps = -1;
    const result = safeParseProjectDoc(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain('settings.fps');
    expect(() => parseProjectDoc({ nope: true })).toThrow(DocumentValidationError);
  });

  it('rejects unknown clip types and bad colors', () => {
    const doc = createProjectDoc();
    const bad = JSON.parse(JSON.stringify(doc));
    bad.tracks[0].clips.push({ ...videoClip(0, 1), type: 'hologram' });
    expect(safeParseProjectDoc(bad).ok).toBe(false);
    const bad2 = JSON.parse(JSON.stringify(doc));
    bad2.settings.backgroundColor = 'red';
    expect(safeParseProjectDoc(bad2).ok).toBe(false);
  });
});

describe('helpers', () => {
  it('computes even export sizes from the short side', () => {
    expect(computeExportSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(computeExportSize(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
    const wide = computeExportSize(2560, 1080, 720);
    expect(wide.width % 2).toBe(0);
  });

  it('formats and parses times', () => {
    expect(formatTimecode(61.5, 30)).toBe('00:01:01:15');
    expect(parseTime('1:05.5')).toBeCloseTo(65.5);
    expect(parseTime('abc')).toBeNull();
  });

  it('resolves the closest font face', () => {
    expect(resolveFontFace('Inter', 800, 'normal').face.weight).toBe(700);
    expect(resolveFontFace('Bebas Neue', 700, 'italic').face.file).toBe('BebasNeue-400.ttf');
    expect(resolveFontFace('Unknown', 400, 'normal').family.family).toBe('Inter');
  });
});
