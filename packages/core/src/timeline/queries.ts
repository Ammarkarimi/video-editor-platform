import type { AssetLookup } from '../api.js';
import type {
  AudibleClip,
  Clip,
  ClipType,
  MediaClip,
  ProjectDoc,
  TimedMediaClip,
  Track,
  TrackKind,
  Transition,
  VisualClip,
} from '../model/schema.js';
import { TIME_EPSILON } from '../util/math.js';

export const MIN_TRANSITION_DURATION = 0.05;

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration;
}

export function isVisualClip(clip: Clip): clip is VisualClip {
  return clip.type !== 'audio';
}

export function isTimedMediaClip(clip: Clip): clip is TimedMediaClip {
  return clip.type === 'video' || clip.type === 'audio';
}

export function isMediaClip(clip: Clip): clip is MediaClip {
  return clip.type === 'video' || clip.type === 'audio' || clip.type === 'image';
}

export function isAudibleClip(clip: Clip): clip is AudibleClip {
  return clip.type === 'video' || clip.type === 'audio';
}

export function trackAcceptsClipType(kind: TrackKind, type: ClipType): boolean {
  return kind === 'audio' ? type === 'audio' : type !== 'audio';
}

export function trackKindForClip(type: ClipType): TrackKind {
  return type === 'audio' ? 'audio' : 'video';
}

export interface ClipLocation {
  clip: Clip;
  track: Track;
  trackIndex: number;
  clipIndex: number;
}

export function findClip(doc: ProjectDoc, clipId: string): ClipLocation | null {
  for (let trackIndex = 0; trackIndex < doc.tracks.length; trackIndex++) {
    const track = doc.tracks[trackIndex]!;
    const clipIndex = track.clips.findIndex((c) => c.id === clipId);
    if (clipIndex >= 0) return { clip: track.clips[clipIndex]!, track, trackIndex, clipIndex };
  }
  return null;
}

export function findTrack(
  doc: ProjectDoc,
  trackId: string,
): { track: Track; index: number } | null {
  const index = doc.tracks.findIndex((t) => t.id === trackId);
  return index >= 0 ? { track: doc.tracks[index]!, index } : null;
}

export function getAllClips(doc: ProjectDoc): Clip[] {
  return doc.tracks.flatMap((t) => t.clips);
}

export function getProjectDuration(doc: ProjectDoc): number {
  let end = 0;
  for (const track of doc.tracks) {
    for (const clip of track.clips) end = Math.max(end, clipEnd(clip));
  }
  return end;
}

export function sortedClips(track: Track): Clip[] {
  return [...track.clips].sort((a, b) => a.start - b.start);
}

export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  epsilon = TIME_EPSILON,
): boolean {
  return aStart < bEnd - epsilon && bStart < aEnd - epsilon;
}

export function isRangeFree(
  track: Track,
  start: number,
  end: number,
  ignoreIds?: ReadonlySet<string>,
): boolean {
  return track.clips.every(
    (c) => ignoreIds?.has(c.id) || !rangesOverlap(start, end, c.start, clipEnd(c)),
  );
}

/** Free intervals of a track (the last one is open-ended). */
export function getTrackGaps(
  track: Track,
  ignoreIds?: ReadonlySet<string>,
): Array<{ start: number; end: number }> {
  const clips = sortedClips(track).filter((c) => !ignoreIds?.has(c.id));
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const clip of clips) {
    if (clip.start > cursor + TIME_EPSILON) gaps.push({ start: cursor, end: clip.start });
    cursor = Math.max(cursor, clipEnd(clip));
  }
  gaps.push({ start: cursor, end: Number.POSITIVE_INFINITY });
  return gaps;
}

/**
 * Finds the start time closest to `desiredStart` where a clip of `duration` fits on the track
 * without overlapping other clips.
 */
export function findNearestFreeStart(
  track: Track,
  desiredStart: number,
  duration: number,
  ignoreIds?: ReadonlySet<string>,
): number {
  let best = Number.NaN;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const gap of getTrackGaps(track, ignoreIds)) {
    if (gap.end - gap.start + TIME_EPSILON < duration) continue;
    const candidate = Math.min(Math.max(desiredStart, gap.start), gap.end - duration);
    const distance = Math.abs(candidate - desiredStart);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return Math.max(0, best);
}

export function getAdjacentPrev(track: Track, clip: Clip): Clip | undefined {
  return track.clips.find(
    (c) => c.id !== clip.id && Math.abs(clipEnd(c) - clip.start) <= TIME_EPSILON * 10,
  );
}

export function getAdjacentNext(track: Track, clip: Clip): Clip | undefined {
  const end = clipEnd(clip);
  return track.clips.find((c) => c.id !== clip.id && Math.abs(c.start - end) <= TIME_EPSILON * 10);
}

export function getPrevClip(track: Track, clip: Clip): Clip | undefined {
  let best: Clip | undefined;
  for (const c of track.clips) {
    if (c.id === clip.id || c.start >= clip.start) continue;
    if (!best || c.start > best.start) best = c;
  }
  return best;
}

export function getNextClip(track: Track, clip: Clip): Clip | undefined {
  let best: Clip | undefined;
  for (const c of track.clips) {
    if (c.id === clip.id || c.start <= clip.start) continue;
    if (!best || c.start < best.start) best = c;
  }
  return best;
}

