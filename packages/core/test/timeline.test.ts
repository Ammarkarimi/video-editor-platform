import { describe, expect, it } from 'vitest';
import {
  applyMoves,
  clipEnd,
  collectSnapPoints,
  createAudioClip,
  createTextClip,
  detachAudio,
  duplicateClips,
  findClip,
  findNearestFreeStart,
  getAudioSegments,
  getProjectDuration,
  getTrackItemAt,
  getTrackTransitions,
  insertClip,
  pasteClips,
  copyClips,
  removeClips,
  setClipSpeed,
  setTransition,
  snapSpan,
  snapTime,
  splitAt,
  splitClip,
  trimClip,
  validateMoves,
  type VideoClip,
} from '../src/index.js';
import { assets, imageClip, projectWithClips, SILENT_VIDEO_ASSET, videoClip } from './helpers.js';

describe('placement', () => {
  it('inserts into the preferred track when free', () => {
    const doc = projectWithClips([[0, 5]]);
    const trackId = doc.tracks[0]!.id;
    const id = insertClip(doc, videoClip(5, 3), { trackId });
    expect(id).toBe(trackId);
    expect(doc.tracks[0]!.clips.map((c) => c.start)).toEqual([0, 5]);
  });

  it('creates a new video track above when the preferred one is occupied', () => {
    const doc = projectWithClips([[0, 5]]);
    const originalId = doc.tracks[0]!.id;
    const id = insertClip(doc, videoClip(2, 3), { trackId: originalId });
    expect(id).not.toBe(originalId);
    expect(doc.tracks[0]!.id).toBe(id);
    expect(doc.tracks[0]!.kind).toBe('video');
  });

  it('slides to the nearest gap when requested', () => {
    const doc = projectWithClips([
      [0, 5],
      [8, 5],
    ]);
    const clip = videoClip(4, 2);
    insertClip(doc, clip, { trackId: doc.tracks[0]!.id, slideToFit: true });
    expect(clip.start).toBeCloseTo(5);
  });

  it('routes audio clips to audio tracks', () => {
    const doc = projectWithClips([]);
    const audio = createAudioClip({ assetId: 'ast_video', name: 'a', duration: 4 }, 0);
    const id = insertClip(doc, audio, { trackId: doc.tracks[0]!.id });
    expect(doc.tracks.find((t) => t.id === id)!.kind).toBe('audio');
  });

  it('finds the nearest free start', () => {
    const doc = projectWithClips([
      [0, 5],
      [6, 4],
    ]);
    const track = doc.tracks[0]!;
    expect(findNearestFreeStart(track, 4, 2)).toBeCloseTo(10); // the 1s gap is too small
    expect(findNearestFreeStart(track, 5.2, 1)).toBeCloseTo(5);
    expect(findNearestFreeStart(track, 20, 3)).toBeCloseTo(20);
  });
});

describe('moving', () => {
  it('rejects overlapping moves and applies valid ones', () => {
    const doc = projectWithClips([
      [0, 5],
      [5, 5],
    ]);
    const [a, b] = doc.tracks[0]!.clips as VideoClip[];
    const trackId = doc.tracks[0]!.id;
    expect(validateMoves(doc, [{ clipId: a!.id, start: 3, trackId }])).toBe(false);
    expect(applyMoves(doc, [{ clipId: a!.id, start: 10, trackId }])).toBe(true);
    expect(findClip(doc, a!.id)!.clip.start).toBe(10);
    expect(doc.tracks[0]!.clips[0]!.id).toBe(b!.id);
  });

  it('allows swapping clips moved together', () => {
    const doc = projectWithClips([
      [0, 5],
      [5, 5],
    ]);
    const [a, b] = doc.tracks[0]!.clips;
    const trackId = doc.tracks[0]!.id;
    expect(
      applyMoves(doc, [
        { clipId: a!.id, start: 5, trackId },
        { clipId: b!.id, start: 0, trackId },
      ]),
    ).toBe(true);
  });

  it('refuses to move a visual clip onto an audio track', () => {
    const doc = projectWithClips([[0, 5]]);
    const clip = doc.tracks[0]!.clips[0]!;
    expect(validateMoves(doc, [{ clipId: clip.id, start: 0, trackId: doc.tracks[1]!.id }])).toBe(
      false,
    );
  });
});

