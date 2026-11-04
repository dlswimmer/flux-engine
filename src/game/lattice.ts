import { emit } from "../core/events";
import { ENGINE_COUNT, state } from "../core/state";
import { shardUpgrades } from "./collapse";
import { resetForLattice } from "./reset";

const BASE_REQUIREMENT = 40;
const REQUIREMENT_STEP = 20;
/**
 * Quadratic part: each Lattice is worth ~30 orders of magnitude of depth past the Horizon,
 * and with a linear requirement Breach players stacked six of them for an instant Rift.
 * The first two (the only ones the first-run sweep uses) barely change.
 */
const REQUIREMENT_QUADRATIC = 10;
const TEMPO_BONUS_PER_LATTICE = 0.04;

/** Engine VIII needed for the next Lattice. */
export function latticeRequirement(): number {
  const l = state.lattices;
  let req = BASE_REQUIREMENT + REQUIREMENT_STEP * l + REQUIREMENT_QUADRATIC * l * l;
  if (shardUpgrades.has("latticeworks")) req -= 15;
  return req;
}

export const canLattice = () => state.engines[ENGINE_COUNT - 1].amount.gte(latticeRequirement());

export function doLattice(): boolean {
  if (!canLattice()) return false;
  state.lattices++;
  state.stats.lattices++;
  resetForLattice();
  emit("lattice");
  return true;
}

/** Added to the per-level Tempo factor. */
export const latticeTempoBonus = () => state.lattices * TEMPO_BONUS_PER_LATTICE;
