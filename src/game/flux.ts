import type { Decimal } from "../lib/decimal";
import { state } from "../core/state";
import { capAtHorizon } from "./collapse";

export function addFlux(amount: Decimal) {
  state.flux = state.flux.add(amount);
  state.stats.totalFlux = state.stats.totalFlux.add(amount);
  capAtHorizon();
  if (state.flux.gt(state.collapse.peakFlux)) state.collapse.peakFlux = state.flux;
  if (state.flux.gt(state.stats.bestFlux)) state.stats.bestFlux = state.flux;
}
