import { D, Decimal } from "../lib/decimal";
import { ENGINE_COUNT, state } from "../core/state";
import { collapseEngineMult, shardUpgrades } from "./collapse";
import { addFlux } from "./flux";
import { fluxThrottle, surgeMult } from "./heat";
import { overdriveMult } from "./overdrive";
import { buyMaxTempo, tempoMult } from "./tempo";

export const ENGINE_NAMES = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

const BASE_COST = [10, 30, 400, 1e4, 1e9, 1e13, 1e17, 1e23];
/**
 * Cost multiplier per MILESTONE_SIZE purchases. Must stay steep relative to
 * MILESTONE_MULT: if log(MILESTONE_MULT)/log(COST_PER_MILESTONE) gets big, one
 * tier snowballs on its own and skipping resets becomes the fastest route.
 * `npm run sim` checks for exactly that.
 */
const COST_PER_MILESTONE = [1.5e3, 1e4, 8e4, 6e5, 1e8, 1e10, 2e12, 1e15];

/** Every MILESTONE_SIZE purchases of an engine multiplies its output. */
export const MILESTONE_SIZE = 10;
const MILESTONE_MULT = 2;

/** Units each Engine makes per second before multipliers. A global pacing dial: ×N here ≈ N× faster runs. */
const BASE_RATE = 2;

/** Engines unlocked from the start; each Overdrive unlocks one more. */
const STARTING_ENGINES = 4;

/** Per-purchase cost multiplier. */
export function costGrowth(tier: number): Decimal {
  let exponent = 1 / MILESTONE_SIZE;
  if (shardUpgrades.has("gearing")) exponent *= 0.9;
  return D(COST_PER_MILESTONE[tier]).pow(exponent);
}

export const engineCost = (tier: number): Decimal =>
  D(BASE_COST[tier]).mul(costGrowth(tier).pow(state.engines[tier].bought));

export const unlockedEngines = () => Math.min(ENGINE_COUNT, STARTING_ENGINES + state.overdrives);
export const isEngineUnlocked = (tier: number) => tier < unlockedEngines();

export const canBuyEngine = (tier: number) =>
  isEngineUnlocked(tier) && state.flux.gte(engineCost(tier));

export function buyEngine(tier: number): boolean {
  if (!canBuyEngine(tier)) return false;
  const engine = state.engines[tier];
  state.flux = state.flux.sub(engineCost(tier));
  engine.amount = engine.amount.add(1);
  engine.bought++;
  return true;
}

/** Purchases left until this Engine's next ×2 milestone. */
export const toNextMilestone = (tier: number) => MILESTONE_SIZE - (state.engines[tier].bought % MILESTONE_SIZE);

export const costToNextMilestone = (tier: number): Decimal =>
  Decimal.sumGeometricSeries(toNextMilestone(tier), BASE_COST[tier], costGrowth(tier), state.engines[tier].bought);

export const canBuyToNextMilestone = (tier: number) =>
  isEngineUnlocked(tier) && state.flux.gte(costToNextMilestone(tier));

/** Buy exactly up to the next milestone, all at once, or nothing. */
export function buyToNextMilestone(tier: number): boolean {
  if (!canBuyToNextMilestone(tier)) return false;
  const engine = state.engines[tier];
  const count = toNextMilestone(tier);
  state.flux = state.flux.sub(costToNextMilestone(tier)).max(0);
  engine.amount = engine.amount.add(count);
  engine.bought += count;
  return true;
}

export function buyMaxEngine(tier: number): number {
  if (!isEngineUnlocked(tier)) return 0;
  const engine = state.engines[tier];
  const growth = costGrowth(tier);
  const count = Decimal.affordGeometricSeries(state.flux, BASE_COST[tier], growth, engine.bought)
    .floor()
    .toNumber();
  if (!(count > 0) || !Number.isFinite(count)) return 0;
  const cost = Decimal.sumGeometricSeries(count, BASE_COST[tier], growth, engine.bought);
  state.flux = state.flux.sub(cost).max(0);
  engine.amount = engine.amount.add(count);
  engine.bought += count;
  return count;
}

/**
 * Tempo first (it boosts every tier, and engines would otherwise starve it), then
 * engines from the highest tier down so cheap ones don't eat the budget.
 */
export function maxAll() {
  buyMaxTempo();
  for (let tier = ENGINE_COUNT - 1; tier >= 0; tier--) buyMaxEngine(tier);
}

export function engineMult(tier: number): Decimal {
  const engine = state.engines[tier];
  let mult = D(MILESTONE_MULT).pow(Math.floor(engine.bought / MILESTONE_SIZE));
  mult = mult.mul(overdriveMult()).mul(collapseEngineMult()).mul(surgeMult());
  if (tier === 0) mult = mult.mul(fluxThrottle());
  if (shardUpgrades.has("cascade") && tier < ENGINE_COUNT - 1) {
    mult = mult.mul(1 + state.engines[tier + 1].bought * 0.02);
  }
  return mult;
}

/** Units per second this engine produces of the tier below it (Flux for tier 0). */
export const engineRate = (tier: number): Decimal =>
  state.engines[tier].amount.mul(engineMult(tier)).mul(tempoMult()).mul(BASE_RATE);

export const fluxPerSecond = () => engineRate(0);

/** Percent-per-second growth of an engine's amount from the tier above. */
export function engineGrowthPercent(tier: number): Decimal {
  if (tier >= ENGINE_COUNT - 1) return D(0);
  const amount = state.engines[tier].amount;
  if (amount.eq(0)) return D(0);
  return engineRate(tier + 1).div(amount).mul(100);
}

export function produce(dt: number) {
  for (let tier = ENGINE_COUNT - 1; tier >= 1; tier--) {
    if (state.engines[tier].amount.eq(0)) continue;
    const below = state.engines[tier - 1];
    below.amount = below.amount.add(engineRate(tier).mul(dt));
  }
  addFlux(fluxPerSecond().mul(dt));
}
