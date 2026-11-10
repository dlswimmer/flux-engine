import { formatTime } from "../core/format";
import { state } from "../core/state";
import { canCollapse } from "../game/collapse";
import { abandonRiftTrial, canRift, startRiftTrial } from "../game/rift";
import {
  RIFT_TRIALS,
  RIFT_TRIALS_UNLOCK,
  SPRINT_LIMIT,
  TRIALS,
  abandonTrial,
  activeRiftTrial,
  activeTrial,
  hasRiftTrialReward,
  hasTrialReward,
  isRiftTrialAvailable,
  isRiftTrialsUnlocked,
  isTrialAvailable,
  riftTrialDef,
  riftTrialMissing,
  ruleActive,
  startTrial,
  trialDef,
  type RiftTrialDef,
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
            ? activeRiftTrial()
              ? "Not during a Rift Trial"
              : `Win ${(def.requires ?? []).filter((id) => !hasTrialReward(id)).map((id) => trialDef(id).name).join(", ")} first`
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

function riftTrialCard(def: RiftTrialDef): View {
  const status = h("div", { class: "trial-status" });
  const start = h("button", { class: "secondary", onClick: () => startRiftTrial(def.id) });
  const rules = h(
    "ul",
    { class: "trial-rules" },
    ...def.rules.map((id) => h("li", {}, h("b", {}, trialDef(id).name), ": ", trialDef(id).rule)),
  );
  const root = h(
    "div",
    { class: "trial-card rift-trial-card" },
    h("div", { class: "trial-name" }, def.name),
    rules,
    h("div", { class: "trial-reward" }, "Reward: ", def.reward),
    status,
    start,
  );
  return {
    root,
    update() {
      const won = hasRiftTrialReward(def.id);
      const active = activeRiftTrial() === def.id;
      const available = isRiftTrialAvailable(def.id);
      setClass(root, "won", won);
      setClass(root, "active", active);
      setClass(root, "locked", !available);
      const best = state.riftTrials.best[def.id];
      setText(
        status,
        active
          ? "In progress"
          : !available
            ? `Win ${riftTrialMissing(def.id).join(", ")} first`
            : won
              ? `Won · best ${formatTime(best ?? 0)}`
              : "",
      );
      setVisible(start, available && activeRiftTrial() === null);
      setText(start, won ? "Replay" : canRift() ? "Rift and start" : "Start (restarts this Rift, no Essence)");
    },
  };
}

export function trialsTab(): View {
  const banner = h("p", { class: "trial-banner-text" });
  const abandon = h("button", { class: "secondary", onClick: abandonTrial }, "Give up");
  const bannerPanel = h("div", { class: "panel trial-banner" }, banner, abandon);
  const cards = TRIALS.map(trialCard);
  const summary = h("p", { class: "summary" });

  const riftBanner = h("p", { class: "trial-banner-text" });
  const riftAbandon = h("button", { class: "secondary", onClick: abandonRiftTrial }, "Give up");
  const riftBannerPanel = h("div", { class: "panel trial-banner rift" }, riftBanner, riftAbandon);
  const riftCards = RIFT_TRIALS.map(riftTrialCard);
  const riftSummary = h("p", { class: "summary" });
  const riftLocked = h("p", { class: "trial-intro" }, `Rift Trials open after ${RIFT_TRIALS_UNLOCK} Rifts.`);
  const riftSection = h(
    "div",
    { class: "rift-trials" },
    h("h2", {}, "Rift Trials"),
    riftSummary,
    h(
      "p",
      { class: "trial-intro" },
      "Play a whole Rift from scratch with several Trial rules at once, in every Collapse. " +
        "Only the first Rift milestone (automation) holds; your Rift tree and other rewards still work. " +
        "Rift to win its reward for good. Giving up just lifts the rules.",
    ),
    riftLocked,
    riftBannerPanel,
    h("div", { class: "trial-grid" }, ...riftCards.map((c) => c.root)),
  );
  const root = h(
    "section",
    { class: "tab trials-tab" },
    summary,
    h(
      "p",
      { class: "trial-intro" },
      "Replay a Collapse from scratch under a rule: your Shard upgrades and Overcharge are off, except automation. " +
        "Reach the Horizon and Collapse to win its reward for good (Rifts keep them). " +
        "None are needed for the Rift, and the later ones are out of reach until you're much stronger.",
    ),
    bannerPanel,
    h("div", { class: "trial-grid" }, ...cards.map((c) => c.root)),
    riftSection,
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

      // Rift Trials: the section shows once you've won a Collapse Trial, so the goal is visible early.
      setVisible(riftSection, state.trials.completed.length > 0 || isRiftTrialsUnlocked());
      const unlocked = isRiftTrialsUnlocked();
      setVisible(riftLocked, !unlocked);
      const rid = activeRiftTrial();
      setVisible(riftBannerPanel, rid !== null);
      if (rid) {
        const def = riftTrialDef(rid);
        const left = ruleActive("sprint") && !canCollapse() ? ` · ${Math.max(0, SPRINT_LIMIT - state.collapse.time).toFixed(0)}s left in this run` : "";
        setText(
          riftBanner,
          `In Rift Trial: ${def.name} (${def.rules.map((r) => trialDef(r).name).join(" + ")}). ` +
            (canRift() ? "You can Rift to win it now." : `This Rift ${formatTime(state.rift.time)}${left}.`),
        );
      }
      setText(riftSummary, `${state.riftTrials.completed.length} of ${RIFT_TRIALS.length} Rift Trials won`);
      for (const c of riftCards) c.update();
    },
  };
}
