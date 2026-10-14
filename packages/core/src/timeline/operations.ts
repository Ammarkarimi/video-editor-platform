/**
 * Editing operations on a project document.
 *
 * All functions mutate the document passed in, which makes them convenient inside Immer's
 * `produce()` (the web editor) while staying trivially testable on plain objects.
 */
import type { AssetLookup } from '../api.js';
import {
  interpolateKeyframes,
  scaleKeyframeTimes,
  shiftKeyframes,
  sortKeyframes,
  truncateKeyframes,
  ANIMATABLE_PROP_LIST,
} from '../animation/keyframes.js';
import { createAudioClip, createTrack } from '../model/defaults.js';
import type {
  AudioClip,
  Clip,
  Keyframes,
  ProjectDoc,
  Track,
  TrackKind,
  Transition,
  VisualClip,
} from '../model/schema.js';
import { createId } from '../util/ids.js';
import { TIME_EPSILON } from '../util/math.js';
import {
  canHaveTransition,
  clipEnd,
  effectiveTransitionDuration,
  findClip,
  findNearestFreeStart,
  findTrack,
  getAdjacentPrev,
  getMaxClipDuration,
  getNextClip,
  getPrevClip,
  isAudibleClip,
  isRangeFree,
  isTimedMediaClip,
  isVisualClip,
  MIN_TRANSITION_DURATION,
  trackAcceptsClipType,
  trackKindForClip,
} from './queries.js';

/** Shortest clip the editor allows (seconds). */
export const MIN_CLIP_DURATION = 1 / 30;

/**
 * Deep-copies a clip. Clips are plain JSON, and a JSON round trip (unlike `structuredClone`) also
 * works on Immer draft proxies, which is what the editor passes in.
 */
export function cloneClip<T extends Clip>(clip: T): T {
  return JSON.parse(JSON.stringify(clip)) as T;
}

function sortTrack(track: Track): void {
  track.clips.sort((a, b) => a.start - b.start);
}

function nextTrackName(doc: ProjectDoc, kind: TrackKind): string {
  const prefix = kind === 'video' ? 'Video' : 'Audio';
  let n = doc.tracks.filter((t) => t.kind === kind).length + 1;
  while (doc.tracks.some((t) => t.name === `${prefix} ${n}`)) n++;
  return `${prefix} ${n}`;
}

/**
 * Adds a track. By default video tracks are inserted above all others (so new overlays draw on
 * top) and audio tracks are appended at the bottom.
 */
export function addTrack(doc: ProjectDoc, kind: TrackKind, index?: number): Track {
  const track = createTrack(kind, nextTrackName(doc, kind));
  let at = index;
  if (at === undefined) {
    if (kind === 'video') at = 0;
    else at = doc.tracks.length;
  }
  doc.tracks.splice(Math.max(0, Math.min(at, doc.tracks.length)), 0, track);
  return track;
}

export function removeTrack(doc: ProjectDoc, trackId: string): boolean {
  const found = findTrack(doc, trackId);
  if (!found) return false;
  doc.tracks.splice(found.index, 1);
  return true;
}

export function moveTrack(doc: ProjectDoc, trackId: string, toIndex: number): boolean {
  const found = findTrack(doc, trackId);
  if (!found) return false;
  const [track] = doc.tracks.splice(found.index, 1);
  doc.tracks.splice(Math.max(0, Math.min(toIndex, doc.tracks.length)), 0, track!);
  return true;
}

export interface PlaceClipOptions {
  /** Preferred track; another free track (or a new one) is used when it cannot hold the clip. */
  trackId?: string;
  /** When true, the clip slides to the nearest free gap of the preferred track instead of moving to another track. */
  slideToFit?: boolean;
}

/**
 * Inserts a clip without overlapping existing clips. Returns the id of the track that received it.
 */
