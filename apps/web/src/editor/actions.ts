import {
  addTrack,
  applyFilterPreset,
  clipEnd,
  copyClips,
  createAudioClip,
  createImageClip,
  createMarker,
  createShapeClip,
  createTextClip,
  createVideoClip,
  DEFAULT_TRANSITION_DURATION,
  detachAudio,
  duplicateClips,
  findClip,
  getAllClips,
  getProjectDuration,
  insertClip,
  isVisualClip,
  moveTrack,
  pasteClips,
  removeClips,
  removeTrack,
  roundToFrame,
  setTransition,
  splitAt,
  type AssetDTO,
  type Clip,
  type FilterPreset,
  type ProjectDoc,
  type ShapePreset,
  type TextPreset,
  type TrackKind,
  type TransitionType,
} from '@vep/core';
import type { Draft } from 'immer';
import { api, uploadAsset } from '../api/client';
import { errorMessage, toast } from '../ui/toast';
import { editor, getAssetLookup, useEditor } from './store/editorStore';

const state = () => useEditor.getState();

/** Track to receive new visual clips: the selected clip's track, else the top video track. */
function preferredTrack(kind: TrackKind): string | undefined {
  const { doc, selection } = state();
  if (selection.length > 0) {
    const loc = findClip(doc, selection[0]!);
    if (loc && loc.track.kind === kind && !loc.track.locked) return loc.track.id;
  }
  return doc.tracks.find((t) => t.kind === kind && !t.locked)?.id;
}

export function clipForAsset(asset: AssetDTO, start: number): Clip | null {
  const meta = asset.metadata;
  if (asset.status !== 'ready' || !meta) return null;
  const base = { assetId: asset.id, name: asset.name, duration: meta.duration };
  if (asset.kind === 'video') return createVideoClip(base, start);
  if (asset.kind === 'audio') return createAudioClip(base, start);
  return createImageClip(base, start);
}

export type TrackTarget = string | 'new' | undefined;

/** Index where a new track for `kind` is created from the "new track" drop zone. */
function newTrackIndex(doc: ProjectDoc, kind: TrackKind): number {
  if (kind === 'audio') return doc.tracks.length;
  let lastVideo = -1;
  doc.tracks.forEach((t, i) => {
    if (t.kind === 'video') lastVideo = i;
  });
  return lastVideo + 1;
}

/**
 * Inserts a clip. An explicit track makes the clip slide into that track's nearest gap; `'new'`
 * creates a track; no target picks a free track near the selection (or adds one).
 */
function placeClip(clip: Clip, target: TrackTarget): void {
  const kind: TrackKind = clip.type === 'audio' ? 'audio' : 'video';
  editor.update((draft) => {
    const doc = draft as ProjectDoc;
    if (target === 'new') {
      const track = addTrack(doc, kind, newTrackIndex(doc, kind));
      insertClip(doc, clip, { trackId: track.id });
    } else if (target) {
      insertClip(doc, clip, { trackId: target, slideToFit: true });
    } else {
      insertClip(doc, clip, { trackId: preferredTrack(kind) });
    }
  });
  editor.select([clip.id]);
}

/** Adds media to the timeline at the playhead (or a given time/track). */
export function addAssetToTimeline(
  asset: AssetDTO,
  options: { time?: number; trackId?: TrackTarget } = {},
): void {
  const { currentTime, doc } = state();
  const start = roundToFrame(Math.max(0, options.time ?? currentTime), doc.settings.fps);
  const clip = clipForAsset(asset, start);
  if (!clip) {
    toast.info(
      asset.status === 'error'
        ? 'This file could not be processed.'
        : 'This media is still processing.',
    );
    return;
  }
  placeClip(clip, options.trackId);
}

export function addTextClip(
  preset?: TextPreset,
  options: { time?: number; trackId?: TrackTarget } = {},
): void {
  const { currentTime, doc } = state();
  const clip = createTextClip(
    roundToFrame(Math.max(0, options.time ?? currentTime), doc.settings.fps),
    {
      preset,
      frame: doc.settings,
    },
  );
  placeClip(clip, options.trackId);
}

