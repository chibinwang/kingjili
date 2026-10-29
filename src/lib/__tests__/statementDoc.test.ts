import { describe, expect, it } from "vitest";
import { applyStatementCommand, parseAmount, parseChineseNumber, parseDate } from "../domain/statementCommands";
import { buildStatementDoc, changedFields, docTotals, type StatementDoc } from "../domain/statementDoc";
import { buildStatement } from "../domain/statements";
import { twd } from "../money";
import { buildSeed } from "../seed";

const db = buildSeed();
const customer = db.customers.find((c) => c.id === "C01")!;
const st = buildStatement(customer, "2026-09", db.arDocs, db.payments, db.allocations, db.invoices);
const base = buildStatementDoc(customer, st, db.arDocs, { salesName: "吳佩珊", preparedBy: "張淑芬", approvedBy: "周筱汶" });

const run = (doc: StatementDoc, cmd: string) => {
  const r = applyStatementCommand(doc, base, cmd, "2026-09");
  if (!r.ok) throw new Error(`${cmd} → ${r.reply}`);
  return r.doc;
};

describe("statement document", () => {
  it("starts out equal to the ledger statement", () => {
    expect(docTotals(base).closingCents).toBe(st.totals.closingCents);
    expect(docTotals(base).chargesCents).toBe(st.totals.chargesCents);
    expect(docTotals(base).paymentsCents).toBe(st.totals.paymentsCents);
    expect(changedFields(base, base).size).toBe(0);
    expect(base.lines.some((l) => l.items?.length)).toBe(true);
  });
});

describe("parsers", () => {
  it("reads Chinese and Arabic amounts", () => {
    expect(parseChineseNumber("三千五百")).toBe(3500);
    expect(parseChineseNumber("兩萬")).toBe(20000);
    expect(parseAmount("折讓 1,200 元")).toBe(twd(1200));
    expect(parseAmount("折讓五百元")).toBe(twd(500));
    expect(parseAmount("1.2萬")).toBe(twd(12000));
    expect(parseAmount("第三筆")).toBeUndefined();
  });

  it("rolls a month before the period into the next year", () => {
    expect(parseDate("10/25", "2026-09")).toBe("2026-10-25");
    expect(parseDate("1月10日", "2026-12")).toBe("2027-01-10");
  });
});

describe("chat commands", () => {
  it("adds a credit line and lowers the amount due", () => {
    const doc = run(base, "新增一筆退貨折讓 500 元");
    expect(docTotals(doc).closingCents).toBe(docTotals(base).closingCents - twd(500));
    expect(doc.lines.find((l) => l.kind === "manual")).toMatchObject({ description: "退貨折讓", creditCents: twd(500) });
  });

  it("changes a line amount by index and by document number", () => {
    const first = base.lines[0];
    const byIndex = run(base, "第一筆金額改成 3,000");
    expect(byIndex.lines[0].debitCents).toBe(twd(3000));
    const byRef = run(base, `${first.refNo} 改成 2500 元`);
    expect(byRef.lines[0].debitCents).toBe(twd(2500));
    expect(changedFields(base, byRef).has(`line:${first.key}:debitCents`)).toBe(true);
  });

  it("removes and restores a line", () => {
    const removed = run(base, "刪除第 1 筆");
    expect(removed.lines).toHaveLength(base.lines.length - 1);
    const restored = run(removed, `還原 ${base.lines[0].refNo}`);
    expect(restored.lines).toHaveLength(base.lines.length);
    expect(docTotals(restored).closingCents).toBe(docTotals(base).closingCents);
  });

  it("moves the due date and edits text fields", () => {
    expect(run(base, "付款期限延後 5 天").dueDate).toBe("2026-10-30");
    expect(run(base, "付款期限改成 11/5").dueDate).toBe("2026-11-05");
    expect(run(base, "聯絡人改成 林德福先生").customer.contactName).toBe("林德福先生");
    expect(run(base, "地址改成「示範區中山路 3/5 號」").customer.address).toBe("示範區中山路 3/5 號");
    const noted = run(base, "備註加上：付款期限內匯款享 1% 折扣");
    expect(noted.note.endsWith("付款期限內匯款享 1% 折扣")).toBe(true);
    expect(noted.dueDate).toBe(base.dueDate);
  });

  it("toggles columns and resets everything", () => {
    const shown = run(base, "顯示品項明細");
    expect(shown.showItems).toBe(true);
    expect(run(shown, "全部還原")).toEqual(base);
  });

  it("explains what it could not do instead of guessing", () => {
    expect(applyStatementCommand(base, base, "第 99 筆刪除", "2026-09").ok).toBe(false);
    expect(applyStatementCommand(base, base, "新增一筆 300 元", "2026-09").ok).toBe(false);
    expect(applyStatementCommand(base, base, "今天天氣如何", "2026-09").ok).toBe(false);
  });
});
