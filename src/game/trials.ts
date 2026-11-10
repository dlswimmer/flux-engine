import { emit } from "../core/events";
import { formatTime } from "../core/format";
import { state } from "../core/state";
import { canCollapse, doCollapse, totalCollapses } from "./collapse";
import { resetForCollapse } from "./reset";

// Collapse Trials: replay a Collapse under a rule; reach the Horizon and Collapse to win a
// permanent reward. Rewards are never reset (not even by a Rift) and are not needed to reach
// the Rift: they fix things that get slow late, mainly the Overdrive/Lattice reset staircase.
// Tuned with `npm run report -- trials`.

export type TrialId = "overload" | "rigid" | "cold" | "fixed" | "sprint" | "hollow";

export interface TrialDef {
  id: TrialId;
  name: string;
  rule: string;
  reward: string;
  /** Other Trials that must be won first. */
  requires?: TrialId[];
}

/*
 * Tuned with `npm run report -- trials` as an escalating set (1s bot, each Trial with the earlier
 * ones won): Rigid ~10 min, Overload ~12, Cold ~17, Fixed ~15 before the first Rift; Sprint and
 * Hollow Core out of reach until after Rift 2 (then ~3-6 and ~40 min).
 */

/** Seconds Sprint allows to reach the Horizon before the run restarts. */
export const SPRINT_LIMIT = 180;
/** Fixed Tempo: the most Tempo levels you can buy (150: never by Rift 3; 185: ~7 min). */
export const FIXED_TEMPO_CAP = 170;
/** Hollow Core's Tempo cap (200: never by Rift 3). */
export const HOLLOW_TEMPO_CAP = 300;
/** Cold Running: overheating slows every Engine, down to this. */
export const COLD_THROTTLE_FLOOR = 0.6;
/** Overload: the most Overdrives allowed. Rigid Frame: the most Lattices. */
export const OVERLOAD_MAX_OVERDRIVES = 6;
/** 0 (no Lattices) was impossible even after Rift 3. */
export const RIGID_MAX_LATTICES: number = 1;
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
        : `No more than ${RIGID_MAX_LATTICES} Lattice${RIGID_MAX_LATTICES === 1 ? "" : "s"}.`,
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
    id: "fixed",
    name: "Fixed Tempo",
    rule: `Tempo stops at level ${FIXED_TEMPO_CAP}.`,
    reward: "Tempo costs ×7 per level instead of ×8.",
  },
  {
    id: "sprint",
    name: "Sprint",
    rule: `Reach the Horizon within ${formatTime(SPRINT_LIMIT)}, or the run restarts.`,
    reward: `Autobuyers start every Rift as if you had ${SPRINT_HEAD_START} Collapses.`,
  },
  {
    id: "hollow",
    name: "Hollow Core",
    rule: `Overdrives give no multiplier (they still unlock Engines) and Tempo stops at level ${HOLLOW_TEMPO_CAP}.`,
    reward: `Your first ${FREE_LATTICES} Lattices each Collapse reset nothing.`,
    requires: ["overload", "rigid"],
  },
];

/** Shard upgrades that still work during a Trial (the rest, and Overcharge, are off). */
export const TRIAL_KEEPS = ["automators", "automators2", "selfcollapse", "overclock", "thermostat"];

/** Lifetime Collapses that open the Trials. */
export const TRIALS_UNLOCK = 15;

export const isTrialsUnlocked = () => totalCollapses() >= TRIALS_UNLOCK || state.trials.completed.length > 0;
export const activeTrial = () => state.trials.active as TrialId | null;
/** The Collapse Trial you started (not one a Rift Trial stacks: see ruleActive). */
export const inTrial = (id: TrialId) => state.trials.active === id;
/** Is this Trial's rule in force: its own Collapse Trial, or a Rift Trial that stacks it. */
export const ruleActive = (id: TrialId) =>
  state.trials.active === id || (activeRiftTrial() !== null && riftTrialDef(activeRiftTrial()!).rules.includes(id));
export const hasTrialReward = (id: TrialId) => state.trials.completed.includes(id);
export const trialDef = (id: TrialId) => TRIALS.find((t) => t.id === id)!;

export const isTrialAvailable = (id: TrialId) =>
  isTrialsUnlocked() && (trialDef(id).requires ?? []).every(hasTrialReward) && activeRiftTrial() === null;

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
  return true;
}

