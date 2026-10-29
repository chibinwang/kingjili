import { DEFAULT_TAX_POLICY, lineAmount, roundToUnit, sum, taxOnExclusive, type Cents } from "../money";
import { isReversed } from "./ar";
import type { PickConfirmation } from "./picking";
import type { ArDocument, Customer, Delivery, OrderLine, Payment, RouteStop, SalesOrder } from "./types";

/**
 * What the driver collects at the door, and the day's collection picture per vehicle.
 * The amount comes from the customer's settlement terms applied to what is actually delivered (not the invoice).
 */

/** Order lines as delivered: a confirmed short pick lowers the billed quantity (never raises it). */
export function billableLines(order: SalesOrder, picks: Record<string, PickConfirmation>): OrderLine[] {
  return order.lines.map((l) => {
    const picked = picks[l.id]?.qtyBase;
    if (picked === undefined || picked >= l.qtyBase) return l;
    // a partial 箱 can no longer be expressed in 箱 — fall back to base units
    return { ...l, qtyBase: picked, qty: picked, unit: "base" };
  });
}

export function linesTotal(lines: OrderLine[]): { exTax: Cents; tax: Cents; total: Cents } {
  const exTax = sum(lines.map((l) => lineAmount(l.qtyBase, l.unitPriceExTaxCents)));
  const tax = taxOnExclusive(exTax, DEFAULT_TAX_POLICY);
  return { exTax, tax, total: exTax + tax };
}

/** The share of a delivery's total collected on the spot. Mixed terms round down to NT$100 (existing policy). */
export function codAmount(customer: Customer, totalCents: Cents): { cents: Cents; label: string } {
  if (customer.settlementTerms === "daily") return { cents: totalCents, label: "日結・當日收" };
  if (customer.settlementTerms === "mixed") {
    const bp = customer.sameDayShareBp ?? 0;
    return { cents: roundToUnit(Math.floor((totalCents * bp) / 10000), 10000), label: `混合・當日收 ${bp / 100}%` };
  }
  return { cents: 0, label: "月結・不收款" };
}

export interface StopCollection {
  deliveryId: string;
  customerId: string;
  sequence: number;
  delivered: boolean;
  /** Amount due at the door for this delivery. */
  expectedCents: Cents;
  label: string;
  /** Collected against this delivery (reversed payments excluded). */
  collectedCents: Cents;
  methods: Payment["method"][];
  /** Cash for this stop the driver still holds. */
  cashHeldCents: Cents;
  /** expected − collected once delivered; > 0 means a partial collection stays on the ledger. */
  shortfallCents: Cents;
  /** Unpaid balance from earlier deliveries (daily/mixed customers only) — information for the driver, not a target. */
  priorBalanceCents: Cents;
}

export interface DayCollections {
  stops: StopCollection[];
  expectedCents: Cents;
  collectedCents: Cents;
  /** Still to collect at stops not yet delivered. */
  pendingCents: Cents;
  /** Delivered but collected less than due. */
  shortfallCents: Cents;
  cashHeldCents: Cents;
  handedOverCents: Cents;
  nonCashCents: Cents;
  deliveredStops: number;
}

export interface DayCollectionsInput {
  stops: Pick<RouteStop, "deliveryId" | "orderId" | "customerId" | "sequence">[];
  deliveries: Map<string, Delivery>;
  orders: Map<string, SalesOrder>;
  customers: Map<string, Customer>;
  arDocs: ArDocument[];
  payments: Payment[];
  picks: Record<string, PickConfirmation>;
  /** Customer balance as of today (positive = owes us), including today's activity. */
  balances: Map<string, Cents>;
}

export function dayCollections(input: DayCollectionsInput): DayCollections {
  const live = input.payments.filter((p) => !p.reversalOf && !isReversed(p, input.payments));
  const stops: StopCollection[] = input.stops.map((s) => {
    const d = input.deliveries.get(s.deliveryId)!;
    const c = input.customers.get(s.customerId)!;
    const o = input.orders.get(s.orderId)!;
    const delivered = d.status === "delivered";
    const charge = delivered ? input.arDocs.find((x) => x.type === "charge" && x.sourceDeliveryId === d.id) : undefined;
    const total = charge ? charge.totalCents : linesTotal(billableLines(o, input.picks)).total;
    const cod = codAmount(c, total);
    const mine = live.filter((p) => p.deliveryId === d.id);
    const collectedCents = sum(mine.map((p) => p.grossCents));
    // today's charge and collections are part of the balance; what is left is from earlier
    const todayOwed = charge ? charge.totalCents - collectedCents : 0;
    const prior = c.settlementTerms === "monthly" ? 0 : Math.max(0, (input.balances.get(c.id) ?? 0) - todayOwed);
    return {
      deliveryId: d.id,
      customerId: c.id,
      sequence: s.sequence,
      delivered,
      expectedCents: cod.cents,
      label: cod.label,
      collectedCents,
      methods: [...new Set(mine.map((p) => p.method))],
      cashHeldCents: sum(mine.filter((p) => p.method === "cash" && p.custody === "collected").map((p) => p.grossCents)),
      shortfallCents: delivered ? Math.max(0, cod.cents - collectedCents) : 0,
      priorBalanceCents: prior,
    };
  });
  const allPayments = live.filter((p) => stops.some((s) => s.deliveryId === p.deliveryId));
  return {
    stops,
    expectedCents: sum(stops.map((s) => s.expectedCents)),
    collectedCents: sum(stops.map((s) => s.collectedCents)),
    pendingCents: sum(stops.filter((s) => !s.delivered).map((s) => s.expectedCents)),
    shortfallCents: sum(stops.map((s) => s.shortfallCents)),
    cashHeldCents: sum(stops.map((s) => s.cashHeldCents)),
    handedOverCents: sum(allPayments.filter((p) => p.method === "cash" && (p.custody === "handed_over" || p.custody === "deposited")).map((p) => p.grossCents)),
    nonCashCents: sum(allPayments.filter((p) => p.method !== "cash").map((p) => p.grossCents)),
    deliveredStops: stops.filter((s) => s.delivered).length,
  };
}
