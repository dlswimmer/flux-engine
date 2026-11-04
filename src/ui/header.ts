import { format, formatCount, formatInt } from "../core/format";
import { state } from "../core/state";
import { HORIZON, canCollapse, doCollapse, isCollapseUnlocked, shardGain } from "../game/collapse";
import { fluxPerSecond } from "../game/engines";
import { h, setClass, setText, setVisible, type View } from "./dom";

export function headerView(): View {
  const flux = h("span", { class: "big-number" });
  const rate = h("span", { class: "rate" });
  const fill = h("div", { class: "progress-fill" });
  const progressLabel = h("span", { class: "progress-label" });
  const shards = h("div", { class: "shard-count" });
  const collapseBtn = h("button", { class: "collapse-btn", onClick: doCollapse });
  const speedBadge = h("button", {
    class: "speed-badge",
    title: "Dev game speed — click to return to ×1",
    onClick: () => (state.options.devSpeed = 1),
  });

  const root = h(
    "header",
    { class: "header" },
    speedBadge,
    h("div", { class: "flux-line" }, h("span", { class: "flux-prefix" }, "You have "), flux, " Flux"),
    rate,
    h("div", { class: "progress" }, fill, progressLabel),
    shards,
    collapseBtn,
  );

  const horizonLog = HORIZON.log10().toNumber();

  return {
    root,
    update() {
      setVisible(speedBadge, state.options.devSpeed !== 1);
      setText(speedBadge, `×${state.options.devSpeed} speed`);

      setText(flux, format(state.flux, 2, 1));
      setText(rate, `+${format(fluxPerSecond(), 2, 1)} / sec`);

      // Peak, not current: spending or an Overdrive shouldn't make the bar fall back.
      const pct = Math.min(100, Math.max(0, (state.collapse.peakFlux.max(1).log10().toNumber() / horizonLog) * 100));
      fill.style.width = `${pct}%`;
      setText(progressLabel, pct >= 100 ? "Horizon reached" : `${pct.toFixed(2)}% to the Horizon`);

      setVisible(shards, isCollapseUnlocked());
      setText(shards, `${formatInt(state.collapse.shards)} Shards`);

      // Once you've Collapsed before, the button keeps its slot (hidden when not ready) so the
      // page doesn't jump each time it appears. On phones it takes the Shards spot instead.
      setVisible(collapseBtn, isCollapseUnlocked());
      setClass(collapseBtn, "slot-hidden", !canCollapse());
      setClass(root, "ready", canCollapse());
      setText(collapseBtn, `Collapse for ${formatCount(shardGain(), "Shard")}`);
    },
  };
}
