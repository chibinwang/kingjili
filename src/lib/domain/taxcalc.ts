import { DEFAULT_TAX_POLICY, type Cents, type TaxPolicy } from "../money";

/**
 * 發票稅額計算 — 含稅、未稅與混合報價。
 *
 * Whole-document amounts are integer cents (whole TWD in practice). Per-line ex-tax unit prices and amounts follow
 * MIG 4.0: up to 7 decimals, carried here as BigInt in units of 10⁻⁷ TWD ("e7"). No floating point anywhere.
 *
 *   included (含稅報價)  total = Σ line amounts; tax = round(total × 5/105); sales = total − tax
 *                        — the rule ECPay documents and the client's printed receipts follow.
 *   excluded (未稅報價)  sales = round(Σ line amounts); tax = round(sales × 5%); total = sales + tax
 *   mixed    (混合)      sales = round(Σ ex-tax amounts incl. included lines ÷ 1.05);
 *                        tax = round(Σ excluded × 5% + Σ included × 5/105); total = sales + tax
 *                        — a proposal pending the accountant's confirmation (see docs/invoice_research.md).
 */

export type PriceBasis = "excluded" | "included";
export type DocBasis = PriceBasis | "mixed";

export const BASIS_LABEL: Record<DocBasis, string> = { excluded: "未稅報價", included: "含稅報價", mixed: "混合報價" };

/** 1 cent = 10⁵ e7 units. */
const E7_PER_CENT = 100_000n;

function divRoundHalfUp(n: bigint, d: bigint): bigint {
  const sign = n < 0n ? -1n : 1n;
  const a = n < 0n ? -n : n;
  return sign * ((a * 2n + d) / (2n * d));
}

export interface TaxLineInput {
  basis: PriceBasis;
  /** Quantity in the unit the price is quoted for. */
  qty: number;
  /** Unit price in the line's basis, integer cents. */
  unitPriceCents: Cents;
}

export interface TaxLine extends TaxLineInput {
  /** qty × unitPrice, in the line's basis. */
  amountCents: Cents;
  /** Ex-tax unit price and amount, 10⁻⁷ TWD. Equal to the quoted figures for excluded lines. */
  unitPriceExE7: bigint;
  amountExE7: bigint;
}

export interface TaxDocument {
  basis: DocBasis;
  lines: TaxLine[];
  salesCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
}

function exE7(cents: number, basis: PriceBasis, policy: TaxPolicy): bigint {
  const v = BigInt(cents) * E7_PER_CENT;
  return basis === "excluded" ? v : divRoundHalfUp(v * 10000n, BigInt(10000 + policy.rateBp));
}

export function taxLine(input: TaxLineInput, policy: TaxPolicy = DEFAULT_TAX_POLICY): TaxLine {
  if (!Number.isSafeInteger(input.qty) || !Number.isSafeInteger(input.unitPriceCents)) throw new Error("qty and unit price must be integers");
  const amountCents = input.qty * input.unitPriceCents;
  return { ...input, amountCents, unitPriceExE7: exE7(input.unitPriceCents, input.basis, policy), amountExE7: exE7(amountCents, input.basis, policy) };
}

export function docBasis(lines: { basis: PriceBasis }[]): DocBasis {
  const kinds = new Set(lines.map((l) => l.basis));
  return kinds.size > 1 ? "mixed" : kinds.has("included") ? "included" : "excluded";
}

/** Totals from line amounts already priced in their own basis (used to re-check stored documents). */
export function taxTotals(lines: { basis: PriceBasis; amountCents: Cents }[], policy: TaxPolicy = DEFAULT_TAX_POLICY): { basis: DocBasis; salesCents: Cents; taxCents: Cents; totalCents: Cents } {
  const unit = BigInt(policy.roundingUnit);
  const rate = BigInt(policy.rateBp);
  const toUnit = (cents: bigint) => Number(divRoundHalfUp(cents, unit) * unit);
  const inc = lines.filter((l) => l.basis === "included").reduce((a, l) => a + BigInt(l.amountCents), 0n);
  const exc = lines.filter((l) => l.basis === "excluded").reduce((a, l) => a + BigInt(l.amountCents), 0n);
  const basis = docBasis(lines);
  if (basis === "included") {
    const total = toUnit(inc);
    const tax = toUnit(divRoundHalfUp(BigInt(total) * rate, 10000n + rate));
    return { basis, salesCents: total - tax, taxCents: tax, totalCents: total };
  }
  if (basis === "excluded") {
    const sales = toUnit(exc);
    const tax = toUnit(divRoundHalfUp(BigInt(sales) * rate, 10000n));
    return { basis, salesCents: sales, taxCents: tax, totalCents: sales + tax };
  }
  // mixed: work in 10⁻⁴ cents so both parts keep precision until the single final rounding
  const S = 10000n;
  const salesP = exc * S + divRoundHalfUp(inc * S * 10000n, 10000n + rate);
  const taxP = divRoundHalfUp(exc * S * rate, 10000n) + divRoundHalfUp(inc * S * rate, 10000n + rate);
  const sales = toUnit(divRoundHalfUp(salesP, S));
  const tax = toUnit(divRoundHalfUp(taxP, S));
  return { basis, salesCents: sales, taxCents: tax, totalCents: sales + tax };
}

export function taxDocument(inputs: TaxLineInput[], policy: TaxPolicy = DEFAULT_TAX_POLICY): TaxDocument {
  const lines = inputs.map((l) => taxLine(l, policy));
  return { ...taxTotals(lines, policy), lines };
}

/** "3,257.1428571" — thousands separators, trailing zeros trimmed, as printed on the receipt. */
export function formatE7(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = (a / 10_000_000n).toLocaleString("en-US");
  const frac = (a % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** e7 → nearest cent (for analytics fields that are stored in cents). */
export function e7ToCents(v: bigint): Cents {
  return Number(divRoundHalfUp(v, E7_PER_CENT));
}

/**
 * Split a document's ex-tax total across its lines in cents so the parts add up exactly (尾差調整):
 * each line gets its rounded share, the largest line absorbs the remainder.
 */
export function allocateExTax(lines: TaxLine[], salesCents: Cents): Cents[] {
  const parts = lines.map((l) => e7ToCents(l.amountExE7));
  const diff = salesCents - parts.reduce((a, b) => a + b, 0);
  if (diff && parts.length) {
    const i = parts.reduce((best, p, j) => (Math.abs(p) > Math.abs(parts[best]) ? j : best), 0);
    parts[i] += diff;
  }
  return parts;
}
