import { D } from "../lib/decimal";
import { defaultEngines, state } from "../core/state";
import { shardUpgrades } from "./collapse";
import { resetHeat } from "./heat";
import { hasNode, keptShardUpgrades } from "./rift";

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

/** A floor for the whole Collapse: no reset inside it goes below this (Ignition 1, Head Start 4). */
const minOverdrives = () => (hasNode("head-start") ? 4 : shardUpgrades.has("ignition") ? 1 : 0);

export function resetForLattice() {
  resetEngineFloor();
  // Latticeworks keeps the 4 Overdrives that unlock Engines V–VIII; the extra ×2s still reset.
  // Without it, short late runs skip Lattice entirely: rebuilding costs more than it gives.
  const kept = shardUpgrades.has("latticeworks") ? Math.min(state.overdrives, LATTICEWORKS_KEEPS) : 0;
  state.overdrives = Math.max(kept, minOverdrives());
}

export function resetForCollapse() {
  resetForLattice();
  state.lattices = 0;
  state.overdrives = minOverdrives();
  state.collapse.time = 0;
  state.collapse.peakFlux = D(0);
  resetHeat();
}

// ---------- Test tools (Options → Dev, shown with ?dev) ----------

/** Shards and Overcharge to 0 and a fresh Collapse; Shard upgrades and Collapse count stay. */
export function devResetShards() {
  state.collapse.shards = D(0);
  state.collapse.overcharge = 0;
  resetForCollapse();
}

/** Back to before your first Rift: no Essence, Rifts or tree nodes. */
export function devResetRift() {
  state.rift.essence = D(0);
  state.rift.totalEssence = D(0);
  state.rift.count = 0;
  state.rift.time = 0;
  state.rift.bestTime = Infinity;
  state.rift.nodes = [];
  state.rift.respec = false;
  state.rift.introduced = false;
  // Head Start's 4 Overdrives no longer apply.
  resetForCollapse();
}

/**
 * A Rift wipes the Collapse layer: Shards, Overcharge, and every Shard upgrade except the
 * ones Rift milestones keep. Collapse count stays (it drives Echo and autobuyer speed).
 */
export function resetForRift() {
  state.collapse.shards = D(0);
  state.collapse.overcharge = 0;
  const kept = keptShardUpgrades();
  state.collapse.upgrades = state.collapse.upgrades.filter((id) => kept.includes(id));
  resetForCollapse();
  state.rift.time = 0;
}
