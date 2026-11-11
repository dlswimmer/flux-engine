import { tick } from "../game/tick";
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
    if (use) simulate(seconds * state.options.devSpeed);
    logEntry("away", { seconds: Math.round(seconds), used: use, trial: state.trials.active });
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
