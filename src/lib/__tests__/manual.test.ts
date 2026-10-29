import { describe, expect, it } from "vitest";
import { activePlan, addOrderToRoute, approveSupplier, createCustomer, createProduct, createManualOrder, createSupplier, draftPurchaseOrders, insertionOptions, pasteOrderText, unroutedToday, type ActCtx } from "../actions";
import { customerSchema, findCustomerDuplicates, nextShelf, type CustomerInput, type OrderInput } from "../domain/forms";
import type { Db } from "../db";
import { parseLineOrder } from "../domain/lineParser";
import { pickLines } from "../selectors";
import { buildSeed } from "../seed";

const as = (db: Db, role: string): ActCtx => {
  const u = db.users.find((x) => x.role === role)!;
  return { actor: { id: u.id, name: u.name, type: "user", user: u }, now: "2026-10-24T09:00:00+08:00" };
};
const agent: ActCtx = { actor: { id: "agent", name: "AI", type: "agent" }, now: "2026-10-24T09:00:00+08:00" };

const newCustomer: CustomerInput = {
  name: "旺角炸雞",
  code: "WJ13",
  segment: "炸物店",
  subType: "炸雞",
  ownerName: "劉旺",
  phone: "0912-345-678",
  contactName: "",
  onboardedAt: "2026-10-24",
  accountManagerId: "u-sales",
  address: "示範區旺角街 13 號",
  district: "西區",
  windowStart: "09:00",
  windowEnd: "12:00",
  settlementTerms: "daily",
  sameDaySharePct: 50,
  creditLimit: 30000,
  priceTier: "standard",
  invoiceClass: "B2C",
  taxId: "",
  carrierType: "mobile",
  carrierValue: "/WJ13ABC",
};
const order = (customerId: string, deliveryDate = "2026-10-24"): OrderInput => ({
  customerId,
  source: "PHONE",
  deliveryDate,
  note: "",
  lines: [
    { productId: "P001", qty: 2, unit: "base", priceOverride: null, priceReason: "" },
    { productId: "P003", qty: 1, unit: "base", priceOverride: 130, priceReason: "老客戶折讓" },
  ],
});

describe("new customer", () => {
  it("validates inline rules: tax id checksum, carrier format, time window", () => {
    expect(customerSchema.safeParse(newCustomer).success).toBe(true);
    expect(customerSchema.safeParse({ ...newCustomer, invoiceClass: "B2B", taxId: "12345678" }).success).toBe(false);
    expect(customerSchema.safeParse({ ...newCustomer, carrierValue: "/abc" }).success).toBe(false);
    expect(customerSchema.safeParse({ ...newCustomer, windowEnd: "08:00" }).success).toBe(false);
    expect(customerSchema.safeParse({ ...newCustomer, phone: "12345" }).success).toBe(false);
  });

  it("creates the customer with a district-estimated map position and logs it", () => {
    const db = buildSeed();
    const { db: next, value: id } = createCustomer(db, as(db, "sales"), newCustomer);
    const c = next.customers.find((x) => x.id === id)!;
    expect(id).toBe("C13");
    expect(c.contactName).toBe("劉旺");
    expect(c.linkStatus).toBe("unlinked");
    expect(c.geoPending).toBe(true);
    expect(next.events.at(-1)!.action).toBe("create");
    expect(() => createCustomer(next, as(next, "sales"), newCustomer)).toThrow(/代號/);
  });

  it("warns about likely duplicates by name, phone or tax id", () => {
    const db = buildSeed();
    expect(findCustomerDuplicates(db.customers, { name: "x", phone: "02 0000 1101" }).map((c) => c.id)).toEqual(["C01"]);
    expect(findCustomerDuplicates(db.customers, { name: "x", phone: "", taxId: "00001113" }).map((c) => c.id)).toEqual(["C02"]);
  });

  it("drivers, accountants and the AI cannot create customers", () => {
    const db = buildSeed();
    expect(() => createCustomer(db, as(db, "driver"), newCustomer)).toThrow(/權限/);
    expect(() => createCustomer(db, as(db, "accounting"), newCustomer)).toThrow(/權限/);
    expect(() => createCustomer(db, agent, newCustomer)).toThrow(/AI/);
  });
});

