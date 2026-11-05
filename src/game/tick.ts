import { state } from "../core/state";
import { runAutomation } from "./automation";
import { produce } from "./engines";
import { updateHeat } from "./heat";
import { trackPeakShardGain } from "./collapse";

/** Advance the game by `dt` seconds. Pure game logic, no DOM, so the sim can run it headless. */
export function tick(dt: number) {
  state.stats.timePlayed += dt;
  state.collapse.time += dt;
  state.rift.time += dt;
  state.sinceReset += dt;
  runAutomation(dt);
  updateHeat(dt);
  produce(dt);
  trackPeakShardGain();
}
