import { twd } from "../money";
import type { Customer, CustomerNote, DemoUser, Product, Supplier, Vehicle } from "../domain/types";

/** 示範資料 — every name, price, address, tax id and coordinate here is fictional. */

export const USERS: DemoUser[] = [
  { id: "u-owner", name: "周筱汶", role: "owner", title: "主任" },
  { id: "u-sales", name: "吳佩珊", role: "sales", title: "業務" },
  { id: "u-acct", name: "張淑芬", role: "accounting", title: "會計" },
  { id: "u-wh", name: "李阿德", role: "warehouse", title: "倉管" },
  { id: "u-proc", name: "周明哲", role: "procurement", title: "採購" },
  { id: "u-drv-a", name: "陳建宏", role: "driver", title: "A 車司機", vehicleId: "A" },
  { id: "u-drv-b", name: "王俊傑", role: "driver", title: "B 車司機", vehicleId: "B" },
  { id: "u-admin", name: "系統管理員", role: "admin", title: "管理員" },
];

export const AGENT = { id: "agent", name: "Everyse AI" };

export const VEHICLES_SEED: Vehicle[] = [
  { id: "A", name: "A 車", plate: "示-1023", driverId: "u-drv-a", driverName: "陳建宏", capacityKg: 1500, capacityL: 7000, maxShiftMin: 480, departAt: "08:00", color: "#d9921a", frozen: true },
  { id: "B", name: "B 車", plate: "示-2047", driverId: "u-drv-b", driverName: "王俊傑", capacityKg: 1800, capacityL: 9000, maxShiftMin: 480, departAt: "08:00", color: "#2f6f8f", frozen: true },
];

export const SUPPLIERS: Supplier[] = [
  { id: "S01", name: "北辰冷凍食品", contactName: "許先生", channel: "line_group", lineGroupVerified: true, leadTimeDays: 2, approved: true },
  { id: "S02", name: "海旭水產加工", contactName: "蔡小姐", channel: "line_group", lineGroupVerified: true, leadTimeDays: 3, approved: true },
  { id: "S03", name: "綠原蔬食工坊", contactName: "羅先生", channel: "line_group", lineGroupVerified: false, leadTimeDays: 2, approved: true },
  { id: "S04", name: "金穗調理食品", contactName: "鄭小姐", channel: "phone", lineGroupVerified: false, leadTimeDays: 4, approved: true },
];

const P = (
  id: string,
  name: string,
  category: Product["category"],
  spec: string,
  baseUnit: Product["baseUnit"],
  packSize: number,
  grams: number,
  zone: Product["zone"],
  shelf: string,
  cost: number | null,
  std: number,
  supplierId: string,
  reorderPoint: number,
  reorderQty: number,
): Product => ({
  id,
  sku: id,
  name,
  category,
  baseUnit,
  packUnit: "箱",
  packSize,
  spec,
  weightGramPerBase: grams,
  volumeMlPerBase: Math.round(grams * 2.1),
  zone,
  shelf,
  costCents: cost === null ? null : twd(cost),
  price: { standard: twd(std), volume: twd(Math.round(std * 0.96)), vip: twd(Math.round(std * 0.92)) },
  taxClass: "taxable",
  supplierId,
  reorderPoint,
  reorderQty,
  tempC: -18,
});

