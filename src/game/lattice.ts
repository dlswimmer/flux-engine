import { ENGINE_COUNT, state } from "../core/state";
import { shardUpgrades } from "./collapse";
import { resetForLattice } from "./reset";

const BASE_REQUIREMENT = 40;
const REQUIREMENT_STEP = 20;
const TEMPO_BONUS_PER_LATTICE = 0.04;

/** Engine VIII needed for the next Lattice. */
export function latticeRequirement(): number {
  let req = BASE_REQUIREMENT + REQUIREMENT_STEP * state.lattices;
  if (shardUpgrades.has("latticeworks")) req -= 15;
  return req;
}

export const canLattice = () => state.engines[ENGINE_COUNT - 1].amount.gte(latticeRequirement());

export function doLattice(): boolean {
  if (!canLattice()) return false;
  state.lattices++;
  resetForLattice();
  return true;
}

/** Added to the per-level Tempo factor. */
export const latticeTempoBonus = () => state.lattices * TEMPO_BONUS_PER_LATTICE;
