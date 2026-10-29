import { buildDataset } from "./dataset";
import type { InsightsDataSource } from "./dataSource";
import { composeWithRules } from "./rules";
import { reportDraftSchema, type InsightsDataset, type InsightsReport, type InsightsRequest, type ModelMode, type ReportDraft } from "./types";
import { validateDraft } from "./validate";

/** Something that turns a dataset into a draft report. Swap implementations without touching the UI. */
export interface InsightsModel {
  readonly mode: ModelMode;
  readonly name: string;
  compose(dataset: InsightsDataset, signal?: AbortSignal): Promise<ReportDraft>;
}

export const rulesModel: InsightsModel = {
  mode: "rules",
  name: "規則引擎（離線）",
  async compose(dataset) {
    return composeWithRules(dataset);
  },
};

export class ModelUnavailable extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Calls the server route, which holds the API key and talks to Claude. The browser never sees credentials. */
export function remoteModel(endpoint = "/api/insights"): InsightsModel {
  return {
    mode: "claude",
    name: "Claude（伺服器端）",
    async compose(dataset, signal) {
      const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataset }), signal });
      const body = (await res.json().catch(() => ({}))) as { draft?: unknown; error?: string; message?: string };
      if (!res.ok) throw new ModelUnavailable(body.message ?? `AI 服務回應 ${res.status}`, body.error ?? String(res.status));
      const parsed = reportDraftSchema.safeParse(body.draft);
      if (!parsed.success) throw new ModelUnavailable("AI 回傳格式不符", "bad_shape");
      return parsed.data;
    },
  };
}

/**
 * Which model and data source the app uses. Both default to the offline demo; switching is configuration only:
 *   NEXT_PUBLIC_INSIGHTS_MODEL=claude      → remoteModel (server also needs INSIGHTS_MODEL=claude + Anthropic credentials)
 *   NEXT_PUBLIC_INSIGHTS_DATA_URL=https://… → httpDataSource (see docs/INSIGHTS.md for the endpoint contract)
 */
export function insightsConfig(): { model: ModelMode; dataUrl?: string } {
  return { model: process.env.NEXT_PUBLIC_INSIGHTS_MODEL === "claude" ? "claude" : "rules", dataUrl: process.env.NEXT_PUBLIC_INSIGHTS_DATA_URL || undefined };
}

export type InsightsStep = "data" | "compose" | "validate" | "done";

export interface GenerateOptions {
  request: InsightsRequest;
  source: InsightsDataSource;
  model: InsightsModel;
  asOf: string;
  includesMargin: boolean;
  generatedBy: string;
  now: string;
  id: string;
  onStep?: (step: InsightsStep, detail?: string) => void;
  signal?: AbortSignal;
}

export async function generateInsights(o: GenerateOptions): Promise<InsightsReport> {
  o.onStep?.("data");
  const dataset = await buildDataset(o.source, o.request, { asOf: o.asOf, includesMargin: o.includesMargin });

  o.onStep?.("compose", o.model.name);
  const t0 = performance.now();
  let draft: ReportDraft;
  let used = o.model;
  let fallbackReason: string | undefined;
  try {
    draft = await o.model.compose(dataset, o.signal);
  } catch (e) {
    if (o.model.mode === "rules" || o.signal?.aborted) throw e;
    // the report still works offline; the reader is told it fell back and why
    fallbackReason = (e as Error).message;
    used = rulesModel;
    o.onStep?.("compose", rulesModel.name);
    draft = await rulesModel.compose(dataset);
  }
  const ms = Math.round(performance.now() - t0);

  o.onStep?.("validate");
  const v = validateDraft(draft, dataset);
  o.onStep?.("done");
  return {
    id: o.id,
    generatedAt: o.now,
    generatedBy: o.generatedBy,
    request: o.request,
    draft: v.draft,
    dataset,
    provenance: {
      model: { mode: used.mode, name: used.name, ms, ...(used !== o.model ? { fellBackFrom: o.model.mode, fallbackReason } : {}) },
      data: { mode: o.source.mode, label: o.source.label },
      validation: { passed: v.issues.length === 0, issues: v.issues, dropped: v.dropped },
    },
  };
}
