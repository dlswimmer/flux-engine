// Tiny game-event signal so views can react to the moment something happens (the Engine
// Room's animations). Game logic only emits; nothing in it listens, so the headless sims are
// unaffected. New layers add their event names here.

export type GameEvent = "overdrive" | "lattice" | "vent" | "collapse" | "rift" | "trial";

const listeners = new Map<GameEvent, Set<() => void>>();

/** Subscribe; returns an unsubscribe function. */
export function on(event: GameEvent, fn: () => void): () => void {
  let set = listeners.get(event);
  if (!set) listeners.set(event, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

export function emit(event: GameEvent) {
  listeners.get(event)?.forEach((fn) => fn());
}
