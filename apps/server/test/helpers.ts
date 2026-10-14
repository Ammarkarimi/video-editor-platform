import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AssetDTO, ProjectDTO } from '@vep/core';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createContext, type AppContext } from '../src/context.js';

export interface TestServer {
  app: FastifyInstance;
  ctx: AppContext;
  dir: string;
  close(): Promise<void>;
}

const quietLog = { info() {}, warn() {}, error() {} };

export async function createTestServer(overrides: Partial<Config> = {}): Promise<TestServer> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vep-test-'));
  const config = loadConfig({ dataDir: dir, publicDir: null, logLevel: 'silent', ...overrides });
  const ctx = await createContext(config, quietLog);
  const app = await buildApp(ctx, { logger: false });
  await app.ready();
  return {
    app,
    ctx,
    dir,
    async close() {
      await app.close();
      await ctx.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

let mediaDir: string | null = null;

/** Generates small deterministic media files with FFmpeg (once per test process). */
export function testMedia(): { video: string; image: string; audio: string; silentVideo: string } {
  if (!mediaDir) {
    mediaDir = mkdtempSync(path.join(os.tmpdir(), 'vep-media-'));
    const run = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
    run([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=25:duration=3',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=3',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      path.join(mediaDir, 'video.mp4'),
    ]);
    run([
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=25:duration=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      path.join(mediaDir, 'silent.mp4'),
    ]);
    run([
      '-f',
      'lavfi',
      '-i',
      'color=c=0x3366ff:s=200x100',
      '-frames:v',
      '1',
      path.join(mediaDir, 'image.png'),
    ]);
    run([
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:duration=2',
      '-ac',
      '2',
      path.join(mediaDir, 'audio.wav'),
    ]);
  }
  return {
    video: path.join(mediaDir, 'video.mp4'),
    silentVideo: path.join(mediaDir, 'silent.mp4'),
    image: path.join(mediaDir, 'image.png'),
    audio: path.join(mediaDir, 'audio.wav'),
  };
}

export function multipart(
  file: string,
  fileName = path.basename(file),
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----vep${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, readFileSync(file), tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

export async function createProject(
  server: TestServer,
  body: Record<string, unknown> = {},
): Promise<ProjectDTO> {
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'Test project', width: 640, height: 360, fps: 25, ...body },
  });
  if (res.statusCode !== 201) throw new Error(`create project failed: ${res.body}`);
  return res.json() as ProjectDTO;
}

export async function uploadAsset(
  server: TestServer,
  projectId: string,
  file: string,
  fileName?: string,
): Promise<AssetDTO> {
  const res = await server.app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/assets`,
    ...multipart(file, fileName),
  });
  if (res.statusCode !== 201) throw new Error(`upload failed (${res.statusCode}): ${res.body}`);
  return res.json() as AssetDTO;
}

/** Uploads a file and waits for media processing to finish. */
export async function uploadReady(
  server: TestServer,
  projectId: string,
  file: string,
): Promise<AssetDTO> {
  const asset = await uploadAsset(server, projectId, file);
  await server.ctx.media.onIdle();
  const res = await server.app.inject({ method: 'GET', url: `/api/assets/${asset.id}` });
  return res.json() as AssetDTO;
}

export function probe(file: string): {
  streams: Array<{
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
    nb_frames?: string;
    nb_read_frames?: string;
  }>;
  format: { duration: string };
} {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-count_frames',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    file,
  ]);
  return JSON.parse(out.toString('utf8'));
}
