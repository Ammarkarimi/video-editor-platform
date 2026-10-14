import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import {
  applyMoves,
  copyClips,
  detachAudio,
  duplicateClips,
  findClip,
  insertClip,
  pasteClips,
  removeClips,
  setClipSpeed,
  setTransition,
  splitAt,
  splitClip,
  trimClip,
  type ProjectDoc,
  type VideoClip,
} from '../src/index.js';
import { assets, projectWithClips, videoClip } from './helpers.js';

/**
 * The editor runs every operation inside Immer's `produce`, where clips are draft proxies.
 * These tests make sure no operation relies on APIs that reject proxies (e.g. structuredClone).
 */
describe('operations on Immer drafts', () => {
  const base = (): ProjectDoc => {
    const doc = projectWithClips([
      [0, 5],
      [5, 5],
    ]);
    (doc.tracks[0]!.clips[0] as VideoClip).keyframes.x = [
      { time: 0, value: 0, easing: 'linear' },
      { time: 5, value: 100, easing: 'linear' },
    ];
    return doc;
  };

  it('splits, duplicates, copies and pastes', () => {
    const doc = base();
    const [a] = doc.tracks[0]!.clips;
    let rightId: string | null = null;
    const split = produce(doc, (draft) => {
      rightId = splitClip(draft as ProjectDoc, a!.id, 2);
    });
    expect(rightId).toBeTruthy();
    expect(split.tracks[0]!.clips).toHaveLength(3);
    expect(doc.tracks[0]!.clips).toHaveLength(2); // base untouched

    const multi = produce(doc, (draft) => {
      expect(splitAt(draft as ProjectDoc, 7)).toHaveLength(1);
      expect(duplicateClips(draft as ProjectDoc, [a!.id])).toHaveLength(1);
      const items = copyClips(draft as ProjectDoc, [a!.id]);
      expect(pasteClips(draft as ProjectDoc, items, 20)).toHaveLength(1);
    });
    expect(multi.tracks.flatMap((t) => t.clips)).toHaveLength(5);
  });

  it('moves, trims, retimes, detaches audio, adds transitions and deletes', () => {
    const doc = base();
    const [a, b] = doc.tracks[0]!.clips;
    const next = produce(doc, (draft) => {
      const d = draft as ProjectDoc;
      expect(setTransition(d, b!.id, { type: 'fade', duration: 1 })).toBe(true);
      expect(trimClip(d, a!.id, 'start', 1, assets)).toBeCloseTo(1);
      expect(setClipSpeed(d, b!.id, 2, assets)).toBe(true);
      expect(detachAudio(d, a!.id, assets)).toBeTruthy();
      insertClip(d, videoClip(30, 2));
      expect(applyMoves(d, [{ clipId: b!.id, start: 12, trackId: d.tracks[0]!.id }])).toBe(true);
      removeClips(d, [a!.id], { ripple: true });
    });
    expect(findClip(next, a!.id)).toBeNull();
    // b moved to 12s, then rippled left by a's trimmed duration (4s).
    expect(findClip(next, b!.id)!.clip.start).toBeCloseTo(8);
  });
});
