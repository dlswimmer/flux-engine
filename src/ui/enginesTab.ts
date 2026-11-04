import { format, formatInt, formatMult } from "../core/format";
import { ENGINE_COUNT, state } from "../core/state";
import {
  MIN_INTERVAL,
  autobuyInterval,
  hasEngineAutobuyers,
  hasResetAutobuyers,
  nextAutobuyInterval,
} from "../game/automation";
import { shardUpgrades } from "../game/collapse";
import {
  ENGINE_NAMES,
  MILESTONE_SIZE,
  buyEngine,
  buyMaxEngine,
  buyToNextMilestone,
  canBuyEngine,
  canBuyToNextMilestone,
  costToNextMilestone,
  engineCost,
  engineGrowthPercent,
  engineMult,
  isEngineUnlocked,
  maxAll,
  toNextMilestone,
} from "../game/engines";
import {
  HEAT_MAX,
  THROTTLE_START,
  canVent,
  fluxThrottle,
  hasThermostat,
  isHeatUnlocked,
  isSurging,
  surgeDuration,
  surgeMultFor,
  vent,
} from "../game/heat";
import { canLattice, doLattice, latticeRequirement, latticeTempoBonus } from "../game/lattice";
import { canOverdrive, doOverdrive, overdriveMult, overdriveRequirement } from "../game/overdrive";
import { buyMaxTempo, buyTempo, canBuyTempo, isTempoUnlocked, tempoCost, tempoFactor, tempoMult } from "../game/tempo";
import { h, holdToRepeat, keyHint, setClass, setDisabled, setText, setVisible, toggle, type View } from "./dom";

export function toggleBuyMode() {
  state.ui.buyMode = state.ui.buyMode === "next" ? "one" : "next";
}

function engineRow(tier: number): View {
  const mult = h("span", { class: "mult" });
  const amount = h("span", { class: "amount" });
  const growth = h("span", { class: "growth" });
  const milestone = h("div", { class: "milestone-fill" });
  const buy = () => (state.ui.buyMode === "next" ? buyToNextMilestone(tier) : buyEngine(tier));
  const buyOne = h("button", { onClick: buy });
  holdToRepeat(buyOne, buy);
  const buyMax = h("button", { class: "secondary", onClick: () => buyMaxEngine(tier) }, "Max");
  const auto = toggle("Auto", () => state.automation.engines[tier], (v) => (state.automation.engines[tier] = v));

  const root = h(
    "div",
    { class: "engine-row" },
    h("div", { class: "engine-name" }, h("strong", {}, `Engine ${ENGINE_NAMES[tier]}`), mult),
    h("div", { class: "engine-amount" }, amount, growth),
    h("div", { class: "milestone", title: `Every ${MILESTONE_SIZE} bought doubles output` }, milestone),
    h("div", { class: "engine-buttons" }, buyOne, buyMax, auto.root),
  );

  return {
    root,
    update() {
      const unlocked = isEngineUnlocked(tier);
      setVisible(root, unlocked);
      if (!unlocked) return;
      const engine = state.engines[tier];
      setText(mult, formatMult(engineMult(tier)));
      setText(amount, format(engine.amount, 2, 0));
      const pct = engineGrowthPercent(tier);
      setText(growth, pct.gt(0) ? `+${format(pct, 2, 1)}%/s` : "");
      milestone.style.width = `${((engine.bought % MILESTONE_SIZE) / MILESTONE_SIZE) * 100}%`;
      if (state.ui.buyMode === "next") {
        setText(buyOne, `Until ×2 (${toNextMilestone(tier)}) · ${format(costToNextMilestone(tier))}`);
        setDisabled(buyOne, !canBuyToNextMilestone(tier));
      } else {
        setText(buyOne, `Buy 1 · ${format(engineCost(tier))}`);
        setDisabled(buyOne, !canBuyEngine(tier));
      }
      setClass(buyMax, "dim", !canBuyEngine(tier));
      setVisible(auto.root, hasEngineAutobuyers());
      auto.update();
    },
  };
}

function tempoPanel(): View {
  const info = h("div", { class: "tempo-info" });
  const buyOne = h("button", { onClick: buyTempo });
  holdToRepeat(buyOne, buyTempo);
  const buyMax = h("button", { class: "secondary", onClick: buyMaxTempo }, "Max");
  const auto = toggle("Auto", () => state.automation.tempo, (v) => (state.automation.tempo = v));
  const root = h("div", { class: "tempo panel" }, info, h("div", { class: "engine-buttons" }, buyOne, buyMax, auto.root));

  return {
    root,
    update() {
      setVisible(root, isTempoUnlocked());
      if (!isTempoUnlocked()) return;
      setText(
        info,
        `Tempo ${state.tempo} · ${formatMult(tempoFactor(), 3)} per level · total ${formatMult(tempoMult())}`,
      );
      setText(buyOne, `Raise Tempo · ${format(tempoCost())}`);
      setDisabled(buyOne, !canBuyTempo());
      setVisible(auto.root, hasEngineAutobuyers());
      auto.update();
    },
  };
}

