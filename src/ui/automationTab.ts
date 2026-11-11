import { state } from "../core/state";
import {
  MIN_INTERVAL,
  autobuyInterval,
  hasAutoCollapse,
  hasBulkBuying,
  hasEngineAutobuyers,
  areResetsPaused,
  hasResetAutobuyers,
  nextAutobuyInterval,
} from "../game/automation";
import { shardUpgrades } from "../game/collapse";
import { ENGINE_AUTOBUYER_IDS, TEMPO_AUTOBUYER_ID } from "../game/automationIds";
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
  /** Take a full row (long notes). Cards with settings always do. */
  wide?: boolean;
  /** Not bought yet: why (shown instead of the note), and the switch is disabled. */
  locked?: () => string | null;
}

function autobuyerCard(o: CardOptions): View {
  const input = h("input", { type: "checkbox", class: "switch", onChange: () => o.set(input.checked) });
  const note = h("span", { class: "auto-note" });
  const root = h(
    "div",
    { class: o.settings || o.wide ? "auto-card has-settings" : "auto-card" },
    h("label", { class: "auto-card-main" }, h("span", { class: "auto-name" }, o.name, note), input),
    o.settings ?? null,
  );
  return {
    root,
    update() {
      const lock = o.locked?.() ?? null;
      if (input.checked !== o.get()) input.checked = o.get();
      input.disabled = lock !== null;
      setText(note, lock ?? o.note?.() ?? "");
      setClass(root, "on", lock === null && o.get());
      setClass(root, "idle", lock !== null || (o.idle?.() ?? false));
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

/**
 * "Stop at [N] ..." number box. Blank means no limit (stored as Infinity, which the save
 * format round-trips). Returns the element and a sync() to call each frame.
 */
function limitSetting(label: string, unit: string, get: () => number, set: (v: number) => void) {
  const input = h("input", {
    type: "number",
    min: 0,
    step: 1,
    placeholder: "∞",
    onChange: () => {
      const raw = input.value.trim();
      const v = Math.floor(Number(raw));
      set(raw === "" || !Number.isFinite(v) ? Infinity : Math.max(0, v));
    },
  });
  const el = h("label", { class: "auto-setting" }, label, input, unit);
  return {
    el,
    sync() {
      if (document.activeElement === input) return;
      const v = get();
      input.value = Number.isFinite(v) ? String(v) : "";
    },
  };
}

/** "At most every [N] s" number box. Blank or 0 = claim as soon as possible. */
function waitSetting(get: () => number, set: (v: number) => void) {
  const input = h("input", {
    type: "number",
    min: 0,
    step: 1,
    placeholder: "0",
    onChange: () => {
      const v = Number(input.value.trim());
      set(Number.isFinite(v) ? Math.min(600, Math.max(0, v)) : 0);
    },
  });
  const el = h("label", { class: "auto-setting" }, "At most every", input, "s");
  return {
    el,
    sync() {
      if (document.activeElement === input) return;
      input.value = get() > 0 ? String(get()) : "";
    },
  };
}

const lockedUntil = (id: string) => () =>
  shardUpgrades.owns(id) ? null : `Buy ${shardUpgrades.get(id).name} (${shardUpgrades.get(id).cost} Shards) to unlock.`;
/** Short per-card version: "buy for 4 Shards". */
const cardLock = (id: string) => () => (shardUpgrades.owns(id) ? null : `buy ${shardUpgrades.get(id).name} (${shardUpgrades.get(id).cost} Shards)`);

export function automationTab(): View {
  const speed = h("p", { class: "auto-speed-line" });

  const engineCards = ENGINE_NAMES.map((name, tier) =>
    autobuyerCard({
      name: `Engine ${name}`,
      get: () => state.automation.engines[tier],
      set: (v) => (state.automation.engines[tier] = v),
      idle: () => !isEngineUnlocked(tier),
      note: () => (isEngineUnlocked(tier) ? "" : "not unlocked yet"),
      locked: cardLock(ENGINE_AUTOBUYER_IDS[tier]),
    }),
  );
  const tempoCard = autobuyerCard({
    name: "Tempo",
    get: () => state.automation.tempo,
    set: (v) => (state.automation.tempo = v),
    idle: () => !isTempoUnlocked(),
    locked: cardLock(TEMPO_AUTOBUYER_ID),
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
  const buyers = group("Engines & Tempo", [tempoCard, ...engineCards], lockedUntil("auto1"), allButtons);

  const overdriveLimit = limitSetting(
    "Stop at",
    "Overdrives",
    () => state.automation.overdriveMax,
    (v) => (state.automation.overdriveMax = v),
  );
  const latticeLimit = limitSetting(
    "Stop at",
    "Lattices",
    () => state.automation.latticeMax,
    (v) => (state.automation.latticeMax = v),
  );
  const overdriveWait = waitSetting(
    () => state.automation.overdriveWait,
    (v) => (state.automation.overdriveWait = v),
  );
  const latticeWait = waitSetting(
    () => state.automation.latticeWait,
    (v) => (state.automation.latticeWait = v),
  );
  const settingsRow = (...els: HTMLElement[]) => h("div", { class: "auto-settings" }, ...els);
  const resets = group(
    "Resets",
    [
      autobuyerCard({
        name: "Overdrive",
        get: () => state.automation.overdrive,
        set: (v) => (state.automation.overdrive = v),
        note: () => (areResetsPaused() ? "paused: you can Collapse" : "per Collapse; blank = no limit"),
        settings: settingsRow(overdriveLimit.el, overdriveWait.el),
      }),
      autobuyerCard({
        name: "Lattice",
        locked: cardLock("autolattice"),
        get: () => state.automation.lattice,
        set: (v) => (state.automation.lattice = v),
        note: () =>
          areResetsPaused()
            ? "paused: you can Collapse"
            : shardUpgrades.has("latticeworks")
              ? "goes before Overdrive"
              : "each one resets your Overdrives, so more is often slower",
        settings: settingsRow(latticeLimit.el, latticeWait.el),
      }),
      autobuyerCard({
        name: "Pause at the Horizon",
        get: () => state.automation.pauseResetsAtHorizon,
        set: (v) => (state.automation.pauseResetsAtHorizon = v),
        note: () => "once you can Collapse, a reset only restarts a finished run",
        wide: true,
      }),
    ],
    lockedUntil("automators2"),
    h(
      "p",
      { class: "auto-hint" },
      "Each press claims every Overdrive or Lattice your Engines cover. \"At most every\" spaces the presses out so Engines build up and one reset claims several: " +
        "0 is best early on, 10–20s once runs take a minute or more. The first 4 Overdrives never wait.",
    ),
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

  const collapseAt = h("input", {
    type: "number",
    min: 0,
    step: 1,
    placeholder: "any",
    onChange: () => {
      const v = Math.floor(Number(collapseAt.value));
      state.automation.collapseShards = collapseAt.value.trim() === "" || !Number.isFinite(v) ? 0 : Math.max(0, v);
    },
  });
  const collapseGroup = group(
    "Collapse",
    [
      autobuyerCard({
        name: "Auto-Collapse",
        get: () => state.automation.collapse,
        set: (v) => (state.automation.collapse = v),
        note: () => "blank = when Shards per minute peaks (best for most runs)",
        settings: h("label", { class: "auto-setting" }, "When it gives at least", collapseAt, "Shards"),
      }),
    ],
    lockedUntil("selfcollapse"),
  );

  const groups = [buyers, resets, heat, collapseGroup];
  const root = h("section", { class: "tab automation-tab" }, speed, ...groups.map((g) => g.root));

  return {
    root,
    update() {
      const now = autobuyInterval();
      setText(
        speed,
        (now <= MIN_INTERVAL
          ? `Autobuyers act every tick (${now.toFixed(2)}s), the fastest possible.`
          : `Autobuyers act every ${now.toFixed(2)}s, ${nextAutobuyInterval().toFixed(2)}s after your next Collapse.`) +
          (shardUpgrades.has("overclock") ? " Overclocked ×3." : "") +
          (hasBulkBuying() ? "" : " Each buys one at a time until Bulk Buying."),
      );
      for (const g of groups) g.update();
      setVisible(heat.root, isHeatUnlocked());
      setVisible(resets.root, hasEngineAutobuyers());
      setVisible(collapseGroup.root, hasAutoCollapse() || shardUpgrades.has("automators2"));
      if (document.activeElement !== collapseAt)
        collapseAt.value = state.automation.collapseShards > 0 ? String(state.automation.collapseShards) : "";
      overdriveLimit.sync();
      latticeLimit.sync();
      overdriveWait.sync();
      latticeWait.sync();
      if (hasThermostat() && document.activeElement !== threshold) threshold.value = String(state.heat.autoVentAt);
    },
  };
}

/** The Automation tab appears with the first autobuyers. */
export const isAutomationUnlocked = () => hasEngineAutobuyers() || hasResetAutobuyers();
