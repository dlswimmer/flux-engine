// Tiny game-event signal so views can react to the moment something happens (the Engine
// Room's animations). Game logic only emits; nothing in it listens, so the headless sims are
// unaffected. New layers add their event names here.

export type GameEvent =
  | "overdrive"
  | "lattice"
  | "vent"
  | "collapse"
  | "rift"
  | "trial"
  | "trialStart"
  | "trialAbandon"
  | "upgrade"
  | "overcharge";

/** Optional detail, e.g. which upgrade or Trial (the playtest log records it). */
type Listener = (detail?: string | number) => void;

const listeners = new Map<GameEvent, Set<Listener>>();

/** Subscribe; returns an unsubscribe function. */
export function on(event: GameEvent, fn: Listener): () => void {
  let set = listeners.get(event);
  if (!set) listeners.set(event, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

export function emit(event: GameEvent, detail?: string | number) {
  listeners.get(event)?.forEach((fn) => fn(detail));
}

/** Every event, for the playtest log. */
export function onAny(fn: (event: GameEvent, detail?: string | number) => void) {
  const all: GameEvent[] = ["overdrive", "lattice", "vent", "collapse", "rift", "trial", "trialStart", "trialAbandon", "upgrade", "overcharge"];
  for (const e of all) on(e, (d) => fn(e, d));
}
