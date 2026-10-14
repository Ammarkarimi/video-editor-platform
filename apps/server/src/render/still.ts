import { existsSync } from 'node:fs';
import { readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import {
  computeExportSize,
  createAssetLookup,
  getProjectDuration,
  renderFrame,
  type Ctx2D,
} from '@vep/core';
import type { AppContext } from '../context.js';
import type { ProjectRecord } from '../db/repositories.js';
import { resolveRenderAssets } from './assets.js';
import { StillRenderHost } from './host.js';

const MAX_STILL_EDGE = 4096;

/** Renders one frame of a project with the shared renderer and encodes it as PNG or JPEG. */
export async function renderStillImage(
  ctx: AppContext,
  project: ProjectRecord,
  time: number,
  resolution: number | undefined,
  format: 'png' | 'jpeg',
): Promise<Buffer> {
  const doc = project.document;
  const { width: pw, height: ph } = doc.settings;
  let size = resolution ? computeExportSize(pw, ph, resolution) : { width: pw, height: ph };
  if (Math.max(size.width, size.height) > MAX_STILL_EDGE) {
    const f = MAX_STILL_EDGE / Math.max(size.width, size.height);
    size = { width: Math.round(size.width * f), height: Math.round(size.height * f) };
  }
  const assets = resolveRenderAssets(project.id, doc, ctx.assets, ctx.storage);
  const host = new StillRenderHost(doc, assets, ctx.config.ffmpegPath, size);
  await host.prepare(time);
  const canvas = createCanvas(size.width, size.height);
  renderFrame(
    canvas.getContext('2d') as unknown as Ctx2D,
    { doc, assets: createAssetLookup(assets.values()) },
    time,
    host,
    size,
  );
  return format === 'png' ? canvas.encode('png') : canvas.encode('jpeg', 90);
}

/** Returns the path of a cached dashboard thumbnail for the project's current version. */
export async function renderProjectThumbnail(
  ctx: AppContext,
  project: ProjectRecord,
): Promise<string> {
  const file = ctx.storage.projectThumbnail(project.id, project.version);
  if (existsSync(file)) return file;
  const duration = getProjectDuration(project.document);
  const time = duration > 0 ? Math.min(duration / 2, 2) : 0;
  const image = await renderStillImage(ctx, project, time, 270, 'jpeg');
  await writeFile(file, image);
  // Drop thumbnails of older versions.
  const prefix = `${project.id}-v`;
  for (const name of await readdir(ctx.storage.cacheDir)) {
    if (name.startsWith(prefix) && path.join(ctx.storage.cacheDir, name) !== file) {
      await rm(path.join(ctx.storage.cacheDir, name), { force: true });
    }
  }
  return file;
}