export const PRODUCTS: Product[] = [
  P("P001", "冷凍雞塊", "冷凍炸物", "1kg／包", "包", 10, 1000, "A", "A-1", 118, 165, "S01", 80, 100),
  P("P002", "酥炸雞排", "冷凍炸物", "10 片／包", "包", 10, 1200, "A", "A-2", 160, 230, "S01", 60, 80),
  P("P009", "雞米花", "冷凍炸物", "1kg／包", "包", 10, 1000, "A", "A-3", 125, 178, "S01", 40, 60),
  P("P003", "香脆薯條", "冷凍炸物", "2kg／袋", "袋", 6, 2000, "B", "B-1", 95, 138, "S01", 120, 120),
  P("P004", "炸花枝丸", "冷凍炸物", "600g／包", "包", 20, 600, "B", "B-2", 72, 105, "S02", 60, 100),
  P("P010", "地瓜薯條", "冷凍炸物", "1kg／包", "包", 10, 1000, "B", "B-3", 78, 115, "S01", 40, 60),
  P("P012", "黃金魚排", "冷凍炸物", "10 片／包", "包", 10, 900, "B", "B-4", 140, 199, "S02", 30, 50),
  P("P005", "蔬食水餃", "蔬食", "50 粒／包", "包", 12, 1100, "C", "C-1", 85, 125, "S03", 50, 72),
  P("P006", "素雞塊", "蔬食", "1kg／包", "包", 10, 1000, "C", "C-2", 105, 150, "S03", 40, 60),
  P("P011", "蔬菜春捲", "蔬食", "20 條／包", "包", 12, 900, "C", "C-3", 70, 102, "S03", 36, 48),
  P("P014", "素排骨", "蔬食", "1kg／包", "包", 10, 1000, "C", "C-4", null, 160, "S03", 20, 40),
  P("P007", "甜不辣", "調理品", "1kg／包", "包", 12, 1000, "D", "D-1", 68, 98, "S04", 36, 48),
  P("P008", "洋蔥圈", "調理品", "1kg／包", "包", 10, 1000, "D", "D-2", 88, 128, "S04", 30, 50),
  P("P013", "起司條", "調理品", "1kg／包", "包", 10, 1000, "D", "D-3", 150, 215, "S04", 20, 40),
];

type Basket = [productId: string, unit: "base" | "pack", min: number, max: number][];

export interface CustomerSeed extends Customer {
  vehicle: "A" | "B";
  days: number[];
  basket: Basket;
}

const C = (c: Omit<CustomerSeed, "creditLimitCents" | "billingContact"> & { credit?: number }): CustomerSeed => ({
  ...c,
  billingContact: c.contactName,
  creditLimitCents: twd(c.credit ?? 60000),
});

