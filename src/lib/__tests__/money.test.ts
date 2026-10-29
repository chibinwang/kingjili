import { describe, expect, it } from "vitest";
import { assertCents, lineAmount, roundToUnit, splitInclusive, taxOnExclusive, twd } from "../money";

describe("money (integer cents)", () => {
  it("rejects non-integer cents", () => {
    expect(() => assertCents(10.5)).toThrow();
    expect(() => lineAmount(1.5, 100)).toThrow();
  });

  it("rounds tax half-up to whole TWD with integer math", () => {
    expect(taxOnExclusive(twd(3708))).toBe(twd(185)); // 185.4 → 185
    expect(taxOnExclusive(twd(3710))).toBe(twd(186)); // 185.5 → 186
    expect(taxOnExclusive(twd(10))).toBe(twd(1)); // 0.5 → 1
    expect(taxOnExclusive(twd(-3710))).toBe(-twd(186));
  });

  it("splits tax-inclusive totals so parts always add back", () => {
    for (const whole of [1, 21, 105, 999, 1050, 123457]) {
      const { exTax, tax } = splitInclusive(twd(whole));
      expect(exTax + tax).toBe(twd(whole));
      expect(exTax % 100).toBe(0);
    }
    expect(splitInclusive(twd(1050))).toEqual({ exTax: twd(1000), tax: twd(50) });
  });

  it("roundToUnit handles negatives symmetrically", () => {
    expect(roundToUnit(150, 100)).toBe(200);
    expect(roundToUnit(-150, 100)).toBe(-200);
    expect(roundToUnit(149, 100)).toBe(100);
  });
});