export function insertClip(doc: ProjectDoc, clip: Clip, options: PlaceClipOptions = {}): string {
  const kind = trackKindForClip(clip.type);
  const preferred = options.trackId ? findTrack(doc, options.trackId) : null;
  const end = clipEnd(clip);

  if (
    preferred &&
    trackAcceptsClipType(preferred.track.kind, clip.type) &&
    !preferred.track.locked
  ) {
    if (isRangeFree(preferred.track, clip.start, end)) {
      preferred.track.clips.push(clip);
      sortTrack(preferred.track);
      return preferred.track.id;
    }
    if (options.slideToFit) {
      clip.start = findNearestFreeStart(preferred.track, clip.start, clip.duration);
      preferred.track.clips.push(clip);
      sortTrack(preferred.track);
      return preferred.track.id;
    }
  }

  // Look for another compatible track with room, nearest to the preferred one first.
  const origin = preferred?.index ?? (kind === 'video' ? 0 : doc.tracks.length - 1);
  const candidates = doc.tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => track.kind === kind && !track.locked)
    .sort((a, b) => Math.abs(a.index - origin) - Math.abs(b.index - origin));
  for (const { track } of candidates) {
    if (isRangeFree(track, clip.start, end)) {
      track.clips.push(clip);
      sortTrack(track);
      return track.id;
    }
  }

  // No room anywhere: create a track next to the preferred one.
  let insertAt: number | undefined;
  if (preferred && preferred.track.kind === kind)
    insertAt = kind === 'video' ? preferred.index : preferred.index + 1;
  else if (kind === 'audio') insertAt = doc.tracks.length;
  else {
    const firstVideo = doc.tracks.findIndex((t) => t.kind === 'video');
    insertAt = firstVideo >= 0 ? firstVideo : 0;
  }
  const track = addTrack(doc, kind, insertAt);
  track.clips.push(clip);
  return track.id;
}

export function removeClips(
  doc: ProjectDoc,
  clipIds: Iterable<string>,
  options: { ripple?: boolean } = {},
): number {
  const ids = new Set(clipIds);
  let removed = 0;
  for (const track of doc.tracks) {
    if (track.locked) continue;
    const deleted = track.clips.filter((c) => ids.has(c.id)).sort((a, b) => b.start - a.start);
    if (deleted.length === 0) continue;
    track.clips = track.clips.filter((c) => !ids.has(c.id));
    removed += deleted.length;
    if (options.ripple) {
      // Close each gap, last first, so earlier shifts don't disturb later ones.
      for (const gone of deleted) {
        const end = clipEnd(gone);
        for (const clip of track.clips) {
          if (clip.start >= end - TIME_EPSILON)
            clip.start = Math.max(0, clip.start - gone.duration);
        }
      }
    }
  }
  normalizeDocument(doc);
  return removed;
}

export interface ClipMove {
  clipId: string;
  start: number;
  trackId: string;
}

/** Checks that a set of moves leaves every track overlap-free and every clip on a compatible track. */
export function validateMoves(doc: ProjectDoc, moves: ClipMove[]): boolean {
  const moving = new Set(moves.map((m) => m.clipId));
  const placed = new Map<string, Array<{ start: number; end: number }>>();
  for (const move of moves) {
    const loc = findClip(doc, move.clipId);
    const target = findTrack(doc, move.trackId);
    if (!loc || !target || target.track.locked || loc.track.locked) return false;
    if (!trackAcceptsClipType(target.track.kind, loc.clip.type)) return false;
    if (move.start < -TIME_EPSILON) return false;
    const end = move.start + loc.clip.duration;
    if (!isRangeFree(target.track, move.start, end, moving)) return false;
    const list = placed.get(move.trackId) ?? [];
    if (list.some((r) => move.start < r.end - TIME_EPSILON && r.start < end - TIME_EPSILON))
      return false;
    list.push({ start: move.start, end });
    placed.set(move.trackId, list);
  }
  return true;
}

export function applyMoves(doc: ProjectDoc, moves: ClipMove[]): boolean {
  if (!validateMoves(doc, moves)) return false;
  const extracted: Array<{ clip: Clip; move: ClipMove }> = [];
  for (const move of moves) {
    const loc = findClip(doc, move.clipId)!;
    loc.track.clips.splice(loc.clipIndex, 1);
    extracted.push({ clip: loc.clip, move });
  }
  for (const { clip, move } of extracted) {
    clip.start = Math.max(0, move.start);
    const target = findTrack(doc, move.trackId)!.track;
    target.clips.push(clip);
    sortTrack(target);
  }
  normalizeDocument(doc);
  return true;
}

/**
 * Trims one edge of a clip to `time`, respecting neighbours, the minimum duration and (for
 * video/audio) the available source media. Returns the clamped time actually applied.
 */
