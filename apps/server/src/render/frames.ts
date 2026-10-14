import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { createCanvas, type Canvas, type ImageData as SkImageData } from '@napi-rs/canvas';
import {
  getMediaBaseSize,
  getVideoSourceTime,
  type AssetInfo,
  type FrameImage,
  type ImageClip,
  type VideoClip,
} from '@vep/core';
import { collectTail, FfmpegError, runProcess, summarizeFfmpegError } from '../ffmpeg/run.js';

/** Largest scale a clip reaches (keyframes, loop motion and zoom animations add headroom). */
function maxClipScale(clip: VideoClip | ImageClip): number {
  let max = clip.transform.scale;
  for (const k of clip.keyframes.scale ?? []) max = Math.max(max, k.value);
  const animated = clip.loop || clip.animationIn || clip.animationOut ? 1.6 : 1;
  return Math.min(8, Math.max(0.05, max * animated));
}

/**
 * Pixel size at which to decode a clip's media: enough resolution for the largest size it is
 * drawn at in the output, but never more than the source itself.
 */
export function decodeSize(
  clip: VideoClip | ImageClip,
  asset: AssetInfo,
  project: { width: number; height: number },
  output: { width: number; height: number },
): { width: number; height: number } {
  const base = getMediaBaseSize(clip, asset, project);
  const outputScale = output.width / project.width;
  const croppedSourceW = asset.width * (1 - clip.crop.left - clip.crop.right);
  const needed = (base.width * outputScale * maxClipScale(clip)) / Math.max(1, croppedSourceW);
  const factor = Math.min(1, needed);
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return { width: even(asset.width * factor), height: even(asset.height * factor) };
}

class RgbaFrame {
  readonly canvas: Canvas;
  private readonly imageData: SkImageData;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.canvas = createCanvas(width, height);
    this.imageData = this.canvas.getContext('2d').createImageData(width, height);
  }

  load(pixels: Buffer): void {
    this.imageData.data.set(pixels);
    this.canvas.getContext('2d').putImageData(this.imageData, 0, 0);
  }

  toFrameImage(): FrameImage {
    return { image: this.canvas, width: this.width, height: this.height };
  }
}

/**
 * Streams frames of one video clip from FFmpeg at the export frame rate. The decoder starts at the
 * first timeline time it is needed and is then read strictly forward, one output frame at a time.
 */
export class VideoClipDecoder {
  private readonly process: ChildProcessByStdio<null, Readable, Readable>;
  private readonly stderr: () => string;
  private readonly frame: RgbaFrame;
  private readonly frameBytes: number;
  private readonly sourceStart: number;
  private index = -1;
  private ended = false;
  private exitCode: number | null = null;
  private hasFrame = false;

  constructor(
    ffmpegPath: string,
    file: string,
    private readonly clip: VideoClip,
    private readonly asset: AssetInfo,
    firstTime: number,
    private readonly fps: number,
    size: { width: number; height: number },
  ) {
    this.sourceStart = getVideoSourceTime(clip, firstTime, asset);
    this.frame = new RgbaFrame(size.width, size.height);
    this.frameBytes = size.width * size.height * 4;
    const filters = [
      `setpts=(PTS-STARTPTS)/${clip.speed}`,
      `fps=${fps}`,
      `scale=${size.width}:${size.height}:flags=bicubic`,
      'format=rgba',
    ].join(',');
    this.process = spawn(
      ffmpegPath,
      [
        '-v',
        'error',
        '-nostdin',
        '-ss',
        this.sourceStart.toFixed(6),
        '-i',
        file,
        '-an',
        '-sn',
        '-dn',
        '-vf',
        filters,
        '-f',
        'rawvideo',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.stderr = collectTail(this.process);
    this.process.stdout.pause();
    this.process.stdout.on('end', () => {
      this.ended = true;
    });
    this.process.on('close', (code) => {
      this.exitCode = code;
      this.ended = true;
    });
    this.process.on('error', () => {
      this.ended = true;
    });
  }

  private readChunk(): Promise<Buffer | null> {
    const stream = this.process.stdout;
    return new Promise((resolve) => {
      const attempt = (): boolean => {
        const chunk = stream.read(this.frameBytes) as Buffer | null;
        if (chunk) {
          // At the end of the stream `read` may hand back a partial frame; drop it.
          resolve(chunk.length === this.frameBytes ? chunk : null);
          return true;
        }
        if (this.ended || stream.readableEnded) {
          // Whatever is left is a partial frame (or nothing): treat as end of stream.
          resolve(null);
          return true;
        }
        return false;
      };
      if (attempt()) return;
      const onReadable = () => {
        if (attempt()) cleanup();
      };
      const onEnd = () => {
        cleanup();
        resolve(null);
      };
      const cleanup = () => {
        stream.off('readable', onReadable);
        stream.off('end', onEnd);
        stream.off('close', onEnd);
      };
      stream.on('readable', onReadable);
      stream.once('end', onEnd);
      stream.once('close', onEnd);
    });
  }

  /** Returns the frame to show at timeline time `time` (holding the edge frame past the media). */
  async frameAt(time: number): Promise<FrameImage | null> {
    const sourceTime = getVideoSourceTime(this.clip, time, this.asset);
    const target = Math.max(
      0,
      Math.round(((sourceTime - this.sourceStart) * this.fps) / this.clip.speed),
    );
    while (this.index < target) {
      const chunk = await this.readChunk();
      if (!chunk) break;
      this.index++;
      if (this.index >= target) {
        this.frame.load(chunk);
        this.hasFrame = true;
      }
    }
    if (!this.hasFrame) {
      if (this.ended && this.exitCode !== null && this.exitCode !== 0) {
        throw new FfmpegError(
          `Decoding "${this.asset.name}" failed: ${summarizeFfmpegError(this.stderr())}`,
          this.stderr(),
          this.exitCode,
        );
      }
      return null;
    }
    return this.frame.toFrameImage();
  }

  dispose(): void {
    if (this.exitCode === null) this.process.kill('SIGKILL');
    this.process.stdout.destroy();
  }
}

/** Decodes a still image (any format FFmpeg understands) into a drawable canvas. */
export async function decodeImage(
  ffmpegPath: string,
  file: string,
  size: { width: number; height: number },
): Promise<FrameImage> {
  const raw = await runProcess(
    ffmpegPath,
    [
      '-v',
      'error',
      '-nostdin',
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      `scale=${size.width}:${size.height}:flags=bicubic,format=rgba`,
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { captureStdout: true },
  );
  const expected = size.width * size.height * 4;
  if (raw.length < expected) throw new Error(`Could not decode image ${file}`);
  const frame = new RgbaFrame(size.width, size.height);
  frame.load(raw.subarray(0, expected));
  return frame.toFrameImage();
}

/** Extracts a single video frame at a source time (used for stills and thumbnails). */
export async function decodeVideoFrame(
  ffmpegPath: string,
  file: string,
  sourceTime: number,
  size: { width: number; height: number },
): Promise<FrameImage | null> {
  const raw = await runProcess(
    ffmpegPath,
    [
      '-v',
      'error',
      '-nostdin',
      '-ss',
      sourceTime.toFixed(6),
      '-i',
      file,
      '-frames:v',
      '1',
      '-an',
      '-vf',
      `scale=${size.width}:${size.height}:flags=bicubic,format=rgba`,
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { captureStdout: true },
  );
  const expected = size.width * size.height * 4;
  if (raw.length < expected) return null;
  const frame = new RgbaFrame(size.width, size.height);
  frame.load(raw.subarray(0, expected));
  return frame.toFrameImage();
}
