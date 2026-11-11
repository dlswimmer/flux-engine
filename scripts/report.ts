// Balance report: whole-game playthroughs under different player styles (milestone times),
// and what each upgrade is worth.
//
//   npm run report                  everything
//   npm run report -- milestones    strategy comparison, fresh save to 5 Rifts
//   npm run report -- shards        Shard upgrades: time saved before Breach, Shards/min after
//   npm run report -- rift          Overcharge levels and Rift nodes: Shards/min after Breach
//   npm run report -- trials        Trial run times at milestones, whole game with/without Trials
//                                   ("table" or "game" for one half, "late" for saves before Rifts 2-5)
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
import { simulate } from "../src/core/loop";
import { resetForCollapse as resetForCollapseExport } from "../src/game/reset";
import { BREACH_TRIALS, TRIALS, abandonTrial, activeTrial, hasTrialReward, isTrialAvailable, startTrial, type TrialId } from "../src/game/trials";
import { totalCollapses } from "../src/game/collapse";

declare const process: { argv: string[]; env: Record<string, string | undefined> };

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
  /** Play the Collapse Trials in order as they open (giving up on one after TRIAL_GIVE_UP). */
  trials?: boolean;
  /**
   * Plays in sessions: `play` seconds at the `every` cadence, then away for `away` seconds. Away
   * time runs through the game's own catch-up: "closed" = one offline catch-up on return (app or
   * tab closed, max 1000 steps), "background" = a hidden tab, caught up once a minute.
   */
  session?: { play: number; away: number; mode: "closed" | "background" };
  /** Stop once Breach is bought (pacing checks for the Collapse layer). */
  stopAtBreach?: boolean;
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
export function playthrough(
  p: Player,
  rifts = 5,
  limit = 8 * 3600,
  /** Called once per milestone, right when it's reached (used to capture dev saves). */
  onMark?: (name: string, time: number) => void,
): Record<string, number> {
  replaceState(defaultState());
  const ms: Record<string, number> = {};
  const mark = (name: string) => {
    if (ms[name] !== undefined) return;
    ms[name] = t;
    onMark?.(name, t);
  };
  let t = 0;
  let since = 0;
  let bestRate = 0;
  let trialStart = 0;
  const retryAt: Partial<Record<TrialId, { rift: number; upgrades: number }>> = {};
  const actEvery = Math.round(p.every / DT);
  let step = 0;
  let awayTime = 0;
  while (t < limit && state.rift.count < rifts) {
    if (p.session) {
      const cycle = p.session.play + p.session.away;
      const pos = t % cycle;
      if (pos >= p.session.play - DT / 2) {
        const away = Math.max(DT, cycle - pos);
        if (p.session.mode === "closed") simulate(away);
        else for (let left = away; left > 0; left -= 60) simulate(Math.min(60, left));
        t += away;
        awayTime += away;
        step = -1; // act right on return
      }
    }
    tick(DT);
    t += DT;
    step++;
    if (p.ventAt !== null && isHeatUnlocked() && state.heat.amount >= p.ventAt) vent();
    if (step % actEvery) continue;
    since = 0;
    if (p.stopAtBreach && isBreached()) break;

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

    // Trials: start the next one at the top of a run; give up after TRIAL_GIVE_UP and retry
    // after the next Rift or 3 more Shard upgrades (once the player is stronger). Every player plays the ones Breach needs; `trials` plays all.
    {
      const active = activeTrial();
      if (active && t - trialStart > TRIAL_GIVE_UP) {
        abandonTrial();
        retryAt[active] = { rift: state.rift.count + 1, upgrades: state.collapse.upgrades.length + 3 };
      } else if (!active) {
        // Before Breach only the Trials it needs (the rest are out of reach until after a Rift or two).
        // Sprint and Hollow Core are out of reach until after Rift 2.
        const wanted = (d: (typeof TRIALS)[number]) =>
          BREACH_TRIALS.includes(d.id) || (!!p.trials && isBreached() && state.rift.count >= 2);
        const ready = (id: TrialId) => {
          const r = retryAt[id];
          return !r || state.rift.count >= r.rift || state.collapse.upgrades.length >= r.upgrades;
        };
        // Fixed Tempo needs fast resets: a player who has tried it waits for the Overdrive autobuyer.
        const strongEnough = (id: TrialId) => id !== "fixed" || shardUpgrades.has("automators2");
        const next = TRIALS.find(
          (d) => wanted(d) && !hasTrialReward(d.id) && isTrialAvailable(d.id) && ready(d.id) && strongEnough(d.id),
        );
        if (next && startTrial(next.id)) trialStart = t;
      }
    }

    // Collapse layer
    // Spending and milestones every action: auto-Collapse may have Collapsed in between.
    const spend = () => {
      const c = state.collapse.count;
      if (c >= 1) mark("Collapse 1");
      if (c >= 3) mark("Collapse 3");
      // How long the first Collapse after Rift 1 takes (a duration, not a time stamp).
      if (state.rift.count === 1 && c >= 1 && ms["Rift 1"] !== undefined && ms["1st Collapse after R1"] === undefined)
        ms["1st Collapse after R1"] = t - ms["Rift 1"];
      if (c >= 10) mark("Collapse 10");
      if (totalCollapses() >= 15) mark("Collapse 15");
      for (const d of TRIALS) if (hasTrialReward(d.id)) mark(`Trial ${d.name}`);
      if (c >= 1) mark(`#${c}`);
      if (TRIALS.every((d) => hasTrialReward(d.id))) mark("All Trials");
      buyUpgrades(p.upgradeOrder);
      for (const id of state.collapse.upgrades) if (state.rift.count === 0) mark(`+${id}`);
      if (shardUpgrades.has("auto1")) mark("Automators");
      if (shardUpgrades.has("bulk")) mark("Bulk");
      if (shardUpgrades.has("automators2")) mark("Foreman");
      if (shardUpgrades.has("selfcollapse")) mark("Self-Collapse");
      if (isBreached()) mark("Breach");
      buyMaxOvercharge();
    };
    spend();
    // Before Self-Collapse the bot Collapses by hand; after it, auto-Collapse (Shards/min peak,
    // checked every tick) does it, like a real player would set it up.
    if (canCollapse() && !shardUpgrades.has("selfcollapse")) {
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
    const a = state.automation;
    a.overdriveMax = 10;
    a.latticeMax = latMax;
    a.collapse = true;
    a.collapseShards = 0;
    a.overdrive = shardUpgrades.has("automators2");
    a.lattice = shardUpgrades.has("autolattice");
    // By hand, whatever isn't automated yet (the Lattice autobuyer goes first, so an Overdrive
    // by hand would only be reset by it).
    if (!a.lattice && state.lattices < latMax && canLattice()) doLattice(latMax - state.lattices);
    else if (!a.overdrive && state.overdrives < 8 && canOverdrive()) doOverdrive(8 - state.overdrives);
    maxAll();
  }
  void since;
  ms["(end)"] = t;
  ms["(played)"] = t - awayTime;
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

const TRIAL_GIVE_UP = Number(process.env.GIVEUP ?? 45) * 60;

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
    if (state.lattices < 1 && canLattice()) doLattice(1 - state.lattices);
    else if (state.overdrives < 8 && canOverdrive()) doOverdrive(8 - state.overdrives);
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

/**
 * Dev saves: the baseline player's save at each milestone, written to src/dev/milestoneSaves.ts
 * for Options → Dev → "Jump to". Regenerate after balance changes: npm run report -- devsaves
 */
function devSaves() {
  const wanted: Record<string, string> = {
    "Collapse 1": "Just after your first Collapse: 1 Shard, nothing bought",
    "Collapse 3": "Heat just unlocked",
    Automators: "First autobuyer (Engine I) just bought",
    Foreman: "Overdrive autobuyer just bought",
    Breach: "Breach just bought: Overcharge and the road to the Rift",
    "Rift 1": "Just after your first Rift",
    "Rift 2": "Just after your second Rift",
    "Rift 4": "Just after your fourth Rift (all Shard upgrades kept)",
  };
  const out: { name: string; desc: string; time: number; save: string }[] = [];
  playthrough(BASE, 4, 8 * 3600, (name, time) => {
    if (wanted[name]) out.push({ name, desc: wanted[name], time, save: serialize(state) });
  });
  const fs = (process as unknown as { getBuiltinModule(id: string): any }).getBuiltinModule("node:fs");
  const body =
    [
      "// Generated by `npm run report -- devsaves` from the baseline player bot. Don't edit by hand.",
      "// Loaded lazily by Options → Dev → Jump to, so it isn't part of the main bundle.",
      "export const MILESTONE_SAVES: { name: string; desc: string; time: number; save: string }[] = " +
        JSON.stringify(out, null, 1) +
        ";",
      "",
    ].join("\n");
  fs.mkdirSync("src/dev", { recursive: true });
  fs.writeFileSync("src/dev/milestoneSaves.ts", body);
  console.log(`Wrote ${out.length} milestone saves: ${out.map((o) => `${o.name} (${formatTime(o.time)})`).join(", ")}`);
}

// ---------- Trials ----------

/** One run from a fresh Collapse (or Trial) to the next Collapse, 1s-cadence bot. Infinity = gave up. */
function oneRun(save: string, trial: TrialId | null, limit = TRIAL_GIVE_UP): number {
  replaceState(deserialize(save));
  // Saves captured mid-run: start clean. Trials need their prerequisites, so pretend they are won.
  if (trial) {
    // Trials are played in order, so the earlier ones' rewards are already won.
    state.trials.completed = TRIALS.slice(0, TRIALS.findIndex((d) => d.id === trial)).map((d) => d.id);
    if (!startTrial(trial)) return NaN;
  } else resetForCollapseExport();
  const a = state.automation;
  a.overdrive = shardUpgrades.has("automators2");
  a.lattice = shardUpgrades.has("autolattice");
  a.overdriveMax = 10;
  a.latticeMax = shardUpgrades.has("latticeworks") ? 3 : 1;
  a.collapse = true;
  a.collapseShards = 0;
  const start = state.collapse.count;
  let t = 0;
  let step = 0;
  while (t < limit) {
    tick(DT);
    t += DT;
    if (state.collapse.count > start) return t;
    if (isHeatUnlocked() && state.heat.amount >= 75) vent();
    if (++step % 10) continue;
    if (canCollapse() && !(isBreached() && shardUpgrades.has("selfcollapse"))) {
      doCollapse();
      return t;
    }
    if (!a.lattice && state.lattices < 1 && canLattice()) doLattice(1 - state.lattices);
    else if (!a.overdrive && state.overdrives < 8 && canOverdrive()) doOverdrive(8 - state.overdrives);
    maxAll();
  }
  return Infinity;
}

function trialsReport() {
  if (!process.argv.includes("game")) trialTable();
  if (!process.argv.includes("table")) trialGame();
}

function trialTable() {
  const late = process.argv.includes("late");
  const wanted = late ? ["Rift 3", "Rift 4", "Rift 5"] : ["Collapse 15", "Foreman", "Breach", "Rift 1", "Rift 2", "Rift 3"];
  const saves: Record<string, string> = {};
  const ms = playthrough(BASE, late ? 5 : 3, 8 * 3600, (name) => {
    if (wanted.includes(name)) saves[name] = serialize(state);
  });
  if (late) {
    // Just before each Rift: the strongest point of that Rift (right after one, runs are slow again).
    wanted.length = 0;
    for (const r of [2, 3, 4, 5]) {
      playthrough(BASE, r, ms[`Rift ${r}`] - 1);
      saves[`Before Rift ${r}`] = serialize(state);
      wanted.push(`Before Rift ${r}`);
    }
  }
  const cell = (x: number) => (Number.isFinite(x) ? formatTime(x) : `> ${TRIAL_GIVE_UP / 60}m`).padStart(12);
  console.log(`Trial run times (one run from a fresh Collapse, 1s bot; > ${TRIAL_GIVE_UP / 60}m = gave up):\n`);
  console.log("".padEnd(14) + ["Normal run", ...TRIALS.map((d) => d.name)].map((n) => n.padStart(12)).join(""));
  for (const name of wanted) {
    if (!saves[name]) continue;
    const row = [oneRun(saves[name], null), ...TRIALS.map((d) => oneRun(saves[name], d.id))];
    console.log(name.padEnd(14) + row.map(cell).join(""));
  }
}

function trialGame() {
  console.log("\nWhole game, Trials on vs off (Active baseline):\n");
  const marks = ["Collapse 15", ...TRIALS.map((d) => `Trial ${d.name}`), "All Trials", "Breach", "Rift 1", "1st Collapse after R1", "Rift 2", "Rift 3", "Rift 5"];
  for (const p of [BASE, { ...BASE, name: "Active + Trials", trials: true }]) {
    const ms = playthrough(p);
    console.log(p.name);
    console.log("  " + marks.filter((m) => ms[m] !== undefined).map((m) => `${m.replace("Trial ", "")} ${formatTime(ms[m])}`).join(" · "));
  }
}

const mode = process.argv[2] ?? "all";
if (mode === "trials") trialsReport();
if (mode === "devsaves") devSaves();
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

// ---------- Player profiles ----------

/**
 * Whole-game pacing for different kinds of players, in real (wall-clock) time, plus how much of
 * it they actually spent playing. `npm run report -- profiles` (or `profiles 3` for one row).
 */
const H = 3600;
const PROFILES: (Player & { limit: number })[] = [
  { ...BASE, name: "Hardcore (acts every 0.2s)", every: 0.2, branch: "entropy", limit: 8 * H },
  { ...BASE, name: "Hardcore + Trials", every: 0.2, branch: "entropy", trials: true, limit: 8 * H },
  { ...BASE, name: "Active, Order (1s)", limit: 8 * H },
  { ...BASE, name: "Active, Entropy (1s)", branch: "entropy", limit: 8 * H },
  { ...BASE, name: "Active + Trials (1s)", trials: true, limit: 10 * H },
  { ...BASE, name: "Relaxed (every 10s, no venting)", every: 10, ventAt: null, limit: 12 * H },
  { ...BASE, name: "Tab open, acts every 5 min", every: 300, ventAt: null, limit: 72 * H },
  {
    ...BASE,
    name: "Casual: 5 min every 30 min",
    session: { play: 5 * 60, away: 25 * 60, mode: "closed" },
    limit: 7 * 24 * H,
  },
  {
    ...BASE,
    name: "Casual, tab left open",
    session: { play: 5 * 60, away: 25 * 60, mode: "background" },
    limit: 7 * 24 * H,
  },
  {
    ...BASE,
    name: "Commuter: 15 min every 4h",
    session: { play: 15 * 60, away: 4 * H - 15 * 60, mode: "closed" },
    limit: 14 * 24 * H,
  },
  {
    ...BASE,
    name: "AFK: 2 min every 2h",
    ventAt: null,
    session: { play: 2 * 60, away: 2 * H - 2 * 60, mode: "closed" },
    limit: 21 * 24 * H,
  },
  {
    ...BASE,
    name: "AFK, automation first",
    ventAt: null,
    upgradeOrder: ["auto1", "auto2", "auto3", "auto4", "autotempo", "auto5", "auto6", "auto7", "auto8", "bulk", "automators2", "selfcollapse"],
    session: { play: 2 * 60, away: 2 * H - 2 * 60, mode: "closed" },
    limit: 21 * 24 * H,
  },
];

const PROFILE_MARKS = ["Collapse 1", "Automators", "Self-Collapse", "Breach", "Rift 1", "Rift 2", "Rift 3", "Rift 5", "Tree done"];

function profiles() {
  const pick = process.argv[3] === undefined ? null : Number(process.argv[3]);
  const fmt = (s?: number) => (s === undefined ? "—" : formatTime(s)).padStart(14);
  if (pick === null) console.log("".padEnd(34) + PROFILE_MARKS.map((m) => m.padStart(14)).join("") + "     played");
  PROFILES.forEach((p, i) => {
    if (pick !== null && pick !== i) return;
    const ms = playthrough(p, 5, process.env.LIMIT ? Number(process.env.LIMIT) * 3600 : p.limit);
    const extra = ms["Rift 5"] === undefined ? `  (stopped at ${formatTime(ms["(end)"])})` : "";
    console.log(p.name.padEnd(34) + PROFILE_MARKS.map((m) => fmt(ms[m])).join("") + fmt(ms["(played)"]) + extra);
    const trials = TRIALS.filter((d) => ms[`Trial ${d.name}`] !== undefined).map((d) => `${d.name} ${formatTime(ms[`Trial ${d.name}`])}`);
    if (trials.length) console.log("".padEnd(34) + "Trials won: " + trials.join(" · "));
  });
}
if (mode === "profiles") profiles();

/** The Collapse layer for three cadences: when each upgrade is bought, up to Breach. */
function breachPacing() {
  const players: Player[] = [
    { ...BASE, name: "Active (1s)" },
    { ...BASE, name: "Hardcore (0.2s)", every: 0.2 },
    { ...BASE, name: "Relaxed (10s, no venting)", every: 10, ventAt: null },
  ];
  const pick = process.argv[3];
  for (const p of players) {
    if (pick && !p.name.toLowerCase().startsWith(pick)) continue;
    let collapsesAtBreach = 0;
    const ms = playthrough({ ...p, stopAtBreach: true }, 1, 12 * 3600, (name) => {
      if (name === "Breach") collapsesAtBreach = state.collapse.count;
    });
    console.log(`${p.name}: Collapse 1 ${formatTime(ms["Collapse 1"])} · Breach ${ms.Breach === undefined ? "—" : formatTime(ms.Breach)} (Collapse ${collapsesAtBreach})`);
    const runs = Object.entries(ms).filter(([k]) => k.startsWith("#")).map(([k, v]) => [Number(k.slice(1)), v] as const);
    const runTimes = runs.map(([n, v], i) => `${n}:${Math.round(v - (i ? runs[i - 1][1] : 0))}s`);
    if (process.argv.includes("runs")) console.log("  runs " + runTimes.join(" "));
    const trials = TRIALS.filter((d) => ms[`Trial ${d.name}`] !== undefined).map((d) => `${d.name} ${formatTime(ms[`Trial ${d.name}`])}`);
    console.log("  Trials: " + trials.join(" · "));
    const buys = Object.entries(ms)
      .filter(([k]) => k.startsWith("+"))
      .sort((a, b) => a[1] - b[1])
      .map(([k, v]) => `${shardUpgrades.get(k.slice(1)).name} ${formatTime(v)}`);
    console.log("  " + buys.join(" · ") + "\n");
  }
}
if (mode === "breach") breachPacing();
