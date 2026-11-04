import { D, Decimal } from "../lib/decimal";
import { RIFT_HISTORY, state } from "../core/state";
import { isBreached } from "./collapse";
import { displayedHeat } from "./heat";
import { resetForRift } from "./reset";
import { UpgradeSet } from "./upgrades";

// Layer 2: the Rift. Overcharge the Engines far enough and the Rift tears open: it resets
// the whole Collapse layer (Shards, Shard upgrades, Overcharge) for Essence, spent on a skill
// tree that forks into Order (idle) and Entropy (active).
//
// Gated on Overcharge level, not Flux depth. Depth past the Horizon reacts violently to every
// multiplier (one extra Lattice was worth ~30 orders of magnitude, and a Tempo loop once made
// it infinite), so a depth threshold was either a wall or trivial. Overcharge is bought with
// Shards, and Shards still come from depth, so everything still feeds in, just smoothly.

/** Overcharge level needed to Rift. Tuned with `npm run sim -- rift`. */
export const RIFT_OVERCHARGE = 24;
/** Every this many Overcharge levels past the requirement doubles Essence. */
const LEVELS_PER_DOUBLING = 2;

export const isRiftUnlocked = () => isBreached() || state.rift.count > 0;
export const canRift = () => state.collapse.overcharge >= RIFT_OVERCHARGE;

export function essenceGain(): Decimal {
  if (!canRift()) return D(0);
  const over = state.collapse.overcharge - RIFT_OVERCHARGE;
  return D(2).pow(over / LEVELS_PER_DOUBLING).floor().max(1);
}

export function doRift(): boolean {
  if (!canRift()) return false;
  const gain = essenceGain();
  const rift = state.rift;
  rift.essence = rift.essence.add(gain);
  rift.totalEssence = rift.totalEssence.add(gain);
  rift.count++;
  rift.history = [
    ...rift.history,
    { number: rift.count, time: rift.time, essence: gain, collapses: state.collapse.count, overcharge: state.collapse.overcharge },
  ].slice(-RIFT_HISTORY);
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
  // Staged so each Rift's replay is faster than the last. The first Collapse after Rift 1
  // takes about half as long as the very first one (when Rift 1 kept everything and the
  // Collapse count, it took 8s).
  {
    rifts: 1,
    text: "Keep Automators, Foreman, Self-Collapse, Overclock and Thermostat.",
    keeps: ["automators", "automators2", "selfcollapse", "overclock", "thermostat"],
  },
  { rifts: 2, text: "Keep Kindling, Momentum, Echo, Ignition, Tuning and Gearing.", keeps: ["kindling", "momentum", "echo", "ignition", "tuning", "gearing"] },
  { rifts: 3, text: "Keep Cascade, Heat Exchanger, Resonance and Latticeworks.", keeps: ["cascade", "exchanger", "resonance", "latticeworks"] },
  { rifts: 4, text: "Keep Prism and Breach.", keeps: ["prism", "breach"] },
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
      // ^0.25: tuned so the first Collapse after Rift 1 is ~50% of the very first one with
      // just the Lens (~33% with Head Start too). ^2 made every Rift after the first take ~10s.
      effect: () => state.rift.totalEssence.add(1).pow(0.25),
      effectText: (v) => `×${v.toNumber().toFixed(2)}`,
    },
    {
      id: "head-start",
      name: "Head Start",
      desc: "Start every Collapse with 1 Overdrive (2 with Ignition): Engine V from the first second.",
      cost: 2,
      requires: ["rift-lens"],
      // Like Ignition: applies to the Collapse you're in, not just the next one.
      onBuy: () => {
        if (state.overdrives < headStartOverdrives()) state.overdrives = headStartOverdrives();
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
      desc: "Heat never rises past 60%, so it never slows Flux (and you never Surge). Gain 2× Shards.",
      cost: 5,
      requires: ["head-start", "shard-focus"],
      unlocked: branchOpen("order"),
    },
    {
      id: "long-burn",
      name: "Long Burn",
      effect: () => D(longBurnMult()),
      effectText: (v) => `×${v.toNumber().toFixed(2)}`,
      desc: "Shard gain grows with time in this Rift: ×(1 + minutes ÷ 10), up to ×3.",
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
      desc: "Heat no longer slows Flux. Instead it boosts all Engines, up to ×4 at 100% (and Shards by its square root).",
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
  // Uses the draining bar during a Surge, so the Heat you vent keeps burning instead of the
  // bonus vanishing the moment you vent.
  if (hasNode("backdraft")) mult = mult.mul(1 + (3 * displayedHeat()) / 100);
  return mult;
}

export const longBurnMult = () => Math.min(3, 1 + state.rift.time / 600);

export function riftShardMult(): number {
  let mult = (hasNode("shard-focus") ? 2 : 1) * (hasNode("self-winding") || hasNode("chain-reaction") ? 2 : 1);
  // ×2, not ×1.5: capping Heat also gives up Surges, which pay Shards after Breach.
  if (hasNode("even-keel")) mult *= 2;
  if (hasNode("long-burn")) mult *= longBurnMult();
  return mult;
}

/** Head Start stacks with Ignition: +1 Overdrive at the start of every Collapse. */
export const headStartOverdrives = () => (state.collapse.upgrades.includes("ignition") ? 1 : 0) + 1;
