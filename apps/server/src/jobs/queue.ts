type Task = (signal: AbortSignal) => Promise<void>;

interface QueuedJob {
  key: string;
  task: Task;
  controller: AbortController;
}

/** A small in-process job queue with bounded concurrency, de-duplication and cancellation. */
export class JobQueue {
  private readonly pending: QueuedJob[] = [];
  private readonly running = new Map<string, QueuedJob>();
  private idleWaiters: Array<() => void> = [];

  constructor(
    private readonly concurrency: number,
    private readonly onError: (key: string, error: unknown) => void,
  ) {}

  /** Adds a job unless one with the same key is already queued or running. */
  add(key: string, task: Task): boolean {
    if (this.running.has(key) || this.pending.some((j) => j.key === key)) return false;
    this.pending.push({ key, task, controller: new AbortController() });
    this.pump();
    return true;
  }

  has(key: string): boolean {
    return this.running.has(key) || this.pending.some((j) => j.key === key);
  }

  isRunning(key: string): boolean {
    return this.running.has(key);
  }

  position(key: string): number {
    return this.pending.findIndex((j) => j.key === key);
  }

  /** Cancels a queued or running job. Returns true if something was cancelled. */
  cancel(key: string): boolean {
    const index = this.pending.findIndex((j) => j.key === key);
    if (index >= 0) {
      this.pending.splice(index, 1);
      this.checkIdle();
      return true;
    }
    const job = this.running.get(key);
    if (job) {
      job.controller.abort();
      return true;
    }
    return false;
  }

  cancelAll(): void {
    this.pending.length = 0;
    for (const job of this.running.values()) job.controller.abort();
  }

  get size(): number {
    return this.pending.length + this.running.size;
  }

  /** Resolves once no jobs are queued or running. */
  onIdle(): Promise<void> {
    if (this.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift()!;
      this.running.set(job.key, job);
      void job
        .task(job.controller.signal)
        .catch((err: unknown) => this.onError(job.key, err))
        .finally(() => {
          this.running.delete(job.key);
          this.pump();
          this.checkIdle();
        });
    }
  }

  private checkIdle(): void {
    if (this.size > 0) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
