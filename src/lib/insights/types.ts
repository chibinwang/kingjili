import { z } from "zod";

/**
 * Insights report contracts. The flow is:
 *   request → InsightsDataSource (ledger queries) → InsightsDataset (facts with ids) → InsightsModel (writes a draft
 *   that may only cite facts by id) → validateDraft → InsightsReport (rendered).
 * Numbers in a report always come from the dataset, never from the model's own text — that is what the
 * [[fact.id]] citation format and the validator enforce. Charts and tables are built from the dataset in code.
 */

export const TOPICS = ["overview", "customers", "products", "inventory", "receivables"] as const;
export type InsightsTopic = (typeof TOPICS)[number];
export const TOPIC_LABEL: Record<InsightsTopic, string> = {
  overview: "整體經營",
  customers: "客戶獲利",
  products: "品項與毛利",
  inventory: "進銷存",
  receivables: "應收與收款",
};

export const RANGE_PRESETS = ["mtd", "last4w", "lastMonth", "last3m"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export interface DateRange {
  from: string;
  to: string;
  label: string;
}

export interface InsightsRequest {
  topic: InsightsTopic;
  preset: RangePreset;
  range: DateRange;
  /** Same-length earlier window for comparison; null when there is no history to compare against. */
  compare: DateRange | null;
  /** Optional free-text focus from the user, passed to the model as-is. */
  question?: string;
}

export type FactUnit = "twd" | "pct" | "qty" | "count" | "days";

/** One number the report may cite. `display` is the only form the reader ever sees. */
export interface Fact {
  id: string;
  label: string;
  value: number;
  unit: FactUnit;
  display: string;
}

export type ChartId = "weekly_pnl" | "customer_revenue" | "category_mix" | "stock_cover" | "ar_aging";
export type TableId = "customers" | "products" | "stock" | "receivables" | "agreements";
export const CHART_IDS = ["weekly_pnl", "customer_revenue", "category_mix", "stock_cover", "ar_aging"] as const satisfies readonly ChartId[];
export const TABLE_IDS = ["customers", "products", "stock", "receivables", "agreements"] as const satisfies readonly TableId[];

export interface DatasetTable {
  id: TableId;
  title: string;
  columns: { key: string; label: string; align?: "right" }[];
  rows: Record<string, string>[];
}

export interface WeeklyPoint {
  weekStart: string;
  weekEnd: string;
  partial: boolean;
  revenue: number;
  cost: number;
  profit: number;
  uncosted: number;
}

export interface DatasetCharts {
  weekly: WeeklyPoint[];
  customerRevenue: { id: string; name: string; revenue: number; marginBp: number | null; contract: boolean }[];
  categoryMix: { category: string; revenue: number }[];
  stockCover: { id: string; name: string; days: number | null; closingQty: number; unit: string }[];
  arAging: { bucket: string; cents: number }[];
}

/** Which query ran, against what, how long it took — shown in the report's provenance footer. */
export interface QueryLog {
  name: string;
  source: string;
  ms: number;
  rows: number;
}

export interface InsightsDataset {
  request: InsightsRequest;
  asOf: string;
  /** Margin, cost and below-cost data are removed before the model sees anything when the viewer may not see them. */
  includesMargin: boolean;
  facts: Fact[];
  tables: DatasetTable[];
  charts: DatasetCharts;
  /** Entities the model may link to. */
  entities: { customers: { id: string; name: string }[]; products: { id: string; name: string }[] };
  /** Known limitations of the data, always shown with the report. */
  dataNotes: string[];
  queries: QueryLog[];
}

/* ───────── What the model returns (validated with zod, also used as the structured-output schema) ───────── */

const cited = z.string().describe("Plain zh-TW text. Every number must be a [[fact_id]] citation — never type digits, amounts or percentages yourself.");

export const reportDraftSchema = z.object({
  title: z.string().describe("Short report title, zh-TW"),
  headline: cited.describe("One or two sentences: the single most important takeaway, with [[fact_id]] citations"),
  kpiFactIds: z.array(z.string()).describe("3–6 fact ids to show as headline numbers, most important first"),
  sections: z
    .array(
      z.object({
        title: z.string(),
        body: cited,
        chart: z.enum(CHART_IDS).nullable().describe("A chart built from the dataset to show with this section, or null"),
        table: z.enum(TABLE_IDS).nullable().describe("A table from the dataset to show with this section, or null"),
      }),
    )
    .describe("2–4 sections"),
  findings: z
    .array(
      z.object({
        severity: z.enum(["good", "info", "warn", "risk"]),
        title: z.string(),
        detail: cited,
        factIds: z.array(z.string()).describe("Every fact this finding relies on"),
        customerId: z.string().nullable().describe("Customer id this finding is about, or null"),
        productId: z.string().nullable().describe("Product id this finding is about, or null"),
      }),
    )
    .describe("3–8 specific, evidence-backed observations, most important first"),
  recommendations: z
    .array(
      z.object({
        priority: z.enum(["high", "medium", "low"]),
        text: cited.describe("A concrete next step a manager can take this week"),
        factIds: z.array(z.string()),
      }),
    )
    .describe("2–5 recommendations"),
  caveats: z.array(z.string()).describe("Limits of this analysis the reader should know, beyond the dataset's own data notes"),
});
export type ReportDraft = z.infer<typeof reportDraftSchema>;

/* ───────── The rendered report ───────── */

export interface ValidationIssue {
  where: string;
  message: string;
}

export interface InsightsReport {
  id: string;
  generatedAt: string;
  generatedBy: string;
  request: InsightsRequest;
  draft: ReportDraft;
  dataset: InsightsDataset;
  provenance: {
    model: { mode: ModelMode; name: string; ms: number; fellBackFrom?: ModelMode; fallbackReason?: string };
    data: { mode: DataMode; label: string };
    validation: { passed: boolean; issues: ValidationIssue[]; dropped: number };
  };
}

export type ModelMode = "rules" | "claude";
export type DataMode = "local" | "http";
