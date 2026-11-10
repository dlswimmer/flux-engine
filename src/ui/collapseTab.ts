import { formatCount, formatInt, formatTime } from "../core/format";
import { state } from "../core/state";
import {
  buyMaxOvercharge,
  buyOvercharge,
  canBuyOvercharge,
  canCollapse,
  doCollapse,
  isOverchargeUnlocked,
  overchargeCost,
  overchargeMult,
  shardGain,
  shardUpgrades,
} from "../game/collapse";
import type { UpgradeDef, UpgradeSet } from "../game/upgrades";
import { h, holdToRepeat, keyHint, setClass, setDisabled, setText, setVisible, type View } from "./dom";
import { formatMult } from "../core/format";
import { riftOvercharge } from "../game/rift";

/** The repeatable Shard sink after Breach. */
function overchargePanel(): View {
  const info = h("p", { class: "overcharge-info" });
  const buy = h("button", { onClick: buyOvercharge });
  holdToRepeat(buy, buyOvercharge);
  const max = h("button", { class: "secondary", onClick: buyMaxOvercharge }, "Max");
  const root = h(
    "div",
    { class: "panel overcharge" },
    h("h3", {}, "Overcharge"),
    info,
    h("div", { class: "engine-buttons" }, buy, max),
  );
  return {
    root,
    update() {
      setVisible(root, isOverchargeUnlocked());
      if (!isOverchargeUnlocked()) return;
      setText(
        info,
        `Level ${state.collapse.overcharge}: all Engines ${formatMult(overchargeMult())}. Each level is another ×10, pushing Flux deeper past the Horizon. Level ${riftOvercharge()} opens the Rift (which resets it).`,
      );
      setText(buy, `Overcharge · ${formatInt(overchargeCost())} Shards`);
      setDisabled(buy, !canBuyOvercharge());
      setClass(max, "dim", !canBuyOvercharge());
    },
  };
}

/** Generic upgrade card; future layers reuse it with their own UpgradeSet. */
export function upgradeCard(set: UpgradeSet, def: UpgradeDef, currencyName: string): View {
  const effect = h("div", { class: "upgrade-effect" });
  const cost = h("div", { class: "upgrade-cost" }, `${formatInt(def.cost)} ${currencyName}`);
  const root = h(
    "button",
    { class: "upgrade", onClick: () => set.buy(def.id) },
    h("div", { class: "upgrade-name" }, def.name),
    h("div", { class: "upgrade-desc" }, def.desc),
    effect,
    cost,
  );
  return {
    root,
    update() {
      setVisible(root, set.isVisible(def.id));
      const owned = set.owns(def.id);
      const off = set.isSuppressed(def.id);
      setClass(root, "suppressed", off);
      setClass(root, "owned", owned);
      setClass(root, "affordable", set.canBuy(def.id));
      setClass(root, "locked", !owned && !set.isAvailable(def.id));
      setText(effect, def.effect && def.effectText ? `Currently ${def.effectText(def.effect())}` : "");
      setText(cost, off ? "Owned · off during this Trial" : owned ? "Owned" : `${formatInt(def.cost)} ${currencyName}`);
    },
  };
}

export function collapseTab(): View {
  const summary = h("p", { class: "summary" });
  const button = h("button", { class: "collapse-btn wide", onClick: doCollapse });
  const cards = shardUpgrades.defs.map((def) => upgradeCard(shardUpgrades, def, "Shards"));
  const overcharge = overchargePanel();

  const root = h(
    "section",
    { class: "tab collapse-tab" },
    summary,
    button,
    overcharge.root,
    h("h3", {}, "Shard upgrades"),
    h("div", { class: "upgrade-grid" }, ...cards.map((c) => c.root)),
  );

  return {
    root,
    update() {
      const c = state.collapse;
      setText(
        summary,
        `${formatInt(c.shards)} Shards · ${c.count} Collapses · this run ${formatTime(c.time)} · fastest ${formatTime(c.bestTime)}`,
      );
      setText(button, canCollapse() ? `Collapse for ${formatCount(shardGain(), "Shard")}${keyHint("C")}` : "Reach the Horizon to Collapse");
      button.disabled = !canCollapse();
      overcharge.update();
      for (const card of cards) card.update();
    },
  };
}
