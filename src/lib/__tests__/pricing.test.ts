import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCustomer, createManualOrder, draftFromLine, resolveDraftIssue, setAgreedPrice, type ActCtx } from "../actions";
import type { Db } from "../db";
import { agreementOn, agreementSummary, quoteToBaseExTax, resolvePrice } from "../domain/pricing";
import { twd } from "../money";
import { buildSeed } from "../seed";

const as = (db: Db, role: string): ActCtx => {
  const u = db.users.find((x) => x.role === role)!;
  return { actor: { id: u.id, name: u.name, type: "user", user: u }, now: "2026-10-24T09:00:00+08:00" };
};
const agent: ActCtx = { actor: { id: "agent", name: "AI", type: "agent" }, now: "2026-10-24T09:00:00+08:00" };
const cust = (db: Db, id: string) => db.customers.find((c) => c.id === id)!;
const prod = (db: Db, id: string) => db.products.find((p) => p.id === id)!;

describe("合約價 resolution", () => {
  it("uses the agreement in effect on the date, falling back to the tier price", () => {
    const db = buildSeed();
    // 福記 雞塊: 152 from onboarding, renegotiated to 148 from 9/1
    expect(resolvePrice(db.customerPrices, cust(db, "C01"), prod(db, "P001"), "2026-08-15")).toMatchObject({ cents: twd(152), source: "contract" });
    expect(resolvePrice(db.customerPrices, cust(db, "C01"), prod(db, "P001"), "2026-09-01")).toMatchObject({ cents: twd(148), source: "contract" });
    // 福記 has no agreement for 起司條 → VIP tier price
    expect(resolvePrice(db.customerPrices, cust(db, "C01"), prod(db, "P013"), "2026-10-24")).toMatchObject({ cents: prod(db, "P013").price.vip, source: "tier" });
    // before onboarding there is no agreement
    expect(agreementOn(db.customerPrices, "C01", "P001", "2019-01-01")).toBeUndefined();
  });

  it("converts tax-included per-箱 quotes to whole-TWD ex-tax per 包", () => {
    expect(quoteToBaseExTax({ amountCents: twd(2289), unit: "pack", taxIncluded: true }, { packSize: 10 })).toBe(twd(218));
    expect(quoteToBaseExTax({ amountCents: twd(780), unit: "pack", taxIncluded: false }, { packSize: 6 })).toBe(twd(130));
    expect(quoteToBaseExTax({ amountCents: twd(150), unit: "base", taxIncluded: false }, { packSize: 10 })).toBe(twd(150));
  });

  it("seed history is priced from the agreements", () => {
    const db = buildSeed();
    const line = db.orders.find((o) => o.customerId === "C02" && o.deliveryDate.startsWith("2026-08") && o.lines.some((l) => l.productId === "P002"))!.lines.find((l) => l.productId === "P002")!;
    expect(line.unitPriceExTaxCents).toBe(twd(218));
  });

  it("summarises agreements and flags prices below standard cost", () => {
    const db = buildSeed();
    const s = agreementSummary(db.customerPrices, cust(db, "C06"), db.products, "2026-10-24");
    expect(s.lines.map((l) => l.product.id).sort()).toEqual(["P001", "P005", "P012"]);
    expect(s.belowCostCount).toBe(1);
    expect(s.lines.find((l) => l.product.id === "P012")!.belowCost).toBe(true);
    expect(agreementSummary(db.customerPrices, cust(db, "C03"), db.products, "2026-10-24").lines).toHaveLength(0);
  });
});