describe('trimming', () => {
  it('trims the start and adjusts the source offset', () => {
    const doc = projectWithClips([[0, 10]]);
    const clip = doc.tracks[0]!.clips[0] as VideoClip;
    trimClip(doc, clip.id, 'start', 2, assets);
    expect(clip.start).toBeCloseTo(2);
    expect(clip.duration).toBeCloseTo(8);
    expect(clip.trimStart).toBeCloseTo(2);
  });

  it('cannot extend the start before the media begins', () => {
    const doc = projectWithClips([[5, 5]]);
    const clip = doc.tracks[0]!.clips[0] as VideoClip;
    trimClip(doc, clip.id, 'start', 0, assets);
    expect(clip.start).toBeCloseTo(5);
    expect(clip.trimStart).toBeCloseTo(0);
  });

  it('cannot extend the end past the media or into the next clip', () => {
    const doc = projectWithClips([
      [0, 10],
      [15, 2],
    ]);
    const clip = doc.tracks[0]!.clips[0] as VideoClip;
    trimClip(doc, clip.id, 'end', 30, assets);
    expect(clipEnd(clip)).toBeCloseTo(15);
    const doc2 = projectWithClips([[0, 10]]);
    const clip2 = doc2.tracks[0]!.clips[0] as VideoClip;
    trimClip(doc2, clip2.id, 'end', 30, assets);
    expect(clip2.duration).toBeCloseTo(20); // asset is 20s long
  });

  it('lets generated clips extend freely', () => {
    const doc = projectWithClips([]);
    const text = createTextClip(0);
    insertClip(doc, text, { trackId: doc.tracks[0]!.id });
    trimClip(doc, text.id, 'end', 42, assets);
    expect(text.duration).toBeCloseTo(42);
  });
});

describe('splitting', () => {
  it('splits a clip into two contiguous halves with correct source offsets', () => {
    const doc = projectWithClips([[2, 10]]);
    const clip = doc.tracks[0]!.clips[0] as VideoClip;
    clip.speed = 2;
    clip.duration = 5;
    const rightId = splitClip(doc, clip.id, 4)!;
    const right = findClip(doc, rightId)!.clip as VideoClip;
    expect(clip.duration).toBeCloseTo(2);
    expect(right.start).toBeCloseTo(4);
    expect(right.duration).toBeCloseTo(3);
    expect(right.trimStart).toBeCloseTo(4); // 2 timeline seconds at 2x
  });

  it('splits keyframes so the animation is continuous', () => {
    const doc = projectWithClips([[0, 10]]);
    const clip = doc.tracks[0]!.clips[0] as VideoClip;
    clip.keyframes.x = [
      { time: 0, value: 0, easing: 'linear' },
      { time: 10, value: 100, easing: 'linear' },
    ];
    const right = findClip(doc, splitClip(doc, clip.id, 4)!)!.clip as VideoClip;
    expect(clip.keyframes.x!.at(-1)).toMatchObject({ time: 4, value: 40 });
    expect(right.keyframes.x![0]).toMatchObject({ time: 0, value: 40 });
    expect(right.keyframes.x!.at(-1)).toMatchObject({ time: 6, value: 100 });
  });

  it('ignores splits at the clip edges', () => {
    const doc = projectWithClips([[0, 10]]);
    const clip = doc.tracks[0]!.clips[0]!;
    expect(splitClip(doc, clip.id, 0)).toBeNull();
    expect(splitClip(doc, clip.id, 10)).toBeNull();
  });

  it('splits everything under the playhead', () => {
    const doc = projectWithClips([[0, 10]]);
    insertClip(doc, imageClip(0, 10));
    expect(splitAt(doc, 5)).toHaveLength(2);
  });
});

describe('deleting and duplicating', () => {
  it('ripple-deletes and closes the gap', () => {
    const doc = projectWithClips([
      [0, 5],
      [5, 5],
      [10, 5],
    ]);
    const middle = doc.tracks[0]!.clips[1]!;
    removeClips(doc, [middle.id], { ripple: true });
    expect(doc.tracks[0]!.clips.map((c) => c.start)).toEqual([0, 5]);
  });

  it('duplicates after the original', () => {
    const doc = projectWithClips([[0, 5]]);
    const [copyId] = duplicateClips(doc, [doc.tracks[0]!.clips[0]!.id]);
    expect(findClip(doc, copyId!)!.clip.start).toBeCloseTo(5);
  });

  it('copies and pastes at the playhead keeping relative offsets', () => {
    const doc = projectWithClips([
      [0, 2],
      [3, 2],
    ]);
    const items = copyClips(
      doc,
      doc.tracks[0]!.clips.map((c) => c.id),
    );
    const ids = pasteClips(doc, items, 10);
    const starts = ids.map((id) => findClip(doc, id)!.clip.start).sort((a, b) => a - b);
    expect(starts).toEqual([10, 13]);
  });
});

