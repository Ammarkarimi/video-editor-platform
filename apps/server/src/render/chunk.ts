import { spawn } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import {
  createAssetLookup,
  renderFrame,
  type Ctx2D,
  type ExportFormat,
  type ExportQuality,
  type ProjectDoc,
} from '@vep/core';
import { AbortError, collectTail, FfmpegError, summarizeFfmpegError } from '../ffmpeg/run.js';
import { registerFonts } from '../fonts.js';
import { videoEncoderArgs } from './encoding.js';
import { ExportRenderHost, type RenderAsset } from './host.js';

/** Everything a render worker needs to produce one video segment. */
export interface ChunkJob {
  doc: ProjectDoc;
  assets: RenderAsset[];
  width: number;
  height: number;
  fps: number;
  /** Timeline time of frame 0 of the whole export. */
  rangeStart: number;
  /** Frames `[frameStart, frameEnd)` of the export are rendered into this segment. */
  frameStart: number;
  frameEnd: number;
  format: ExportFormat;
  quality: ExportQuality;
  output: string;
  ffmpegPath: string;
  fontsDir: string;
}

/**
 * Renders a range of frames with the shared canvas renderer and pipes raw RGBA into an FFmpeg
 * encoder. `onProgress` receives the number of frames completed so far.
 */
export async function renderChunk(
  job: ChunkJob,
  onProgress: (frames: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  registerFonts(job.fontsDir);
  const { width, height, fps } = job;
  const scene = { doc: job.doc, assets: createAssetLookup(job.assets) };
  const host = new ExportRenderHost(
    job.doc,
    new Map(job.assets.map((a) => [a.id, a])),
    job.ffmpegPath,
    fps,
    {
      width,
      height,
    },
  );
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const encoder = spawn(
    job.ffmpegPath,
    [
      '-v',
      'error',
      '-y',
      '-nostdin',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s',
      `${width}x${height}`,
      '-framerate',
      String(fps),
      '-i',
      'pipe:0',
      ...videoEncoderArgs(job.format, job.quality, fps),
      job.output,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  const stderr = collectTail(encoder);
  let encoderError: Error | null = null;
  const exited = new Promise<number | null>((resolve) => {
    encoder.on('close', (code) => resolve(code));
    encoder.on('error', (err) => {
      encoderError = err;
      resolve(null);
    });
  });
  encoder.stdin.on('error', (err) => {
    encoderError ??= err;
  });

  const abort = () => encoder.kill('SIGKILL');
  signal?.addEventListener('abort', abort, { once: true });

  try {
    for (let frame = job.frameStart; frame < job.frameEnd; frame++) {
      if (signal?.aborted) throw new AbortError();
      if (encoderError) throw encoderError;
      const time = job.rangeStart + frame / fps;
      await host.prepare(time);
      renderFrame(ctx as unknown as Ctx2D, scene, time, host, { width, height });
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const ok = encoder.stdin.write(
        Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      );
      if (!ok) {
        await new Promise<void>((resolve) => {
          const done = () => {
            encoder.stdin.off('drain', done);
            encoder.off('close', done);
            resolve();
          };
          encoder.stdin.on('drain', done);
          encoder.once('close', done);
        });
      }
      onProgress(frame - job.frameStart + 1);
    }
    encoder.stdin.end();
    const code = await exited;
    if (signal?.aborted) throw new AbortError();
    if (encoderError) throw encoderError;
    if (code !== 0)
      throw new FfmpegError(`Encoding failed: ${summarizeFfmpegError(stderr())}`, stderr(), code);
  } finally {
    signal?.removeEventListener('abort', abort);
    host.dispose();
    if (encoder.exitCode === null) encoder.kill('SIGKILL');
  }
}
