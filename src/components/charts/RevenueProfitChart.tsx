"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Segmented } from "@/components/ui";
import { CHART } from "@/lib/chartTheme";
import { marginBp, type WeekPnl } from "@/lib/domain/reports";
import { formatCompactTWD, formatTWD } from "@/lib/money";
import { formatDate } from "@/lib/time";

interface Row {
  label: string;
  week: WeekPnl;
  cost: number;
  profit: number;
  unknown: number;
  revenue: number;
}

const whole = (cents: number) => Math.round(cents / 100);

/**
 * Weekly revenue as stacked bars: cost + gross profit (+ revenue without a cost) = revenue, one axis.
 * Without margin permission the bar is revenue only, single series.
 */
export function RevenueProfitChart({ weeks, showMargin, height = 250 }: { weeks: WeekPnl[]; showMargin: boolean; height?: number }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const rows: Row[] = weeks.map((w) => ({
    label: w.partial ? "本週" : formatDate(w.weekStart),
    week: w,
    // credits are netted out of profit, so the stack still sums to revenue
    cost: whole(w.cost),
    profit: whole(Math.max(0, w.profit)),
    unknown: whole(w.uncostedRevenue),
    revenue: whole(w.revenue),
  }));
  const hasUnknown = rows.some((r) => r.unknown > 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-2">
        {showMargin ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2" aria-label="圖例">
            <Legend color={CHART.cost} label="成本" />
            <Legend color={CHART.profit} label="毛利" />
            {hasUnknown && <Legend color={CHART.unknown} label="缺成本營收" />}
          </ul>
        ) : (
          <span className="text-[12px] text-muted">每週營收（未稅）</span>
        )}
        <Segmented size="sm" value={view} onChange={setView} options={[{ value: "chart", label: "圖表" }, { value: "table", label: "表格" }]} />
      </div>
      {view === "chart" ? (
        <div style={{ height }} className="px-2" data-testid="revenue-profit-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: CHART.axis }} interval="preserveStartEnd" minTickGap={8} />
              <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: CHART.tick }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip cursor={{ fill: CHART.cursor }} content={(p) => <Tip active={p.active} payload={p.payload as { payload: Row }[] | undefined} showMargin={showMargin} />} />
              {showMargin ? (
                <>
                  {/* the surface-coloured stroke is the 2px gap between stacked segments */}
                  <Bar dataKey="cost" stackId="r" fill={CHART.cost} stroke={CHART.surface} strokeWidth={1} maxBarSize={30} />
                  <Bar dataKey="profit" stackId="r" fill={CHART.profit} stroke={CHART.surface} strokeWidth={1} maxBarSize={30} radius={hasUnknown ? 0 : [4, 4, 0, 0]} />
                  {hasUnknown && <Bar dataKey="unknown" stackId="r" fill={CHART.unknown} stroke={CHART.surface} strokeWidth={1} maxBarSize={30} radius={[4, 4, 0, 0]} />}
                </>
              ) : (
                <Bar dataKey="revenue" fill={CHART.revenue} radius={[4, 4, 0, 0]} maxBarSize={30} />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="scroll-thin overflow-auto px-2" style={{ maxHeight: height }}>
          <table className="tbl text-[12.5px]">
            <thead className="sticky top-0 bg-surface">
              <tr>
                <th>週</th>
                <th className="r">營收</th>
                {showMargin && (
                  <>
                    <th className="r">成本</th>
                    <th className="r">毛利</th>
                    <th className="r">毛利率</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => {
                const bp = marginBp(r.week);
                return (
                  <tr key={r.week.weekStart}>
                    <td className="num whitespace-nowrap">
                      {formatDate(r.week.weekStart)}–{formatDate(r.week.weekEnd)}
                      {r.week.partial && <span className="ml-1 text-faint">至今</span>}
                    </td>
                    <td className="r num">{formatTWD(r.week.revenue)}</td>
                    {showMargin && (
                      <>
                        <td className="r num text-muted">{formatTWD(r.week.cost)}</td>
                        <td className="r num">{formatTWD(r.week.profit)}</td>
                        <td className="r num">{bp === null ? "—" : `${(bp / 100).toFixed(1)}%`}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} aria-hidden />
      {label}
    </li>
  );
}

function Tip({ active, payload, showMargin }: { active?: boolean; payload?: { payload: Row }[]; showMargin: boolean }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  const w = r.week;
  const bp = marginBp(w);
  return (
    <div className="min-w-[180px] rounded-[10px] border border-line bg-surface px-3 py-2 text-[12px] shadow-[var(--shadow-pop)]">
      <div className="mb-1 font-medium text-ink">
        {formatDate(w.weekStart)}–{formatDate(w.weekEnd)}
        {w.partial && <span className="ml-1 font-normal text-faint">（至今）</span>}
      </div>
      <TipRow label="營收" value={formatCompactTWD(w.revenue)} strong />
      {showMargin && (
        <>
          <TipRow label="成本" value={formatCompactTWD(w.cost)} color={CHART.cost} />
          <TipRow label="毛利" value={formatCompactTWD(w.profit)} color={CHART.profit} />
          {w.uncostedRevenue > 0 && <TipRow label="缺成本營收" value={formatCompactTWD(w.uncostedRevenue)} color={CHART.unknown} />}
          <div className="mt-1 border-t border-line pt-1 text-muted">毛利率 {bp === null ? "—" : `${(bp / 100).toFixed(1)}%`}</div>
        </>
      )}
    </div>
  );
}

function TipRow({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="inline-flex items-center gap-1.5 text-muted">
        {color && <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} aria-hidden />}
        {label}
      </span>
      <span className={strong ? "num font-semibold text-ink" : "num text-ink-2"}>{value}</span>
    </div>
  );
}
