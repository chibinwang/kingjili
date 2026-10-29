"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/cn";
import { marginBp, type WeekPnl } from "@/lib/domain/reports";
import { formatTWD } from "@/lib/money";
import { formatDate } from "@/lib/time";

/**
 * Overview hero: the last 12 weeks, in the app's own warm light palette (amber + the truck-B blue-teal).
 * Revenue and gross profit share one TWD axis (the gap between them is cost); margin % gets its own small chart below —
 * never a second y-axis. The unfinished current week is drawn dashed so it never reads as a crash.
 * Colours were checked with the dataviz palette validator against the white card surface.
 */
const UI = {
  surface: "#ffffff",
  grid: "#efebe3",
  dots: "#ebe6db",
  axis: "#6f7782",
  text: "#1b2430",
  muted: "#6f7782",
  revenue: "#c4850e",
  profit: "#1f7aa0",
  avg: "#9aa1aa",
  up: "#2f7d5b",
  down: "#b4483a",
} as const;

interface Row {
  key: string;
  label: string;
  week: WeekPnl;
  revenue: number | null;
  profit: number | null;
  /** Only on the last full week and the current (partial) week, to draw the dashed continuation. */
  revenueLive: number | null;
  profitLive: number | null;
  ma4: number | null;
  margin: number | null;
  marginLive: number | null;
}

const whole = (c: number) => Math.round(c / 100);
const pct = (bp: number | null) => (bp === null ? null : Math.round(bp) / 100);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const compact = (twd: number) => (Math.abs(twd) >= 10000 ? `${(twd / 10000).toFixed(1)}萬` : twd.toLocaleString());

