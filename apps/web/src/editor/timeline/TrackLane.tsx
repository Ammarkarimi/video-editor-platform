import {
  clipEnd,
  getAdjacentPrev,
  getTrackTransitions,
  isVisualClip,
  transitionLabel,
  type AssetDTO,
  type Clip,
  type Track,
} from '@vep/core';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { memo, useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import { applyTransition } from '../actions';
import { editor } from '../store/editorStore';
import { ClipView } from './ClipView';
import type { ClipWindow } from './ClipMedia';
import { TRACK_HEIGHT } from './constants';
import { handleDragLeave, handleDragOver, handleDrop } from './drop';
import { startMarquee } from './interactions';
import { useTimelineView } from './viewStore';

const WINDOW_QUANTUM = 512;

/** Visible pixel window of a clip, quantized so scrolling does not re-render every clip. */
function clipWindow(clip: Clip, zoom: number, viewLeft: number, viewRight: number): ClipWindow {
  const left = clip.start * zoom;
  const width = Math.max(3, clip.duration * zoom);
  const from = Math.max(0, Math.floor((viewLeft - left) / WINDOW_QUANTUM) * WINDOW_QUANTUM);
  const to = Math.min(width, Math.ceil((viewRight - left) / WINDOW_QUANTUM) * WINDOW_QUANTUM);
  return { from: Math.min(from, width), to: Math.max(Math.min(from, width) + 1, to) };
}

export interface TrackLaneProps {
  track: Track;
  zoom: number;
  width: number;
  /** Visible content range in pixels (with margin). */
  viewLeft: number;
  viewRight: number;
  selection: string[];
  selectedTransition: string | null;
  assets: AssetDTO[];
  onClipContextMenu: (event: ReactMouseEvent, clip: Clip) => void;
}

export const TrackLane = memo(function TrackLane({
  track,
  zoom,
  width,
  viewLeft,
  viewRight,
  selection,
  selectedTransition,
  assets,
  onClipContextMenu,
}: TrackLaneProps) {
  const height = TRACK_HEIGHT[track.kind];
  const dropHint = useTimelineView((s) => (s.dropHint?.trackId === track.id ? s.dropHint : null));
  const transitions = useMemo(() => getTrackTransitions(track), [track]);
  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  const visibleClips = track.clips.filter(
    (clip) => clipEnd(clip) * zoom >= viewLeft && clip.start * zoom <= viewRight,
  );
  // Cuts between touching visual clips that could take a transition.
  const cuts =
    track.kind === 'video' && !track.locked
      ? track.clips.filter((clip) => {
          if (!isVisualClip(clip) || clip.transitionIn) return false;
          const prev = getAdjacentPrev(track, clip);
          return !!prev && isVisualClip(prev);
        })
      : [];

  return (
    <div
      className={clsx(
        'group/lane relative border-b border-line',
        track.kind === 'audio' ? 'bg-[#10161a]' : 'bg-[#11131b]',
        track.hidden && 'opacity-50',
      )}
      style={{ width, height }}
      data-track-id={track.id}
      onPointerDown={(event) => {
        if (event.button === 0) startMarquee(event);
      }}
      onDragOver={(event) => handleDragOver(event, track.id)}
      onDragLeave={handleDragLeave}
      onDrop={(event) => handleDrop(event, track.id)}
    >
      {visibleClips.map((clip) => (
        <ClipView
          key={clip.id}
          clip={clip}
          track={track}
          asset={'assetId' in clip ? assetMap.get(clip.assetId) : undefined}
          selected={selection.includes(clip.id)}
          zoom={zoom}
          height={height}
          window={clipWindow(clip, zoom, viewLeft, viewRight)}
          onContextMenu={onClipContextMenu}
        />
      ))}

      {transitions.map((t) => (
        <button
          key={t.incoming.id}
          type="button"
          title={`${transitionLabel(t.transition.type)} · ${t.duration.toFixed(2)}s`}
          className={clsx(
            'stripes absolute top-2 z-[6] rounded-md border text-[9px] font-semibold text-white',
            selectedTransition === t.incoming.id
              ? 'border-white bg-accent/80'
              : 'border-white/50 bg-black/45 hover:bg-accent/60',
          )}
          style={{
            left: t.start * zoom,
            width: Math.max(10, t.duration * zoom),
            height: height - 20,
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => editor.selectTransition(t.incoming.id)}
          data-testid="transition-chip"
        >
          {t.duration * zoom > 34 ? '⇄' : ''}
        </button>
      ))}

      {cuts.map((clip) => (
        <button
          key={`cut-${clip.id}`}
          type="button"
          title="Add transition"
          aria-label="Add transition"
          className="absolute top-1/2 z-[6] hidden h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/60 bg-panel-3 text-fg shadow group-hover/lane:flex hover:bg-accent"
          style={{ left: clip.start * zoom }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => applyTransition(clip.id, 'fade')}
        >
          <Plus size={12} />
        </button>
      ))}

      {dropHint && (
        <div
          className={clsx(
            'pointer-events-none absolute top-1 bottom-1 z-[7] rounded-md border-2 border-dashed',
            dropHint.duration === 0
              ? 'w-1 border-accent bg-accent'
              : dropHint.valid
                ? 'border-accent bg-accent/20'
                : 'border-danger bg-danger/10',
          )}
          style={{
            left: dropHint.start * zoom - (dropHint.duration === 0 ? 2 : 0),
            width: dropHint.duration === 0 ? 4 : dropHint.duration * zoom,
          }}
        />
      )}
      {track.locked && (
        <div className="pointer-events-none absolute inset-0 z-[8] bg-[repeating-linear-gradient(-45deg,transparent_0,transparent_6px,#ffffff08_6px,#ffffff08_12px)]" />
      )}
    </div>
  );
});
