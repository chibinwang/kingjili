import { DEFAULT_TAX_POLICY, roundToUnit, splitInclusive, type Cents, type TaxPolicy } from "../money";
import type { Customer, CustomerPrice, Product, PriceTier } from "./types";

/**
 * Single source of truth for "what does this customer pay for this product on this date".
 * Order: the customer's 合約價 in effect on that date → the customer's tier price.
 * Nothing else may read Product.price directly (enforced by a test).
 */

export const PRICE_TIER_LABEL: Record<PriceTier, string> = { standard: "一般價", volume: "量販價", vip: "VIP 價" };

export interface ResolvedPrice {
  cents: Cents;
  source: "contract" | "tier";
  /** The tier price the customer would otherwise pay — the reference for 改價 and discount display. */
  tierCents: Cents;
  agreement?: CustomerPrice;
}

/** The agreement row in effect for one customer × product on `date` (latest effectiveFrom ≤ date), if any. */
export function agreementOn(prices: readonly CustomerPrice[], customerId: string, productId: string, date: string): CustomerPrice | undefined {
  let best: CustomerPrice | undefined;
  for (const p of prices) {
    if (p.customerId !== customerId || p.productId !== productId || p.effectiveFrom > date) continue;
    if (!best || p.effectiveFrom > best.effectiveFrom || (p.effectiveFrom === best.effectiveFrom && p.createdAt > best.createdAt)) best = p;
  }
  return best && best.priceExTaxCents !== null ? best : undefined;
}

export function tierPrice(product: Product, customer?: Pick<Customer, "priceTier">): Cents {
  return product.price[customer?.priceTier ?? "standard"];
}

export function resolvePrice(prices: readonly CustomerPrice[], customer: Customer | undefined, product: Product, date: string): ResolvedPrice {
  const tierCents = tierPrice(product, customer);
  const agreement = customer ? agreementOn(prices, customer.id, product.id, date) : undefined;
  return agreement ? { cents: agreement.priceExTaxCents!, source: "contract", tierCents, agreement } : { cents: tierCents, source: "tier", tierCents };
}

/**
 * Convert a quoted price to the stored ex-tax per-base-unit price.
 * Quotes are often tax-included and per 箱; the result is rounded to whole TWD so every line amount stays whole TWD.
 */
export function quoteToBaseExTax(quote: { amountCents: Cents; unit: "base" | "pack"; taxIncluded: boolean }, product: Pick<Product, "packSize">, policy: TaxPolicy = DEFAULT_TAX_POLICY): Cents {
  const exTax = quote.taxIncluded ? splitInclusive(quote.amountCents, policy).exTax : quote.amountCents;
  const perBase = quote.unit === "pack" ? Math.round(exTax / product.packSize) : exTax;
  return roundToUnit(perBase, 100);
}

export interface AgreementLine {
  product: Product;
  agreement: CustomerPrice;
  cents: Cents;
  tierCents: Cents;
  /** Discount vs the tier price in basis points (positive = cheaper than the tier). */
  discountBp: number;
  /** Margin vs standard cost in basis points; null when the product has no cost. */
  marginBp: number | null;
  belowCost: boolean;
}

export interface AgreementSummary {
  lines: AgreementLine[];
  /** Simple average of the per-product discounts; 0 when there are no agreements. */
  avgDiscountBp: number;
  belowCostCount: number;
}

/** Every product this customer has a 合約價 for on `date`, biggest discount first. */
export function agreementSummary(prices: readonly CustomerPrice[], customer: Customer, products: readonly Product[], date: string): AgreementSummary {
  const lines: AgreementLine[] = [];
  for (const product of products) {
    const agreement = agreementOn(prices, customer.id, product.id, date);
    if (!agreement) continue;
    const cents = agreement.priceExTaxCents!;
    const tierCents = tierPrice(product, customer);
    const marginBp = product.costCents === null || cents === 0 ? null : Math.round(((cents - product.costCents) * 10000) / cents);
    lines.push({
      product,
      agreement,
      cents,
      tierCents,
      discountBp: tierCents ? Math.round(((tierCents - cents) * 10000) / tierCents) : 0,
      marginBp,
      belowCost: product.costCents !== null && cents < product.costCents,
    });
  }
  lines.sort((a, b) => b.discountBp - a.discountBp);
  return {
    lines,
    avgDiscountBp: lines.length ? Math.round(lines.reduce((a, l) => a + l.discountBp, 0) / lines.length) : 0,
    belowCostCount: lines.filter((l) => l.belowCost).length,
  };
}

export function formatBp(bp: number, digits = 1): string {
  return `${(bp / 100).toFixed(digits)}%`;
}
