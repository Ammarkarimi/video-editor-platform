import {
  collectKeyframeTimes,
  isVisualClip,
  type AssetDTO,
  type Clip,
  type Track,
} from '@vep/core';
import clsx from 'clsx';
import { Film, Image as ImageIcon, Music, Shapes, Type, VolumeX } from 'lucide-react';
import {
  memo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { editor, useEditor } from '../store/editorStore';
import { FilmstripCanvas, ImageStrip, WaveformCanvas, type ClipWindow } from './ClipMedia';
import { CLIP_COLORS } from './constants';
import { startClipMove, startTrim } from './interactions';

const ICONS = {
  video: Film,
  image: ImageIcon,
  text: Type,
  shape: Shapes,
  audio: Music,
};

export interface ClipViewProps {
  clip: Clip;
  track: Track;
  asset: AssetDTO | undefined;
  selected: boolean;
  zoom: number;
  height: number;
  window: ClipWindow;
  onContextMenu: (event: ReactMouseEvent, clip: Clip) => void;
}

export const ClipView = memo(function ClipView({
  clip,
  track,
  asset,
  selected,
  zoom,
  height,
  window,
  onContextMenu,
}: ClipViewProps) {
  const left = clip.start * zoom;
  const width = Math.max(3, clip.duration * zoom);
  const colors = CLIP_COLORS[clip.type];
  const Icon = ICONS[clip.type];
  const locked = track.locked;
  const innerHeight = height - 8;
  const muted = (clip.type === 'video' || clip.type === 'audio') && (clip.muted || track.muted);
  const showWaveform =
    asset?.hasWaveform && (clip.type === 'audio' || (clip.type === 'video' && !clip.muted));
  const keyframes = isVisualClip(clip) ? collectKeyframeTimes(clip.keyframes) : [];

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const { selection } = useEditor.getState();
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      editor.select([clip.id], 'toggle');
      return;
    }
    if (!selection.includes(clip.id)) editor.select([clip.id]);
    if (!locked) startClipMove(event, clip.id);
  };

  const onDoubleClick = () => {
    if (clip.type !== 'text' || locked) return;
    const { currentTime } = useEditor.getState();
    if (currentTime < clip.start || currentTime >= clip.start + clip.duration)
      editor.seek(clip.start + 0.01);
    editor.pause();
    useEditor.setState({ editingTextId: clip.id });
  };

  const trimHandle = (edge: 'start' | 'end') => (
    <div
      className={clsx(
        'absolute top-0 bottom-0 z-10 w-2 cursor-ew-resize',
        edge === 'start' ? 'left-0 rounded-l-md' : 'right-0 rounded-r-md',
        selected ? 'bg-white/30 hover:bg-white/60' : 'hover:bg-white/30',
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        if (!useEditor.getState().selection.includes(clip.id)) editor.select([clip.id]);
        startTrim(event, clip.id, edge);
      }}
      title={edge === 'start' ? 'Trim start' : 'Trim end'}
    />
  );

  return (
    <div
      data-clip-id={clip.id}
      data-testid="timeline-clip"
      className={clsx(
        'group absolute top-1 overflow-hidden rounded-md border select-none',
        colors.bg,
        selected ? 'z-[5] border-white shadow-[0_0_0_1px_white]' : colors.border,
        locked ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing',
        muted && 'saturate-50',
      )}
      style={{ left, width, height: innerHeight }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={(event) => {
        if (!useEditor.getState().selection.includes(clip.id)) editor.select([clip.id]);
        onContextMenu(event, clip);
      }}
    >
      {clip.type === 'video' && asset && (
        <FilmstripCanvas
          clip={clip}
          asset={asset}
          zoom={zoom}
          height={showWaveform ? Math.round(innerHeight * 0.62) : innerHeight}
          window={window}
        />
      )}
      {clip.type === 'image' && asset && (
        <ImageStrip asset={asset} width={width} height={innerHeight} />
      )}
      {showWaveform && asset && (clip.type === 'audio' || clip.type === 'video') && (
        <WaveformCanvas
          clip={clip}
          asset={asset}
          zoom={zoom}
          height={clip.type === 'audio' ? innerHeight - 16 : Math.round(innerHeight * 0.38)}
          top={clip.type === 'audio' ? 15 : Math.round(innerHeight * 0.62)}
          window={window}
          color={clip.type === 'audio' ? 'rgba(220,255,240,0.8)' : 'rgba(255,255,255,0.65)'}
        />
      )}
      {clip.type === 'shape' && (
        <div
          className="absolute right-1.5 bottom-1.5 h-4 w-4 rounded border border-white/40"
          style={{
            background: clip.fill.slice(0, 7),
            borderRadius: clip.shape === 'ellipse' ? 999 : 4,
          }}
        />
      )}
      {(clip.type === 'video' || clip.type === 'audio') && clip.fadeIn > 0 && (
        <div
          className="pointer-events-none absolute top-0 bottom-0 left-0 bg-gradient-to-r from-black/60 to-transparent"
          style={{ width: clip.fadeIn * zoom }}
        />
      )}
      {(clip.type === 'video' || clip.type === 'audio') && clip.fadeOut > 0 && (
        <div
          className="pointer-events-none absolute top-0 right-0 bottom-0 bg-gradient-to-l from-black/60 to-transparent"
          style={{ width: clip.fadeOut * zoom }}
        />
      )}
      <div
        className={clsx(
          'pointer-events-none relative flex h-[15px] items-center gap-1 bg-black/25 px-1.5 text-[10.5px] leading-none font-medium',
          colors.text,
        )}
      >
        <Icon size={10} className="shrink-0 opacity-80" />
        <span
          className="truncate"
          style={
            clip.type === 'text'
              ? { fontFamily: `"${clip.style.fontFamily}", sans-serif` }
              : undefined
          }
        >
          {clip.type === 'text' ? clip.text.replace(/\n/g, ' ') || 'Text' : clip.name}
        </span>
        {(clip.type === 'video' || clip.type === 'audio') && clip.speed !== 1 && (
          <span className="shrink-0 rounded bg-black/40 px-1 text-[9px]">{clip.speed}×</span>
        )}
        {muted && <VolumeX size={10} className="shrink-0" />}
      </div>
      {clip.type === 'text' && innerHeight > 30 && (
        <div className="pointer-events-none truncate px-1.5 pt-1 text-[11px] text-white/80">
          {clip.style.fontFamily} · {Math.round(clip.style.fontSize)}px
        </div>
      )}
      {keyframes.map((t) => (
        <span
          key={t}
          className="pointer-events-none absolute bottom-1 h-2 w-2 -translate-x-1/2 rotate-45 border border-black/40 bg-yellow-300"
          style={{ left: t * zoom }}
        />
      ))}
      {!locked && trimHandle('start')}
      {!locked && trimHandle('end')}
    </div>
  );
});
