import {
  computeExportSize,
  EXPORT_FORMAT_INFO,
  EXPORT_FORMATS,
  formatBytes,
  formatDuration,
  FPS_PRESETS,
  getProjectDuration,
  GIF_MAX_FPS,
  GIF_MAX_RESOLUTION,
  type ExportFormat,
  type ExportQuality,
  type ExportSettings,
  type RenderJobDTO,
} from '@vep/core';
import clsx from 'clsx';
import { CheckCircle2, Download, Film, Music, Play, Trash2, X, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Button, IconButton } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Segmented, Select, TextInput } from '../ui/fields';
import { ProgressBar, Spinner } from '../ui/misc';
import { errorMessage, toast } from '../ui/toast';
import { saveNow } from './hooks/useAutosave';
import { useEditor } from './store/editorStore';

const RESOLUTIONS = [2160, 1440, 1080, 720, 480, 360];

function resolutionLabel(r: number): string {
  return r === 2160 ? '4K' : `${r}p`;
}

export function ExportDialog() {
  const open = useEditor((s) => s.exportOpen);
  const doc = useEditor((s) => s.doc);
  const projectId = useEditor((s) => s.projectId);
  const projectName = useEditor((s) => s.projectName);
  const renders = useEditor((s) => s.renders);
  const { width, height, fps: projectFps } = doc.settings;
  const shortSide = Math.min(width, height);
  const defaultResolution = RESOLUTIONS.includes(shortSide)
    ? shortSide
    : (RESOLUTIONS.find((r) => r <= shortSide) ?? 720);

  const [format, setFormat] = useState<ExportFormat>('mp4');
  const [resolution, setResolution] = useState(defaultResolution);
  const [fps, setFps] = useState(projectFps);
  const [quality, setQuality] = useState<ExportQuality>('high');
  const [useRange, setUseRange] = useState(false);
  const [fileName, setFileName] = useState(projectName);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFileName(projectName);
    setUseRange(doc.range !== null);
    setFps(projectFps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const info = EXPORT_FORMAT_INFO[format];
  const isGif = format === 'gif';
  const effectiveResolution = isGif ? Math.min(resolution, GIF_MAX_RESOLUTION) : resolution;
  const effectiveFps = isGif ? Math.min(fps, GIF_MAX_FPS) : fps;
  const size = computeExportSize(width, height, effectiveResolution);
  const duration = getProjectDuration(doc);
  const rangeDuration =
    useRange && doc.range ? Math.min(doc.range.end, duration) - doc.range.start : duration;

  const close = () => useEditor.setState({ exportOpen: false });

  const start = async () => {
    setSubmitting(true);
    try {
      await saveNow(); // export what the user sees
      const settings: ExportSettings = {
        format,
        resolution: effectiveResolution,
        fps: effectiveFps,
        quality,
        range: useRange && doc.range ? { start: doc.range.start, end: doc.range.end } : null,
        fileName: fileName.trim() || projectName,
      };
      const job = await api.createRender(projectId, settings);
      const current = useEditor.getState().renders;
      if (!current.some((r) => r.id === job.id)) useEditor.setState({ renders: [job, ...current] });
      toast.info('Export started. You can keep editing while it renders.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Export"
      description="Exports render on the server with the same engine as the preview."
      width="max-w-4xl"
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {EXPORT_FORMATS.map((f) => {
              const fi = EXPORT_FORMAT_INFO[f];
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  aria-pressed={format === f}
                  className={clsx(
                    'flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors',
                    format === f
                      ? 'border-accent bg-accent-soft'
                      : 'border-line bg-panel-2 hover:border-line-2',
                  )}
                >
                  {fi.hasVideo ? (
                    <Film size={15} className="text-muted" />
                  ) : (
                    <Music size={15} className="text-muted" />
                  )}
                  <span className="text-[13px] font-semibold">{fi.label}</span>
                  <span className="text-[10.5px] leading-snug text-muted">{fi.description}</span>
                </button>
              );
            })}
          </div>
          {info.hasVideo && (
            <Field label="Resolution">
              <Select
                aria-label="Resolution"
                value={String(resolution)}
                onChange={(event) => setResolution(Number(event.target.value))}
              >
                {RESOLUTIONS.filter((r) => !isGif || r <= GIF_MAX_RESOLUTION).map((r) => {
                  const s = computeExportSize(width, height, r);
                  return (
                    <option key={r} value={r}>
                      {resolutionLabel(r)} — {s.width}×{s.height}
                      {r > shortSide ? ' (upscaled)' : ''}
                    </option>
                  );
                })}
              </Select>
            </Field>
          )}
          {info.hasVideo && (
            <Field label="Frame rate">
              <Select
                aria-label="Frame rate"
                value={String(fps)}
                onChange={(event) => setFps(Number(event.target.value))}
              >
                {[...new Set([...FPS_PRESETS, projectFps, 10, 15])]
                  .filter((f) => !isGif || f <= GIF_MAX_FPS)
                  .sort((a, b) => a - b)
                  .map((f) => (
                    <option key={f} value={f}>
                      {f} fps{f === projectFps ? ' (project)' : ''}
                    </option>
                  ))}
              </Select>
            </Field>
          )}
          <Field label="Quality">
            <Segmented<ExportQuality>
              value={quality}
              onChange={setQuality}
              options={[
                { value: 'low', label: 'Smaller' },
                { value: 'medium', label: 'Balanced' },
                { value: 'high', label: 'Best' },
              ]}
            />
          </Field>
          <Field label="Range">
            <Segmented<'all' | 'range'>
              value={useRange && doc.range ? 'range' : 'all'}
              onChange={(v) => setUseRange(v === 'range')}
              options={[
                { value: 'all', label: 'Entire timeline' },
                {
                  value: 'range',
                  label: doc.range ? 'In → out' : 'No in/out set',
                  title: 'Set with I and O',
                },
              ]}
            />
          </Field>
          <Field label="File name">
            <TextInput
              value={fileName}
              maxLength={120}
              onChange={(event) => setFileName(event.target.value)}
            />
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-xs text-muted">
            <span>
              {formatDuration(Math.max(0, rangeDuration))}
              {info.hasVideo && ` · ${size.width}×${size.height} · ${effectiveFps} fps`}
            </span>
            <Button
              variant="primary"
              disabled={submitting || duration <= 0 || (useRange && !doc.range)}
              onClick={() => void start()}
              icon={submitting ? <Spinner size={13} /> : <Download size={14} />}
              data-testid="start-export"
            >
              Export {info.extension.toUpperCase()}
            </Button>
          </div>
          {duration <= 0 && (
            <p className="text-xs text-amber-400">The timeline is empty — add some clips first.</p>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-dim uppercase">
            Exports
          </h3>
          {renders.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-2 px-4 py-8 text-center text-xs text-dim">
              Your exports will appear here.
            </p>
          ) : (
            <div className="max-h-[440px] space-y-2 overflow-y-auto pr-1">
              {renders.map((render) => (
                <RenderItem key={render.id} render={render} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function RenderItem({ render }: { render: RenderJobDTO }) {
  const [previewing, setPreviewing] = useState(false);
  const info = EXPORT_FORMAT_INFO[render.settings.format];
  const active =
    render.status === 'queued' || render.status === 'rendering' || render.status === 'finalizing';
  const statusText = {
    queued: 'Waiting in queue…',
    rendering: `Rendering ${Math.round(render.progress * 100)}%${render.eta !== null ? ` · ~${formatDuration(render.eta)} left` : ''}`,
    finalizing: 'Finalizing…',
    completed: `${render.outputSize ? formatBytes(render.outputSize) : ''}${render.outputDuration ? ` · ${formatDuration(render.outputDuration)}` : ''}`,
    failed: render.error ?? 'Failed',
    cancelled: 'Cancelled',
  }[render.status];

  return (
    <div
      className="rounded-lg border border-line bg-panel-2 p-2.5"
      data-testid="render-item"
      data-status={render.status}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5">
          {render.status === 'completed' ? (
            <CheckCircle2 size={15} className="text-success" />
          ) : render.status === 'failed' ? (
            <XCircle size={15} className="text-danger" />
          ) : active ? (
            <Spinner size={14} className="text-accent" />
          ) : (
            <X size={15} className="text-dim" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{render.fileName}</p>
          <p
            className={clsx(
              'mt-0.5 text-[11px]',
              render.status === 'failed' ? 'text-red-300' : 'text-muted',
            )}
          >
            <span className="mr-1 rounded bg-panel-3 px-1 py-px text-[10px] text-fg uppercase">
              {info.extension}
            </span>
            {statusText}
          </p>
        </div>
        <div className="flex items-center">
          {render.status === 'completed' && render.downloadUrl && info.hasVideo && (
            <IconButton
              label="Preview"
              active={previewing}
              onClick={() => setPreviewing((p) => !p)}
            >
              <Play size={14} />
            </IconButton>
          )}
          {render.status === 'completed' && render.downloadUrl && (
            <a
              href={render.downloadUrl}
              download={render.fileName}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-panel-3 hover:text-fg"
              title="Download"
              aria-label="Download"
              data-testid="download-render"
            >
              <Download size={14} />
            </a>
          )}
          {active ? (
            <IconButton
              label="Cancel export"
              onClick={() =>
                void api.cancelRender(render.id).catch((e) => toast.error(errorMessage(e)))
              }
            >
              <X size={14} />
            </IconButton>
          ) : (
            <IconButton
              label="Delete export"
              onClick={() =>
                void api
                  .deleteRender(render.id)
                  .then(() =>
                    useEditor.setState({
                      renders: useEditor.getState().renders.filter((r) => r.id !== render.id),
                    }),
                  )
                  .catch((e) => toast.error(errorMessage(e)))
              }
            >
              <Trash2 size={13} />
            </IconButton>
          )}
        </div>
      </div>
      {active && (
        <ProgressBar className="mt-2" value={render.status === 'queued' ? 0 : render.progress} />
      )}
      {previewing && render.downloadUrl && (
        <div className="mt-2 overflow-hidden rounded-md bg-black">
          {render.settings.format === 'gif' ? (
            <img
              src={`${render.downloadUrl}?inline=1`}
              alt={render.fileName}
              className="max-h-60 w-full object-contain"
            />
          ) : (
            <video
              src={`${render.downloadUrl}?inline=1`}
              controls
              autoPlay
              className="max-h-60 w-full"
            />
          )}
        </div>
      )}
    </div>
  );
}
