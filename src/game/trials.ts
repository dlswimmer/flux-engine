import { AUTOMATION_UPGRADES } from "./automationIds";
import { emit } from "../core/events";
import { formatTime } from "../core/format";
import { state } from "../core/state";
import { canCollapse, doCollapse, totalCollapses } from "./collapse";
import { resetForCollapse } from "./reset";

// Collapse Trials: replay a Collapse under a rule; reach the Horizon and Collapse to win a
// permanent reward. Rewards are never reset (not even by a Rift) and are not needed to reach
// the Rift: they fix things that get slow late, mainly the Overdrive/Lattice reset staircase.
// Tuned with `npm run report -- trials`.

export type TrialId = "overload" | "rigid" | "cold" | "valve" | "sprint" | "surge";

export interface TrialDef {
  id: TrialId;
  name: string;
  rule: string;
  reward: string;
  /** Other Trials that must be won first. */
  requires?: TrialId[];
}

/*
 * Tuned with `npm run report -- trials` (1s bot, each Trial with the earlier ones won), at the
 * Foreman point: Rigid ~25 min, Overload ~12, Cold ~26, Pressure Valve ~17, Surge Engine ~18;
 * Sprint out of reach until after Rift 2. Pressure Valve and Surge Engine (2026-11-11) replaced
 * Fixed Tempo and Hollow Core, which only made you wait: these two make you play differently.
 */

/** Seconds Sprint allows to reach the Horizon before the run restarts. */
export const SPRINT_LIMIT = 180;
/**
 * Pressure Valve: Heat comes from buying, not time. Each Engine or Tempo level bought adds this
 * much, and 100 melts the run down. Autobuyers left on will melt you, so you buy in batches,
 * vent before the top, and spend Heat on the tiers worth it.
 */
export const VALVE_HEAT_PER_BUY = 0.5;
/**
 * Surge Engine: outside a Surge, Engines run at this fraction. Surges last half as long, and an
 * Overdrive or Lattice ends the Surge, so reset autobuyers left on throw your Surges away.
 */
// Barely moves the time (10% / 3% / 0% all ~13-14 min after Rift 2): Surges carry the run.
export const SURGE_ENGINE_IDLE = 0.05;
export const SURGE_ENGINE_DURATION = 0.5;
/** Cold Running: overheating slows every Engine, down to this. */
export const COLD_THROTTLE_FLOOR = 0.6;
/** Overload: the most Overdrives allowed. Rigid Frame: the most Lattices. */
export const OVERLOAD_MAX_OVERDRIVES = 6;
/** 0 (no Lattices) was impossible even after Rift 3. */
export const RIGID_MAX_LATTICES: number = 1;
/** Rigid Frame: Lattices need this many times the Engine VIII (sim: ~15 min longer, Breach ~4h20m). */
export const RIGID_LATTICE_COST = 2;
/**
 * Overload / Hollow Core rewards cover the Overdrives and Lattices a well-played run reaches
 * anyway: they remove the reset time, not the ceiling. Unlimited free claims took Flux depth past
 * the Horizon out of control (Rift 3 to Rift 5 in 2½ minutes, against 25).
 */
export const FREE_OVERDRIVES_UP_TO = 10;
export const FREE_LATTICES = 3;
/** Sprint's reward: autobuyers act as if you had this many more Collapses this Rift. */
export const SPRINT_HEAD_START = 10;

