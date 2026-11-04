import { ENGINE_COUNT, state } from "../core/state";
import { shardUpgrades } from "./collapse";
import { hasNode } from "./rift";

// Heat: running Engines push Heat toward HEAT_MAX. Past THROTTLE_START it gently
// throttles Flux output (Engine I only, floor ×0.8) so idle play stays viable. The
// active payoff is the Surge: venting resets Heat and boosts every Engine for a while,
// scaled by how hot you vented.

export const HEAT_MAX = 100;
export const THROTTLE_START = 60;
const THROTTLE_FLOOR = 0.8;
// Time constant in seconds with all 8 tiers running. Fast on purpose: Heat is frozen
// during a Surge, so this sets how soon the next vent comes (sim: active ~20% faster than idle).
const FILL_TIME = 8;
const MIN_VENT = 5;
const SURGE_DURATION = 15;
const HEAT_UNLOCK_COLLAPSES = 3;

export const isHeatUnlocked = () => state.collapse.count >= HEAT_UNLOCK_COLLAPSES;
export const hasThermostat = () => shardUpgrades.has("thermostat");

const activeTiers = () => state.engines.filter((e) => e.amount.gt(0)).length;

export function updateHeat(dt: number) {
  if (!isHeatUnlocked()) return;
  const heat = state.heat;
  // A Surge is the vent still open: no Heat builds until it closes. Only the part of
  // this tick after the Surge ends counts (matters for big offline-catch-up ticks).
  const heatingTime = Math.max(0, dt - heat.surgeTime);
  heat.surgeTime = Math.max(0, heat.surgeTime - dt);
  const rate = (activeTiers() / ENGINE_COUNT / FILL_TIME) * (hasNode("chain-reaction") ? 2 : 1);
  // Exact exponential approach, so it stays stable for the big dt of offline catch-up.
  heat.amount += (HEAT_MAX - heat.amount) * (1 - Math.exp(-rate * heatingTime));
  if (hasNode("even-keel")) heat.amount = Math.min(heat.amount, THROTTLE_START);
  if (hasThermostat() && heat.autoVent && heat.amount >= heat.autoVentAt) vent();
}

/** Multiplier on Flux output from overheating: 1 up to THROTTLE_START, down to THROTTLE_FLOOR at max. */
export function fluxThrottle(): number {
  const h = state.heat.amount;
  if (!isHeatUnlocked() || h <= THROTTLE_START || hasNode("backdraft")) return 1;
  return 1 - ((1 - THROTTLE_FLOOR) * (h - THROTTLE_START)) / (HEAT_MAX - THROTTLE_START);
}

const surgeMax = () => (shardUpgrades.has("exchanger") ? 5 : 4) * (hasNode("flashpoint") ? 2 : 1);
const SURGE_CURVE = 2; // >1 rewards venting hot: tiny frequent vents are weak

/** Surge strength for venting at a given Heat: ×1 at 0, up to surgeMax() at 100. */
export const surgeMultFor = (heat: number) => 1 + (surgeMax() - 1) * (heat / HEAT_MAX) ** SURGE_CURVE;
export const surgeDuration = () =>
  SURGE_DURATION * (shardUpgrades.has("exchanger") ? 1.5 : 1) * (hasNode("chain-reaction") ? 2 : 1);
export const isSurging = () => state.heat.surgeTime > 0;
export const surgeMult = () => (isSurging() ? state.heat.surgeMult : 1);

/**
 * What the Heat bar shows. Real Heat drops to 0 on venting (and stays frozen during the
 * Surge); the bar instead drains from the vented level over the Surge, so venting reads
 * as heat pouring out rather than vanishing. Display only: game logic uses state.heat.amount.
 */
export function displayedHeat(): number {
  const heat = state.heat;
  if (!isSurging()) return heat.amount;
  return heat.ventedFrom * Math.min(1, heat.surgeTime / surgeDuration());
}

/** No venting mid-Surge, so Surges can't be chained into a permanent boost. */
export const canVent = () => isHeatUnlocked() && !isSurging() && state.heat.amount >= MIN_VENT;

/** Dump all Heat into a fresh Surge. */
export function vent(): boolean {
  if (!canVent()) return false;
  const heat = state.heat;
  heat.surgeMult = surgeMultFor(heat.amount);
  heat.ventedFrom = heat.amount;
  heat.surgeTime = surgeDuration();
  heat.amount = 0;
  heat.vents++;
  return true;
}

export function resetHeat() {
  state.heat.amount = 0;
  state.heat.surgeTime = 0;
}
