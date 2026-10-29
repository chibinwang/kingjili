import { taxOnExclusive } from "../money";
import type { TaxInvoice } from "./types";

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
  if (inv.taxCents !== taxOnExclusive(inv.exTaxCents)) issues.push({ field: "tax", message: `稅額 ${inv.taxCents / 100} 與未稅 ${inv.exTaxCents / 100} × 5% 不符` });
  if (inv.totalCents !== inv.exTaxCents + inv.taxCents) issues.push({ field: "total", message: "含稅金額 ≠ 未稅 + 稅額" });
  if (inv.totalCents <= 0) issues.push({ field: "total", message: "發票金額需大於 0" });
  return issues;
}

export const PROVIDER_STATUS_LABEL: Record<TaxInvoice["providerStatus"], string> = {
  staged: "待預檢",
  preflight_failed: "預檢未過",
  ready: "可送出",
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
