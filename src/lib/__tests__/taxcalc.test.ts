import { describe, expect, it } from "vitest";
import { allocateExTax, formatE7, taxDocument, taxTotals } from "../domain/taxcalc";
import { taxOnExclusive, twd } from "../money";

describe("含稅報價 reproduces the client's printed 交易明細 exactly", () => {
  // 杏鮑菇 380 × 9 (含稅) + 脆薯 1,270 × 1 (含稅) → 銷售額 4,467 / 稅額 223 / 總計 4,690
  const doc = taxDocument([
    { basis: "included", qty: 9, unitPriceCents: twd(380) },
    { basis: "included", qty: 1, unitPriceCents: twd(1270) },
  ]);
  it("line decimals", () => {
    expect(formatE7(doc.lines[0].unitPriceExE7)).toBe("361.9047619");
    expect(formatE7(doc.lines[0].amountExE7)).toBe("3,257.1428571");
    expect(formatE7(doc.lines[1].unitPriceExE7)).toBe("1,209.5238095");
    expect(formatE7(doc.lines[1].amountExE7)).toBe("1,209.5238095");
  });
  it("document totals", () => {
    expect(doc).toMatchObject({ basis: "included", salesCents: twd(4467), taxCents: twd(223), totalCents: twd(4690) });
  });
  it("the ex-tax split adds back to the sales amount", () => {
    const parts = allocateExTax(doc.lines, doc.salesCents);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(twd(4467));
  });
});

describe("未稅報價 keeps the existing rule", () => {
  it("tax = round(sales × 5%)", () => {
    for (const ex of [3708, 3710, 12345, 1]) {
      const d = taxDocument([{ basis: "excluded", qty: 1, unitPriceCents: twd(ex) }]);
      expect(d).toMatchObject({ basis: "excluded", salesCents: twd(ex), taxCents: taxOnExclusive(twd(ex)) });
      expect(formatE7(d.lines[0].unitPriceExE7)).toBe(ex.toLocaleString("en-US"));
    }
  });
});

describe("含稅 totals never drift from the quoted total", () => {
  it("for every whole-TWD total from 1 to 20,000", () => {
    for (let t = 1; t <= 20000; t++) {
      const r = taxTotals([{ basis: "included", amountCents: twd(t) }]);
      expect(r.totalCents).toBe(twd(t));
      expect(r.salesCents + r.taxCents).toBe(twd(t));
    }
  });
});

describe("混合報價", () => {
  it("combines both parts with one final rounding", () => {
    const d = taxDocument([
      { basis: "included", qty: 9, unitPriceCents: twd(380) },
      { basis: "excluded", qty: 2, unitPriceCents: twd(150) },
    ]);
    // 3,420 含稅 → 3,257.142857 未稅 + 300 未稅 = 3,557.14 → 3,557; 稅 162.857 + 15 = 177.86 → 178
    expect(d).toMatchObject({ basis: "mixed", salesCents: twd(3557), taxCents: twd(178), totalCents: twd(3735) });
  });
});
