import { emit } from "../core/events";
import { D, Decimal, type DecimalSource } from "../lib/decimal";

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  cost: DecimalSource;
  /** Current effect value, shown in the UI and read by game code. */
  effect?: () => Decimal;
  effectText?: (value: Decimal) => string;
  /** Shown under its own heading (the Collapse tab splits power and automation). */
  group?: "automation";
  /** Upgrades that must be owned before this one can be bought. */
  requires?: string[];
  /** Shown but unbuyable while this returns a reason (e.g. "Win the Rigid Frame Trial"). */
  gate?: () => string | null;
  /** Hidden and unbuyable until this returns true (e.g. its mechanic isn't unlocked yet). */
  unlocked?: () => boolean;
  /** Runs once when bought, e.g. to apply a "start with X" upgrade to the current run too. */
  onBuy?: () => void;
}

export interface Currency {
  get(): Decimal;
  set(value: Decimal): void;
}

/**
 * A purchasable set of one-time upgrades paid in one currency. Every prestige
 * layer gets its own set; ownership lives in the save as a list of ids.
 */
export class UpgradeSet {
  private byId: Map<string, UpgradeDef>;

  constructor(
    readonly defs: UpgradeDef[],
    private owned: () => string[],
    private currency: Currency,
    /** Owned but switched off right now (e.g. during a Trial): has() is false, owns() stays true. */
    private suppressed: (id: string) => boolean = () => false,
    /** Price right now, when it can differ from def.cost (Crossover's 2× second branch). */
    private price: (def: UpgradeDef) => DecimalSource = (def) => def.cost,
  ) {
    this.byId = new Map(defs.map((d) => [d.id, d]));
  }

  get(id: string): UpgradeDef {
    const def = this.byId.get(id);
    if (!def) throw new Error(`Unknown upgrade: ${id}`);
    return def;
  }

  /** Bought (whether or not it is working right now). */
  owns(id: string): boolean {
    return this.owned().includes(id);
  }

  /** Bought and working: what game logic checks. */
  has(id: string): boolean {
    return this.owns(id) && !this.suppressed(id);
  }

  /** What it costs right now. */
  cost(id: string): Decimal {
    return D(this.price(this.get(id)));
  }

  isSuppressed(id: string): boolean {
    return this.owns(id) && this.suppressed(id);
  }

  isVisible(id: string): boolean {
    return this.get(id).unlocked?.() ?? true;
  }

  isAvailable(id: string): boolean {
    return this.isVisible(id) && (this.get(id).requires ?? []).every((r) => this.owns(r)) && !this.get(id).gate?.();
  }

  canBuy(id: string): boolean {
    return !this.owns(id) && this.isAvailable(id) && this.currency.get().gte(this.cost(id));
  }

  buy(id: string): boolean {
    if (!this.canBuy(id)) return false;
    this.currency.set(this.currency.get().sub(this.cost(id)));
    this.owned().push(id);
    this.get(id).onBuy?.();
    emit("upgrade", id);
    return true;
  }

  /** The upgrade's effect if owned, otherwise `fallback` (×1 by default). */
  effect(id: string, fallback: DecimalSource = 1): Decimal {
    const def = this.get(id);
    return this.has(id) && def.effect ? def.effect() : D(fallback);
  }
}
