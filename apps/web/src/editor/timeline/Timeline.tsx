import {
  canHaveTransition,
  findClip,
  getProjectDuration,
  isVisualClip,
  type Clip,
} from '@vep/core';
import {
  ArrowLeftRight,
  Copy,
  CopyPlus,
  Scissors,
  SplitSquareHorizontal,
  Trash2,
  Unlink,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent,
} from 'react';
import { useContextMenu, type MenuEntry } from '../../ui/Menu';
import {
  addTrackOfKind,
  applyTransition,
  copySelection,
  cutSelection,
  deleteSelection,
  detachAudioFromClip,
  duplicateSelection,
  splitAtPlayhead,
} from '../actions';
import { editor, getAssetLookup, useEditor } from '../store/editorStore';
import { HEADER_WIDTH, NEW_TRACK_ZONE, RULER_HEIGHT } from './constants';
import { handleDragLeave, handleDragOver, handleDrop } from './drop';
import { PlayheadLine, Ruler } from './Ruler';
import { TimelineToolbar } from './TimelineToolbar';
import { TrackHeader } from './TrackHeader';
import { TrackLane } from './TrackLane';
import { registerScroller, revealTime, useTimelineView } from './viewStore';

const VIEW_MARGIN = 600;

export function Timeline({ height }: { height: number }) {
  const doc = useEditor((s) => s.doc);
  const zoom = useEditor((s) => s.zoom);
  const selection = useEditor((s) => s.selection);
  const selectedTransition = useEditor((s) => s.selectedTransition);
  const assets = useEditor((s) => s.assets);
  const scrollLeft = useTimelineView((s) => s.scrollLeft);
  const viewportWidth = useTimelineView((s) => s.viewportWidth);
  const snapGuide = useTimelineView((s) => s.snapGuide);
  const marquee = useTimelineView((s) => s.marquee);
  const scrollRef = useRef<HTMLDivElement>(null);
  const menu = useContextMenu();

  const duration = getProjectDuration(doc);
  const lanesViewport = Math.max(100, viewportWidth - HEADER_WIDTH);
  const contentWidth = Math.ceil(Math.max(duration + 30, lanesViewport / zoom + 5) * zoom);
  // Quantize the visible range so lanes re-render only every few hundred pixels of scrolling.
  const viewLeft = Math.max(0, Math.floor((scrollLeft - VIEW_MARGIN) / 300) * 300);
  const viewRight = Math.ceil((scrollLeft + lanesViewport + VIEW_MARGIN) / 300) * 300;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    registerScroller(el);
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        useTimelineView.setState({ scrollLeft: el.scrollLeft, viewportWidth: el.clientWidth }),
      );
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', update);
      observer.disconnect();
      registerScroller(null);
    };
  }, []);

  // Follow the playhead during playback.
  useEffect(
    () =>
      useEditor.subscribe((state, prev) => {
        if (state.playing && state.currentTime !== prev.currentTime)
          revealTime(state.currentTime, state.zoom);
      }),
    [],
  );

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    const pointerX = event.clientX - rect.left - HEADER_WIDTH;
    const timeAtPointer = (el.scrollLeft + pointerX) / zoom;
    const factor = Math.exp(-event.deltaY * 0.0025);
    editor.setZoom(zoom * factor);
    const nextZoom = useEditor.getState().zoom;
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, timeAtPointer * nextZoom - pointerX);
    });
  };

  // Ctrl+wheel must be non-passive to stop the browser from zooming the page.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prevent = (event: globalThis.WheelEvent) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    el.addEventListener('wheel', prevent, { passive: false });
    return () => el.removeEventListener('wheel', prevent);
  }, []);

  const onClipContextMenu = useCallback(
    (event: ReactMouseEvent, clip: Clip) => {
      const state = useEditor.getState();
      const loc = findClip(state.doc, clip.id);
      const lookup = getAssetLookup(state.assets);
      const items: MenuEntry[] = [
        {
          label: 'Split at playhead',
          icon: <Scissors size={14} />,
          shortcut: 'S',
          onSelect: splitAtPlayhead,
        },
        {
          label: 'Duplicate',
          icon: <CopyPlus size={14} />,
          shortcut: 'Ctrl D',
          onSelect: duplicateSelection,
        },
        {
          label: 'Copy',
          icon: <Copy size={14} />,
          shortcut: 'Ctrl C',
          onSelect: () => void copySelection(),
        },
        { label: 'Cut', icon: <Scissors size={14} />, shortcut: 'Ctrl X', onSelect: cutSelection },
      ];
      if ((clip.type === 'video' || clip.type === 'audio') && lookup(clip.assetId)?.hasAudio) {
        items.push('separator', {
          label: clip.muted ? 'Unmute clip' : 'Mute clip',
          icon: clip.muted ? <Volume2 size={14} /> : <VolumeX size={14} />,
          onSelect: () =>
            editor.update((draft) => {
              const l = findClip(draft as typeof state.doc, clip.id);
              if (l && (l.clip.type === 'video' || l.clip.type === 'audio'))
                l.clip.muted = !l.clip.muted;
            }),
        });
      }
      if (clip.type === 'video' && lookup(clip.assetId)?.hasAudio && !clip.muted) {
        items.push({
          label: 'Detach audio',
          icon: <Unlink size={14} />,
          onSelect: () => detachAudioFromClip(clip.id),
        });
      }
      if (loc && isVisualClip(clip) && canHaveTransition(loc.track, clip)) {
        items.push(
          'separator',
          clip.transitionIn
            ? {
                label: 'Remove transition',
                icon: <ArrowLeftRight size={14} />,
                onSelect: () => {
                  editor.selectTransition(clip.id);
                  deleteSelection();
                },
              }
            : {
                label: 'Add cross dissolve',
                icon: <ArrowLeftRight size={14} />,
                onSelect: () => applyTransition(clip.id, 'fade'),
              },
        );
      }
      items.push(
        'separator',
        {
          label: 'Delete',
          icon: <Trash2 size={14} />,
          shortcut: 'Del',
          danger: true,
          onSelect: () => deleteSelection(),
        },
        {
          label: 'Ripple delete',
          icon: <SplitSquareHorizontal size={14} />,
          shortcut: '⇧ Del',
          danger: true,
          onSelect: () => deleteSelection(true),
        },
      );
      menu.open(event, items);
    },
    [menu],
  );

  let rowTop = 0;
  const rows = doc.tracks.map((track) => {
    const top = rowTop;
    rowTop += track.kind === 'video' ? 64 : 52;
    return { track, top };
  });

  return (
    <div className="flex min-h-0 flex-col border-t border-line bg-panel" style={{ height }}>
      <TimelineToolbar />
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto"
        onWheel={onWheel}
        data-testid="timeline-scroller"
      >
        <div className="relative" style={{ width: HEADER_WIDTH + contentWidth, minHeight: '100%' }}>
          <div className="sticky top-0 z-20 flex" style={{ height: RULER_HEIGHT }}>
            <div
              className="sticky left-0 z-30 flex shrink-0 items-center justify-between border-r border-b border-line bg-panel px-2"
              style={{ width: HEADER_WIDTH }}
            >
              <span className="text-[10px] font-semibold tracking-wider text-dim uppercase">
                Tracks
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-panel-3 hover:text-fg"
                  onClick={() => addTrackOfKind('video')}
                  title="Add video track"
                >
                  + Video
                </button>
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-panel-3 hover:text-fg"
                  onClick={() => addTrackOfKind('audio')}
                  title="Add audio track"
                >
                  + Audio
                </button>
              </div>
            </div>
            <Ruler zoom={zoom} width={contentWidth} viewLeft={viewLeft} viewRight={viewRight} />
          </div>

          {rows.map(({ track }, index) => (
            <div key={track.id} className="flex">
              <div className="sticky left-0 z-10 shrink-0" style={{ width: HEADER_WIDTH }}>
                <TrackHeader track={track} index={index} count={doc.tracks.length} />
              </div>
              <TrackLane
                track={track}
                zoom={zoom}
                width={contentWidth}
                viewLeft={viewLeft}
                viewRight={viewRight}
                selection={selection}
                selectedTransition={selectedTransition}
                assets={assets}
                onClipContextMenu={onClipContextMenu}
              />
            </div>
          ))}

          <div className="flex">
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-line bg-panel"
              style={{ width: HEADER_WIDTH }}
            />
            <NewTrackZone width={contentWidth} />
          </div>

          <PlayheadLine zoom={zoom} offset={HEADER_WIDTH} />
          {snapGuide !== null && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-[14] w-px bg-yellow-300/80"
              style={{ left: HEADER_WIDTH + snapGuide * zoom }}
            />
          )}
          {marquee && (
            <div
              className="pointer-events-none absolute z-[16] border border-accent bg-accent/10"
              style={{
                left: HEADER_WIDTH + marquee.x1,
                top: RULER_HEIGHT + marquee.y1,
                width: marquee.x2 - marquee.x1,
                height: marquee.y2 - marquee.y1,
              }}
            />
          )}
        </div>
      </div>
      {menu.menu}
    </div>
  );
}

function NewTrackZone({ width }: { width: number }) {
  const hint = useTimelineView((s) => (s.dropHint?.trackId === 'new' ? s.dropHint : null));
  const zoom = useEditor((s) => s.zoom);
  const empty = useEditor((s) => s.doc.tracks.every((t) => t.clips.length === 0));
  return (
    <div
      className="relative flex items-center"
      style={{ width, height: empty ? NEW_TRACK_ZONE * 2 : NEW_TRACK_ZONE }}
      onDragOver={(event) => handleDragOver(event, 'new')}
      onDragLeave={handleDragLeave}
      onDrop={(event) => handleDrop(event, 'new')}
    >
      <span className="sticky left-3 text-[11px] text-dim">
        {empty
          ? 'Drag media here, or use the + buttons in the media library'
          : 'Drop here to create a new track'}
      </span>
      {hint && (
        <div
          className="pointer-events-none absolute top-1 bottom-1 rounded-md border-2 border-dashed border-accent bg-accent/20"
          style={{ left: hint.start * zoom, width: hint.duration * zoom }}
        />
      )}
    </div>
  );
}
