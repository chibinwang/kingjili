import { describe, expect, it } from "vitest";
import { addCustomerNote, type ActCtx } from "../actions";
import { tenureLabel, tenureMonths } from "../domain/crm";
import type { Db } from "../db";
import { crmRows } from "../selectors";
import { buildSeed } from "../seed";

const as = (db: Db, role: string): ActCtx => {
  const u = db.users.find((x) => x.role === role)!;
  return { actor: { id: u.id, name: u.name, type: "user", user: u }, now: "2026-10-24T09:00:00+08:00" };
};
const agent: ActCtx = { actor: { id: "agent", name: "AI", type: "agent" }, now: "2026-10-24T09:00:00+08:00" };

describe("CRM", () => {
  it("counts whole months of tenure", () => {
    expect(tenureMonths("2019-03-15", "2026-10-24")).toBe(91);
    expect(tenureMonths("2026-07-25", "2026-10-24")).toBe(2);
    expect(tenureMonths("2026-10-24", "2026-10-24")).toBe(0);
    expect(tenureLabel(91)).toBe("7 年 7 個月");
    expect(tenureLabel(24)).toBe("2 年");
    expect(tenureLabel(3)).toBe("3 個月");
    expect(tenureLabel(0)).toBe("未滿 1 個月");
  });

  it("every customer is a 餐廳 or 炸物店 with an owner, phone and onboarding date", () => {
    const db = buildSeed();
    expect(db.customers).toHaveLength(12);
    expect(db.customers.filter((c) => c.segment === "炸物店").map((c) => c.id)).toEqual(["C01", "C03", "C07", "C12"]);
    for (const c of db.customers) {
      expect(c.ownerName).toBeTruthy();
      expect(c.phone).toBeTruthy();
      expect(c.onboardedAt < "2026-08-01").toBe(true);
    }
  });

  it("flags customers with overdue balances as needing attention", () => {
    const db = buildSeed();
    const rows = crmRows(db);
    const attention = rows.filter((r) => r.status === "attention");
    expect(attention.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.status === "attention").toBe(r.reasons.length > 0);
    expect(rows.find((r) => r.customerId === "C10")!.reasons).toContain("有逾期帳款");
    for (const r of rows) expect(r.weekly).toHaveLength(8);
  });

  it("notes add a follow-up and an audit event; drivers and the AI cannot write them", () => {
    const db = buildSeed();
    const next = addCustomerNote(db, as(db, "sales"), { customerId: "C12", kind: "call", text: "詢問雞米花新報價", followUpOn: "2026-10-30" });
    expect(crmRows(next).find((r) => r.customerId === "C12")!.nextFollowUp).toBe("2026-10-30");
    expect(next.events.at(-1)!.feature).toBe("crm");
    expect(() => addCustomerNote(db, as(db, "driver"), { customerId: "C12", kind: "note", text: "x" })).toThrow(/權限/);
    expect(() => addCustomerNote(db, agent, { customerId: "C12", kind: "note", text: "x" })).toThrow(/AI/);
    expect(() => addCustomerNote(db, as(db, "sales"), { customerId: "C12", kind: "note", text: "  " })).toThrow();
    expect(() => addCustomerNote(db, as(db, "sales"), { customerId: "C12", kind: "note", text: "x", followUpOn: "2026-10-01" })).toThrow(/追蹤日/);
  });
});
