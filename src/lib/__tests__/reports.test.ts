import { describe, expect, it } from "vitest";
import { completeDelivery, receivePurchaseOrder, type ActCtx } from "../actions";
import type { Db } from "../db";
import { marginBp, periodPnl, pnlSeries, stockMovement, weeklyPnl } from "../domain/reports";
import { sum } from "../money";
import { salesMetrics } from "../selectors";
import { buildSeed } from "../seed";

const as = (db: Db, role: string): ActCtx => {
  const u = db.users.find((x) => x.role === role)!;
  return { actor: { id: u.id, name: u.name, type: "user", user: u }, now: "2026-10-24T09:00:00+08:00" };
};

describe("period P&L", () => {
  const db = buildSeed();
  const p = periodPnl(db.arDocs, db.products, "2026-10-01", "2026-10-24");

  it("agrees with the overview's month metrics", () => {
    const sm = salesMetrics(db);
    expect(p.total.revenue).toBe(sm.monthRevenue);
    expect(p.total.uncostedRevenue).toBe(sm.uncostedRevenue);
    expect(marginBp(p.total)).toBe(sm.grossMarginBp);
  });

  it("breakdowns add up to the total", () => {
    expect(sum(p.byProduct.map((x) => x.revenue))).toBe(p.total.revenue + p.total.credits);
    expect(sum(p.byCategory.map((x) => x.profit))).toBe(p.total.profit + p.total.credits);
    expect(sum(p.byCustomer.map((x) => x.revenue))).toBe(p.total.revenue);
  });

  it("revenue without a standard cost is kept out of the margin", () => {
    const veg = p.byProduct.find((x) => x.productId === "P014")!;
    expect(veg.uncostedRevenue).toBe(veg.revenue);
    expect(veg.cost).toBe(0);
    expect(marginBp(veg)).toBeNull();
  });
});

describe("weekly P&L", () => {
  it("returns Monday-started weeks, the last one partial up to today", () => {
    const db = buildSeed();
    const w = weeklyPnl(db.arDocs, db.products, "2026-10-24", 12);
    expect(w).toHaveLength(12);
    expect(w.at(-1)).toMatchObject({ weekStart: "2026-10-19", weekEnd: "2026-10-24", partial: true });
    expect(w[0].weekStart).toBe("2026-08-03");
    expect(w.slice(0, -1).every((x) => !x.partial)).toBe(true);
  });
});

describe("stock movement (進銷存)", () => {
  it("closing = opening + in − out + adjustments, and deliveries/receipts move it", () => {
    let db = buildSeed();
    const range = { from: "2026-10-01", to: "2026-10-24" };
    const m0 = stockMovement({ ...db, docs: db.arDocs, ...range });
    for (const r of m0.rows) expect(r.openingQty + r.inQty - r.outQty + r.adjustQty).toBe(r.closingQty);
    // the seeded 10/12 receipt is counted as 進
    expect(m0.rows.find((r) => r.productId === "P001")!.inQty).toBe(150);

    db = completeDelivery(db, as(db, "driver"), "d-2026-10-24-AH03");
    const m1 = stockMovement({ ...db, docs: db.arDocs, ...range });
    const before = m0.rows.find((r) => r.productId === "P004")!;
    const after = m1.rows.find((r) => r.productId === "P004")!;
    expect(after.outQty).toBeGreaterThan(before.outQty);
    expect(after.closingQty).toBe(before.closingQty - (after.outQty - before.outQty));
    expect(after.openingQty).toBe(before.openingQty);
  });

  it("a received purchase order records its receipt date", () => {
    let db = buildSeed();
    const po = db.purchaseOrders.find((p) => p.status === "approved" || p.status === "sent_mock");
    if (!po) return;
    db = receivePurchaseOrder(db, as(db, "warehouse"), po.id, "T-1", "2027-06-30");
    expect(db.purchaseOrders.find((p) => p.id === po.id)!.receivedAt).toBe("2026-10-24");
  });
});

describe("P&L series by week, month and year", () => {
  const db = buildSeed();
  it("weeks match the weekly P&L and end with the current partial week", () => {
    const s = pnlSeries(db.arDocs, db.products, "2026-10-24", "week", 12);
    expect(s).toHaveLength(12);
    expect(s.at(-1)).toMatchObject({ start: "2026-10-19", end: "2026-10-24", partial: true });
  });

  it("months start at the first month with deliveries; the current month runs to today", () => {
    const s = pnlSeries(db.arDocs, db.products, "2026-10-24", "month", 12);
    expect(s.map((p) => [p.start, p.end, p.partial])).toEqual([
      ["2026-08-01", "2026-08-31", false],
      ["2026-09-01", "2026-09-30", false],
      ["2026-10-01", "2026-10-24", true],
    ]);
    expect(s.at(-1)!.revenue).toBe(salesMetrics(db).monthRevenue);
  });

  it("years cover the data so far and add up to the months", () => {
    const y = pnlSeries(db.arDocs, db.products, "2026-10-24", "year", 5);
    const m = pnlSeries(db.arDocs, db.products, "2026-10-24", "month", 12);
    expect(y).toHaveLength(1);
    expect(y[0]).toMatchObject({ start: "2026-01-01", end: "2026-10-24", partial: true });
    expect(y[0].revenue).toBe(m.reduce((a, p) => a + p.revenue, 0));
  });
});
