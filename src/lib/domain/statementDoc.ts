import { sum, type Cents } from "../money";
import { addDays, DEMO_TODAY } from "../time";
import { TERMS_LABEL } from "./ar";
import type { StatementPreview } from "./statements";
import type { ArDocument, ArLineItem, Customer, StatementLine } from "./types";

/**
 * The customer-facing 月結對帳單 as an editable document.
 * It starts as a copy of the ledger statement; edits change only this document, never the ledger.
 * The editor compares the document's closing balance with the ledger and warns when they differ.
 */
export interface DocLine {
  /** refId for ledger lines, `m-<n>` for lines added by hand */
  key: string;
  kind: StatementLine["refType"] | "manual";
  date: string;
  refNo: string;
  description: string;
  invoiceNo?: string;
  debitCents: Cents;
  creditCents: Cents;
  items?: ArLineItem[];
}

export interface StatementDoc {
  title: string;
  docNo: string;
  issueDate: string;
  dueDate: string;
  terms: string;
  customer: { name: string; taxId: string; contactName: string; phone: string; address: string };
  openingCents: Cents;
  lines: DocLine[];
  bank: { bankName: string; accountName: string; accountNo: string };
  note: string;
  preparedBy: string;
  approvedBy: string;
  showItems: boolean;
  showInvoice: boolean;
}

export const COMPANY = {
  name: "金吉利食品有限公司",
  tagline: "冷凍食品批發・餐飲通路配送",
  address: "示範區倉儲路 88 號",
  phone: "02-0000-0000",
};

/** `st` is the live preview or a locked snapshot (pass its `version`). */
export function buildStatementDoc(
  customer: Customer,
  st: Pick<StatementPreview, "period" | "end" | "totals" | "lines"> & { version?: number },
  docs: ArDocument[],
  people: { salesName: string; preparedBy: string; approvedBy: string },
): StatementDoc {
  const byId = new Map(docs.map((d) => [d.id, d]));
  return {
    title: "月結對帳單",
    docNo: `ST-${st.period.replace("-", "")}-${customer.code}${st.version ? `-v${st.version}` : ""}`,
    issueDate: st.end < DEMO_TODAY ? addDays(st.end, 1) : DEMO_TODAY,
    dueDate: addDays(st.end, 25),
    terms: TERMS_LABEL[customer.settlementTerms],
    customer: { name: customer.name, taxId: customer.taxId ?? "", contactName: customer.billingContact, phone: customer.phone, address: customer.address },
    openingCents: st.totals.openingCents,
    lines: st.lines
      .filter((l) => l.refType !== "opening")
      .map((l) => ({
        key: l.refId,
        kind: l.refType,
        date: l.date,
        refNo: l.refNo,
        description: l.description,
        invoiceNo: l.invoiceNo,
        debitCents: l.debitCents,
        creditCents: l.creditCents,
        items: byId.get(l.refId)?.items,
      })),
    bank: { bankName: "示範銀行（000）示範分行", accountName: COMPANY.name, accountNo: "000-00-000000-0" },
    note: `如對帳內容有疑問，請於收到後 7 日內與業務 ${people.salesName}（${COMPANY.phone}）聯繫。本對帳單非統一發票，發票另行開立。`,
    preparedBy: people.preparedBy,
    approvedBy: people.approvedBy,
    showItems: false,
    showInvoice: true,
  };
}

/** opening + charges + adjustments − payments = closing */
export interface DocTotals {
  openingCents: Cents;
  chargesCents: Cents;
  /** debit notes minus credit notes / write-offs / lines added by hand as credits */
  adjustmentsCents: Cents;
  paymentsCents: Cents;
  closingCents: Cents;
  /** running balance after each line, same order as doc.lines */
  balances: Cents[];
}

export function docTotals(doc: StatementDoc): DocTotals {
  let running = doc.openingCents;
  const balances = doc.lines.map((l) => (running += l.debitCents - l.creditCents));
  const net = (ls: DocLine[]) => sum(ls.map((l) => l.debitCents - l.creditCents));
  return {
    openingCents: doc.openingCents,
    chargesCents: net(doc.lines.filter((l) => l.kind === "charge")),
    adjustmentsCents: net(doc.lines.filter((l) => l.kind !== "charge" && l.kind !== "payment")),
    paymentsCents: -net(doc.lines.filter((l) => l.kind === "payment")),
    closingCents: running,
    balances,
  };
}

/** Dotted paths of the fields that differ from the ledger copy, e.g. "dueDate", "line:ar-1:debitCents", "line:m-1". */
export function changedFields(base: StatementDoc, doc: StatementDoc): Set<string> {
  const out = new Set<string>();
  const scalar = ["title", "issueDate", "dueDate", "note", "preparedBy", "approvedBy", "openingCents"] as const;
  for (const k of scalar) if (base[k] !== doc[k]) out.add(k);
  for (const k of Object.keys(base.customer) as (keyof StatementDoc["customer"])[]) if (base.customer[k] !== doc.customer[k]) out.add(`customer.${k}`);
  for (const k of Object.keys(base.bank) as (keyof StatementDoc["bank"])[]) if (base.bank[k] !== doc.bank[k]) out.add(`bank.${k}`);
  const baseLines = new Map(base.lines.map((l) => [l.key, l]));
  for (const l of doc.lines) {
    const b = baseLines.get(l.key);
    if (!b) {
      out.add(`line:${l.key}`);
      continue;
    }
    for (const f of ["date", "description", "debitCents", "creditCents"] as const) if (b[f] !== l[f]) out.add(`line:${l.key}:${f}`);
  }
  const kept = new Set(doc.lines.map((l) => l.key));
  for (const l of base.lines) if (!kept.has(l.key)) out.add(`removed:${l.key}`);
  return out;
}
