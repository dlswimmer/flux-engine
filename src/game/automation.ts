import { ENGINE_COUNT, state } from "../core/state";
import { canCollapse, doCollapse, exactShardGain, isBreached, shardGain, shardUpgrades } from "./collapse";
import { hasNode } from "./rift";
import { buyEngine, buyMaxEngine } from "./engines";
import { ENGINE_AUTOBUYER_IDS, TEMPO_AUTOBUYER_ID } from "./automationIds";
import { canLattice, doLattice, latticeResetsNothing } from "./lattice";
import { UNLOCK_PHASE, canOverdrive, doOverdrive, overdriveResetsNothing } from "./overdrive";
import { SPRINT_HEAD_START, hasTrialReward } from "./trials";
import { buyMaxTempo, buyTempo } from "./tempo";

/** Each Engine and Tempo has its own autobuyer unlock. */
export const hasEngineAutobuyer = (tier: number) => shardUpgrades.has(ENGINE_AUTOBUYER_IDS[tier]);
export const hasTempoAutobuyer = () => shardUpgrades.has(TEMPO_AUTOBUYER_ID);
/** At least one Engine or Tempo autobuyer. */
export const hasEngineAutobuyers = () => hasEngineAutobuyer(0);
/** Bulk Buying: autobuyers buy max; without it, one purchase per activation. */
export const hasBulkBuying = () => shardUpgrades.has("bulk");
/**
 * The Engines tab treats a row as automated (hides its buy buttons) only once the autobuyer
 * buys max: before Bulk Buying it buys one at a time and the player still wants the buttons.
 */
export const isEngineAutomated = (tier: number) =>
  hasEngineAutobuyer(tier) && hasBulkBuying() && state.automation.engines[tier];
export const isTempoAutomated = () => hasTempoAutobuyer() && hasBulkBuying() && state.automation.tempo;
export const hasOverdriveAutobuyer = () => shardUpgrades.has("automators2");
export const hasLatticeAutobuyer = () => shardUpgrades.has("autolattice");
export const hasResetAutobuyers = () => hasOverdriveAutobuyer() || hasLatticeAutobuyer();
export const hasAutoCollapse = () => shardUpgrades.has("selfcollapse");

// Autobuyers are balanced against a player holding M, which is 2–3× faster than
// acting once a second (`npm run playtest -- automation`). They start slower than
// that and speed up every Collapse, so automation is its own progression: by the
// late Collapse layer they beat holding M and the run is about decisions, not keys.
const BASE_INTERVAL = 3;
const SPEEDUP_PER_COLLAPSE = 0.9;
/** One game tick: autobuyers can't act more often than the game updates. */
export const MIN_INTERVAL = 0.05;

/** Seconds between autobuyer activations. */
export function autobuyInterval(): number {
  // Collapses this Rift, so a Rift restarts the ramp. With lifetime Collapses, kept automation
  // alone made the first Collapse after a Rift ~55% of the very first one, before any Rift node.
  // Sprint (Trial reward) starts the ramp as if you had more Collapses.
  const collapses = state.collapse.count + (hasTrialReward("sprint") ? SPRINT_HEAD_START : 0);
  let interval = BASE_INTERVAL * SPEEDUP_PER_COLLAPSE ** collapses;
  if (shardUpgrades.has("overclock")) interval /= 3;
  if (hasNode("self-winding")) interval /= 2;
  return Math.max(MIN_INTERVAL, interval);
}

/** Interval after one more Collapse, for the "faster next Collapse" hint. */
export const nextAutobuyInterval = () =>
  Math.max(MIN_INTERVAL, autobuyInterval() * SPEEDUP_PER_COLLAPSE);

/**
 * Auto Overdrive/Lattice wait once you can Collapse (a setting, on by default). After Breach
 * runs hit the Horizon in ~2s, and a reset after that restarts the run from 10 Flux: with it
 * off, Shard income at Overcharge 15 fell from ~650/min to ~230/min. It's a visible switch
 * because a silent pause looked like the autobuyers had stopped working.
 */
