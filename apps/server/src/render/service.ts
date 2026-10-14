import { fork, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeExportSize,
  createId,
  EXPORT_FORMAT_INFO,
  getAudioSegments,
  getProjectDuration,
  getReferencedAssetIds,
  GIF_MAX_FPS,
  GIF_MAX_RESOLUTION,
  createAssetLookup,
  parseProjectDoc,
  type ExportSettings,
  type RenderJobDTO,
} from '@vep/core';
import type { Config } from '../config.js';
import type { Logger } from '../context.js';
import {
  RenderRepository,
  type AssetRepository,
  type ProjectRecord,
  type RenderRecord,
  type RenderUpdate,
} from '../db/repositories.js';
import type { EventBus } from '../events.js';
import { ffprobe } from '../ffmpeg/probe.js';
import { AbortError, runProcess } from '../ffmpeg/run.js';
import { HttpError } from '../http/errors.js';
import { JobQueue } from '../jobs/queue.js';
import type { Storage } from '../storage.js';
import { resolveRenderAssets } from './assets.js';
import { buildAudioMixArgs } from './audio.js';
import type { ChunkJob } from './chunk.js';
import { audioEncoderArgs, segmentExtension } from './encoding.js';
import type { WorkerMessage, WorkerRequest } from './worker.js';

/** Each worker gets at least this many frames, so short exports don't pay for many processes. */
const MIN_FRAMES_PER_WORKER = 90;
const EMIT_INTERVAL_MS = 250;

class RenderError extends Error {}

interface LiveState {
  startedAt: number;
  progress: number;
  lastEmit: number;
}

function workerEntry(): { entry: string; execArgv: string[] } {
  const here = fileURLToPath(import.meta.url);
  if (here.endsWith('.ts')) {
    return { entry: path.join(path.dirname(here), 'worker.ts'), execArgv: ['--import', 'tsx'] };
  }
  return { entry: path.join(path.dirname(here), 'render-worker.js'), execArgv: [] };
}

export function sanitizeFileName(name: string): string {
  const cleaned = [...name]
    .filter((ch) => ch.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 120) || 'export';
}

/** Normalizes user export settings to what the pipeline supports. */
export function normalizeSettings(settings: ExportSettings): ExportSettings {
  if (settings.format !== 'gif') return settings;
  return {
    ...settings,
    resolution: Math.min(settings.resolution, GIF_MAX_RESOLUTION),
    fps: Math.min(settings.fps, GIF_MAX_FPS),
  };
}

/** Queues and runs exports: parallel canvas render workers + FFmpeg audio mix + final mux. */
export class RenderService {
  private readonly queue: JobQueue;
  private readonly live = new Map<string, LiveState>();

  constructor(
    private readonly config: Config,
    private readonly storage: Storage,
    private readonly assets: AssetRepository,
    private readonly renders: RenderRepository,
    private readonly events: EventBus,
    private readonly log: Logger,
  ) {
    this.queue = new JobQueue(config.renderConcurrency, (id, err) => this.handleFailure(id, err));
  }

  toDTO(record: RenderRecord): RenderJobDTO {
    const live = this.live.get(record.id);
    let eta: number | null = null;
    if (live && record.status === 'rendering' && live.progress > 0.02) {
      const elapsed = (Date.now() - live.startedAt) / 1000;
      eta = Math.max(0, (elapsed * (1 - live.progress)) / live.progress);
    }
    return RenderRepository.toDTO(record, eta);
  }

  outputPath(record: RenderRecord): string {
    return path.join(
      this.storage.renderDir(record.id),
      `output.${EXPORT_FORMAT_INFO[record.settings.format].extension}`,
    );
  }

  private emit(record: RenderRecord | null): void {
    if (record)
      this.events.publish(record.projectId, { type: 'render.updated', render: this.toDTO(record) });
  }

  private update(id: string, patch: RenderUpdate): RenderRecord | null {
    const record = this.renders.update(id, patch);
    this.emit(record);
    return record;
  }

