import { taxOnExclusive, type Cents, type TaxPolicy, DEFAULT_TAX_POLICY } from "../money";
import { periodRange } from "../time";
import { customerBalance, customerBalanceViaAllocations, isReversed, paymentUnapplied } from "./ar";
import { buildStatement } from "./statements";
import type { ActionEvent, ArDocument, Customer, Payment, PaymentAllocation, SalesOrder, Statement, TaxInvoice } from "./types";

/**
 * 全月審查 — deterministic validators. These decide pass/fail.
 * The AI layer may only explain a flag and propose a next step that a human approves.
 */
export type CheckId =
  | "cross_ledger"
  | "statement_math"
  | "duplicate_charge"
  | "duplicate_payment"
  | "unmatched_receipt"
  | "negative_balance"
  | "tax_mismatch"
  | "cancelled_order_charged"
  | "missing_invoice"
  | "invoice_state"
  | "locked_period_edit";

export interface AuditFlag {
  id: string;
  check: CheckId;
  severity: "high" | "medium";
  customerId: string;
  title: string;
  detail: string;
  refs: { type: "ar" | "payment" | "invoice" | "order" | "statement" | "event"; id: string; no: string }[];
  amountCents?: Cents;
}

export interface CheckResult {
  id: CheckId;
  label: string;
  description: string;
  flags: AuditFlag[];
}

export const CHECK_META: Record<CheckId, { label: string; description: string }> = {
  cross_ledger: { label: "跨帳一致", description: "對帳單期末 = 應收子帳（文件 − 收款）= 沖帳明細推算" },
  statement_math: { label: "對帳公式", description: "期初 + 出貨 + 借項 − 貸項 − 收款 = 期末" },
  duplicate_charge: { label: "重複請款", description: "同一送貨單產生兩張以上應收" },
  duplicate_payment: { label: "重複收款", description: "同客戶、同金額、同方式、同送貨單於 30 分鐘內重複登錄" },
  unmatched_receipt: { label: "未沖帳收款", description: "收款尚有金額未對應任何應收文件" },
  negative_balance: { label: "負餘額", description: "客戶期末為溢收（公司欠客戶）" },
  tax_mismatch: { label: "稅額不符", description: "稅額 ≠ 未稅 × 5%（四捨五入至元），或含稅 ≠ 未稅 + 稅" },
  cancelled_order_charged: { label: "取消單仍請款", description: "訂單已取消但仍有出貨應收" },
  missing_invoice: { label: "缺發票", description: "日結客戶的出貨應收未對應電子發票" },
  invoice_state: { label: "發票狀態", description: "發票被退回或卡在待送狀態" },
  locked_period_edit: { label: "鎖帳後異動", description: "對帳單鎖定後，該期間仍有新增或修改" },
};

export interface AuditInput {
  period: string;
  customers: Customer[];
  docs: ArDocument[];
  payments: Payment[];
  allocations: PaymentAllocation[];
  invoices: TaxInvoice[];
  orders: SalesOrder[];
  statements: Statement[];
  events: ActionEvent[];
  policy?: TaxPolicy;
}