export function trimClip(
  doc: ProjectDoc,
  clipId: string,
  edge: 'start' | 'end',
  time: number,
  assets: AssetLookup,
): number | null {
  const loc = findClip(doc, clipId);
  if (!loc || loc.track.locked) return null;
  const { clip, track } = loc;
  const end = clipEnd(clip);

  if (edge === 'start') {
    const prev = getPrevClip(track, clip);
    let min = prev ? clipEnd(prev) : 0;
    if (isTimedMediaClip(clip)) min = Math.max(min, clip.start - clip.trimStart / clip.speed);
    const max = end - MIN_CLIP_DURATION;
    const newStart = Math.min(Math.max(time, min), max);
    const delta = newStart - clip.start;
    if (Math.abs(delta) < 1e-9) return newStart;
    if (isTimedMediaClip(clip)) clip.trimStart = Math.max(0, clip.trimStart + delta * clip.speed);
    if (isVisualClip(clip)) clip.keyframes = shiftKeyframes(clip.keyframes, delta);
    clip.start = newStart;
    clip.duration = end - newStart;
    sortTrack(track);
    normalizeDocument(doc);
    return newStart;
  }

  const next = getNextClip(track, clip);
  let max = next ? next.start : Number.POSITIVE_INFINITY;
  max = Math.min(max, clip.start + getMaxClipDuration(clip, assets));
  const min = clip.start + MIN_CLIP_DURATION;
  const newEnd = Math.max(Math.min(time, max), min);
  clip.duration = newEnd - clip.start;
  normalizeDocument(doc);
  return newEnd;
}

function splitKeyframes(keyframes: Keyframes, at: number): { left: Keyframes; right: Keyframes } {
  const left = truncateKeyframes(keyframes, at);
  const right = shiftKeyframes(keyframes, at);
  // Make sure the right half starts exactly at the interpolated value.
  for (const prop of ANIMATABLE_PROP_LIST) {
    const list = keyframes[prop];
    if (!list || list.length === 0) continue;
    const value = interpolateKeyframes(sortKeyframes(list), at);
    const r = right[prop] ?? [];
    if (!r.some((k) => Math.abs(k.time) < 1e-3)) r.unshift({ time: 0, value, easing: 'linear' });
    right[prop] = r;
  }
  return { left, right };
}

/** Splits a clip at a timeline time. Returns the id of the new right-hand clip. */
export function splitClip(doc: ProjectDoc, clipId: string, time: number): string | null {
  const loc = findClip(doc, clipId);
  if (!loc || loc.track.locked) return null;
  const { clip, track } = loc;
  const end = clipEnd(clip);
  if (time <= clip.start + MIN_CLIP_DURATION / 2 || time >= end - MIN_CLIP_DURATION / 2)
    return null;

  const offset = time - clip.start;
  const right = cloneClip(clip);
  right.id = createId('clp');
  right.start = time;
  right.duration = end - time;
  clip.duration = offset;

  if (isTimedMediaClip(clip) && isTimedMediaClip(right)) {
    right.trimStart = clip.trimStart + offset * clip.speed;
    right.fadeIn = 0;
    clip.fadeOut = 0;
  }
  if (isVisualClip(clip) && isVisualClip(right)) {
    const { left: lk, right: rk } = splitKeyframes(clip.keyframes, offset);
    clip.keyframes = lk;
    right.keyframes = rk;
    clip.animationOut = null;
    right.animationIn = null;
    right.transitionIn = null;
  }
  track.clips.push(right);
  sortTrack(track);
  normalizeDocument(doc);
  return right.id;
}

/** Splits every unlocked clip under the playhead (or only `clipIds` when given). */
export function splitAt(doc: ProjectDoc, time: number, clipIds?: ReadonlySet<string>): string[] {
  const targets: string[] = [];
  for (const track of doc.tracks) {
    if (track.locked) continue;
    for (const clip of track.clips) {
      if (clipIds && clipIds.size > 0 && !clipIds.has(clip.id)) continue;
      if (time > clip.start && time < clipEnd(clip)) targets.push(clip.id);
    }
  }
  const created: string[] = [];
  for (const id of targets) {
    const newId = splitClip(doc, id, time);
    if (newId) created.push(newId);
  }
  return created;
}

