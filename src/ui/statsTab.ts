import { format, formatTime } from "../core/format";
import { state } from "../core/state";
import { h, setText, type View } from "./dom";

export function statsTab(): View {
  const rows: [string, () => string][] = [
    ["Time played", () => formatTime(state.stats.timePlayed)],
    ["Total Flux produced", () => format(state.stats.totalFlux)],
    ["Best Flux", () => format(state.stats.bestFlux)],
    ["Collapses", () => String(state.collapse.count)],
    ["Time in this Collapse", () => formatTime(state.collapse.time)],
    ["Fastest Collapse", () => formatTime(state.collapse.bestTime)],
  ];
  const cells = rows.map(() => h("td", {}));
  const root = h(
    "section",
    { class: "tab stats-tab" },
    h("table", {}, ...rows.map(([label], i) => h("tr", {}, h("th", {}, label), cells[i]))),
  );
  return {
    root,
    update() {
      rows.forEach(([, value], i) => setText(cells[i], value()));
    },
  };
}
