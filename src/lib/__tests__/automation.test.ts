import { describe, expect, it } from "vitest";
import { parseRule, RULE_EXAMPLES, simulateRule } from "../automation";
import { twd } from "../money";
import { buildSeed } from "../seed";

const db = buildSeed();
const parse = (text: string) => {
  const r = parseRule(text, db);
  if (!r.ok) throw new Error(r.reply);
  return r;
};

describe("automation rules from plain language", () => {
  it("parses every example", () => {
    const [receipt, reorder, route, audit] = RULE_EXAMPLES.map(parse);
    expect(receipt).toMatchObject({ kind: "receipt_match", params: { toleranceCents: twd(10) } });
    expect(reorder.kind).toBe("reorder");
    expect(reorder.params.maxAmountCents).toBe(twd(5000));
    expect(reorder.params.productIds).toEqual(expect.arrayContaining(["P001", "P003"]));
    expect(reorder.params.productIds).not.toContain("P006"); // 素雞塊
    expect(route).toMatchObject({ kind: "route", params: { minSavedKm: 10 } });
    expect(audit).toMatchObject({ kind: "audit_flag", params: { maxTaxDiffCents: twd(1) } });
  });

  it("scopes a receipt rule to a named customer", () => {
    expect(parse("福記炸物店的收款完全相符就自動沖帳").params).toEqual({ toleranceCents: 0, customerId: "C01" });
  });

  it("asks for the workflow when it cannot tell", () => {
    expect(parseRule("每天早上提醒我喝水", db).ok).toBe(false);
  });

  it("simulates on today's data: handles the routine case, escalates the special ones", () => {
    for (const text of RULE_EXAMPLES) {
      const out = simulateRule(parse(text), db);
      console.log(`\n${text}\n${out.map((o) => `  ${o.decision === "auto" ? "自動" : "轉人工"}｜${o.subject}｜${o.detail}`).join("\n") || "  （目前沒有符合的事件）"}`);
    }
    const audit = simulateRule(parse(RULE_EXAMPLES[3]), db);
    expect(audit.find((o) => o.subject.includes("稅額不符"))?.decision).toBe("auto");
    expect(audit.find((o) => o.subject.includes("重複收款"))?.decision).toBe("escalate");
    const receipt = simulateRule(parse(RULE_EXAMPLES[0]), db);
    expect(receipt.some((o) => o.decision === "escalate")).toBe(true);
  });
});
