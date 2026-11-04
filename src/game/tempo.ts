import { D, Decimal } from "../lib/decimal";
import { state } from "../core/state";
import { shardUpgrades } from "./collapse";
import { latticeTempoBonus } from "./lattice";

const BASE_COST = 1e3;
const COST_GROWTH = 8;
const BASE_FACTOR = 1.1;

/** Tempo unlocks once the player owns their first Engine II. */
export const isTempoUnlocked = () =>
  state.engines[1].bought > 0 || state.overdrives > 0 || state.lattices > 0 || state.collapse.count > 0;

/** Multiplier each Tempo level applies to all engines. */
export function tempoFactor(): Decimal {
  let factor = BASE_FACTOR + latticeTempoBonus();
  if (shardUpgrades.has("tuning")) factor += 0.01;
  return D(factor);
}

export const tempoMult = () => tempoFactor().pow(state.tempo);

export const tempoCost = () => D(BASE_COST).mul(D(COST_GROWTH).pow(state.tempo));

export const canBuyTempo = () => isTempoUnlocked() && state.flux.gte(tempoCost());

export function buyTempo(): boolean {
  if (!canBuyTempo()) return false;
  state.flux = state.flux.sub(tempoCost());
  state.tempo++;
  return true;
}

export function buyMaxTempo(): number {
  if (!isTempoUnlocked()) return 0;
  const count = Decimal.affordGeometricSeries(state.flux, BASE_COST, COST_GROWTH, state.tempo)
    .floor()
    .toNumber();
  if (!(count > 0) || !Number.isFinite(count)) return 0;
  state.flux = state.flux
    .sub(Decimal.sumGeometricSeries(count, BASE_COST, COST_GROWTH, state.tempo))
    .max(0);
  state.tempo += count;
  return count;
}
