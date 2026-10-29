import { describe, expect, it } from "vitest";
import { activePlan, addAiTask, applyRoutePlan, completeDelivery, routingContext, setReorderPoint, validateOrder, draftFromLine, updateDraftLine, type ActCtx } from "../actions";
import { executeTask, planCommand } from "../agent";
import { matchIntent } from "../domain/ai";
import { fefoAllocate, stockPosition } from "../domain/inventory";
import { isValidTaxId, preflightInvoice } from "../domain/invoices";
import { parseLineOrder } from "../domain/lineParser";
import { canTransition } from "../domain/orders";
import { buildPickLines, groupByVehicle, groupByZone } from "../domain/picking";
import { checkAutoReorder } from "../domain/procurement";
import { evaluatePlan, suggestReassignment } from "../domain/routing";
import type { Db } from "../db";
import { twd } from "../money";
import { maps, pickLines } from "../selectors";
import { buildSeed } from "../seed";

const as = (db: Db, role: string): ActCtx => {
  const u = db.users.find((x) => x.role === role)!;
  return { actor: { id: u.id, name: u.name, type: "user", user: u }, now: "2026-10-24T07:10:00+08:00" };
};
const agent: ActCtx = { actor: { id: "agent", name: "AI", type: "agent" }, now: "2026-10-24T07:10:00+08:00" };

describe("routing constraints", () => {
  const db = buildSeed();
  const plan = activePlan(db)!;
  const ctx = routingContext(db);

  it("initial plan has one late stop on B", () => {
    const ev = evaluatePlan(plan.stops, ctx);
    expect(ev.feasible).toBe(false);
    expect(ev.routes.B.stops.filter((s) => s.late)).toHaveLength(1);
  });

  it("suggests moving 巷口炸物 to A and the result satisfies every hard constraint", () => {
    const s = suggestReassignment(plan.stops, ctx)!;
    expect(s.customerId).toBe("C07");
    expect(s.to).toBe("A");
    expect(s.after.feasible).toBe(true);
    expect(s.savedKm).toBeGreaterThan(5);
  });

  it("never suggests an infeasible move when capacity is exceeded", () => {
    const tight = { ...ctx, vehicles: new Map([...ctx.vehicles].map(([k, v]) => [k, k === "A" ? { ...v, capacityKg: 120 } : v])) };
    const s = suggestReassignment(plan.stops, tight);
    if (s) expect(s.after.feasible).toBe(true);
    expect(s?.to).not.toBe("A");
  });

  it("applies atomically with optimistic concurrency, and pick lists follow the route", () => {
    const s = suggestReassignment(plan.stops, ctx)!;
    const next = applyRoutePlan(db, as(db, "owner"), plan.version, s.stops, "test");
    expect(activePlan(next)!.version).toBe(2);
    expect(next.deliveries.find((d) => d.customerId === "C07" && d.date === "2026-10-24")!.vehicleId).toBe("A");
    expect(pickLines(next).filter((l) => l.customerId === "C07").every((l) => l.vehicleId === "A")).toBe(true);
    expect(() => applyRoutePlan(next, as(next, "owner"), 1, s.stops, "stale")).toThrow(/樂觀鎖|v2/);
  });
});

describe("pick grouping", () => {
  const db = buildSeed();
  const m = maps(db);
  const lines = buildPickLines(activePlan(db)!, { orders: db.orders, products: m.products, customers: m.customers, lots: m.lots, reservations: db.reservations });

  it("zone view runs A → D and totals equal the order lines", () => {
    const g = groupByZone(lines, m.products);
    expect(g.map((x) => x.zone)).toEqual(["A", "B", "C", "D"]);
    const total = g.flatMap((z) => z.skus).reduce((a, s) => a + s.totalBase, 0);
    expect(total).toBe(lines.reduce((a, l) => a + l.qtyBase, 0));
  });

  it("vehicle view contains every line exactly once", () => {
    const v = groupByVehicle(lines);
    expect(v.A.flatMap((s) => s.lines).length + v.B.flatMap((s) => s.lines).length).toBe(lines.length);
  });

  it("every pick line is backed by FEFO lot reservations covering its quantity", () => {
    for (const l of lines) expect(l.lots.reduce((a, x) => a + x.qtyBase, 0)).toBe(l.qtyBase);
  });
});

