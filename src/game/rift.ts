import { D, Decimal } from "../lib/decimal";
import { state } from "../core/state";
import { isBreached } from "./collapse";
import { displayedHeat } from "./heat";
import { resetForRift } from "./reset";
import { UpgradeSet } from "./upgrades";

// Layer 2: the Rift. Push Flux far enough past the Horizon in one Collapse and you can tear
// the Rift open: it resets the whole Collapse layer (Shards, Shard upgrades, Overcharge) for
// Essence, spent on a skill tree that forks into Order (idle) and Entropy (active).

/** Peak Flux (this Collapse) needed to Rift. Tuned with `npm run sim -- rift`. */
export const RIFT_THRESHOLD = D("1e350");
const RIFT_LOG = RIFT_THRESHOLD.log10().toNumber();
/** Every this many orders of magnitude past the threshold doubles Essence. */
const ESSENCE_DOUBLING = 24;

export const isRiftUnlocked = () => isBreached() || state.rift.count > 0;
export const canRift = () => state.collapse.peakFlux.gte(RIFT_THRESHOLD);

export function essenceGain(): Decimal {
  if (!canRift()) return D(0);
  const over = state.collapse.peakFlux.log10().toNumber() - RIFT_LOG;
  return D(2).pow(over / ESSENCE_DOUBLING).floor().max(1);
}

export function doRift(): boolean {
  if (!canRift()) return false;
  const gain = essenceGain();
  const rift = state.rift;
  rift.essence = rift.essence.add(gain);
  rift.totalEssence = rift.totalEssence.add(gain);
  rift.count++;
  rift.bestTime = Math.min(rift.bestTime, rift.time);
  if (rift.respec) {
    rift.essence = rift.essence.add(spentEssence());
    rift.nodes = [];
    rift.respec = false;
  }
  resetForRift();
  return true;
}

// ---------- Milestones: what each Rift lets you keep ----------

export interface RiftMilestone {
  rifts: number;
  text: string;
  /** Shard upgrades that survive a Rift once you have this many Rifts. */
  keeps: string[];
}

export const RIFT_MILESTONES: RiftMilestone[] = [
  // The first Rift already keeps the core upgrades: when it didn't, Rift 2 took twice as long
  // as Rift 1 (rebuilding Kindling etc. from zero Shards) - a bad first impression of a layer.
  {
    rifts: 1,
    text: "Keep the automation upgrades and Kindling, Momentum, Echo, Ignition, Tuning and Gearing.",
    keeps: ["automators", "automators2", "selfcollapse", "overclock", "thermostat", "kindling", "momentum", "echo", "ignition", "tuning", "gearing"],
  },
  { rifts: 2, text: "Keep Cascade, Heat Exchanger, Resonance and Latticeworks.", keeps: ["cascade", "exchanger", "resonance", "latticeworks"] },
  { rifts: 3, text: "Keep Prism and Breach.", keeps: ["prism", "breach"] },
];

export const hasRiftMilestone = (rifts: number) => state.rift.count >= rifts;

/** Shard upgrades that survive a Rift. */
export const keptShardUpgrades = (): string[] =>
  RIFT_MILESTONES.filter((m) => hasRiftMilestone(m.rifts)).flatMap((m) => m.keeps);

// ---------- Skill tree ----------

export type Branch = "core" | "order" | "entropy";

export interface RiftNodeInfo {
  branch: Branch;
  /** Row in the tree, for layout. */
  row: number;
}

const ORDER = ["even-keel", "long-burn", "self-winding"];
const ENTROPY = ["flashpoint", "backdraft", "chain-reaction"];
const owns = (id: string) => state.rift.nodes.includes(id);
/** Picking the first node of a branch locks the other one until you respec. */
export const chosenBranch = (): "order" | "entropy" | null =>
  ORDER.some(owns) ? "order" : ENTROPY.some(owns) ? "entropy" : null;

