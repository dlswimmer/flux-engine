// Playtest reports: how a run *feels* (waits, pace of new things), how much each
// Shard upgrade is worth, and how much attention (clicking cadence) matters.
//
//   npm run playtest                 all reports
//   npm run playtest -- cadence      run time vs how often the player acts
//   npm run playtest -- feel         event timeline + longest waits, first run and a mid-game run
//   npm run playtest -- upgrades     time saved by each Shard upgrade
//   npm run playtest -- automation   autobuyers vs holding M across the Collapse layer
import { formatTime } from "../src/core/format";
import { deserialize, serialize } from "../src/core/save";
import { ENGINE_COUNT, defaultState, replaceState, state } from "../src/core/state";
import { autobuyInterval } from "../src/game/automation";
import { canCollapse, doCollapse, shardUpgrades } from "../src/game/collapse";
import { ENGINE_NAMES, maxAll } from "../src/game/engines";
import { isHeatUnlocked, vent } from "../src/game/heat";
import { canLattice, doLattice } from "../src/game/lattice";
import { canOverdrive, doOverdrive } from "../src/game/overdrive";
import { tick } from "../src/game/tick";

declare const process: { argv: string[] };

const DT = 0.05;
const LIMIT = 2 * 60 * 60;

interface Play {
  /** Seconds between player actions (Max All + reset decisions). */
  every: number;
  maxOverdrives: number;
  maxLattices: number;
  ventAt: number | null;
  /** Don't press Max All (autobuyers only). */
  noManualBuy?: boolean;
}

interface RunResult {
  time: number;
  events: { t: number; what: string }[];
}

/** Milestone-ish things a player notices: ×2s, Tempo levels, unlocks, resets. */
function snapshot() {
  return {
    milestones: state.engines.map((e) => Math.floor(e.bought / 10)),
    owned: state.engines.map((e) => e.bought > 0),
    tempo: state.tempo,
  };
}

function playRun(p: Play, track = false): RunResult {
  const events: RunResult["events"] = [];
  let t = 0;
  let since = p.every; // act immediately
  let prev = snapshot();
  const seen = new Set<number>();
  const note = (what: string) => track && events.push({ t, what });
  while (t < LIMIT) {
    tick(DT);
    t += DT;
    since += DT;
    if (p.ventAt !== null && isHeatUnlocked() && state.heat.amount >= p.ventAt && vent()) note("vent");
    if (since + 1e-9 < p.every) continue;
    since = 0;
    if (canCollapse()) return { time: t, events };
    if (state.lattices < p.maxLattices && canLattice()) {
      doLattice();
      note(`Lattice ${state.lattices}`);
    } else if (state.overdrives < p.maxOverdrives && canOverdrive()) {
      doOverdrive();
      note(`Overdrive ${state.overdrives}`);
    } else if (!p.noManualBuy) maxAll();
    if (track) {
      const now = snapshot();
      for (let i = 0; i < ENGINE_COUNT; i++) {
        if (now.owned[i] && !prev.owned[i]) {
          if (!seen.has(i)) note(`first Engine ${ENGINE_NAMES[i]}`);
          seen.add(i);
        }
        else if (now.milestones[i] > prev.milestones[i]) note(`Engine ${ENGINE_NAMES[i]} ×2`);
      }
      if (now.tempo > prev.tempo) note("Tempo");
      prev = now;
    }
  }
  return { time: Infinity, events };
}

const ROUTES: [number, number][] = [
  [8, 0],
  [8, 1],
  [8, 2],
  [99, 3],
];

/** Fastest of the standard routes from the current state; leaves state at that route's end. */
function bestRun(base: Omit<Play, "maxOverdrives" | "maxLattices">): { time: number; route: string } {
  const start = serialize(state);
  let best = { time: Infinity, route: "", end: start };
  for (const [maxOverdrives, maxLattices] of ROUTES) {
    replaceState(deserialize(start));
    const { time } = playRun({ ...base, maxOverdrives, maxLattices });
    if (time < best.time) best = { time, route: `OD≤${maxOverdrives} L≤${maxLattices}`, end: serialize(state) };
  }
  replaceState(deserialize(best.end));
  return best;
}

