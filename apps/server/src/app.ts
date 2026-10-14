import path from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppContext } from './context.js';
import { errorHandler } from './http/errors.js';
import { assetRoutes } from './routes/assets.js';
import { projectRoutes } from './routes/projects.js';
import { renderRoutes } from './routes/renders.js';
import { systemRoutes } from './routes/system.js';

export const SERVER_VERSION = '0.1.0';

export interface BuildAppOptions {
  logger?: boolean | { level: string };
}

export async function buildApp(
  ctx: AppContext,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? { level: ctx.config.logLevel },
    bodyLimit: 25 * 1024 * 1024,
    trustProxy: true,
  });

  app.setErrorHandler(errorHandler);

  if (ctx.config.corsOrigin) {
    await app.register(cors, { origin: ctx.config.corsOrigin.split(',').map((o) => o.trim()) });
  }
  await app.register(multipart, {
    limits: { fileSize: ctx.config.maxUploadBytes, files: 1, fields: 10 },
  });

  // `reply.sendFile` (with Range support) for media, fonts and downloads; plus the web app.
  if (ctx.config.publicDir) {
    await app.register(fastifyStatic, {
      root: ctx.config.publicDir,
      prefix: '/',
      wildcard: false,
      index: false,
    });
  } else {
    await app.register(fastifyStatic, { root: ctx.storage.root, serve: false });
  }

  systemRoutes(app, ctx, SERVER_VERSION);
  projectRoutes(app, ctx);
  assetRoutes(app, ctx);
  renderRoutes(app, ctx);

  app.setNotFoundHandler((request, reply) => {
    const url = request.url.split('?')[0] ?? '';
    const isApi = url.startsWith('/api/') || url.startsWith('/fonts/');
    if (!isApi && ctx.config.publicDir && request.method === 'GET') {
      // Serve hashed build assets directly; everything else is a client-side route.
      if (url.startsWith('/assets/') || path.extname(url)) {
        return reply.sendFile(url.slice(1), ctx.config.publicDir);
      }
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html', ctx.config.publicDir);
    }
    return reply
      .status(404)
      .send({ error: 'not_found', message: `Route ${request.method} ${url} not found` });
  });

  return app;
}
