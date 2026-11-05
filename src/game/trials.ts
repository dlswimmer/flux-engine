import { emit } from "../core/events";
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

/** Seconds Sprint allows to reach the Horizon before the run restarts. */
export const SPRINT_LIMIT = 30;
/** Fixed Tempo: the most Tempo levels you can buy. 75: out of reach until about Breach (100 was
 *  possible right after Foreman; 50 never, through Rift 3). */
export const FIXED_TEMPO_CAP = 75;
/** Hollow Core's Tempo cap. 150: out of reach until about Rift 3; at 100 no tested save could do it. */
export const HOLLOW_TEMPO_CAP = 150;
/**
 * Overload / Hollow Core rewards cover the Overdrives and Lattices a well-played run reaches
 * anyway: they remove the reset time, not the ceiling. Unlimited free claims took Flux depth past
 * the Horizon out of control (Rift 3 to Rift 5 in 2½ minutes, against 25).
 */
export const FREE_OVERDRIVES_UP_TO = 10;
export const FREE_LATTICES = 3;
/** Sprint's reward: autobuyers act as if you had this many more Collapses this Rift. */
export const SPRINT_HEAD_START = 10;

export const TRIALS: TrialDef[] = [
  {
    id: "overload",
    name: "Overload",
    rule: "No Overdrives past the 4th.",
    reward: `Overdrives 5 to ${FREE_OVERDRIVES_UP_TO} reset nothing.`,
  },
  {
    id: "rigid",
    name: "Rigid Frame",
    rule: "No Lattices.",
    reward: "Lattices keep all your Overdrives.",
  },
  {
    id: "cold",
    name: "Cold Running",
    rule: "Heat can't be vented.",
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
    rule: `Reach the Horizon within ${SPRINT_LIMIT}s, or the run restarts.`,
    reward: `Autobuyers start every Rift as if you had ${SPRINT_HEAD_START} Collapses.`,
  },
  {
    id: "hollow",
    name: "Hollow Core",
    rule: `Overdrives give no multiplier (they still unlock Engines) and Tempo stops at level ${HOLLOW_TEMPO_CAP}.`,
    reward: `Your first ${FREE_LATTICES} Lattices each Collapse reset nothing.`,
    // Only its two parents: Sprint fits a window before the first Rift, and missing it
    // shouldn't lock this one away.
    requires: ["overload", "rigid"],
  },
];

/** Lifetime Collapses that open the Trials. */
export const TRIALS_UNLOCK = 15;

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
  else resetForCollapse();
  state.trials.active = id;
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
  if (inTrial("sprint") && !canCollapse() && state.collapse.time >= SPRINT_LIMIT) {
    resetForCollapse();
    state.trials.sprintRestarts++;
  }
}
