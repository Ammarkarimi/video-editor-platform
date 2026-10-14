import {
  addTrack,
  applyMoves,
  clipEnd,
  collectSnapPoints,
  findClip,
  findNearestFreeStart,
  roundToFrame,
  snapSpan,
  snapTime,
  trackAcceptsClipType,
  trimClip,
  validateMoves,
  type ClipMove,
  type ClipType,
  type ProjectDoc,
  type TrackKind,
} from '@vep/core';
import { editor, getAssetLookup, useEditor } from '../store/editorStore';
import { HEADER_WIDTH, RULER_HEIGHT, SNAP_PX, TRACK_HEIGHT } from './constants';
import { getScroller, timeAtClientX, useTimelineView } from './viewStore';

const DRAG_THRESHOLD = 3;

export interface TrackRow {
  id: string;
  kind: TrackKind;
  top: number;
  height: number;
}

/** Vertical layout of track rows, relative to the top of the first row. */
export function trackRows(doc: ProjectDoc): TrackRow[] {
  let top = 0;
  return doc.tracks.map((track) => {
    const row = { id: track.id, kind: track.kind, top, height: TRACK_HEIGHT[track.kind] };
    top += row.height;
    return row;
  });
}

/** Content coordinates (px from the first lane's left edge / first row's top). */
export function contentPoint(clientX: number, clientY: number): { x: number; y: number } {
  const scroller = getScroller();
  if (!scroller) return { x: 0, y: 0 };
  const rect = scroller.getBoundingClientRect();
  return {
    x: clientX - rect.left + scroller.scrollLeft - HEADER_WIDTH,
    y: clientY - rect.top + scroller.scrollTop - RULER_HEIGHT,
  };
}

/** Index of the track row under a viewport y, or 'new' below the last row. */
export function trackIndexAtClientY(doc: ProjectDoc, clientY: number): number | 'new' {
  const { y } = contentPoint(0, clientY);
  const rows = trackRows(doc);
  if (rows.length === 0) return 'new';
  if (y < 0) return 0;
  const index = rows.findIndex((r) => y >= r.top && y < r.top + r.height);
  return index >= 0 ? index : 'new';
}

function snapThreshold(): number {
  return SNAP_PX / useEditor.getState().zoom;
}

function trackKindFor(type: ClipType): TrackKind {
  return type === 'audio' ? 'audio' : 'video';
}

function newTrackIndex(doc: ProjectDoc, kind: TrackKind): number {
  if (kind === 'audio') return doc.tracks.length;
  let lastVideo = -1;
  doc.tracks.forEach((t, i) => {
    if (t.kind === 'video') lastVideo = i;
  });
  return lastVideo + 1;
}

function onWindowDrag(
  onMove: (e: PointerEvent) => void,
  onEnd: (e: PointerEvent | null, cancelled: boolean) => void,
): void {
  const move = (e: PointerEvent) => onMove(e);
  const up = (e: PointerEvent) => {
    cleanup();
    onEnd(e, false);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
      onEnd(null, true);
    }
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    window.removeEventListener('keydown', key, true);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  window.addEventListener('keydown', key, true);
}

