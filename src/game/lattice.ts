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

/** Engine VIII needed for Lattice number `l` (0-based). */
function requirementAt(l: number): number {
  let req = BASE_REQUIREMENT + REQUIREMENT_STEP * l + REQUIREMENT_QUADRATIC * l * l;
  if (shardUpgrades.has("latticeworks")) req -= 15;
  return req;
}

/** Engine VIII needed for the next Lattice. */
export const latticeRequirement = () => requirementAt(state.lattices);

/** How many Lattices your Engine VIII covers right now (at most `limit`): one reset claims them all. */
export function latticesAvailable(limit = Infinity): number {
  const have = state.engines[ENGINE_COUNT - 1].amount;
  let count = 0;
  // The requirement grows quadratically, so this is at most a few hundred steps.
  while (count < limit && count < 10000 && have.gte(requirementAt(state.lattices + count))) count++;
  return count;
}

/** Requirement of the Lattice after the ones you could claim now. */
export const nextLatticeRequirement = () => requirementAt(state.lattices + latticesAvailable());

export const canLattice = () => latticesAvailable(1) > 0;

/** Claims every Lattice your Engine VIII covers (up to `limit`), with one reset. */
export function doLattice(limit = Infinity): boolean {
  const count = latticesAvailable(limit);
  if (count < 1) return false;
  state.lattices += count;
  state.stats.lattices += count;
  resetForLattice();
  emit("lattice");
  return true;
}

/** Added to the per-level Tempo factor. */
export const latticeTempoBonus = () => state.lattices * TEMPO_BONUS_PER_LATTICE;
