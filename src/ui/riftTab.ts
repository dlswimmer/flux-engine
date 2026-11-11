import { formatCount, formatInt, formatTime } from "../core/format";
import { state } from "../core/state";
import {
  NODE_INFO,
  RIFT_MILESTONES,
  RIFT_OVERCHARGE,
  ATTUNEMENT_RIFTS,
  attunementCost,
  attunementEngineMult,
  attunementEssenceMult,
  buyAttunement,
  canAttune,
  canRift,
  chosenBranch,
  doRift,
  essenceAt,
  essenceGain,
  hasNode,
  hasRiftMilestone,
  isAttunementUnlocked,
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
      const owned = riftNodes.owns(def.id);
      const branch = NODE_INFO[def.id].branch;
      const closed = branch !== "core" && !riftNodes.isVisible(def.id);
      const gate = def.gate?.();
      setClass(root, "owned", owned);
      setClass(root, "affordable", riftNodes.canBuy(def.id));
      setClass(root, "locked", !owned && !riftNodes.isAvailable(def.id));
      setText(effect, def.effect && def.effectText ? `Currently ${def.effectText(def.effect())}` : "");
      setText(
        cost,
        owned
          ? "Owned"
          : closed
            ? `Locked: you chose ${chosenBranch() === "order" ? "Order" : "Entropy"}`
            : `${formatInt(riftNodes.cost(def.id))} Essence${gate ? ` · ${gate}` : ""}`,
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
  const coreRow = (from: number, to: number) =>
    h(
      "div",
      { class: "rift-core" },
      ...nodes
        .filter((n) => NODE_INFO[n.def.id].branch === "core" && NODE_INFO[n.def.id].row >= from && NODE_INFO[n.def.id].row <= to)
        .map((n) => n.view.root),
    );
  const core = coreRow(0, 1);
  const coreMid = coreRow(2, 2);
  const coreEnd = coreRow(7, 7);

  // Attunement: the repeatable sink.
  const attuneInfo = h("p", { class: "summary" });
  const attuneBtn = h("button", { class: "wide", onClick: () => buyAttunement() });
  const attunePanel = h(
    "div",
    { class: "panel" },
    h("h3", {}, "Attunement"),
    h("p", {}, "A level you can keep buying with Essence. Each level: every Engine ×2 and +5% Essence from a Rift. Kept through Rifts and respecs."),
    attuneInfo,
    attuneBtn,
  );

  // Perpetual (Order capstone): auto-Rift settings.
  const autoRift = toggle("Auto-Rift", () => state.automation.rift, (v) => (state.automation.rift = v));
  const riftAtInput = h("input", {
    type: "number",
    min: 1,
    step: 1,
    onChange: () => {
      const v = Math.floor(Number(riftAtInput.value));
      state.automation.riftAt = Number.isFinite(v) ? Math.max(1, v) : 10;
    },
  });
  const perpetualPanel = h(
    "div",
    { class: "rift-respec" },
    autoRift.root,
    h("label", { class: "auto-setting" }, "when it gives at least", riftAtInput, "Essence"),
  );
  const branchNote = h("p", { class: "rift-branch-note" });
  const respec = toggle("Respec at next Rift", () => state.rift.respec, (v) => (state.rift.respec = v));
  const respecNote = h("span", { class: "auto-note" });


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
      coreMid,
      branchNote,
      h("div", { class: "rift-branches" }, column("order"), column("entropy")),
      coreEnd,
      perpetualPanel,
      h("div", { class: "rift-respec" }, respec.root, respecNote),
    ),
    attunePanel,
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

      const oc = state.collapse.overcharge;
      fill.style.width = `${Math.min(100, (oc / RIFT_OVERCHARGE) * 100)}%`;
      setText(
        progressLabel,
        canRift() ? `Open · Overcharge ${oc + 1} gives ${formatInt(essenceAt(oc + 1))} Essence, ${oc + 4} gives ${formatInt(essenceAt(oc + 4))}` : `Overcharge ${oc} of ${RIFT_OVERCHARGE}`,
      );
      setText(
        button,
        canRift()
          ? `Rift for ${formatCount(essenceGain(), "Essence", "Essence")}${keyHint("R")}`
          : `Reach Overcharge ${RIFT_OVERCHARGE} to Rift`,
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
      autoRift.update();
      setVisible(perpetualPanel, hasNode("perpetual"));
      if (document.activeElement !== riftAtInput) riftAtInput.value = String(state.automation.riftAt);
      setVisible(attunePanel, isAttunementUnlocked() || r.count >= ATTUNEMENT_RIFTS - 1);
      setText(
        attuneInfo,
        `Level ${r.attunement} · Engines ×${formatInt(attunementEngineMult())} · Essence ×${attunementEssenceMult().toFixed(2)}`,
      );
      setText(
        attuneBtn,
        isAttunementUnlocked() ? `Attune for ${formatInt(attunementCost())} Essence` : `Opens at Rift ${ATTUNEMENT_RIFTS}`,
      );
      setDisabled(attuneBtn, !canAttune());
      setText(respecNote, r.nodes.length ? `refunds ${formatInt(spentEssence())} Essence` : "");
      setVisible(respec.root.parentElement!, r.nodes.length > 0 || r.respec);
    },
  };
}
