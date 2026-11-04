import { tick } from "../game/tick";
import { state } from "./state";

const TICK_MS = 50;
const MAX_CATCHUP_TICKS = 1000;

/** Run `seconds` of game time in at most MAX_CATCHUP_TICKS steps. */
export function simulate(seconds: number) {
  const steps = Math.min(MAX_CATCHUP_TICKS, Math.ceil(seconds / (TICK_MS / 1000)));
  const dt = seconds / steps;
  for (let i = 0; i < steps; i++) tick(dt);
}

/** Starts the fixed-rate logic loop. Returns the offline seconds that were simulated. */
export function startLoop(): number {
  const now = Date.now();
  const offline = (now - state.meta.lastTick) / 1000;
  state.meta.lastTick = now;
  const simulated = state.options.offlineProgress && offline > 1 ? offline : 0;
  if (simulated) simulate(simulated * state.options.devSpeed);

  setInterval(() => {
    const now = Date.now();
    const dt = ((now - state.meta.lastTick) / 1000) * state.options.devSpeed;
    state.meta.lastTick = now;
    // Background tabs get throttled; catch up in bigger chunks instead of one giant tick.
    if (dt > 1) simulate(dt);
    else tick(dt);
  }, TICK_MS);

  return simulated;
}
