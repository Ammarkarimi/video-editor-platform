/**
 * Render worker process entry point. The render service forks one of these per segment so heavy
 * canvas work never blocks the API server's event loop and uses every CPU core.
 *
 * Protocol (IPC): parent sends `{ type: 'start', job }`; the worker replies with
 * `{ type: 'progress', frames }` updates and finally `{ type: 'done' }` or `{ type: 'error' }`.
 */
import { renderChunk, type ChunkJob } from './chunk.js';

export type WorkerRequest = { type: 'start'; job: ChunkJob };
export type WorkerMessage =
  { type: 'progress'; frames: number } | { type: 'done' } | { type: 'error'; message: string };

const controller = new AbortController();

function send(message: WorkerMessage): Promise<void> {
  return new Promise((resolve) => {
    if (!process.send) {
      resolve();
      return;
    }
    process.send(message, undefined, {}, () => resolve());
  });
}

process.on('SIGTERM', () => controller.abort());
process.on('disconnect', () => controller.abort());

process.once('message', (message: WorkerRequest) => {
  if (message?.type !== 'start') return;
  let lastReport = 0;
  renderChunk(
    message.job,
    (frames) => {
      const now = Date.now();
      if (now - lastReport >= 200 || frames === message.job.frameEnd - message.job.frameStart) {
        lastReport = now;
        void send({ type: 'progress', frames });
      }
    },
    controller.signal,
  )
    .then(async () => {
      await send({ type: 'done' });
      process.exit(0);
    })
    .catch(async (err: unknown) => {
      await send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
});
