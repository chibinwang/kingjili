/**
 * Money is always integer cents (TWD × 100). Never use floats for ledger math.
 * TWD is presented without decimals; tax is rounded to whole TWD (100 cents) by policy.
 */
export type Cents = number;

export interface TaxPolicy {
  /** VAT rate in basis points (500 = 5%). */
  rateBp: number;
  /** Rounding unit in cents. 100 = whole TWD. */
  roundingUnit: number;
  /** Round tax once per document (Taiwan common practice) or per line. */
  basis: "per_document" | "per_line";
}

export const DEFAULT_TAX_POLICY: TaxPolicy = { rateBp: 500, roundingUnit: 100, basis: "per_document" };

export function assertCents(value: number, label = "amount"): Cents {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be integer cents, got ${value}`);
  return value;
}

/** Round half away from zero to a multiple of `unit`, using integer math only. */
export function roundToUnit(value: number, unit: number): number {
  assertCents(value);
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const q = Math.floor(abs / unit);
  const r = abs - q * unit;
  return sign * (r * 2 >= unit ? (q + 1) * unit : q * unit);
}

/** Tax on a tax-exclusive amount: round(ex × bp / 10000) to the rounding unit, integer math only. */
export function taxOnExclusive(exTax: Cents, policy: TaxPolicy = DEFAULT_TAX_POLICY): Cents {
  assertCents(exTax, "exTax");
  const sign = exTax < 0 ? -1 : 1;
  const numerator = Math.abs(exTax) * policy.rateBp; // in 1/10000 cents
  const unitScaled = policy.roundingUnit * 10000;
  const q = Math.floor(numerator / unitScaled);
  const r = numerator - q * unitScaled;
  return sign * (r * 2 >= unitScaled ? (q + 1) : q) * policy.roundingUnit;
}

/** Split a tax-inclusive amount into ex-tax and tax (tax = total − round(total ÷ 1.05)). */
export function splitInclusive(total: Cents, policy: TaxPolicy = DEFAULT_TAX_POLICY): { exTax: Cents; tax: Cents } {
  assertCents(total, "total");
  const denom = 10000 + policy.rateBp;
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total) * 10000;
  const unitScaled = policy.roundingUnit * denom;
  const q = Math.floor(abs / unitScaled);
  const r = abs - q * unitScaled;
  const exTax = sign * (r * 2 >= unitScaled ? q + 1 : q) * policy.roundingUnit;
  return { exTax, tax: total - exTax };
}

export function lineAmount(qty: number, unitPrice: Cents): Cents {
  if (!Number.isSafeInteger(qty)) throw new Error(`qty must be an integer, got ${qty}`);
  return assertCents(qty * unitPrice);
}

export function sum(values: Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}

const fmt = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });

/** NT$12,345 — cents are hidden because every seeded and computed value is whole TWD. */
export function formatTWD(cents: Cents, opts: { sign?: boolean; symbol?: boolean } = {}): string {
  const whole = cents / 100;
  const body = fmt.format(Math.abs(whole));
  const prefix = cents < 0 ? "−" : opts.sign && cents > 0 ? "+" : "";
  return `${prefix}${opts.symbol === false ? "" : "NT$"}${body}`;
}

export function formatCompactTWD(cents: Cents): string {
  const whole = cents / 100;
  if (Math.abs(whole) >= 10000) return `NT$${(whole / 10000).toFixed(1)} 萬`;
  return formatTWD(cents);
}

export function twd(whole: number): Cents {
  return assertCents(whole * 100);
}
