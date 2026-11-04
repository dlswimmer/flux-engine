// Headless pacing sim. Bots press Max All once a second and follow a strategy;
// the point is to find the *fastest* route so exploits show up before players do.
//
//   npm run sim                 sweep strategies for the first run to the Horizon
//   npm run sim -- run 20       play 20 Collapses with the best strategy, buying Shard upgrades
//   npm run sim -- run 20 idle  same, but never vent Heat (idle player)
//   npm run sim -- run 20 50    same, venting at 50% Heat
//   npm run sim -- trace        log every reset of one full-route first run
import { format, formatTime } from "../src/core/format";
import { deserialize, serialize } from "../src/core/save";
import { defaultState, replaceState, state } from "../src/core/state";
import { canCollapse, doCollapse, shardUpgrades } from "../src/game/collapse";
import { maxAll } from "../src/game/engines";
import { isHeatUnlocked, vent } from "../src/game/heat";
import { canLattice, doLattice } from "../src/game/lattice";
import { canOverdrive, doOverdrive } from "../src/game/overdrive";
import { tick } from "../src/game/tick";

declare const process: { argv: string[] };

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
      doLattice();
      log?.(`${formatTime(t)} Lattice ${state.lattices}`);
    } else if (state.overdrives < s.maxOverdrives && canOverdrive()) {
      doOverdrive();
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
function campaign(collapses: number, idle: boolean, ventPercent = 75) {
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
      return;
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
  }
}

const [mode = "sweep", count = "20", flag] = process.argv.slice(2);
if (mode === "run") campaign(Number(count), flag === "idle", flag && flag !== "idle" ? Number(flag) : 75);
else if (mode === "trace") {
  replaceState(defaultState());
  const t = playRun({ name: "trace", maxOverdrives: 99, maxLattices: 99, ventAt: 75 }, console.log);
  console.log(`Horizon at ${formatTime(t)}`);
}
else sweep();
