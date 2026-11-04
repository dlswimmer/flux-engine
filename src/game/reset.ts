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

export function resetForLattice() {
  resetEngineFloor();
  // Without this, short late runs skip Lattice entirely: rebuilding Overdrives costs more than it gives.
  if (!shardUpgrades.has("latticeworks")) state.overdrives = 0;
}

export function resetForCollapse() {
  resetForLattice();
  state.lattices = 0;
  state.overdrives = shardUpgrades.has("ignition") ? 1 : 0;
  state.collapse.time = 0;
  resetHeat();
}
