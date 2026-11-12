import { tick } from "../game/tick";
import { BALLAST_AWAY_MULT, hasNode } from "../game/rift";
import { buyMaxOvercharge, isBreached, shardRate } from "../game/collapse";
import { activeTrial } from "../game/trials";
import { logEntry } from "./playLog";
import { state } from "./state";

const TICK_MS = 50;
const MAX_CATCHUP_TICKS = 1000;
/** Shorter absences just catch up; longer ones ask first. */
const ASK_AFTER_SECONDS = 5;

/** Run `seconds` of game time in at most MAX_CATCHUP_TICKS steps. */
export function simulate(seconds: number) {
  const steps = Math.min(MAX_CATCHUP_TICKS, Math.ceil(seconds / (TICK_MS / 1000)));
  const dt = seconds / steps;
  for (let i = 0; i < steps; i++) tick(dt);
}

/**
 * After Breach, used time away pays at least this share of your recent Shards per minute. A
 * catch-up step is ~11s for 3h away while a run lasts 1-2s, so plain simulation lost ~90% of
 * the Collapses, and nothing bought Overcharge before Perpetual: David's 3h09m away was worth
 * one Overcharge level (2026-11-12). Not compounding: Overcharge is bought once, at the end.
 */
/** Mutable so `npm run report -- styles` can compare (AWAY_SHARE=0). */
export const AWAY_SHARDS = { share: 0.5 };

/**
 * Shards per second recently (see shardRate), 0 if it's too small to matter. It used to be the
 * last 10 Collapses: the Rift's best, deepest runs, so an hour away paid ~1.5× active play
 * (David, 2026-11-12: 54 min away → 3.9M Shards, Overcharge 28 → 41, 121 Essence, against
 * ~84 Essence for the six Rifts he'd have played).
 */
export const recentShardRate = (): number => shardRate();

/** Use `seconds` of time away: simulate it, and after Breach top Shards up to AWAY_SHARDS.share of the recent rate. */
export function useAwayTime(seconds: number): { seconds: number; topUp: number } {
  const used = seconds * (hasNode("ballast") ? BALLAST_AWAY_MULT : 1);
  const credit = isBreached() && activeTrial() === null ? recentShardRate() * used * AWAY_SHARDS.share : 0;
  const before = state.stats.shardsEarned.toNumber();
  simulate(used);
  const topUp = Math.max(0, credit - (state.stats.shardsEarned.toNumber() - before));
  if (topUp > 0) {
    state.collapse.shards = state.collapse.shards.add(topUp);
    state.stats.shardsEarned = state.stats.shardsEarned.add(topUp);
    buyMaxOvercharge();
  }
  return { seconds: used, topUp };
}

/** Asks the player whether to play out time spent away. */
export type AskAway = (seconds: number) => Promise<boolean>;

let asking = false;

/** The game isn't running: off screen, or waiting for the player to answer about time away. */
export const isPaused = () => asking || document.visibilityState === "hidden";

/**
 * The game only runs while it's on screen. Time away (closed, or a hidden tab) is frozen, and
 * on return the player is asked whether to use it, so a Trial or a timed run isn't decided while
 * they weren't looking. Turning "Offline progress" off skips the question and drops the time.
 */
function cameBack(seconds: number, ask: AskAway) {
  if (seconds <= ASK_AFTER_SECONDS) {
    simulate(seconds * state.options.devSpeed);
    return;
  }
  if (!state.options.offlineProgress) {
    logEntry("away", { seconds: Math.round(seconds), used: false, asked: false });
    return;
  }
  asking = true;
  ask(seconds).then((use) => {
    // Ballast (Rift node): used time away counts 1.5×.
    const result = use ? useAwayTime(seconds * state.options.devSpeed) : null;
    logEntry("away", { seconds: Math.round(seconds), used: use, trial: state.trials.active, shardTopUp: Math.round(result?.topUp ?? 0) });
    asking = false;
    state.meta.lastTick = Date.now();
  });
}

/** Starts the fixed-rate logic loop. */
export function startLoop(ask: AskAway) {
  const awayFor = () => {
    const now = Date.now();
    const seconds = Math.max(0, (now - state.meta.lastTick) / 1000);
    state.meta.lastTick = now;
    return seconds;
  };
  if (document.visibilityState === "visible") cameBack(awayFor(), ask);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !asking) cameBack(awayFor(), ask);
  });

  setInterval(() => {
    // Hidden: leave lastTick where it was, so the return knows how long you were gone.
    if (document.visibilityState === "hidden") return;
    if (asking) {
      state.meta.lastTick = Date.now();
      return;
    }
    const now = Date.now();
    const dt = ((now - state.meta.lastTick) / 1000) * state.options.devSpeed;
    state.meta.lastTick = now;
    // A stalled page (a slow frame, a debugger) still catches up in steps, not one giant tick.
    if (dt > 1) simulate(dt);
    else tick(dt);
  }, TICK_MS);
}