describe("every order path uses the resolver", () => {
  it("manual orders price from the agreement, and 改價 is measured against it", () => {
    const db = buildSeed();
    const { db: next, value } = createManualOrder(
      db,
      as(db, "sales"),
      { customerId: "C12", source: "PHONE", deliveryDate: "2026-10-25", note: "", lines: [{ productId: "P001", qty: 2, unit: "base", priceOverride: null, priceReason: "" }] },
      false,
    );
    const o = next.orders.find((x) => x.id === value)!;
    expect(o.lines[0].unitPriceExTaxCents).toBe(twd(150));
    expect(next.events.at(-1)!.summary).not.toContain("改價");
  });

  it("LINE drafts and customer reassignment pick up the agreed price", () => {
    let db = buildSeed();
    db = draftFromLine(db, as(db, "sales"), "msg-dashu", "品香炸雞");
    const draft = db.orders.find((o) => o.id === "o-line-msg-dashu")!;
    const reassigned = resolveDraftIssue(db, as(db, "sales"), draft.id, 0, { customerId: "C12" });
    const lines = reassigned.orders.find((o) => o.id === draft.id)!.lines;
    for (const l of lines) expect(l.unitPriceExTaxCents).toBe(resolvePrice(db.customerPrices, cust(db, "C12"), prod(db, l.productId), draft.deliveryDate).cents);
  });

  it("no code outside domain/pricing.ts reads Product.price directly", () => {
    const root = join(__dirname, "..", "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) {
          if (f !== "__tests__") walk(p);
        } else if (/\.tsx?$/.test(f) && !p.endsWith(join("domain", "pricing.ts")) && /\.price\[|\.price\.(standard|volume|vip)/.test(readFileSync(p, "utf8"))) offenders.push(p.slice(root.length));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe("setAgreedPrice", () => {
  it("appends a superseding row, keeps past orders, and is audited", () => {
    const db = buildSeed();
    const before = db.orders.filter((o) => o.customerId === "C03").flatMap((o) => o.lines.map((l) => l.unitPriceExTaxCents));
    const next = setAgreedPrice(db, as(db, "sales"), { customerId: "C03", productId: "P004", quote: { amountCents: twd(99), unit: "base", taxIncluded: false }, effectiveFrom: "2026-10-25", note: "新報價" });
    expect(next.customerPrices).toHaveLength(db.customerPrices.length + 1);
    expect(resolvePrice(next.customerPrices, cust(next, "C03"), prod(next, "P004"), "2026-10-25").cents).toBe(twd(99));
    expect(resolvePrice(next.customerPrices, cust(next, "C03"), prod(next, "P004"), "2026-10-24").source).toBe("tier");
    expect(next.orders.filter((o) => o.customerId === "C03").flatMap((o) => o.lines.map((l) => l.unitPriceExTaxCents))).toEqual(before);
    expect(next.events.at(-1)).toMatchObject({ action: "set_agreed_price", entityType: "CustomerPrice" });
  });

  it("a null quote ends the agreement", () => {
    const db = buildSeed();
    const next = setAgreedPrice(db, as(db, "owner"), { customerId: "C01", productId: "P001", quote: null, effectiveFrom: "2026-11-01" });
    expect(resolvePrice(next.customerPrices, cust(next, "C01"), prod(next, "P001"), "2026-11-01").source).toBe("tier");
  });

  it("only sales and the owner may change prices; never the AI", () => {
    const db = buildSeed();
    const input = { customerId: "C01", productId: "P001", quote: { amountCents: twd(140), unit: "base" as const, taxIncluded: false }, effectiveFrom: "2026-10-25" };
    for (const role of ["driver", "accounting", "warehouse"]) expect(() => setAgreedPrice(db, as(db, role), input)).toThrow(/權限/);
    expect(() => setAgreedPrice(db, agent, input)).toThrow(/AI/);
  });

  it("agreed prices entered at onboarding take effect from the onboarding date", () => {
    const db = buildSeed();
    const { db: next, value: id } = createCustomer(db, as(db, "sales"), {
      name: "旺角炸雞", code: "WJ13", segment: "炸物店", subType: "炸雞", ownerName: "劉旺", phone: "0912-345-678", contactName: "", onboardedAt: "2026-10-20",
      accountManagerId: "u-sales", address: "示範區旺角街 13 號", district: db.customers[0].district, windowStart: "09:00", windowEnd: "12:00", settlementTerms: "daily",
      sameDaySharePct: 50, creditLimit: 30000, priceTier: "standard", invoiceClass: "B2C", taxId: "", carrierType: "none", carrierValue: "",
      agreedPrices: [{ productId: "P001", amount: 1575, unit: "pack", taxIncluded: true }],
    });
    expect(agreementOn(next.customerPrices, id, "P001", "2026-10-20")).toMatchObject({ priceExTaxCents: twd(150), effectiveFrom: "2026-10-20" });
  });
});
