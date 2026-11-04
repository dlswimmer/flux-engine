import { D } from "../lib/decimal";
import { defaultEngines, state } from "../core/state";
import { shardUpgrades } from "./collapse";
import { resetHeat } from "./heat";

// Each reset wipes everything below its own layer, then keeps what upgrades say to keep.
// New prestige layers add a resetForX that calls the one below it.

function resetEngineFloor() {
  state.flux = D(10);
  state.engines = defaultEngines();
  state.tempo = 0;
}

export function resetForOverdrive() {
  resetEngineFloor();
}

const LATTICEWORKS_KEEPS = 4;

export function resetForLattice() {
  resetEngineFloor();
  // Latticeworks keeps the 4 Overdrives that unlock Engines V–VIII; the extra ×2s still reset.
  // Without it, short late runs skip Lattice entirely: rebuilding costs more than it gives.
  state.overdrives = shardUpgrades.has("latticeworks") ? Math.min(state.overdrives, LATTICEWORKS_KEEPS) : 0;
}

export function resetForCollapse() {
  resetForLattice();
  state.lattices = 0;
  state.overdrives = shardUpgrades.has("ignition") ? 1 : 0;
  state.collapse.time = 0;
  resetHeat();
}
