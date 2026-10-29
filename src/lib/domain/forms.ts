import { z } from "zod";
import { isValidMobileCarrier, isValidTaxId } from "./invoices";
import type { Customer, GeoPoint, Supplier } from "./types";

/**
 * Input schemas for the manual "＋" forms. The same schema runs in the form (inline errors)
 * and inside the action (the action never trusts the UI).
 */

const TW_PHONE = /^(09\d{2}-?\d{3}-?\d{3}|0\d{1,2}-?\d{3,4}-?\d{4})$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const req = (label: string) => z.string().trim().min(1, `請輸入${label}`);

export const agreedPriceRow = z.object({
  productId: req("品項"),
  /** Whole TWD as quoted to the customer. */
  amount: z.number().int("合約價需為整數元").min(1, "合約價需大於 0").max(1_000_000),
  unit: z.enum(["base", "pack"]),
  taxIncluded: z.boolean(),
});
export type AgreedPriceRowInput = z.input<typeof agreedPriceRow>;

export const customerSchema = z
  .object({
    name: req("客戶名稱").max(30, "名稱最多 30 字"),
    code: req("客戶代號").regex(/^[A-Z0-9]{2,6}$/, "代號為 2–6 碼大寫英數"),
    segment: z.enum(["餐廳", "炸物店"]),
    subType: req("細分類").max(10),
    ownerName: req("負責人").max(20),
    phone: req("聯絡電話").regex(TW_PHONE, "電話格式不符，例：02-1234-5678 或 0912-345-678"),
    contactName: z.string().trim().max(20),
    onboardedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "請選擇日期"),
    accountManagerId: req("負責業務"),
    address: req("地址").max(60),
    district: req("地區"),
    windowStart: z.string().regex(HHMM, "時間格式 HH:MM"),
    windowEnd: z.string().regex(HHMM, "時間格式 HH:MM"),
    settlementTerms: z.enum(["daily", "monthly", "mixed"]),
    sameDaySharePct: z.number().int().min(1, "需介於 1–99%").max(99, "需介於 1–99%"),
    creditLimit: z.number().int("信用額度需為整數").min(0, "信用額度不可為負").max(5_000_000),
    priceTier: z.enum(["standard", "volume", "vip"]),
    /** 報價方式 */
    priceBasis: z.enum(["excluded", "included"]).default("excluded"),
    invoiceClass: z.enum(["B2B", "B2C"]),
    taxId: z.string().trim(),
    carrierType: z.enum(["none", "mobile", "member", "citizen"]),
    carrierValue: z.string().trim(),
    /** 合約價 promised at onboarding; effective from onboardedAt. */
    agreedPrices: z.array(agreedPriceRow).default([]),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.agreedPrices.forEach((row, i) => {
      if (seen.has(row.productId)) ctx.addIssue({ code: "custom", path: ["agreedPrices", i, "productId"], message: "同一品項只能有一個合約價" });
      seen.add(row.productId);
    });
    if (v.windowEnd <= v.windowStart) ctx.addIssue({ code: "custom", path: ["windowEnd"], message: "結束需晚於開始" });
    if (v.invoiceClass === "B2B" && !isValidTaxId(v.taxId)) ctx.addIssue({ code: "custom", path: ["taxId"], message: "統一編號需 8 碼且檢查碼正確" });
    if (v.invoiceClass === "B2C" && v.carrierType === "mobile" && !isValidMobileCarrier(v.carrierValue)) ctx.addIssue({ code: "custom", path: ["carrierValue"], message: "手機條碼為「/」加 7 碼大寫英數" });
    if (v.invoiceClass === "B2C" && (v.carrierType === "member" || v.carrierType === "citizen") && !v.carrierValue) ctx.addIssue({ code: "custom", path: ["carrierValue"], message: "請輸入載具號碼" });
  });
export type CustomerInput = z.input<typeof customerSchema>;

export const orderSchema = z.object({
  customerId: req("客戶"),
  source: z.enum(["PHONE", "APP", "LINE"]),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "請選擇配送日"),
  note: z.string().trim().max(100),
  lines: z
    .array(
      z
        .object({
          productId: req("品項"),
          qty: z.number().int("數量需為整數").min(1, "數量至少 1"),
          unit: z.enum(["base", "pack"]),
          /** Unit price ex-tax in whole TWD; null = use the customer's price tier. */
          priceOverride: z.number().int().min(0).nullable(),
          priceReason: z.string().trim(),
        })
        .refine((l) => l.priceOverride === null || l.priceReason.length > 0, { path: ["priceReason"], message: "改價需填原因" }),
    )
    .min(1, "至少一個品項"),
});
export type OrderInput = z.input<typeof orderSchema>;

export const supplierSchema = z.object({
  name: req("供應商名稱").max(30),
  contactName: req("聯絡人").max(20),
  phone: req("電話").regex(TW_PHONE, "電話格式不符"),
  channel: z.enum(["line_group", "phone", "email"]),
  email: z.string().trim(),
  leadTimeDays: z.number().int("天數需為整數").min(0).max(30, "最多 30 天"),
}).refine((v) => v.channel !== "email" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email), { path: ["email"], message: "Email 格式不符" });
export type SupplierInput = z.input<typeof supplierSchema>;

