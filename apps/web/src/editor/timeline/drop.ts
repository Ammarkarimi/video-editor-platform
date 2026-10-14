import {
  DEFAULT_IMAGE_DURATION,
  DEFAULT_TEXT_DURATION,
  findNearestFreeStart,
  getAdjacentPrev,
  isVisualClip,
  roundToFrame,
  SHAPE_PRESETS,
  TEXT_PRESETS,
  type ProjectDoc,
  type TransitionType,
} from '@vep/core';
import type { DragEvent as ReactDragEvent } from 'react';
import {
  addAssetToTimeline,
  addShapeClip,
  addTextClip,
  applyTransition,
  uploadFiles,
  type TrackTarget,
} from '../actions';
import { useEditor } from '../store/editorStore';
import { DRAG_MIME, getDragPayload, setDragPayload, type DragPayload } from './constants';
import { timeAtClientX, useTimelineView } from './viewStore';

const TRANSITION_SNAP_PX = 48;

function payloadInfo(
  payload: DragPayload | null,
): { kind: 'video' | 'audio'; duration: number } | null {
  if (!payload) return null;
  const { assets } = useEditor.getState();
  switch (payload.kind) {
    case 'asset': {
      const asset = assets.find((a) => a.id === payload.assetId);
      if (!asset) return null;
      const duration =
        asset.kind === 'image'
          ? DEFAULT_IMAGE_DURATION
          : Math.max(0.5, asset.metadata?.duration ?? DEFAULT_IMAGE_DURATION);
      return { kind: asset.kind === 'audio' ? 'audio' : 'video', duration };
    }
    case 'text':
    case 'shape':
      return { kind: 'video', duration: DEFAULT_TEXT_DURATION };
    case 'transition':
      return null;
  }
}

/** The cut (incoming clip id) nearest to `time` on a track, if within snapping distance. */
export function nearestCut(
  doc: ProjectDoc,
  trackId: string,
  time: number,
  zoom: number,
): string | null {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track || track.kind !== 'video' || track.locked) return null;
  let best: string | null = null;
  let bestDistance = TRANSITION_SNAP_PX / zoom;
  for (const clip of track.clips) {
    if (!isVisualClip(clip)) continue;
    const prev = getAdjacentPrev(track, clip);
    if (!prev || !isVisualClip(prev)) continue;
    const distance = Math.abs(clip.start - time);
    if (distance <= bestDistance) {
      best = clip.id;
      bestDistance = distance;
    }
  }
  return best;
}

function hasFiles(event: ReactDragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

function isOurDrag(event: ReactDragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(DRAG_MIME);
}

/** Where a drop would land on a track: nearest gap start for the dragged duration. */
function dropStart(doc: ProjectDoc, target: TrackTarget, time: number, duration: number): number {
  const fps = doc.settings.fps;
  if (!target || target === 'new') return roundToFrame(time, fps);
  const track = doc.tracks.find((t) => t.id === target);
  if (!track) return roundToFrame(time, fps);
  const free = findNearestFreeStart(track, time, duration);
  return roundToFrame(Number.isFinite(free) ? free : time, fps);
}

export function handleDragOver(event: ReactDragEvent, target: TrackTarget): void {
  if (!isOurDrag(event) && !hasFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  const { doc, zoom } = useEditor.getState();
  const payload = getDragPayload();
  const time = timeAtClientX(event.clientX, zoom);

  if (payload?.kind === 'transition') {
    const cut = target && target !== 'new' ? nearestCut(doc, target, time, zoom) : null;
    useTimelineView.setState({
      dropHint: cut
        ? { trackId: target!, start: findCutTime(doc, cut), duration: 0, valid: true }
        : null,
    });
    return;
  }
  const info =
    hasFiles(event) && !payload
      ? { kind: 'video' as const, duration: DEFAULT_IMAGE_DURATION }
      : payloadInfo(payload);
  if (!info) return;
  const track = target && target !== 'new' ? doc.tracks.find((t) => t.id === target) : undefined;
  const compatible = !track || (track.kind === info.kind && !track.locked);
  const start = dropStart(
    doc,
    compatible ? target : undefined,
    Math.max(0, time - 0.1),
    info.duration,
  );
  useTimelineView.setState({
    dropHint: { trackId: target ?? 'new', start, duration: info.duration, valid: compatible },
  });
}

function findCutTime(doc: ProjectDoc, clipId: string): number {
  for (const track of doc.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip.start;
  }
  return 0;
}

export function handleDragLeave(event: ReactDragEvent): void {
  const related = event.relatedTarget as Node | null;
  if (related && (event.currentTarget as Node).contains(related)) return;
  useTimelineView.setState({ dropHint: null });
}

export function handleDrop(event: ReactDragEvent, target: TrackTarget): void {
  event.preventDefault();
  const hint = useTimelineView.getState().dropHint;
  useTimelineView.setState({ dropHint: null });
  const { doc, zoom, assets } = useEditor.getState();
  const time = timeAtClientX(event.clientX, zoom);
  const payload = getDragPayload();
  setDragPayload(null);

  if (!payload && event.dataTransfer.files.length > 0) {
    const track = target && target !== 'new' ? doc.tracks.find((t) => t.id === target) : undefined;
    uploadFiles(Array.from(event.dataTransfer.files), {
      time: roundToFrame(time, doc.settings.fps),
      trackId: track?.locked ? undefined : target,
    });
    return;
  }
  if (!payload) return;
  if (payload.kind === 'transition') {
    const cut = target && target !== 'new' ? nearestCut(doc, target, time, zoom) : null;
    if (cut) applyTransition(cut, payload.type as TransitionType);
    return;
  }
  const info = payloadInfo(payload);
  const track = target && target !== 'new' ? doc.tracks.find((t) => t.id === target) : undefined;
  const compatible = !!info && (!track || (track.kind === info.kind && !track.locked));
  const placeTarget: TrackTarget = compatible ? target : undefined;
  const start = hint?.valid ? hint.start : roundToFrame(Math.max(0, time - 0.1), doc.settings.fps);
  switch (payload.kind) {
    case 'asset': {
      const asset = assets.find((a) => a.id === payload.assetId);
      if (asset) addAssetToTimeline(asset, { time: start, trackId: placeTarget });
      break;
    }
    case 'text':
      addTextClip(
        TEXT_PRESETS.find((p) => p.id === payload.presetId),
        { time: start, trackId: placeTarget },
      );
      break;
    case 'shape': {
      const preset = SHAPE_PRESETS.find((p) => p.id === payload.presetId);
      if (preset) addShapeClip(preset, { time: start, trackId: placeTarget });
      break;
    }
  }
}
