import { Decimal, type DecimalSource } from "../lib/decimal";

const withCommas = (n: number) => Math.floor(n).toLocaleString("en-US");

/** Scientific notation that degrades gracefully: 1,234 → 1.23e45 → e1.23e45 → F5.00 */
export function format(value: DecimalSource, places = 2, smallPlaces = 0): string {
  const d = new Decimal(value);
  if (Number.isNaN(d.mag)) return "NaN";
  if (d.sign < 0) return "-" + format(d.neg(), places, smallPlaces);
  if (d.mag === Infinity) return "∞";

  if (d.lt(1e6)) {
    const n = d.toNumber();
    return n < 1000 ? n.toFixed(smallPlaces) : withCommas(n);
  }

  if (d.lt("1e1000000")) {
    let exponent = Math.floor(d.log10().toNumber());
    let mantissa = d.div(Decimal.pow(10, exponent)).toNumber();
    if (Number(mantissa.toFixed(places)) >= 10) {
      mantissa = 1;
      exponent++;
    }
    return `${mantissa.toFixed(places)}e${withCommas(exponent)}`;
  }

  if (d.layer < 6) return "e" + format(d.log10(), places);
  return "F" + d.slog().toNumber().toFixed(places);
}

export const formatInt = (value: DecimalSource) => format(value, 2, 0);
export const formatMult = (value: DecimalSource, places = 2) => "×" + format(value, places, places);

/** "1 Shard", "3 Shards", "1.00e10 Shards" */
export const formatCount = (value: DecimalSource, singular: string, plural = singular + "s") =>
  `${formatInt(value)} ${new Decimal(value).eq(1) ? singular : plural}`;

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600) % 24;
  const d = Math.floor(seconds / 86400);
  const parts = [d && `${d}d`, (d || h) && `${h}h`, `${m}m`, `${s}s`].filter(Boolean);
  return parts.join(" ");
}
