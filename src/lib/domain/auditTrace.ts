import { formatTWD } from "../money";
import { periodRange } from "../time";
import { TERMS_LABEL } from "./ar";
import type { AuditInput, CheckId, CheckResult } from "./audit";
import { buildStatement } from "./statements";

/**
 * A step-by-step account of what the month-end audit looked at, built from the same data the audit used.
 * The review screen plays it back so people can follow the work instead of only seeing the verdict.
 */
export interface TraceStep {
  phase: "load" | "check" | "summary";
  check?: CheckId;
  customerId?: string;
  /** Who the line is about, e.g. 福記炸物店 */
  subject?: string;
  text: string;
  tone: "ok" | "warn" | "skip" | "info";
  /** Flags found at this step */
  flagIds: string[];
  /** Records looked at in this step, for the running "已檢視 N 筆" counter */
  examined: number;
}

export interface AuditTrace {
  steps: TraceStep[];
  totals: { customers: number; docs: number; payments: number; invoices: number; orders: number; records: number };
}

export function buildAuditTrace(input: AuditInput, results: CheckResult[]): AuditTrace {
  const { period, customers, docs, payments, allocations, invoices, orders, statements } = input;
  const { start, end } = periodRange(period);
  const inPeriod = (d: string) => d >= start && d <= end;
  const pDocs = docs.filter((d) => inPeriod(d.issueDate));
  const pPays = payments.filter((p) => inPeriod(p.collectedAt.slice(0, 10)));
  const pInvs = invoices.filter((i) => inPeriod(i.issueDate));
  const pOrders = orders.filter((o) => inPeriod(o.deliveryDate));
  const totals = { customers: customers.length, docs: pDocs.length, payments: pPays.length, invoices: pInvs.length, orders: pOrders.length, records: pDocs.length + pPays.length + pInvs.length + pOrders.length };
  const f = (c: number) => formatTWD(c);

  const steps: TraceStep[] = [
    {
      phase: "load",
      text: `讀取 ${totals.customers} 位客戶、${totals.docs} 張應收、${totals.payments} 筆收款、${totals.invoices} 張發票、${totals.orders} 筆訂單`,
      tone: "info",
      flagIds: [],
      examined: 0,
    },
  ];

  const perCustomer = new Map(
    customers.map((c) => {
      const cDocs = pDocs.filter((d) => d.customerId === c.id);
      return [
        c.id,
        {
          docs: cDocs,
          charges: cDocs.filter((d) => d.type === "charge"),
          pays: pPays.filter((p) => p.customerId === c.id),
          invs: pInvs.filter((i) => i.customerId === c.id),
          orders: pOrders.filter((o) => o.customerId === c.id),
          st: buildStatement(c, period, docs, payments, allocations, invoices),
          locked: statements.filter((s) => s.customerId === c.id && s.period === period && s.status !== "superseded").sort((a, b) => b.version - a.version)[0],
        },
      ];
    }),
  );

  for (const r of results) {
    for (const c of customers) {
      const d = perCustomer.get(c.id)!;
      const t = d.st.totals;
      const found = r.flags.filter((x) => x.customerId === c.id);
      const adj = t.debitAdjCents - t.creditAdjCents;
      const line = (text: string, examined: number, tone: TraceStep["tone"] = "ok"): TraceStep => ({ phase: "check", check: r.id, customerId: c.id, subject: c.name, text, tone, flagIds: [], examined });
      let step: TraceStep;
      switch (r.id) {
        case "cross_ledger":
          step = line(`期末 ${f(t.closingCents)} ＝ 應收子帳 ${f(d.st.ledgerClosingCents)}`, d.docs.length + d.pays.length);
          break;
        case "statement_math":
          step = line(`${f(t.openingCents)} ＋ ${f(t.chargesCents)}${adj ? ` ${adj > 0 ? "＋" : "−"} ${f(Math.abs(adj))}` : ""} − ${f(t.paymentsCents)} ＝ ${f(t.closingCents)}`, d.docs.length);
          break;
        case "duplicate_charge":
          step = d.charges.length ? line(`${d.charges.length} 張應收對應 ${new Set(d.charges.map((x) => x.sourceDeliveryId)).size} 張送貨單，無重複`, d.charges.length) : line("本期無出貨", 0, "skip");
          break;
        case "duplicate_payment":
          step = d.pays.length ? line(`${d.pays.length} 筆收款逐筆比對金額、方式、時間，無重複`, d.pays.length) : line("本期無收款", 0, "skip");
          break;
        case "unmatched_receipt":
          step = d.pays.length ? line(`${d.pays.length} 筆收款皆已沖帳`, d.pays.length) : line("本期無收款", 0, "skip");
          break;
        case "negative_balance":
          step = line(`期末 ${f(t.closingCents)}，非溢收`, 1);
          break;
        case "tax_mismatch":
          step = d.docs.length ? line(`${d.docs.length} 張單據稅額 ＝ 未稅 × 5%`, d.docs.length) : line("本期無單據", 0, "skip");
          break;
        case "cancelled_order_charged":
          step = d.orders.length ? line(`${d.orders.length} 筆訂單，無取消後仍請款`, d.orders.length) : line("本期無訂單", 0, "skip");
          break;
        case "missing_invoice":
          step = c.settlementTerms === "daily" ? line(`${d.charges.length} 張出貨皆已開立發票`, d.charges.length) : line(`${TERMS_LABEL[c.settlementTerms]}客戶月底彙開，略過`, 0, "skip");
          break;
        case "invoice_state":
          step = d.invs.length ? line(`${d.invs.length} 張發票狀態正常`, d.invs.length) : line("本期無發票", 0, "skip");
          break;
        case "locked_period_edit":
          step = d.locked ? line(`v${d.locked.version} 鎖定後無異動`, 1) : line("尚未鎖定，略過", 0, "skip");
          break;
      }
      if (found.length) {
        step.tone = "warn";
        step.text = found.map((x) => x.title).join("；");
        step.flagIds = found.map((x) => x.id);
      }
      steps.push(step);
    }
  }

  const flagCount = results.reduce((n, r) => n + r.flags.length, 0);
  steps.push({
    phase: "summary",
    text: flagCount ? `完成 ${results.length} 項檢查，發現 ${flagCount} 個需要人員確認的問題` : `完成 ${results.length} 項檢查，全部通過`,
    tone: flagCount ? "warn" : "ok",
    flagIds: [],
    examined: 0,
  });
  return { steps, totals };
}

