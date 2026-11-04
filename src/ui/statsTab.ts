import { format, formatTime } from "../core/format";
import { COLLAPSE_HISTORY, RIFT_HISTORY, state } from "../core/state";
import { autobuyInterval, hasEngineAutobuyers } from "../game/automation";
import { canCollapse, overchargeMult, shardGain, shardUpgrades, totalCollapses } from "../game/collapse";
import { fluxPerSecond } from "../game/engines";
import { isHeatUnlocked, isSurging } from "../game/heat";
import { canRift, chosenBranch, essenceGain, isRiftUnlocked, riftNodes } from "../game/rift";
import { tempoMult } from "../game/tempo";
import { D } from "../lib/decimal";
import { h, setText, setVisible, type View } from "./dom";

/** Amount per minute (or hour), or "—" for a zero-length run. */
const perTime = (amount: Parameters<typeof D>[0], seconds: number, unit: number) =>
  seconds > 0 ? format(D(amount).div(seconds / unit), 2, 2) : "—";

interface Column<R> {
  head: string;
  cell: (r: R) => string;
  /** Hide the column (e.g. "Rift" before your first Rift). */
  shown?: () => boolean;
}

/**
 * A "last N" table that rebuilds only when a record is added (or a save is loaded),
 * newest first, highlighting the fastest row.
 */
function historyTable<R extends { number: number; time: number }>(
  title: string,
  records: () => R[],
  columns: Column<R>[],
  summary: (rs: R[]) => string,
): View {
  const head = h("tr", {});
  const body = h("tbody", {});
  const average = h("p", { class: "history-average" });
  const root = h("div", { class: "panel" }, h("h3", {}, title), h("table", { class: "history" }, h("thead", {}, head), body), average);
  let shownKey = "";
  return {
    root,
    update() {
      const rs = records();
      setVisible(root, rs.length > 0);
      const cols = columns.filter((c) => c.shown?.() ?? true);
      const key = rs.map((r) => r.number).join(",") + "|" + cols.length;
      if (key === shownKey) return;
      shownKey = key;
      head.replaceChildren(...cols.map((c) => h("th", {}, c.head)));
      const best = Math.min(...rs.map((r) => r.time));
      body.replaceChildren(
        ...[...rs].reverse().map((r) => h("tr", { class: r.time === best ? "best" : "" }, ...cols.map((c) => h("td", {}, c.cell(r))))),
      );
      setText(average, summary(rs));
    },
  };
}

/** A titled block of label/value rows, hidden until `shown`. */
function statBlock(title: string, rows: [string, () => string][], shown: () => boolean = () => true): View {
  const cells = rows.map(() => h("td", {}));
  const root = h(
    "div",
    { class: "panel" },
    h("h3", {}, title),
    h("table", {}, ...rows.map(([label], i) => h("tr", {}, h("th", {}, label), cells[i]))),
  );
  return {
    root,
    update() {
      setVisible(root, shown());
      if (shown()) rows.forEach(([, value], i) => setText(cells[i], value()));
    },
  };
}

