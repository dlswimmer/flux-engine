// Balance report: whole-game playthroughs under different player styles (milestone times),
// and what each upgrade is worth.
//
//   npm run report                  everything
//   npm run report -- milestones    strategy comparison, fresh save to 5 Rifts
//   npm run report -- shards        Shard upgrades: time saved before Breach, Shards/min after
//   npm run report -- rift          Overcharge levels and Rift nodes: Shards/min after Breach
import { formatTime } from "../src/core/format";
import { deserialize, serialize } from "../src/core/save";
import { defaultState, replaceState, state } from "../src/core/state";
import {
  buyMaxOvercharge,
  canCollapse,
  doCollapse,
  isBreached,
  shardGain,
  shardUpgrades,
} from "../src/game/collapse";
import { maxAll } from "../src/game/engines";
import { isHeatUnlocked, vent } from "../src/game/heat";
import { canLattice, doLattice } from "../src/game/lattice";
import { canOverdrive, doOverdrive } from "../src/game/overdrive";
import { canRift, doRift, essenceGain, riftNodes } from "../src/game/rift";
import { tick } from "../src/game/tick";

declare const process: { argv: string[] };

const DT = 0.1;

export interface Player {
  name: string;
  /** Seconds between the player's actions (Max All, resets, buying, Collapsing). */
  every: number;
  /** Vent by hand at this Heat %, or never (Thermostat still vents once bought). */
  ventAt: number | null;
  /** Shard upgrades in buy order; anything not listed is bought cheapest-first after. */
  upgradeOrder: string[];
  /** Lattices per run, before and after Latticeworks. */
  lattices: [number, number];
  /** Rift once a Rift gives this much Essence. */
  riftAt: number;
  branch: "order" | "entropy";
}

const NODE_PLAN = {
  order: ["rift-lens", "head-start", "shard-focus", "even-keel", "long-burn", "self-winding"],
  entropy: ["rift-lens", "head-start", "shard-focus", "flashpoint", "backdraft", "chain-reaction"],
};

function buyUpgrades(order: string[]) {
  for (;;) {
    const next =
      order.find((id) => shardUpgrades.canBuy(id)) ??
      shardUpgrades.defs.filter((u) => shardUpgrades.canBuy(u.id)).sort((a, b) => Number(a.cost) - Number(b.cost))[0]?.id;
    // Stop at the first wanted-but-unaffordable upgrade in the order (save up for it).
    const wanted = order.find((id) => !shardUpgrades.has(id) && shardUpgrades.isAvailable(id));
    if (wanted && next !== wanted && !shardUpgrades.canBuy(wanted)) return;
    if (!next || !shardUpgrades.buy(next)) return;
  }
}

/**
 * Plays from a fresh save until `rifts` Rifts (or a time limit). Returns milestone times.
 * Collapses at the Horizon before Breach, at the Shards/min peak after; Rifts at `riftAt`.
 */
export function playthrough(p: Player, rifts = 5, limit = 8 * 3600): Record<string, number> {
  replaceState(defaultState());
  const ms: Record<string, number> = {};
  const mark = (name: string) => (ms[name] ??= t);
  let t = 0;
  let since = 0;
  let bestRate = 0;
  const actEvery = Math.round(p.every / DT);
  let step = 0;
  while (t < limit && state.rift.count < rifts) {
    tick(DT);
    t += DT;
    step++;
    if (p.ventAt !== null && isHeatUnlocked() && state.heat.amount >= p.ventAt) vent();
    if (step % actEvery) continue;
    since = 0;

    // Rift layer
    if (canRift() && essenceGain().gte(p.riftAt)) {
      doRift();
      mark(`Rift ${state.rift.count}`);
      for (const id of NODE_PLAN[p.branch]) riftNodes.buy(id);
      if (NODE_PLAN[p.branch].every((id) => riftNodes.has(id))) mark("Tree done");
      buyUpgrades(p.upgradeOrder);
      bestRate = 0;
      continue;
    }

    // Collapse layer
    // Spending and milestones every action: auto-Collapse may have Collapsed in between.
    const spend = () => {
      const c = state.collapse.count;
      if (c >= 1) mark("Collapse 1");
      // How long the first Collapse after Rift 1 takes (a duration, not a time stamp).
      if (state.rift.count === 1 && c >= 1 && ms["Rift 1"] !== undefined && ms["1st Collapse after R1"] === undefined)
        ms["1st Collapse after R1"] = t - ms["Rift 1"];
      if (c >= 10) mark("Collapse 10");
      buyUpgrades(p.upgradeOrder);
      if (shardUpgrades.has("automators")) mark("Automators");
      if (shardUpgrades.has("automators2")) mark("Foreman");
      if (shardUpgrades.has("selfcollapse")) mark("Self-Collapse");
      if (isBreached()) mark("Breach");
      buyMaxOvercharge();
    };
    spend();
    if (canCollapse() && !(p.every > 1 && shardUpgrades.has("selfcollapse"))) {
      const rate = shardGain().toNumber() / state.collapse.time;
      if (!isBreached() || rate < bestRate * 0.97) {
        doCollapse();
        bestRate = 0;
        spend();
        continue;
      }
      bestRate = Math.max(bestRate, rate);
    }

    // Inside a run: the player handles resets until Foreman does, and presses Max All.
    const latMax = shardUpgrades.has("latticeworks") ? p.lattices[1] : p.lattices[0];
    if (shardUpgrades.has("automators2")) {
      const a = state.automation;
      a.overdrive = a.lattice = true;
      a.overdriveMax = 10;
      a.latticeMax = latMax;
      // Active players time Collapses for Shards/min; casual ones leave it to auto-Collapse.
      a.collapse = p.every > 1;
    } else if (state.lattices < latMax && canLattice()) doLattice();
    else if (state.overdrives < 8 && canOverdrive()) doOverdrive();
    maxAll();
  }
  void since;
  ms["(end)"] = t;
  return ms;
}