/** Seconds of source media available after the clip's trim point, or Infinity for generated content. */
export function getSourceDuration(clip: Clip, assets: AssetLookup): number {
  if (!isTimedMediaClip(clip)) return Number.POSITIVE_INFINITY;
  const asset = assets(clip.assetId);
  if (!asset || asset.duration <= 0) return Number.POSITIVE_INFINITY;
  return asset.duration;
}

/** Longest timeline duration the clip may have given its source media, trim and speed. */
export function getMaxClipDuration(clip: Clip, assets: AssetLookup): number {
  if (!isTimedMediaClip(clip)) return Number.POSITIVE_INFINITY;
  const sourceDuration = getSourceDuration(clip, assets);
  return Math.max(0, (sourceDuration - clip.trimStart) / clip.speed);
}

/** Maps a timeline time to the corresponding source media time (not clamped). */
export function sourceTimeAt(clip: TimedMediaClip, timelineTime: number): number {
  return clip.trimStart + (timelineTime - clip.start) * clip.speed;
}

export function canHaveTransition(track: Track, clip: Clip): boolean {
  if (track.kind !== 'video' || !isVisualClip(clip)) return false;
  const prev = getAdjacentPrev(track, clip);
  return !!prev && isVisualClip(prev);
}

export function effectiveTransitionDuration(
  outgoing: Clip,
  incoming: Clip,
  transition: Transition,
): number {
  return Math.min(transition.duration, outgoing.duration, incoming.duration);
}

export interface TransitionWindow {
  outgoing: VisualClip;
  incoming: VisualClip;
  transition: Transition;
  start: number;
  end: number;
  duration: number;
}

/** Transitions on a track, each centered on the cut between two adjacent clips. */
export function getTrackTransitions(track: Track): TransitionWindow[] {
  if (track.kind !== 'video') return [];
  const result: TransitionWindow[] = [];
  for (const clip of track.clips) {
    if (!isVisualClip(clip) || !clip.transitionIn) continue;
    const prev = getAdjacentPrev(track, clip);
    if (!prev || !isVisualClip(prev)) continue;
    const duration = effectiveTransitionDuration(prev, clip, clip.transitionIn);
    if (duration < MIN_TRANSITION_DURATION) continue;
    result.push({
      outgoing: prev,
      incoming: clip,
      transition: clip.transitionIn,
      start: clip.start - duration / 2,
      end: clip.start + duration / 2,
      duration,
    });
  }
  return result;
}

export type TrackRenderItem =
  | { kind: 'clip'; clip: VisualClip }
  | { kind: 'transition'; window: TransitionWindow; progress: number };

/** What a visual track shows at `time`: nothing, a single clip, or a transition between two clips. */
export function getTrackItemAt(track: Track, time: number): TrackRenderItem | null {
  if (track.kind !== 'video') return null;
  for (const window of getTrackTransitions(track)) {
    if (time >= window.start && time < window.end) {
      return { kind: 'transition', window, progress: (time - window.start) / window.duration };
    }
  }
  for (const clip of track.clips) {
    if (isVisualClip(clip) && time >= clip.start && time < clipEnd(clip))
      return { kind: 'clip', clip };
  }
  return null;
}

/**
 * The time range during which a visual clip contributes pixels, including transition overlaps
 * into neighbouring clips.
 */
export function getClipVisibleRange(track: Track, clip: Clip): { start: number; end: number } {
  let start = clip.start;
  let end = clipEnd(clip);
  for (const window of getTrackTransitions(track)) {
    if (window.incoming.id === clip.id) start = Math.min(start, window.start);
    if (window.outgoing.id === clip.id) end = Math.max(end, window.end);
  }
  return { start, end };
}

export interface AudioSegment {
  clipId: string;
  assetId: string;
  /** Timeline range in seconds. */
  start: number;
  end: number;
  /** Source time at `start`. */
  sourceStart: number;
  speed: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

/** Every audible clip section of the project, honouring track/clip mute and missing audio. */
export function getAudioSegments(doc: ProjectDoc, assets: AssetLookup): AudioSegment[] {
  const segments: AudioSegment[] = [];
  for (const track of doc.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      if (!isAudibleClip(clip) || clip.muted || clip.volume <= 0) continue;
      const asset = assets(clip.assetId);
      if (!asset || !asset.hasAudio) continue;
      segments.push({
        clipId: clip.id,
        assetId: clip.assetId,
        start: clip.start,
        end: clipEnd(clip),
        sourceStart: clip.trimStart,
        speed: clip.speed,
        volume: clip.volume,
        fadeIn: Math.min(clip.fadeIn, clip.duration),
        fadeOut: Math.min(clip.fadeOut, clip.duration),
      });
    }
  }
  return segments.sort((a, b) => a.start - b.start);
}

/** Gain multiplier (0..1) contributed by a clip's fade in/out at a timeline time. */
export function fadeGainAt(
  clip: { start: number; duration: number; fadeIn: number; fadeOut: number },
  time: number,
): number {
  const local = time - clip.start;
  if (local < 0 || local > clip.duration) return 0;
  let gain = 1;
  if (clip.fadeIn > 0 && local < clip.fadeIn) gain *= local / clip.fadeIn;
  const remaining = clip.duration - local;
  if (clip.fadeOut > 0 && remaining < clip.fadeOut) gain *= remaining / clip.fadeOut;
  return Math.max(0, Math.min(1, gain));
}

/** Asset ids referenced by the document. */
export function getReferencedAssetIds(doc: ProjectDoc): Set<string> {
  const ids = new Set<string>();
  for (const track of doc.tracks) {
    for (const clip of track.clips) if (isMediaClip(clip)) ids.add(clip.assetId);
  }
  return ids;
}
