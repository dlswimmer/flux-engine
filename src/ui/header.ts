import { format, formatCount, formatInt } from "../core/format";
import { state } from "../core/state";
import { HORIZON, canCollapse, doCollapse, isBreached, isCollapseUnlocked, shardGain } from "../game/collapse";
import { fluxPerSecond, horizonDrag } from "../game/engines";
import { h, setClass, setText, setVisible, type View } from "./dom";
import { SPRINT_LIMIT, activeTrial, trialDef } from "../game/trials";

export function headerView(): View {
  const flux = h("span", { class: "big-number" });
  const rate = h("span", { class: "rate", title: "Past the Horizon, Flux income is slowed the further past it you are" });
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
  let barPeak = state.flux;
  let lastSinceReset = state.sinceReset;

  return {
    root,
    update() {
      setVisible(speedBadge, state.options.devSpeed !== 1);
      setText(speedBadge, `×${state.options.devSpeed} speed`);

      setText(flux, format(state.flux, 2, 1));
      const drag = horizonDrag();
      setText(rate, `+${format(fluxPerSecond(), 2, 1)} / sec` + (drag.lt(1) ? ` · slowed ÷${format(drag.recip(), 2, 1)}` : ""));

      // Most Flux since the last Overdrive/Lattice (or Collapse): spending doesn't make the bar
      // fall back, but each reset starts it over, so you see this stretch's progress. Once the
      // Horizon has been reached this Collapse it stays full.
      if (state.sinceReset < lastSinceReset) barPeak = state.flux;
      lastSinceReset = state.sinceReset;
      if (state.flux.gt(barPeak)) barPeak = state.flux;
      const shown = canCollapse() ? HORIZON : barPeak;
      const pct = Math.min(100, Math.max(0, (shown.max(1).log10().toNumber() / horizonLog) * 100));
      // Past the Horizon after Breach, Shards ×10 every 200 orders of magnitude of Flux (see
      // exactShardGain): the bar shows progress to the next ×10, from this Collapse's peak.
      const pastHorizon = pct >= 100 && isBreached();
      let label = pct >= 100 ? "Horizon reached" : `${pct.toFixed(2)}% to the Horizon`;
      let width = pct;
      if (pastHorizon) {
        const decades = state.collapse.peakFlux.max(1).log10().toNumber() / horizonLog - 0.75;
        const next = Math.floor(decades) + 1;
        width = (decades - Math.floor(decades)) * 100;
        label = `${width.toFixed(1)}% to Shards ×10 (e${formatInt((next + 0.75) * horizonLog)} Flux)`;
      }
      setClass(fill, "past-horizon", pastHorizon);
      fill.style.width = `${width}%`;
      const trial = activeTrial();
      const sprintLeft = trial === "sprint" && pct < 100 ? ` (${Math.max(0, SPRINT_LIMIT - state.collapse.time).toFixed(0)}s)` : "";
      setText(
        progressLabel,
        label +
          (trial ? ` · Trial: ${trialDef(trial).name}${sprintLeft}` : ""),
      );
      setClass(root, "in-trial", trial !== null);

      setVisible(shards, isCollapseUnlocked());
      setText(
        shards,
        `${formatInt(state.collapse.shards)} Shards` +
          (state.rift.count > 0 ? ` · ${formatInt(state.rift.essence)} Essence` : ""),
      );

      // Once you've Collapsed before, the button keeps its slot (hidden when not ready) so the
      // page doesn't jump each time it appears. On phones it takes the Shards spot instead.
      setVisible(collapseBtn, isCollapseUnlocked());
      setClass(collapseBtn, "slot-hidden", !canCollapse());
      setClass(root, "ready", canCollapse());
      setText(collapseBtn, `Collapse for ${formatCount(shardGain(), "Shard")}`);
    },
  };
}
