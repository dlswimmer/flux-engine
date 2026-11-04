import { D, Decimal } from "../lib/decimal";
import { COLLAPSE_HISTORY, state } from "../core/state";
import { formatMult } from "../core/format";
import { isHeatUnlocked } from "./heat";
import { resetForCollapse } from "./reset";
import { riftShardMult } from "./rift";
import { heatShardMult } from "./heat";
import { UpgradeSet } from "./upgrades";

/** Momentum stops growing here; uncapped it was worth ×6 on a slow first run. */
const MOMENTUM_CAP = 3;

/** Flux can't go past the Horizon until "Breach" is bought; reaching it lets you Collapse. */
export const HORIZON = D("1e200");
const HORIZON_LOG = HORIZON.log10().toNumber();

export const shardUpgrades = new UpgradeSet(
  [
    {
      id: "kindling",
      name: "Kindling",
      desc: "All Engines produce 2× more.",
      cost: 1,
      effect: () => D(2),
    },
    {
      id: "momentum",
      name: "Momentum",
      desc: "Engines gain a bonus that grows with time spent in this Collapse (max ×3).",
      cost: 1,
      effect: () => D(Math.min(MOMENTUM_CAP, 1 + Math.sqrt(state.collapse.time / 60))),
      effectText: (v) => formatMult(v),
    },
    {
      id: "echo",
      name: "Echo",
      desc: "All Engines gain a bonus based on total Collapses.",
      cost: 1,
      effect: () => D(state.collapse.count + 1).pow(0.4),
      effectText: (v) => formatMult(v),
    },
    {
      id: "automators",
      name: "Automators",
      desc: "Unlock autobuyers for every Engine and for Tempo. They start slow and get faster with every Collapse.",
      cost: 1,
    },
    {
      id: "ignition",
      name: "Ignition",
      desc: "Start every Collapse with 1 Overdrive (including this one).",
      cost: 2,
      // Usually bought right after a Collapse, so it should count for the run you're in.
      onBuy: () => {
        if (state.overdrives < 1) state.overdrives = 1;
      },
    },
    {
      id: "tuning",
      name: "Tuning",
      desc: "Each Tempo level is +0.01 stronger.",
      cost: 2,
    },
    {
      id: "gearing",
      name: "Gearing",
      desc: "Engine cost scaling is 10% weaker.",
      cost: 2,
    },
    {
      id: "cascade",
      name: "Cascade",
      desc: "Each Engine gets +2% output per purchase of the Engine above it.",
      cost: 3,
    },
    {
      id: "exchanger",
      name: "Heat Exchanger",
      desc: "Surges last 50% longer and peak at ×5 instead of ×4.",
      cost: 3,
      unlocked: () => isHeatUnlocked(),
    },
    {
      id: "resonance",
      name: "Resonance",
      desc: "Each Overdrive gives ×2.25 instead of ×2.",
      cost: 3,
    },
    {
      id: "automators2",
      name: "Foreman",
      desc: "Unlock autobuyers for Overdrive and Lattice.",
      cost: 4,
      requires: ["automators"],
    },
    {
      id: "selfcollapse",
      name: "Self-Collapse",
      desc: "Unlock auto-Collapse (Automation tab): Collapse by itself once it's worth enough Shards.",
      cost: 6,
      requires: ["automators2"],
    },
    {
      id: "overclock",
      name: "Overclock",
      desc: "Autobuyers act 3× as often.",
      cost: 3,
      requires: ["automators"],
    },
    {
      id: "thermostat",
      name: "Thermostat",
      desc: "Automatically vent when Heat reaches a level you choose.",
      cost: 4,
      unlocked: () => isHeatUnlocked(),
    },
    {
      id: "latticeworks",
      name: "Latticeworks",
      desc: "Lattices keep up to 4 Overdrives (Engines V–VIII stay unlocked) and need 15 fewer Engine VIII.",
      cost: 5,
    },
    {
      id: "prism",
      name: "Prism",
      desc: "Gain 2× Shards from Collapsing.",
      cost: 3,
    },
    {
      id: "breach",
      name: "Breach",
      desc: "Flux can pass the Horizon (growth slows the further past it you go), and Shard gain scales with your peak Flux.",
      cost: 12,
      requires: ["prism"],
    },
  ],
  () => state.collapse.upgrades,
  { get: () => state.collapse.shards, set: (v) => (state.collapse.shards = v) },
);

