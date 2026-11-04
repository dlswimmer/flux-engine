import { D, Decimal } from "../lib/decimal";

export const ENGINE_COUNT = 8;

/**
 * Bump this whenever the save shape changes in a way merge-with-defaults can't
 * handle on its own, and add a matching entry to MIGRATIONS in save.ts.
 */
export const SAVE_VERSION = 1;

/** One finished Collapse, for the recent-runs table on the Stats tab. */
export interface CollapseRecord {
  /** Which Collapse this was (1 = first). */
  number: number;
  /** Game seconds the run took. */
  time: number;
  shards: Decimal;
}

/** How many recent Collapses the save keeps. */
export const COLLAPSE_HISTORY = 10;

export interface EngineState {
  amount: Decimal;
  bought: number;
}

export interface GameState {
  meta: { version: number; created: number; lastTick: number };

  // Layer 0: the engine floor
  flux: Decimal;
  engines: EngineState[];
  tempo: number;
  overdrives: number;
  lattices: number;

  // Layer 1: Collapse
  collapse: {
    shards: Decimal;
    count: number;
    time: number;
    bestTime: number;
    /** Most Flux reached in this Collapse. Collapsing and Shard gain use this, so spending never costs you a Collapse. */
    peakFlux: Decimal;
    /** Best Shard gain seen this Collapse: a Surge's bonus is locked in when it ends. */
    peakShards: Decimal;
    upgrades: string[];
    /** Most recent last, at most COLLAPSE_HISTORY. */
    history: CollapseRecord[];
    /** Levels of the repeatable Overcharge Shard upgrade (after Breach). Reset by a Rift. */
    overcharge: number;
  };

  // Layer 2: Rift
  rift: {
    essence: Decimal;
    /** All Essence ever gained (Rift Lens scales with this, so spending never weakens it). */
    totalEssence: Decimal;
    count: number;
    time: number;
    bestTime: number;
    /** Owned skill-tree nodes. */
    nodes: string[];
    /** Refund every node at the next Rift. */
    respec: boolean;
    introduced: boolean;
  };

  // Twist: Engines build Heat; venting it trades the heat for a temporary Surge.
  heat: {
    amount: number;
    surgeTime: number;
    surgeMult: number;
    /** Heat at the moment of the last vent; the bar drains from here during the Surge. */
    ventedFrom: number;
    vents: number;
    autoVent: boolean;
    autoVentAt: number;
    introduced: boolean;
  };

  automation: {
    engines: boolean[];
    tempo: boolean;
    overdrive: boolean;
    lattice: boolean;
    /** Auto-resets stop once this Collapse has this many (Infinity = no limit). */
    overdriveMax: number;
    latticeMax: number;
    /** Auto-Collapse (Self-Collapse upgrade): Collapse once the next one gives at least this many Shards (0 = as soon as possible). */
    collapse: boolean;
    collapseShards: number;
  };

  stats: { timePlayed: number; totalFlux: Decimal; bestFlux: Decimal };
  options: { autosave: boolean; offlineProgress: boolean; devSpeed: number };
  ui: { tab: string; buyMode: "one" | "next" };
}

export const defaultEngines = (): EngineState[] =>
  Array.from({ length: ENGINE_COUNT }, () => ({ amount: D(0), bought: 0 }));

export function defaultState(): GameState {
  const now = Date.now();
  return {
    meta: { version: SAVE_VERSION, created: now, lastTick: now },

    flux: D(10),
    engines: defaultEngines(),
    tempo: 0,
    overdrives: 0,
    lattices: 0,

    collapse: { shards: D(0), count: 0, time: 0, bestTime: Infinity, peakFlux: D(0), peakShards: D(0), upgrades: [], history: [], overcharge: 0 },

    rift: {
      essence: D(0),
      totalEssence: D(0),
      count: 0,
      time: 0,
      bestTime: Infinity,
      nodes: [],
      respec: false,
      introduced: false,
    },

    heat: {
      amount: 0,
      surgeTime: 0,
      surgeMult: 1,
      ventedFrom: 0,
      vents: 0,
      autoVent: true,
      autoVentAt: 70,
      introduced: false,
    },

    automation: {
      engines: Array.from({ length: ENGINE_COUNT }, () => true),
      tempo: true,
      overdrive: false,
      lattice: false,
      // Sim (fully automated, ~Collapse 23-30): stopping near 10 Overdrives is fastest, and
      // without Latticeworks every extra Lattice slows a short run (unlimited: ~70% slower).
      overdriveMax: 10,
      latticeMax: 1,
      collapse: true,
      collapseShards: 0,
    },

    stats: { timePlayed: 0, totalFlux: D(0), bestFlux: D(0) },
    options: { autosave: true, offlineProgress: true, devSpeed: 1 },
    ui: { tab: "engines", buyMode: "next" },
  };
}

// Live ES-module binding: always read `state` at call time, never cache it,
// so importing a save (which swaps the whole object) is picked up everywhere.
export let state: GameState = defaultState();

export function replaceState(next: GameState) {
  state = next;
}
