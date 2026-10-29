import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/insights/route";
import { buildDataset, buildRequest, resolveRange } from "../insights/dataset";
import { localDataSource } from "../insights/dataSource";
import { generateInsights, rulesModel, type InsightsModel } from "../insights/engine";
import { INSIGHTS_SYSTEM_PROMPT, insightsUserMessage } from "../insights/prompt";
import { composeWithRules } from "../insights/rules";
import { RANGE_PRESETS, TOPICS, reportDraftSchema, type ReportDraft } from "../insights/types";
import { renderText, UNVERIFIED, validateDraft } from "../insights/validate";
import { buildSeed } from "../seed";

const TODAY = "2026-10-24";
const dataset = (topic = "overview" as const, includesMargin = true, preset = "mtd" as const) => {
  const db = buildSeed();
  return buildDataset(localDataSource(db), buildRequest(topic, preset, TODAY), { asOf: TODAY, includesMargin });
};

describe("ranges", () => {
  it("compare month-to-date with the same days of last month", () => {
    expect(resolveRange("mtd", TODAY)).toMatchObject({ range: { from: "2026-10-01", to: "2026-10-24" }, compare: { from: "2026-09-01", to: "2026-09-24" } });
    expect(resolveRange("lastMonth", TODAY)).toMatchObject({ range: { from: "2026-09-01", to: "2026-09-30" }, compare: { from: "2026-08-01", to: "2026-08-31" } });
    expect(resolveRange("last4w", TODAY)).toMatchObject({ range: { from: "2026-09-27", to: TODAY }, compare: { from: "2026-08-30", to: "2026-09-26" } });
  });

  it("drops the comparison when there is no history for it", async () => {
    const d = await dataset("overview", true, "last3m" as never);
    expect(d.facts.some((f) => f.id === "rev.change")).toBe(false);
    expect(d.dataNotes.join()).toContain("沒有資料");
  });
});

describe("dataset", () => {
  it("is built from the same numbers as the screens and logs every query", async () => {
    const d = await dataset();
    const rev = d.facts.find((f) => f.id === "rev.now")!;
    expect(rev.value).toBe(37844000);
    expect(rev.display).toBe("NT$378,440");
    expect(d.queries.map((q) => q.name)).toContain("進銷存");
    expect(d.queries.every((q) => q.source.includes("示範"))).toBe(true);
  });

  it("removes cost, margin and below-cost prices for viewers without margin permission — before any model sees it", async () => {
    const d = await dataset("overview", false);
    const leaked = d.facts.filter((f) => /^gp\.|^gm\.|\.gm$|\.gp$|\.cost$|stock\..*_value|\.price$/.test(f.id));
    expect(leaked).toEqual([]);
    expect(d.tables.flatMap((t) => t.columns.map((c) => c.key))).not.toContain("gm");
    expect(d.charts.weekly.every((w) => w.cost === 0 && w.profit === 0)).toBe(true);
    expect(insightsUserMessage(d)).not.toMatch(/毛利率|成本 NT/);
  });
});

describe("rules composer", () => {
  it("produces a schema-valid draft that passes validation for every topic and range", async () => {
    for (const topic of TOPICS)
      for (const preset of RANGE_PRESETS)
        for (const margin of [true, false]) {
          const d = await buildDataset(localDataSource(buildSeed()), buildRequest(topic, preset, TODAY), { asOf: TODAY, includesMargin: margin });
          const draft = composeWithRules(d);
          expect(reportDraftSchema.safeParse(draft).success).toBe(true);
          const v = validateDraft(draft, d);
          expect(v.issues, `${topic}/${preset}/${margin}`).toEqual([]);
          expect(draft.findings.length + draft.sections.length).toBeGreaterThan(0);
        }
  });

  it("surfaces the planted problems: below-cost agreed price and overdue receivables", async () => {
    const d = await dataset();
    const draft = composeWithRules(d);
    const facts = new Map(d.facts.map((f) => [f.id, f]));
    const text = draft.findings.map((f) => `${f.title} ${renderText(f.detail, facts)}`).join("\n");
    expect(text).toContain("長青自助餐 的 黃金魚排 合約價低於成本");
    expect(text).toContain("逾期");
  });
});