export const productSchema = z
  .object({
    name: req("品名").max(20),
    category: z.enum(["冷凍炸物", "蔬食", "調理品"]),
    spec: req("規格").max(20),
    baseUnit: z.enum(["包", "袋"]),
    packSize: z.number().int("需為整數").min(1, "至少 1").max(100),
    weightGram: z.number().int("需為整數").min(1, "請輸入每單位重量").max(20000),
    zone: z.enum(["A", "B", "C", "D"]),
    shelf: req("架位").regex(/^[A-D]-\d{1,2}$/, "架位格式如 B-5"),
    tempC: z.union([z.literal(-18), z.literal(-25)]),
    supplierId: req("供應商"),
    /** Whole TWD per base unit, ex-tax; null = 尚無成本資料. */
    cost: z.number().int().min(0).nullable(),
    priceStandard: z.number().int("需為整數").min(1, "請輸入一般價"),
    priceVolume: z.number().int("需為整數").min(1, "請輸入量販價"),
    priceVip: z.number().int("需為整數").min(1, "請輸入 VIP 價"),
    reorderPointPacks: z.number().int("需為整數").min(0),
    reorderQtyPacks: z.number().int("需為整數").min(1, "至少 1 箱"),
    aliases: z.string(),
  })
  .superRefine((v, ctx) => {
    if (!v.shelf.startsWith(v.zone)) ctx.addIssue({ code: "custom", path: ["shelf"], message: `架位需在凍庫 ${v.zone}（${v.zone}-…）` });
    if (v.priceVolume > v.priceStandard) ctx.addIssue({ code: "custom", path: ["priceVolume"], message: "量販價不應高於一般價" });
    if (v.priceVip > v.priceVolume) ctx.addIssue({ code: "custom", path: ["priceVip"], message: "VIP 價不應高於量販價" });
    if (v.cost !== null && v.cost >= v.priceVip) ctx.addIssue({ code: "custom", path: ["cost"], message: "成本高於或等於最低售價，請確認" });
  });
export type ProductInput = z.input<typeof productSchema>;

/** Split the free-text alias field: comma, 、, space or newline separated. */
export const splitAliases = (s: string) => [...new Set(s.split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean))];

/** Next unused shelf in a zone, e.g. B-5. */
export function nextShelf(products: { zone: string; shelf: string }[], zone: string): string {
  const used = new Set(products.filter((p) => p.zone === zone).map((p) => p.shelf));
  let i = 1;
  while (used.has(`${zone}-${i}`)) i++;
  return `${zone}-${i}`;
}

export type FieldErrors = Record<string, string>;

/** Flatten Zod issues to { "lines.0.qty": "…" } for inline display. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const i of error.issues) {
    const k = i.path.join(".");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

const norm = (s: string) => s.replace(/[\s-]/g, "");

/** Likely duplicates — warn, never block: same name, phone or tax id. */
export function findCustomerDuplicates(customers: Customer[], v: { name: string; phone: string; taxId?: string }): Customer[] {
  const name = v.name.trim();
  return customers.filter((c) => (name && c.name === name) || (v.phone && norm(c.phone) === norm(v.phone)) || (v.taxId && c.taxId && c.taxId === v.taxId.trim()));
}

export function findSupplierDuplicates(suppliers: Supplier[], name: string): Supplier[] {
  return suppliers.filter((s) => s.name === name.trim());
}

/** Approximate centres of Taichung districts (WGS84), used to place a new customer until the address is geocoded. */
export const TAICHUNG_DISTRICTS: Record<string, GeoPoint> = {
  中區: { lat: 24.1428, lng: 120.6806 },
  東區: { lat: 24.1367, lng: 120.6997 },
  南區: { lat: 24.1203, lng: 120.6655 },
  西區: { lat: 24.1435, lng: 120.6633 },
  北區: { lat: 24.1608, lng: 120.6834 },
  西屯區: { lat: 24.1824, lng: 120.6362 },
  南屯區: { lat: 24.1385, lng: 120.6326 },
  北屯區: { lat: 24.1823, lng: 120.7068 },
  大里區: { lat: 24.0990, lng: 120.6786 },
  太平區: { lat: 24.1263, lng: 120.7187 },
  烏日區: { lat: 24.1046, lng: 120.6243 },
  大雅區: { lat: 24.2290, lng: 120.6478 },
  潭子區: { lat: 24.2120, lng: 120.7054 },
};

/** Map position for a new customer: the centre of known customers in that district, else the district centre. Flagged for confirmation. */
export function districtCentre(customers: Customer[], district: string, fallback: GeoPoint): GeoPoint {
  const pts = customers.filter((c) => c.district === district).map((c) => c.geo);
  if (!pts.length) return TAICHUNG_DISTRICTS[district] ?? fallback;
  const avg = (k: "lat" | "lng") => Math.round((pts.reduce((a, p) => a + p[k], 0) / pts.length) * 1e5) / 1e5;
  return { lat: avg("lat"), lng: avg("lng") };
}

export const DEFAULT_CREDIT: Record<Customer["settlementTerms"], number> = { daily: 30000, monthly: 60000, mixed: 60000 };
export const SUBTYPE_SUGGESTIONS: Record<Customer["segment"], string[]> = {
  炸物店: ["炸物", "鹹酥雞", "炸雞", "雞排"],
  餐廳: ["便當", "自助餐", "食堂", "小吃", "早餐店", "蔬食"],
};
