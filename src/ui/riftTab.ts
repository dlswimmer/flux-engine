import { format, formatCount, formatInt, formatTime } from "../core/format";
import { state } from "../core/state";
import { HORIZON } from "../game/collapse";
import {
  NODE_INFO,
  RIFT_MILESTONES,
  RIFT_THRESHOLD,
  canRift,
  chosenBranch,
  doRift,
  essenceGain,
  hasRiftMilestone,
  riftNodes,
  spentEssence,
} from "../game/rift";
import type { UpgradeDef } from "../game/upgrades";
import { h, keyHint, setClass, setDisabled, setText, setVisible, toggle, type View } from "./dom";

/** One skill-tree node. Unlike Shard upgrades, nodes on the branch you didn't pick stay visible, greyed out. */
function nodeCard(def: UpgradeDef): View {
  const effect = h("div", { class: "upgrade-effect" });
  const cost = h("div", { class: "upgrade-cost" });
  const root = h(
    "button",
    { class: `upgrade rift-node ${NODE_INFO[def.id].branch}`, onClick: () => riftNodes.buy(def.id) },
    h("div", { class: "upgrade-name" }, def.name),
    h("div", { class: "upgrade-desc" }, def.desc),
    effect,
    cost,
  );
  return {
    root,
    update() {
      const owned = riftNodes.has(def.id);
      const branch = NODE_INFO[def.id].branch;
      const closed = branch !== "core" && chosenBranch() !== null && chosenBranch() !== branch;
      setClass(root, "owned", owned);
      setClass(root, "affordable", riftNodes.canBuy(def.id));
      setClass(root, "locked", !owned && !riftNodes.isAvailable(def.id));
      setText(effect, def.effect && def.effectText ? `Currently ${def.effectText(def.effect())}` : "");
      setText(
        cost,
        owned ? "Owned" : closed ? `Locked: you chose ${chosenBranch() === "order" ? "Order" : "Entropy"}` : `${formatInt(def.cost)} Essence`,
      );
    },
  };
}

export function riftTab(): View {
  const summary = h("p", { class: "summary rift-summary" });
  const fill = h("div", { class: "progress-fill rift-fill" });
  const progressLabel = h("span", { class: "progress-label" });
  const button = h("button", { class: "rift-btn wide", onClick: doRift });

  const milestones = RIFT_MILESTONES.map((m) => {
    const row = h("li", {}, h("strong", {}, `${formatCount(m.rifts, "Rift")}: `), m.text);
    return { m, row };
  });

  const nodes = riftNodes.defs.map((def) => ({ def, view: nodeCard(def) }));
  const column = (branch: string) =>
    h(
      "div",
      { class: `rift-column ${branch}` },
      h("h4", {}, branch === "order" ? "Order · steady, idle-friendly" : "Entropy · volatile, rewards Heat"),
      ...nodes.filter((n) => NODE_INFO[n.def.id].branch === branch).map((n) => n.view.root),
    );
  const core = h(
    "div",
    { class: "rift-core" },
    ...nodes.filter((n) => NODE_INFO[n.def.id].branch === "core").map((n) => n.view.root),
  );
  const branchNote = h("p", { class: "rift-branch-note" });
  const respec = toggle("Respec at next Rift", () => state.rift.respec, (v) => (state.rift.respec = v));
  const respecNote = h("span", { class: "auto-note" });

  const thresholdLog = RIFT_THRESHOLD.log10().toNumber();
  const horizonLog = HORIZON.log10().toNumber();

  const root = h(
    "section",
    { class: "tab rift-tab" },
    summary,
    h("div", { class: "progress rift-progress" }, fill, progressLabel),
    button,
    h("div", { class: "panel" }, h("h3", {}, "Milestones"), h("ul", { class: "milestones" }, ...milestones.map((x) => x.row))),
    h(
      "div",
      { class: "panel" },
      h("h3", {}, "Rift tree"),
      core,
      branchNote,
      h("div", { class: "rift-branches" }, column("order"), column("entropy")),
      h("div", { class: "rift-respec" }, respec.root, respecNote),
    ),
  );

  return {
    root,
    update() {
      const r = state.rift;
      setText(
        summary,
        `${formatInt(r.essence)} Essence · ${formatCount(r.count, "Rift")} · this Rift ${formatTime(r.time)}` +
          (r.count > 0 ? ` · fastest ${formatTime(r.bestTime)}` : ""),
      );

      // Progress toward the Rift threshold, from the Horizon, in orders of magnitude of peak Flux.
      const peakLog = state.collapse.peakFlux.max(1).log10().toNumber();
      const pct = Math.min(100, Math.max(0, ((peakLog - horizonLog) / (thresholdLog - horizonLog)) * 100));
      fill.style.width = `${pct}%`;
      setText(progressLabel, canRift() ? "The Rift is open" : `Peak Flux this Collapse: e${Math.floor(peakLog)} of e${thresholdLog}`);
      setText(
        button,
        canRift()
          ? `Rift for ${formatCount(essenceGain(), "Essence", "Essence")}${keyHint("R")}`
          : `Reach ${format(RIFT_THRESHOLD)} Flux in one Collapse to Rift`,
      );
      setDisabled(button, !canRift());

      for (const { m, row } of milestones) setClass(row, "done", hasRiftMilestone(m.rifts));
      for (const n of nodes) n.view.update();
      const branch = chosenBranch();
      setText(
        branchNote,
        branch === null
          ? "Choose a branch: buying the first Order or Entropy node locks the other until you respec."
          : `You chose ${branch === "order" ? "Order" : "Entropy"}.`,
      );
      respec.update();
      setText(respecNote, r.nodes.length ? `refunds ${formatInt(spentEssence())} Essence` : "");
      setVisible(respec.root.parentElement!, r.nodes.length > 0 || r.respec);
    },
  };
}