const BASE: Player = {
  name: "Active (baseline)",
  every: 1,
  ventAt: 75,
  upgradeOrder: [],
  lattices: [1, 1],
  riftAt: 4,
  branch: "order",
};

const MILESTONES = ["Collapse 1", "Automators", "Breach", "Rift 1", "1st Collapse after R1", "Rift 2", "Rift 3", "Rift 5", "Tree done"];

function milestones(players: Player[]) {
  const t = (s?: number) => (s === undefined ? "—" : formatTime(s)).padStart(13);
  console.log("Game time at each milestone (fresh save, up to 5 Rifts / 8h):\n");
  console.log("".padEnd(26) + MILESTONES.map((m) => (m === "1st Collapse after R1" ? "R1→Collapse" : m).padStart(13)).join(""));
  for (const p of players) {
    const ms = playthrough(p);
    console.log(p.name.padEnd(26) + MILESTONES.map((m) => t(ms[m])).join(""));
  }
}

// ---------- Upgrade worth ----------

/** Seconds for one run to the Horizon from `save`, with a 1s-cadence player. */
function runTime(save: string, every = 1): number {
  replaceState(deserialize(save));
  let t = 0;
  let step = 0;
  while (t < 3 * 3600) {
    tick(DT);
    t += DT;
    if (++step % Math.round(every / DT)) continue;
    if (canCollapse()) return t;
    if (state.lattices < 1 && canLattice()) doLattice();
    else if (state.overdrives < 8 && canOverdrive()) doOverdrive();
    maxAll();
  }
  return Infinity;
}

function stateWith(upgrades: string[], count: number, extra?: (s: ReturnType<typeof defaultState>) => void): string {
  const s = defaultState();
  s.collapse.upgrades = [...upgrades];
  s.collapse.count = count;
  if (upgrades.includes("ignition")) s.overdrives = 1;
  s.automation.collapse = false;
  extra?.(s);
  return serialize(s);
}

const pct = (without: number, withIt: number) => `${(((without - withIt) / without) * 100).toFixed(0).padStart(4)}%`;

/** Shards per minute over 10 minutes of post-Breach play (Collapsing at the Shards/min peak). */
function shardsPerMinute(save: string, minutes = 10): number {
  replaceState(deserialize(save));
  const a = state.automation;
  a.overdrive = a.lattice = true;
  a.latticeMax = 3;
  a.collapse = false;
  const start = state.collapse.shards;
  let earned = 0;
  let t = 0;
  let bestRate = 0;
  let step = 0;
  while (t < minutes * 60) {
    tick(DT);
    t += DT;
    if (++step % 10) continue;
    maxAll();
    if (!canCollapse()) continue;
    const rate = shardGain().toNumber() / state.collapse.time;
    if (rate < bestRate * 0.97) {
      earned += shardGain().toNumber();
      doCollapse();
      bestRate = 0;
    } else bestRate = Math.max(bestRate, rate);
  }
  void start;
  return earned / minutes;
}

