import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContext } from './context.js';

async function main(): Promise<void> {
  const config = loadConfig();
  // The app's logger is created by Fastify; use a console logger until it exists.
  const bootLog = {
    info: (obj: unknown, msg?: string) => console.log(msg ?? '', obj),
    warn: (obj: unknown, msg?: string) => console.warn(msg ?? '', obj),
    error: (obj: unknown, msg?: string) => console.error(msg ?? '', obj),
  };
  const ctx = await createContext(config, bootLog);
  const app = await buildApp(ctx);

  const resumedAssets = ctx.media.resumePending();
  ctx.rendering.resumePending();
  if (resumedAssets > 0) app.log.info(`Resumed processing of ${resumedAssets} asset(s)`);

  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    {
      dataDir: config.dataDir,
      publicDir: config.publicDir,
      ffmpeg: ctx.ffmpegVersion,
      renderWorkers: config.renderWorkers,
    },
    'Video editor server ready',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Received ${signal}, shutting down`);
    try {
      await app.close();
      await ctx.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
