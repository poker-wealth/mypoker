/**
 * EventBus — typed publish/subscribe.
 *
 * Decouples game logic from transport: the game emits domain events (state changed, cards dealt,
 * hand settled) and the WebSocket layer subscribes. The game never knows about sockets, and the
 * transport never reaches into game internals. `Events` is a map of event name → payload type.
 */

export type EventHandler<T> = (payload: T) => void;

export class EventBus<Events extends Record<string, unknown>> {
  private readonly handlers: {
    [K in keyof Events]?: Set<EventHandler<Events[K]>>;
  } = {};

  /** Subscribe. Returns an unsubscribe function. */
  on<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): () => void {
    (this.handlers[event] ??= new Set()).add(handler);
    return () => this.off(event, handler);
  }

  /** Subscribe for a single emission, then auto-unsubscribe. */
  once<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void {
    this.handlers[event]?.delete(handler);
  }

  /**
   * Emit to all current subscribers. Every handler runs even if one throws (a flaky subscriber must
   * not starve the others); the first error is re-thrown after all have run.
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers[event];
    if (!set) return;
    let firstError: unknown;
    let threw = false;
    // Copy so handlers that unsubscribe during emit don't mutate the set mid-iteration.
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        if (!threw) {
          threw = true;
          firstError = err;
        }
      }
    }
    if (threw) throw firstError;
  }

  listenerCount<K extends keyof Events>(event: K): number {
    return this.handlers[event]?.size ?? 0;
  }

  removeAll(): void {
    for (const key of Object.keys(this.handlers)) {
      delete this.handlers[key as keyof Events];
    }
  }
}
