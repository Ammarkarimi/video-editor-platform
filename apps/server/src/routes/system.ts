import { FONT_CATALOG, type FontsResponse, type ServerInfo } from '@vep/core';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { notFound } from '../http/errors.js';

const FONT_FILE = /^[A-Za-z0-9-]+\.ttf$/;

export function systemRoutes(app: FastifyInstance, ctx: AppContext, version: string): void {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/info', async (): Promise<ServerInfo> => ({
    name: 'video-editor-platform',
    version,
    ffmpeg: ctx.ffmpegVersion,
    maxUploadBytes: ctx.config.maxUploadBytes,
    renderWorkers: ctx.config.renderWorkers,
  }));

  app.get('/api/fonts', async (): Promise<FontsResponse> => ({
    families: FONT_CATALOG,
    baseUrl: '/fonts/',
  }));

  app.get('/fonts/:file', async (request, reply) => {
    const { file } = request.params as { file: string };
    if (!FONT_FILE.test(file)) throw notFound('Font');
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.header('Access-Control-Allow-Origin', '*');
    reply.type('font/ttf');
    return reply.sendFile(file, ctx.config.fontsDir);
  });
}
