import { z } from 'zod';
import type { FontFamilyInfo } from './fonts.js';
import type { ProjectDoc } from './model/schema.js';
import { evenRound } from './util/math.js';

/** Types shared between the HTTP API and the web client. */

export type AssetKind = 'video' | 'audio' | 'image';
export type AssetStatus = 'processing' | 'ready' | 'error';

export interface AssetMetadata {
  /** Seconds; 0 for still images. */
  duration: number;
  /** Display dimensions (rotation metadata already applied). */
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  sampleRate: number | null;
  channels: number | null;
  bitrate: number | null;
  container: string | null;
}

export interface FilmstripInfo {
  frames: number;
  frameWidth: number;
  frameHeight: number;
  /** Seconds of source media between consecutive frames. */
  interval: number;
}

export interface AssetDTO {
  id: string;
  projectId: string;
  name: string;
  kind: AssetKind;
  mimeType: string;
  size: number;
  status: AssetStatus;
  error: string | null;
  metadata: AssetMetadata | null;
  filmstrip: FilmstripInfo | null;
  hasWaveform: boolean;
  /** Whether a browser-friendly preview proxy exists (otherwise the original is streamed). */
  hasProxy: boolean;
  createdAt: string;
  urls: {
    file: string;
    preview: string;
    thumbnail: string | null;
    filmstrip: string | null;
    waveform: string | null;
  };
}

/** The subset of asset information the renderer and timeline operations need. */
export interface AssetInfo {
  id: string;
  kind: AssetKind;
  name: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

export type AssetLookup = (assetId: string) => AssetInfo | undefined;

export function toAssetInfo(asset: AssetDTO): AssetInfo {
  const m = asset.metadata;
  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    duration: m?.duration ?? 0,
    width: m?.width ?? 0,
    height: m?.height ?? 0,
    hasAudio: m?.hasAudio ?? false,
    hasVideo: m?.hasVideo ?? false,
  };
}

export function createAssetLookup(assets: Iterable<AssetInfo>): AssetLookup {
  const map = new Map<string, AssetInfo>();
  for (const a of assets) map.set(a.id, a);
  return (id) => map.get(id);
}

export interface WaveformData {
  /** Peaks per second of source media. */
  rate: number;
  /** Normalized peak amplitudes, 0..255. */
  peaks: number[];
}

export interface ProjectSummaryDTO {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl: string;
}

export interface ProjectDTO extends ProjectSummaryDTO {
  document: ProjectDoc;
}

export const EXPORT_FORMATS = ['mp4', 'webm', 'gif', 'mp3', 'wav'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_QUALITIES = ['low', 'medium', 'high'] as const;
export type ExportQuality = (typeof EXPORT_QUALITIES)[number];

export const ExportSettingsSchema = z.object({
  format: z.enum(EXPORT_FORMATS),
  /** Target length of the frame's short side in pixels (e.g. 1080 for 1080p). */
  resolution: z.number().int().min(144).max(4320),
  fps: z.number().min(1).max(120),
  quality: z.enum(EXPORT_QUALITIES),
  /** Optional sub-range of the timeline in seconds. */
  range: z
    .object({ start: z.number().min(0), end: z.number().min(0) })
    .refine((r) => r.end > r.start, 'Range end must be after its start')
    .nullable(),
  fileName: z.string().max(200).optional(),
});
export type ExportSettings = z.infer<typeof ExportSettingsSchema>;

export interface ExportFormatInfo {
  format: ExportFormat;
  label: string;
  extension: string;
  mimeType: string;
  hasVideo: boolean;
  hasAudio: boolean;
  description: string;
}

export const EXPORT_FORMAT_INFO: Record<ExportFormat, ExportFormatInfo> = {
  mp4: {
    format: 'mp4',
    label: 'MP4 (H.264)',
    extension: 'mp4',
    mimeType: 'video/mp4',
    hasVideo: true,
    hasAudio: true,
    description: 'Best compatibility for sharing and uploading.',
  },
  webm: {
    format: 'webm',
    label: 'WebM (VP9)',
    extension: 'webm',
    mimeType: 'video/webm',
    hasVideo: true,
    hasAudio: true,
    description: 'Open format, great for the web.',
  },
  gif: {
    format: 'gif',
    label: 'Animated GIF',
    extension: 'gif',
    mimeType: 'image/gif',
    hasVideo: true,
    hasAudio: false,
    description: 'Silent looping animation (limited to 720p).',
  },
  mp3: {
    format: 'mp3',
    label: 'MP3 audio',
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    hasVideo: false,
    hasAudio: true,
    description: 'Audio track only.',
  },
  wav: {
    format: 'wav',
    label: 'WAV audio',
    extension: 'wav',
    mimeType: 'audio/wav',
    hasVideo: false,
    hasAudio: true,
    description: 'Uncompressed audio track only.',
  },
};

export const GIF_MAX_RESOLUTION = 720;
export const GIF_MAX_FPS = 30;

/** Output frame size for a project scaled so its short side equals `resolution` (even dimensions). */
export function computeExportSize(
  projectWidth: number,
  projectHeight: number,
  resolution: number,
): { width: number; height: number } {
  const short = Math.min(projectWidth, projectHeight);
  const factor = resolution / short;
  return { width: evenRound(projectWidth * factor), height: evenRound(projectHeight * factor) };
}

export type RenderStatus =
  'queued' | 'rendering' | 'finalizing' | 'completed' | 'failed' | 'cancelled';

export interface RenderJobDTO {
  id: string;
  projectId: string;
  status: RenderStatus;
  /** 0..1 */
  progress: number;
  settings: ExportSettings;
  fileName: string;
  error: string | null;
  outputSize: number | null;
  /** Seconds of video in the output. */
  outputDuration: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Estimated seconds remaining while rendering. */
  eta: number | null;
  downloadUrl: string | null;
}

export type ServerEvent =
  | { type: 'asset.updated'; asset: AssetDTO }
  | { type: 'asset.deleted'; assetId: string; projectId: string }
  | { type: 'render.updated'; render: RenderJobDTO }
  | { type: 'render.deleted'; renderId: string; projectId: string }
  | { type: 'project.updated'; project: ProjectSummaryDTO };

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: string[];
}

export interface FontsResponse {
  families: FontFamilyInfo[];
  /** URL prefix where font files are served. */
  baseUrl: string;
}

export interface ServerInfo {
  name: string;
  version: string;
  ffmpeg: string | null;
  maxUploadBytes: number;
  renderWorkers: number;
}