  enqueue(project: ProjectRecord, input: ExportSettings): RenderRecord {
    const settings = normalizeSettings(input);
    const doc = project.document;
    const info = EXPORT_FORMAT_INFO[settings.format];
    if (getProjectDuration(doc) <= 0)
      throw new HttpError(
        422,
        'empty_timeline',
        'Add some clips to the timeline before exporting.',
      );
    const referenced = getReferencedAssetIds(doc);
    const processing = this.assets
      .listByProject(project.id)
      .filter((a) => referenced.has(a.id) && a.status === 'processing');
    if (processing.length > 0) {
      throw new HttpError(
        409,
        'media_processing',
        'Some media is still being processed. Try again in a moment.',
      );
    }

    const id = createId('rnd');
    const dir = this.storage.renderDir(id);
    mkdirSync(dir, { recursive: true });
    // Snapshot the document so later edits don't affect a queued export.
    writeFileSync(
      path.join(dir, 'job.json'),
      JSON.stringify({ document: doc, version: project.version }),
    );
    const fileName = `${sanitizeFileName(settings.fileName || project.name)}.${info.extension}`;
    const record = this.renders.create({ id, projectId: project.id, settings, fileName });
    this.emit(record);
    this.queue.add(id, (signal) => this.run(id, signal));
    return record;
  }

  async cancel(id: string): Promise<void> {
    const record = this.renders.get(id);
    if (!record) return;
    if (
      record.status === 'queued' ||
      record.status === 'rendering' ||
      record.status === 'finalizing'
    ) {
      const wasRunning = this.queue.isRunning(id);
      this.queue.cancel(id);
      if (!wasRunning)
        this.update(id, { status: 'cancelled', finishedAt: new Date().toISOString() });
    }
  }

  /** Called at startup: re-queue waiting exports and fail the ones a restart interrupted. */
  resumePending(): void {
    for (const record of this.renders.listByStatus('rendering', 'finalizing')) {
      this.renders.update(record.id, {
        status: 'failed',
        error: 'The export was interrupted by a server restart.',
        finishedAt: new Date().toISOString(),
      });
    }
    for (const record of this.renders.listByStatus('queued')) {
      this.queue.add(record.id, (signal) => this.run(record.id, signal));
    }
  }

  async shutdown(): Promise<void> {
    this.queue.cancelAll();
    await Promise.race([this.queue.onIdle(), new Promise((r) => setTimeout(r, 5000))]);
  }

  onIdle(): Promise<void> {
    return this.queue.onIdle();
  }