describe("inventory & procurement", () => {
  const db = buildSeed();
  it("expired lots are never allocated; FEFO picks earliest expiry", () => {
    const r = fefoAllocate(db.lots, "P007", 5, "2026-10-24");
    expect(r.allocations.every((a) => !a.lotId.includes("L260420"))).toBe(true);
    // today's reservations consumed the near-expiry dumpling lot before the newer one
    const near = db.lots.find((l) => l.id === "lot-P005-L260502")!;
    expect(near.qtyReserved).toBe(near.qtyOnHand);
    expect(fefoAllocate(db.lots, "P005", 1, "2026-10-24").allocations[0].lotId).toBe("lot-P005-L260930");
  });

  it("reorder triggers on projected (on-hand − reserved + inbound), not on-hand", () => {
    const fries = db.products.find((p) => p.id === "P003")!;
    const pos = stockPosition(fries, db.lots, db.purchaseOrders, "2026-10-24");
    expect(pos.onHand).toBeGreaterThan(fries.reorderPoint);
    expect(pos.belowReorder).toBe(true);
    const chicken = db.products.find((p) => p.id === "P001")!;
    expect(stockPosition(chicken, db.lots, db.purchaseOrders, "2026-10-24").inbound).toBe(100);
  });

  it("threshold change is reflected in reorder status", () => {
    const next = setReorderPoint(db, as(db, "procurement"), "P008", 0, "test");
    const p = next.products.find((x) => x.id === "P008")!;
    expect(stockPosition(p, next.lots, next.purchaseOrders, "2026-10-24").belowReorder).toBe(false);
  });

  it("auto reorder is blocked by default and by guardrails", () => {
    const s = db.suppliers[0];
    expect(checkAutoReorder(db.settings, s, twd(100), 0).allowed).toBe(false);
    const on = { ...db.settings, autoReorder: { ...db.settings.autoReorder, enabled: true } };
    expect(checkAutoReorder(on, s, twd(100), 0).allowed).toBe(true);
    expect(checkAutoReorder(on, s, twd(999999), 0).allowed).toBe(false);
    expect(checkAutoReorder(on, db.suppliers[2], twd(100), 0).allowed).toBe(false);
  });
});

describe("orders & LINE parsing", () => {
  const db = buildSeed();
  it("state machine rejects skipping steps", () => {
    expect(canTransition("Draft", "Shipped")).toBe(false);
    expect(canTransition("Reserved", "Picking")).toBe(true);
    expect(canTransition("Cancelled", "Validated")).toBe(false);
  });

  it("flags ambiguous units instead of guessing", () => {
    const r = parseLineOrder("早安～明天要 雞塊2箱 薯條5 花枝丸10包", db.products, db.customers, "U-demo-jinhua");
    expect(r.customerId).toBe("C11");
    expect(r.lines.map((l) => l.productId)).toEqual(["P001", "P003", "P004"]);
    expect(r.lines[1].unit).toBeNull();
    expect(r.issues.some((i) => i.field === "unit" && i.lineIndex === 1)).toBe(true);
  });

  it("longest alias wins (素雞塊 is not 雞塊)", () => {
    const r = parseLineOrder("素雞塊3包 雞塊2包", db.products, db.customers);
    expect(r.lines.map((l) => l.productId)).toEqual(["P006", "P001"]);
  });

  it("a draft cannot be validated until a person resolves the issues", () => {
    let d = draftFromLine(db, as(db, "sales"), "msg-jinhua");
    const id = "o-line-msg-jinhua";
    expect(() => validateOrder(d, as(d, "sales"), id)).toThrow(/人工確認/);
    d = updateDraftLine(d, as(d, "sales"), id, 1, { unit: "base" });
    d = validateOrder(d, as(d, "sales"), id);
    expect(d.orders.find((o) => o.id === id)!.state).toBe("Reserved");
    expect(() => draftFromLine(d, as(d, "sales"), "msg-jinhua")).toThrow();
  });
});

