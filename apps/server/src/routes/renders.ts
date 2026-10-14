import { EXPORT_FORMAT_INFO, ExportSettingsSchema } from '@vep/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { HttpError, notFound } from '../http/errors.js';
import { contentDisposition, idParam, parseWith } from '../http/validation.js';
import { renderStillImage } from '../render/still.js';

const CreateRenderBody = z.object({ settings: ExportSettingsSchema });

const StillBody = z.object({
  time: z.number().min(0),
  /** Short side of the image in pixels; defaults to the project resolution. */
  resolution: z.number().int().min(16).max(4320).optional(),
  format: z.enum(['png', 'jpeg']).default('png'),
});

export function renderRoutes(app: FastifyInstance, ctx: AppContext): void {
  const requireRender = (id: string) => {
    const render = ctx.renders.get(id);
    if (!render) throw notFound('Render');
    return render;
  };

  app.get('/api/projects/:id/renders', async (request) => {
    const projectId = idParam(request.params);
    if (!ctx.projects.get(projectId)) throw notFound('Project');
    return ctx.renders.listByProject(projectId).map((r) => ctx.rendering.toDTO(r));
  });

  app.post('/api/projects/:id/renders', async (request, reply) => {
    const projectId = idParam(request.params);
    const project = ctx.projects.get(projectId);
    if (!project) throw notFound('Project');
    const { settings } = parseWith(CreateRenderBody, request.body);
    const record = ctx.rendering.enqueue(project, settings);
    reply.status(202);
    return ctx.rendering.toDTO(record);
  });

  app.get('/api/renders/:id', async (request) =>
    ctx.rendering.toDTO(requireRender(idParam(request.params))),
  );

  app.post('/api/renders/:id/cancel', async (request) => {
    const id = idParam(request.params);
    requireRender(id);
    await ctx.rendering.cancel(id);
    return ctx.rendering.toDTO(requireRender(id));
  });

  app.delete('/api/renders/:id', async (request, reply) => {
    const id = idParam(request.params);
    const render = requireRender(id);
    await ctx.rendering.cancel(id);
    ctx.renders.delete(id);
    await ctx.storage.removeRender(id);
    ctx.events.publish(render.projectId, {
      type: 'render.deleted',
      renderId: id,
      projectId: render.projectId,
    });
    reply.status(204);
  });

  app.get('/api/renders/:id/download', async (request, reply) => {
    const render = requireRender(idParam(request.params));
    if (render.status !== 'completed')
      throw new HttpError(409, 'not_ready', 'This export has not finished');
    const info = EXPORT_FORMAT_INFO[render.settings.format];
    const inline = (request.query as Record<string, string | undefined>).inline === '1';
    reply.header(
      'Content-Disposition',
      contentDisposition(render.fileName, inline ? 'inline' : 'attachment'),
    );
    reply.header('Cache-Control', 'private, max-age=3600');
    reply.type(info.mimeType);
    return reply.sendFile(ctx.storage.relative(ctx.rendering.outputPath(render)), ctx.storage.root);
  });

  app.post('/api/projects/:id/still', async (request, reply) => {
    const projectId = idParam(request.params);
    const project = ctx.projects.get(projectId);
    if (!project) throw notFound('Project');
    const body = parseWith(StillBody, request.body ?? {});
    const image = await renderStillImage(ctx, project, body.time, body.resolution, body.format);
    reply.type(body.format === 'png' ? 'image/png' : 'image/jpeg');
    reply.header(
      'Content-Disposition',
      contentDisposition(`${project.name} frame.${body.format === 'png' ? 'png' : 'jpg'}`),
    );
    return reply.send(image);
  });
}
