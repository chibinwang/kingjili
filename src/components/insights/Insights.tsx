"use client";

import { ArrowUpRight, BarChart3, Check as CheckIcon, ChevronDown, Copy, Database, FileText, Loader2, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { RevenueProfitChart } from "@/components/charts/RevenueProfitChart";
import { Badge, Bar, Button, Input, Modal } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { WeekPnl } from "@/lib/domain/reports";
import { PRESET_LABEL } from "@/lib/insights/dataset";
import type { InsightsStep } from "@/lib/insights/engine";
import { PRIORITY_LABEL, SEVERITY_LABEL } from "@/lib/insights/labels";
import { RANGE_PRESETS, TOPIC_LABEL, TOPICS, type ChartId, type DatasetTable, type Fact, type InsightsDataset, type InsightsReport, type InsightsTopic, type RangePreset, type ReportDraft } from "@/lib/insights/types";
import { renderText, segments } from "@/lib/insights/validate";
import { formatCompactTWD, formatTWD } from "@/lib/money";
import { formatDateTime } from "@/lib/time";

/* ───────── launcher ───────── */

const TOPIC_HINT: Record<InsightsTopic, string> = {
  overview: "營收、毛利、客戶、收款一次看",
  customers: "誰在成長、誰在流失、誰不賺錢",
  products: "品類組成、品項毛利與銷售變化",
  inventory: "進銷存、可用天數、帳實不符",
  receivables: "逾期、帳齡、溢收",
};

export function InsightsLauncher({ onRun, busy }: { onRun: (topic: InsightsTopic, preset: RangePreset, question: string) => void; busy: boolean }) {
  const [topic, setTopic] = useState<InsightsTopic>("overview");
  const [preset, setPreset] = useState<RangePreset>("mtd");
  const [q, setQ] = useState("");
  return (
    <div className="rounded-[14px] border border-ai/25 bg-surface p-3.5" data-testid="insights-launcher">
      <div className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-ink">
        <BarChart3 size={15} className="text-ai" /> 洞察報告
        <span className="font-normal text-muted">從帳本拉出過去資料，整理成可以做決定的重點</span>
      </div>
      <div className="mb-1 text-[11.5px] text-muted">主題</div>
      <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="報告主題">
        {TOPICS.map((t) => (
          <button
            key={t}
            role="radio"
            aria-checked={topic === t}
            onClick={() => setTopic(t)}
            className={cn("rounded-[10px] border px-2.5 py-2 text-left transition-colors", topic === t ? "border-ai bg-ai-soft" : "border-line hover:border-ai/40", t === "overview" && "col-span-2")}
          >
            <div className={cn("text-[12.5px] font-medium", topic === t ? "text-ai" : "text-ink")}>{TOPIC_LABEL[t]}</div>
            <div className="text-[11px] text-muted">{TOPIC_HINT[t]}</div>
          </button>
        ))}
      </div>
      <div className="mt-2.5 mb-1 text-[11.5px] text-muted">期間（自動與前一段等長期間比較）</div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="期間">
        {RANGE_PRESETS.map((p) => (
          <button key={p} role="radio" aria-checked={preset === p} onClick={() => setPreset(p)} className={cn("rounded-full border px-2.5 py-1 text-[12px]", preset === p ? "border-ai bg-ai text-white" : "border-line text-ink-2 hover:border-ai/40")}>
            {PRESET_LABEL[p]}
          </button>
        ))}
      </div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="想特別了解什麼？（選填，例如：哪些客戶最近叫貨變少）" className="mt-2.5 h-9 text-[12.5px]" aria-label="想了解的問題" />
      <Button variant="primary" className="mt-2.5 w-full bg-ai hover:bg-ai/90" disabled={busy} onClick={() => onRun(topic, preset, q)}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} 產生報告
      </Button>
    </div>
  );
}

/* ───────── progress ───────── */

const STEP_LABEL: Record<Exclude<InsightsStep, "done">, string> = { data: "讀取帳本資料", compose: "撰寫分析", validate: "核對每個數字" };

export function InsightsProgress({ step, detail }: { step: InsightsStep; detail?: string }) {
  const order: InsightsStep[] = ["data", "compose", "validate", "done"];
  const at = order.indexOf(step);
  return (
    <div className="rounded-[12px] border border-line bg-surface px-3.5 py-2.5 text-[12.5px]" aria-live="polite">
      {(["data", "compose", "validate"] as const).map((s, i) => (
        <div key={s} className={cn("flex items-center gap-2 py-0.5", i < at ? "text-ok" : i === at ? "text-ai" : "text-faint")}>
          {i < at ? <CheckIcon size={13} /> : i === at ? <Loader2 size={13} className="animate-spin" /> : <span className="h-[13px] w-[13px]" />}
          {STEP_LABEL[s]}
          {i === at && detail && <span className="text-muted">・{detail}</span>}
        </div>
      ))}
    </div>
  );
}