/** Duplicates clips, placing each copy right after its original when there is room. */
export function duplicateClips(doc: ProjectDoc, clipIds: Iterable<string>): string[] {
  const created: string[] = [];
  const locs = [...clipIds]
    .map((id) => findClip(doc, id))
    .filter((l): l is NonNullable<typeof l> => !!l)
    .sort((a, b) => a.clip.start - b.clip.start);
  for (const loc of locs) {
    const copy = cloneClip(loc.clip);
    copy.id = createId('clp');
    copy.start = clipEnd(loc.clip);
    if (isVisualClip(copy)) copy.transitionIn = null;
    insertClip(doc, copy, { trackId: loc.track.id });
    created.push(copy.id);
  }
  normalizeDocument(doc);
  return created;
}

/** Copies clips for the clipboard, with times relative to the earliest clip. */
export function copyClips(
  doc: ProjectDoc,
  clipIds: Iterable<string>,
): Array<{ clip: Clip; trackId: string; offset: number }> {
  const locs = [...clipIds]
    .map((id) => findClip(doc, id))
    .filter((l): l is NonNullable<typeof l> => !!l);
  if (locs.length === 0) return [];
  const origin = Math.min(...locs.map((l) => l.clip.start));
  return locs.map((l) => ({
    clip: cloneClip(l.clip),
    trackId: l.track.id,
    offset: l.clip.start - origin,
  }));
}

export function pasteClips(
  doc: ProjectDoc,
  items: Array<{ clip: Clip; trackId: string; offset: number }>,
  time: number,
): string[] {
  const created: string[] = [];
  for (const item of items) {
    const copy = cloneClip(item.clip);
    copy.id = createId('clp');
    copy.start = Math.max(0, time + item.offset);
    if (isVisualClip(copy)) copy.transitionIn = null;
    insertClip(doc, copy, { trackId: item.trackId });
    created.push(copy.id);
  }
  normalizeDocument(doc);
  return created;
}

/**
 * Changes playback speed while keeping the clip's start. The duration follows the consumed source
 * range, clamped so the clip never runs into the next clip or past the end of its media.
 */
export function setClipSpeed(
  doc: ProjectDoc,
  clipId: string,
  speed: number,
  assets: AssetLookup,
): boolean {
  const loc = findClip(doc, clipId);
  if (!loc || loc.track.locked || !isTimedMediaClip(loc.clip)) return false;
  const clip = loc.clip;
  const newSpeed = Math.min(16, Math.max(0.1, speed));
  const sourceSpan = clip.duration * clip.speed;
  let newDuration = sourceSpan / newSpeed;
  const next = getNextClip(loc.track, clip);
  if (next) newDuration = Math.min(newDuration, next.start - clip.start);
  const asset = assets(clip.assetId);
  if (asset && asset.duration > 0) {
    newDuration = Math.min(newDuration, (asset.duration - clip.trimStart) / newSpeed);
  }
  newDuration = Math.max(MIN_CLIP_DURATION, newDuration);
  if (clip.type === 'video')
    clip.keyframes = scaleKeyframeTimes(clip.keyframes, newDuration / clip.duration);
  clip.speed = newSpeed;
  clip.duration = newDuration;
  normalizeDocument(doc);
  return true;
}

/**
 * Moves a video clip's sound into a separate audio clip (on a free audio track) and mutes the
 * video. Returns the new audio clip id.
 */
export function detachAudio(doc: ProjectDoc, clipId: string, assets: AssetLookup): string | null {
  const loc = findClip(doc, clipId);
  if (!loc || loc.clip.type !== 'video') return null;
  const video = loc.clip;
  const asset = assets(video.assetId);
  if (!asset?.hasAudio || video.muted) return null;
  const audio: AudioClip = {
    ...createAudioClip(
      { assetId: video.assetId, name: `${video.name} (audio)`, duration: video.duration },
      video.start,
    ),
    trimStart: video.trimStart,
    speed: video.speed,
    volume: video.volume,
    fadeIn: video.fadeIn,
    fadeOut: video.fadeOut,
  };
  insertClip(doc, audio);
  video.muted = true;
  return audio.id;
}

/** Sets or clears the transition between a clip and the clip ending where it starts. */
export function setTransition(
  doc: ProjectDoc,
  clipId: string,
  transition: Transition | null,
): boolean {
  const loc = findClip(doc, clipId);
  if (!loc || !isVisualClip(loc.clip) || loc.track.locked) return false;
  if (transition === null) {
    loc.clip.transitionIn = null;
    return true;
  }
  if (!canHaveTransition(loc.track, loc.clip)) return false;
  const prev = getAdjacentPrev(loc.track, loc.clip)!;
  const duration = effectiveTransitionDuration(prev, loc.clip, transition);
  if (duration < MIN_TRANSITION_DURATION) return false;
  loc.clip.transitionIn = { type: transition.type, duration };
  return true;
}

