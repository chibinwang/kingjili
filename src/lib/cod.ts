import type { Db } from "./db";
import { orderTotals } from "./domain/orders";
import { roundToUnit } from "./money";
import { maps } from "./selectors";

/** What the driver should collect at the door, from the customer's settlement terms (not from the invoice). */
export function codFor(db: Db, orderId: string): { cents: number; label: string } {
  const o = maps(db).orders.get(orderId)!;
  const c = maps(db).customers.get(o.customerId)!;
  const total = orderTotals(o).total;
  if (c.settlementTerms === "daily") return { cents: total, label: "日結・當日收" };
  if (c.settlementTerms === "mixed") return { cents: roundToUnit(Math.floor((total * (c.sameDayShareBp ?? 0)) / 10000), 10000), label: `混合・當日收 ${(c.sameDayShareBp ?? 0) / 100}%` };
  return { cents: 0, label: "月結・不收款" };
}