// Tax ids below start with 0000 and pass the checksum; chosen so they are unlikely to be real.
export const CUSTOMERS: CustomerSeed[] = [
  C({
    id: "C01", code: "FJ01", name: "福記炸物店", segment: "炸物店", subType: "炸物", ownerName: "林德福", onboardedAt: "2019-03-15", accountManagerId: "u-sales",
    contactName: "林小姐", phone: "02-0000-1101", address: "台中市西屯區示範中正路 101 號", district: "西屯區",
    lineUserId: "U-demo-fuji", linkStatus: "linked", settlementTerms: "monthly", invoiceClass: "B2B", taxId: "00001102", priceTier: "vip",
    geo: { lat: 24.1785, lng: 120.6455 }, window: { start: "09:00", end: "12:00" }, vehicle: "A", days: [1, 3, 5, 6], credit: 120000,
    basket: [["P001", "base", 10, 18], ["P009", "base", 4, 8], ["P003", "pack", 1, 3], ["P013", "base", 2, 5]],
  }),
  C({
    id: "C02", code: "SW02", name: "三味食堂", segment: "餐廳", subType: "食堂", ownerName: "陳文雄", onboardedAt: "2021-06-01", accountManagerId: "u-sales",
    contactName: "陳老闆", phone: "02-0000-1202", address: "台中市北屯區示範民生路 22 號", district: "北屯區",
    lineUserId: "U-demo-sanwei", linkStatus: "linked", settlementTerms: "monthly", invoiceClass: "B2B", taxId: "00001113", priceTier: "standard",
    geo: { lat: 24.176, lng: 120.693 }, window: { start: "08:30", end: "10:45" }, vehicle: "B", days: [2, 4, 6],
    basket: [["P002", "base", 10, 16], ["P005", "base", 4, 8], ["P011", "base", 3, 6]],
  }),
  C({
    id: "C03", code: "AH03", name: "阿宏鹹酥雞", segment: "炸物店", subType: "鹹酥雞", ownerName: "黃志宏", onboardedAt: "2020-11-20", accountManagerId: "u-sales",
    contactName: "阿宏", phone: "0900-000-303", address: "台中市北區示範夜市街 3 號", district: "北區",
    lineUserId: "U-demo-ahong", linkStatus: "linked", settlementTerms: "daily", invoiceClass: "B2C", priceTier: "standard", carrier: { type: "mobile", value: "/AH03K7Q" },
    geo: { lat: 24.1735, lng: 120.6625 }, window: { start: "10:00", end: "15:00" }, vehicle: "A", days: [1, 3, 6],
    basket: [["P004", "base", 8, 14], ["P007", "base", 4, 8], ["P003", "base", 3, 6]],
  }),
  C({
    id: "C04", code: "LT04", name: "綠田蔬食", segment: "餐廳", subType: "蔬食", ownerName: "黃靜宜", onboardedAt: "2023-02-10", accountManagerId: "u-sales",
    contactName: "黃小姐", phone: "02-0000-1404", address: "台中市太平區示範和平路 48 號", district: "太平區",
    lineUserId: "U-demo-lutian", linkStatus: "linked", settlementTerms: "mixed", sameDayShareBp: 5000, invoiceClass: "B2B", taxId: "00001139", priceTier: "standard",
    geo: { lat: 24.148, lng: 120.718 }, window: { start: "09:00", end: "11:30" }, vehicle: "B", days: [2, 5, 6],
    basket: [["P003", "pack", 1, 6], ["P006", "base", 5, 10], ["P014", "base", 2, 5], ["P011", "base", 3, 6]],
  }),
  C({
    id: "C05", code: "LJ05", name: "老街食堂", segment: "餐廳", subType: "食堂", ownerName: "張秀琴", onboardedAt: "2018-08-08", accountManagerId: "u-sales",
    contactName: "張媽媽", phone: "02-0000-1505", address: "台中市南屯區示範老街 5 號", district: "南屯區",
    linkStatus: "pending", settlementTerms: "daily", invoiceClass: "B2C", priceTier: "standard", carrier: { type: "mobile", value: "/LJ05M2X" },
    geo: { lat: 24.15, lng: 120.615 }, window: { start: "08:30", end: "10:30" }, vehicle: "A", days: [1, 4, 6],
    basket: [["P006", "base", 8, 12], ["P005", "base", 4, 8], ["P002", "base", 2, 5]],
  }),
  C({
    id: "C06", code: "CQ06", name: "長青自助餐", segment: "餐廳", subType: "自助餐", ownerName: "陳美玉", onboardedAt: "2017-04-01", accountManagerId: "u-sales",
    contactName: "陳美玉", phone: "02-0000-1606", address: "台中市大里區示範長青路 66 號", district: "大里區",
    lineUserId: "U-demo-cq", linkStatus: "linked", settlementTerms: "monthly", invoiceClass: "B2B", taxId: "00001124", priceTier: "volume",
    geo: { lat: 24.112, lng: 120.7 }, window: { start: "08:30", end: "10:30" }, vehicle: "B", days: [1, 3, 5, 6], credit: 100000,
    basket: [["P005", "base", 16, 24], ["P001", "base", 6, 12], ["P012", "base", 3, 6], ["P011", "base", 4, 8]],
  }),
  C({
    id: "C07", code: "XK07", name: "巷口炸物", segment: "炸物店", subType: "炸物", ownerName: "吳家豪", onboardedAt: "2024-09-02", accountManagerId: "u-sales",
    contactName: "小吳", phone: "0900-000-707", address: "台中市西區示範福德街 7 巷", district: "西區",
    lineUserId: "U-demo-xiangkou", linkStatus: "linked", settlementTerms: "daily", invoiceClass: "B2C", priceTier: "standard", carrier: { type: "mobile", value: "/XK07P9A" },
    geo: { lat: 24.148, lng: 120.648 }, window: { start: "09:00", end: "11:30" }, vehicle: "B", days: [2, 4, 6],
    basket: [["P008", "base", 5, 9], ["P001", "base", 3, 6], ["P010", "base", 2, 5]],
  }),
  C({
    id: "C08", code: "XC08", name: "小川便當", segment: "餐廳", subType: "便當", ownerName: "李承恩", onboardedAt: "2022-05-16", accountManagerId: "u-sales",
    contactName: "小川", phone: "02-0000-1808", address: "台中市北屯區示範北辰路 88 號", district: "北屯區",
    lineUserId: "U-demo-ogawa", linkStatus: "linked", settlementTerms: "mixed", sameDayShareBp: 3000, invoiceClass: "B2B", taxId: "00001155", priceTier: "standard",
    geo: { lat: 24.186, lng: 120.72 }, window: { start: "09:00", end: "11:30" }, vehicle: "B", days: [1, 3, 5, 6],
    basket: [["P007", "base", 6, 10], ["P002", "base", 5, 10], ["P012", "base", 2, 4]],
  }),
  C({
    id: "C09", code: "DS09", name: "大樹早餐店", segment: "餐廳", subType: "早餐店", ownerName: "蔡明輝", onboardedAt: "2025-12-01", accountManagerId: "u-sales",
    contactName: "蔡老闆", phone: "02-0000-1909", address: "台中市南屯區示範大樹路 9 號", district: "南屯區",
    linkStatus: "unlinked", settlementTerms: "daily", invoiceClass: "B2C", priceTier: "standard",
    geo: { lat: 24.126, lng: 120.629 }, window: { start: "08:00", end: "10:00" }, vehicle: "A", days: [2, 4, 6],
    basket: [["P009", "base", 3, 6], ["P010", "base", 3, 6], ["P013", "base", 2, 4]],
  }),
  C({
    id: "C10", code: "HW10", name: "好味便當", segment: "餐廳", subType: "便當", ownerName: "江國榮", onboardedAt: "2020-01-06", accountManagerId: "u-sales",
    contactName: "江先生", phone: "02-0000-2010", address: "台中市東區示範中山路 210 號", district: "東區",
    lineUserId: "U-demo-haowei", linkStatus: "linked", settlementTerms: "monthly", invoiceClass: "B2B", taxId: "00001134", priceTier: "volume",
    geo: { lat: 24.135, lng: 120.688 }, window: { start: "08:00", end: "10:00" }, vehicle: "B", days: [1, 4, 6], credit: 50000,
    basket: [["P002", "base", 8, 14], ["P012", "base", 3, 6], ["P007", "base", 3, 6]],
  }),
  C({
    id: "C11", code: "JH11", name: "金華小吃", segment: "餐廳", subType: "小吃", ownerName: "金玉蘭", onboardedAt: "2026-07-15", accountManagerId: "u-sales",
    contactName: "金姐", phone: "0900-000-111", address: "台中市西屯區示範金華街 11 號", district: "西屯區",
    lineUserId: "U-demo-jinhua", linkStatus: "linked", settlementTerms: "daily", invoiceClass: "B2C", priceTier: "standard", carrier: { type: "member", value: "KJM-0011" },
    geo: { lat: 24.188, lng: 120.614 }, window: { start: "09:00", end: "12:00" }, vehicle: "A", days: [3, 6],
    basket: [["P001", "base", 4, 8], ["P004", "base", 4, 8], ["P003", "base", 2, 4]],
  }),
  C({
    id: "C12", code: "PX12", name: "品香炸雞", segment: "炸物店", subType: "炸雞", ownerName: "何建良", onboardedAt: "2022-10-03", accountManagerId: "u-sales",
    contactName: "何先生", phone: "02-0000-2212", address: "台中市太平區示範復興路 12 號", district: "太平區",
    lineUserId: "U-demo-pinxiang", linkStatus: "linked", settlementTerms: "monthly", invoiceClass: "B2B", taxId: "00001171", priceTier: "standard",
    geo: { lat: 24.122, lng: 120.728 }, window: { start: "09:00", end: "12:00" }, vehicle: "B", days: [2, 5, 6],
    basket: [["P001", "base", 8, 14], ["P009", "base", 4, 8], ["P003", "pack", 1, 2], ["P008", "base", 2, 4]],
  }),
];

