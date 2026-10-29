import type { Cents } from "../money";
import { addDays, daysBetween } from "../time";
import type { ArDocument, Customer, CustomerNote, SalesOrder } from "./types";

export type CrmStatus = "active" | "attention";
export const CRM_STATUS_LABEL: Record<CrmStatus, string> = { active: "往來中", attention: "需關注" };
export const NOTE_KIND_LABEL: Record<CustomerNote["kind"], string> = { call: "電話", visit: "拜訪", line: "LINE", note: "備註" };

/** 30 天營業額比前 30 天下滑超過此比例 → 需關注。 */
export const DECLINE_THRESHOLD_BP = 3000;

export interface CrmRow {
  customerId: string;
  tenureMonths: number;
  revenue30: Cents;
  revenuePrev30: Cents;
  /** Change vs the previous 30 days in basis points; null when there is no prior revenue. */
  trendBp: number | null;
  /** Ex-tax revenue for the last 8 weeks, oldest first. */
  weekly: Cents[];
  ordersPerWeek: number;
  lastOrderDate: string | null;
  topProducts: { productId: string; qtyBase: number }[];
  balance: Cents;
  overdue: Cents;
  status: CrmStatus;
  reasons: string[];
  nextFollowUp: string | null;
  lastNote: CustomerNote | null;
}

/** Whole months between onboarding and today. */
export function tenureMonths(since: string, today: string): number {
  const [y1, m1, d1] = since.split("-").map(Number);
  const [y2, m2, d2] = today.split("-").map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
}

export function tenureLabel(months: number): string {
  if (months < 1) return "未滿 1 個月";
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (!y) return `${m} 個月`;
  return m ? `${y} 年 ${m} 個月` : `${y} 年`;
}

export function buildCrmRow(
  c: Customer,
  ctx: { docs: ArDocument[]; orders: SalesOrder[]; notes: CustomerNote[]; balance: Cents; overdue: Cents; today: string },
): CrmRow {
  const { today } = ctx;
  const charges = ctx.docs.filter((d) => d.customerId === c.id && d.type === "charge" && d.issueDate <= today);
  const inRange = (from: string, to: string) => charges.filter((d) => d.issueDate >= from && d.issueDate <= to).reduce((a, d) => a + d.exTaxCents, 0);
  const revenue30 = inRange(addDays(today, -29), today);
  const revenuePrev30 = inRange(addDays(today, -59), addDays(today, -30));
  const trendBp = revenuePrev30 > 0 ? Math.round(((revenue30 - revenuePrev30) * 10000) / revenuePrev30) : null;
  const weekly = Array.from({ length: 8 }, (_, i) => inRange(addDays(today, -7 * (8 - i) + 1), addDays(today, -7 * (7 - i))));

  const orders = ctx.orders.filter((o) => o.customerId === c.id && o.state !== "Cancelled" && o.state !== "Draft" && o.deliveryDate <= today);
  const recent = orders.filter((o) => o.deliveryDate > addDays(today, -28));
  const lastOrderDate = orders.reduce<string | null>((a, o) => (!a || o.deliveryDate > a ? o.deliveryDate : a), null);
  const qty = new Map<string, number>();
  for (const o of orders.filter((x) => x.deliveryDate > addDays(today, -60))) for (const l of o.lines) qty.set(l.productId, (qty.get(l.productId) ?? 0) + l.qtyBase);
  const topProducts = [...qty].map(([productId, qtyBase]) => ({ productId, qtyBase })).sort((a, b) => b.qtyBase - a.qtyBase).slice(0, 5);

  const reasons: string[] = [];
  if (ctx.overdue > 0) reasons.push("有逾期帳款");
  if (trendBp !== null && trendBp <= -DECLINE_THRESHOLD_BP) reasons.push(`近 30 天叫貨下滑 ${Math.round(-trendBp / 100)}%`);
  if (lastOrderDate && daysBetween(lastOrderDate, today) > 14) reasons.push(`${daysBetween(lastOrderDate, today)} 天未叫貨`);

  const notes = ctx.notes.filter((n) => n.customerId === c.id).sort((a, b) => b.at.localeCompare(a.at));
  const nextFollowUp = notes.map((n) => n.followUpOn).filter((d): d is string => !!d && d >= today).sort()[0] ?? null;

  return {
    customerId: c.id,
    tenureMonths: tenureMonths(c.onboardedAt, today),
    revenue30,
    revenuePrev30,
    trendBp,
    weekly,
    ordersPerWeek: Math.round((recent.length / 4) * 10) / 10,
    lastOrderDate,
    topProducts,
    balance: ctx.balance,
    overdue: ctx.overdue,
    status: reasons.length ? "attention" : "active",
    reasons,
    nextFollowUp,
    lastNote: notes[0] ?? null,
  };
}