function buyCheapest() {
  for (;;) {
    const next = shardUpgrades.defs
      .filter((u) => shardUpgrades.canBuy(u.id))
      .sort((a, b) => Number(a.cost) - Number(b.cost))[0];
    if (!next) return;
    shardUpgrades.buy(next.id);
  }
}

/** Save states at the start of Collapse 1..n along the default campaign. */
function campaignStates(n: number): string[] {
  replaceState(defaultState());
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(serialize(state));
    bestRun({ every: 1, ventAt: 75 });
    doCollapse();
    buyCheapest();
  }
  return out;
}

const pad = (s: string, n: number) => s.padEnd(n);
const t = (s: number) => formatTime(s).padStart(9);

function cadence() {
  console.log("Run time vs how often the player acts (best route, vent at 75%).\n");
  const states = campaignStates(20);
  for (const n of [1, 5, 10, 20]) {
    const save = states[n - 1];
    const owned = shardUpgradesOwned(save);
    console.log(`Collapse ${n}  (owns: ${owned.join(", ") || "nothing"})`);
    for (const every of [0.05, 0.25, 1, 3, 10, 30]) {
      replaceState(deserialize(save));
      const { time } = bestRun({ every, ventAt: 75 });
      console.log(`  act every ${pad(every + "s", 6)} ${t(time)}${every === 0.05 ? "   (holding M)" : ""}`);
    }
    if (owned.includes("automators")) {
      for (const every of [1, 30]) {
        replaceState(deserialize(save));
        const { time } = bestRun({ every, ventAt: 75, noManualBuy: true });
        console.log(`  autobuyers, resets every ${pad(every + "s", 4)}${t(time)}`);
      }
    }
    console.log("");
  }
}

function shardUpgradesOwned(save: string): string[] {
  return deserialize(save).collapse.upgrades;
}