export function RevenueTrendPanel({ weeks, showMargin }: { weeks: WeekPnl[]; showMargin: boolean }) {
  const [view, setView] = useState<"chart" | "table">("chart");

  const { rows, kpi, peak, avgMargin, story } = useMemo(() => {
    const full = weeks.filter((w) => !w.partial);
    const lastFullIdx = weeks.findIndex((w) => w === full.at(-1));
    const rows: Row[] = weeks.map((w, i) => {
      const window = full.filter((f) => f.weekStart <= w.weekStart).slice(-4);
      const live = i >= lastFullIdx;
      return {
        key: w.weekStart,
        label: w.partial ? "本週" : formatDate(w.weekStart),
        week: w,
        revenue: w.partial ? null : whole(w.revenue),
        profit: w.partial ? null : whole(w.profit),
        revenueLive: live ? whole(w.revenue) : null,
        profitLive: live ? whole(w.profit) : null,
        ma4: !w.partial && window.length === 4 ? Math.round(avg(window.map((x) => whole(x.revenue)))) : null,
        margin: w.partial ? null : pct(marginBp(w)),
        marginLive: live ? pct(marginBp(w)) : null,
      };
    });

    const last = full.at(-1)!;
    const prev4 = full.slice(-5, -1);
    const delta = (now: number, base: number) => (base ? ((now - base) / base) * 100 : 0);
    const lastMargin = (marginBp(last) ?? 0) / 100;
    const avgMargin = avg(full.map((w) => (marginBp(w) ?? 0) / 100));
    const kpi = {
      week: last,
      revenue: { value: last.revenue, delta: delta(last.revenue, avg(prev4.map((w) => w.revenue))) },
      profit: { value: last.profit, delta: delta(last.profit, avg(prev4.map((w) => w.profit))) },
      margin: { value: lastMargin, deltaPp: lastMargin - avgMargin },
    };

    const peakRow = rows.filter((r) => r.revenue !== null).reduce((a, b) => (b.revenue! > a.revenue! ? b : a));
    // one plain sentence: the 4-week trend and where margin sits
    const recent = full.slice(-4);
    const before = full.slice(-8, -4);
    const trend = delta(avg(recent.map((w) => w.revenue)), avg(before.map((w) => w.revenue)));
    const story = `近 4 週營收平均${Math.abs(trend) < 2 ? "與前 4 週持平" : `較前 4 週${trend > 0 ? "成長" : "下滑"} ${Math.abs(trend).toFixed(1)}%`}${showMargin ? `；毛利率 ${Math.min(...full.map((w) => (marginBp(w) ?? 0) / 100)).toFixed(1)}%–${Math.max(...full.map((w) => (marginBp(w) ?? 0) / 100)).toFixed(1)}% 之間` : ""}。`;
    return { rows, kpi, peak: peakRow, avgMargin, story };
  }, [weeks, showMargin]);

  return (
    <section
      className="relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface text-ink shadow-[var(--shadow-card)]"
      style={{ backgroundImage: `radial-gradient(${UI.dots} 1px, transparent 1px)`, backgroundSize: "18px 18px" }}
      data-testid="revenue-trend-panel"
    >
      {/* thin accent line in the two series colours */}
      <div className="h-[3px] w-full" style={{ background: `linear-gradient(90deg, ${UI.revenue}, ${UI.profit})` }} aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div>
          <div className="flex items-center gap-2 font-mono text-[10.5px] tracking-[.18em] text-muted uppercase">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50" style={{ background: UI.revenue }} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: UI.revenue }} />
            </span>
            Revenue{showMargin ? " · Margin" : ""} · 12W
          </div>
          <h2 className="mt-1 text-[15px] font-semibold text-ink">{showMargin ? "營收與毛利趨勢" : "營收趨勢"}</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">{story}</p>
        </div>
        <div className="flex rounded-[9px] border border-line bg-sunk p-[3px] text-[12px]" role="tablist">
          {(["chart", "table"] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cn("rounded-[6px] px-2.5 py-1", view === v ? "bg-surface text-ink shadow-[var(--shadow-card)]" : "text-muted hover:text-ink")}>
              {v === "chart" ? "圖表" : "表格"}
            </button>
          ))}
        </div>
      </div>

      {/* headline numbers: last full week against the 4 before it */}
      <div className={cn("mt-4 grid grid-cols-1 gap-px border-y", showMargin && "sm:grid-cols-3")} style={{ borderColor: UI.grid, background: UI.grid }}>
        <Kpi label={`上週營收 ${formatDate(kpi.week.weekStart)}–${formatDate(kpi.week.weekEnd)}`} value={formatTWD(kpi.revenue.value)} delta={kpi.revenue.delta} unit="%" note="vs 前 4 週平均" swatch={UI.revenue} />
        {showMargin && (
          <>
            <Kpi label="上週毛利" value={formatTWD(kpi.profit.value)} delta={kpi.profit.delta} unit="%" note="vs 前 4 週平均" swatch={UI.profit} />
            <Kpi label="上週毛利率" value={`${kpi.margin.value.toFixed(1)}%`} delta={kpi.margin.deltaPp} unit="pt" note="vs 12 週平均" swatch={UI.profit} />
          </>
        )}
      </div>

      {view === "chart" ? (
        <div className="px-2 pt-3 pb-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 pb-1 text-[11.5px] text-muted" aria-label="圖例">
            <LineKey color={UI.revenue} label="營收" />
            {showMargin && <LineKey color={UI.profit} label="毛利" />}
            <LineKey color={UI.avg} label="營收 4 週移動平均" dashed />
            <LineKey color={UI.text} label="本週（至今）" dashed faint />
          </div>
          <div className="h-[230px]" data-testid="revenue-trend-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 18, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rtp-rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={UI.revenue} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={UI.revenue} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="rtp-gp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={UI.profit} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={UI.profit} stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={UI.grid} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: UI.axis, fontFamily: "var(--font-mono)" }} interval="preserveStartEnd" minTickGap={10} />
                <YAxis tickLine={false} axisLine={false} width={46} tick={{ fontSize: 10.5, fill: UI.axis, fontFamily: "var(--font-mono)" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip cursor={{ stroke: UI.muted, strokeWidth: 1 }} content={(p) => <Tip active={p.active} payload={p.payload as { payload: Row }[] | undefined} showMargin={showMargin} />} />
                <Area type="monotone" dataKey="revenue" stroke={UI.revenue} strokeWidth={2} fill="url(#rtp-rev)" connectNulls={false} dot={false} activeDot={{ r: 4, fill: UI.revenue, stroke: UI.surface, strokeWidth: 2 }} isAnimationActive={false} />
                {showMargin && <Area type="monotone" dataKey="profit" stroke={UI.profit} strokeWidth={2} fill="url(#rtp-gp)" connectNulls={false} dot={false} activeDot={{ r: 4, fill: UI.profit, stroke: UI.surface, strokeWidth: 2 }} isAnimationActive={false} />}
                <Line type="monotone" dataKey="ma4" stroke={UI.avg} strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="revenueLive" stroke={UI.revenue} strokeWidth={2} strokeDasharray="3 4" dot={false} activeDot={false} isAnimationActive={false} />
                {showMargin && <Line type="monotone" dataKey="profitLive" stroke={UI.profit} strokeWidth={2} strokeDasharray="3 4" dot={false} activeDot={false} isAnimationActive={false} />}
                <ReferenceDot x={peak.label} y={peak.revenue!} r={4} fill={UI.revenue} stroke={UI.surface} strokeWidth={2} label={{ value: "最高", position: "top", fill: UI.muted, fontSize: 10.5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {showMargin && (
            <div className="mt-1 border-t pt-2" style={{ borderColor: UI.grid }}>
              <div className="flex items-baseline justify-between px-3 text-[11.5px] text-muted">
                <span>毛利率</span>
                <span className="font-mono">12 週平均 {avgMargin.toFixed(1)}%</span>
              </div>
              <div className="h-[70px]" data-testid="margin-trend-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={rows} margin={{ top: 6, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={UI.grid} />
                    <XAxis dataKey="label" hide />
                    <YAxis width={46} tickLine={false} axisLine={false} domain={[(min: number) => Math.floor(min - 1), (max: number) => Math.ceil(max + 1)]} tickCount={3} tick={{ fontSize: 10.5, fill: UI.axis, fontFamily: "var(--font-mono)" }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip cursor={{ stroke: UI.muted, strokeWidth: 1 }} content={(p) => <Tip active={p.active} payload={p.payload as { payload: Row }[] | undefined} showMargin={showMargin} />} />
                    <ReferenceLine y={Number(avgMargin.toFixed(1))} stroke={UI.avg} strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="margin" stroke={UI.profit} strokeWidth={2} dot={{ r: 2.5, fill: UI.profit, stroke: UI.surface, strokeWidth: 1.5 }} activeDot={{ r: 4, fill: UI.profit, stroke: UI.surface, strokeWidth: 2 }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="marginLive" stroke={UI.profit} strokeWidth={2} strokeDasharray="3 4" dot={false} activeDot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="scroll-thin max-h-[340px] overflow-auto px-3 py-2">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-surface text-[11.5px] text-muted">
              <tr className="text-left">
                <th className="py-1.5 font-medium">週</th>
                <th className="py-1.5 text-right font-medium">營收</th>
                {showMargin && (
                  <>
                    <th className="py-1.5 text-right font-medium">毛利</th>
                    <th className="py-1.5 text-right font-medium">毛利率</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="font-mono">
              {[...rows].reverse().map((r) => {
                const bp = marginBp(r.week);
                return (
                  <tr key={r.key} className="border-t" style={{ borderColor: UI.grid }}>
                    <td className="py-1.5">
                      {formatDate(r.week.weekStart)}–{formatDate(r.week.weekEnd)}
                      {r.week.partial && <span className="ml-1 font-sans text-muted">至今</span>}
                    </td>
                    <td className="py-1.5 text-right">{formatTWD(r.week.revenue)}</td>
                    {showMargin && (
                      <>
                        <td className="py-1.5 text-right">{formatTWD(r.week.profit)}</td>
                        <td className="py-1.5 text-right">{bp === null ? "—" : `${(bp / 100).toFixed(1)}%`}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-line px-5 py-2.5 text-[11.5px] text-muted">
        出貨認列・未稅・週一起算{showMargin ? "；毛利依標準成本初估" : ""}。細節請在 AI 對話按「洞察報告」。示範資料。
      </div>
    </section>
  );
}

function Kpi({ label, value, delta, unit, note, swatch }: { label: string; value: string; delta: number; unit: "%" | "pt"; note: string; swatch: string }) {
  const flat = Math.abs(delta) < (unit === "pt" ? 0.2 : 1);
  const up = delta > 0;
  const Icon = flat ? ArrowRight : up ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="min-w-0 px-5 py-3" style={{ background: UI.surface }}>
      <div className="flex items-center gap-1.5 truncate text-[11.5px] text-muted">
        <span className="h-[2px] w-3 shrink-0 rounded-full" style={{ background: swatch }} aria-hidden />
        {label}
      </div>
      <div className="mt-1 font-mono text-[20px] leading-tight font-semibold tracking-tight text-ink">{value}</div>
      {/* direction is carried by the arrow and the words, not by colour alone */}
      <div className="mt-0.5 flex items-center gap-1 font-mono text-[11.5px]" style={{ color: flat ? UI.muted : up ? UI.up : UI.down }}>
        <Icon size={13} />
        {flat ? "持平" : `${up ? "+" : "−"}${Math.abs(delta).toFixed(1)}${unit === "pt" ? " 個百分點" : "%"}`}
        <span className="font-sans text-muted">{note}</span>
      </div>
    </div>
  );
}

function LineKey({ color, label, dashed, faint }: { color: string; label: string; dashed?: boolean; faint?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="16" height="6" aria-hidden>
        <line x1="1" y1="3" x2="15" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "3 3" : undefined} strokeLinecap="round" opacity={faint ? 0.6 : 1} />
      </svg>
      {label}
    </span>
  );
}

function Tip({ active, payload, showMargin }: { active?: boolean; payload?: { payload: Row }[]; showMargin: boolean }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  const w = r.week;
  const bp = marginBp(w);
  const row = (color: string, label: string, value: string, dashed?: boolean) => (
    <div className="flex items-center justify-between gap-5">
      <span className="inline-flex items-center gap-1.5 text-muted">
        <svg width="12" height="4" aria-hidden>
          <line x1="0" y1="2" x2="12" y2="2" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "3 2" : undefined} />
        </svg>
        {label}
      </span>
      <b className="font-mono font-semibold text-ink">{value}</b>
    </div>
  );
  return (
    <div className="min-w-[190px] rounded-[10px] border border-line bg-surface px-3 py-2 text-[12px] shadow-[var(--shadow-pop)]">
      <div className="mb-1 font-mono text-[11.5px] text-ink">
        {formatDate(w.weekStart)}–{formatDate(w.weekEnd)}
        {w.partial && <span className="ml-1 font-sans text-muted">本週至今</span>}
      </div>
      {row(UI.revenue, "營收", `NT$${compact(whole(w.revenue))}`)}
      {showMargin && row(UI.profit, "毛利", `NT$${compact(whole(w.profit))}`)}
      {showMargin && row(UI.profit, "毛利率", bp === null ? "—" : `${(bp / 100).toFixed(1)}%`)}
      {r.ma4 !== null && row(UI.avg, "4 週移動平均", `NT$${compact(r.ma4)}`, true)}
    </div>
  );
}