/** Starts dragging the selected clips (the clip under the pointer leads snapping and track changes). */
export function startClipMove(event: { clientX: number; clientY: number }, clipId: string): void {
  const state = useEditor.getState();
  const doc = state.doc;
  const ids = state.selection.includes(clipId) ? state.selection : [clipId];
  const items = ids
    .map((id) => findClip(doc, id))
    .filter((l): l is NonNullable<typeof l> => !!l && !l.track.locked)
    .map((l) => ({
      clipId: l.clip.id,
      type: l.clip.type,
      start: l.clip.start,
      duration: l.clip.duration,
      trackIndex: l.trackIndex,
    }));
  const primary = items.find((i) => i.clipId === clipId);
  if (!primary) return;
  const singleTrack = items.every((i) => i.trackIndex === primary.trackIndex);
  const fps = doc.settings.fps;
  const snapPoints = collectSnapPoints(doc, {
    excludeClipIds: new Set(ids),
    playhead: state.currentTime,
  });
  const startX = event.clientX;
  const startY = event.clientY;
  let started = false;

  onWindowDrag(
    (e) => {
      if (!started) {
        if (
          Math.abs(e.clientX - startX) < DRAG_THRESHOLD &&
          Math.abs(e.clientY - startY) < DRAG_THRESHOLD
        )
          return;
        started = true;
        editor.beginTransaction();
      }
      const { zoom, snapping } = useEditor.getState();
      const base = useEditor.getState().txBase ?? doc;
      let dt = (e.clientX - startX) / zoom;
      let guide: number | null = null;
      if (snapping && !e.altKey) {
        const snapped = snapSpan(primary.start + dt, primary.duration, snapPoints, snapThreshold());
        if (snapped.snapped) {
          dt = snapped.time - primary.start;
          guide = snapped.point;
        }
      }
      const minStart = Math.min(...items.map((i) => i.start));
      if (minStart + dt < 0) dt = -minStart;

      const target = trackIndexAtClientY(base, e.clientY);
      const kind = trackKindFor(primary.type);
      if (target === 'new' && items.length === 1) {
        const start = roundToFrame(primary.start + dt, fps);
        editor.updateFromBase((draft) => {
          const track = addTrack(
            draft as ProjectDoc,
            kind,
            newTrackIndex(draft as ProjectDoc, kind),
          );
          applyMoves(draft as ProjectDoc, [{ clipId: primary.clipId, start, trackId: track.id }]);
        });
        useTimelineView.setState({ snapGuide: guide });
        return;
      }

      const delta = typeof target === 'number' && singleTrack ? target - primary.trackIndex : 0;
      const buildMoves = (d: number): ClipMove[] | null => {
        const moves: ClipMove[] = [];
        for (const item of items) {
          const track = base.tracks[item.trackIndex + d];
          if (!track || !trackAcceptsClipType(track.kind, item.type) || track.locked) return null;
          moves.push({
            clipId: item.clipId,
            start: roundToFrame(Math.max(0, item.start + dt), fps),
            trackId: track.id,
          });
        }
        return moves;
      };
      // Fall back to a purely horizontal move when the target track cannot take the clips.
      const moves = buildMoves(delta) ?? buildMoves(0);
      if (!moves) return;

      if (validateMoves(base, moves)) {
        const valid = moves;
        editor.updateFromBase((draft) => {
          applyMoves(draft as ProjectDoc, valid);
        });
      } else if (moves.length === 1) {
        // Slide into the nearest gap of the target track instead of overlapping.
        const move = moves[0]!;
        const track = base.tracks.find((t) => t.id === move.trackId)!;
        const free = findNearestFreeStart(
          track,
          move.start,
          primary.duration,
          new Set([primary.clipId]),
        );
        if (Number.isFinite(free) && Math.abs(free - move.start) < 3) {
          const slid = { ...move, start: roundToFrame(free, fps) };
          if (validateMoves(base, [slid])) {
            editor.updateFromBase((draft) => {
              applyMoves(draft as ProjectDoc, [slid]);
            });
            guide = null;
          }
        }
      }
      useTimelineView.setState({ snapGuide: guide });
    },
    (_e, cancelled) => {
      useTimelineView.setState({ snapGuide: null });
      if (!started) return;
      if (cancelled) editor.cancelTransaction();
      else editor.commitTransaction();
    },
  );
}

/** Starts trimming the start or end edge of a clip. */
export function startTrim(event: { clientX: number }, clipId: string, edge: 'start' | 'end'): void {
  const state = useEditor.getState();
  const loc = findClip(state.doc, clipId);
  if (!loc || loc.track.locked) return;
  const snapPoints = collectSnapPoints(state.doc, {
    excludeClipIds: new Set([clipId]),
    playhead: state.currentTime,
  });
  const fps = state.doc.settings.fps;
  const grabOffset =
    timeAtClientX(event.clientX, state.zoom) -
    (edge === 'start' ? loc.clip.start : clipEnd(loc.clip));
  editor.beginTransaction();

  onWindowDrag(
    (e) => {
      const { zoom, snapping } = useEditor.getState();
      let time = timeAtClientX(e.clientX, zoom) - grabOffset;
      let guide: number | null = null;
      if (snapping && !e.altKey) {
        const snapped = snapTime(time, snapPoints, snapThreshold());
        if (snapped.snapped) {
          time = snapped.time;
          guide = snapped.point;
        }
      }
      time = roundToFrame(time, fps);
      editor.updateFromBase((draft) => {
        trimClip(draft as ProjectDoc, clipId, edge, time, getAssetLookup());
      });
      useTimelineView.setState({ snapGuide: guide });
    },
    (_e, cancelled) => {
      useTimelineView.setState({ snapGuide: null });
      if (cancelled) editor.cancelTransaction();
      else editor.commitTransaction();
    },
  );
}

