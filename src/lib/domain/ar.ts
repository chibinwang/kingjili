import { sum, type Cents } from "../money";
import { daysBetween, periodOf } from "../time";
import type { ArDocType, ArDocument, Customer, Payment, PaymentAllocation } from "./types";

/**
 * Receivables sub-ledger. Sales order ≠ delivery ≠ receipt ≠ invoice ≠ statement:
 * AR documents are created from deliveries; payments are separate; allocations link them.
 * Nothing is ever mutated or deleted — corrections are new documents or reversal payments.
 */

export const DOC_SIGN: Record<ArDocType, 1 | -1> = { charge: 1, debit_note: 1, credit_note: -1, write_off: -1 };

export const DOC_LABEL: Record<ArDocType, string> = {
  charge: "出貨應收",
  debit_note: "借項調整",
  credit_note: "退貨／折讓",
  write_off: "核准沖銷",
};

export function signedTotal(doc: ArDocument): Cents {
  return DOC_SIGN[doc.type] * doc.totalCents;
}

export function appliedTo(docId: string, allocations: PaymentAllocation[]): Cents {
  return sum(allocations.filter((a) => a.arDocumentId === docId).map((a) => a.appliedCents));
}

export function appliedFrom(paymentId: string, allocations: PaymentAllocation[]): Cents {
  return sum(allocations.filter((a) => a.paymentId === paymentId).map((a) => a.appliedCents));
}

/** Remaining on a debit-type document (charges & debit notes). Credits are applied at customer level. */
export function docRemaining(doc: ArDocument, allocations: PaymentAllocation[]): Cents {
  if (DOC_SIGN[doc.type] < 0) return 0;
  return doc.totalCents - appliedTo(doc.id, allocations);
}

export function docStatus(doc: ArDocument, allocations: PaymentAllocation[]): "open" | "partial" | "paid" | "credit" {
  if (DOC_SIGN[doc.type] < 0) return "credit";
  const applied = appliedTo(doc.id, allocations);
  if (applied <= 0) return "open";
  if (applied < doc.totalCents) return "partial";
  return "paid";
}

export function isReversed(payment: Payment, payments: Payment[]): boolean {
  return payments.some((p) => p.reversalOf === payment.id);
}

export function paymentUnapplied(payment: Payment, allocations: PaymentAllocation[]): Cents {
  return payment.grossCents - appliedFrom(payment.id, allocations);
}

/** Customer balance as of a date (inclusive): Σ signed documents − Σ payments. Positive = customer owes. */
export function customerBalance(customerId: string, docs: ArDocument[], payments: Payment[], asOf?: string): Cents {
  const d = docs.filter((x) => x.customerId === customerId && (!asOf || x.issueDate <= asOf));
  const p = payments.filter((x) => x.customerId === customerId && (!asOf || x.collectedAt.slice(0, 10) <= asOf));
  return sum(d.map(signedTotal)) - sum(p.map((x) => x.grossCents));
}

/** The same balance computed through allocations — used as a cross-ledger agreement check. */
export function customerBalanceViaAllocations(customerId: string, docs: ArDocument[], payments: Payment[], allocations: PaymentAllocation[]): Cents {
  const d = docs.filter((x) => x.customerId === customerId);
  const p = payments.filter((x) => x.customerId === customerId);
  const openDebits = sum(d.filter((x) => DOC_SIGN[x.type] > 0).map((x) => docRemaining(x, allocations)));
  const credits = sum(d.filter((x) => DOC_SIGN[x.type] < 0).map((x) => x.totalCents));
  const unapplied = sum(p.map((x) => paymentUnapplied(x, allocations)));
  return openDebits - credits - unapplied;
}

