import {
  formatBytes,
  formatDuration,
  getReferencedAssetIds,
  type AssetDTO,
  type AssetKind,
} from '@vep/core';
import clsx from 'clsx';
import {
  AlertTriangle,
  Film,
  ImageIcon,
  MoreVertical,
  Music,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { ApiError, api } from '../../api/client';
import { Button, IconButton } from '../../ui/Button';
import { Segmented } from '../../ui/fields';
import { useContextMenu } from '../../ui/Menu';
import { EmptyState, ProgressBar, Spinner } from '../../ui/misc';
import { errorMessage, toast } from '../../ui/toast';
import { addAssetToTimeline, uploadFiles } from '../actions';
import { editor, useEditor } from '../store/editorStore';
import { DRAG_MIME, setDragPayload } from '../timeline/constants';
import { PanelHeader } from './LeftPanel';

const ACCEPT = 'video/*,audio/*,image/*,.mkv,.mov,.avi,.flac,.opus,.m4a,.wav,.tif,.tiff';

type Filter = 'all' | AssetKind;

export function MediaPanel() {
  const assets = useEditor((s) => s.assets);
  const uploads = useEditor((s) => s.uploads);
  const doc = useEditor((s) => s.doc);
  const [filter, setFilter] = useState<Filter>('all');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const used = useMemo(() => getReferencedAssetIds(doc), [doc]);
  const visible = assets
    .filter((a) => filter === 'all' || a.kind === filter)
    .slice()
    .reverse();

  const onDrop = (event: ReactDragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) uploadFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div
      className="flex min-h-full flex-col"
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!(event.currentTarget as Node).contains(event.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={onDrop}
    >
      <PanelHeader title="Media">
        <Button
          size="sm"
          variant="primary"
          icon={<Upload size={13} />}
          onClick={() => inputRef.current?.click()}
        >
          Upload
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          data-testid="media-upload-input"
          onChange={(event) => {
            if (event.target.files) uploadFiles(Array.from(event.target.files));
            event.target.value = '';
          }}
        />
      </PanelHeader>

      <div className="space-y-3 p-3">
        {uploads.map((upload) => (
          <div key={upload.id} className="rounded-lg border border-line bg-panel-2 p-2.5">
            <div className="mb-1.5 flex items-center gap-2 text-xs">
              <Spinner size={12} className="text-accent" />
              <span className="flex-1 truncate">{upload.name}</span>
              <span className="text-dim tabular-nums">{Math.round(upload.progress * 100)}%</span>
              <button
                type="button"
                aria-label="Cancel upload"
                className="text-dim hover:text-fg"
                onClick={upload.abort}
              >
                <X size={13} />
              </button>
            </div>
            <ProgressBar value={upload.progress} />
          </div>
        ))}

        {assets.length > 0 && (
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'video', label: 'Video' },
              { value: 'audio', label: 'Audio' },
              { value: 'image', label: 'Images' },
            ]}
          />
        )}

        {assets.length === 0 && uploads.length === 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={clsx(
              'w-full rounded-xl border-2 border-dashed transition-colors',
              dragging ? 'border-accent bg-accent-soft' : 'border-line-2 hover:border-accent/60',
            )}
          >
            <EmptyState icon={<Upload size={20} />} title="Import media">
              Drop video, audio or image files here,
              <br />
              or click to browse.
            </EmptyState>
          </button>
        ) : (
          <div
            className={clsx(
              'grid grid-cols-2 gap-2 rounded-lg',
              dragging && 'outline-2 outline-dashed outline-accent',
            )}
          >
            {visible.map((asset) => (
              <AssetCard key={asset.id} asset={asset} used={used.has(asset.id)} />
            ))}
          </div>
        )}
        {assets.length > 0 && visible.length === 0 && (
          <p className="py-6 text-center text-xs text-dim">No {filter} files yet.</p>
        )}
      </div>
    </div>
  );
}

const KIND_ICON = { video: Film, audio: Music, image: ImageIcon };