export function addShapeClip(
  preset: ShapePreset,
  options: { time?: number; trackId?: TrackTarget } = {},
): void {
  const { currentTime, doc } = state();
  const clip = createShapeClip(
    roundToFrame(Math.max(0, options.time ?? currentTime), doc.settings.fps),
    doc.settings,
    preset.build(doc.settings),
  );
  placeClip(clip, options.trackId);
}

export function splitAtPlayhead(): void {
  const { currentTime, selection } = state();
  let created: string[] = [];
  editor.update((draft) => {
    created = splitAt(
      draft as ProjectDoc,
      currentTime,
      selection.length > 0 ? new Set(selection) : undefined,
    );
  });
  if (created.length === 0) toast.info('Move the playhead over a clip to split it.');
  else if (selection.length > 0) editor.select(created);
}

export function deleteSelection(ripple = false): void {
  const { selection, selectedTransition } = state();
  if (selectedTransition) {
    editor.update((draft) => {
      setTransition(draft as ProjectDoc, selectedTransition, null);
    });
    editor.selectTransition(null);
    return;
  }
  if (selection.length === 0) return;
  editor.update((draft) => {
    removeClips(draft as ProjectDoc, selection, { ripple });
  });
  editor.clearSelection();
}

export function duplicateSelection(): void {
  const { selection } = state();
  if (selection.length === 0) return;
  let created: string[] = [];
  editor.update((draft) => {
    created = duplicateClips(draft as ProjectDoc, selection);
  });
  editor.select(created);
}

export function copySelection(): boolean {
  const { selection, doc } = state();
  if (selection.length === 0) return false;
  useEditor.setState({ clipboard: copyClips(doc, selection) });
  return true;
}

export function cutSelection(): void {
  if (copySelection()) deleteSelection();
}

export function pasteClipboard(): void {
  const { clipboard, currentTime } = state();
  if (clipboard.length === 0) return;
  let created: string[] = [];
  editor.update((draft) => {
    created = pasteClips(draft as ProjectDoc, clipboard, currentTime);
  });
  editor.select(created);
}

export function selectAll(): void {
  editor.select(getAllClips(state().doc).map((c) => c.id));
}

export function addMarkerAtPlayhead(): void {
  const { currentTime, doc } = state();
  const label = `Marker ${doc.markers.length + 1}`;
  editor.update((draft) => {
    draft.markers.push(createMarker(currentTime, label));
    draft.markers.sort((a, b) => a.time - b.time);
  });
}

export function setRangeEdge(edge: 'in' | 'out'): void {
  const { currentTime, doc } = state();
  const duration = getProjectDuration(doc);
  editor.update((draft) => {
    const current = draft.range ?? { start: 0, end: duration };
    let { start, end } = current;
    if (edge === 'in') start = currentTime;
    else end = currentTime;
    if (end <= start) {
      if (edge === 'in') end = Math.max(duration, start + 1);
      else start = 0;
    }
    draft.range = end > start ? { start, end } : null;
  });
}

export function clearRange(): void {
  editor.update((draft) => {
    draft.range = null;
  });
}

export function detachAudioFromClip(clipId: string): void {
  let created: string | null = null;
  editor.update((draft) => {
    created = detachAudio(draft as ProjectDoc, clipId, getAssetLookup());
  });
  if (created) editor.select([created]);
}

/** Applies a transition to the cut before a clip. Returns false when the clip has no neighbour. */
export function applyTransition(
  clipId: string,
  type: TransitionType,
  duration = DEFAULT_TRANSITION_DURATION,
): boolean {
  let ok = false;
  editor.update((draft) => {
    ok = setTransition(draft as ProjectDoc, clipId, { type, duration });
  });
  if (ok) editor.selectTransition(clipId);
  return ok;
}

