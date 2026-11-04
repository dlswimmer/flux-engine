// Single import point for big numbers. break_eternity goes far past 1e308
// (up to tetration territory), which the later prestige layers will need.
import Decimal, { type DecimalSource } from "break_eternity.js";

export { Decimal, type DecimalSource };

export const D = (value: DecimalSource): Decimal => new Decimal(value);