/* ───────── citations ───────── */

function Cited({ text, facts, className }: { text: string; facts: Map<string, Fact>; className?: string }) {
  return (
    <span className={className}>
      {segments(text, facts).map((s, i) =>
        "text" in s ? (
          <span key={i}>{s.text}</span>
        ) : "fact" in s ? (
          <span key={i} title={s.fact.label} className="num font-semibold whitespace-nowrap text-ink underline decoration-ai/30 decoration-dotted underline-offset-[3px]">
            {s.fact.display}
          </span>
        ) : (
          <span key={i} className="text-bad" title={`找不到數據 ${s.missing}`}>
            〔未驗證數字〕
          </span>
        ),
      )}
    </span>
  );
}

const SEV_TONE = { good: "ok", info: "info", warn: "warn", risk: "bad" } as const;

function KpiGrid({ ids, facts, max, compact }: { ids: string[]; facts: Map<string, Fact>; max?: number; compact?: boolean }) {
  const list = ids.map((id) => facts.get(id)).filter((f): f is Fact => !!f).slice(0, max);
  return (
    <div className={cn("grid grid-cols-2 gap-2", !compact && "sm:grid-cols-3")}>
      {list.map((f) => (
        <div key={f.id} className="min-w-0 rounded-[10px] bg-sunk px-3 py-2">
          <div className="truncate text-[11px] text-muted" title={f.label}>
            {f.label}
          </div>
          <div className={cn("num text-[16px] leading-tight font-semibold", f.unit === "pct" && f.display.startsWith("−") && "text-bad", f.unit === "pct" && f.display.startsWith("+") && "text-ok")}>
            {f.unit === "twd" ? formatCompactTWD(f.value) : f.display}
          </div>
        </div>
      ))}
    </div>
  );
}

function entityHref(f: ReportDraft["findings"][number]): string | null {
  if (f.customerId) return `/customers?tab=crm&open=${f.customerId}`;
  if (f.productId) return `/inventory?sku=${f.productId}`;
  return null;
}

function Findings({ items, facts, onNavigate }: { items: ReportDraft["findings"]; facts: Map<string, Fact>; onNavigate?: () => void }) {
  return (
    <ul className="space-y-2">
      {items.map((f, i) => {
        const href = entityHref(f);
        return (
          <li key={i} className="rounded-[10px] border border-line px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
                <Badge tone={SEV_TONE[f.severity]}>{SEVERITY_LABEL[f.severity]}</Badge>
                {f.title}
              </div>
              {href && (
                <Link href={href} onClick={onNavigate} className="shrink-0 text-[11.5px] text-muted hover:text-ai" aria-label={`查看 ${f.title}`}>
                  查看 <ArrowUpRight size={11} className="inline" />
                </Link>
              )}
            </div>
            <Cited text={f.detail} facts={facts} className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-2" />
          </li>
        );
      })}
    </ul>
  );
}

function Recommendations({ items, facts }: { items: ReportDraft["recommendations"]; facts: Map<string, Fact> }) {
  return (
    <ol className="space-y-1.5">
      {items.map((r, i) => (
        <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed">
          <span className={cn("mt-[1px] h-fit shrink-0 rounded-full px-1.5 text-[10.5px] font-semibold", r.priority === "high" ? "bg-bad-soft text-bad" : r.priority === "medium" ? "bg-warn-soft text-warn" : "bg-sunk text-muted")}>{PRIORITY_LABEL[r.priority]}</span>
          <Cited text={r.text} facts={facts} className="text-ink-2" />
        </li>
      ))}
    </ol>
  );
}

function ProvenanceChip({ r }: { r: InsightsReport }) {
  const v = r.provenance.validation;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
      <span className="inline-flex items-center gap-1">
        <Database size={11} /> {r.provenance.data.label}
      </span>
      <span className="inline-flex items-center gap-1">
        <Sparkles size={11} /> {r.provenance.model.name}
      </span>
      <span className={cn("inline-flex items-center gap-1", v.passed ? "text-ok" : "text-warn")}>
        {v.passed ? <ShieldCheck size={11} /> : <ShieldAlert size={11} />}
        {v.passed ? "數字全數來自帳本" : `${v.issues.length} 項未通過驗證${v.dropped ? `，已移除 ${v.dropped} 則` : ""}`}
      </span>
    </div>
  );
}

/* ───────── compact card in the chat ───────── */

