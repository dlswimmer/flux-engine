import { formatCount, formatInt, formatTime } from "../core/format";
import { state } from "../core/state";
import { canCollapse, doCollapse, shardGain, shardUpgrades } from "../game/collapse";
import type { UpgradeDef, UpgradeSet } from "../game/upgrades";
import { h, keyHint, setClass, setText, setVisible, type View } from "./dom";

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
      const owned = set.has(def.id);
      setClass(root, "owned", owned);
      setClass(root, "affordable", set.canBuy(def.id));
      setClass(root, "locked", !owned && !set.isAvailable(def.id));
      setText(effect, def.effect && def.effectText ? `Currently ${def.effectText(def.effect())}` : "");
      setText(cost, owned ? "Owned" : `${formatInt(def.cost)} ${currencyName}`);
    },
  };
}

export function collapseTab(): View {
  const summary = h("p", { class: "summary" });
  const button = h("button", { class: "collapse-btn wide", onClick: doCollapse });
  const cards = shardUpgrades.defs.map((def) => upgradeCard(shardUpgrades, def, "Shards"));

  const root = h(
    "section",
    { class: "tab collapse-tab" },
    summary,
    button,
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
      for (const card of cards) card.update();
    },
  };
}
