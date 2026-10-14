import { spawn } from 'node:child_process';
import { rename, rm, writeFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import type { FilmstripInfo, WaveformData } from '@vep/core';
import type { Config } from '../config.js';
import type { AssetRecord, AssetRepository, AssetUpdate } from '../db/repositories.js';
import { AssetRepository as AssetRepo } from '../db/repositories.js';
import type { EventBus } from '../events.js';
import {
  analyzeProbe,
  ffprobe,
  isBrowserFriendly,
  UnsupportedMediaError,
  type MediaAnalysis,
} from '../ffmpeg/probe.js';
import {
  AbortError,
  collectTail,
  FfmpegError,
  runProcess,
  summarizeFfmpegError,
} from '../ffmpeg/run.js';
import type { Storage } from '../storage.js';

export const THUMBNAIL_FILE = 'thumb.jpg';
export const FILMSTRIP_FILE = 'filmstrip.jpg';
export const WAVEFORM_FILE = 'waveform.json';

const FILMSTRIP_FRAME_HEIGHT = 90;
const FILMSTRIP_COLUMNS = 10;
const WAVEFORM_SAMPLE_RATE = 8000;
const PROXY_MAX_EDGE = 1280;

interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/**
 * Prepares uploaded media for editing: probes metadata, then generates a thumbnail, a waveform,
 * a filmstrip sprite and (when the original is not browser-friendly or very large) a proxy.
 */
export class MediaProcessor {
  constructor(
    private readonly config: Config,
    private readonly storage: Storage,
    private readonly assets: AssetRepository,
    private readonly events: EventBus,
    private readonly log: Logger,
  ) {}

  private update(id: string, patch: AssetUpdate): AssetRecord | null {
    const record = this.assets.update(id, patch);
    if (record)
      this.events.publish(record.projectId, {
        type: 'asset.updated',
        asset: AssetRepo.toDTO(record),
      });
    return record;
  }

  async process(assetId: string, signal: AbortSignal): Promise<void> {
    const asset = this.assets.get(assetId);
    if (!asset) return;
    const file = this.storage.assetPath(asset.id, asset.fileName);

    let analysis: MediaAnalysis;
    try {
      analysis = analyzeProbe(await ffprobe(this.config.ffprobePath, file));
    } catch (err) {
      const message =
        err instanceof UnsupportedMediaError
          ? err.message
          : 'The file could not be read as audio, video or an image.';
      this.update(asset.id, { status: 'error', error: message });
      return;
    }
    const meta = analysis.metadata;
    // With PROXY_ALWAYS every video/audio file is previewed through a proxy in the configured codec.
    const forceProxy = this.config.alwaysProxy && analysis.kind !== 'image';
    const friendly = isBrowserFriendly(analysis) && !forceProxy;
    const oversized =
      analysis.kind !== 'audio' &&
      Math.max(meta.width, meta.height) > (analysis.kind === 'image' ? 4096 : 1920);
    const needsProxy = !friendly || oversized;

    this.update(asset.id, {
      kind: analysis.kind,
      metadata: meta,
      previewReady: friendly && !oversized,
    });

    const steps: Array<[string, () => Promise<AssetUpdate>]> = [];
    if (analysis.kind !== 'audio')
      steps.push(['thumbnail', () => this.makeThumbnail(asset, analysis, signal)]);
    // The asset is usable on the timeline as soon as it has metadata and a thumbnail.
    steps.push(['ready', async () => ({ status: 'ready' })]);
    if (meta.hasAudio) steps.push(['waveform', () => this.makeWaveform(asset, analysis, signal)]);
    if (analysis.kind === 'video')
      steps.push(['filmstrip', () => this.makeFilmstrip(asset, analysis, signal)]);
    if (needsProxy) steps.push(['proxy', () => this.makeProxy(asset, analysis, signal)]);

    for (const [name, step] of steps) {
      if (signal.aborted) throw new AbortError();
      try {
        this.update(asset.id, await step());
      } catch (err) {
        if (err instanceof AbortError || signal.aborted) throw err;
        this.log.warn({ err, assetId: asset.id, step: name }, 'media processing step failed');
        if (name === 'proxy' && !friendly) {
          this.update(asset.id, { error: 'A browser preview could not be created for this file.' });
        }
      }
    }
  }

  private async makeThumbnail(
    asset: AssetRecord,
    analysis: MediaAnalysis,
    signal: AbortSignal,
  ): Promise<AssetUpdate> {
    const input = this.storage.assetPath(asset.id, asset.fileName);
    const output = this.storage.assetPath(asset.id, THUMBNAIL_FILE);
    const seek = analysis.kind === 'video' ? Math.min(1, analysis.metadata.duration * 0.1) : 0;
    const args = (at: number) => [
      '-v',
      'error',
      '-y',
      ...(at > 0 ? ['-ss', at.toFixed(3)] : []),
      '-i',
      input,
      '-frames:v',
      '1',
      '-vf',
      "scale=w='min(480,iw)':h='min(480,ih)':force_original_aspect_ratio=decrease",
      '-q:v',
      '3',
      output,
    ];
    try {
      await runProcess(this.config.ffmpegPath, args(seek), { signal });
    } catch (err) {
      if (seek === 0 || err instanceof AbortError) throw err;
      await runProcess(this.config.ffmpegPath, args(0), { signal });
    }
    return { hasThumbnail: true };
  }

  private async makeWaveform(
    asset: AssetRecord,
    analysis: MediaAnalysis,
    signal: AbortSignal,
  ): Promise<AssetUpdate> {
    const input = this.storage.assetPath(asset.id, asset.fileName);
    const duration = analysis.metadata.duration;
    const rate = duration <= 1800 ? 100 : Math.max(10, Math.floor(180_000 / duration));
    const window = Math.max(1, Math.round(WAVEFORM_SAMPLE_RATE / rate));
    const peaks: number[] = [];
    let current = 0;
    let count = 0;
    let leftover: Buffer = Buffer.alloc(0);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        this.config.ffmpegPath,
        [
          '-v',
          'error',
          '-i',
          input,
          '-vn',
          '-ac',
          '1',
          '-ar',
          String(WAVEFORM_SAMPLE_RATE),
          '-f',
          'f32le',
          'pipe:1',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const stderr = collectTail(child);
      const onAbort = () => child.kill('SIGKILL');
      signal.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', (chunk: Buffer) => {
        const data = leftover.length > 0 ? Buffer.concat([leftover, chunk]) : chunk;
        const usable = data.length - (data.length % 4);
        for (let offset = 0; offset < usable; offset += 4) {
          const v = Math.abs(data.readFloatLE(offset));
          if (v > current) current = v;
          if (++count === window) {
            peaks.push(Math.min(255, Math.round(current * 255)));
            current = 0;
            count = 0;
          }
        }
        leftover = data.subarray(usable);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) reject(new AbortError());
        else if (code === 0) resolve();
        else reject(new FfmpegError(summarizeFfmpegError(stderr()), stderr(), code));
      });
    });
    if (count > 0) peaks.push(Math.min(255, Math.round(current * 255)));
    const data: WaveformData = { rate: WAVEFORM_SAMPLE_RATE / window, peaks };
    await writeFile(this.storage.assetPath(asset.id, WAVEFORM_FILE), JSON.stringify(data));
    return { hasWaveform: true };
  }

  private async makeFilmstrip(
    asset: AssetRecord,
    analysis: MediaAnalysis,
    signal: AbortSignal,
  ): Promise<AssetUpdate> {
    const input = this.storage.assetPath(asset.id, asset.fileName);
    const { duration, width, height } = analysis.metadata;
    const aspect = width > 0 && height > 0 ? width / height : 16 / 9;
    const frameHeight = FILMSTRIP_FRAME_HEIGHT;
    const frameWidth = Math.max(40, Math.min(240, Math.round((frameHeight * aspect) / 2) * 2));
    const frames = Math.max(1, Math.min(120, Math.ceil(duration)));
    const interval = duration / frames;
    // Long videos only decode keyframes, which is dramatically faster and plenty for thumbnails.
    const keyframesOnly = duration > 120;
    const frameBytes = frameWidth * frameHeight * 4;

    const raw = await runProcess(
      this.config.ffmpegPath,
      [
        '-v',
        'error',
        ...(keyframesOnly ? ['-skip_frame', 'nokey'] : []),
        '-i',
        input,
        '-an',
        '-sn',
        '-vf',
        `fps=${frames}/${duration.toFixed(6)},scale=${frameWidth}:${frameHeight},format=rgba`,
        '-frames:v',
        String(frames),
        '-f',
        'rawvideo',
        'pipe:1',
      ],
      { captureStdout: true, signal },
    );
    const decoded = Math.floor(raw.length / frameBytes);
    if (decoded === 0) throw new Error('No frames decoded for filmstrip');

    const columns = Math.min(FILMSTRIP_COLUMNS, frames);
    const rows = Math.ceil(frames / columns);
    const canvas = createCanvas(columns * frameWidth, rows * frameHeight);
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(frameWidth, frameHeight);
    for (let i = 0; i < frames; i++) {
      // Pad missing trailing frames by repeating the last decoded one.
      const source = Math.min(i, decoded - 1);
      imageData.data.set(raw.subarray(source * frameBytes, (source + 1) * frameBytes));
      ctx.putImageData(
        imageData,
        (i % columns) * frameWidth,
        Math.floor(i / columns) * frameHeight,
      );
    }
    await writeFile(
      this.storage.assetPath(asset.id, FILMSTRIP_FILE),
      await canvas.encode('jpeg', 80),
    );
    const filmstrip: FilmstripInfo = { frames, columns, frameWidth, frameHeight, interval };
    return { filmstrip };
  }

  private async makeProxy(
    asset: AssetRecord,
    analysis: MediaAnalysis,
    signal: AbortSignal,
  ): Promise<AssetUpdate> {
    const input = this.storage.assetPath(asset.id, asset.fileName);
    const vp9 = this.config.proxyCodec === 'vp9';
    let fileName: string;
    let args: string[];
    if (analysis.kind === 'video') {
      fileName = vp9 ? 'proxy.webm' : 'proxy.mp4';
      const scale = `scale=w='min(${PROXY_MAX_EDGE},iw)':h='min(${PROXY_MAX_EDGE},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p`;
      args = ['-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', scale, '-g', '30', '-ac', '2'];
      args.push(
        ...(vp9
          ? [
              '-c:v',
              'libvpx-vp9',
              '-deadline',
              'realtime',
              '-cpu-used',
              '8',
              '-row-mt',
              '1',
              '-b:v',
              '0',
              '-crf',
              '36',
              '-c:a',
              'libopus',
              '-b:a',
              '96k',
            ]
          : [
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '26',
              '-c:a',
              'aac',
              '-b:a',
              '128k',
              '-movflags',
              '+faststart',
            ]),
      );
    } else if (analysis.kind === 'audio') {
      fileName = vp9 ? 'proxy.webm' : 'proxy.m4a';
      args = [
        '-i',
        input,
        '-vn',
        '-ac',
        '2',
        ...(vp9
          ? ['-c:a', 'libopus', '-b:a', '128k']
          : ['-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart']),
      ];
    } else {
      fileName = 'proxy.png';
      args = [
        '-i',
        input,
        '-frames:v',
        '1',
        '-vf',
        "scale=w='min(4096,iw)':h='min(4096,ih)':force_original_aspect_ratio=decrease",
      ];
    }
    const output = this.storage.assetPath(asset.id, fileName);
    const partial = `${output}.part${fileName.slice(fileName.lastIndexOf('.'))}`;
    try {
      await runProcess(this.config.ffmpegPath, ['-v', 'error', '-y', ...args, partial], { signal });
      await rename(partial, output);
    } catch (err) {
      await rm(partial, { force: true });
      throw err;
    }
    return { proxyFile: fileName, previewReady: true };
  }
}