  private handleFailure(id: string, err: unknown): void {
    this.live.delete(id);
    if (err instanceof AbortError) {
      this.update(id, { status: 'cancelled', finishedAt: new Date().toISOString() });
      void rm(path.join(this.storage.renderDir(id), 'work'), { recursive: true, force: true });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (!(err instanceof RenderError)) this.log.error({ err, renderId: id }, 'export failed');
    this.update(id, {
      status: 'failed',
      error: message.slice(0, 1000),
      finishedAt: new Date().toISOString(),
    });
    void rm(path.join(this.storage.renderDir(id), 'work'), { recursive: true, force: true });
  }

  private setProgress(id: string, progress: number): void {
    const live = this.live.get(id);
    if (!live) return;
    live.progress = Math.max(live.progress, Math.min(0.999, progress));
    const now = Date.now();
    if (now - live.lastEmit < EMIT_INTERVAL_MS) return;
    live.lastEmit = now;
    this.update(id, { progress: Math.round(live.progress * 1000) / 1000 });
  }

  private async run(id: string, signal: AbortSignal): Promise<void> {
    const record = this.renders.get(id);
    if (!record || record.status !== 'queued') return;
    const dir = this.storage.renderDir(id);
    const work = path.join(dir, 'work');
    await rm(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });

    const snapshot = JSON.parse(await readFile(path.join(dir, 'job.json'), 'utf8')) as {
      document: unknown;
    };
    const doc = parseProjectDoc(snapshot.document);
    const assets = resolveRenderAssets(record.projectId, doc, this.assets, this.storage);
    const { settings } = record;
    const info = EXPORT_FORMAT_INFO[settings.format];

    const duration = getProjectDuration(doc);
    const start = Math.max(0, Math.min(settings.range?.start ?? 0, duration));
    const end = Math.max(start, Math.min(settings.range?.end ?? duration, duration));
    const fps = settings.fps;
    const totalFrames = Math.round((end - start) * fps);
    if (totalFrames < 1) throw new RenderError('The selected range is empty.');
    const exactDuration = totalFrames / fps;
    const size = computeExportSize(doc.settings.width, doc.settings.height, settings.resolution);

    this.live.set(id, { startedAt: Date.now(), progress: 0, lastEmit: 0 });
    this.update(id, {
      status: 'rendering',
      progress: 0,
      startedAt: new Date().toISOString(),
      error: null,
    });

    // Linked to the job signal, and also aborted when any task fails so siblings stop early.
    const local = new AbortController();
    const forwardAbort = () => local.abort();
    signal.addEventListener('abort', forwardAbort, { once: true });

    let videoFrames = 0;
    let audioSeconds = 0;
    const report = () => {
      const video = info.hasVideo ? videoFrames / totalFrames : 1;
      const audio = info.hasAudio ? Math.min(1, audioSeconds / exactDuration) : 1;
      const progress = info.hasVideo ? 0.93 * video + 0.02 * audio : 0.95 * audio;
      this.setProgress(id, progress);
    };

    const audioFile = path.join(work, 'audio.wav');
    const tasks: Array<Promise<unknown>> = [];
    const segments: string[] = [];

    if (info.hasAudio) {
      const lookup = createAssetLookup(assets.values());
      const inputs = getAudioSegments(doc, lookup).map((segment) => ({
        segment,
        file: assets.get(segment.assetId)!.file,
      }));
      const args = buildAudioMixArgs(inputs, start, start + exactDuration, audioFile);
      tasks.push(
        runProcess(this.config.ffmpegPath, args, {
          signal: local.signal,
          onProgress: (seconds) => {
            audioSeconds = seconds;
            report();
          },
        }),
      );
    }

    if (info.hasVideo) {
      const workers = Math.max(
        1,
        Math.min(this.config.renderWorkers, Math.floor(totalFrames / MIN_FRAMES_PER_WORKER)),
      );
      const perWorker = Math.ceil(totalFrames / workers);
      const progressByWorker = new Array<number>(workers).fill(0);
      const ext = segmentExtension(settings.format);
      for (let i = 0; i < workers; i++) {
        const frameStart = i * perWorker;
        const frameEnd = Math.min(totalFrames, frameStart + perWorker);
        if (frameEnd <= frameStart) break;
        const output = path.join(work, `segment-${String(i).padStart(3, '0')}.${ext}`);
        segments.push(output);
        const job: ChunkJob = {
          doc,
          assets: [...assets.values()],
          width: size.width,
          height: size.height,
          fps,
          rangeStart: start,
          frameStart,
          frameEnd,
          format: settings.format,
          quality: settings.quality,
          output,
          ffmpegPath: this.config.ffmpegPath,
          fontsDir: this.config.fontsDir,
        };
        tasks.push(
          this.runWorker(job, local.signal, (frames) => {
            progressByWorker[i] = frames;
            videoFrames = progressByWorker.reduce((a, b) => a + b, 0);
            report();
          }),
        );
      }
    }

    const profile = process.env.RENDER_PROFILE === '1';
    const phaseStart = performance.now();
    try {
      await Promise.all(tasks);
    } catch (err) {
      // Stop sibling workers and wait for them before reporting the failure.
      local.abort();
      await Promise.allSettled(tasks);
      throw signal.aborted ? new AbortError() : err;
    } finally {
      signal.removeEventListener('abort', forwardAbort);
    }
    if (signal.aborted) throw new AbortError();

    this.update(id, { status: 'finalizing', progress: 0.97 });
    const output = this.outputPath(record);
    const finalizeStart = performance.now();
    await this.finalize(settings, work, segments, audioFile, output, signal);
    if (profile) {
      this.log.info(
        {
          frames: totalFrames,
          renderSeconds: ((finalizeStart - phaseStart) / 1000).toFixed(1),
          finalizeSeconds: ((performance.now() - finalizeStart) / 1000).toFixed(1),
        },
        'render profile',
      );
    }

    const { size: outputSize } = await stat(output);
    let outputDuration = exactDuration;
    try {
      const probe = await ffprobe(this.config.ffprobePath, output);
      const probed = Number.parseFloat(probe.format.duration ?? '');
      if (Number.isFinite(probed)) outputDuration = probed;
    } catch {
      // Keep the planned duration.
    }
    await rm(work, { recursive: true, force: true });
    this.live.delete(id);
    this.update(id, {
      status: 'completed',
      progress: 1,
      outputSize,
      outputDuration,
      finishedAt: new Date().toISOString(),
    });
  }