/** Due date by settlement terms. Monthly: statement by the 10th, payment due the 25th of next month (demo assumption). */
export function dueDate(doc: ArDocument, customer: Customer): string {
  if (customer.settlementTerms === "daily") return doc.issueDate;
  const [y, m] = periodOf(doc.issueDate).split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-25`;
}

export type AgingBucket = "current" | "1-30" | "31-60" | "61+";

export function agingBucket(due: string, asOf: string): AgingBucket {
  const late = daysBetween(due, asOf);
  if (late <= 0) return "current";
  if (late <= 30) return "1-30";
  if (late <= 60) return "31-60";
  return "61+";
}

export interface CustomerAr {
  customerId: string;
  balance: Cents;
  openDocs: { doc: ArDocument; remaining: Cents; due: string; bucket: AgingBucket; daysLate: number }[];
  overdue: Cents;
  buckets: Record<AgingBucket, Cents>;
  unappliedCredit: Cents;
  oldestDue?: string;
}

export function customerAr(customer: Customer, docs: ArDocument[], payments: Payment[], allocations: PaymentAllocation[], asOf: string): CustomerAr {
  const mine = docs.filter((d) => d.customerId === customer.id && d.issueDate <= asOf);
  const openDocs = mine
    .filter((d) => DOC_SIGN[d.type] > 0)
    .map((doc) => {
      const remaining = docRemaining(doc, allocations);
      const due = dueDate(doc, customer);
      return { doc, remaining, due, bucket: agingBucket(due, asOf), daysLate: Math.max(0, daysBetween(due, asOf)) };
    })
    .filter((x) => x.remaining > 0)
    .sort((a, b) => a.doc.issueDate.localeCompare(b.doc.issueDate));
  const buckets: Record<AgingBucket, Cents> = { current: 0, "1-30": 0, "31-60": 0, "61+": 0 };
  for (const o of openDocs) buckets[o.bucket] += o.remaining;
  const credits = sum(mine.filter((d) => DOC_SIGN[d.type] < 0).map((d) => d.totalCents));
  const unappliedCredit = sum(payments.filter((p) => p.customerId === customer.id).map((p) => paymentUnapplied(p, allocations))) + credits;
  return {
    customerId: customer.id,
    balance: customerBalance(customer.id, docs, payments, asOf),
    openDocs,
    overdue: buckets["1-30"] + buckets["31-60"] + buckets["61+"],
    buckets,
    unappliedCredit,
    oldestDue: openDocs.find((o) => o.daysLate > 0)?.due,
  };
}

export interface AllocationPlan {
  allocations: { arDocumentId: string; appliedCents: Cents }[];
  unapplied: Cents;
}

/**
 * Allocate a payment: explicit targets first (e.g. the delivery the driver collected for),
 * then oldest open documents. Never over-applies a document; leftover stays as customer credit.
 */
export function planAllocation(
  amount: Cents,
  customerId: string,
  docs: ArDocument[],
  allocations: PaymentAllocation[],
  preferDocIds: string[] = [],
): AllocationPlan {
  const open = docs
    .filter((d) => d.customerId === customerId && DOC_SIGN[d.type] > 0 && docRemaining(d, allocations) > 0)
    .sort((a, b) => {
      const pa = preferDocIds.includes(a.id) ? 0 : 1;
      const pb = preferDocIds.includes(b.id) ? 0 : 1;
      return pa - pb || a.issueDate.localeCompare(b.issueDate) || a.no.localeCompare(b.no);
    });
  let left = amount;
  const out: AllocationPlan["allocations"] = [];
  for (const d of open) {
    if (left <= 0) break;
    const take = Math.min(left, docRemaining(d, allocations));
    out.push({ arDocumentId: d.id, appliedCents: take });
    left -= take;
  }
  return { allocations: out, unapplied: left };
}

/** Reversal: a negative payment + negative allocations mirroring the original. The original is untouched. */
export function planReversal(payment: Payment, allocations: PaymentAllocation[]) {
  const mine = allocations.filter((a) => a.paymentId === payment.id);
  return {
    grossCents: -payment.grossCents,
    allocations: mine.map((a) => ({ arDocumentId: a.arDocumentId, appliedCents: -a.appliedCents })),
  };
}

export const METHOD_LABEL: Record<Payment["method"], string> = { cash: "現金", transfer: "匯款", check: "支票", linepay: "LINE Pay" };

export const CUSTODY_LABEL: Record<Payment["custody"], string> = {
  collected: "司機已收（未繳回）",
  handed_over: "已繳回公司（待存入）",
  deposited: "已存入銀行",
  received: "銀行入帳（待核對）",
  matched: "已核對入帳",
};

export function isBankVerified(p: Payment): boolean {
  return p.custody === "deposited" || p.custody === "matched";
}

export const TERMS_LABEL = { daily: "日結", monthly: "月結", mixed: "混合" } as const;
