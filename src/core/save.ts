import { Decimal, type DecimalSource } from "../lib/decimal";
import { SAVE_VERSION, defaultState, replaceState, state, type GameState } from "./state";

const SAVE_KEY = "flux-engine-save";
const DECIMAL_TAG = "__D:";
const AUTOSAVE_MS = 15_000;

// Each entry upgrades a raw save from (version - 1) to `version`, in place.
// Example: 2: (raw) => { raw.collapse.upgrades = raw.collapse.ups ?? []; },
const MIGRATIONS: Record<number, (raw: any) => void> = {};

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
  // A null default (an active Trial) takes whatever was saved: typeof null is "object", so it
  // used to fall into the object branch and drop the string, ending your Trial on reload.
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
    saveGame();
    return true;
  } catch (err) {
    console.error("Import failed", err);
    return false;
  }
}

export function hardReset() {
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
