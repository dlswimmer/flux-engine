// Headless pacing sim. Bots press Max All once a second and follow a strategy;
// the point is to find the *fastest* route so exploits show up before players do.
//
//   npm run sim                 sweep strategies for the first run to the Horizon
//   npm run sim -- run 20       play 20 Collapses with the best strategy, buying Shard upgrades
//   npm run sim -- run 20 idle  same, but never vent Heat (idle player)
//   npm run sim -- run 20 50    same, venting at 50% Heat
//   npm run sim -- trace        log every reset of one full-route first run
//   npm run sim -- rift 5 order  play to Breach, then on to 5 Rifts taking the Order (or entropy) branch
import { format, formatTime } from "../src/core/format";
import { deserialize, serialize } from "../src/core/save";
import { defaultState, replaceState, state } from "../src/core/state";
import { buyMaxOvercharge, canCollapse, doCollapse, isBreached, shardGain, shardUpgrades } from "../src/game/collapse";
import { canRift, chosenBranch, doRift, essenceGain, riftNodes } from "../src/game/rift";
import { maxAll } from "../src/game/engines";
import { isHeatUnlocked, vent } from "../src/game/heat";
import { canLattice, doLattice } from "../src/game/lattice";
import { canOverdrive, doOverdrive } from "../src/game/overdrive";
import { tick } from "../src/game/tick";

declare const process: { argv: string[]; getBuiltinModule(id: string): any };

interface Strategy {
  name: string;
  /** Stop Overdriving after this many (4 = all 8 Engines, more = extra ×2s). */
  maxOverdrives: number;
  /** Lattices to take before stopping. */
  maxLattices: number;
  /** Vent when Heat reaches this %, or never. */
  ventAt: number | null;
}

const DT = 0.1;
const ACT_EVERY = 1;
const RUN_LIMIT = 3 * 60 * 60;

/** Play from the current state until the Horizon. Returns seconds taken, or Infinity. */
function playRun(s: Strategy, log?: (msg: string) => void): number {
  let t = 0;
  let sinceAct = 0;
  while (t < RUN_LIMIT) {
    tick(DT);
    t += DT;
    sinceAct += DT;
    if (s.ventAt !== null && isHeatUnlocked() && state.heat.amount >= s.ventAt) vent();
    if (sinceAct < ACT_EVERY) continue;
    sinceAct = 0;
    if (canCollapse()) return t;
    if (state.lattices < s.maxLattices && canLattice()) {
      doLattice(s.maxLattices - state.lattices);
      log?.(`${formatTime(t)} Lattice ${state.lattices}`);
    } else if (state.overdrives < s.maxOverdrives && canOverdrive()) {
      doOverdrive(s.maxOverdrives - state.overdrives);
      log?.(`${formatTime(t)} Overdrive ${state.overdrives}`);
    } else {
      maxAll();
    }
  }
  return Infinity;
}

function strategies(): Strategy[] {
  const out: Strategy[] = [];
  for (const maxOverdrives of [0, 1, 2, 3, 4, 6, 8, 12, 99]) {
    for (const maxLattices of maxOverdrives >= 4 ? [0, 1, 2, 3, 99] : [0]) {
      out.push({ name: `OD≤${maxOverdrives} L≤${maxLattices}`, maxOverdrives, maxLattices, ventAt: 75 });
    }
  }
  return out;
}

function sweep() {
  const results = strategies().map((s) => {
    replaceState(defaultState());
    const time = playRun(s);
    const reached = `${format(state.stats.bestFlux)} (OD ${state.overdrives}, L ${state.lattices}, Tempo ${state.tempo})`;
    return { s, time, reached };
  });
  results.sort((a, b) => a.time - b.time);
  console.log("First run to the Horizon, fastest first:");
  for (const { s, time, reached } of results)
    console.log(`  ${s.name.padEnd(14)} ${formatTime(time).padStart(9)}   best Flux ${reached}`);
  const best = results[0];
  const engines = Math.min(8, 4 + best.s.maxOverdrives);
  console.log(
    `\nBest: ${best.s.name} using ${engines} Engines.` +
      (engines < 8 || best.s.maxLattices === 0 ? "  ⚠ fewer Engines/no Lattice wins — rebalance!" : "  ✓"),
  );
}

/**
 * Multi-Collapse run. Each run, try a handful of routes from the same starting
 * state and keep the fastest (a player who has figured the layer out), then buy
 * the cheapest Shard upgrades.
 */
function campaign(collapses: number, idle: boolean, ventPercent = 75, stop?: () => boolean): number {
  replaceState(defaultState());
  const ventAt = idle ? null : ventPercent;
  const routes: Strategy[] = [
    [8, 0],
    [8, 1],
    [8, 2],
    [99, 3],
    [99, 99],
  ].map(([maxOverdrives, maxLattices]) => ({ name: `OD≤${maxOverdrives} L≤${maxLattices}`, maxOverdrives, maxLattices, ventAt }));
  let total = 0;
  for (let i = 0; i < collapses; i++) {
    const start = serialize(state);
    let best = { time: Infinity, s: routes[0], end: start };
    for (const s of routes) {
      replaceState(deserialize(start));
      const time = playRun(s);
      if (time < best.time) best = { time, s, end: serialize(state) };
    }
    if (!Number.isFinite(best.time)) {
      console.log(`Run ${i + 1} did not reach the Horizon within ${formatTime(RUN_LIMIT)}`);
      return total;
    }
    replaceState(deserialize(best.end));
    const time = best.time;
    total += time;
    doCollapse();
    const bought: string[] = [];
    for (;;) {
      const next = shardUpgrades.defs
        .filter((u) => shardUpgrades.canBuy(u.id))
        .sort((a, b) => Number(a.cost) - Number(b.cost))[0];
      if (!next) break;
      shardUpgrades.buy(next.id);
      bought.push(next.name);
    }
    console.log(
      `Collapse ${String(state.collapse.count).padStart(3)}  ${best.s.name.padEnd(10)} run ${formatTime(time).padStart(8)}  total ${formatTime(total).padStart(10)}  shards ${format(state.collapse.shards)}` +
        (bought.length ? `  +${bought.join(", ")}` : ""),
    );
    if (stop?.()) break;
  }
  return total;
}

