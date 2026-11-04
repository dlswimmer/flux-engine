import { state } from "../core/state";
import { doCollapse, isCollapseUnlocked } from "../game/collapse";
import { maxAll } from "../game/engines";
import { isHeatUnlocked, vent } from "../game/heat";
import { doLattice } from "../game/lattice";
import { doOverdrive } from "../game/overdrive";
import { buyMaxTempo } from "../game/tempo";
import { actionBar } from "./actionBar";
import { automationTab, isAutomationUnlocked } from "./automationTab";
import { collapseTab } from "./collapseTab";
import { engineRoomTab } from "./engineRoom";
import { riftTab } from "./riftTab";
import { canRift, doRift, isRiftUnlocked } from "../game/rift";
import { h, keyHint, setClass, setVisible, type View } from "./dom";
import { enginesTab, toggleBuyMode } from "./enginesTab";
import { headerView } from "./header";
import { optionsTab } from "./optionsTab";
import { statsTab } from "./statsTab";
import { notify } from "./toast";

interface Tab {
  id: string;
  label: string;
  /** Used on phones, where five tabs share one row. */
  short?: string;
  unlocked: () => boolean;
  view: View;
}

const room = engineRoomTab(() => state.ui.tab === "room");

// New layers register a tab here.
const TABS: Tab[] = [
  { id: "engines", label: "Engines", unlocked: () => true, view: enginesTab() },
  { id: "collapse", label: "Collapse", unlocked: isCollapseUnlocked, view: collapseTab() },
  { id: "automation", label: "Automation", short: "Auto", unlocked: isAutomationUnlocked, view: automationTab() },
  { id: "rift", label: "Rift", unlocked: isRiftUnlocked, view: riftTab() },
  { id: "stats", label: "Stats", unlocked: () => true, view: statsTab() },
  { id: "room", label: "Engine Room", short: "Room", unlocked: () => true, view: room },
  { id: "options", label: "Options", unlocked: () => true, view: optionsTab() },
];

const HOTKEYS: Record<string, () => unknown> = {
  m: maxAll,
  t: buyMaxTempo,
  o: doOverdrive,
  l: doLattice,
  c: doCollapse,
  v: vent,
  r: doRift,
  b: toggleBuyMode,
};

export function mountUI(root: HTMLElement) {
  const header = headerView();
  const tabButtons = TABS.map((tab) =>
    h(
      "button",
      { class: "tab-button", onClick: () => (state.ui.tab = tab.id) },
      h("span", { class: "tab-long" }, tab.label),
      h("span", { class: "tab-short" }, tab.short ?? tab.label),
    ),
  );

  const bar = actionBar();
  root.append(
    header.root,
    h("main", {}, ...TABS.map((t) => t.view.root)),
    h("div", { class: "bottom-dock" }, bar.root, h("nav", { class: "tabs" }, ...tabButtons)),
  );

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    HOTKEYS[e.key.toLowerCase()]?.();
  });

  const render = () => {
    if (isHeatUnlocked() && !state.heat.introduced) {
      state.heat.introduced = true;
      notify(`Heat unlocked: your Engines now run hot. Vent${keyHint("V")} to turn Heat into a Surge.`, 8000);
    }
    if (canRift() && !state.rift.introduced) {
      state.rift.introduced = true;
      notify("The Rift is open: see the Rift tab. Rifting resets the Collapse layer for Essence.", 8000);
    }
    header.update();
    const active = TABS.find((t) => t.id === state.ui.tab && t.unlocked()) ?? TABS[0];
    TABS.forEach((tab, i) => {
      setVisible(tabButtons[i], tab.unlocked());
      setClass(tabButtons[i], "active", tab === active);
      setVisible(tab.view.root, tab === active);
    });
    active.view.update();
    if (active.id !== "room") room.leave();
    setVisible(bar.root, active.id === "engines");
    if (active.id === "engines") bar.update();
  };
  const frame = () => {
    render();
    requestAnimationFrame(frame);
  };
  render(); // paint immediately; rAF doesn't fire while the tab is hidden
  // Dev only: lets tooling drive a frame while the tab is hidden (rAF is paused then).
  if (import.meta.env.DEV) (window as unknown as { __render: () => void }).__render = render;
  requestAnimationFrame(frame);
}