function shardReport() {
  const ids = shardUpgrades.defs.map((d) => d.id);
  const pre = ids.filter((id) => id !== "breach");
  console.log("Shard upgrades before Breach: run time to the Horizon (1s-cadence player)\n");
  for (const count of [10, 25]) {
    const all = runTime(stateWith(pre, count));
    console.log(`  Collapse ${count}, everything: ${formatTime(all)}`);
    const rows = pre
      .map((id) => ({ id, time: runTime(stateWith(pre.filter((x) => x !== id), count)) }))
      .sort((a, b) => b.time - a.time);
    for (const r of rows)
      console.log(`    without ${shardUpgrades.get(r.id).name.padEnd(15)} cost ${String(shardUpgrades.get(r.id).cost).padStart(2)}  ${formatTime(r.time).padStart(8)} ${pct(r.time, all)} faster with it`);
    console.log("");
  }
  console.log("Shard upgrades after Breach: Shards per minute (Collapse 50, Overcharge 15)\n");
  const all = shardsPerMinute(stateWith(ids, 50, (s) => (s.collapse.overcharge = 15)));
  console.log(`  everything: ${all.toFixed(1)} Shards/min`);
  const rows = ids
    .filter((id) => !["breach", "prism"].includes(id))
    .map((id) => ({ id, rate: shardsPerMinute(stateWith(ids.filter((x) => x !== id), 50, (s) => (s.collapse.overcharge = 15))) }))
    .sort((a, b) => a.rate - b.rate);
  for (const r of rows)
    console.log(`    without ${shardUpgrades.get(r.id).name.padEnd(15)} ${r.rate.toFixed(1).padStart(7)}/min  (${(((all - r.rate) / all) * 100).toFixed(0)}% of income)`);
}

function riftReport() {
  const ids = shardUpgrades.defs.map((d) => d.id);
  console.log("Overcharge: Shards per minute by level (Collapse 50, all Shard upgrades)\n");
  for (const oc of [0, 5, 10, 15, 20, 25, 30])
    console.log(`  Overcharge ${String(oc).padStart(2)}: ${shardsPerMinute(stateWith(ids, 50, (s) => (s.collapse.overcharge = oc)), 5).toFixed(1).padStart(8)} Shards/min`);

  console.log("\nRift nodes: Shards per minute, adding one node at a time (Collapse 50, Overcharge 15, 1 Rift)\n");
  for (const branch of ["order", "entropy"] as const) {
    let owned: string[] = [];
    const base = (nodes: string[]) =>
      shardsPerMinute(
        stateWith(ids, 50, (s) => {
          s.collapse.overcharge = 15;
          s.rift.count = 1;
          s.rift.totalEssence = s.rift.totalEssence.add(10);
          s.rift.nodes = nodes;
          if (nodes.includes("head-start")) s.overdrives = 4;
        }),
        5,
      );
    let prev = base([]);
    console.log(`  ${branch}: none ${prev.toFixed(1)}/min`);
    for (const id of NODE_PLAN[branch]) {
      owned = [...owned, id];
      const now = base(owned);
      const cost = Number(riftNodes.get(id).cost);
      console.log(`    + ${riftNodes.get(id).name.padEnd(15)} cost ${String(cost).padStart(2)}  ${now.toFixed(1).padStart(8)}/min  ×${(now / prev).toFixed(2)}`);
      prev = now;
    }
  }
}

const mode = process.argv[2] ?? "all";
const VALUE_ORDER = process.argv.find((a) => a.startsWith("order="))?.slice(6).split(",") ?? [];
const only = process.argv.includes("only-order");
if (mode === "milestones" || mode === "all")
  milestones([
    ...(only
      ? [BASE, { ...BASE, name: "Casual (acts every 10s)", every: 10, ventAt: null }]
      : [
          BASE,
          { ...BASE, name: "Casual (acts every 10s)", every: 10, ventAt: null },
          { ...BASE, name: "Active, no manual venting", ventAt: null },
          { ...BASE, name: "Rift ASAP (1 Essence)", riftAt: 1 },
          { ...BASE, name: "Rift big (8 Essence)", riftAt: 8 },
          { ...BASE, name: "Entropy branch", branch: "entropy" as const },
          { ...BASE, name: "3 Lattices after LW", lattices: [1, 3] as [number, number] },
        ]),
    ...(VALUE_ORDER.length
      ? [
          { ...BASE, name: "Value-first upgrades", upgradeOrder: VALUE_ORDER },
          { ...BASE, name: "Casual, value-first", every: 10, ventAt: null, upgradeOrder: VALUE_ORDER },
        ]
      : []),
  ]);
if (mode === "shards" || mode === "all") shardReport();
if (mode === "rift" || mode === "all") riftReport();