describe("manual order", () => {
  it("prices from the tier, records overrides with a reason, and reserves stock on confirm", () => {
    const db = buildSeed();
    const { db: next, value: id } = createManualOrder(db, as(db, "sales"), order("C03", "2026-10-25"), true);
    const o = next.orders.find((x) => x.id === id)!;
    expect(o.state).toBe("Reserved");
    expect(o.lines[0].unitPriceExTaxCents).toBe(db.products.find((p) => p.id === "P001")!.price.standard);
    expect(o.lines[1].unitPriceExTaxCents).toBe(13000);
    expect(next.reservations.filter((r) => r.orderLineId.startsWith(id))).not.toHaveLength(0);
    expect(next.events.some((e) => e.action === "create_manual" && e.summary.includes("改價"))).toBe(true);
  });

  it("rejects past dates and price overrides without a reason", () => {
    const db = buildSeed();
    expect(() => createManualOrder(db, as(db, "sales"), order("C03", "2026-10-20"), false)).toThrow(/早於/);
    const bad = order("C03");
    bad.lines[1].priceReason = "";
    expect(() => createManualOrder(db, as(db, "sales"), bad, false)).toThrow(/原因/);
  });

  it("a confirmed order for today waits for the manager, then joins the route and the pick lists", () => {
    const db = buildSeed();
    const { db: next, value: id } = createManualOrder(db, as(db, "sales"), order("C09"), true);
    expect(unroutedToday(next).map((o) => o.id)).toEqual([id]);
    const opts = insertionOptions(next, id);
    const ok = opts.find((x) => x.feasible)!;
    expect(ok).toBeTruthy();
    expect(() => addOrderToRoute(next, as(next, "sales"), id, ok.vehicleId, 1)).toThrow(/權限/);
    const routed = addOrderToRoute(next, as(next, "owner"), id, ok.vehicleId, 1);
    expect(activePlan(routed)!.version).toBe(2);
    expect(unroutedToday(routed)).toHaveLength(0);
    expect(pickLines(routed).filter((l) => l.orderId === id).every((l) => l.vehicleId === ok.vehicleId)).toBe(true);
    expect(() => addOrderToRoute(routed, as(routed, "owner"), id, ok.vehicleId, 2)).toThrow();
  });

  it("pasted text goes through the AI draft path and still needs a person", () => {
    const db = buildSeed();
    const next = pasteOrderText(db, as(db, "sales"), "金華小吃 金姐（電話）", "明天要 雞塊2箱 薯條5");
    const draft = next.orders.at(-1)!;
    expect(draft.state).toBe("Draft");
    expect(draft.aiExtracted).toBe(true);
    expect(draft.issues!.some((i) => i.field === "unit")).toBe(true);
  });
});

describe("suppliers", () => {
  it("new suppliers start unapproved; only the manager approves; unapproved suppliers cannot be ordered from", () => {
    const db = buildSeed();
    const { db: next, value: id } = createSupplier(db, as(db, "procurement"), { name: "南港冷凍", contactName: "梁先生", phone: "02-2222-3333", channel: "phone", email: "", leadTimeDays: 3 });
    const s = next.suppliers.find((x) => x.id === id)!;
    expect(s.approved).toBe(false);
    expect(s.lineGroupVerified).toBe(false);
    expect(() => approveSupplier(next, as(next, "procurement"), id)).toThrow(/權限/);
    const withProduct = { ...next, products: next.products.map((p) => (p.id === "P013" ? { ...p, supplierId: id } : p)) };
    expect(() => draftPurchaseOrders(withProduct, as(next, "procurement"), [{ productId: "P013", qtyBase: 10 }], "manual")).toThrow(/尚未核准/);
    const ok = approveSupplier(withProduct, as(next, "owner"), id);
    expect(draftPurchaseOrders(ok, as(ok, "procurement"), [{ productId: "P013", qtyBase: 10 }], "manual").purchaseOrders.at(-1)!.supplierId).toBe(id);
  });
});

describe("new product", () => {
  const input = {
    name: "洋芋球",
    category: "冷凍炸物" as const,
    spec: "1kg／包",
    baseUnit: "包" as const,
    packSize: 10,
    weightGram: 1000,
    zone: "B" as const,
    shelf: "B-5",
    tempC: -18 as const,
    supplierId: "S01",
    cost: 70,
    priceStandard: 110,
    priceVolume: 106,
    priceVip: 101,
    reorderPointPacks: 3,
    reorderQtyPacks: 5,
    aliases: "馬鈴薯球、薯球",
  };

  it("creates the product in its shelf with reorder levels in base units, and the LINE parser learns its names", () => {
    const db = buildSeed();
    const { db: next, value: id } = createProduct(db, as(db, "procurement"), input);
    const p = next.products.find((x) => x.id === id)!;
    expect(id).toBe("P015");
    expect(p.reorderPoint).toBe(30);
    expect(p.reorderQty).toBe(50);
    expect(next.locations.some((l) => l.shelf === "B-5")).toBe(true);
    const r = parseLineOrder("明天要 馬鈴薯球3包 雞塊2包", next.products, next.customers);
    expect(r.lines.map((l) => l.productId)).toEqual([id, "P001"]);
  });

  it("rejects taken shelves, clashing LINE names, inverted price tiers and unauthorised roles", () => {
    const db = buildSeed();
    expect(() => createProduct(db, as(db, "procurement"), { ...input, shelf: "B-1" })).toThrow(/架位/);
    expect(() => createProduct(db, as(db, "procurement"), { ...input, aliases: "薯條" })).toThrow(/香脆薯條/);
    expect(() => createProduct(db, as(db, "procurement"), { ...input, priceVip: 120 })).toThrow(/VIP/);
    expect(() => createProduct(db, as(db, "procurement"), { ...input, shelf: "C-9" })).toThrow(/凍庫 B/);
    expect(() => createProduct(db, as(db, "sales"), input)).toThrow(/權限/);
    expect(() => createProduct(db, agent, input)).toThrow(/AI/);
    expect(nextShelf(db.products, "B")).toBe("B-5");
  });
});
