import { docRemaining, paymentUnapplied } from "./domain/ar";
import { CHECK_META, type CheckId } from "./domain/audit";
import { parseAmount } from "./domain/statementCommands";
import type { Db } from "./db";
import { formatTWD, type Cents } from "./money";
import { auditFor, maps, routeView, stockPositions } from "./selectors";
import { DEMO_TODAY, periodOf } from "./time";

/**
 * Automation rules written in plain language, e.g. 「收款跟應收差 10 元以內就自動沖帳」.
 * A rule names a trigger, the conditions under which the agent may act alone, and escalates everything else.
 * The demo only simulates: it shows what a rule would do with today's data and never writes to the ledger.
 */
export type RuleKind = "receipt_match" | "reorder" | "route" | "audit_flag";

export interface RuleParams {
  /** receipt_match: allowed gap between receipt and open AR */
  toleranceCents?: Cents;
  /** receipt_match: limit to one customer */
  customerId?: string;
  /** reorder: largest purchase order the rule may draft alone */
  maxAmountCents?: Cents;
  /** reorder: limit to these products */
  productIds?: string[];
  /** route: minimum distance saved before a change is applied */
  minSavedKm?: number;
  /** audit_flag: largest tax difference fixed with a correction note */
  maxTaxDiffCents?: Cents;
}

export interface AutomationRule {
  id: string;
  text: string;
  kind: RuleKind;
  params: RuleParams;
  enabled: boolean;
  createdAt: string;
  createdBy: string;
}

export const RULE_KIND_LABEL: Record<RuleKind, string> = {
  receipt_match: "收款沖帳",
  reorder: "自動補貨",
  route: "路線調整",
  audit_flag: "對帳審查旗標",
};

export const RULE_EXAMPLES = [
  "收款跟應收差 10 元以內就自動沖帳，其他交給我",
  "冷凍雞塊、薯條低於補貨點時自動叫貨，金額 5,000 元以內不用問我",
  "路線調整能省 10 公里以上、所有車都準時就直接套用",
  "稅額只差 1 元的旗標自動開更正單，其他旗標都要給我看",
];

type ParseResult = { ok: true; kind: RuleKind; params: RuleParams } | { ok: false; reply: string };

export function parseRule(text: string, db: Pick<Db, "customers" | "products">): ParseResult {
  const t = text.trim();
  if (!t) return { ok: false, reply: "請用一句話描述規則。" };
  const kind: RuleKind | undefined = /稅額|旗標|審查|更正/.test(t) ? "audit_flag" : /沖帳|沖抵|收款|匯款|入帳/.test(t) ? "receipt_match" : /補貨|叫貨|採購|進貨|庫存/.test(t) ? "reorder" : /路線|換車|排車|改車|改派/.test(t) ? "route" : undefined;
  if (!kind) return { ok: false, reply: "目前規則可以處理：收款沖帳、自動補貨、路線調整、對帳審查旗標。請說明是哪一種流程，以及什麼情況下可以自動處理。" };

  const amount = parseAmount(t.replace(/(\d+(?:\.\d+)?)\s*(公里|km)/gi, " "));
  switch (kind) {
    case "receipt_match": {
      const c = db.customers.find((x) => t.includes(x.name));
      return { ok: true, kind, params: { toleranceCents: amount ?? 0, customerId: c?.id } };
    }
    case "reorder": {
      // full names first, then short names (「薯條」) in what is left, so 冷凍雞塊 doesn't also pick up 素雞塊
      const full = db.products.filter((p) => t.includes(p.name));
      const rest = full.reduce((s, p) => s.replaceAll(p.name, ""), t);
      const productIds = [...full, ...db.products.filter((p) => !full.includes(p) && rest.includes(p.name.slice(-2)))].map((p) => p.id);
      return { ok: true, kind, params: { maxAmountCents: amount, productIds: productIds.length ? productIds : undefined } };
    }
    case "route": {
      const km = t.match(/(\d+(?:\.\d+)?)\s*(?:公里|km)/i);
      return { ok: true, kind, params: { minSavedKm: km ? Number(km[1]) : 0 } };
    }
    case "audit_flag":
      return { ok: true, kind, params: { maxTaxDiffCents: amount ?? 100 } };
  }
}

/** The rule as four plain lines: when / only if / then / otherwise. */
export function describeRule(rule: Pick<AutomationRule, "kind" | "params">, db: Pick<Db, "customers" | "products">): { when: string; condition: string; action: string; escalate: string } {
  const p = rule.params;
  switch (rule.kind) {
    case "receipt_match": {
      const c = p.customerId ? db.customers.find((x) => x.id === p.customerId)?.name : undefined;
      return {
        when: `${c ?? "任何客戶"}有未沖帳的收款`,
        condition: p.toleranceCents ? `收款與某張未收應收相差 ${formatTWD(p.toleranceCents)} 以內` : "收款與某張未收應收金額完全相同",
        action: "自動沖抵該張應收，寫入操作紀錄",
        escalate: "找不到相符的應收、差額過大，或一筆收款對到多張單據",
      };
    }
    case "reorder": {
      const names = p.productIds?.map((id) => db.products.find((x) => x.id === id)?.name).filter(Boolean).join("、");
      return {
        when: `${names || "任何品項"}預估可用量低於補貨點`,
        condition: `供應商已核准、有成本資料${p.maxAmountCents ? `，且叫貨金額 ${formatTWD(p.maxAmountCents)} 以內` : ""}`,
        action: "自動建立叫貨單（依建議量取整箱）",
        escalate: "超過金額上限、供應商未核准或缺成本資料",
      };
    }
    case "route":
      return {
        when: "AI 找到可改善今日路線的換車方案",
        condition: `${p.minSavedKm ? `可省 ${p.minSavedKm} 公里以上，且` : ""}兩車載重、時段、工時全部符合`,
        action: "自動套用新路線，理貨單同步更新",
        escalate: "有任何限制不符，或節省距離未達門檻",
      };
    case "audit_flag":
      return {
        when: "月結審查產生旗標",
        condition: `「稅額不符」且差額 ${formatTWD(p.maxTaxDiffCents ?? 100)} 以內`,
        action: "自動開立稅額更正單（原單保留）",
        escalate: "其他所有旗標（重複收款、溢收、發票退回…）一律交給人員",
      };
  }
}

