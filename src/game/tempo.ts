import { D, Decimal } from "../lib/decimal";
import { state } from "../core/state";
import { shardUpgrades, totalCollapses } from "./collapse";
import { latticeTempoBonus } from "./lattice";
import { FIXED_TEMPO_CAP, HOLLOW_TEMPO_CAP, hasTrialReward, inTrial } from "./trials";

const BASE_COST = 1e3;
const COST_GROWTH = 8;
/** Fixed Tempo (Trial reward). Past the Horizon the ×4096 scaling still applies. */
const REWARD_COST_GROWTH = 7;
const costGrowth = () => (hasTrialReward("fixed") ? REWARD_COST_GROWTH : COST_GROWTH);
const BASE_FACTOR = 1.1;

/**
 * Past the Horizon each Tempo level costs ×4096 instead of ×8. A level boosts all 8 Engine
 * tiers, so once Lattices push the factor to ~1.35 a level compounds to more growth than its
 * ×8 price and Tempo pays for itself forever: after Breach, 6 Lattices took Flux to
 * e(2.6 trillion) in a minute. At ×4096 no realistic factor can outrun its cost.
 */
const SCALED_COST_GROWTH = 4096;
/** First level whose price is past the Horizon (1e3 × 8^219 ≈ 6e200). */
const SCALING_START = 219;
const SCALED_BASE = D(BASE_COST).mul(D(COST_GROWTH).pow(SCALING_START));

/** Tempo unlocks once the player owns their first Engine II. */
export const isTempoUnlocked = () =>
  state.engines[1].bought > 0 || state.overdrives > 0 || state.lattices > 0 || totalCollapses() > 0;

/** Multiplier each Tempo level applies to all engines. */
export function tempoFactor(): Decimal {
  let factor = BASE_FACTOR + latticeTempoBonus();
  if (shardUpgrades.has("tuning")) factor += 0.01;
  return D(factor);
}

export const tempoMult = () => tempoFactor().pow(state.tempo);

export const tempoCost = () =>
  state.tempo < SCALING_START
    ? D(BASE_COST).mul(D(costGrowth()).pow(state.tempo))
    : SCALED_BASE.mul(D(SCALED_COST_GROWTH).pow(state.tempo - SCALING_START));

/** Fixed Tempo and Hollow Core (Trials) cap the level. */
const tempoCap = () => (inTrial("fixed") ? FIXED_TEMPO_CAP : inTrial("hollow") ? HOLLOW_TEMPO_CAP : Infinity);

export const canBuyTempo = () => isTempoUnlocked() && state.tempo < tempoCap() && state.flux.gte(tempoCost());

export function buyTempo(): boolean {
  if (!canBuyTempo()) return false;
  state.flux = state.flux.sub(tempoCost());
  state.tempo++;
  return true;
}

/** Buy as many levels as Flux allows from one geometric price segment, up to `limit`. */
function buySegment(base: Decimal, growth: number, offset: number, limit: number): number {
  const affordable = Decimal.affordGeometricSeries(state.flux, base, growth, offset).floor().toNumber();
  const count = Math.min(affordable, limit);
  if (!(count > 0) || !Number.isFinite(count)) return 0;
  state.flux = state.flux.sub(Decimal.sumGeometricSeries(count, base, growth, offset)).max(0);
  state.tempo += count;
  return count;
}

export function buyMaxTempo(): number {
  if (!isTempoUnlocked()) return 0;
  const cap = tempoCap();
  let bought = 0;
  if (state.tempo < SCALING_START)
    bought += buySegment(D(BASE_COST), costGrowth(), state.tempo, Math.min(SCALING_START, cap) - state.tempo);
  if (state.tempo >= SCALING_START)
    bought += buySegment(SCALED_BASE, SCALED_COST_GROWTH, state.tempo - SCALING_START, cap - state.tempo);
  return bought;
}
