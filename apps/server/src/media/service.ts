import type { Config } from '../config.js';
import type { AssetRepository } from '../db/repositories.js';
import type { EventBus } from '../events.js';
import { AbortError } from '../ffmpeg/run.js';
import { JobQueue } from '../jobs/queue.js';
import type { Storage } from '../storage.js';
import { MediaProcessor } from './processor.js';

interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** Schedules media processing for uploaded assets. */
export class MediaService {
  private readonly queue: JobQueue;
  private readonly processor: MediaProcessor;

  constructor(
    config: Config,
    storage: Storage,
    private readonly assets: AssetRepository,
    events: EventBus,
    log: Logger,
  ) {
    this.processor = new MediaProcessor(config, storage, assets, events, log);
    this.queue = new JobQueue(config.mediaConcurrency, (key, err) => {
      if (err instanceof AbortError) return;
      log.error({ err, assetId: key }, 'media processing failed');
      this.assets.update(key, { status: 'error', error: 'Processing failed unexpectedly.' });
    });
  }

  enqueue(assetId: string): void {
    this.queue.add(assetId, (signal) => this.processor.process(assetId, signal));
  }

  cancel(assetId: string): void {
    this.queue.cancel(assetId);
  }

  /** Re-queues assets that were still processing when the server last stopped. */
  resumePending(): number {
    const pending = this.assets.listByStatus('processing');
    for (const asset of pending) this.enqueue(asset.id);
    return pending.length;
  }

  onIdle(): Promise<void> {
    return this.queue.onIdle();
  }

  shutdown(): void {
    this.queue.cancelAll();
  }
}
