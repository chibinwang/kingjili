import type { Db } from "../db";
import { customerAr, type AgingBucket } from "../domain/ar";
import { agreementSummary } from "../domain/pricing";
import { periodPnl, stockMovement, weeklyPnl, type PeriodPnl, type StockMovement, type WeekPnl } from "../domain/reports";
import type { Cents } from "../money";
import type { Customer, Product } from "../domain/types";
import type { DataMode } from "./types";

/**
 * Where the insights report reads its numbers from. Every method is async and returns plain rows,
 * so a production adapter can answer each one with a SQL query or an HTTP call.
 * The query contract (shapes + reference SQL) is in docs/INSIGHTS.md.
 */
export interface InsightsDataSource {
  readonly mode: DataMode;
  readonly label: string;
  directory(): Promise<{ customers: Pick<Customer, "id" | "name" | "segment" | "settlementTerms" | "priceTier">[]; products: Pick<Product, "id" | "name" | "category" | "baseUnit" | "costCents">[] }>;
  periodPnl(from: string, to: string): Promise<PeriodPnl>;
  weeklyPnl(to: string, weeks: number): Promise<WeekPnl[]>;
  stockMovement(from: string, to: string): Promise<StockMovement>;
  receivables(asOf: string): Promise<{ customerId: string; balance: Cents; overdue: Cents; buckets: Record<AgingBucket, Cents>; oldestDue?: string }[]>;
  agreements(asOf: string): Promise<{ customerId: string; count: number; avgDiscountBp: number; belowCost: { productId: string; cents: Cents; costCents: Cents }[] }[]>;
}

/** Demo adapter: answers every query from the in-browser store with the same domain functions the screens use. */
export function localDataSource(db: Db): InsightsDataSource {
  return {
    mode: "local",
    label: "示範資料庫（瀏覽器本機）",
    async directory() {
      return {
        customers: db.customers.map(({ id, name, segment, settlementTerms, priceTier }) => ({ id, name, segment, settlementTerms, priceTier })),
        products: db.products.map(({ id, name, category, baseUnit, costCents }) => ({ id, name, category, baseUnit, costCents })),
      };
    },
    async periodPnl(from, to) {
      return periodPnl(db.arDocs, db.products, from, to);
    },
    async weeklyPnl(to, weeks) {
      return weeklyPnl(db.arDocs, db.products, to, weeks);
    },
    async stockMovement(from, to) {
      return stockMovement({ products: db.products, lots: db.lots, purchaseOrders: db.purchaseOrders, adjustments: db.adjustments, docs: db.arDocs, from, to });
    },
    async receivables(asOf) {
      return db.customers.map((c) => {
        const r = customerAr(c, db.arDocs, db.payments, db.allocations, asOf);
        return { customerId: c.id, balance: r.balance, overdue: r.overdue, buckets: r.buckets, oldestDue: r.oldestDue };
      });
    },
    async agreements(asOf) {
      return db.customers.map((c) => {
        const s = agreementSummary(db.customerPrices, c, db.products, asOf);
        return {
          customerId: c.id,
          count: s.lines.length,
          avgDiscountBp: s.avgDiscountBp,
          belowCost: s.lines.filter((l) => l.belowCost).map((l) => ({ productId: l.product.id, cents: l.cents, costCents: l.product.costCents! })),
        };
      });
    },
  };
}

export class DataSourceNotConfigured extends Error {}

/**
 * Production adapter skeleton: the same queries over HTTP (e.g. a reporting service in front of the ERP database).
 * Each method maps to one GET endpoint documented in docs/INSIGHTS.md. Not used by the demo.
 */
export function httpDataSource(baseUrl: string | undefined, init?: RequestInit): InsightsDataSource {
  const get = async <T,>(path: string, params: Record<string, string | number>): Promise<T> => {
    if (!baseUrl) throw new DataSourceNotConfigured("尚未設定報表資料來源（NEXT_PUBLIC_INSIGHTS_DATA_URL）");
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}?${qs}`, { ...init, headers: { accept: "application/json", ...init?.headers } });
    if (!res.ok) throw new Error(`報表資料來源回應 ${res.status}（${path}）`);
    return (await res.json()) as T;
  };
  return {
    mode: "http",
    label: baseUrl ? `報表服務 ${new URL(baseUrl).host}` : "報表服務（未設定）",
    directory: () => get("/insights/directory", {}),
    periodPnl: (from, to) => get("/insights/pnl", { from, to }),
    weeklyPnl: (to, weeks) => get("/insights/pnl/weekly", { to, weeks }),
    stockMovement: (from, to) => get("/insights/stock-movement", { from, to }),
    receivables: (asOf) => get("/insights/receivables", { asOf }),
    agreements: (asOf) => get("/insights/agreements", { asOf }),
  };
}