const buyCheapestShardUpgrades = () => {
  for (;;) {
    const next = shardUpgrades.defs
      .filter((u) => shardUpgrades.canBuy(u.id))
      .sort((a, b) => Number(a.cost) - Number(b.cost))[0];
    if (!next || !shardUpgrades.buy(next.id)) return;
  }
};

/** Rift nodes in the order a player would take them, for one branch. */
const NODE_PLAN: Record<string, string[]> = {
  order: ["rift-lens", "head-start", "shard-focus", "even-keel", "long-burn", "self-winding"],
  entropy: ["rift-lens", "head-start", "shard-focus", "flashpoint", "backdraft", "chain-reaction"],
};

/**
 * Past Breach, fully automated (autobuyers, auto resets with default limits, Thermostat) with
 * a player who Collapses when Shards/min stops rising, spends Shards on upgrades then
 * Overcharge, and Rifts as soon as it can. Starts from a cached save at Breach.
 */
function riftCampaign(rifts: number, branch: "order" | "entropy", ventAt: number | null, riftPolicy: "asap" | "push" | number) {
  const fs = process.getBuiltinModule("node:fs");
  const cache = ".sim-cache/breach.json";
  let total = 0;
  if (fs.existsSync(cache)) {
    const saved = JSON.parse(fs.readFileSync(cache, "utf8"));
    replaceState(deserialize(saved.save));
    total = saved.total;
    console.log(`(Breach save from cache: ${formatTime(total)})`);
  } else {
    total = campaign(200, false, 75, isBreached);
    fs.mkdirSync(".sim-cache", { recursive: true });
    fs.writeFileSync(cache, JSON.stringify({ save: serialize(state), total }));
  }
  console.log(`Breach at ${formatTime(total)}, Collapse ${state.collapse.count}\n`);
  const a = state.automation;
  a.overdrive = true;
  a.lattice = true;
  const lat = process.argv.find((x) => x.startsWith("lattices="));
  if (lat) a.latticeMax = lat.slice(9) === "all" ? Infinity : Number(lat.slice(9));
  a.collapse = false; // the bot decides when to Collapse
  let sinceRift = 0;
  let collapsesThisRift = 0;
  let bestRate = 0;
  let bestEssenceRate = 0;
  let t = 0;
  while (state.rift.count < rifts && t < 6 * 3600) {
    tick(DT);
    t += DT;
    sinceRift += DT;
    if (ventAt !== null && isHeatUnlocked() && state.heat.amount >= ventAt) vent();
    if (Math.round(t / DT) % Math.round(ACT_EVERY / DT)) continue;
    maxAll();
    // "push": keep Collapsing and Overcharging while Essence per minute (of this Rift) still
    // rises; Rift once it has dropped 10% below its best.
    const essenceRate = canRift() ? essenceGain().toNumber() / sinceRift : 0;
    if (canRift()) bestEssenceRate = Math.max(bestEssenceRate, essenceRate);
    const ready =
      riftPolicy === "asap" ? true : riftPolicy === "push" ? essenceRate < bestEssenceRate * 0.9 : essenceGain().gte(riftPolicy);
    if (canRift() && ready) {
      const gain = essenceGain();
      const overcharge = state.collapse.overcharge;
      doRift();
      bestEssenceRate = 0;
      console.log(
        `Rift ${state.rift.count}  after ${formatTime(sinceRift).padStart(9)}  total ${formatTime(total + t).padStart(10)}  +${format(gain)} Essence  (${collapsesThisRift} Collapses, Overcharge ${overcharge})`,
      );
      for (const id of NODE_PLAN[branch]) riftNodes.buy(id);
      sinceRift = 0;
      collapsesThisRift = 0;
      bestRate = 0;
      buyCheapestShardUpgrades();
      continue;
    }
    if (!canCollapse()) continue;
    const rate = shardGain().toNumber() / state.collapse.time;
    if (!isBreached() || rate < bestRate * 0.97) {
      doCollapse();
      collapsesThisRift++;
      bestRate = 0;
      buyCheapestShardUpgrades();
      buyMaxOvercharge();
    } else bestRate = Math.max(bestRate, rate);
  }
  console.log(`\n${format(state.rift.totalEssence)} Essence in ${formatTime(t)} after Breach`);
  console.log(`Branch: ${chosenBranch() ?? "none"} · nodes: ${state.rift.nodes.join(", ")} · Essence left ${format(state.rift.essence)}`);
}

const [mode = "sweep", count = "20", flag] = process.argv.slice(2);
const target = process.argv.find((a) => a.startsWith("target="));
if (mode === "rift")
  riftCampaign(
    Number(count),
    flag === "entropy" ? "entropy" : "order",
    75,
    target ? Number(target.slice(7)) : process.argv.includes("push") ? "push" : "asap",
  );
else if (mode === "run") campaign(Number(count), flag === "idle", flag && flag !== "idle" ? Number(flag) : 75);
else if (mode === "trace") {
  replaceState(defaultState());
  const t = playRun({ name: "trace", maxOverdrives: 99, maxLattices: 99, ventAt: 75 }, console.log);
  console.log(`Horizon at ${formatTime(t)}`);
}
else sweep();