/** Give up: the run restarts with no Trial. */
export function abandonTrial() {
  if (!state.trials.active) return;
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
  emit("trial");
}

/** Every tick: Sprint restarts the run once its time is up. */
export function updateTrials() {
  if (ruleActive("sprint") && !canCollapse() && state.collapse.time >= SPRINT_LIMIT) {
    resetForCollapse();
    state.trials.sprintRestarts++;
  }
}

// ---------- Rift Trials ----------
// A whole Rift from scratch (only the automation milestone holds) under several Collapse Trial
// rules at once, in every Collapse of it. Unlike a Collapse Trial, Shard upgrades and Overcharge
// work (the Rift needs Overcharge). Rift to win; wins are permanent. Start/win/give up live in
// rift.ts. Tuned with `npm run report -- rifttrials`: ~8 min, ~30 min, ~1h15m, ~2h after Rift 4.

export type RiftTrialId = "faultline" | "whiteout" | "deadcalm" | "singularity";

export interface RiftTrialDef {
  id: RiftTrialId;
  name: string;
  /** Collapse Trial rules in force all Rift. Each must be won as a Collapse Trial first. */
  rules: TrialId[];
  reward: string;
  /** Other Rift Trials that must be won first. */
  requires?: RiftTrialId[];
}

/** Rifts needed before Rift Trials open (Sprint and Hollow Core are out of reach before Rift 2). */
export const RIFT_TRIALS_UNLOCK = 3;
/** Fault Line: Overcharge cost growth per level (×1.35 normally). */
export const FAULTLINE_OVERCHARGE_GROWTH = 1.3;
/** Whiteout: Shard gain multiplier. */
export const WHITEOUT_SHARDS = 2;
/** Dead Calm: Overcharge needed to Rift (24 normally). */
export const DEADCALM_RIFT_OVERCHARGE = 22;
/** Singularity: Overcharge levels every Rift starts with. */
export const SINGULARITY_OVERCHARGE = 6;

export const RIFT_TRIALS: RiftTrialDef[] = [
  {
    id: "faultline",
    name: "Fault Line",
    rules: ["rigid", "overload", "sprint"],
    reward: `Overcharge costs ×${FAULTLINE_OVERCHARGE_GROWTH} per level instead of ×1.35.`,
  },
  {
    id: "whiteout",
    name: "Whiteout",
    rules: ["cold", "fixed", "rigid"],
    reward: `Gain ${WHITEOUT_SHARDS}× Shards.`,
  },
  {
    id: "deadcalm",
    name: "Dead Calm",
    rules: ["fixed", "hollow"],
    reward: `Rifts need Overcharge ${DEADCALM_RIFT_OVERCHARGE} instead of 24 (Essence counts up from there).`,
  },
  {
    id: "singularity",
    name: "Singularity",
    rules: ["rigid", "overload", "cold", "hollow"],
    reward: `Start every Rift with Overcharge ${SINGULARITY_OVERCHARGE}.`,
    requires: ["faultline", "whiteout", "deadcalm"],
  },
];

export const riftTrialDef = (id: RiftTrialId) => RIFT_TRIALS.find((t) => t.id === id)!;
export const activeRiftTrial = () => state.riftTrials.active as RiftTrialId | null;
export const hasRiftTrialReward = (id: RiftTrialId) => state.riftTrials.completed.includes(id);
export const isRiftTrialsUnlocked = () =>
  state.rift.count >= RIFT_TRIALS_UNLOCK || state.riftTrials.completed.length > 0;
/** Rules that must still be won as Collapse Trials, and Rift Trials still to win, before this one opens. */
export const riftTrialMissing = (id: RiftTrialId): string[] => {
  const def = riftTrialDef(id);
  return [
    ...def.rules.filter((r) => !hasTrialReward(r)).map((r) => trialDef(r).name),
    ...(def.requires ?? []).filter((r) => !hasRiftTrialReward(r)).map((r) => riftTrialDef(r).name),
  ];
};
export const isRiftTrialAvailable = (id: RiftTrialId) => isRiftTrialsUnlocked() && riftTrialMissing(id).length === 0;
/** Every rule in force right now, for display. */
export const activeRules = (): TrialId[] => {
  const rift = activeRiftTrial();
  if (rift) return riftTrialDef(rift).rules;
  const collapse = activeTrial();
  return collapse ? [collapse] : [];
};
