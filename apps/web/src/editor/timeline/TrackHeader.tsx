import type { Track } from '@vep/core';
import clsx from 'clsx';
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Film,
  Lock,
  MoreHorizontal,
  Music,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { memo, useState } from 'react';
import { IconButton } from '../../ui/Button';
import { useContextMenu } from '../../ui/Menu';
import { deleteTrack, moveTrackBy } from '../actions';
import { editor } from '../store/editorStore';
import { TRACK_HEIGHT } from './constants';

export const TrackHeader = memo(function TrackHeader({
  track,
  index,
  count,
}: {
  track: Track;
  index: number;
  count: number;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(track.name);
  const menu = useContextMenu();
  const Icon = track.kind === 'video' ? Film : Music;

  const patch = (changes: Partial<Pick<Track, 'name' | 'muted' | 'hidden' | 'locked'>>) =>
    editor.update((draft) => {
      const t = draft.tracks.find((x) => x.id === track.id);
      if (t) Object.assign(t, changes);
    });

  const openMenu = (event: { clientX: number; clientY: number; preventDefault?: () => void }) =>
    menu.open(event, [
      {
        label: 'Move up',
        icon: <ArrowUp size={14} />,
        disabled: index === 0,
        onSelect: () => moveTrackBy(track.id, -1),
      },
      {
        label: 'Move down',
        icon: <ArrowDown size={14} />,
        disabled: index === count - 1,
        onSelect: () => moveTrackBy(track.id, 1),
      },
      'separator',
      {
        label:
          track.clips.length > 0 ? `Delete track (${track.clips.length} clips)` : 'Delete track',
        icon: <Trash2 size={14} />,
        danger: true,
        onSelect: () => deleteTrack(track.id),
      },
    ]);

  return (
    <div
      className="group flex items-center gap-1 border-r border-b border-line bg-panel px-2"
      style={{ height: TRACK_HEIGHT[track.kind] }}
      onContextMenu={openMenu}
      data-testid="track-header"
    >
      <Icon
        size={13}
        className={clsx(
          'shrink-0',
          track.kind === 'video' ? 'text-indigo-300' : 'text-emerald-300',
        )}
      />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            className="h-6 w-full rounded border border-accent bg-panel-2 px-1 text-xs outline-none"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              setEditing(false);
              if (name.trim() && name !== track.name) patch({ name: name.trim().slice(0, 100) });
              else setName(track.name);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
              if (event.key === 'Escape') {
                setName(track.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="block w-full truncate text-left text-xs font-medium text-fg"
            onDoubleClick={() => {
              setName(track.name);
              setEditing(true);
            }}
            title="Double-click to rename"
          >
            {track.name}
          </button>
        )}
      </div>
      {track.kind === 'video' && (
        <IconButton
          size="xs"
          label={track.hidden ? 'Show track' : 'Hide track'}
          active={track.hidden}
          onClick={() => patch({ hidden: !track.hidden })}
        >
          {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </IconButton>
      )}
      <IconButton
        size="xs"
        label={track.muted ? 'Unmute track' : 'Mute track'}
        active={track.muted}
        onClick={() => patch({ muted: !track.muted })}
      >
        {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
      </IconButton>
      <IconButton
        size="xs"
        label={track.locked ? 'Unlock track' : 'Lock track'}
        active={track.locked}
        onClick={() => patch({ locked: !track.locked })}
      >
        {track.locked ? <Lock size={13} /> : <Unlock size={13} />}
      </IconButton>
      <IconButton
        size="xs"
        label="Track options"
        onClick={(event) => openMenu(event)}
        className="hidden group-hover:inline-flex"
      >
        <MoreHorizontal size={13} />
      </IconButton>
      {menu.menu}
    </div>
  );
});