export const isBreached = () => shardUpgrades.has("breach");

export function capAtHorizon() {
  if (!isBreached() && state.flux.gt(HORIZON)) state.flux = HORIZON;
}

// Based on the most Flux reached this Collapse, not current Flux: buying (by hand or by
// autobuyer) and Overdrive/Lattice resets spend Flux, and none of that should take a
// Collapse away or shrink its Shards.
export const canCollapse = () => state.collapse.peakFlux.gte(HORIZON);
export const isCollapseUnlocked = () => state.collapse.count > 0 || canCollapse();

export function shardGain(): Decimal {
  if (!canCollapse()) return D(0);
  let gain = isBreached()
    ? Decimal.pow(10, state.collapse.peakFlux.log10().div(HORIZON_LOG).sub(0.75))
    : D(1);
  if (shardUpgrades.has("prism")) gain = gain.mul(2);
  gain = gain.mul(riftShardMult());
  // After Breach, Heat pays in Shards too: Engine multipliers barely move Shards (a ×2 is ~×1.06).
  if (isBreached()) gain = gain.mul(heatShardMult());
  return gain.floor().max(1);
}

export function doCollapse(): boolean {
  if (!canCollapse()) return false;
  const gain = shardGain();
  state.collapse.shards = state.collapse.shards.add(gain);
  state.collapse.count++;
  state.collapse.history = [
    ...state.collapse.history,
    { number: state.collapse.count, time: state.collapse.time, shards: gain },
  ].slice(-COLLAPSE_HISTORY);
  state.collapse.bestTime = Math.min(state.collapse.bestTime, state.collapse.time);
  resetForCollapse();
  return true;
}

/**
 * Shard-upgrade multiplier for one Engine tier. Every-tier boosts compress runs
 * hard (output grows like t^8 between resets), so they stay modest; `npm run sim`
 * is the check.
 */
export function collapseEngineMult(): Decimal {
  return shardUpgrades
    .effect("kindling")
    .mul(shardUpgrades.effect("momentum"))
    .mul(shardUpgrades.effect("echo"))
    .mul(overchargeMult());
}

// ---------- Overcharge: the repeatable Shard sink after Breach ----------
// Each level multiplies every Engine; past the Horizon that pushes Flux deeper, which is
// what opens the Rift. Reset by a Rift.

const OVERCHARGE_BASE_COST = 5;
const OVERCHARGE_COST_GROWTH = 1.25;
/** ×10: at ×2 a level was worth ~2.6 orders of magnitude of depth vs ~30 for a Lattice. */
const OVERCHARGE_MULT = 10;

export const isOverchargeUnlocked = () => isBreached();
// Exact for normal levels: Decimal.pow(2, 13) comes out as 8191.99..., shown as ×8,191.
export const overchargeMult = () =>
  state.collapse.overcharge <= 1000 ? D(OVERCHARGE_MULT ** state.collapse.overcharge) : D(OVERCHARGE_MULT).pow(state.collapse.overcharge);
export const overchargeCost = () => D(OVERCHARGE_BASE_COST).mul(D(OVERCHARGE_COST_GROWTH).pow(state.collapse.overcharge));
export const canBuyOvercharge = () => isOverchargeUnlocked() && state.collapse.shards.gte(overchargeCost());

export function buyOvercharge(): boolean {
  if (!canBuyOvercharge()) return false;
  state.collapse.shards = state.collapse.shards.sub(overchargeCost());
  state.collapse.overcharge++;
  return true;
}

export function buyMaxOvercharge(): number {
  if (!isOverchargeUnlocked()) return 0;
  const count = Decimal.affordGeometricSeries(
    state.collapse.shards,
    OVERCHARGE_BASE_COST,
    OVERCHARGE_COST_GROWTH,
    state.collapse.overcharge,
  )
    .floor()
    .toNumber();
  if (!(count > 0) || !Number.isFinite(count)) return 0;
  const cost = Decimal.sumGeometricSeries(count, OVERCHARGE_BASE_COST, OVERCHARGE_COST_GROWTH, state.collapse.overcharge);
  state.collapse.shards = state.collapse.shards.sub(cost).max(0);
  state.collapse.overcharge += count;
  return count;
}
