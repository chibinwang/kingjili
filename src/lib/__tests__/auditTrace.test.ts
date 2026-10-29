import { describe, expect, it } from "vitest";
import { runMonthEndAudit, type AuditInput } from "../domain/audit";
import { buildAuditTrace } from "../domain/auditTrace";
import { buildSeed } from "../seed";

const db = buildSeed();
const input = (period: string): AuditInput => ({ period, customers: db.customers, docs: db.arDocs, payments: db.payments, allocations: db.allocations, invoices: db.invoices, orders: db.orders, statements: db.statements, events: db.events });

describe("audit trace", () => {
  for (const period of ["2026-10", "2026-09"]) {
    it(`covers every check × customer and every flag (${period})`, () => {
      const results = runMonthEndAudit(input(period));
      const { steps, totals } = buildAuditTrace(input(period), results);
      expect(steps[0].phase).toBe("load");
      expect(steps.at(-1)!.phase).toBe("summary");
      expect(steps.filter((s) => s.phase === "check")).toHaveLength(results.length * db.customers.length);

      const flagIds = results.flatMap((r) => r.flags.map((f) => f.id)).sort();
      expect(steps.flatMap((s) => s.flagIds).sort()).toEqual(flagIds);
      for (const s of steps) if (s.flagIds.length) expect(s.tone).toBe("warn");
      expect(totals.records).toBeGreaterThan(0);
    });
  }

  it("shows real figures, e.g. the statement closing per customer", () => {
    const { steps } = buildAuditTrace(input("2026-10"), runMonthEndAudit(input("2026-10")));
    const fuji = steps.find((s) => s.check === "cross_ledger" && s.customerId === "C01")!;
    expect(fuji.text).toMatch(/^期末 NT\$[\d,]+ ＝ 應收子帳 NT\$[\d,]+$/);
  });
});