export function runMonthEndAudit(input: AuditInput): CheckResult[] {
  const { period, customers, docs, payments, allocations, invoices, orders, statements, events } = input;
  const policy = input.policy ?? DEFAULT_TAX_POLICY;
  const { start, end } = periodRange(period);
  const inPeriod = (d: string) => d >= start && d <= end;
  const pDocs = docs.filter((d) => inPeriod(d.issueDate));
  const pPays = payments.filter((p) => inPeriod(p.collectedAt.slice(0, 10)));
  const byId = new Map(customers.map((c) => [c.id, c]));
  const results: Record<CheckId, AuditFlag[]> = {
    cross_ledger: [],
    statement_math: [],
    duplicate_charge: [],
    duplicate_payment: [],
    unmatched_receipt: [],
    negative_balance: [],
    tax_mismatch: [],
    cancelled_order_charged: [],
    missing_invoice: [],
    invoice_state: [],
    locked_period_edit: [],
  };
  let n = 0;
  const flag = (f: Omit<AuditFlag, "id">) => results[f.check].push({ ...f, id: `${f.check}-${++n}` });

  for (const c of customers) {
    const st = buildStatement(c, period, docs, payments, allocations, invoices);
    const viaAlloc = customerBalanceViaAllocations(
      c.id,
      docs.filter((d) => d.issueDate <= end),
      payments.filter((p) => p.collectedAt.slice(0, 10) <= end),
      allocations.filter((a) => a.at.slice(0, 10) <= end),
    );
    const ledger = customerBalance(c.id, docs, payments, end);
    if (st.totals.closingCents !== ledger || viaAlloc !== ledger) {
      flag({
        check: "cross_ledger",
        severity: "high",
        customerId: c.id,
        title: `${c.name} 帳務不一致`,
        detail: `對帳單 ${st.totals.closingCents / 100}／子帳 ${ledger / 100}／沖帳推算 ${viaAlloc / 100}`,
        refs: [],
      });
    }
    if (!st.reconciles) {
      flag({ check: "statement_math", severity: "high", customerId: c.id, title: `${c.name} 對帳公式不平`, detail: "期末與逐筆累計不一致", refs: [] });
    }
    if (st.totals.closingCents < 0) {
      flag({
        check: "negative_balance",
        severity: "medium",
        customerId: c.id,
        title: `${c.name} 期末溢收`,
        detail: `期末餘額為負，客戶有 NT$${(-st.totals.closingCents / 100).toLocaleString()} 溢付款`,
        refs: [],
        amountCents: st.totals.closingCents,
      });
    }
  }

  // duplicate charges: two charge docs for the same delivery
  const byDelivery = new Map<string, ArDocument[]>();
  for (const d of pDocs.filter((x) => x.type === "charge" && x.sourceDeliveryId)) {
    byDelivery.set(d.sourceDeliveryId!, [...(byDelivery.get(d.sourceDeliveryId!) ?? []), d]);
  }
  for (const [, ds] of byDelivery) {
    if (ds.length > 1 && ds.filter((d) => !d.voidedBy).length > 1) {
      flag({
        check: "duplicate_charge",
        severity: "high",
        customerId: ds[0].customerId,
        title: `${byId.get(ds[0].customerId)?.name} 同一送貨單重複請款`,
        detail: ds.map((d) => d.no).join("、"),
        refs: ds.map((d) => ({ type: "ar" as const, id: d.id, no: d.no })),
        amountCents: ds[1].totalCents,
      });
    }
  }

  // duplicate payments
  const live = pPays.filter((p) => !p.reversalOf && !isReversed(p, payments));
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      const gap = Math.abs(Date.parse(a.collectedAt) - Date.parse(b.collectedAt)) / 60000;
      if (a.customerId === b.customerId && a.grossCents === b.grossCents && a.method === b.method && a.deliveryId && a.deliveryId === b.deliveryId && gap <= 30) {
        flag({
          check: "duplicate_payment",
          severity: "high",
          customerId: a.customerId,
          title: `${byId.get(a.customerId)?.name} 疑似重複收款`,
          detail: `${a.no} 與 ${b.no} 金額、方式、送貨單相同，相隔 ${Math.round(gap)} 分鐘`,
          refs: [
            { type: "payment", id: a.id, no: a.no },
            { type: "payment", id: b.id, no: b.no },
          ],
          amountCents: b.grossCents,
        });
      }
    }
  }

  // unmatched receipts
  for (const p of pPays.filter((x) => !x.reversalOf && !isReversed(x, payments))) {
    const un = paymentUnapplied(p, allocations);
    if (un > 0) {
      flag({
        check: "unmatched_receipt",
        severity: "medium",
        customerId: p.customerId,
        title: `${byId.get(p.customerId)?.name} 收款未沖帳`,
        detail: `${p.no} 尚有 NT$${(un / 100).toLocaleString()} 未對應應收${p.note ? `（備註：${p.note}）` : ""}`,
        refs: [{ type: "payment", id: p.id, no: p.no }],
        amountCents: un,
      });
    }
  }

  // tax
  for (const d of pDocs.filter((x) => !x.correctsDocId)) {
    // A correction document nets against the original: (original ± corrections) must satisfy the policy.
    const corrections = docs.filter((x) => x.correctsDocId === d.id);
    const netEx = d.exTaxCents + corrections.reduce((a, x) => a + (x.type === "credit_note" ? -x.exTaxCents : x.exTaxCents), 0);
    const netTax = d.taxCents + corrections.reduce((a, x) => a + (x.type === "credit_note" ? -x.taxCents : x.taxCents), 0);
    const expected = taxOnExclusive(netEx, policy);
    if (netTax !== expected || d.totalCents !== d.exTaxCents + d.taxCents) {
      flag({
        check: "tax_mismatch",
        severity: "high",
        customerId: d.customerId,
        title: `${byId.get(d.customerId)?.name} 稅額不符`,
        detail: `${d.no} 未稅 ${d.exTaxCents / 100}，稅額應為 ${expected / 100}，實際 ${d.taxCents / 100}`,
        refs: [{ type: "ar", id: d.id, no: d.no }],
        amountCents: netTax - expected,
      });
    }
  }

  // cancelled orders still charged
  const orderById = new Map(orders.map((o) => [o.id, o]));
  for (const d of pDocs.filter((x) => x.type === "charge" && x.sourceOrderId && !x.voidedBy)) {
    if (orderById.get(d.sourceOrderId!)?.state === "Cancelled") {
      flag({
        check: "cancelled_order_charged",
        severity: "high",
        customerId: d.customerId,
        title: `${byId.get(d.customerId)?.name} 已取消訂單仍請款`,
        detail: `${d.no} 對應訂單已取消`,
        refs: [{ type: "ar", id: d.id, no: d.no }],
      });
    }
  }

  // invoices
  for (const d of pDocs.filter((x) => x.type === "charge")) {
    const c = byId.get(d.customerId);
    if (c?.settlementTerms !== "daily") continue;
    if (!invoices.some((i) => i.sourceArIds.includes(d.id) && i.providerStatus !== "voided")) {
      flag({
        check: "missing_invoice",
        severity: "medium",
        customerId: d.customerId,
        title: `${c.name} 出貨未開發票`,
        detail: `${d.no}（${d.issueDate}）未對應電子發票`,
        refs: [{ type: "ar", id: d.id, no: d.no }],
      });
    }
  }
  for (const inv of invoices.filter((i) => i.period === period && (i.providerStatus === "rejected" || i.providerStatus === "preflight_failed"))) {
    flag({
      check: "invoice_state",
      severity: "medium",
      customerId: inv.customerId,
      title: `${inv.buyerName} 發票${inv.providerStatus === "rejected" ? "被退回" : "預檢未過"}`,
      detail: inv.rejectReason ?? "",
      refs: [{ type: "invoice", id: inv.id, no: inv.invoiceNo ?? inv.id }],
    });
  }

  // edits after lock
  for (const s of statements.filter((x) => x.period === period && x.status !== "superseded")) {
    const after = events.filter(
      (e) =>
        e.occurredAt > s.lockedAt &&
        (e.feature === "ar" || e.feature === "statements") &&
        e.status === "committed" &&
        e.entityType !== "Statement" &&
        e.scope?.customerId === s.customerId &&
        e.scope?.period === period,
    );
    for (const e of after) {
      flag({
        check: "locked_period_edit",
        severity: "high",
        customerId: s.customerId,
        title: `${byId.get(s.customerId)?.name} 鎖帳後有異動`,
        detail: `${e.summary}（${e.occurredAt.slice(5, 16).replace("T", " ")}）`,
        refs: [
          { type: "statement", id: s.id, no: `v${s.version}` },
          { type: "event", id: e.id, no: `#${e.seq}` },
        ],
      });
    }
  }

  return (Object.keys(results) as CheckId[]).map((id) => ({ id, ...CHECK_META[id], flags: results[id] }));
}
