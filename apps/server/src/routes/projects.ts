import { copyFile, link, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  ColorSchema,
  createId,
  createProjectDoc,
  getReferencedAssetIds,
  isMediaClip,
  safeParseProjectDoc,
  type ProjectDoc,
} from '@vep/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { AssetRepository, ProjectRepository } from '../db/repositories.js';
import { badRequest, HttpError, notFound } from '../http/errors.js';
import { idParam, parseWith } from '../http/validation.js';
import { createDemoProject } from '../demo.js';
import { renderProjectThumbnail } from '../render/still.js';

const CreateProjectBody = z.object({
  name: z.string().trim().min(1).max(120),
  width: z.number().int().min(16).max(7680),
  height: z.number().int().min(16).max(7680),
  fps: z.number().min(1).max(120),
  backgroundColor: ColorSchema.optional(),
});

const SaveDocumentBody = z.object({
  document: z.unknown(),
  /** Version the client's edits are based on; null forces an overwrite. */
  baseVersion: z.number().int().nullable(),
});

const RenameBody = z.object({ name: z.string().trim().min(1).max(120) });

async function linkOrCopy(from: string, to: string): Promise<void> {
  try {
    await link(from, to);
  } catch {
    await copyFile(from, to);
  }
}

export function projectRoutes(app: FastifyInstance, ctx: AppContext): void {
  const requireProject = (id: string) => {
    const project = ctx.projects.get(id);
    if (!project) throw notFound('Project');
    return project;
  };

  app.get('/api/projects', async () =>
    ctx.projects.list().map((p) => ProjectRepository.toSummary(p)),
  );

  app.post('/api/projects', async (request, reply) => {
    const body = parseWith(CreateProjectBody, request.body);
    const doc = createProjectDoc({
      width: Math.round(body.width / 2) * 2,
      height: Math.round(body.height / 2) * 2,
      fps: body.fps,
      backgroundColor: body.backgroundColor ?? '#000000',
    });
    const record = ctx.projects.create(createId('prj'), body.name, doc);
    reply.status(201);
    return ProjectRepository.toDTO(record);
  });

  app.post('/api/demo', async (_request, reply) => {
    const record = await createDemoProject(ctx);
    reply.status(201);
    return ProjectRepository.toDTO(record);
  });

  app.get('/api/projects/:id', async (request) => {
    return ProjectRepository.toDTO(requireProject(idParam(request.params)));
  });

  app.put('/api/projects/:id/document', async (request) => {
    const id = idParam(request.params);
    const project = requireProject(id);
    const body = parseWith(SaveDocumentBody, request.body);
    const parsed = safeParseProjectDoc(body.document);
    if (!parsed.ok) throw badRequest('The project document is invalid', parsed.issues.slice(0, 20));
    const saved = ctx.projects.saveDocument(id, parsed.doc, body.baseVersion);
    if (!saved) {
      throw new HttpError(
        409,
        'version_conflict',
        `The project was changed elsewhere (server version ${project.version}). Reload to get the latest version.`,
      );
    }
    const summary = ProjectRepository.toSummary(saved);
    ctx.events.publish(id, { type: 'project.updated', project: summary });
    return summary;
  });

  app.patch('/api/projects/:id', async (request) => {
    const id = idParam(request.params);
    requireProject(id);
    const body = parseWith(RenameBody, request.body);
    const summary = ProjectRepository.toSummary(ctx.projects.rename(id, body.name)!);
    ctx.events.publish(id, { type: 'project.updated', project: summary });
    return summary;
  });

  app.post('/api/projects/:id/duplicate', async (request, reply) => {
    const source = requireProject(idParam(request.params));
    const newId = createId('prj');
    const doc: ProjectDoc = structuredClone(source.document);
    const record = ctx.projects.create(newId, `${source.name} (copy)`, doc);

    // Copy the media library, remapping asset ids inside the document.
    const idMap = new Map<string, string>();
    for (const asset of ctx.assets.listByProject(source.id)) {
      if (asset.status === 'processing') continue;
      const assetId = createId('ast');
      idMap.set(asset.id, assetId);
      const fromDir = ctx.storage.assetDir(asset.id);
      const toDir = ctx.storage.assetDir(assetId);
      await mkdir(toDir, { recursive: true });
      for (const file of await readdir(fromDir))
        await linkOrCopy(path.join(fromDir, file), path.join(toDir, file));
      ctx.assets.create({
        id: assetId,
        projectId: newId,
        name: asset.name,
        kind: asset.kind,
        mimeType: asset.mimeType,
        size: asset.size,
        fileName: asset.fileName,
      });
      ctx.assets.update(assetId, {
        status: asset.status,
        error: asset.error,
        metadata: asset.metadata,
        filmstrip: asset.filmstrip,
        hasThumbnail: asset.hasThumbnail,
        hasWaveform: asset.hasWaveform,
        proxyFile: asset.proxyFile,
        previewReady: asset.previewReady,
      });
    }
    for (const track of doc.tracks) {
      for (const clip of track.clips) {
        if (isMediaClip(clip)) clip.assetId = idMap.get(clip.assetId) ?? clip.assetId;
      }
    }
    const saved = ctx.projects.saveDocument(newId, doc, record.version)!;
    reply.status(201);
    return ProjectRepository.toDTO(saved);
  });

  app.delete('/api/projects/:id', async (request, reply) => {
    const id = idParam(request.params);
    requireProject(id);
    const assets = ctx.assets.listByProject(id);
    const renders = ctx.renders.listByProject(id);
    for (const render of renders) await ctx.rendering.cancel(render.id);
    for (const asset of assets) ctx.media.cancel(asset.id);
    ctx.projects.delete(id); // cascades to assets and renders rows
    await Promise.all([
      ...assets.map((a) => ctx.storage.removeAsset(a.id)),
      ...renders.map((r) => ctx.storage.removeRender(r.id)),
    ]);
    reply.status(204);
  });

  app.get('/api/projects/:id/thumbnail', async (request, reply) => {
    const project = requireProject(idParam(request.params));
    const file = await renderProjectThumbnail(ctx, project);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.sendFile(ctx.storage.relative(file), ctx.storage.root);
  });

  app.get('/api/projects/:id/assets', async (request) => {
    const id = idParam(request.params);
    requireProject(id);
    return ctx.assets.listByProject(id).map((a) => AssetRepository.toDTO(a));
  });

  app.get('/api/projects/:id/usage', async (request) => {
    const project = requireProject(idParam(request.params));
    return { assetIds: [...getReferencedAssetIds(project.document)] };
  });

  app.get('/api/projects/:id/events', (request, reply) => {
    const id = idParam(request.params);
    requireProject(id);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const unsubscribe = ctx.events.subscribe(id, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    request.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });
}