describe("validator", () => {
  const base = (): ReportDraft => ({
    title: "t",
    headline: "營收 [[rev.now]]。",
    kpiFactIds: ["rev.now"],
    sections: [{ title: "s", body: "ok [[rev.now]]", chart: null, table: null }],
    findings: [{ severity: "info", title: "f", detail: "營收 [[rev.now]]", factIds: ["rev.now"], customerId: null, productId: null }],
    recommendations: [{ priority: "low", text: "r [[rev.now]]", factIds: ["rev.now"] }],
    caveats: [],
  });

  it("drops findings that type numbers by hand or cite unknown facts, and masks prose", async () => {
    const d = await dataset();
    const draft = base();
    draft.headline = "營收大約 380,000 元";
    draft.findings.push({ severity: "warn", title: "編造", detail: "毛利率 31.2%", factIds: [], customerId: null, productId: null });
    draft.findings.push({ severity: "warn", title: "亂引", detail: "[[rev.imaginary]]", factIds: [], customerId: null, productId: null });
    draft.findings.push({ severity: "warn", title: "亂客戶", detail: "[[rev.now]]", factIds: ["rev.now"], customerId: "C99", productId: null });
    draft.kpiFactIds.push("nope");
    const v = validateDraft(draft, d);
    expect(v.dropped).toBe(3);
    expect(v.draft.findings).toHaveLength(1);
    expect(v.draft.headline).toContain(UNVERIFIED);
    expect(v.draft.kpiFactIds).toEqual(["rev.now"]);
    expect(v.issues.length).toBeGreaterThanOrEqual(5);
  });

  it("allows months and short dates in prose", async () => {
    const d = await dataset();
    const draft = base();
    draft.headline = "10 月與 9/24 相比，營收 [[rev.now]]。";
    expect(validateDraft(draft, d).issues).toEqual([]);
  });
});

describe("engine", () => {
  it("falls back to the rules when the AI model fails, and says so", async () => {
    const broken: InsightsModel = { mode: "claude", name: "x", compose: async () => Promise.reject(new Error("離線")) };
    const db = buildSeed();
    const steps: string[] = [];
    const r = await generateInsights({ request: buildRequest("customers", "mtd", TODAY), source: localDataSource(db), model: broken, asOf: TODAY, includesMargin: true, generatedBy: "t", now: "n", id: "r1", onStep: (s) => steps.push(s) });
    expect(r.provenance.model).toMatchObject({ mode: "rules", fellBackFrom: "claude", fallbackReason: "離線" });
    expect(r.provenance.validation.passed).toBe(true);
    expect(steps).toEqual(["data", "compose", "compose", "validate", "done"]);
  });

  it("uses the rules model as-is", async () => {
    const r = await generateInsights({ request: buildRequest("inventory", "last4w", TODAY), source: localDataSource(buildSeed()), model: rulesModel, asOf: TODAY, includesMargin: true, generatedBy: "t", now: "n", id: "r2" });
    expect(r.provenance.model.fellBackFrom).toBeUndefined();
    expect(r.draft.sections.some((s) => s.table === "stock")).toBe(true);
  });
});

describe("POST /api/insights", () => {
  afterEach(() => vi.unstubAllEnvs());
  const post = (body: unknown) => POST(new Request("http://x/api/insights", { method: "POST", body: JSON.stringify(body) }));

  it("is off unless the server opts in, so the demo never sends data out", async () => {
    vi.stubEnv("INSIGHTS_MODEL", "");
    const res = await post({ dataset: await dataset() });
    expect(res.status).toBe(501);
    expect((await res.json()).error).toBe("not_configured");
  });

  it("rejects a malformed dataset before calling the model", async () => {
    vi.stubEnv("INSIGHTS_MODEL", "claude");
    expect((await post({ dataset: { nope: 1 } })).status).toBe(400);
  });

  it("keeps the system prompt free of per-request values (cache-stable)", () => {
    expect(INSIGHTS_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}|NT\$/);
  });
});
