import type { Db } from "./db";
import { billableLines, codAmount, linesTotal } from "./domain/collections";
import { maps } from "./selectors";

/** What the driver should collect at the door, from the customer's settlement terms (not from the invoice). */
export function codFor(db: Db, orderId: string): { cents: number; label: string } {
  const m = maps(db);
  const o = m.orders.get(orderId)!;
  const c = m.customers.get(o.customerId)!;
  // once delivered, the charge is the truth; before that, what has been picked
  const charge = db.arDocs.find((x) => x.type === "charge" && x.sourceOrderId === orderId);
  return codAmount(c, charge ? charge.totalCents : linesTotal(billableLines(o, db.pickConfirmations)).total);
}