export interface RuleOutcome {
  subject: string;
  decision: "auto" | "escalate";
  detail: string;
  href: string;
}

/** What the rule would do right now. Read-only. */
export function simulateRule(rule: Pick<AutomationRule, "kind" | "params">, db: Db): RuleOutcome[] {
  const p = rule.params;
  const m = maps(db);
  switch (rule.kind) {
    case "receipt_match": {
      const tol = p.toleranceCents ?? 0;
      return db.payments
        .filter((x) => x.grossCents > 0 && !x.reversalOf && (!p.customerId || x.customerId === p.customerId) && paymentUnapplied(x, db.allocations) > 0)
        .map((x) => {
          const c = m.customers.get(x.customerId)!;
          const unapplied = paymentUnapplied(x, db.allocations);
          const open = db.arDocs.filter((d) => d.customerId === x.customerId && docRemaining(d, db.allocations) > 0);
          const ranked = open.map((d) => ({ d, gap: Math.abs(docRemaining(d, db.allocations) - unapplied) })).sort((a, b) => a.gap - b.gap);
          const href = `/customers?id=${c.id}`;
          const subject = `${c.name} ${x.no}（${formatTWD(unapplied)}）`;
          if (!ranked.length) return { subject, decision: "escalate", detail: "此客戶沒有未收應收，可能是重複收款或預收", href };
          const best = ranked[0];
          const ties = ranked.filter((r) => r.gap === best.gap).length;
          if (best.gap <= tol && ties === 1) return { subject, decision: "auto", detail: `沖抵 ${best.d.no}${best.gap ? `（差 ${formatTWD(best.gap)}）` : "（金額相同）"}`, href };
          if (best.gap <= tol) return { subject, decision: "escalate", detail: `有 ${ties} 張應收都相符，需人工決定沖哪一張`, href };
          return { subject, decision: "escalate", detail: `最接近的 ${best.d.no} 差 ${formatTWD(best.gap)}，超過 ${formatTWD(tol)}`, href };
        });
    }
    case "reorder": {
      const pos = stockPositions(db);
      return db.products
        .filter((x) => pos.get(x.id)!.belowReorder && (!p.productIds || p.productIds.includes(x.id)))
        .map((x) => {
          const s = pos.get(x.id)!;
          const sup = m.suppliers.get(x.supplierId);
          const qty = `${s.suggestedQty / x.packSize} ${x.packUnit}`;
          const subject = `${x.name} 叫貨 ${qty}`;
          const href = "/procurement";
          if (!sup?.approved) return { subject, decision: "escalate", detail: `供應商 ${sup?.name ?? "未知"} 尚未核准`, href };
          if (x.costCents === null) return { subject, decision: "escalate", detail: "尚無成本資料，無法估算金額", href };
          const cost = x.costCents * s.suggestedQty;
          if (p.maxAmountCents && cost > p.maxAmountCents) return { subject, decision: "escalate", detail: `金額 ${formatTWD(cost)} 超過上限 ${formatTWD(p.maxAmountCents)}`, href };
          return { subject, decision: "auto", detail: `向 ${sup.name} 叫貨，${formatTWD(cost)}`, href };
        });
    }
    case "route": {
      const view = routeView(db);
      const s = view?.suggestion;
      if (!view || !s) return [];
      const c = m.customers.get(s.customerId)!;
      const saved = view.evaluation.totalKm - s.after.totalKm;
      const failed = [...s.after.constraints.A, ...s.after.constraints.B].filter((x) => !x.pass);
      const subject = `${c.name} 由 ${s.from} 車改至 ${s.to} 車`;
      const href = "/dispatch";
      if (failed.length) return [{ subject, decision: "escalate", detail: `限制不符：${failed.map((x) => x.label).join("、")}`, href }];
      if (saved < (p.minSavedKm ?? 0)) return [{ subject, decision: "escalate", detail: `只省 ${saved.toFixed(1)} 公里，未達 ${p.minSavedKm} 公里`, href }];
      return [{ subject, decision: "auto", detail: `省 ${saved.toFixed(1)} 公里，所有限制符合`, href }];
    }
    case "audit_flag": {
      const max = p.maxTaxDiffCents ?? 100;
      return auditFor(db, periodOf(DEMO_TODAY))
        .flatMap((r) => r.flags)
        .map((f) => {
          const href = "/accounting?tab=review";
          const diff = Math.abs(f.amountCents ?? 0);
          if (f.check === "tax_mismatch" && diff <= max) return { subject: f.title, decision: "auto", detail: `差 ${formatTWD(diff)}，開立稅額更正單`, href };
          if (f.check === "tax_mismatch") return { subject: f.title, decision: "escalate", detail: `差 ${formatTWD(diff)}，超過 ${formatTWD(max)}`, href };
          return { subject: f.title, decision: "escalate", detail: `「${CHECK_META[f.check as CheckId].label}」不在規則範圍，需人工判斷`, href };
        });
    }
  }
}