export const NODE_INFO: Record<string, RiftNodeInfo> = {
  "rift-lens": { branch: "core", row: 0 },
  "head-start": { branch: "core", row: 1 },
  "shard-focus": { branch: "core", row: 1 },
  "even-keel": { branch: "order", row: 2 },
  "long-burn": { branch: "order", row: 3 },
  "self-winding": { branch: "order", row: 4 },
  flashpoint: { branch: "entropy", row: 2 },
  backdraft: { branch: "entropy", row: 3 },
  "chain-reaction": { branch: "entropy", row: 4 },
};

const branchOpen = (branch: "order" | "entropy") => () => chosenBranch() === null || chosenBranch() === branch;

export const riftNodes = new UpgradeSet(
  [
    {
      id: "rift-lens",
      name: "Rift Lens",
      desc: "All Engines gain a bonus from all the Essence you've ever earned.",
      cost: 1,
      // ^0.75: at ^2 one 16-Essence Rift made every later Rift take ~10s.
      effect: () => state.rift.totalEssence.add(1).pow(0.75),
      effectText: (v) => `×${v.toNumber().toFixed(2)}`,
    },
    {
      id: "head-start",
      name: "Head Start",
      desc: "Start every Collapse with 4 Overdrives: Engines V–VIII from the first second.",
      cost: 2,
      requires: ["rift-lens"],
      // Like Ignition: applies to the Collapse you're in, not just the next one.
      onBuy: () => {
        if (state.overdrives < 4) state.overdrives = 4;
      },
    },
    {
      id: "shard-focus",
      name: "Shard Focus",
      desc: "Gain 2× Shards from Collapsing.",
      cost: 3,
      requires: ["rift-lens"],
    },
    // Order: steady, idle-friendly.
    {
      id: "even-keel",
      name: "Even Keel",
      desc: "Heat never rises past 60%, so it never slows Flux. All Engines ×2.",
      cost: 5,
      requires: ["head-start", "shard-focus"],
      unlocked: branchOpen("order"),
    },
    {
      id: "long-burn",
      name: "Long Burn",
      desc: "Momentum's cap rises from ×3 to ×10.",
      cost: 10,
      requires: ["even-keel"],
      unlocked: branchOpen("order"),
    },
    {
      id: "self-winding",
      name: "Self-Winding",
      desc: "Autobuyers act 2× as often, and you gain 2× Shards.",
      cost: 20,
      requires: ["long-burn"],
      unlocked: branchOpen("order"),
    },
    // Entropy: volatile, rewards playing with Heat.
    {
      id: "flashpoint",
      name: "Flashpoint",
      desc: "Surges peak at ×8 instead of ×4 (×10 with Heat Exchanger).",
      cost: 5,
      requires: ["head-start", "shard-focus"],
      unlocked: branchOpen("entropy"),
    },
    {
      id: "backdraft",
      name: "Backdraft",
      desc: "Heat no longer slows Flux. Instead it boosts all Engines, up to ×4 at 100%.",
      cost: 10,
      requires: ["flashpoint"],
      unlocked: branchOpen("entropy"),
    },
    {
      id: "chain-reaction",
      name: "Chain Reaction",
      desc: "Surges last 2× as long, Heat builds 2× as fast, and you gain 2× Shards.",
      cost: 20,
      requires: ["backdraft"],
      unlocked: branchOpen("entropy"),
    },
  ],
  () => state.rift.nodes,
  { get: () => state.rift.essence, set: (v) => (state.rift.essence = v) },
);

export const hasNode = (id: string) => riftNodes.has(id);

export const spentEssence = (): Decimal =>
  state.rift.nodes.reduce((sum, id) => sum.add(riftNodes.get(id).cost), D(0));

/** Rift-tree multiplier on every Engine. */
export function riftEngineMult(): Decimal {
  let mult = riftNodes.effect("rift-lens");
  if (hasNode("even-keel")) mult = mult.mul(2);
  // Uses the draining bar during a Surge, so the Heat you vent keeps burning instead of the
  // bonus vanishing the moment you vent.
  if (hasNode("backdraft")) mult = mult.mul(1 + (3 * displayedHeat()) / 100);
  return mult;
}

export function riftShardMult(): number {
  return (hasNode("shard-focus") ? 2 : 1) * (hasNode("self-winding") || hasNode("chain-reaction") ? 2 : 1);
}