describe("delivery & collection", () => {
  it("delivery creates AR and a cash collection that is not yet bank-settled", () => {
    const db = buildSeed();
    const next = completeDelivery(db, as(db, "driver"), "d-2026-10-24-AH03", { method: "cash", amountCents: twd(2520) });
    const doc = next.arDocs.find((d) => d.sourceDeliveryId === "d-2026-10-24-AH03")!;
    expect(doc.totalCents).toBe(twd(2520));
    const p = next.payments.find((x) => x.deliveryId === "d-2026-10-24-AH03")!;
    expect(p.custody).toBe("collected");
    // 單趟開立: issued (numbered) at delivery when it passes preflight, waiting to be uploaded
    const inv = next.invoices.find((i) => i.sourceArIds.includes(doc.id))!;
    expect(inv).toMatchObject({ source: "per_delivery", providerStatus: "ready", totalCents: doc.totalCents, uploadDueOn: "2026-10-26" });
    expect(inv.invoiceNo).toMatch(/^ZX\d{8}$/);
  });

  it("monthly customers also get one invoice per delivery, with 7-decimal ex-tax lines", () => {
    const db = buildSeed();
    const d = db.deliveries.find((x) => x.date === "2026-10-24" && x.customerId === "C01")!;
    const next = completeDelivery(db, as(db, "driver"), d.id);
    const inv = next.invoices.find((i) => i.sourceArIds.some((id) => next.arDocs.find((a) => a.id === id)?.sourceDeliveryId === d.id))!;
    expect(inv).toMatchObject({ invoiceClass: "B2B", buyerTaxId: "00001102", providerStatus: "ready", uploadDueOn: "2026-10-31" });
    expect(inv.lines!.length).toBeGreaterThan(0);
    expect(inv.lines!.every((l) => /^\d+(\.\d{1,7})?$/.test(l.unitPriceEx))).toBe(true);
  });
});

describe("invoices", () => {
  it("validates tax ids and carriers", () => {
    expect(isValidTaxId("00001102")).toBe(true);
    expect(isValidTaxId("00001112")).toBe(false);
    const db = buildSeed();
    const bad = db.invoices.find((i) => i.carrierValue === "/LJ05M2")!;
    expect(preflightInvoice(bad).some((x) => x.field === "carrier")).toBe(true);
  });
});

describe("AI permission boundaries", () => {
  it("the agent cannot execute ledger or route actions directly", () => {
    const db = buildSeed();
    const s = suggestReassignment(activePlan(db)!.stops, routingContext(db))!;
    expect(() => applyRoutePlan(db, agent, 1, s.stops, "x")).toThrow(/AI/);
    expect(() => setReorderPoint(db, agent, "P003", 180, "x")).toThrow(/AI/);
  });

  it("roles are enforced: a driver cannot reverse payments, sales cannot approve routes", async () => {
    const { reversePayment } = await import("../actions");
    const db = buildSeed();
    expect(() => reversePayment(db, as(db, "driver"), db.payments[0].id, "x")).toThrow(/權限/);
    const s = suggestReassignment(activePlan(db)!.stops, routingContext(db))!;
    expect(() => applyRoutePlan(db, as(db, "sales"), 1, s.stops, "x")).toThrow(/權限/);
  });

  it("a command becomes a proposal; execution requires an approving human", () => {
    const db = buildSeed();
    expect(matchIntent("把冷凍薯條補貨門檻設為30箱")?.kind).toBe("set_threshold");
    const spec = planCommand(db, "把冷凍薯條補貨門檻設為30箱");
    expect(spec.status).toBe("awaiting_approval");
    expect(spec.payload).toEqual({ productId: "P003", qtyBase: 180 });
    const { db: withTask, task } = addAiTask(db, as(db, "owner"), spec);
    expect(withTask.products.find((p) => p.id === "P003")!.reorderPoint).toBe(120);
    expect(() => executeTask(withTask, agent, task)).toThrow();
    const next = executeTask(withTask, as(db, "procurement"), task);
    expect(next.aiTasks.find((t) => t.id === task.id)!.status).toBe("committed");
    expect(next.products.find((p) => p.id === "P003")!.reorderPoint).toBe(180);
  });

  it("read-only answers never change data", () => {
    const db = buildSeed();
    const spec = planCommand(db, "找出10月未收款客戶");
    expect(spec.status).toBe("answered");
    expect(spec.title).toContain("逾期");
  });
});
