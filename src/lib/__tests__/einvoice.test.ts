import { describe, expect, it } from "vitest";
import { completeDelivery, createManualOrder, preflightInvoices, setCustomerPriceBasis, stageMonthlyInvoice, type ActCtx } from "../actions";
import type { Db } from "../db";
import { runMonthEndAudit } from "../domain/audit";
import { invoicePeriodOf, formatInvoicePeriod, PER_TRIP_FROM, preflightInvoice, takeInvoiceNumber, uploadDueOn } from "../domain/invoices";
import { orderTotals } from "../domain/orders";
import { resolvePrice } from "../domain/pricing";
import { twd } from "../money";
import { buildSeed } from "../seed";

const as = (db: Db, role: string): ActCtx => {
  const u = db.users.find((x) => x.role === role)!;
  return { actor: { id: u.id, name: u.name, type: "user", user: u }, now: "2026-10-24T09:00:00+08:00" };
};
const cust = (db: Db, id: string) => db.customers.find((c) => c.id === id)!;
const prod = (db: Db, id: string) => db.products.find((p) => p.id === id)!;
const audit = (db: Db, period: string) =>
  runMonthEndAudit({ period, customers: db.customers, docs: db.arDocs, payments: db.payments, allocations: db.allocations, invoices: db.invoices, orders: db.orders, statements: db.statements, events: db.events });

describe("報價方式", () => {
  it("a customer switched to 含稅報價 gets tax-included lines and totals that add up from them", () => {
    let db = buildSeed();
    db = setCustomerPriceBasis(db, as(db, "sales"), "C03", "included");
    const r = resolvePrice(db.customerPrices, cust(db, "C03"), prod(db, "P004"), "2026-10-25");
    expect(r).toMatchObject({ basis: "included", inclCents: twd(110) }); // 105 未稅 × 1.05 = 110.25 → 110
    const { db: next, value } = createManualOrder(db, as(db, "sales"), { customerId: "C03", source: "PHONE", deliveryDate: "2026-10-25", note: "", lines: [{ productId: "P004", qty: 9, unit: "base", priceOverride: null, priceReason: "" }] }, false);
    const o = next.orders.find((x) => x.id === value)!;
    expect(o.lines[0]).toMatchObject({ priceBasis: "included", unitPriceInclTaxCents: twd(110) });
    expect(orderTotals(o)).toMatchObject({ basis: "included", total: twd(990), tax: twd(47), exTax: twd(943) });
    expect(next.events.some((e) => e.action === "set_price_basis")).toBe(true);
  });

  it("含稅 and 未稅 合約價 on one customer make a 混合 document", () => {
    const db = buildSeed();
    // 三味食堂: 酥炸雞排 quoted per 箱 含稅, 蔬食水餃 未稅
    const doc = db.arDocs.find((d) => d.customerId === "C02" && d.items?.some((i) => i.productId === "P002") && d.items?.some((i) => i.productId === "P005"))!;
    expect(doc.priceBasis).toBe("mixed");
    expect(doc.items!.reduce((a, i) => a + i.exTaxCents, 0)).toBe(doc.exTaxCents);
  });

  it("only sales and the owner change 報價方式", () => {
    const db = buildSeed();
    for (const role of ["driver", "accounting"]) expect(() => setCustomerPriceBasis(db, as(db, role), "C03", "included")).toThrow(/權限/);
  });
});

describe("單趟開立", () => {
  it("every delivery since PER_TRIP_FROM has exactly one invoice, and monthly 彙開 is blocked", () => {
    const db = buildSeed();
    const charges = db.arDocs.filter((d) => d.type === "charge" && d.issueDate >= PER_TRIP_FROM);
    for (const d of charges) expect(db.invoices.filter((i) => i.sourceArIds.includes(d.id))).toHaveLength(1);
    expect(() => stageMonthlyInvoice(db, as(db, "accounting"), "C01", "2026-10")).toThrow(/單趟開立/);
  });

  it("issued invoices pass preflight for 含稅, 未稅 and 混合 alike", () => {
    const db = buildSeed();
    const issued = db.invoices.filter((i) => i.source === "per_delivery" && i.invoiceNo);
    expect(new Set(issued.map((i) => i.priceBasis))).toEqual(new Set(["excluded", "included", "mixed"].filter((b) => issued.some((i) => i.priceBasis === b))));
    for (const inv of issued) expect(preflightInvoice(inv).filter((x) => x.field === "tax"), inv.id).toEqual([]);
  });

  it("the month-end review flags only the planted tax error, not tax-included rounding", () => {
    const db = buildSeed();
    const flagsOf = (check: string) => audit(db, "2026-10").find((c) => c.id === check)!.flags;
    expect(flagsOf("tax_mismatch").map((f) => f.customerId)).toEqual(["C02"]);
    expect(flagsOf("missing_invoice")).toEqual([]);
  });

  it("numbers come from the period's range in order; preflight issues the staged ones", () => {
    let db = buildSeed();
    const staged = db.invoices.filter((i) => i.providerStatus === "staged" && !i.carrierValue?.startsWith("/LJ05M2"));
    const before = db.invoiceRanges.find((r) => r.period === "2026-09")!.next;
    db = preflightInvoices(db, as(db, "accounting"), staged.map((i) => i.id));
    const issued = db.invoices.filter((i) => staged.some((s) => s.id === i.id));
    expect(issued.every((i) => i.providerStatus === "ready" && /^ZX\d{8}$/.test(i.invoiceNo!))).toBe(true);
    expect(db.invoiceRanges.find((r) => r.period === "2026-09")!.next).toBe(before + staged.length);
    expect(new Set(db.invoices.filter((i) => i.invoiceNo).map((i) => i.invoiceNo)).size).toBe(db.invoices.filter((i) => i.invoiceNo).length);
  });

  it("refuses to issue when the period has no number range", () => {
    expect(() => takeInvoiceNumber([], "2026-10-24")).toThrow(/字軌/);
  });

  it("delivery on a day with a closed period throws nothing for the open one", () => {
    const db = buildSeed();
    const next = completeDelivery(db, as(db, "driver"), "d-2026-10-24-AH03");
    expect(next.invoices.at(-1)!.invoiceNo).toMatch(/^ZX/);
  });
});

describe("period and deadline helpers", () => {
  it("bimonthly periods and 民國 labels", () => {
    expect(invoicePeriodOf("2026-10-24")).toBe("2026-09");
    expect(invoicePeriodOf("2026-09-01")).toBe("2026-09");
    expect(formatInvoicePeriod("2026-09")).toBe("115年09-10月");
    expect(uploadDueOn("2026-10-24", "B2B")).toBe("2026-10-31");
    expect(uploadDueOn("2026-10-24", "B2C")).toBe("2026-10-26");
  });
});
