/**
 * Export benchmark: builds the demo project in a temporary data directory and times exports.
 * Usage: npm run benchmark -w @vep/server -- [resolution=1080] [workers=2,4]
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ExportSettings } from '@vep/core';
import { loadConfig } from '../config.js';
import { createContext } from '../context.js';
import { createDemoProject } from '../demo.js';

const resolution = Number(process.argv[2] ?? 1080);
const workerCounts = (process.argv[3] ?? '2,4').split(',').map(Number);
const quiet = { info() {}, warn() {}, error: console.error };

for (const renderWorkers of workerCounts) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'cutroom-bench-'));
  const ctx = await createContext(
    loadConfig({ dataDir, renderWorkers, logLevel: 'silent' }),
    quiet,
  );
  const project = await createDemoProject(ctx);
  const settings: ExportSettings = {
    format: 'mp4',
    resolution,
    fps: 30,
    quality: 'medium',
    range: null,
  };
  const started = performance.now();
  const record = ctx.rendering.enqueue(project, settings);
  await ctx.rendering.onIdle();
  const seconds = (performance.now() - started) / 1000;
  const done = ctx.renders.get(record.id)!;
  const duration = done.outputDuration ?? 0;
  console.log(
    `${resolution}p, ${renderWorkers} workers: ${done.status}, ${duration.toFixed(1)}s of video in ${seconds.toFixed(1)}s ` +
      `(${(duration / seconds).toFixed(2)}x real time, ${((duration * 30) / seconds).toFixed(1)} fps)`,
  );
  await ctx.close();
  rmSync(dataDir, { recursive: true, force: true });
}