/** Today's (demo day) order lines — fixed so the walkthrough is identical every time. */
export const TODAY_ORDERS: Record<string, [string, "base" | "pack", number][]> = {
  C01: [["P001", "base", 16], ["P009", "base", 6], ["P003", "pack", 2], ["P013", "base", 3]],
  C02: [["P002", "base", 14], ["P005", "base", 6], ["P011", "base", 4]],
  C03: [["P004", "base", 12], ["P007", "base", 6], ["P003", "base", 4]],
  C04: [["P003", "pack", 6], ["P006", "base", 8], ["P014", "base", 3]],
  C05: [["P006", "base", 11], ["P005", "base", 6], ["P002", "base", 3]],
  C06: [["P005", "base", 20], ["P001", "base", 10], ["P012", "base", 4], ["P011", "base", 6]],
  C07: [["P008", "base", 7], ["P001", "base", 4], ["P010", "base", 3]],
  C08: [["P007", "base", 9], ["P002", "base", 6], ["P012", "base", 3]],
  C09: [["P009", "base", 4], ["P010", "base", 4], ["P013", "base", 2]],
  C10: [["P002", "base", 12], ["P012", "base", 4], ["P007", "base", 4]],
  C11: [["P001", "base", 6], ["P004", "base", 6], ["P003", "base", 2]],
  C12: [["P001", "base", 10], ["P009", "base", 6], ["P003", "pack", 1], ["P008", "base", 3]],
};

