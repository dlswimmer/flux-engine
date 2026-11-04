import { D } from "../lib/decimal";
import { ENGINE_COUNT, state } from "../core/state";
import { shardUpgrades } from "./collapse";
import { resetForOverdrive } from "./reset";

const UNLOCK_PHASE = 4; // the first 4 Overdrives unlock Engines V–VIII
const UNLOCK_REQUIREMENT = 10;
const BASE_REQUIREMENT = 20; // Engine VIII for the first Overdrive past the unlock phase
const REQUIREMENT_STEP = 10;

/** Which engine (0-based tier) and how many of it the next Overdrive needs. */
export function overdriveRequirement(): { tier: number; amount: number } {
  const od = state.overdrives;
  const tier = Math.min(UNLOCK_PHASE - 1 + od, ENGINE_COUNT - 1);
  const amount =
    od < UNLOCK_PHASE ? UNLOCK_REQUIREMENT : BASE_REQUIREMENT + (od - UNLOCK_PHASE) * REQUIREMENT_STEP;
  return { tier, amount };
}

export function canOverdrive(): boolean {
  const { tier, amount } = overdriveRequirement();
  return state.engines[tier].amount.gte(amount);
}

export function doOverdrive(): boolean {
  if (!canOverdrive()) return false;
  state.overdrives++;
  state.stats.overdrives++;
  resetForOverdrive();
  return true;
}

export const overdriveFactor = () => (shardUpgrades.has("resonance") ? 2.25 : 2);
export const overdriveMult = () => D(overdriveFactor()).pow(state.overdrives);
