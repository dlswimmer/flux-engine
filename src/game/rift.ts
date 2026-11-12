import { AUTOMATION_UPGRADES } from "./automationIds";
import { emit } from "../core/events";
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
/**
 * Essence per Overcharge level past the requirement. Linear: it used to double every 2 levels,
 * and a player who let the reset autobuyers run uncapped had ~45 Essence on offer 6 minutes
 * after Breach, most of the Rift tree in one Rift. Same 4 Essence at Overcharge 28 as before.
 */
const ESSENCE_PER_LEVEL = 0.75;
/**
 * Essence curve past the requirement: 4 at Overcharge 28 (as before), ×1.3 per level after, so
 * waiting for a bigger Rift pays (David, 2026-11-11: with linear Essence the best play was
 * Rifting at 4 every 1-2 minutes). Sim, 8h after Breach: ×1.25 / 1.32 / 1.4 finish the tree
 * 6h26m / 5h15m / 4h40m after Breach Rifting at 20; Rifting at 4 is unchanged. Mutable so
 * `npm run report -- styles` can compare curves (ESSENCE_GROWTH=1.25). growth 0 = linear.
 */
export const ESSENCE_CURVE = { growth: 1.3 };
/** Overcharge past the requirement where Essence switches from ×1.3 a level to a cube. */
const ESSENCE_CURVE_KNEE = 12;

// ---------- New-node numbers ----------

/** Overcharge Coil: cost growth per Overcharge level (×1.35 without it). */
export const OVERCHARGE_GROWTH_COIL = 1.3;
const TRIAL_MEMORY_PER_TRIAL = 0.25;
export const BALLAST_AWAY_MULT = 1.5;
/** Redline: venting at this Heat or more doubles Shards for that Surge. */
export const REDLINE_HEAT = 95;

export const isRiftUnlocked = () => isBreached() || state.rift.count > 0;
export const canRift = () => state.collapse.overcharge >= RIFT_OVERCHARGE;

export function essenceGain(): Decimal {
  if (!canRift()) return D(0);
  return essenceAt(state.collapse.overcharge);
}

/** Essence a Rift at this Overcharge level would give. */
export function essenceAt(overcharge: number): Decimal {
  const over = overcharge - RIFT_OVERCHARGE;
  let base = ESSENCE_CURVE.growth
    ? Math.max(1, 4 * ESSENCE_CURVE.growth ** (over - 4))
    : 1 + over * ESSENCE_PER_LEVEL;
  // Past Overcharge 36 (~33 Essence) it grows like a cube instead (same slope where they meet).
  // ×1.3 a level matched Overcharge Coil's ×1.3 cost, so Essence grew in step with Shards, and
  // Shards grow with Essence (Rift Lens, Attunement): David's Rifts went 127 → 472 → 2,963 →
  // 98,640 Essence, ~2½ minutes apart (2026-11-12). Polynomial in Overcharge is logarithmic in
  // Shards, so that loop can't run away.
  if (ESSENCE_CURVE.growth && over > ESSENCE_CURVE_KNEE)
    base = 4 * ESSENCE_CURVE.growth ** (ESSENCE_CURVE_KNEE - 4) * (over / ESSENCE_CURVE_KNEE) ** 3;
  return D(Math.floor(base * attunementEssenceMult()));
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
  emit("rift");
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
    text: "Keep every automation upgrade (autobuyers, Bulk Buying, Overclock, Foremen, Self-Collapse, Thermostat).",
    keeps: AUTOMATION_UPGRADES,
  },
  { rifts: 2, text: "Keep Kindling, Momentum, Echo, Ignition, Tuning, Gearing, Flywheel and Deep Echo.", keeps: ["kindling", "momentum", "echo", "ignition", "tuning", "gearing", "flywheel", "deepecho"] },
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

const ORDER = ["even-keel", "long-burn", "self-winding", "ballast", "perpetual"];
const ENTROPY = ["flashpoint", "backdraft", "chain-reaction", "redline", "critical-mass"];
const owns = (id: string) => state.rift.nodes.includes(id);
/**
 * Picking the first node of a branch locks the other one until you respec. Nodes are saved in
 * buy order, so after Crossover the first branch node bought still says which one is yours.
 */