export function InsightsReportCard({ report, onOpen }: { report: InsightsReport; onOpen: () => void }) {
  const facts = useMemo(() => new Map(report.dataset.facts.map((f) => [f.id, f])), [report]);
  const d = report.draft;
  return (
    <div className="space-y-3 rounded-[14px] border border-line bg-surface p-3.5" data-testid="insights-card">
      <div>
        <div className="flex items-center gap-1.5 text-[11.5px] text-ai">
          <BarChart3 size={13} /> {report.request.range.label}
        </div>
        <div className="mt-0.5 text-[14px] font-semibold text-ink">{d.title}</div>
        <Cited text={d.headline} facts={facts} className="mt-1 block text-[13px] leading-relaxed text-ink-2" />
      </div>
      <KpiGrid ids={d.kpiFactIds} facts={facts} max={4} compact />
      {d.findings.length > 0 && <Findings items={d.findings.slice(0, 3)} facts={facts} />}
      {report.provenance.model.fellBackFrom && <div className="rounded-lg bg-warn-soft px-2.5 py-1.5 text-[11.5px] text-warn">AI 服務無法使用（{report.provenance.model.fallbackReason}），本報告由離線規則引擎產生。</div>}
      <div className="flex items-center justify-between gap-2 border-t border-line pt-2.5">
        <ProvenanceChip r={report} />
        <Button size="sm" variant="outline" onClick={onOpen}>
          <FileText size={13} /> 完整報告
        </Button>
      </div>
    </div>
  );
}

/* ───────── full report ───────── */

