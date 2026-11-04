import { state } from "../core/state";
import { maxAll } from "../game/engines";
import { canVent, isHeatUnlocked, isSurging, surgeMultFor, vent } from "../game/heat";
import { canLattice, doLattice } from "../game/lattice";
import { canOverdrive, doOverdrive } from "../game/overdrive";
import { h, holdToRepeat, setClass, setDisabled, setText, type View } from "./dom";

/**
 * Phone-only thumb bar for the Engines tab: what the hotkeys do on desktop.
 * Slots never move (hidden ones keep their space), so a button can't slide out
 * from under a thumb that's holding Max All.
 */
export function actionBar(): View {
  const maxButton = h("button", { onClick: maxAll }, "Max All");
  holdToRepeat(maxButton, maxAll);
  const ventButton = h("button", { class: "vent-btn", onClick: vent });
  const overdriveButton = h("button", { class: "secondary", onClick: doOverdrive }, "Overdrive");
  const latticeButton = h("button", { class: "secondary", onClick: doLattice }, "Lattice");
  const root = h("div", { class: "action-bar" }, maxButton, ventButton, overdriveButton, latticeButton);

  return {
    root,
    update() {
      setClass(ventButton, "slot-hidden", !isHeatUnlocked());
      setText(
        ventButton,
        isSurging() ? `Surge ${state.heat.surgeTime.toFixed(0)}s` : `Vent ×${surgeMultFor(state.heat.amount).toFixed(1)}`,
      );
      setDisabled(ventButton, !canVent());
      setDisabled(overdriveButton, !canOverdrive());
      setClass(latticeButton, "slot-hidden", state.overdrives < 4 && state.lattices === 0);
      setDisabled(latticeButton, !canLattice());
    },
  };
}