/** Rubber-band selection on empty lane space; a plain click seeks and clears the selection. */
export function startMarquee(event: { clientX: number; clientY: number; shiftKey: boolean }): void {
  const origin = contentPoint(event.clientX, event.clientY);
  const additive = event.shiftKey;
  const initialSelection = useEditor.getState().selection;
  let started = false;

  onWindowDrag(
    (e) => {
      const p = contentPoint(e.clientX, e.clientY);
      if (!started && Math.hypot(p.x - origin.x, p.y - origin.y) < DRAG_THRESHOLD) return;
      started = true;
      const x1 = Math.min(origin.x, p.x);
      const x2 = Math.max(origin.x, p.x);
      const y1 = Math.min(origin.y, p.y);
      const y2 = Math.max(origin.y, p.y);
      useTimelineView.setState({ marquee: { x1, y1, x2, y2 } });
      const { doc, zoom } = useEditor.getState();
      const rows = trackRows(doc);
      const hits: string[] = [];
      doc.tracks.forEach((track, index) => {
        const row = rows[index]!;
        if (row.top + row.height < y1 || row.top > y2) return;
        for (const clip of track.clips) {
          const left = clip.start * zoom;
          const right = clipEnd(clip) * zoom;
          if (right >= x1 && left <= x2) hits.push(clip.id);
        }
      });
      editor.select(additive ? [...new Set([...initialSelection, ...hits])] : hits);
    },
    (e) => {
      useTimelineView.setState({ marquee: null });
      if (!started && e) {
        if (!additive) editor.clearSelection();
        editor.seek(timeAtClientX(e.clientX, useEditor.getState().zoom));
      }
    },
  );
}

/** Scrubs the playhead from the ruler. */
export function startScrub(event: { clientX: number }): void {
  const seek = (clientX: number) => editor.seek(timeAtClientX(clientX, useEditor.getState().zoom));
  editor.pause();
  seek(event.clientX);
  onWindowDrag(
    (e) => seek(e.clientX),
    () => undefined,
  );
}

/** Drags a marker along the ruler. */
export function startMarkerDrag(event: { clientX: number }, markerId: string): void {
  const startX = event.clientX;
  let started = false;
  onWindowDrag(
    (e) => {
      if (!started && Math.abs(e.clientX - startX) < DRAG_THRESHOLD) return;
      if (!started) {
        started = true;
        editor.beginTransaction();
      }
      const { zoom, doc } = useEditor.getState();
      const time = roundToFrame(timeAtClientX(e.clientX, zoom), doc.settings.fps);
      editor.updateFromBase((draft) => {
        const marker = draft.markers.find((m) => m.id === markerId);
        if (marker) marker.time = time;
        draft.markers.sort((a, b) => a.time - b.time);
      });
    },
    (_e, cancelled) => {
      if (!started) {
        const marker = useEditor.getState().doc.markers.find((m) => m.id === markerId);
        if (marker) editor.seek(marker.time);
        return;
      }
      if (cancelled) editor.cancelTransaction();
      else editor.commitTransaction();
    },
  );
}

/** Drags an edge of the in/out range. */
export function startRangeDrag(event: { clientX: number }, edge: 'start' | 'end'): void {
  editor.beginTransaction();
  void event;
  onWindowDrag(
    (e) => {
      const { zoom, doc } = useEditor.getState();
      const time = roundToFrame(timeAtClientX(e.clientX, zoom), doc.settings.fps);
      editor.updateFromBase((draft) => {
        if (!draft.range) return;
        if (edge === 'start')
          draft.range.start = Math.min(time, draft.range.end - 1 / doc.settings.fps);
        else draft.range.end = Math.max(time, draft.range.start + 1 / doc.settings.fps);
      });
    },
    (_e, cancelled) => {
      if (cancelled) editor.cancelTransaction();
      else editor.commitTransaction();
    },
  );
}
