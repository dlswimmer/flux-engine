import { ENGINE_COUNT, state } from "../core/state";
import { shardUpgrades } from "./collapse";
import { buyMaxEngine } from "./engines";
import { canLattice, doLattice } from "./lattice";
import { canOverdrive, doOverdrive } from "./overdrive";
import { buyMaxTempo } from "./tempo";

export const hasEngineAutobuyers = () => shardUpgrades.has("automators");
export const hasResetAutobuyers = () => shardUpgrades.has("automators2");

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
  let interval = BASE_INTERVAL * SPEEDUP_PER_COLLAPSE ** state.collapse.count;
  if (shardUpgrades.has("overclock")) interval /= 3;
  return Math.max(MIN_INTERVAL, interval);
}

/** Interval after one more Collapse, for the "faster next Collapse" hint. */
export const nextAutobuyInterval = () =>
  Math.max(MIN_INTERVAL, autobuyInterval() * SPEEDUP_PER_COLLAPSE);

let timer = 0;

export function runAutomation(dt: number) {
  timer += dt;
  const interval = autobuyInterval();
  if (timer + 1e-9 < interval) return;
  // Keep the remainder so the average rate is right, but never bank more than one extra activation.
  timer = Math.min(timer - interval, interval);
  const auto = state.automation;
  if (hasEngineAutobuyers()) {
    // Tempo first, like Max All: it boosts every tier.
    if (auto.tempo) buyMaxTempo();
    for (let tier = ENGINE_COUNT - 1; tier >= 0; tier--) {
      if (auto.engines[tier]) buyMaxEngine(tier);
    }
  }
  if (hasResetAutobuyers()) {
    if (auto.lattice && canLattice()) doLattice();
    else if (auto.overdrive && canOverdrive()) doOverdrive();
  }
}
