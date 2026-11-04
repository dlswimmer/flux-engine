import { state } from "../core/state";
import {
  MIN_INTERVAL,
  areResetsPaused,
  autobuyInterval,
  hasEngineAutobuyers,
  hasResetAutobuyers,
  nextAutobuyInterval,
} from "../game/automation";
import { shardUpgrades } from "../game/collapse";
import { ENGINE_NAMES, isEngineUnlocked } from "../game/engines";
import { HEAT_MAX, hasThermostat, isHeatUnlocked } from "../game/heat";
import { isTempoUnlocked } from "../game/tempo";
import { h, setClass, setText, setVisible, type View } from "./dom";

// Every automation setting lives here. Each autobuyer is a card: a big on/off
// switch plus an optional row of extra settings (thresholds today; bulk amounts,
// priorities, auto-Collapse conditions later). New autobuyers add a card.

interface CardOptions {
  name: string;
  get: () => boolean;
  set: (on: boolean) => void;
  /** Shown under the name; e.g. why it's locked or what it does. */
  note?: () => string;
  /** The thing it buys isn't unlocked yet (the switch still works; it just has nothing to do). */
  idle?: () => boolean;
  /** Extra settings shown under the switch. */
  settings?: HTMLElement;
}

function autobuyerCard(o: CardOptions): View {
  const input = h("input", { type: "checkbox", class: "switch", onChange: () => o.set(input.checked) });
  const note = h("span", { class: "auto-note" });
  const root = h(
    "div",
    { class: "auto-card" },
    h("label", { class: "auto-card-main" }, h("span", { class: "auto-name" }, o.name, note), input),
    o.settings ?? null,
  );
  return {
    root,
    update() {
      if (input.checked !== o.get()) input.checked = o.get();
      setText(note, o.note?.() ?? "");
      setClass(root, "on", o.get());
      setClass(root, "idle", o.idle?.() ?? false);
    },
  };
}

/** A titled group of cards, with an optional "locked until you buy X" message. */
function group(title: string, cards: View[], lockedBy?: () => string | null, extra?: HTMLElement): View {
  const lockNote = h("p", { class: "auto-locked" });
  const grid = h("div", { class: "auto-grid" }, ...cards.map((c) => c.root));
  const root = h("div", { class: "panel auto-group" }, h("h3", {}, title), extra ?? null, lockNote, grid);
  return {
    root,
    update() {
      const lock = lockedBy?.() ?? null;
      setVisible(lockNote, lock !== null);
      setText(lockNote, lock ?? "");
      setVisible(grid, lock === null);
      if (lock === null) for (const c of cards) c.update();
    },
  };
}

const lockedUntil = (id: string) => () =>
  shardUpgrades.has(id) ? null : `Buy ${shardUpgrades.get(id).name} (${shardUpgrades.get(id).cost} Shards) to unlock.`;

export function automationTab(): View {
  const speed = h("p", { class: "auto-speed-line" });
  const paused = h("p", { class: "auto-paused" });

  const engineCards = ENGINE_NAMES.map((name, tier) =>
    autobuyerCard({
      name: `Engine ${name}`,
      get: () => state.automation.engines[tier],
      set: (v) => (state.automation.engines[tier] = v),
      idle: () => !isEngineUnlocked(tier),
      note: () => (isEngineUnlocked(tier) ? "" : "not unlocked yet"),
    }),
  );
  const tempoCard = autobuyerCard({
    name: "Tempo",
    get: () => state.automation.tempo,
    set: (v) => (state.automation.tempo = v),
    idle: () => !isTempoUnlocked(),
  });
  const setAllBuyers = (on: boolean) => {
    state.automation.engines = state.automation.engines.map(() => on);
    state.automation.tempo = on;
  };
  const allButtons = h(
    "div",
    { class: "button-row" },
    h("button", { class: "secondary", onClick: () => setAllBuyers(true) }, "All on"),
    h("button", { class: "secondary", onClick: () => setAllBuyers(false) }, "All off"),
  );
  const buyers = group("Engines & Tempo", [tempoCard, ...engineCards], lockedUntil("automators"), allButtons);

  const resets = group(
    "Resets",
    [
      autobuyerCard({
        name: "Overdrive",
        get: () => state.automation.overdrive,
        set: (v) => (state.automation.overdrive = v),
        note: () => "as soon as it's affordable",
      }),
      autobuyerCard({
        name: "Lattice",
        get: () => state.automation.lattice,
        set: (v) => (state.automation.lattice = v),
        note: () => "takes priority over Overdrive",
      }),
    ],
    lockedUntil("automators2"),
  );

  const threshold = h("input", {
    type: "number",
    min: 10,
    max: HEAT_MAX,
    step: 5,
    onChange: () => {
      const v = Math.round(Number(threshold.value));
      state.heat.autoVentAt = Number.isFinite(v) ? Math.min(HEAT_MAX, Math.max(10, v)) : 70;
    },
  });
  const ventCard = autobuyerCard({
    name: "Auto-vent",
    get: () => state.heat.autoVent,
    set: (v) => (state.heat.autoVent = v),
    settings: h("label", { class: "auto-setting" }, "Vent at", threshold, "% Heat"),
  });
  const heat = group("Heat", [ventCard], lockedUntil("thermostat"));

  const groups = [buyers, resets, heat];
  const root = h("section", { class: "tab automation-tab" }, paused, speed, ...groups.map((g) => g.root));

  return {
    root,
    update() {
      const now = autobuyInterval();
      setText(
        speed,
        (now <= MIN_INTERVAL
          ? `Autobuyers act every tick (${now.toFixed(2)}s), the fastest possible.`
          : `Autobuyers act every ${now.toFixed(2)}s, ${nextAutobuyInterval().toFixed(2)}s after your next Collapse.`) +
          (shardUpgrades.has("overclock") ? " Overclocked ×3." : ""),
      );
      setVisible(paused, areResetsPaused());
      setText(paused, "You can Collapse, so auto Overdrive and Lattice are paused. Engine and Tempo buying carries on.");
      for (const g of groups) g.update();
      setVisible(heat.root, isHeatUnlocked());
      setVisible(resets.root, hasEngineAutobuyers());
      if (hasThermostat() && document.activeElement !== threshold) threshold.value = String(state.heat.autoVentAt);
    },
  };
}

/** The Automation tab appears with the first autobuyers. */
export const isAutomationUnlocked = () => hasEngineAutobuyers() || hasResetAutobuyers();