  private runWorker(
    job: ChunkJob,
    signal: AbortSignal,
    onFrames: (frames: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new AbortError());
        return;
      }
      const { entry, execArgv } = workerEntry();
      const child: ChildProcess = fork(entry, [], {
        execArgv,
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        env: { ...process.env, NODE_OPTIONS: '' },
      });
      let settled = false;
      let workerError: string | null = null;
      let done = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve();
      };
      const onAbort = () => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 3000).unref();
        finish(new AbortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      child.on('message', (message: WorkerMessage) => {
        if (message.type === 'progress') onFrames(message.frames);
        else if (message.type === 'done') done = true;
        else if (message.type === 'error') workerError = message.message;
      });
      child.on('error', (err) => finish(err));
      child.on('exit', (code) => {
        if (done && code === 0) finish();
        else finish(new RenderError(workerError ?? `Render worker exited with code ${code}`));
      });
      const request: WorkerRequest = { type: 'start', job };
      child.send(request);
    });
  }

  private async finalize(
    settings: ExportSettings,
    work: string,
    segments: string[],
    audioFile: string,
    output: string,
    signal: AbortSignal,
  ): Promise<void> {
    const ffmpeg = this.config.ffmpegPath;
    const partial = `${output}.part`;
    // The `.part` suffix hides the extension from FFmpeg, so name the muxer explicitly.
    const formatFlag = ['-f', settings.format];
    let listFile: string | null = null;
    if (segments.length > 0) {
      listFile = path.join(work, 'segments.txt');
      await writeFile(
        listFile,
        segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'),
      );
    }
    const concatInput = listFile ? ['-f', 'concat', '-safe', '0', '-i', listFile] : [];

    switch (settings.format) {
      case 'mp4':
      case 'webm':
        await runProcess(
          ffmpeg,
          [
            '-v',
            'error',
            '-y',
            '-nostdin',
            ...concatInput,
            '-i',
            audioFile,
            '-map',
            '0:v:0',
            '-map',
            '1:a:0',
            '-c:v',
            'copy',
            ...audioEncoderArgs(settings.format, settings.quality),
            ...(settings.format === 'mp4' ? ['-movflags', '+faststart'] : []),
            ...formatFlag,
            partial,
          ],
          { signal },
        );
        break;
      case 'gif':
        await runProcess(
          ffmpeg,
          [
            '-v',
            'error',
            '-y',
            '-nostdin',
            ...concatInput,
            '-filter_complex',
            '[0:v]split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a',
            '-loop',
            '0',
            ...formatFlag,
            partial,
          ],
          { signal },
        );
        break;
      case 'mp3':
        await runProcess(
          ffmpeg,
          [
            '-v',
            'error',
            '-y',
            '-nostdin',
            '-i',
            audioFile,
            ...audioEncoderArgs('mp3', settings.quality),
            ...formatFlag,
            partial,
          ],
          { signal },
        );
        break;
      case 'wav':
        await rename(audioFile, partial);
        break;
    }
    await rename(partial, output);
  }
}