export const chosenBranch = (): "order" | "entropy" | null => {
  const first = state.rift.nodes.find((id) => ORDER.includes(id) || ENTROPY.includes(id));
  return first === undefined ? null : ORDER.includes(first) ? "order" : "entropy";
};
/** Crossover's second branch: rows 2-4 of the branch you didn't choose, at 2× their cost. */
export const CROSSOVER_COST_MULT = 2;
const isCrossoverNode = (id: string) => {
  const branch = NODE_INFO[id]?.branch;
  return branch !== undefined && branch !== "core" && chosenBranch() !== null && branch !== chosenBranch();
};

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
  "overcharge-coil": { branch: "core", row: 2 },
  "trial-memory": { branch: "core", row: 2 },
  ballast: { branch: "order", row: 5 },
  perpetual: { branch: "order", row: 6 },
  redline: { branch: "entropy", row: 5 },
  "critical-mass": { branch: "entropy", row: 6 },
  crossover: { branch: "core", row: 7 },
};

/** Rows 2-4: your branch, or the other one once you own Crossover. */
const branchOpen = (branch: "order" | "entropy") => () =>
  chosenBranch() === null || chosenBranch() === branch || owns("crossover");
/** Rows 5-6 (the capstones): only ever your own branch. */
const homeOnly = (branch: "order" | "entropy") => () => chosenBranch() === null || chosenBranch() === branch;

// Costs ×3 (2026-11-11): at ×1 one 6-Essence Rift bought the whole core and a branch took ~6 more.
export const riftNodes = new UpgradeSet(
  [
    {
      id: "rift-lens",
      name: "Rift Lens",
      desc: "All Engines gain a bonus from all the Essence you've ever earned.",
      cost: 3,
      // ^0.25: tuned so the first Collapse after Rift 1 is ~50% of the very first one with
      // just the Lens (~33% with Head Start too). ^2 made every Rift after the first take ~10s.
      effect: () => state.rift.totalEssence.add(1).pow(0.25),
      effectText: (v) => `×${v.toNumber().toFixed(2)}`,
    },
    {
      id: "head-start",
      name: "Head Start",
      desc: "Start every Collapse with 1 Overdrive (2 with Ignition): Engine V from the first second.",
      cost: 6,
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
      cost: 9,
      requires: ["rift-lens"],
    },
    {
      id: "overcharge-coil",
      name: "Overcharge Coil",
      desc: `Each Overcharge level costs ×${OVERCHARGE_GROWTH_COIL} the last instead of ×1.35, so you reach deeper Overcharge (and more Essence) each Rift.`,
      cost: 24,
      requires: ["head-start", "shard-focus"],
    },
    {
      id: "trial-memory",
      name: "Trial Memory",
      desc: `Every Trial you've won gives ×${1 + TRIAL_MEMORY_PER_TRIAL} Shards, added up (×2.5 with all 6).`,
      cost: 24,
      requires: ["head-start", "shard-focus"],
      effect: () => D(trialMemoryMult()),
      effectText: (v) => `×${v.toNumber().toFixed(2)}`,
    },
    // Order: steady, idle-friendly.
    {
      id: "even-keel",
      name: "Even Keel",
      desc: "Heat never rises past 60%, so it never slows Flux (and you never Surge). Gain 2× Shards.",
      cost: 15,
      requires: ["head-start", "shard-focus"],
      unlocked: branchOpen("order"),
    },
    {
      id: "long-burn",
      name: "Long Burn",
      effect: () => D(longBurnMult()),
      effectText: (v) => `×${v.toNumber().toFixed(2)}`,
      desc: "Shard gain grows with time in this Rift: ×(1 + minutes ÷ 10), up to ×3.",
      cost: 30,
      requires: ["even-keel"],
      unlocked: branchOpen("order"),
    },
    {
      id: "self-winding",
      name: "Self-Winding",
      desc: "Autobuyers act 2× as often, and you gain 2× Shards.",
      cost: 60,
      requires: ["long-burn"],
      unlocked: branchOpen("order"),
    },
    // Entropy: volatile, rewards playing with Heat.
    {
      id: "flashpoint",
      name: "Flashpoint",
      desc: "Surges peak at ×8 instead of ×4 (×10 with Heat Exchanger).",
      cost: 15,
      requires: ["head-start", "shard-focus"],
      unlocked: branchOpen("entropy"),
    },
    {
      id: "backdraft",
      name: "Backdraft",
      desc: "Heat no longer slows Flux. Instead it boosts all Engines, up to ×4 at 100% (and Shards by its square root).",
      cost: 30,
      requires: ["flashpoint"],
      unlocked: branchOpen("entropy"),
    },
    {
      id: "chain-reaction",
      name: "Chain Reaction",
      desc: "Surges last 2× as long, Heat builds 2× as fast, and you gain 2× Shards.",
      cost: 60,
      requires: ["backdraft"],
      unlocked: branchOpen("entropy"),
    },
    // Rows 5-6: each branch's capstones. Crossover never opens these on the other side.
    {
      id: "ballast",
      name: "Ballast",
      desc: `Time away counts ${BALLAST_AWAY_MULT}× when you choose to use it.`,
      cost: 120,
      requires: ["self-winding"],
      unlocked: homeOnly("order"),
    },
    {
      id: "perpetual",
      name: "Perpetual",
      desc: "Overcharge buys itself, and you can set the Rift to open on its own at an Essence amount.",
      cost: 240,
      requires: ["ballast"],
      unlocked: homeOnly("order"),
    },
    {
      id: "redline",
      name: "Redline",
      desc: `Vent at ${REDLINE_HEAT}% Heat or more and that Surge gives 2× Shards.`,
      cost: 120,
      requires: ["chain-reaction"],
      unlocked: homeOnly("entropy"),
    },
    {
      id: "critical-mass",
      name: "Critical Mass",
      desc: "Heat keeps building during a Surge, 2× as fast, and you can vent again mid-Surge: the new Surge multiplies the old one (up to the strongest Surge squared).",
      cost: 240,
      requires: ["redline"],
      unlocked: homeOnly("entropy"),
    },
    {
      id: "crossover",
      name: "Crossover",
      desc: `Opens the first three nodes of the other branch, at ${CROSSOVER_COST_MULT}× their cost.`,
      cost: 300,
      requires: ["overcharge-coil", "trial-memory"],
      gate: () => (owns("perpetual") || owns("critical-mass") ? null : "Finish your branch first"),
    },
  ],
  () => state.rift.nodes,
  { get: () => state.rift.essence, set: (v) => (state.rift.essence = v) },
  () => false,
  (def) => (isCrossoverNode(def.id) ? D(def.cost).mul(CROSSOVER_COST_MULT) : def.cost),
);

