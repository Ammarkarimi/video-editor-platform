import type { ServerEvent } from '@vep/core';

type Listener = (event: ServerEvent) => void;

/** In-process pub/sub for pushing asset and render updates to connected editors (via SSE). */
export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(projectId: string, listener: Listener): () => void {
    let set = this.listeners.get(projectId);
    if (!set) {
      set = new Set();
      this.listeners.set(projectId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(projectId);
    };
  }

  publish(projectId: string, event: ServerEvent): void {
    for (const listener of this.listeners.get(projectId) ?? []) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must not affect the others.
      }
    }
  }

  subscriberCount(projectId: string): number {
    return this.listeners.get(projectId)?.size ?? 0;
  }
}
