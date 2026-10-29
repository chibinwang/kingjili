import { DEFAULT_TAX_POLICY, taxOnExclusive, type Cents, type TaxPolicy } from "../money";
import { addDays } from "../time";
import { BASIS_LABEL, formatE7, taxLine, taxTotals } from "./taxcalc";
import type { ArDocument, Customer, InvoiceLine, InvoiceNumberRange, TaxInvoice } from "./types";

/** From this date every delivery gets its own invoice (單趟開立); earlier monthly customers were 月結彙開. */
export const PER_TRIP_FROM = "2026-10-01";

/** Upload deadline: B2B 7 days, B2C 2 days, counted from the day after issue; weekends are not extended. */
export function uploadDueOn(issueDate: string, invoiceClass: TaxInvoice["invoiceClass"]): string {
  return addDays(issueDate, invoiceClass === "B2B" ? 7 : 2);
}

/** Bimonthly invoice period ("YYYY-MM" of the odd month) a date falls in. */
export function invoicePeriodOf(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${y}-${String(m % 2 ? m : m - 1).padStart(2, "0")}`;
}

/** 民國 year + months as printed: "115年09-10月". */
export function formatInvoicePeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${y - 1911}年${String(m).padStart(2, "0")}-${String(m + 1).padStart(2, "0")}月`;
}

/** Take the next number from the active range for the date's period. Returns the updated range so callers stay pure. */
export function takeInvoiceNumber(ranges: InvoiceNumberRange[], date: string): { range: InvoiceNumberRange; invoiceNo: string } {
  const period = invoicePeriodOf(date);
  const r = ranges.find((x) => x.period === period && x.status === "active" && x.next <= x.end);
  if (!r) throw new Error(`${formatInvoicePeriod(period)} 沒有可用的字軌號碼，請先在財政部平台取號並設定號段`);
  return { range: { ...r, next: r.next + 1 }, invoiceNo: `${r.track}${String(r.next).padStart(8, "0")}` };
}

/** Deterministic 4-digit 隨機碼 for the demo (production: a real random number, stored once). */
export function randomCode(seed: string): string {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return String((h >>> 0) % 10000).padStart(4, "0");
}

/** MIG 4.0 品項 from a delivery receivable: quoted unit price in the line's basis, ex-tax figures to 7 decimals. */
export function invoiceLinesFromCharge(doc: ArDocument): InvoiceLine[] {
  return (doc.items ?? []).map((it, i) => {
    const basis = it.priceBasis ?? "excluded";
    const amountCents = it.amountCents ?? it.exTaxCents;
    // price per unit as ordered (箱 or 包); qty always divides the amount exactly
    const unitPriceCents = it.qty ? Math.round(amountCents / it.qty) : amountCents;
    const t = taxLine({ basis, qty: it.qty, unitPriceCents });
    return { seq: i + 1, productId: it.productId, description: it.name, qty: it.qty, unit: it.unitLabel, basis, unitPriceCents, amountCents: t.amountCents, unitPriceEx: formatE7(t.unitPriceExE7).replaceAll(",", ""), amountEx: formatE7(t.amountExE7).replaceAll(",", ""), taxType: "TX" };
  });
}

/** One invoice per delivery. Amounts come from the lines (not from the receivable, which may carry a keyed error). */
export function perTripInvoice(doc: ArDocument, c: Customer, createdAt: string): TaxInvoice {
  const lines = invoiceLinesFromCharge(doc);
  const t = taxTotals(lines.map((l) => ({ basis: l.basis, amountCents: l.amountCents })));
  return {
    id: `inv-${doc.issueDate}-${c.code}`,
    provider: "ECPAY_MOCK",
    invoiceClass: c.invoiceClass,
    customerId: c.id,
    sourceArIds: [doc.id],
    buyerName: c.name,
    buyerTaxId: c.invoiceClass === "B2B" ? c.taxId : undefined,
    carrierType: c.invoiceClass === "B2C" ? c.carrier?.type : undefined,
    carrierValue: c.invoiceClass === "B2C" ? c.carrier?.value : undefined,
    period: doc.issueDate.slice(0, 7),
    issueDate: doc.issueDate,
    exTaxCents: t.salesCents,
    taxCents: t.taxCents,
    totalCents: t.totalCents,
    providerStatus: "staged",
    govUploadStatus: "not_uploaded",
    createdAt,
    source: "per_delivery",
    priceBasis: t.basis,
    lines,
    uploadDueOn: uploadDueOn(doc.issueDate, c.invoiceClass),
  };
}