// In difficulty order; each assumes you've won the ones before it.
export const TRIALS: TrialDef[] = [
  {
    id: "rigid",
    name: "Rigid Frame",
    rule:
      RIGID_MAX_LATTICES === 0
        ? "No Lattices."
        : `No more than ${RIGID_MAX_LATTICES} Lattice${RIGID_MAX_LATTICES === 1 ? "" : "s"}, and ${RIGID_LATTICE_COST}× the Engine VIII to claim it.`,
    reward: "Lattices keep all your Overdrives.",
  },
  {
    id: "overload",
    name: "Overload",
    rule: `No more than ${OVERLOAD_MAX_OVERDRIVES} Overdrives.`,
    reward: `Overdrives 5 to ${FREE_OVERDRIVES_UP_TO} reset nothing.`,
  },
  {
    id: "cold",
    name: "Cold Running",
    rule: `Heat builds 3× faster, can't be vented, and overheating slows every Engine (down to ×${COLD_THROTTLE_FLOOR}), not just Engine I.`,
    reward: "Surges last 50% longer.",
  },
  {
    id: "valve",
    name: "Pressure Valve",
    rule: `Heat doesn't build over time: every Engine or Tempo level you buy adds ${VALVE_HEAT_PER_BUY} Heat. At 100 Heat the run melts down and starts over.`,
    reward: "Tempo costs ×7 per level instead of ×8.",
  },
  {
    id: "sprint",
    name: "Sprint",
    rule: `Reach the Horizon within ${formatTime(SPRINT_LIMIT)}, or the run restarts.`,
    reward: `Autobuyers start every Rift as if you had ${SPRINT_HEAD_START} Collapses.`,
  },
  {
    id: "surge",
    name: "Surge Engine",
    rule: `Outside a Surge, Engines run at ${Math.round(SURGE_ENGINE_IDLE * 100)}%. Surges last half as long, and an Overdrive or Lattice ends the Surge.`,
    reward: `Your first ${FREE_LATTICES} Lattices each Collapse reset nothing.`,
    // Not much slower than the others (~20 min at Collapse 15), but its reward is strong: keep it after the Breach set.
    requires: ["rigid", "overload", "cold", "valve"],
  },
];

/** Shard upgrades that still work during a Trial (the rest, and Overcharge, are off). */
export const TRIAL_KEEPS = AUTOMATION_UPGRADES;

/** Trials you must win before Breach can be bought (like AD's challenges before Break Infinity). */
export const BREACH_TRIALS: TrialId[] = ["rigid", "overload", "cold", "valve"];

/** Lifetime Collapses that open the Trials. */
export const TRIALS_UNLOCK = 60;

export const isTrialsUnlocked = () => totalCollapses() >= TRIALS_UNLOCK || state.trials.completed.length > 0;
export const activeTrial = () => state.trials.active as TrialId | null;
export const inTrial = (id: TrialId) => state.trials.active === id;
export const hasTrialReward = (id: TrialId) => state.trials.completed.includes(id);
export const trialDef = (id: TrialId) => TRIALS.find((t) => t.id === id)!;

export const isTrialAvailable = (id: TrialId) =>
  isTrialsUnlocked() && (trialDef(id).requires ?? []).every(hasTrialReward);

/**
 * Start a Trial. If this run can already Collapse, that Collapse happens first (you keep its
 * Shards); otherwise the run restarts. Either way the Trial begins from a fresh Collapse.
 */
export function startTrial(id: TrialId): boolean {
  if (!isTrialAvailable(id) || state.trials.active) return false;
  if (canCollapse()) doCollapse();
  // Reset after the Trial starts, so the run begins without the switched-off upgrades (Ignition).
  state.trials.active = id;
  resetForCollapse();
  emit("trialStart", id);
  return true;
}

/** Give up: the run restarts with no Trial. */
export function abandonTrial() {
  if (!state.trials.active) return;
  emit("trialAbandon", state.trials.active);
  state.trials.active = null;
  resetForCollapse();
}

/** Called by doCollapse before it resets: a Collapse inside a Trial wins it. */
export function completeActiveTrial() {
  const id = activeTrial();
  if (!id) return;
  if (!state.trials.completed.includes(id)) state.trials.completed = [...state.trials.completed, id];
  const best = state.trials.best[id];
  state.trials.best = { ...state.trials.best, [id]: Math.min(best ?? Infinity, state.collapse.time) };
  state.trials.active = null;
  emit("trial", id);
}

/** Pressure Valve: Heat from buying `count` Engines or Tempo levels. */
export function purchaseHeat(count: number) {
  if (count > 0 && inTrial("valve")) state.heat.amount += count * VALVE_HEAT_PER_BUY;
}

/** Every tick: Sprint restarts the run once its time is up; Pressure Valve melts down at 100 Heat. */
export function updateTrials() {
  if (inTrial("valve") && state.heat.amount >= 100) {
    resetForCollapse();
    state.heat.amount = 0;
    state.heat.surgeTime = 0;
    state.trials.meltdowns++;
    emit("meltdown");
  }
  if (inTrial("sprint") && !canCollapse() && state.collapse.time >= SPRINT_LIMIT) {
    resetForCollapse();
    state.trials.sprintRestarts++;
  }
}
