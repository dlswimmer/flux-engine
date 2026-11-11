// Playtest log: what the player did and when, so a playtest can be exported (Options → Playtest
// log) and reviewed against the sims. Kept in its own localStorage key, outside the save, and
// capped. Frequent things (resets, vents, short Collapses, clicks) are counted into a snapshot
// once a minute instead of logged one by one; rare ones (upgrades, Trials, Rifts, sessions,
// time away) get their own entry.
import { onAny, type GameEvent } from "./events";
import { state } from "./state";

const LOG_KEY = "flux-engine-log";
const MAX_ENTRIES = 20000;
const SNAPSHOT_MS = 60_000;
/** Collapses faster than this are counted, not logged (after Breach a run lasts ~2s). */
const LOG_COLLAPSE_OVER = 10;

/** [real time (ms since epoch), game time played (s), what, details] */
type Entry = [number, number, string, Record<string, unknown>?];

let entries: Entry[] = [];
let counts: Record<string, number> = {};

const count = (what: string, n = 1) => (counts[what] = (counts[what] ?? 0) + n);

export function logEntry(what: string, details?: Record<string, unknown>) {
  entries.push([Date.now(), Math.round(state.stats.timePlayed), what, details]);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
}

const log10 = (d: { log10(): { toNumber(): number } }) => Math.round(d.log10().toNumber() * 10) / 10;

function snapshot(reason = "snapshot") {
  logEntry(reason, {
    flux: log10(state.flux.max(1)),
    tempo: state.tempo,
    od: state.overdrives,
    lat: state.lattices,
    engines: state.engines.map((e) => e.bought),
    shards: state.collapse.shards.toNumber(),
    collapses: state.collapse.count,
    run: Math.round(state.collapse.time),
    rifts: state.rift.count,
    overcharge: state.collapse.overcharge,
    heat: Math.round(state.heat.amount),
    trial: state.trials.active,
    ...counts,
  });
  counts = {};
}

function onEvent(event: GameEvent, detail?: string | number) {
  switch (event) {
    case "collapse": {
      const last = state.collapse.history.at(-1);
      if (last && last.time >= LOG_COLLAPSE_OVER)
        logEntry("collapse", { n: last.number, run: Math.round(last.time), shards: last.shards.toNumber() });
      else count("collapses", 1);
      break;
    }
    case "rift": {
      const last = state.rift.history.at(-1);
      logEntry("rift", last ? { n: last.number, time: Math.round(last.time), essence: last.essence.toNumber(), overcharge: last.overcharge } : {});
      break;
    }
    case "upgrade":
    case "trial":
    case "trialStart":
    case "trialAbandon":
      logEntry(event, { id: detail, collapses: state.collapse.count, run: Math.round(state.collapse.time) });
      break;
    case "overcharge":
      count("overcharge", Number(detail ?? 1));
      break;
    default:
      count(event + "s"); // overdrives, lattices, vents
  }
}

function persist() {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or blocked: the log is a nice-to-have, never worth breaking the game.
  }
}

/** Load the log and start recording. `paused` = the game isn't running (off screen or asking). */
export function startPlayLog(paused: () => boolean) {
  try {
    entries = JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]");
  } catch {
    entries = [];
  }
  logEntry("session start", { version: state.meta.version });
  onAny(onEvent);
  // Player attention: every tap/click and key press, counted per minute.
  document.addEventListener("pointerdown", () => count("taps"), { passive: true });
  document.addEventListener("keydown", () => count("keys"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      snapshot("hidden");
      persist();
    } else logEntry("visible");
  });
  window.addEventListener("pagehide", persist);
  setInterval(() => {
    if (!paused()) snapshot();
    persist();
  }, SNAPSHOT_MS);
}

export const playLogSize = () => entries.length;
export const playLogStart = () => entries[0]?.[0];

/** The whole log as JSON, with a legend and a final snapshot. */
export function exportPlayLog(): string {
  snapshot("export");
  persist();
  return JSON.stringify({
    game: "Flux Engine playtest log",
    exported: new Date().toISOString(),
    columns: ["real time (ms)", "game time played (s)", "event", "details"],
    note: "snapshot counts (taps, keys, overdrives, lattices, vents, collapses, overcharge) are since the previous snapshot",
    entries,
  });
}

export function clearPlayLog() {
  entries = [];
  counts = {};
  logEntry("log cleared");
  persist();
}
