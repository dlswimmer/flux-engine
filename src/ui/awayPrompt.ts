import { formatTime } from "../core/format";
import { state } from "../core/state";
import { trialDef } from "../game/trials";
import { isBreached } from "../game/collapse";
import { AWAY_SHARDS, recentShardRate } from "../core/loop";
import { BALLAST_AWAY_MULT, hasNode } from "../game/rift";
import { h } from "./dom";

/** "You were away 12m. Use that time?" The game stays paused until the player answers. */
export function askAboutAway(seconds: number): Promise<boolean> {
  return new Promise((resolve) => {
    const trial = state.trials.active ? trialDef(state.trials.active as Parameters<typeof trialDef>[0]) : null;
    const answer = (use: boolean) => {
      overlay.remove();
      resolve(use);
    };
    const overlay = h(
      "div",
      { class: "away-overlay" },
      h(
        "div",
        { class: "panel away-box", role: "dialog", "aria-modal": "true" },
        h("h3", {}, "Welcome back"),
        h("p", {}, `You were away for ${formatTime(seconds)}. The game paused while you were gone.`),
        hasNode("ballast") ? h("p", {}, `Ballast: it counts as ${formatTime(seconds * BALLAST_AWAY_MULT)}.`) : null,
        !trial && isBreached() && recentShardRate() > 0
          ? h("p", {}, `It pays at least ${Math.round(AWAY_SHARDS.share * 100)}% of your recent Shards per minute, spent on Overcharge.`)
          : null,
        trial ? h("p", { class: "away-warn" }, `You're in the ${trial.name} Trial: used time counts toward it.`) : null,
        h(
          "div",
          { class: "button-row" },
          h("button", { onClick: () => answer(true) }, `Use ${formatTime(seconds)}`),
          h("button", { class: "secondary", onClick: () => answer(false) }, "Skip it"),
        ),
      ),
    );
    document.body.append(overlay);
  });
}
