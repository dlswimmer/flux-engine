import { D, Decimal } from "../lib/decimal";
import { state } from "../core/state";
import { formatMult } from "../core/format";
import { isHeatUnlocked } from "./heat";
import { resetForCollapse } from "./reset";
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
      desc: "Flux can pass the Horizon, and Shard gain scales with Flux beyond it.",
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

export const canCollapse = () => state.flux.gte(HORIZON);
export const isCollapseUnlocked = () => state.collapse.count > 0 || canCollapse();

export function shardGain(): Decimal {
  if (!canCollapse()) return D(0);
  let gain = isBreached()
    ? Decimal.pow(10, state.flux.log10().div(HORIZON_LOG).sub(0.75))
    : D(1);
  if (shardUpgrades.has("prism")) gain = gain.mul(2);
  return gain.floor().max(1);
}

export function doCollapse(): boolean {
  if (!canCollapse()) return false;
  state.collapse.shards = state.collapse.shards.add(shardGain());
  state.collapse.count++;
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
  let mult = shardUpgrades
    .effect("kindling")
    .mul(shardUpgrades.effect("momentum"))
    .mul(shardUpgrades.effect("echo"));
  return mult;
}
