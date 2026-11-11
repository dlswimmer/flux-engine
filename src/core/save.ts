import { Decimal, type DecimalSource } from "../lib/decimal";
import { logEntry } from "./playLog";
import { SAVE_VERSION, defaultState, replaceState, state, type GameState } from "./state";

const SAVE_KEY = "flux-engine-save";
const DECIMAL_TAG = "__D:";
const AUTOSAVE_MS = 15_000;

// Each entry upgrades a raw save from (version - 1) to `version`, in place.
// Example: 2: (raw) => { raw.collapse.upgrades = raw.collapse.ups ?? []; },
const MIGRATIONS: Record<number, (raw: any) => void> = {
  // Automators (every Engine and Tempo autobuyer, buying max) split into one unlock per
  // Engine, Tempo and Bulk Buying; Foreman (Overdrive + Lattice) into Foreman and Lattice Foreman.
  2: (raw) => {
    const ups: string[] | undefined = raw?.collapse?.upgrades;
    if (!Array.isArray(ups)) return;
    const add = (ids: string[]) => ids.forEach((id) => ups.includes(id) || ups.push(id));
    const i = ups.indexOf("automators");
    if (i >= 0) {
      ups.splice(i, 1);
      add(["auto1", "auto2", "auto3", "auto4", "auto5", "auto6", "auto7", "auto8", "autotempo", "bulk"]);
    }
    if (ups.includes("automators2")) add(["autolattice"]);
  },
  // Fixed Tempo became Pressure Valve and Hollow Core became Surge Engine (same rewards).
  3: (raw) => {
    const t = raw?.trials;
    if (!t) return;
    const rename: Record<string, string> = { fixed: "valve", hollow: "surge" };
    if (Array.isArray(t.completed)) t.completed = t.completed.map((id: string) => rename[id] ?? id);
    if (t.best) for (const [from, to] of Object.entries(rename)) if (from in t.best) { t.best[to] = t.best[from]; delete t.best[from]; }
    if (t.active in rename) t.active = rename[t.active];
  },
};

export function serialize(s: GameState): string {
  // Decimal defines toJSON, so the replacer has to look at the holder's raw value.
  return JSON.stringify(s, function (this: any, key, value) {
    const raw = this[key];
    if (raw instanceof Decimal) return DECIMAL_TAG + raw.toString();
    if (raw === Infinity) return "Infinity";
    return value;
  });
}

export function deserialize(json: string): GameState {
  const raw = JSON.parse(json, (_key, value) => {
    if (typeof value !== "string") return value;
    if (value.startsWith(DECIMAL_TAG)) return new Decimal(value.slice(DECIMAL_TAG.length));
    if (value === "Infinity") return Infinity;
    return value;
  });

  let version: number = raw?.meta?.version ?? 0;
  while (version < SAVE_VERSION) {
    version++;
    MIGRATIONS[version]?.(raw);
  }

  const merged = mergeWithDefaults(defaultState(), raw);
  merged.meta.version = SAVE_VERSION;
  return merged;
}

/** Overlay a loaded save onto fresh defaults so new fields always exist. */
function mergeWithDefaults<T>(base: T, incoming: unknown): T {
  if (incoming === undefined || incoming === null) return base;
  // A null default (an active Trial) takes whatever was saved: typeof null is "object", so the
  // object rule below dropped "rigid" and every reload quietly ended the Trial you were in.
  if (base === null) return incoming as T;
  if (base instanceof Decimal) {
    const d = incoming instanceof Decimal ? incoming : new Decimal(incoming as DecimalSource);
    return (Number.isNaN(d.mag) ? base : d) as T;
  }
  if (Array.isArray(base)) {
    if (!Array.isArray(incoming)) return base;
    const length = Math.max(base.length, incoming.length);
    return Array.from({ length }, (_, i) => {
      if (i >= incoming.length) return base[i];
      if (i >= base.length) return incoming[i];
      return mergeWithDefaults(base[i], incoming[i]);
    }) as T;
  }
  if (typeof base === "object") {
    if (typeof incoming !== "object") return base;
    const out: any = { ...base };
    for (const key of Object.keys(base as object)) {
      out[key] = mergeWithDefaults((base as any)[key], (incoming as any)[key]);
    }
    // Records that start empty (Trial best times) keep their saved entries: before this, every
    // load dropped them.
    if (Object.keys(base as object).length === 0) Object.assign(out, incoming);
    return out;
  }
  return (typeof incoming === typeof base ? incoming : base) as T;
}

const toBase64 = (s: string) => {
  let binary = "";
  for (const byte of new TextEncoder().encode(s)) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const fromBase64 = (s: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0)));

export function saveGame(): boolean {
  try {
    localStorage.setItem(SAVE_KEY, serialize(state));
    return true;
  } catch (err) {
    console.error("Save failed", err);
    return false;
  }
}

export function loadGame() {
  try {
    const json = localStorage.getItem(SAVE_KEY);
    if (json) replaceState(deserialize(json));
  } catch (err) {
    console.error("Load failed, starting fresh", err);
  }
}

export const exportSave = () => toBase64(serialize(state));

export function importSave(text: string): boolean {
  try {
    replaceState(deserialize(fromBase64(text)));
    logEntry("save imported");
    saveGame();
    return true;
  } catch (err) {
    console.error("Import failed", err);
    return false;
  }
}

export function hardReset() {
  logEntry("hard reset");
  replaceState(defaultState());
  saveGame();
}

export function startAutosave() {
  setInterval(() => state.options.autosave && saveGame(), AUTOSAVE_MS);
  // Mobile browsers often skip beforeunload; backgrounding the tab is the last reliable moment.
  const saveNow = () => state.options.autosave && saveGame();
  window.addEventListener("beforeunload", saveNow);
  window.addEventListener("pagehide", saveNow);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && saveNow());
}
