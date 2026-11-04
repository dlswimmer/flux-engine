import { format, formatTime } from "../core/format";
import { COLLAPSE_HISTORY, state } from "../core/state";
import { D } from "../lib/decimal";
import { h, setText, setVisible, type View } from "./dom";

/** Shards per minute, or "—" for a zero-length run. */
const perMinute = (shards: Parameters<typeof D>[0], seconds: number) =>
  seconds > 0 ? format(D(shards).div(seconds / 60), 2, 2) : "—";

function recentCollapses(): View {
  const body = h("tbody", {});
  const average = h("p", { class: "history-average" });
  const root = h(
    "div",
    { class: "panel" },
    h("h3", {}, `Last ${COLLAPSE_HISTORY} Collapses`),
    h(
      "table",
      { class: "history" },
      h(
        "thead",
        {},
        h("tr", {}, h("th", {}, "#"), h("th", {}, "Time"), h("th", {}, "Shards"), h("th", {}, "Shards/min")),
      ),
      body,
    ),
    average,
  );
  let shownKey = "";
  return {
    root,
    update() {
      const history = state.collapse.history;
      setVisible(root, history.length > 0);
      // Rebuild only when a Collapse is added (or a save is loaded), not every frame.
      const key = history.map((r) => r.number).join(",");
      if (key === shownKey) return;
      shownKey = key;
      const best = Math.min(...history.map((r) => r.time));
      body.replaceChildren(
        ...[...history].reverse().map((r) =>
          h(
            "tr",
            { class: r.time === best ? "best" : "" },
            h("td", {}, String(r.number)),
            h("td", {}, formatTime(r.time)),
            h("td", {}, format(r.shards, 2, 0)),
            h("td", {}, perMinute(r.shards, r.time)),
          ),
        ),
      );
      const totalTime = history.reduce((sum, r) => sum + r.time, 0);
      const totalShards = history.reduce((sum, r) => sum.add(r.shards), D(0));
      setText(
        average,
        `Average ${formatTime(totalTime / history.length)} per Collapse · ${perMinute(totalShards, totalTime)} Shards/min`,
      );
    },
  };
}

export function statsTab(): View {
  const rows: [string, () => string][] = [
    ["Time played", () => formatTime(state.stats.timePlayed)],
    ["Total Flux produced", () => format(state.stats.totalFlux)],
    ["Best Flux", () => format(state.stats.bestFlux)],
    ["Collapses", () => String(state.collapse.count)],
    ["Time in this Collapse", () => formatTime(state.collapse.time)],
    ["Fastest Collapse", () => formatTime(state.collapse.bestTime)],
    ["Rifts", () => String(state.rift.count)],
    ["Fastest Rift", () => formatTime(state.rift.bestTime)],
    ["Essence earned", () => format(state.rift.totalEssence)],
  ];
  const cells = rows.map(() => h("td", {}));
  const recent = recentCollapses();
  const root = h(
    "section",
    { class: "tab stats-tab" },
    h("div", { class: "panel" }, h("table", {}, ...rows.map(([label], i) => h("tr", {}, h("th", {}, label), cells[i])))),
    recent.root,
  );
  return {
    root,
    update() {
      rows.forEach(([, value], i) => setText(cells[i], value()));
      recent.update();
    },
  };
}
