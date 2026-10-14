import { formatTimecode } from '@vep/core';
import {
  Camera,
  Maximize,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { IconButton } from '../../ui/Button';
import { Spinner } from '../../ui/misc';
import { Slider } from '../../ui/fields';
import { exportCurrentFrame } from '../actions';
import { editor, timelineDuration, useEditor } from '../store/editorStore';

function TimeReadout() {
  const time = useEditor((s) => s.currentTime);
  const fps = useEditor((s) => s.doc.settings.fps);
  const duration = useEditor((s) => timelineDuration(s.doc));
  return (
    <div className="font-mono text-xs tabular-nums" data-testid="time-readout">
      <span className="text-fg">{formatTimecode(time, fps)}</span>
      <span className="text-dim"> / {formatTimecode(duration, fps)}</span>
    </div>
  );
}

export function PlaybackBar({ onToggleFullscreen }: { onToggleFullscreen: () => void }) {
  const playing = useEditor((s) => s.playing);
  const buffering = useEditor((s) => s.buffering);
  const loop = useEditor((s) => s.loopPlayback);
  const volume = useEditor((s) => s.masterVolume);
  const hasRange = useEditor((s) => s.doc.range !== null);

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-t border-line bg-panel px-3">
      <div className="flex w-56 items-center gap-2">
        <TimeReadout />
        {buffering && <Spinner size={13} className="text-muted" />}
      </div>
      <div className="flex flex-1 items-center justify-center gap-0.5">
        <IconButton label="Go to start (Home)" onClick={() => editor.seek(0)}>
          <SkipBack size={15} />
        </IconButton>
        <IconButton label="Previous frame (←)" onClick={() => editor.stepFrames(-1)}>
          <StepBack size={15} />
        </IconButton>
        <button
          type="button"
          aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          data-testid="play-toggle"
          onClick={() => editor.togglePlay()}
          className="mx-1 flex h-8 w-8 items-center justify-center rounded-full bg-fg text-bg transition-transform hover:scale-105"
        >
          {playing ? (
            <Pause size={15} fill="currentColor" />
          ) : (
            <Play size={15} fill="currentColor" className="ml-0.5" />
          )}
        </button>
        <IconButton label="Next frame (→)" onClick={() => editor.stepFrames(1)}>
          <StepForward size={15} />
        </IconButton>
        <IconButton label="Go to end (End)" onClick={() => editor.seek(timelineDuration())}>
          <SkipForward size={15} />
        </IconButton>
        <IconButton
          label={hasRange ? 'Loop in/out range (L)' : 'Loop playback (L)'}
          active={loop}
          onClick={() => useEditor.setState({ loopPlayback: !loop })}
        >
          <Repeat size={15} />
        </IconButton>
      </div>
      <div className="flex w-56 items-center justify-end gap-1">
        <IconButton
          label={volume > 0 ? 'Mute preview' : 'Unmute preview'}
          onClick={() => useEditor.setState({ masterVolume: volume > 0 ? 0 : 1 })}
        >
          {volume > 0 ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </IconButton>
        <Slider
          className="w-20"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          aria-label="Preview volume"
          onChange={(v) => useEditor.setState({ masterVolume: v })}
        />
        <IconButton label="Save current frame as PNG" onClick={() => void exportCurrentFrame()}>
          <Camera size={15} />
        </IconButton>
        <IconButton label="Fullscreen preview" onClick={onToggleFullscreen}>
          <Maximize size={15} />
        </IconButton>
      </div>
    </div>
  );
}