function heatPanel(): View {
  // The bar is a fixed cool→hot gradient; a cover hides the part above current Heat.
  const cover = h("div", { class: "heat-cover" });
  const label = h("span", { class: "heat-label" });
  const autoMarker = h("div", { class: "heat-auto-marker" });
  const bar = h(
    "div",
    { class: "heat-bar" },
    cover,
    h("div", { class: "heat-throttle-marker", style: `left:${THROTTLE_START}%` }),
    autoMarker,
    label,
  );
  const status = h("p", { class: "heat-status" });
  const ventButton = h("button", { class: "vent-btn", onClick: vent });

  const auto = toggle("Auto-vent at", () => state.heat.autoVent, (v) => (state.heat.autoVent = v));
  const threshold = h("input", {
    type: "number",
    min: 10,
    max: HEAT_MAX,
    step: 5,
    onChange: () => {
      const v = Math.round(Number(threshold.value));
      state.heat.autoVentAt = Number.isFinite(v) ? Math.min(HEAT_MAX, Math.max(10, v)) : 80;
    },
  });
  const autoRow = h("div", { class: "heat-auto" }, auto.root, threshold, "%");

  const root = h(
    "div",
    { class: "panel heat-panel" },
    h("h3", {}, "Heat"),
    bar,
    status,
    h("div", { class: "heat-actions" }, ventButton, autoRow),
  );

  return {
    root,
    update() {
      setVisible(root, isHeatUnlocked());
      if (!isHeatUnlocked()) return;
      const heat = state.heat;
      cover.style.width = `${HEAT_MAX - heat.amount}%`;
      setText(label, `${heat.amount.toFixed(0)}%`);

      const throttle = fluxThrottle();
      const parts = [
        isSurging() ? `Surging: all Engines ×${heat.surgeMult.toFixed(2)} for ${heat.surgeTime.toFixed(1)}s.` : "",
        throttle < 1
          ? `Overheating: Flux output ×${throttle.toFixed(2)}.`
          : `Engines heat up as they run. Above ${THROTTLE_START}% Flux output drops.`,
      ];
      setText(status, parts.filter(Boolean).join(" "));
      setClass(status, "hot", throttle < 1);

      setText(
        ventButton,
        isSurging()
          ? `Surging · vent again in ${heat.surgeTime.toFixed(1)}s`
          : `Vent${keyHint("V")} · Surge ×${surgeMultFor(heat.amount).toFixed(2)} for ${surgeDuration()}s`,
      );
      setDisabled(ventButton, !canVent());

      setVisible(autoRow, hasThermostat());
      setVisible(autoMarker, hasThermostat() && heat.autoVent);
      autoMarker.style.left = `${heat.autoVentAt}%`;
      auto.update();
      if (document.activeElement !== threshold) threshold.value = String(heat.autoVentAt);
    },
  };
}

function resetPanel(
  title: string,
  describe: () => string,
  can: () => boolean,
  act: () => boolean,
  buttonText: () => string,
  autoToggle: View,
): View {
  const desc = h("p", {});
  const button = h("button", { onClick: act });
  const root = h("div", { class: "panel reset-panel" }, h("h3", {}, title), desc, button, autoToggle.root);
  return {
    root,
    update() {
      setText(desc, describe());
      setText(button, buttonText());
      setDisabled(button, !can());
      setVisible(autoToggle.root, hasResetAutobuyers());
      autoToggle.update();
    },
  };
}

export function enginesTab(): View {
  const rows = Array.from({ length: ENGINE_COUNT }, (_, tier) => engineRow(tier));
  const tempo = tempoPanel();
  const heat = heatPanel();
  const buyMode = h("button", {
    class: "secondary",
    title: "Toggle what an Engine's main button buys",
    onClick: toggleBuyMode,
  });
  const maxAllButton = h("button", { class: "max-all" }, `Max All${keyHint("M")}`);
  maxAllButton.addEventListener("click", maxAll);
  holdToRepeat(maxAllButton, maxAll);
  const autoSpeed = h("span", {
    class: "auto-speed",
    title: "Autobuyers get faster with every Collapse",
  });

  const overdrive = resetPanel(
    "Overdrive",
    () =>
      `${state.overdrives} Overdrives: all Engines ${formatMult(overdriveMult())}. ` +
      (state.overdrives < 4 ? "Next unlocks a new Engine. " : "") +
      "Resets Flux, Engines and Tempo.",
    canOverdrive,
    doOverdrive,
    () => {
      const { tier, amount } = overdriveRequirement();
      return `Overdrive · needs ${amount} Engine ${ENGINE_NAMES[tier]}`;
    },
    toggle("Auto", () => state.automation.overdrive, (v) => (state.automation.overdrive = v)),
  );

  const lattice = resetPanel(
    "Lattice",
    () =>
      `${state.lattices} Lattices: Tempo +${latticeTempoBonus().toFixed(2)} per level. ` +
      (shardUpgrades.has("latticeworks") ? "Keeps Overdrives." : "Resets Overdrives too."),
    canLattice,
    doLattice,
    () => `Form Lattice · needs ${formatInt(latticeRequirement())} Engine VIII`,
    toggle("Auto", () => state.automation.lattice, (v) => (state.automation.lattice = v)),
  );

  const views = [tempo, heat, ...rows, overdrive, lattice];
  const root = h(
    "section",
    { class: "tab engines-tab" },
    h("div", { class: "toolbar" }, buyMode, maxAllButton, autoSpeed),
    tempo.root,
    heat.root,
    h("div", { class: "engine-list" }, ...rows.map((r) => r.root)),
    h("div", { class: "reset-panels" }, overdrive.root, lattice.root),
  );

  return {
    root,
    update() {
      setText(buyMode, (state.ui.buyMode === "next" ? "Buy mode: Until ×2" : "Buy mode: 1") + keyHint("B"));
      setVisible(autoSpeed, hasEngineAutobuyers());
      if (hasEngineAutobuyers()) {
        const now = autobuyInterval();
        setText(
          autoSpeed,
          now <= MIN_INTERVAL
            ? `Autobuyers: every tick (${now.toFixed(2)}s, max speed)`
            : `Autobuyers: every ${now.toFixed(2)}s · ${nextAutobuyInterval().toFixed(2)}s after next Collapse`,
        );
      }
      for (const view of views) view.update();
      setVisible(lattice.root, state.overdrives >= 4 || state.lattices > 0);
    },
  };
}
