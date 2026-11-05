import { emit } from "../core/events";
import { D } from "../lib/decimal";
import { ENGINE_COUNT, state } from "../core/state";
import { shardUpgrades } from "./collapse";
import { resetForOverdrive } from "./reset";

export const UNLOCK_PHASE = 4; // the first 4 Overdrives unlock Engines V–VIII
const UNLOCK_REQUIREMENT = 10;
const BASE_REQUIREMENT = 20; // Engine VIII for the first Overdrive past the unlock phase
const REQUIREMENT_STEP = 10;

/** Which engine (0-based tier) and how many of it Overdrive number `od` (0-based) needs. */
function requirementAt(od: number): { tier: number; amount: number } {
  const tier = Math.min(UNLOCK_PHASE - 1 + od, ENGINE_COUNT - 1);
  const amount =
    od < UNLOCK_PHASE ? UNLOCK_REQUIREMENT : BASE_REQUIREMENT + (od - UNLOCK_PHASE) * REQUIREMENT_STEP;
  return { tier, amount };
}

/** Which engine and how many of it the next Overdrive needs. */
export const overdriveRequirement = () => requirementAt(state.overdrives);

/**
 * How many Overdrives your Engines cover right now (at most `limit`). Past the unlock phase
 * they all need Engine VIII, so one reset claims every one you have enough for: without that,
 * late runs were a staircase of one Overdrive, rebuild from 10 Flux, the next one.
 * Each unlock-phase Overdrive needs a different (newly unlocked) Engine, so those come one at a time.
 */
export function overdrivesAvailable(limit = Infinity): number {
  const { tier, amount } = overdriveRequirement();
  const have = state.engines[tier].amount;
  if (limit < 1 || have.lt(amount)) return 0;
  if (state.overdrives < UNLOCK_PHASE) return 1;
  const extra = Math.floor(have.sub(amount).div(REQUIREMENT_STEP).toNumber());
  return Math.min(limit, 1 + extra);
}

/** Requirement of the Overdrive after the ones you could claim now ("one more at …"). */
export const nextOverdriveRequirement = () => requirementAt(state.overdrives + overdrivesAvailable());

export const canOverdrive = () => overdrivesAvailable() > 0;

/** Claims every Overdrive your Engines cover (up to `limit`), with one reset. */
export function doOverdrive(limit = Infinity): boolean {
  const count = overdrivesAvailable(limit);
  if (count < 1) return false;
  state.overdrives += count;
  state.stats.overdrives += count;
  resetForOverdrive();
  emit("overdrive");
  return true;
}

export const overdriveFactor = () => (shardUpgrades.has("resonance") ? 2.25 : 2);
export const overdriveMult = () => D(overdriveFactor()).pow(state.overdrives);