/** Initial (pre-optimisation) stop order. 巷口炸物 habitually rides on B — the inefficiency AI spots. */
export const TODAY_SEQUENCE: Record<"A" | "B", string[]> = {
  A: ["C09", "C05", "C01", "C11", "C03"],
  B: ["C10", "C07", "C06", "C12", "C04", "C08", "C02"],
};

const N = (id: string, customerId: string, at: string, kind: CustomerNote["kind"], text: string, followUpOn?: string): CustomerNote => ({ id, customerId, at, authorId: "u-sales", authorName: "吳佩珊", kind, text, followUpOn });

/** 業務往來紀錄（示範）。 */
export const CRM_NOTES: CustomerNote[] = [
  N("note-1", "C01", "2026-10-02T15:20:00+08:00", "visit", "拜訪林老闆，下個月想試賣黃金魚排，先寄樣品 2 包。", "2026-10-28"),
  N("note-2", "C10", "2026-10-15T10:05:00+08:00", "call", "提醒 8–9 月帳款，江先生說月底前一次匯清。", "2026-10-27"),
  N("note-3", "C06", "2026-10-21T16:40:00+08:00", "line", "陳小姐確認 10/21 那筆 NT$8,600 是用負責人個人帳戶匯的，請會計沖帳。"),
  N("note-4", "C07", "2026-10-18T11:30:00+08:00", "call", "小吳反映週六收貨太晚，希望 11:30 前送到。", "2026-10-25"),
  N("note-5", "C11", "2026-08-20T14:00:00+08:00", "visit", "新客戶開戶完成，習慣用 LINE 下單，日結收現。"),
  N("note-6", "C09", "2026-10-09T09:15:00+08:00", "call", "蔡老闆尚未加入官方帳號，下次送貨時請司機協助綁定 LINE。", "2026-10-26"),
];

/**
 * 合約價 promised to customers. [customerId, productId, amount (whole TWD, as quoted), unit, taxIncluded, effectiveFrom | null = onboarding date, note]
 * 阿宏鹹酥雞 (C03) intentionally has none — it is the tier-price reference customer in the tests.
 * 長青自助餐 黃金魚排 is deliberately below standard cost (demo of the margin warning).
 */
export const AGREED_PRICES: [string, string, number, "base" | "pack", boolean, string | null, string][] = [
  ["C01", "P001", 152, "base", false, null, "開戶約定"],
  ["C01", "P001", 148, "base", false, "2026-09-01", "叫貨量增加，重新議價"],
  ["C01", "P009", 1680, "pack", true, null, "以箱報價（含稅）"],
  ["C01", "P003", 125, "base", false, null, "開戶約定"],
  ["C02", "P002", 2289, "pack", true, null, "以箱報價（含稅）"],
  ["C02", "P005", 118, "base", false, null, "開戶約定"],
  ["C04", "P006", 140, "base", false, null, "蔬食品項整批約定"],
  ["C04", "P014", 150, "base", false, null, "蔬食品項整批約定"],
  ["C06", "P005", 112, "base", false, null, "自助餐大量用"],
  ["C06", "P001", 155, "base", false, null, "開戶約定"],
  ["C06", "P012", 138, "base", false, null, "老客戶讓利（低於成本，待檢討）"],
  ["C08", "P007", 90, "base", false, null, "開戶約定"],
  ["C08", "P002", 215, "base", false, null, "開戶約定"],
  ["C12", "P001", 150, "base", false, null, "開戶約定"],
  ["C12", "P009", 168, "base", false, null, "開戶約定"],
  ["C12", "P003", 780, "pack", false, null, "以箱報價（未稅）"],
];
