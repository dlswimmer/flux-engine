import { D, Decimal } from "../lib/decimal";

export const ENGINE_COUNT = 8;

/**
 * Bump this whenever the save shape changes in a way merge-with-defaults can't
 * handle on its own, and add a matching entry to MIGRATIONS in save.ts.
 */
export const SAVE_VERSION = 1;

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
    upgrades: string[];
  };

  // Twist: Engines build Heat; venting it trades the heat for a temporary Surge.
  heat: {
    amount: number;
    surgeTime: number;
    surgeMult: number;
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

    collapse: { shards: D(0), count: 0, time: 0, bestTime: Infinity, upgrades: [] },

    heat: {
      amount: 0,
      surgeTime: 0,
      surgeMult: 1,
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
