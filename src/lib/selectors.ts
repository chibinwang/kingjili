import { customerAr, DOC_SIGN } from "./domain/ar";
import { runMonthEndAudit } from "./domain/audit";
import { buildCrmRow } from "./domain/crm";
import { stockPosition, type StockPosition } from "./domain/inventory";
import { buildPickLines, type PickLine } from "./domain/picking";
import { evaluatePlan, suggestReassignment } from "./domain/routing";
import { activePlan, routingContext } from "./actions";
import type { Db } from "./db";
import { sum } from "./money";
import { addDays, DEMO_TODAY, periodOf, periodRange } from "./time";

/** Memoise a derived view on the db object identity (db is replaced on every committed action). */
function memo<T>(fn: (db: Db) => T): (db: Db) => T {
  const cache = new WeakMap<Db, T>();
  return (db) => {
    if (!cache.has(db)) cache.set(db, fn(db));
    return cache.get(db)!;
  };
}
function memoArg<A extends string, T>(fn: (db: Db, a: A) => T): (db: Db, a: A) => T {
  const cache = new WeakMap<Db, Map<A, T>>();
  return (db, a) => {
    let m = cache.get(db);
    if (!m) cache.set(db, (m = new Map()));
    if (!m.has(a)) m.set(a, fn(db, a));
    return m.get(a)!;
  };
}

export const maps = memo((db) => ({
  customers: new Map(db.customers.map((c) => [c.id, c])),
  products: new Map(db.products.map((p) => [p.id, p])),
  orders: new Map(db.orders.map((o) => [o.id, o])),
  lots: new Map(db.lots.map((l) => [l.id, l])),
  users: new Map(db.users.map((u) => [u.id, u])),
  suppliers: new Map(db.suppliers.map((s) => [s.id, s])),
  arDocs: new Map(db.arDocs.map((d) => [d.id, d])),
  payments: new Map(db.payments.map((p) => [p.id, p])),
}));

export const routeView = memo((db) => {
  const plan = activePlan(db);
  if (!plan) return null;
  const ctx = routingContext(db);
  const evaluation = evaluatePlan(plan.stops, ctx);
  const suggestion = suggestReassignment(plan.stops, ctx);
  return { plan, evaluation, suggestion };
});

export const pickLines = memo((db): PickLine[] => {
  const plan = activePlan(db);
  if (!plan) return [];
  const m = maps(db);
  return buildPickLines(plan, { orders: db.orders, products: m.products, customers: m.customers, lots: m.lots, reservations: db.reservations });
});

export const stockPositions = memo((db) => {
  const out = new Map<string, StockPosition>();
  for (const p of db.products) out.set(p.id, stockPosition(p, db.lots, db.purchaseOrders, DEMO_TODAY));
  return out;
});

export const arSummary = memo((db) => {
  const rows = db.customers.map((c) => customerAr(c, db.arDocs, db.payments, db.allocations, DEMO_TODAY));
  return {
    rows,
    open: sum(rows.map((r) => Math.max(0, r.balance))),
    overdue: sum(rows.map((r) => r.overdue)),
    buckets: {
      current: sum(rows.map((r) => r.buckets.current)),
      "1-30": sum(rows.map((r) => r.buckets["1-30"])),
      "31-60": sum(rows.map((r) => r.buckets["31-60"])),
      "61+": sum(rows.map((r) => r.buckets["61+"])),
    },
  };
});

export const auditFor = memoArg((db, period: string) =>
  runMonthEndAudit({
    period,
    customers: db.customers,
    docs: db.arDocs,
    payments: db.payments,
    allocations: db.allocations,
    invoices: db.invoices,
    orders: db.orders,
    statements: db.statements,
    events: db.events,
  }),
);

/** Revenue recognised on delivery (AR charge issue date), ex-tax. Gross margin only over lines with known cost. */
export const salesMetrics = memo((db) => {
  const m = maps(db);
  const charges = db.arDocs.filter((d) => d.type === "charge");
  const byDay = new Map<string, number>();
  for (const d of charges) byDay.set(d.issueDate, (byDay.get(d.issueDate) ?? 0) + d.exTaxCents);
  const period = periodOf(DEMO_TODAY);
  const { start } = periodRange(period);
  const monthDocs = charges.filter((d) => d.issueDate >= start && d.issueDate <= DEMO_TODAY);
  let costed = 0;
  let cost = 0;
  let uncostedRevenue = 0;
  for (const d of monthDocs) {
    for (const it of d.items ?? []) {
      const p = m.products.get(it.productId)!;
      if (p.costCents === null) {
        uncostedRevenue += it.exTaxCents;
        continue;
      }
      const qtyBase = it.unitLabel === p.packUnit ? it.qty * p.packSize : it.qty;
      costed += it.exTaxCents;
      cost += qtyBase * p.costCents;
    }
  }
  const credits = sum(db.arDocs.filter((d) => DOC_SIGN[d.type] < 0 && d.issueDate >= start).map((d) => d.exTaxCents));
  const trailing = Array.from({ length: 7 }, (_, i) => addDays(DEMO_TODAY, i - 7)).map((date) => ({ date, cents: byDay.get(date) ?? 0 }));
  const prevStart = periodRange("2026-09").start;
  const prevSameDay = charges.filter((d) => d.issueDate >= prevStart && d.issueDate <= "2026-09-24").reduce((a, d) => a + d.exTaxCents, 0);
  return {
    monthRevenue: sum(monthDocs.map((d) => d.exTaxCents)) - credits,
    prevMonthToDate: prevSameDay,
    todayRevenue: byDay.get(DEMO_TODAY) ?? 0,
    yesterdayRevenue: byDay.get(addDays(DEMO_TODAY, -1)) ?? byDay.get(addDays(DEMO_TODAY, -2)) ?? 0,
    grossMarginBp: costed > 0 ? Math.round(((costed - cost) * 10000) / costed) : null,
    grossProfit: costed - cost,
    uncostedRevenue,
    trailing,
  };
});

export const todayOrders = memo((db) => db.orders.filter((o) => o.deliveryDate === DEMO_TODAY && o.state !== "Cancelled"));

export const crmRows = memo((db) => {
  const ar = new Map(arSummary(db).rows.map((r) => [r.customerId, r]));
  return db.customers.map((c) => buildCrmRow(c, { docs: db.arDocs, orders: db.orders, notes: db.crmNotes, balance: ar.get(c.id)!.balance, overdue: ar.get(c.id)!.overdue, today: DEMO_TODAY }));
});
