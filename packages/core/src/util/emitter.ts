export type Listener<T> = (payload: T) => void;

/** Minimal typed pub-sub shared by Scene and CommandBus for change notifications. */
export class Emitter<EventMap extends Record<string, unknown>> {
  private listeners = new Map<keyof EventMap, Set<Listener<unknown>>>();

  on<K extends keyof EventMap>(
    event: K,
    listener: Listener<EventMap[K]>,
  ): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as Listener<unknown>);
    this.listeners.set(event, set);
    return () => set.delete(listener as Listener<unknown>);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as Listener<EventMap[K]>)(payload);
    }
  }
}