export const hasNode = (id: string) => riftNodes.has(id);

export const spentEssence = (): Decimal =>
  state.rift.nodes.reduce((sum, id) => sum.add(riftNodes.cost(id)), D(0));

/** Rift-tree multiplier on every Engine. */
export function riftEngineMult(): Decimal {
  let mult = riftNodes.effect("rift-lens").mul(attunementEngineMult());
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
  if (hasNode("trial-memory")) mult *= trialMemoryMult();
  return mult;
}

/** Head Start stacks with Ignition: +1 Overdrive at the start of every Collapse. */
export const headStartOverdrives = () => (state.collapse.upgrades.includes("ignition") ? 1 : 0) + 1;

export const trialMemoryMult = () => 1 + TRIAL_MEMORY_PER_TRIAL * state.trials.completed.length;

// ---------- Attunement: the repeatable Essence sink ----------
// Bought with Essence, kept through Rifts and respecs. The Engine ×2 is small next to a node;
// the +5% Essence (added up, not compounding) is what keeps spare Essence worth earning.

export const ATTUNEMENT_RIFTS = 3;
const ATTUNEMENT_BASE_COST = 10;
const ATTUNEMENT_COST_GROWTH = 1.6;
const ATTUNEMENT_ENGINE_MULT = 2;
const ATTUNEMENT_ESSENCE = 0.05;

export const isAttunementUnlocked = () => state.rift.count >= ATTUNEMENT_RIFTS;
export const attunementCost = () =>
  D(Math.ceil(ATTUNEMENT_BASE_COST * ATTUNEMENT_COST_GROWTH ** state.rift.attunement));
export const canAttune = () => isAttunementUnlocked() && state.rift.essence.gte(attunementCost());
export function buyAttunement(): boolean {
  if (!canAttune()) return false;
  state.rift.essence = state.rift.essence.sub(attunementCost());
  state.rift.attunement++;
  emit("attunement");
  return true;
}
export const attunementEngineMult = () => D(ATTUNEMENT_ENGINE_MULT).pow(state.rift.attunement);
export const attunementEssenceMult = () => 1 + ATTUNEMENT_ESSENCE * state.rift.attunement;
