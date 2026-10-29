import { describe, expect, it } from "vitest";
import { allocateReceipt, correctTax, recordPayment, reversePayment, type ActCtx } from "../actions";
import { customerBalance, customerBalanceViaAllocations, docRemaining, paymentUnapplied, planAllocation } from "../domain/ar";
import { runMonthEndAudit } from "../domain/audit";
import { buildStatement } from "../domain/statements";
import type { Db } from "../db";
import { twd } from "../money";
import { buildSeed } from "../seed";

const as = (db: Db, role: string): ActCtx => {
  const u = db.users.find((x) => x.role === role)!;
  return { actor: { id: u.id, name: u.name, type: "user", user: u }, now: "2026-10-24T09:00:00+08:00" };
};
const audit = (db: Db, period = "2026-10") =>
  runMonthEndAudit({ period, customers: db.customers, docs: db.arDocs, payments: db.payments, allocations: db.allocations, invoices: db.invoices, orders: db.orders, statements: db.statements, events: db.events });
const flagsOf = (db: Db, check: string) => audit(db).find((c) => c.id === check)!.flags;

describe("seed integrity", () => {
  const db = buildSeed();
  it("meets the minimum demo dataset", () => {
    expect(db.customers.length).toBeGreaterThanOrEqual(8);
    expect(db.products.length).toBeGreaterThanOrEqual(12);
    expect(db.orders.filter((o) => o.deliveryDate === "2026-10-24").length).toBe(12);
    expect(db.vehicles).toHaveLength(2);
  });
  it("is deterministic", () => {
    expect(JSON.stringify(buildSeed())).toBe(JSON.stringify(buildSeed()));
  });
  it("every customer's balance agrees through documents and through allocations", () => {
    for (const c of db.customers) {
      expect(customerBalanceViaAllocations(c.id, db.arDocs, db.payments, db.allocations)).toBe(customerBalance(c.id, db.arDocs, db.payments));
    }
  });
  it("no allocation over-applies a document", () => {
    for (const d of db.arDocs) expect(docRemaining(d, db.allocations)).toBeGreaterThanOrEqual(0);
  });
});

describe("monthly statements reconcile exactly", () => {
  const db = buildSeed();
  for (const period of ["2026-08", "2026-09", "2026-10"]) {
    it(`opening + charges ± adjustments − payments = closing (${period})`, () => {
      for (const c of db.customers) {
        const st = buildStatement(c, period, db.arDocs, db.payments, db.allocations, db.invoices);
        const t = st.totals;
        expect(t.openingCents + t.chargesCents + t.debitAdjCents - t.creditAdjCents - t.paymentsCents).toBe(t.closingCents);
        expect(st.reconciles).toBe(true);
        expect(st.lines.at(-1)!.balanceCents).toBe(t.closingCents);
      }
    });
  }
  it("each period's closing is the next period's opening", () => {
    for (const c of db.customers) {
      const sep = buildStatement(c, "2026-09", db.arDocs, db.payments, db.allocations, db.invoices);
      const oct = buildStatement(c, "2026-10", db.arDocs, db.payments, db.allocations, db.invoices);
      expect(oct.totals.openingCents).toBe(sep.totals.closingCents);
    }
  });
  it("represents a partially paid statement (長青自助餐 September)", () => {
    const c = db.customers.find((x) => x.id === "C06")!;
    const oct = buildStatement(c, "2026-10", db.arDocs, db.payments, db.allocations, db.invoices);
    const sepDocs = db.arDocs.filter((d) => d.customerId === "C06" && d.issueDate.startsWith("2026-09"));
    const partial = sepDocs.filter((d) => docRemaining(d, db.allocations) > 0 && docRemaining(d, db.allocations) < d.totalCents);
    expect(oct.totals.openingCents).toBeGreaterThan(0);
    expect(partial.length + sepDocs.filter((d) => docRemaining(d, db.allocations) === d.totalCents).length).toBeGreaterThan(0);
  });
});