export function statsTab(): View {
  const hasRifted = () => state.rift.count > 0;

  const hasCollapsed = () => totalCollapses() > 0;
  const owned = (set: { defs: { id: string }[]; has(id: string): boolean }) =>
    `${set.defs.filter((d) => set.has(d.id)).length} of ${set.defs.length}`;

  const run = statBlock("This run", [
    ["Time in this Collapse", () => formatTime(state.collapse.time)],
    ["Flux per second", () => format(fluxPerSecond())],
    ["Peak Flux this Collapse", () => format(state.collapse.peakFlux)],
    ["Next Collapse gives", () => (canCollapse() ? `${format(shardGain(), 2, 0)} Shards` : "reach the Horizon")],
    ["Overdrives / Lattices", () => `${state.overdrives} / ${state.lattices}`],
    ["Tempo", () => `level ${state.tempo} · ${format(tempoMult())}×`],
    ["Heat", () => (isHeatUnlocked() ? `${state.heat.amount.toFixed(0)}%${isSurging() ? ` · Surging ×${state.heat.surgeMult.toFixed(2)}` : ""}` : "locked")],
  ]);
  const general = statBlock("Lifetime", [
    ["Time played", () => formatTime(state.stats.timePlayed)],
    ["Total Flux produced", () => format(state.stats.totalFlux)],
    ["Best Flux ever", () => format(state.stats.bestFlux)],
    ["Overdrives", () => String(state.stats.overdrives)],
    ["Lattices", () => String(state.stats.lattices)],
    ["Vents", () => String(state.heat.vents)],
    ["Shards earned", () => format(state.stats.shardsEarned, 2, 0)],
  ]);
  const collapse = statBlock(
    "Collapse",
    [
      ["Collapses", () => String(totalCollapses())],
      ["Collapses this Rift", () => String(state.collapse.count)],
      ["Fastest Collapse (this Rift)", () => formatTime(state.collapse.bestTime)],
      ["Shards", () => format(state.collapse.shards, 2, 0)],
      ["Shard upgrades", () => owned(shardUpgrades)],
      ["Overcharge", () => `level ${state.collapse.overcharge} · ${format(overchargeMult())}×`],
      ["Autobuyers act every", () => (hasEngineAutobuyers() ? `${autobuyInterval().toFixed(2)}s` : "not unlocked")],
    ],
    hasCollapsed,
  );
  const rift = statBlock(
    "Rift",
    [
      ["Rifts", () => String(state.rift.count)],
      ["Time in this Rift", () => formatTime(state.rift.time)],
      ["Fastest Rift", () => formatTime(state.rift.bestTime)],
      ["Next Rift gives", () => (canRift() ? `${format(essenceGain(), 2, 0)} Essence` : "not open yet")],
      ["Essence (unspent)", () => format(state.rift.essence, 2, 0)],
      ["Essence earned", () => format(state.rift.totalEssence, 2, 0)],
      ["Rift tree", () => `${owned(riftNodes)} nodes`],
      ["Branch", () => (chosenBranch() === "order" ? "Order" : chosenBranch() === "entropy" ? "Entropy" : "not chosen")],
    ],
    () => isRiftUnlocked(),
  );

  const collapses = historyTable(
    `Last ${COLLAPSE_HISTORY} Collapses`,
    () => state.collapse.history,
    [
      { head: "#", cell: (r) => String(r.number) },
      // Rifts done before that Collapse; "—" = before your first Rift (or an older save).
      { head: "Rift", cell: (r) => (r.rift ? String(r.rift) : "—"), shown: hasRifted },
      { head: "Time", cell: (r) => formatTime(r.time) },
      { head: "Shards", cell: (r) => format(r.shards, 2, 0) },
      { head: "Shards/min", cell: (r) => perTime(r.shards, r.time, 60) },
    ],
    (rs) => {
      const time = rs.reduce((sum, r) => sum + r.time, 0);
      const shards = rs.reduce((sum, r) => sum.add(r.shards), D(0));
      return `Average ${formatTime(time / rs.length)} per Collapse · ${perTime(shards, time, 60)} Shards/min`;
    },
  );
  const rifts = historyTable(
    `Last ${RIFT_HISTORY} Rifts`,
    () => state.rift.history,
    [
      { head: "#", cell: (r) => String(r.number) },
      { head: "Time", cell: (r) => formatTime(r.time) },
      { head: "Essence", cell: (r) => format(r.essence, 2, 0) },
      { head: "Ess./hour", cell: (r) => perTime(r.essence, r.time, 3600) },
      { head: "Collapses", cell: (r) => String(r.collapses) },
      { head: "Overcharge", cell: (r) => String(r.overcharge) },
    ],
    (rs) => {
      const time = rs.reduce((sum, r) => sum + r.time, 0);
      const essence = rs.reduce((sum, r) => sum.add(r.essence), D(0));
      return `Average ${formatTime(time / rs.length)} per Rift · ${perTime(essence, time, 3600)} Essence/hour`;
    },
  );

  const views = [run, collapse, rift, rifts, collapses, general];
  const root = h("section", { class: "tab stats-tab" }, ...views.map((v) => v.root));
  return {
    root,
    update() {
      for (const v of views) v.update();
    },
  };
}
