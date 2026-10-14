import type { AssetKind, AssetMetadata } from '@vep/core';
import { runProcess } from './run.js';

interface ProbeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  sample_aspect_ratio?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
  nb_frames?: string;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
  side_data_list?: Array<{ side_data_type?: string; rotation?: number }>;
}

interface ProbeFormat {
  format_name?: string;
  duration?: string;
  bit_rate?: string;
}

export interface ProbeResult {
  streams: ProbeStream[];
  format: ProbeFormat;
}

export interface MediaAnalysis {
  kind: AssetKind;
  metadata: AssetMetadata;
  /** Pixel format of the video stream (used to decide whether browsers can play it). */
  pixelFormat: string | null;
  frameCount: number | null;
}

export class UnsupportedMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedMediaError';
  }
}

export async function ffprobe(ffprobePath: string, file: string): Promise<ProbeResult> {
  const out = await runProcess(
    ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { captureStdout: true },
  );
  return JSON.parse(out.toString('utf8')) as ProbeResult;
}

function parseRate(rate: string | undefined): number {
  if (!rate) return 0;
  const [num, den] = rate.split('/').map(Number);
  if (!num || !den) return 0;
  return num / den;
}

function parseNumber(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function rotationOf(stream: ProbeStream): number {
  const side = stream.side_data_list?.find((s) => typeof s.rotation === 'number');
  if (side?.rotation !== undefined) return side.rotation;
  const tag = stream.tags?.rotate;
  return tag ? Number.parseInt(tag, 10) || 0 : 0;
}

const IMAGE_CODECS = new Set([
  'png',
  'mjpeg',
  'jpeg2000',
  'webp',
  'bmp',
  'tiff',
  'gif',
  'jpegls',
  'qoi',
  'avif',
]);
const IMAGE_FORMATS =
  /(^|,)(image2|png_pipe|jpeg_pipe|webp_pipe|bmp_pipe|tiff_pipe|gif|qoi_pipe|jpegls_pipe)(,|$)/;

/** Turns raw ffprobe output into the asset kind and display metadata. */
export function analyzeProbe(probe: ProbeResult): MediaAnalysis {
  const video = probe.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = probe.streams.find((s) => s.codec_type === 'audio');
  const formatName = probe.format.format_name ?? '';

  let duration =
    parseNumber(probe.format.duration) ??
    parseNumber(video?.duration) ??
    parseNumber(audio?.duration) ??
    0;
  const frameCount = parseNumber(video?.nb_frames);
  const isStillFormat =
    IMAGE_FORMATS.test(formatName) ||
    (video?.codec_name ? IMAGE_CODECS.has(video.codec_name) : false);

  let kind: AssetKind;
  if (video && isStillFormat && !audio) {
    // Animated GIF/WebP are treated as (silent) video clips.
    const animated =
      (frameCount !== null && frameCount > 1) || (formatName.includes('gif') && duration > 0.1);
    kind = animated ? 'video' : 'image';
  } else if (video && duration > 0) {
    kind = 'video';
  } else if (audio) {
    kind = 'audio';
  } else if (video) {
    kind = 'image';
  } else {
    throw new UnsupportedMediaError('The file does not contain audio, video or an image.');
  }
  if (kind === 'image') duration = 0;
  if ((kind === 'video' || kind === 'audio') && duration <= 0) {
    throw new UnsupportedMediaError('Could not determine the media duration.');
  }

  let width = video?.width ?? 0;
  let height = video?.height ?? 0;
  const sar = video?.sample_aspect_ratio;
  if (sar && sar !== '1:1' && sar !== '0:1') {
    const [n, d] = sar.split(':').map(Number);
    if (n && d) width = Math.round((width * n) / d);
  }
  if (video && Math.abs(rotationOf(video)) % 180 === 90) [width, height] = [height, width];

  const fps = video ? parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) : 0;

  return {
    kind,
    pixelFormat: video?.pix_fmt ?? null,
    frameCount,
    metadata: {
      duration,
      width: kind === 'audio' ? 0 : width,
      height: kind === 'audio' ? 0 : height,
      fps: kind === 'video' ? Math.round(fps * 1000) / 1000 : 0,
      hasVideo: kind !== 'audio',
      hasAudio: !!audio && kind !== 'image',
      videoCodec: kind === 'audio' ? null : (video?.codec_name ?? null),
      audioCodec: audio?.codec_name ?? null,
      sampleRate: parseNumber(audio?.sample_rate),
      channels: audio?.channels ?? null,
      bitrate: parseNumber(probe.format.bit_rate),
      container: formatName || null,
    },
  };
}

const BROWSER_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
const BROWSER_PIXEL_FORMATS = new Set(['yuv420p', 'yuvj420p']);
const BROWSER_AUDIO_CODECS = new Set([
  'aac',
  'mp3',
  'opus',
  'vorbis',
  'flac',
  'pcm_s16le',
  'pcm_s24le',
  'pcm_f32le',
  'pcm_u8',
]);
const BROWSER_CONTAINERS = /(mov|mp4|m4a|webm|matroska|ogg|mp3|wav|flac|aac)/;
const BROWSER_IMAGE_CODECS = new Set(['png', 'mjpeg', 'webp', 'gif', 'bmp']);

/** Whether the original file can be played/displayed directly by mainstream browsers. */
export function isBrowserFriendly(analysis: MediaAnalysis): boolean {
  const m = analysis.metadata;
  const container = m.container ?? '';
  if (analysis.kind === 'image') return !!m.videoCodec && BROWSER_IMAGE_CODECS.has(m.videoCodec);
  if (!BROWSER_CONTAINERS.test(container)) return false;
  if (m.audioCodec && !BROWSER_AUDIO_CODECS.has(m.audioCodec)) return false;
  if (analysis.kind === 'audio') return true;
  if (!m.videoCodec || !BROWSER_VIDEO_CODECS.has(m.videoCodec)) return false;
  if (analysis.pixelFormat && !BROWSER_PIXEL_FORMATS.has(analysis.pixelFormat)) return false;
  // Matroska is only reliably playable in Chromium when it carries WebM codecs.
  if (container.includes('matroska') && !container.includes('webm')) return false;
  return true;
}