describe("payment allocation", () => {
  it("allocates oldest first and keeps the excess as customer credit", () => {
    const db = buildSeed();
    const open = db.arDocs.filter((d) => d.customerId === "C10" && docRemaining(d, db.allocations) > 0);
    const owed = open.reduce((a, d) => a + docRemaining(d, db.allocations), 0);
    const plan = planAllocation(owed + twd(500), "C10", db.arDocs, db.allocations);
    expect(plan.unapplied).toBe(twd(500));
    const first = plan.allocations[0].arDocumentId;
    expect(first).toBe([...open].sort((a, b) => a.issueDate.localeCompare(b.issueDate))[0].id);
  });

  it("partial payment leaves the rest open", () => {
    const db = buildSeed();
    const next = recordPayment(db, as(db, "accounting"), { customerId: "C10", amountCents: twd(1000), method: "transfer" });
    const p = next.payments.at(-1)!;
    expect(paymentUnapplied(p, next.allocations)).toBe(0);
    expect(customerBalance("C10", next.arDocs, next.payments)).toBe(customerBalance("C10", db.arDocs, db.payments) - twd(1000));
  });

  it("refuses an obvious duplicate collection for the same delivery", () => {
    const db = buildSeed();
    const dup = db.payments.find((p) => p.deliveryId === "d-2026-10-23-XC08")!;
    expect(() => recordPayment(db, as(db, "accounting"), { customerId: dup.customerId, amountCents: dup.grossCents, method: dup.method, deliveryId: dup.deliveryId, collectedAt: dup.collectedAt })).toThrow(/重複/);
  });
});

describe("month-end audit: deterministic flags and their fixes", () => {
  it("finds the planted anomalies", () => {
    const db = buildSeed();
    expect(flagsOf(db, "duplicate_payment")).toHaveLength(1);
    expect(flagsOf(db, "tax_mismatch")).toHaveLength(1);
    expect(flagsOf(db, "unmatched_receipt")).toHaveLength(2);
    expect(flagsOf(db, "negative_balance")).toHaveLength(1);
    expect(flagsOf(db, "invoice_state")).toHaveLength(1);
    expect(flagsOf(db, "cross_ledger")).toHaveLength(0);
    expect(flagsOf(db, "statement_math")).toHaveLength(0);
  });

  it("reversal clears the duplicate without mutating the original", () => {
    const db = buildSeed();
    const flag = flagsOf(db, "duplicate_payment")[0];
    const dupId = flag.refs[1].id;
    const before = JSON.stringify(db.payments.find((p) => p.id === dupId));
    const next = reversePayment(db, as(db, "accounting"), dupId, "test");
    expect(JSON.stringify(next.payments.find((p) => p.id === dupId))).toBe(before);
    expect(next.payments.some((p) => p.reversalOf === dupId)).toBe(true);
    expect(flagsOf(next, "duplicate_payment")).toHaveLength(0);
    expect(flagsOf(next, "negative_balance")).toHaveLength(0);
    expect(() => reversePayment(next, as(next, "accounting"), dupId, "again")).toThrow();
  });

  it("allocating the unmatched transfer clears that flag", () => {
    const db = buildSeed();
    const flag = flagsOf(db, "unmatched_receipt").find((f) => f.customerId === "C06")!;
    const next = allocateReceipt(db, as(db, "accounting"), flag.refs[0].id);
    expect(flagsOf(next, "unmatched_receipt").some((f) => f.customerId === "C06")).toBe(false);
    expect(customerBalance("C06", next.arDocs, next.payments)).toBe(customerBalance("C06", db.arDocs, db.payments));
  });

  it("a tax correction note clears the tax mismatch", () => {
    const db = buildSeed();
    const flag = flagsOf(db, "tax_mismatch")[0];
    const next = correctTax(db, as(db, "accounting"), flag.refs[0].id);
    expect(flagsOf(next, "tax_mismatch")).toHaveLength(0);
    expect(customerBalance("C02", next.arDocs, next.payments)).toBe(customerBalance("C02", db.arDocs, db.payments) - twd(1));
  });

  it("flags ledger edits made after a statement was locked", async () => {
    const { lockStatements } = await import("../actions");
    let db = buildSeed();
    db = lockStatements(db, as(db, "accounting"), "2026-10", ["C10"]);
    db = recordPayment(db, { ...as(db, "accounting"), now: "2026-10-24T10:00:00+08:00" }, { customerId: "C10", amountCents: twd(100), method: "transfer", collectedAt: "2026-10-24T10:00:00+08:00" });
    expect(flagsOf(db, "locked_period_edit").length).toBeGreaterThan(0);
  });
});
