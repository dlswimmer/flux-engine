import { formatTime } from "../core/format";
import { state } from "../core/state";
import { canCollapse } from "../game/collapse";
import {
  SPRINT_LIMIT,
  TRIALS,
  abandonTrial,
  activeTrial,
  hasTrialReward,
  isTrialAvailable,
  startTrial,
  trialDef,
  type TrialDef,
} from "../game/trials";
import { h, setClass, setText, setVisible, type View } from "./dom";

function trialCard(def: TrialDef): View {
  const status = h("div", { class: "trial-status" });
  const start = h("button", { class: "secondary", onClick: () => startTrial(def.id) });
  const root = h(
    "div",
    { class: "trial-card" },
    h("div", { class: "trial-name" }, def.name),
    h("div", { class: "trial-rule" }, def.rule),
    h("div", { class: "trial-reward" }, "Reward: ", def.reward),
    status,
    start,
  );
  return {
    root,
    update() {
      const won = hasTrialReward(def.id);
      const active = activeTrial() === def.id;
      const available = isTrialAvailable(def.id);
      setClass(root, "won", won);
      setClass(root, "active", active);
      setClass(root, "locked", !available);
      const best = state.trials.best[def.id];
      setText(
        status,
        active
          ? "In progress"
          : !available
            ? `Win ${(def.requires ?? []).filter((id) => !hasTrialReward(id)).map((id) => trialDef(id).name).join(", ")} first`
            : won
              ? `Won · best ${formatTime(best ?? 0)}`
              : "",
      );
      // One Trial at a time: the others' buttons hide while one runs.
      setVisible(start, available && activeTrial() === null);
      setText(start, won ? "Replay" : canCollapse() ? "Collapse and start" : "Start (restarts this run)");
    },
  };
}

export function trialsTab(): View {
  const banner = h("p", { class: "trial-banner-text" });
  const abandon = h("button", { class: "secondary", onClick: abandonTrial }, "Give up");
  const bannerPanel = h("div", { class: "panel trial-banner" }, banner, abandon);
  const cards = TRIALS.map(trialCard);
  const summary = h("p", { class: "summary" });
  const root = h(
    "section",
    { class: "tab trials-tab" },
    summary,
    h(
      "p",
      { class: "trial-intro" },
      "Replay a Collapse under a rule. Reach the Horizon and Collapse to win its reward for good: Rifts keep them. " +
        "None are needed for the Rift, and some are out of reach until you're much stronger.",
    ),
    bannerPanel,
    h("div", { class: "trial-grid" }, ...cards.map((c) => c.root)),
  );
  return {
    root,
    update() {
      const id = activeTrial();
      setVisible(bannerPanel, id !== null);
      if (id) {
        const def = trialDef(id);
        const left = id === "sprint" ? ` · ${Math.max(0, SPRINT_LIMIT - state.collapse.time).toFixed(0)}s left` : "";
        setText(
          banner,
          `In Trial: ${def.name}. ${def.rule} ${canCollapse() ? "You can Collapse to win it now." : `This run ${formatTime(state.collapse.time)}${left}.`}`,
        );
      }
      setText(summary, `${state.trials.completed.length} of ${TRIALS.length} Trials won`);
      for (const c of cards) c.update();
    },
  };
}