export function InsightsReportModal({ report, onClose }: { report: InsightsReport; onClose: () => void }) {
  const facts = useMemo(() => new Map(report.dataset.facts.map((f) => [f.id, f])), [report]);
  const d = report.draft;
  const [showSources, setShowSources] = useState(false);
  const copy = async () => {
    const lines = [
      `${d.title}（${report.request.range.label}）`,
      renderText(d.headline, facts),
      "",
      "重點發現",
      ...d.findings.map((f) => `・${f.title}：${renderText(f.detail, facts)}`),
      "",
      "建議",
      ...d.recommendations.map((r, i) => `${i + 1}. ${renderText(r.text, facts)}`),
      "",
      `資料：${report.provenance.data.label}・${formatDateTime(report.generatedAt)}・示範資料`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("已複製報告摘要");
    } catch {
      toast.error("無法存取剪貼簿");
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={920}
      title={
        <span className="inline-flex items-center gap-2">
          <BarChart3 size={17} className="text-ai" /> {d.title}
        </span>
      }
      sub={`${report.request.range.label}${report.request.compare && facts.has("rev.change") ? `・對照 ${report.request.compare.label}` : ""}・${report.generatedBy} 於 ${formatDateTime(report.generatedAt)} 產生`}
      footer={
        <>
          <div className="mr-auto">
            <ProvenanceChip r={report} />
          </div>
          <Button variant="outline" onClick={copy}>
            <Copy size={13} /> 複製摘要
          </Button>
          <Button variant="primary" onClick={onClose}>
            關閉
          </Button>
        </>
      }
    >
      <div className="space-y-5" data-testid="insights-report">
        {report.request.question && <div className="rounded-lg bg-ai-soft px-3 py-2 text-[12.5px] text-ai">你的問題：{report.request.question}</div>}
        <Cited text={d.headline} facts={facts} className="block text-[15px] leading-relaxed text-ink" />
        <KpiGrid ids={d.kpiFactIds} facts={facts} />

        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-5">
            {d.sections.map((s, i) => (
              <section key={i} className="space-y-2">
                <h3 className="text-[14px] font-semibold text-ink">{s.title}</h3>
                {s.body && <Cited text={s.body} facts={facts} className="block text-[13px] leading-relaxed text-ink-2" />}
                {s.chart && <ReportChart id={s.chart} d={report.dataset} />}
                {s.table && <ReportTable t={report.dataset.tables.find((t) => t.id === s.table)} />}
              </section>
            ))}
          </div>
          <aside className="space-y-4">
            {d.findings.length > 0 && (
              <div>
                <h3 className="mb-2 text-[13px] font-semibold text-ink">重點發現</h3>
                <Findings items={d.findings} facts={facts} onNavigate={onClose} />
              </div>
            )}
            {d.recommendations.length > 0 && (
              <div>
                <h3 className="mb-2 text-[13px] font-semibold text-ink">建議下一步</h3>
                <Recommendations items={d.recommendations} facts={facts} />
              </div>
            )}
          </aside>
        </div>

        <div className="rounded-[12px] border border-line bg-sunk px-4 py-3 text-[12px] text-muted">
          <div className="mb-1 font-medium text-ink-2">資料說明</div>
          <ul className="list-disc space-y-0.5 pl-4">
            {[...report.dataset.dataNotes, ...d.caveats].map((n, i) => (
              <li key={i}>{n}</li>
            ))}
            <li>所有數字為示範資料，非金吉利實際財務數字。</li>
          </ul>
          <button onClick={() => setShowSources((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-ink-2 hover:text-ink" aria-expanded={showSources}>
            <ChevronDown size={13} className={cn("transition-transform", !showSources && "-rotate-90")} /> 資料來源與驗證紀錄
          </button>
          {showSources && <Sources r={report} />}
        </div>
      </div>
    </Modal>
  );
}

function Sources({ r }: { r: InsightsReport }) {
  const p = r.provenance;
  return (
    <div className="mt-2 space-y-2">
      <table className="tbl text-[11.5px]">
        <thead>
          <tr>
            <th>查詢</th>
            <th>來源</th>
            <th className="r">筆數</th>
            <th className="r">耗時</th>
          </tr>
        </thead>
        <tbody>
          {r.dataset.queries.map((q) => (
            <tr key={q.name}>
              <td>{q.name}</td>
              <td className="text-muted">{q.source}</td>
              <td className="r num">{q.rows}</td>
              <td className="r num">{q.ms} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        撰寫：{p.model.name}（{p.model.ms} ms）{p.model.fellBackFrom && `・原設定 ${p.model.fellBackFrom === "claude" ? "Claude" : p.model.fellBackFrom} 無法使用：${p.model.fallbackReason}`}
      </div>
      <div>可引用數據 {r.dataset.facts.length} 筆；{r.dataset.includesMargin ? "含成本與毛利" : "依權限不含成本與毛利"}。</div>
      {p.validation.issues.length > 0 && (
        <ul className="list-disc pl-4 text-warn">
          {p.validation.issues.map((x, i) => (
            <li key={i}>
              {x.where}：{x.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────── charts & tables (built from the dataset, never from model text) ───────── */

function ReportChart({ id, d }: { id: ChartId; d: InsightsDataset }) {
  const c = d.charts;
  if (id === "weekly_pnl") {
    const weeks: WeekPnl[] = c.weekly.map((w) => ({ weekStart: w.weekStart, weekEnd: w.weekEnd, partial: w.partial, revenue: w.revenue, cost: w.cost, profit: w.profit, uncostedRevenue: w.uncosted, costedRevenue: w.revenue - w.uncosted, credits: 0 }));
    return (
      <div className="-mx-3 rounded-[12px] border border-line pt-3">
        <RevenueProfitChart weeks={weeks} showMargin={d.includesMargin} height={220} />
      </div>
    );
  }
  const rows: { key: string; label: string; value: number; display: string; note?: string; tone: "amber" | "ok" | "bad" | "ink" | "b" }[] =
    id === "customer_revenue"
      ? c.customerRevenue.map((x) => ({ key: x.id, label: x.name, value: x.revenue, display: formatTWD(x.revenue), note: [x.contract ? "合約價" : "", x.marginBp !== null ? `毛利率 ${(x.marginBp / 100).toFixed(1)}%` : ""].filter(Boolean).join("・"), tone: "amber" }))
      : id === "category_mix"
        ? c.categoryMix.map((x) => ({ key: x.category, label: x.category, value: x.revenue, display: formatTWD(x.revenue), tone: "amber" }))
        : id === "stock_cover"
          ? c.stockCover.filter((x) => x.days !== null).map((x) => ({ key: x.id, label: x.name, value: x.days!, display: `${x.days} 天`, note: `庫存 ${x.closingQty} ${x.unit}`, tone: x.days! < 5 ? "bad" : x.days! > 45 ? "b" : "ok" }))
          : c.arAging.map((x) => ({ key: x.bucket, label: x.bucket, value: x.cents, display: formatTWD(x.cents), tone: "bad" }));
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2 rounded-[12px] border border-line px-3.5 py-3" role="list">
      {rows.map((r) => (
        <div key={r.key} role="listitem" title={`${r.label}：${r.display}${r.note ? `（${r.note}）` : ""}`}>
          <div className="mb-0.5 flex justify-between gap-2 text-[12px]">
            <span className="truncate text-ink-2">
              {r.label}
              {r.note && <span className="ml-1.5 text-faint">{r.note}</span>}
            </span>
            <span className="num shrink-0 font-medium">{r.display}</span>
          </div>
          <Bar value={r.value} max={max} tone={r.tone} />
        </div>
      ))}
    </div>
  );
}

function ReportTable({ t }: { t?: DatasetTable }) {
  if (!t) return null;
  return (
    <div className="scroll-thin max-h-[320px] overflow-auto rounded-[12px] border border-line">
      <table className="tbl text-[12px]">
        <thead className="sticky top-0 bg-surface">
          <tr>
            {t.columns.map((c) => (
              <th key={c.key} className={c.align === "right" ? "r" : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={i}>
              {t.columns.map((c) => (
                <td key={c.key} className={cn("whitespace-nowrap", c.align === "right" && "r num")}>
                  {r[c.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

