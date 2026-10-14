import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createId, getReferencedAssetIds } from '@vep/core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { AssetRepository } from '../db/repositories.js';
import { badRequest, HttpError, notFound } from '../http/errors.js';
import { idParam, parseWith } from '../http/validation.js';
import { FILMSTRIP_FILE, THUMBNAIL_FILE, WAVEFORM_FILE } from '../media/processor.js';
import {
  ACCEPTED_EXTENSIONS,
  extensionOf,
  guessKind,
  mimeTypeFor,
  sanitizeDisplayName,
} from '../media/types.js';

const RenameBody = z.object({ name: z.string().trim().min(1).max(200) });

export function assetRoutes(app: FastifyInstance, ctx: AppContext): void {
  const requireAsset = (id: string) => {
    const asset = ctx.assets.get(id);
    if (!asset) throw notFound('Asset');
    return asset;
  };

  app.post('/api/projects/:id/assets', async (request, reply) => {
    const projectId = idParam(request.params);
    if (!ctx.projects.get(projectId)) throw notFound('Project');
    if (!request.isMultipart()) throw badRequest('Expected a multipart/form-data upload');

    const part = await request.file();
    if (!part) throw badRequest('No file was uploaded');
    const name = sanitizeDisplayName(part.filename);
    const extension = extensionOf(name);
    const kind = guessKind(extension);
    if (!kind) {
      part.file.resume();
      throw new HttpError(
        415,
        'unsupported_type',
        `Unsupported file type ".${extension}". Supported: ${ACCEPTED_EXTENSIONS.join(', ')}`,
      );
    }

    const id = createId('ast');
    const fileName = `original.${extension}`;
    await ctx.storage.ensureAssetDir(id);
    const target = ctx.storage.assetPath(id, fileName);
    try {
      await pipeline(part.file, createWriteStream(target));
    } catch (err) {
      await ctx.storage.removeAsset(id);
      throw err;
    }
    if (part.file.truncated) {
      await ctx.storage.removeAsset(id);
      throw new HttpError(
        413,
        'file_too_large',
        `The file exceeds the ${Math.round(ctx.config.maxUploadBytes / 1024 / 1024)} MB upload limit`,
      );
    }
    const { size } = await stat(target);
    if (size === 0) {
      await ctx.storage.removeAsset(id);
      throw badRequest('The uploaded file is empty');
    }

    const record = ctx.assets.create({
      id,
      projectId,
      name,
      kind,
      mimeType: mimeTypeFor(extension),
      size,
      fileName,
    });
    ctx.media.enqueue(id);
    reply.status(201);
    return AssetRepository.toDTO(record);
  });

  app.get('/api/assets/:id', async (request) =>
    AssetRepository.toDTO(requireAsset(idParam(request.params))),
  );

  app.patch('/api/assets/:id', async (request) => {
    const id = idParam(request.params);
    requireAsset(id);
    const body = parseWith(RenameBody, request.body);
    const record = ctx.assets.update(id, { name: sanitizeDisplayName(body.name) })!;
    const dto = AssetRepository.toDTO(record);
    ctx.events.publish(record.projectId, { type: 'asset.updated', asset: dto });
    return dto;
  });

  app.delete('/api/assets/:id', async (request, reply) => {
    const id = idParam(request.params);
    const asset = requireAsset(id);
    const force = (request.query as Record<string, string | undefined>).force === '1';
    const project = ctx.projects.get(asset.projectId);
    if (!force && project && getReferencedAssetIds(project.document).has(id)) {
      throw new HttpError(
        409,
        'asset_in_use',
        'This media is used in the timeline. Remove its clips first.',
      );
    }
    ctx.media.cancel(id);
    ctx.assets.delete(id);
    await ctx.storage.removeAsset(id);
    ctx.events.publish(asset.projectId, {
      type: 'asset.deleted',
      assetId: id,
      projectId: asset.projectId,
    });
    reply.status(204);
  });

  const sendAssetFile = (reply: FastifyReply, assetId: string, file: string, cache: string) => {
    reply.header('Cache-Control', cache);
    return reply.sendFile(
      ctx.storage.relative(ctx.storage.assetPath(assetId, file)),
      ctx.storage.root,
    );
  };

  app.get('/api/assets/:id/file', async (request, reply) => {
    const asset = requireAsset(idParam(request.params));
    reply.type(asset.mimeType);
    return sendAssetFile(reply, asset.id, asset.fileName, 'private, max-age=86400');
  });

  app.get('/api/assets/:id/preview', async (request, reply) => {
    const asset = requireAsset(idParam(request.params));
    if (!asset.previewReady)
      throw new HttpError(409, 'preview_pending', 'The preview is still being prepared');
    const file = asset.proxyFile ?? asset.fileName;
    if (!asset.proxyFile) reply.type(asset.mimeType);
    return sendAssetFile(reply, asset.id, file, 'private, max-age=86400');
  });

  app.get('/api/assets/:id/thumbnail', async (request, reply) => {
    const asset = requireAsset(idParam(request.params));
    if (!asset.hasThumbnail) throw notFound('Thumbnail');
    return sendAssetFile(reply, asset.id, THUMBNAIL_FILE, 'private, max-age=31536000, immutable');
  });

  app.get('/api/assets/:id/filmstrip', async (request, reply) => {
    const asset = requireAsset(idParam(request.params));
    if (!asset.filmstrip) throw notFound('Filmstrip');
    return sendAssetFile(reply, asset.id, FILMSTRIP_FILE, 'private, max-age=31536000, immutable');
  });

  app.get('/api/assets/:id/waveform', async (request, reply) => {
    const asset = requireAsset(idParam(request.params));
    if (!asset.hasWaveform) throw notFound('Waveform');
    reply.type('application/json');
    return sendAssetFile(reply, asset.id, WAVEFORM_FILE, 'private, max-age=31536000, immutable');
  });
}
