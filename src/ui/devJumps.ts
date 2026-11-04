import { deserialize, exportSave, importSave, saveGame } from "../core/save";
import { replaceState, state } from "../core/state";

// Dev "Jump to milestone": swap in a save captured from the sim's baseline player at that
// milestone (src/dev/milestoneSaves.ts, regenerated with `npm run report -- devsaves`).
// Your own save is backed up the first time you jump, and "Restore my save" brings it back.

const BACKUP_KEY = "flux-engine-backup";

export interface MilestoneSave {
  name: string;
  desc: string;
  time: number;
  save: string;
}

/** Loaded on demand so the saves aren't in the main bundle. */
export const loadMilestoneSaves = async (): Promise<MilestoneSave[]> =>
  (await import("../dev/milestoneSaves")).MILESTONE_SAVES;

function readBackup(): string | null {
  try {
    return localStorage.getItem(BACKUP_KEY);
  } catch {
    return null;
  }
}

export const hasBackup = () => readBackup() !== null;

export function jumpTo(m: MilestoneSave) {
  // Back up only once: after a second jump the "current" save is a dev save, not yours.
  try {
    if (!hasBackup()) localStorage.setItem(BACKUP_KEY, exportSave());
  } catch {
    /* storage blocked: jump anyway */
  }
  const next = deserialize(m.save);
  next.meta.lastTick = Date.now(); // no offline catch-up for the time since the bot played
  next.options = { ...state.options }; // keep your settings (dev speed, autosave, ...)
  next.automation.collapse = true; // the bot Collapsed by hand; a player would use auto-Collapse
  next.heat.introduced = true;
  next.rift.introduced = next.rift.introduced || next.rift.count > 0;
  next.ui = { ...state.ui, tab: "engines" };
  replaceState(next);
  saveGame();
}

export function restoreBackup(): boolean {
  const backup = readBackup();
  if (!backup || !importSave(backup)) return false;
  state.meta.lastTick = Date.now(); // don't award offline progress for time spent testing
  saveGame();
  try {
    localStorage.removeItem(BACKUP_KEY);
  } catch {
    /* ignore */
  }
  return true;
}
