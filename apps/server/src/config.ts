import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  fontsDir: string;
  /** Built web app to serve (null disables static hosting). */
  publicDir: string | null;
  ffmpegPath: string;
  ffprobePath: string;
  maxUploadBytes: number;
  /** Media processing jobs (probe, thumbnails, proxies) that may run at once. */
  mediaConcurrency: number;
  /** Render jobs that may run at once. */
  renderConcurrency: number;
  /** Parallel worker processes used by a single render job. */
  renderWorkers: number;
  corsOrigin: string | null;
  logLevel: string;
  /** Codec of browser preview proxies: H.264/AAC MP4 (default) or VP9/Opus WebM. */
  proxyCodec: 'h264' | 'vp9';
  /** Always preview video/audio through proxies (e.g. for browsers without H.264 support). */
  alwaysProxy: boolean;
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** Walks up from this file looking for a relative path (works from src/ and from dist/). */
function findUp(relative: string): string | null {
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function intEnv(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min) throw new Error(`Invalid ${name}: ${raw}`);
  return value;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const cpus = Math.max(1, os.availableParallelism?.() ?? os.cpus().length);
  const publicDir = process.env.PUBLIC_DIR ?? findUp('apps/web/dist') ?? findUp('web/dist');
  const fontsDir = process.env.FONTS_DIR ?? findUp('assets/fonts');
  if (!fontsDir) throw new Error('Could not locate the fonts directory; set FONTS_DIR');
  return {
    host: process.env.HOST ?? '127.0.0.1',
    port: intEnv('PORT', 3001),
    dataDir: path.resolve(process.env.DATA_DIR ?? 'data'),
    fontsDir: path.resolve(fontsDir),
    publicDir:
      publicDir && existsSync(path.join(publicDir, 'index.html')) ? path.resolve(publicDir) : null,
    ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
    maxUploadBytes: intEnv('MAX_UPLOAD_MB', 4096, 1) * 1024 * 1024,
    mediaConcurrency: intEnv('MEDIA_CONCURRENCY', 2, 1),
    renderConcurrency: intEnv('RENDER_CONCURRENCY', 1, 1),
    renderWorkers: intEnv('RENDER_WORKERS', Math.max(1, Math.min(4, Math.floor(cpus / 2))), 1),
    corsOrigin: process.env.CORS_ORIGIN ?? null,
    logLevel: process.env.LOG_LEVEL ?? 'info',
    proxyCodec: process.env.PROXY_CODEC === 'vp9' ? 'vp9' : 'h264',
    alwaysProxy: ['1', 'true', 'yes'].includes((process.env.PROXY_ALWAYS ?? '').toLowerCase()),
    ...overrides,
  };
}
