// Ids of the automation Shard upgrades, in their own module so trials.ts and rift.ts can list
// them without importing automation.ts (which imports collapse.ts, which imports trials.ts).

/** "Automate Engine I" … "Automate Engine VIII", one per tier. */
export const ENGINE_AUTOBUYER_IDS = ["auto1", "auto2", "auto3", "auto4", "auto5", "auto6", "auto7", "auto8"];
export const TEMPO_AUTOBUYER_ID = "autotempo";

/**
 * Every automation upgrade: kept by the first Rift milestone and still working in a Trial.
 * automators2 is the Overdrive autobuyer (its id predates the split, so old saves keep it).
 */
export const AUTOMATION_UPGRADES = [
  ...ENGINE_AUTOBUYER_IDS,
  TEMPO_AUTOBUYER_ID,
  "bulk",
  "overclock",
  "automators2",
  "autolattice",
  "selfcollapse",
  "thermostat",
];
