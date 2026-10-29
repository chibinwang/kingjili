import { DEFAULT_TAX_POLICY, type Cents, type TaxPolicy } from "../money";
import { allocateExTax, taxDocument, type DocBasis, type TaxLineInput } from "./taxcalc";
import type { ArLineItem, OrderLine, OrderState, Product, SalesOrder } from "./types";

/** Allowed order state transitions (PRD Flow B). Anything else is rejected. */
export const ORDER_TRANSITIONS: Record<OrderState, OrderState[]> = {
  Draft: ["Validated", "Cancelled"],
  Validated: ["Reserved", "Cancelled", "Draft"],
  Reserved: ["Picking", "Cancelled"],
  Picking: ["Shipped", "Reserved"],
  Shipped: ["Delivered", "Returned"],
  Delivered: ["Closed", "Returned"],
  Closed: ["Returned"],
  Cancelled: [],
  Returned: [],
};

export function canTransition(from: OrderState, to: OrderState): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function transition(order: SalesOrder, to: OrderState): SalesOrder {
  if (!canTransition(order.state, to)) {
    throw new Error(`訂單 ${order.no} 無法由 ${order.state} 轉為 ${to}`);
  }
  return { ...order, state: to };
}

export const ORDER_STATE_LABEL: Record<OrderState, string> = {
  Draft: "草稿",
  Validated: "已確認",
  Reserved: "已保留庫存",
  Picking: "揀貨中",
  Shipped: "已出車",
  Delivered: "已送達",
  Closed: "已結案",
  Cancelled: "已取消",
  Returned: "退貨",
};

export function toBaseQty(product: Product, qty: number, unit: "base" | "pack"): number {
  return unit === "pack" ? qty * product.packSize : qty;
}

export function unitLabel(product: Product, unit: "base" | "pack"): string {
  return unit === "pack" ? product.packUnit : product.baseUnit;
}

/** Quantity shown on documents: in the unit the customer ordered. */
export function displayQty(line: OrderLine, product: Product): { qty: number; unit: string } {
  return line.unit === "pack"
    ? { qty: line.qtyBase / product.packSize, unit: product.packUnit }
    : { qty: line.qtyBase, unit: product.baseUnit };
}

/** A line as the tax engine sees it: base-unit quantity × the unit price in the basis it was quoted. */
export function lineTaxInput(l: OrderLine): TaxLineInput {
  const basis = l.priceBasis ?? "excluded";
  return { basis, qty: l.qtyBase, unitPriceCents: basis === "included" ? l.unitPriceInclTaxCents! : l.unitPriceExTaxCents };
}

export function linesTotals(lines: OrderLine[], policy: TaxPolicy = DEFAULT_TAX_POLICY): { exTax: Cents; tax: Cents; total: Cents; basis: DocBasis } {
  const d = taxDocument(lines.map(lineTaxInput), policy);
  return { exTax: d.salesCents, tax: d.taxCents, total: d.totalCents, basis: d.basis };
}

export function orderTotals(order: SalesOrder, policy: TaxPolicy = DEFAULT_TAX_POLICY) {
  return linesTotals(order.lines, policy);
}

/** Amounts and items of the receivable created on delivery, from the delivered lines. Item ex-tax shares add up to the sales amount. */
export function buildCharge(lines: OrderLine[], products: Map<string, Product>, policy: TaxPolicy = DEFAULT_TAX_POLICY): { exTaxCents: Cents; taxCents: Cents; totalCents: Cents; priceBasis: DocBasis; items: ArLineItem[] } {
  const d = taxDocument(lines.map(lineTaxInput), policy);
  const shares = allocateExTax(d.lines, d.salesCents);
  return {
    exTaxCents: d.salesCents,
    taxCents: d.taxCents,
    totalCents: d.totalCents,
    priceBasis: d.basis,
    items: lines.map((l, i) => {
      const p = products.get(l.productId)!;
      return {
        productId: p.id,
        name: p.name,
        qty: l.qty,
        unitLabel: unitLabel(p, l.unit),
        unitPriceExTaxCents: l.unitPriceExTaxCents,
        exTaxCents: shares[i],
        priceBasis: d.lines[i].basis,
        amountCents: d.lines[i].amountCents,
        unitPriceInclTaxCents: l.unitPriceInclTaxCents,
      };
    }),
  };
}

/** Deterministic duplicate check: same source + external id is the same order (idempotent ingestion). */
export function findDuplicate(orders: SalesOrder[], source: SalesOrder["source"], externalId: string): SalesOrder | undefined {
  return orders.find((o) => o.source === source && o.externalId === externalId && o.state !== "Cancelled");
}

/** Content duplicate: same customer, delivery date and identical lines within an open state. */
export function findLikelyDuplicate(orders: SalesOrder[], candidate: Pick<SalesOrder, "customerId" | "deliveryDate" | "lines">): SalesOrder | undefined {
  const sig = (lines: OrderLine[]) =>
    lines
      .map((l) => `${l.productId}:${l.qtyBase}`)
      .sort()
      .join("|");
  const target = sig(candidate.lines);
  return orders.find(
    (o) => o.customerId === candidate.customerId && o.deliveryDate === candidate.deliveryDate && o.state !== "Cancelled" && sig(o.lines) === target,
  );
}

export function orderWeightKg(order: SalesOrder, products: Map<string, Product>): number {
  return order.lines.reduce((acc, l) => acc + (l.qtyBase * (products.get(l.productId)?.weightGramPerBase ?? 0)) / 1000, 0);
}

export function orderVolumeL(order: SalesOrder, products: Map<string, Product>): number {
  return order.lines.reduce((acc, l) => acc + (l.qtyBase * (products.get(l.productId)?.volumeMlPerBase ?? 0)) / 1000, 0);
}