export const areResetsPaused = () => state.automation.pauseResetsAtHorizon && canCollapse();

// ---------- Auto-Collapse ----------
// With a Shard target set, Collapse once the next Collapse is worth that much. Without one,
// Collapse when this run's Shards per second has peaked. "As soon as you reach the Horizon"
// was the old blank setting, and after Breach it earned 2-4× less than good timing: it
// cashed in before the Surge and depth bonuses built up.

let bestRate = 0;
let rateRun = "";

function autoCollapseReady(): boolean {
  const auto = state.automation;
  if (!hasAutoCollapse() || !auto.collapse || !canCollapse()) return false;
  if (auto.collapseShards > 0) return shardGain().gte(auto.collapseShards);
  if (!isBreached()) return true; // gain is fixed before Breach: no reason to wait
  const run = `${state.rift.count}:${state.collapse.count}`;
  if (run !== rateRun) {
    rateRun = run;
    bestRate = 0;
  }
  // Unrounded gain: see exactShardGain. Peak-based like shardGain, so a Surge ending can't fake a drop.
  const rate = exactShardGain().max(state.collapse.peakShards).toNumber() / Math.max(state.collapse.time, 0.05);
  if (rate >= bestRate) {
    bestRate = rate;
    return false;
  }
  return rate < bestRate * 0.97;
}

/** The run has lasted at least this long since its last reset. */
const waited = (seconds: number) => state.sinceReset + 1e-9 >= seconds;

/**
 * The wait only applies once Overdrives need Engine VIII and can come several at a time:
 * each unlock-phase one needs a different Engine, so waiting there would only lose time.
 */
const overdriveWaitDone = () => state.overdrives < UNLOCK_PHASE || waited(state.automation.overdriveWait);

let timer = 0;

export function runAutomation(dt: number) {
  // Every tick, not on the autobuyer timer: after Breach a run lasts ~2s, so reacting a
  // second late (the timer right after a Rift) wastes half of it.
  if (autoCollapseReady()) {
    doCollapse();
    return;
  }
  timer += dt;
  const interval = autobuyInterval();
  if (timer + 1e-9 < interval) return;
  // Keep the remainder so the average rate is right, but never bank more than one extra activation.
  timer = Math.min(timer - interval, interval);
  const auto = state.automation;
  const bulk = hasBulkBuying();
  // Tempo first, like Max All: it boosts every tier.
  if (auto.tempo && hasTempoAutobuyer()) bulk ? buyMaxTempo() : buyTempo();
  for (let tier = ENGINE_COUNT - 1; tier >= 0; tier--) {
    if (auto.engines[tier] && hasEngineAutobuyer(tier)) bulk ? buyMaxEngine(tier) : buyEngine(tier);
  }
  if (hasResetAutobuyers()) runResetAutobuyers();
}

function runResetAutobuyers() {
  const auto = state.automation;
  // Claims that reset nothing (Trial rewards) are always worth it: no Stop-at, wait or pause.
  const lattice = auto.lattice && hasLatticeAutobuyer();
  const overdrive = auto.overdrive && hasOverdriveAutobuyer();
  if (lattice && latticeResetsNothing() && canLattice()) doLattice();
  if (overdrive && overdriveResetsNothing() && canOverdrive()) doOverdrive();
  if (areResetsPaused()) return;
  // Each claims as many as the Engines cover, up to the Stop-at limit. A Lattice that is
  // only waiting out its timer holds Overdrives back: one would reset the Engine VIII it needs.
  const latticeWanted =
    lattice && !latticeResetsNothing() && state.lattices < auto.latticeMax && canLattice();
  if (latticeWanted) {
    if (waited(auto.latticeWait)) doLattice(auto.latticeMax - state.lattices);
  } else if (
    overdrive &&
    !overdriveResetsNothing() &&
    state.overdrives < auto.overdriveMax &&
    canOverdrive() &&
    overdriveWaitDone()
  )
    doOverdrive(auto.overdriveMax - state.overdrives);
}