/** Tax the stored lines of a document imply (falls back to ex-tax × 5% for documents without basis data). */
export function expectedTax(lines: { priceBasis?: TaxInvoice["priceBasis"]; amountCents?: Cents; exTaxCents: Cents }[] | undefined, exTaxCents: Cents, policy: TaxPolicy = DEFAULT_TAX_POLICY): Cents {
  if (!lines?.length || lines.some((l) => l.amountCents === undefined || !l.priceBasis)) return taxOnExclusive(exTaxCents, policy);
  return taxTotals(lines.map((l) => ({ basis: l.priceBasis === "included" ? "included" : "excluded", amountCents: l.amountCents! })), policy).taxCents;
}

export { BASIS_LABEL };

/**
 * Preflight for the mocked ECPay connector. Rules here are illustrative; production date rules,
 * number tracks, tax treatment and carrier formats must be validated by the accountant & provider.
 */
export interface PreflightIssue {
  field: string;
  message: string;
}

export function isValidTaxId(id: string): boolean {
  // Taiwan 統一編號 checksum (8 digits, weights 1,2,1,2,1,2,4,1; 2023 rule: divisible by 5).
  if (!/^\d{8}$/.test(id)) return false;
  const w = [1, 2, 1, 2, 1, 2, 4, 1];
  const digits = id.split("").map(Number);
  const s = digits.reduce((acc, d, i) => {
    const p = d * w[i];
    return acc + Math.floor(p / 10) + (p % 10);
  }, 0);
  return s % 5 === 0 || (digits[6] === 7 && (s + 1) % 5 === 0);
}

export function isValidMobileCarrier(v: string): boolean {
  return /^\/[0-9A-Z.+-]{7}$/.test(v);
}

export function isValidCitizenCarrier(v: string): boolean {
  return /^[A-Z]{2}\d{14}$/.test(v);
}

export function preflightInvoice(inv: TaxInvoice): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  if (inv.invoiceClass === "B2B") {
    if (!inv.buyerTaxId) issues.push({ field: "buyerTaxId", message: "B2B 發票需買方統一編號" });
    else if (!isValidTaxId(inv.buyerTaxId)) issues.push({ field: "buyerTaxId", message: `統一編號 ${inv.buyerTaxId} 檢查碼不符` });
    if (inv.carrierType) issues.push({ field: "carrier", message: "B2B 發票不可使用載具" });
  } else {
    if (inv.carrierType === "mobile" && !isValidMobileCarrier(inv.carrierValue ?? "")) issues.push({ field: "carrier", message: `手機條碼「${inv.carrierValue}」格式不符（/ + 7 碼）` });
    if (inv.carrierType === "citizen" && !isValidCitizenCarrier(inv.carrierValue ?? "")) issues.push({ field: "carrier", message: "自然人憑證條碼格式不符（2 英文 + 14 數字）" });
  }
  if (inv.lines?.length) {
    // recompute from the 品項 in their own basis (含稅／未稅／混合)
    const t = taxTotals(inv.lines.map((l) => ({ basis: l.basis, amountCents: l.amountCents })));
    if (t.taxCents !== inv.taxCents || t.salesCents !== inv.exTaxCents) issues.push({ field: "tax", message: `銷售額／稅額與品項計算不符（應為 ${t.salesCents / 100}／${t.taxCents / 100}，${BASIS_LABEL[t.basis]}）` });
  } else if (inv.taxCents !== taxOnExclusive(inv.exTaxCents)) issues.push({ field: "tax", message: `稅額 ${inv.taxCents / 100} 與未稅 ${inv.exTaxCents / 100} × 5% 不符` });
  if (inv.totalCents !== inv.exTaxCents + inv.taxCents) issues.push({ field: "total", message: "含稅金額 ≠ 未稅 + 稅額" });
  if (inv.totalCents <= 0) issues.push({ field: "total", message: "發票金額需大於 0" });
  return issues;
}

export const PROVIDER_STATUS_LABEL: Record<TaxInvoice["providerStatus"], string> = {
  staged: "待預檢",
  preflight_failed: "預檢未過",
  ready: "已開立・待上傳",
  submitted: "已送出（模擬）",
  accepted: "綠界已接收（模擬）",
  rejected: "綠界退回（模擬）",
  voided: "已作廢",
  allowance: "已開折讓",
};

export const GOV_STATUS_LABEL: Record<TaxInvoice["govUploadStatus"], string> = {
  not_uploaded: "尚未上傳財政部",
  pending_mock: "待上傳（模擬）",
  uploaded_mock: "已上傳（模擬）",
};