describe('speed and audio', () => {
  it('changes speed keeping the consumed source range', () => {
    const doc = projectWithClips([[0, 10]]);
    const clip = doc.tracks[0]!.clips[0] as VideoClip;
    setClipSpeed(doc, clip.id, 2, assets);
    expect(clip.duration).toBeCloseTo(5);
    setClipSpeed(doc, clip.id, 0.5, assets);
    expect(clip.duration).toBeCloseTo(20);
  });

  it('clamps slow motion to the next clip', () => {
    const doc = projectWithClips([
      [0, 4],
      [6, 4],
    ]);
    const clip = doc.tracks[0]!.clips[0] as VideoClip;
    setClipSpeed(doc, clip.id, 0.5, assets);
    expect(clip.duration).toBeCloseTo(6);
  });

  it('detaches audio into an audio track and mutes the video', () => {
    const doc = projectWithClips([[1, 4]]);
    const video = doc.tracks[0]!.clips[0] as VideoClip;
    const audioId = detachAudio(doc, video.id, assets)!;
    const loc = findClip(doc, audioId)!;
    expect(loc.track.kind).toBe('audio');
    expect(loc.clip.start).toBe(1);
    expect(video.muted).toBe(true);
    expect(detachAudio(doc, video.id, assets)).toBeNull();
  });

  it('lists audio segments honoring mute and missing audio', () => {
    const doc = projectWithClips([
      [0, 5],
      [5, 5],
    ]);
    (doc.tracks[0]!.clips[1] as VideoClip).assetId = SILENT_VIDEO_ASSET.id;
    expect(getAudioSegments(doc, assets)).toHaveLength(1);
    doc.tracks[0]!.muted = true;
    expect(getAudioSegments(doc, assets)).toHaveLength(0);
  });
});

describe('transitions', () => {
  it('only allows transitions between touching clips', () => {
    const doc = projectWithClips([
      [0, 5],
      [5, 5],
      [12, 5],
    ]);
    const [, b, c] = doc.tracks[0]!.clips;
    expect(setTransition(doc, b!.id, { type: 'fade', duration: 1 })).toBe(true);
    expect(setTransition(doc, c!.id, { type: 'fade', duration: 1 })).toBe(false);
  });

  it('centers the transition window on the cut', () => {
    const doc = projectWithClips([
      [0, 5],
      [5, 5],
    ]);
    const [a, b] = doc.tracks[0]!.clips;
    setTransition(doc, b!.id, { type: 'wipeleft', duration: 2 });
    const [window] = getTrackTransitions(doc.tracks[0]!);
    expect(window).toMatchObject({ start: 4, end: 6, duration: 2 });
    expect(getTrackItemAt(doc.tracks[0]!, 3)).toMatchObject({ kind: 'clip', clip: { id: a!.id } });
    const mid = getTrackItemAt(doc.tracks[0]!, 5);
    expect(mid?.kind).toBe('transition');
    if (mid?.kind === 'transition') expect(mid.progress).toBeCloseTo(0.5);
  });

  it('drops transitions when clips are separated', () => {
    const doc = projectWithClips([
      [0, 5],
      [5, 5],
    ]);
    const b = doc.tracks[0]!.clips[1] as VideoClip;
    setTransition(doc, b.id, { type: 'fade', duration: 1 });
    applyMoves(doc, [{ clipId: b.id, start: 7, trackId: doc.tracks[0]!.id }]);
    expect(b.transitionIn).toBeNull();
  });

  it('clamps transitions to the shorter clip', () => {
    const doc = projectWithClips([
      [0, 0.5],
      [0.5, 5],
    ]);
    const b = doc.tracks[0]!.clips[1] as VideoClip;
    setTransition(doc, b.id, { type: 'fade', duration: 2 });
    expect(b.transitionIn!.duration).toBeCloseTo(0.5);
  });
});

describe('snapping', () => {
  it('snaps to nearby points within the threshold', () => {
    expect(snapTime(4.95, [0, 5, 10], 0.1)).toMatchObject({ time: 5, snapped: true });
    expect(snapTime(4.5, [0, 5, 10], 0.1)).toMatchObject({ time: 4.5, snapped: false });
  });

  it('snaps either edge of a span', () => {
    expect(snapSpan(2.05, 3, [0, 5], 0.1).time).toBeCloseTo(2); // end snaps to 5
    expect(snapSpan(0.04, 3, [0, 5], 0.1).time).toBeCloseTo(0);
  });

  it('collects clip edges, markers and the playhead', () => {
    const doc = projectWithClips([[1, 2]]);
    doc.markers.push({ id: 'mrk_1', time: 7, label: '', color: '#ffffff' });
    expect(collectSnapPoints(doc, { playhead: 4 })).toEqual([0, 1, 3, 4, 7]);
  });
});

it('computes the project duration', () => {
  expect(getProjectDuration(projectWithClips([]))).toBe(0);
  expect(getProjectDuration(projectWithClips([[3, 4]]))).toBe(7);
});