/**
 * Restores invariants after edits: clips sorted, transitions only where two visual clips touch
 * and never longer than either clip, range inside sane bounds.
 */
export function normalizeDocument(doc: ProjectDoc): void {
  for (const track of doc.tracks) {
    sortTrack(track);
    for (const clip of track.clips) {
      if (!isVisualClip(clip) || !clip.transitionIn) continue;
      const prev = track.kind === 'video' ? getAdjacentPrev(track, clip) : undefined;
      if (!prev || !isVisualClip(prev)) {
        clip.transitionIn = null;
        continue;
      }
      const duration = effectiveTransitionDuration(prev, clip, clip.transitionIn);
      if (duration < MIN_TRANSITION_DURATION) clip.transitionIn = null;
      else if (duration < clip.transitionIn.duration) clip.transitionIn.duration = duration;
    }
  }
  if (doc.range && doc.range.end - doc.range.start < MIN_CLIP_DURATION) doc.range = null;
}

/** Clips that would be cut by a split at `time`. */
export function clipsUnderTime(doc: ProjectDoc, time: number): Clip[] {
  return doc.tracks.flatMap((t) =>
    t.locked ? [] : t.clips.filter((c) => time > c.start && time < clipEnd(c)),
  );
}

/** Whether a clip exists and sits on an unlocked track. */
export function isClipEditable(doc: ProjectDoc, clipId: string): boolean {
  const loc = findClip(doc, clipId);
  return !!loc && !loc.track.locked;
}

export function hasAudibleContent(doc: ProjectDoc, assets: AssetLookup): boolean {
  return doc.tracks.some(
    (t) =>
      !t.muted &&
      t.clips.some(
        (c) => isAudibleClip(c) && !c.muted && c.volume > 0 && !!assets(c.assetId)?.hasAudio,
      ),
  );
}

export function getVisualClips(doc: ProjectDoc): VisualClip[] {
  return doc.tracks.flatMap((t) => t.clips.filter(isVisualClip));
}

// ---------------------------------------------------------------------------------------------
// Snapping

export interface SnapOptions {
  excludeClipIds?: ReadonlySet<string>;
  playhead?: number;
  includeMarkers?: boolean;
}

export function collectSnapPoints(doc: ProjectDoc, options: SnapOptions = {}): number[] {
  const points = new Set<number>([0]);
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (options.excludeClipIds?.has(clip.id)) continue;
      points.add(clip.start);
      points.add(clipEnd(clip));
    }
  }
  if (options.playhead !== undefined) points.add(options.playhead);
  if (options.includeMarkers !== false) for (const m of doc.markers) points.add(m.time);
  if (doc.range) {
    points.add(doc.range.start);
    points.add(doc.range.end);
  }
  return [...points].sort((a, b) => a - b);
}

export interface SnapResult {
  time: number;
  snapped: boolean;
  /** The snap point that was hit, for drawing a guide line. */
  point: number | null;
}

export function snapTime(time: number, points: readonly number[], threshold: number): SnapResult {
  let best: number | null = null;
  let bestDistance = threshold;
  for (const point of points) {
    const distance = Math.abs(point - time);
    if (distance <= bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best === null
    ? { time, snapped: false, point: null }
    : { time: best, snapped: true, point: best };
}

/**
 * Snaps a moving span (e.g. a dragged clip) by whichever of its edges is closest to a snap point.
 * Returns the adjusted start.
 */
export function snapSpan(
  start: number,
  duration: number,
  points: readonly number[],
  threshold: number,
): SnapResult {
  const s = snapTime(start, points, threshold);
  const e = snapTime(start + duration, points, threshold);
  if (
    s.snapped &&
    (!e.snapped || Math.abs(s.time - start) <= Math.abs(e.time - (start + duration)))
  ) {
    return { time: s.time, snapped: true, point: s.point };
  }
  if (e.snapped) return { time: e.time - duration, snapped: true, point: e.point };
  return { time: start, snapped: false, point: null };
}