export function applyFilterPresetToSelection(preset: FilterPreset): void {
  const { selection } = state();
  editor.update(
    (draft) => {
      for (const id of selection) {
        const loc = findClip(draft as ProjectDoc, id);
        if (
          loc &&
          isVisualClip(loc.clip) &&
          loc.clip.type !== 'text' &&
          loc.clip.type !== 'shape'
        ) {
          (loc.clip as Draft<typeof loc.clip>).filters = applyFilterPreset(preset);
        }
      }
    },
    { history: `filter-preset` },
  );
}

export function addTrackOfKind(kind: TrackKind): void {
  editor.update((draft) => {
    addTrack(draft as ProjectDoc, kind);
  });
}

export function deleteTrack(trackId: string): void {
  editor.update((draft) => {
    removeTrack(draft as ProjectDoc, trackId);
  });
}

export function moveTrackBy(trackId: string, delta: number): void {
  editor.update((draft) => {
    const index = draft.tracks.findIndex((t) => t.id === trackId);
    if (index >= 0) moveTrack(draft as ProjectDoc, trackId, index + delta);
  });
}

export function goToEdge(direction: -1 | 1): void {
  const { doc, currentTime } = state();
  const points = new Set<number>([0, getProjectDuration(doc)]);
  for (const clip of getAllClips(doc)) {
    points.add(clip.start);
    points.add(clipEnd(clip));
  }
  for (const marker of doc.markers) points.add(marker.time);
  const sorted = [...points].sort((a, b) => a - b);
  const target =
    direction > 0
      ? sorted.find((t) => t > currentTime + 1e-3)
      : [...sorted].reverse().find((t) => t < currentTime - 1e-3);
  if (target !== undefined) editor.seek(target);
}

export async function exportCurrentFrame(): Promise<void> {
  const { projectId, projectName, currentTime } = state();
  try {
    const blob = await api.exportStill(projectId, currentTime);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName || 'frame'} @ ${currentTime.toFixed(2)}s.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    toast.error(errorMessage(err));
  }
}

let uploadSeq = 0;

/** Uploads files to the project's media library; optionally adds them to the timeline when ready. */
export function uploadFiles(
  files: Iterable<File>,
  place?: { time: number; trackId?: TrackTarget },
): void {
  const { projectId } = state();
  let offset = 0;
  for (const file of files) {
    const id = `upload-${++uploadSeq}`;
    const handle = uploadAsset(projectId, file, (progress) => {
      useEditor.setState({
        uploads: state().uploads.map((u) => (u.id === id ? { ...u, progress } : u)),
      });
    });
    useEditor.setState({
      uploads: [
        ...state().uploads,
        { id, name: file.name, progress: 0, error: null, abort: handle.abort },
      ],
    });
    const placeAt = place ? place.time + offset : null;
    offset += 1;
    handle.promise
      .then((asset) => {
        upsertAsset(asset);
        if (placeAt !== null)
          pendingPlacements.set(asset.id, { time: placeAt, trackId: place?.trackId });
        useEditor.setState({ uploads: state().uploads.filter((u) => u.id !== id) });
      })
      .catch((err: unknown) => {
        useEditor.setState({ uploads: state().uploads.filter((u) => u.id !== id) });
        if ((err as { code?: string }).code !== 'aborted')
          toast.error(`${file.name}: ${errorMessage(err)}`);
      });
  }
}

/** Assets dropped on the timeline before processing finished; placed once they are ready. */
const pendingPlacements = new Map<string, { time: number; trackId?: TrackTarget }>();

export function upsertAsset(asset: AssetDTO): void {
  const assets = state().assets;
  const index = assets.findIndex((a) => a.id === asset.id);
  const next = index >= 0 ? assets.map((a) => (a.id === asset.id ? asset : a)) : [...assets, asset];
  useEditor.setState({ assets: next });
  const placement = pendingPlacements.get(asset.id);
  if (placement && asset.status === 'ready') {
    pendingPlacements.delete(asset.id);
    addAssetToTimeline(asset, placement);
  } else if (placement && asset.status === 'error') {
    pendingPlacements.delete(asset.id);
  }
}
