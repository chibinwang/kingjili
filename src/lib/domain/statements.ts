import { sum, type Cents } from "../money";
import { addDays, periodRange } from "../time";
import { appliedTo, customerBalance, DOC_LABEL, METHOD_LABEL } from "./ar";
import type { ArDocument, Customer, Payment, PaymentAllocation, StatementLine, StatementTotals, TaxInvoice } from "./types";

/**
 * Monthly statement (對帳單):
 *   opening + charges + debit adjustments − credit adjustments − payments = closing
 * Every line cross-references the delivery note / AR document / invoice / payment.
 * A statement is NOT a tax invoice; invoice VAT is tracked on TaxInvoice separately.
 */
export interface StatementPreview {
  customerId: string;
  period: string;
  start: string;
  end: string;
  totals: StatementTotals;
  lines: StatementLine[];
  /** closing recomputed straight from the ledger at period end — must equal totals.closingCents */
  ledgerClosingCents: Cents;
  reconciles: boolean;
  deliveryCount: number;
}

export function buildStatement(
  customer: Customer,
  period: string,
  docs: ArDocument[],
  payments: Payment[],
  allocations: PaymentAllocation[],
  invoices: TaxInvoice[],
): StatementPreview {
  const { start, end } = periodRange(period);
  const opening = customerBalance(customer.id, docs, payments, addDays(start, -1));
  const inPeriodDocs = docs
    .filter((d) => d.customerId === customer.id && d.issueDate >= start && d.issueDate <= end)
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.no.localeCompare(b.no));
  const inPeriodPays = payments
    .filter((p) => p.customerId === customer.id && p.collectedAt.slice(0, 10) >= start && p.collectedAt.slice(0, 10) <= end)
    .sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));

  const invoiceFor = (docId: string) => invoices.find((i) => i.sourceArIds.includes(docId) && i.providerStatus !== "voided");

  type Entry = { date: string; key: string; line: Omit<StatementLine, "balanceCents"> };
  const entries: Entry[] = [];
  for (const d of inPeriodDocs) {
    const debit = d.type === "charge" || d.type === "debit_note";
    const paid = debit ? appliedTo(d.id, allocations) : undefined;
    entries.push({
      date: d.issueDate,
      key: `${d.issueDate}-0-${d.no}`,
      line: {
        date: d.issueDate,
        refType: d.type,
        refId: d.id,
        refNo: d.no,
        description: d.memo ?? DOC_LABEL[d.type],
        exTaxCents: d.exTaxCents,
        taxCents: d.taxCents,
        debitCents: debit ? d.totalCents : 0,
        creditCents: debit ? 0 : d.totalCents,
        invoiceNo: invoiceFor(d.id)?.invoiceNo,
        paidCents: paid,
        remainingCents: debit ? d.totalCents - (paid ?? 0) : undefined,
      },
    });
  }
  for (const p of inPeriodPays) {
    const date = p.collectedAt.slice(0, 10);
    entries.push({
      date,
      key: `${date}-1-${p.no}`,
      line: {
        date,
        refType: "payment",
        refId: p.id,
        refNo: p.no,
        description: p.reversalOf ? `收款沖回（${METHOD_LABEL[p.method]}）` : `收款・${METHOD_LABEL[p.method]}`,
        exTaxCents: 0,
        taxCents: 0,
        debitCents: p.grossCents < 0 ? -p.grossCents : 0,
        creditCents: p.grossCents > 0 ? p.grossCents : 0,
      },
    });
  }
  entries.sort((a, b) => a.key.localeCompare(b.key));

  let running = opening;
  const lines: StatementLine[] = [
    {
      date: start,
      refType: "opening",
      refId: "opening",
      refNo: "—",
      description: "上期結轉",
      exTaxCents: 0,
      taxCents: 0,
      debitCents: 0,
      creditCents: 0,
      balanceCents: opening,
    },
  ];
  for (const e of entries) {
    running += e.line.debitCents - e.line.creditCents;
    lines.push({ ...e.line, balanceCents: running });
  }

  const charges = inPeriodDocs.filter((d) => d.type === "charge");
  const totals: StatementTotals = {
    openingCents: opening,
    chargesCents: sum(charges.map((d) => d.totalCents)),
    chargesExTaxCents: sum(charges.map((d) => d.exTaxCents)),
    chargesTaxCents: sum(charges.map((d) => d.taxCents)),
    debitAdjCents: sum(inPeriodDocs.filter((d) => d.type === "debit_note").map((d) => d.totalCents)),
    creditAdjCents: sum(inPeriodDocs.filter((d) => d.type === "credit_note" || d.type === "write_off").map((d) => d.totalCents)),
    paymentsCents: sum(inPeriodPays.map((p) => p.grossCents)),
    closingCents: 0,
  };
  totals.closingCents = totals.openingCents + totals.chargesCents + totals.debitAdjCents - totals.creditAdjCents - totals.paymentsCents;
  const ledgerClosingCents = customerBalance(customer.id, docs, payments, end);

  return {
    customerId: customer.id,
    period,
    start,
    end,
    totals,
    lines,
    ledgerClosingCents,
    reconciles: totals.closingCents === ledgerClosingCents && running === totals.closingCents,
    deliveryCount: charges.length,
  };
}

/** FNV-1a 32-bit — a stable fingerprint of a locked snapshot (not a security hash). */
export function snapshotHash(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const STATEMENT_STATUS_LABEL = {
  locked: "已鎖定・待會計審查",
  reviewed: "會計已審・待主管核准",
  released: "主管已核准・待發送",
  queued: "已排入發送佇列（模擬）",
  sent_mock: "模擬發送完成・未實際寄出",
  superseded: "已被新版本取代",
} as const;