function AssetCard({ asset, used }: { asset: AssetDTO; used: boolean }) {
  const [hoverFrame, setHoverFrame] = useState<number | null>(null);
  const menu = useContextMenu();
  const ready = asset.status === 'ready';
  const Icon = KIND_ICON[asset.kind];
  const filmstrip = asset.filmstrip;

  const remove = async () => {
    try {
      await api.deleteAsset(asset.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'asset_in_use') {
        if (
          !window.confirm(
            `"${asset.name}" is used in the timeline. Delete it and remove its clips?`,
          )
        )
          return;
        editor.update((draft) => {
          for (const track of draft.tracks) {
            track.clips = track.clips.filter((c) => !('assetId' in c) || c.assetId !== asset.id);
          }
        });
        try {
          await api.deleteAsset(asset.id, true);
        } catch (inner) {
          toast.error(errorMessage(inner));
          return;
        }
      } else {
        toast.error(errorMessage(err));
        return;
      }
    }
    useEditor.setState({ assets: useEditor.getState().assets.filter((a) => a.id !== asset.id) });
  };

  const rename = async () => {
    const name = window.prompt('Rename media', asset.name);
    if (!name || name === asset.name) return;
    try {
      const updated = await api.renameAsset(asset.id, name);
      useEditor.setState({
        assets: useEditor.getState().assets.map((a) => (a.id === asset.id ? updated : a)),
      });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const openMenu = (event: { clientX: number; clientY: number; preventDefault?: () => void }) =>
    menu.open(event, [
      {
        label: 'Add to timeline',
        icon: <Plus size={14} />,
        disabled: !ready,
        onSelect: () => addAssetToTimeline(asset),
      },
      { label: 'Rename', icon: <Pencil size={14} />, onSelect: () => void rename() },
      'separator',
      { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onSelect: () => void remove() },
    ]);

  const spriteStyle =
    filmstrip && asset.urls.filmstrip && hoverFrame !== null
      ? {
          backgroundImage: `url(${asset.urls.filmstrip})`,
          backgroundSize: `${filmstrip.columns * 100}% ${Math.ceil(filmstrip.frames / filmstrip.columns) * 100}%`,
          backgroundPosition: `${((hoverFrame % filmstrip.columns) / Math.max(1, filmstrip.columns - 1)) * 100}% ${
            (Math.floor(hoverFrame / filmstrip.columns) /
              Math.max(1, Math.ceil(filmstrip.frames / filmstrip.columns) - 1)) *
            100
          }%`,
        }
      : undefined;

  return (
    <div
      className="group relative overflow-hidden rounded-lg border border-line bg-panel-2 transition-colors hover:border-line-2"
      draggable={ready}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: 'asset', assetId: asset.id }));
        event.dataTransfer.effectAllowed = 'copy';
        setDragPayload({ kind: 'asset', assetId: asset.id });
      }}
      onDragEnd={() => setDragPayload(null)}
      onDoubleClick={() => ready && addAssetToTimeline(asset)}
      onContextMenu={openMenu}
      data-testid="asset-card"
      title={`${asset.name}\n${formatBytes(asset.size)}${asset.metadata?.width ? ` · ${asset.metadata.width}×${asset.metadata.height}` : ''}`}
    >
      <div
        className="relative aspect-video bg-black/40"
        onPointerMove={(event) => {
          if (!filmstrip) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const f = Math.min(
            filmstrip.frames - 1,
            Math.floor(((event.clientX - rect.left) / rect.width) * filmstrip.frames),
          );
          setHoverFrame(Math.max(0, f));
        }}
        onPointerLeave={() => setHoverFrame(null)}
      >
        {asset.urls.thumbnail ? (
          <img
            src={asset.urls.thumbnail}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-emerald-300/80">
            <Music size={26} />
          </div>
        )}
        {spriteStyle && <div className="absolute inset-0" style={spriteStyle} />}
        {asset.status === 'processing' && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/55 text-[11px] text-fg">
            <Spinner size={14} /> Processing
          </div>
        )}
        {asset.status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/70 px-2 text-center text-[11px] text-red-300">
            <AlertTriangle size={13} className="shrink-0" /> {asset.error ?? 'Failed'}
          </div>
        )}
        {ready && asset.error && (
          <div
            className="absolute top-1 left-1 rounded bg-black/70 p-0.5 text-amber-300"
            title={asset.error}
          >
            <AlertTriangle size={11} />
          </div>
        )}
        {asset.metadata && asset.kind !== 'image' && (
          <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[10px] text-fg tabular-nums">
            {formatDuration(asset.metadata.duration)}
          </span>
        )}
        {ready && (
          <button
            type="button"
            aria-label={`Add ${asset.name} to timeline`}
            title="Add at playhead"
            onClick={() => addAssetToTimeline(asset)}
            className="absolute top-1 right-1 hidden h-6 w-6 items-center justify-center rounded-md bg-accent text-white shadow group-hover:flex"
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <Icon size={11} className="shrink-0 text-dim" />
        <span className="min-w-0 flex-1 truncate text-[11px]">{asset.name}</span>
        {used && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
            title="Used in the timeline"
          />
        )}
        <IconButton
          size="xs"
          label="More"
          className="-mr-1 opacity-0 group-hover:opacity-100"
          onClick={(event) => openMenu(event)}
        >
          <MoreVertical size={12} />
        </IconButton>
      </div>
      {menu.menu}
    </div>
  );
}