function feelReport(label: string, save: string, p: Play) {
  replaceState(deserialize(save));
  const { time, events } = playRun(p, true);
  console.log(`${label}: Horizon at ${formatTime(time)}`);
  const big = events.filter((e) => e.what !== "vent");
  // Bucket notable events per minute so dead stretches stand out.
  const gaps: { from: number; to: number; len: number }[] = [];
  let last = 0;
  for (const e of big) {
    gaps.push({ from: last, to: e.t, len: e.t - last });
    last = e.t;
  }
  gaps.push({ from: last, to: time, len: time - last });
  const sorted = [...gaps].sort((a, b) => b.len - a.len);
  console.log(`  ${big.length} notable events (×2s, Tempo, unlocks, resets); median wait ${formatTime(median(gaps.map((g) => g.len)))}`);
  console.log("  Longest waits with nothing new:");
  for (const g of sorted.slice(0, 5)) console.log(`    ${t(g.len)}   ${formatTime(g.from)} → ${formatTime(g.to)}`);
  console.log("  Resets:");
  for (const e of events.filter((e) => /Overdrive|Lattice|first/.test(e.what)))
    console.log(`    ${t(e.t)}  ${e.what}`);
  const perMinute = new Array(Math.ceil(time / 60)).fill(0);
  for (const e of big) perMinute[Math.floor(e.t / 60)]++;
  console.log(`  Events per minute: ${perMinute.join(" ")}\n`);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

function feel() {
  const states = campaignStates(10);
  feelReport("First run", states[0], { every: 1, maxOverdrives: 8, maxLattices: 1, ventAt: 75 });
  feelReport("Collapse 10", states[9], { every: 1, maxOverdrives: 8, maxLattices: 1, ventAt: 75 });
}

function upgrades() {
  const ids = shardUpgrades.defs.map((d) => d.id).filter((id) => id !== "breach");
  const timeWith = (save: string, owned: string[], count: number) => {
    const s = deserialize(save);
    s.collapse.upgrades = owned;
    s.collapse.count = count;
    s.collapse.shards = s.collapse.shards.mul(0);
    if (owned.includes("ignition")) s.overdrives = 1;
    replaceState(s);
    return bestRun({ every: 1, ventAt: 75 }).time;
  };

  for (const count of [1, 3]) {
    const base = serialize(defaultState());
    const none = timeWith(base, [], count);
    console.log(`Only one upgrade, at Collapse ${count} (no upgrades: ${formatTime(none)})`);
    const rows = ids
      .filter((id) => !shardUpgrades.get(id).requires)
      .map((id) => ({ id, time: timeWith(base, [id], count) }))
      .sort((a, b) => a.time - b.time);
    for (const r of rows)
      console.log(`  ${pad(shardUpgrades.get(r.id).name, 15)} cost ${shardUpgrades.get(r.id).cost}  ${t(r.time)}  ${pct(none, r.time)}`);
    console.log("");
  }

  for (const count of [6, 15]) {
    const base = serialize(defaultState());
    const all = timeWith(base, ids, count);
    console.log(`Everything but one, at Collapse ${count} (all: ${formatTime(all)})`);
    const rows = ids
      .map((id) => ({ id, time: timeWith(base, ids.filter((x) => x !== id), count) }))
      .sort((a, b) => b.time - a.time);
    for (const r of rows)
      console.log(`  without ${pad(shardUpgrades.get(r.id).name, 15)} ${t(r.time)}  ${pct(r.time, all)} faster with it`);
    console.log("");
  }
}

const pct = (slow: number, fast: number) => `${(((slow - fast) / slow) * 100).toFixed(0).padStart(3)}%`;

/**
 * Autobuyers should start behind a player holding M and overtake them late in the
 * Collapse layer. The player still makes the reset calls (every 1s) in both columns,
 * so this compares buying only.
 */
function automation() {
  console.log("Autobuyers vs a player holding M (acting every tick). Autobuyer runs: player only resets, once a second.\n");
  console.log("Collapse  interval   hold M   press M 1/s   autobuyers   auto vs hold M");
  const checkpoints = [5, 10, 15, 20, 25, 30, 35];
  const states = campaignStates(Math.max(...checkpoints));
  for (const n of checkpoints) {
    const save = states[n - 1];
    replaceState(deserialize(save));
    if (!shardUpgrades.has("automators")) continue;
    const interval = autobuyInterval();
    const run = (p: Omit<Play, "maxOverdrives" | "maxLattices">) => {
      replaceState(deserialize(save));
      return bestRun(p).time;
    };
    // Holding M: the player buys every tick; autobuyers are switched off so they don't help.
    const holdSave = deserialize(save);
    holdSave.automation.engines = holdSave.automation.engines.map(() => false);
    holdSave.automation.tempo = false;
    replaceState(holdSave);
    const hold = bestRun({ every: 0.05, ventAt: 75 }).time;
    const press = run({ every: 1, ventAt: 75 });
    const auto = run({ every: 1, ventAt: 75, noManualBuy: true });
    const oc = shardUpgrades.has("overclock") ? " (Overclock)" : "";
    console.log(
      `${String(n).padStart(8)}  ${(interval.toFixed(2) + "s").padStart(8)}  ${t(hold)}  ${t(press).padStart(12)}  ${t(auto).padStart(11)}   ${(auto / hold).toFixed(2)}×${oc}`,
    );
  }
}

const [mode = "all"] = process.argv.slice(2);
if (mode === "automation") automation();
if (mode === "cadence" || mode === "all") cadence();
if (mode === "feel" || mode === "all") feel();
if (mode === "upgrades" || mode === "all") upgrades();
