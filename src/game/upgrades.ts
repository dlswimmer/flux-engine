import { D, Decimal, type DecimalSource } from "../lib/decimal";

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  cost: DecimalSource;
  /** Current effect value, shown in the UI and read by game code. */
  effect?: () => Decimal;
  effectText?: (value: Decimal) => string;
  /** Upgrades that must be owned before this one can be bought. */
  requires?: string[];
  /** Hidden and unbuyable until this returns true (e.g. its mechanic isn't unlocked yet). */
  unlocked?: () => boolean;
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
  ) {
    this.byId = new Map(defs.map((d) => [d.id, d]));
  }

  get(id: string): UpgradeDef {
    const def = this.byId.get(id);
    if (!def) throw new Error(`Unknown upgrade: ${id}`);
    return def;
  }

  has(id: string): boolean {
    return this.owned().includes(id);
  }

  isVisible(id: string): boolean {
    return this.get(id).unlocked?.() ?? true;
  }

  isAvailable(id: string): boolean {
    return this.isVisible(id) && (this.get(id).requires ?? []).every((r) => this.has(r));
  }

  canBuy(id: string): boolean {
    return !this.has(id) && this.isAvailable(id) && this.currency.get().gte(this.get(id).cost);
  }

  buy(id: string): boolean {
    if (!this.canBuy(id)) return false;
    this.currency.set(this.currency.get().sub(this.get(id).cost));
    this.owned().push(id);
    return true;
  }

  /** The upgrade's effect if owned, otherwise `fallback` (×1 by default). */
  effect(id: string, fallback: DecimalSource = 1): Decimal {
    const def = this.get(id);
    return this.has(id) && def.effect ? def.effect() : D(fallback);
  }
}
