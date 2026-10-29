import { describe, expect, it } from "vitest";
import { activePlan, completeDelivery, confirmPick, reversePayment, setCustody, type ActCtx } from "../actions";
import { codFor } from "../cod";
import type { Db } from "../db";
import { billableLines, codAmount, linesTotal } from "../domain/collections";
import { orderTotals } from "../domain/orders";
import { twd } from "../money";
import { collectionsFor } from "../selectors";
import { buildSeed } from "../seed";

const as = (db: Db, role: string, vehicle?: "A" | "B"): ActCtx => {
  const u = db.users.find((x) => x.role === role && (!vehicle || x.vehicleId === vehicle))!;
  return { actor: { id: u.id, name: u.name, type: "user", user: u }, now: "2026-10-24T09:00:00+08:00" };
};
const AH = "d-2026-10-24-AH03";
const stopOf = (db: Db, deliveryId: string) => collectionsFor(db, "all").stops.find((s) => s.deliveryId === deliveryId)!;
const vehicleOf = (db: Db, deliveryId: string) => activePlan(db)!.stops.find((s) => s.deliveryId === deliveryId)!.vehicleId;

describe("cash on delivery amount", () => {
  it("follows settlement terms", () => {
    const db = buildSeed();
    const c = (id: string) => db.customers.find((x) => x.id === id)!;
    expect(codAmount(c("C03"), twd(2520))).toMatchObject({ cents: twd(2520) }); // daily
    expect(codAmount(c("C01"), twd(2520)).cents).toBe(0); // monthly
    expect(codAmount(c("C04"), twd(2520)).cents).toBe(twd(1300)); // mixed 50%, rounded to NT$100
  });

  it("an unpicked order totals exactly like orderTotals", () => {
    const db = buildSeed();
    for (const o of db.orders.slice(-12)) expect(linesTotal(billableLines(o, {})).total).toBe(orderTotals(o).total);
  });
});

describe("short picks", () => {
  it("lower the billed quantity, the charge and the amount to collect", () => {
    let db = buildSeed();
    const order = db.orders.find((o) => o.id === db.deliveries.find((d) => d.id === AH)!.orderId)!;
    const line = order.lines[0];
    const fullCod = codFor(db, order.id).cents;
    db = confirmPick(db, as(db, "warehouse"), [line.id], line.qtyBase - 2, "缺 2");
    const short = codFor(db, order.id).cents;
    expect(short).toBeLessThan(fullCod);
    db = completeDelivery(db, as(db, "driver", vehicleOf(db, AH)), AH);
    const doc = db.arDocs.find((d) => d.sourceDeliveryId === AH)!;
    expect(doc.totalCents).toBe(short);
    expect(doc.items![0]).toMatchObject({ qty: line.qtyBase - 2 });
    expect(codFor(db, order.id).cents).toBe(doc.totalCents);
  });

  it("never raise it", () => {
    const db = buildSeed();
    const line = db.orders.find((o) => o.id === db.deliveries.find((d) => d.id === AH)!.orderId)!.lines[0];
    expect(billableLines({ ...db.orders[0], lines: [line] }, { [line.id]: { qtyBase: line.qtyBase + 5, at: "", by: "", routeVersion: 1, vehicleAtPick: "A" } })[0].qtyBase).toBe(line.qtyBase);
  });
});

describe("day collections", () => {
  it("tracks expected, collected, shortfall and where the cash is", () => {
    let db = buildSeed();
    const v = vehicleOf(db, AH);
    const before = collectionsFor(db, v);
    const due = stopOf(db, AH).expectedCents;
    expect(due).toBeGreaterThan(0);
    db = completeDelivery(db, as(db, "driver", v), AH, { method: "cash", amountCents: due - twd(500) });
    const after = collectionsFor(db, v);
    expect(after.collectedCents).toBe(before.collectedCents + due - twd(500));
    expect(after.pendingCents).toBe(before.pendingCents - due);
    expect(stopOf(db, AH)).toMatchObject({ delivered: true, shortfallCents: twd(500), cashHeldCents: due - twd(500), methods: ["cash"] });

    const pay = db.payments.find((p) => p.deliveryId === AH)!;
    db = setCustody(db, as(db, "accounting"), [pay.id], "handed_over");
    // handing cash in moves it out of the driver's pocket but it still counts as collected today
    expect(collectionsFor(db, v).cashHeldCents).toBe(after.cashHeldCents - pay.grossCents);
    expect(collectionsFor(db, v).collectedCents).toBe(after.collectedCents);
    expect(collectionsFor(db, v).handedOverCents).toBe(after.handedOverCents + pay.grossCents);
  });

  it("ignores reversed payments", () => {
    let db = buildSeed();
    const v = vehicleOf(db, AH);
    db = completeDelivery(db, as(db, "driver", v), AH, { method: "cash", amountCents: twd(100) });
    const pay = db.payments.find((p) => p.deliveryId === AH)!;
    db = reversePayment(db, as(db, "accounting"), pay.id, "登錄錯誤");
    expect(stopOf(db, AH).collectedCents).toBe(0);
  });

  it("monthly customers have nothing to collect and no prior balance shown", () => {
    const db = buildSeed();
    const monthly = collectionsFor(db, "all").stops.filter((s) => db.customers.find((c) => c.id === s.customerId)!.settlementTerms === "monthly");
    expect(monthly.length).toBeGreaterThan(0);
    for (const s of monthly) expect(s).toMatchObject({ expectedCents: 0, priorBalanceCents: 0 });
  });

  it("per-vehicle views add up to the whole day", () => {
    const db = buildSeed();
    expect(collectionsFor(db, "A").expectedCents + collectionsFor(db, "B").expectedCents).toBe(collectionsFor(db, "all").expectedCents);
  });
});
