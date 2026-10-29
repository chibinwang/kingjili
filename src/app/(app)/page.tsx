"use client";

import { ArrowUpRight, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar as RBar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TodayTaskList, useTodayTasks } from "@/components/TodayTasks";
import { Badge, Bar, Card, CardHeader, DemoNote, Metric, PageHeader, Segmented } from "@/components/ui";
import { cn } from "@/lib/cn";
import { WarehouseIso } from "@/components/WarehouseIso";
import { METHOD_LABEL } from "@/lib/domain/ar";
import { formatCompactTWD, formatTWD } from "@/lib/money";
import { can } from "@/lib/permissions";
import { arSummary, maps, routeView, salesMetrics, todayOrders } from "@/lib/selectors";
import { useCurrentUser, useDb } from "@/lib/store";
import { DEMO_TODAY, formatDate, formatDateTime, dayOfWeek, addDays } from "@/lib/time";

export default function OverviewPage() {
  const [mode, setMode] = useState<"ops" | "floor">("ops");
  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="OVERVIEW"
        title="早安，周主任"
        sub="今天 12 張訂單、兩台車。先看需要你決定的事，再看數字。"
        right={
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "ops", label: "營運數據" },
              { value: "floor", label: "倉庫配置" },
            ]}
          />
        }
      />
      {mode === "ops" ? <Ops /> : <WarehouseIso />}
    </div>
  );
}

function Ops() {
  const db = useDb();
  const user = useCurrentUser();
  const sm = salesMetrics(db);
  const ar = arSummary(db);
  const m = maps(db);
  const orders = todayOrders(db);
  const rv = routeView(db);
  const today = useTodayTasks();
  const lowRisk = today.pending.filter((t) => t.risk === "low").length;
  // collapsed by default: the overview shows a one-line summary until someone asks for the list
  const [showTasks, setShowTasks] = useState(false);
  const showMargin = can(user.role, "view.margin");
  const ready = orders.filter((o) => ["Reserved", "Picking"].includes(o.state)).length;
  const drafts = db.orders.filter((o) => o.state === "Draft").length + db.inbox.filter((x) => x.status === "new").length;

  const chart = useMemo(() => {
    const days: { date: string; label: string; v: number }[] = [];
    let d = addDays(DEMO_TODAY, -1);
    while (days.length < 7) {
      if (dayOfWeek(d) !== 0) {
        const found = sm.trailing.find((x) => x.date === d);
        const v = found?.cents ?? db.arDocs.filter((x) => x.type === "charge" && x.issueDate === d).reduce((a, x) => a + x.exTaxCents, 0);
        days.unshift({ date: d, label: formatDate(d, { weekday: true }), v: Math.round(v / 100) });
      }
      d = addDays(d, -1);
    }
    return days;
  }, [sm, db.arDocs]);

  const recentPayments = useMemo(() => [...db.payments].filter((p) => !p.reversalOf).sort((a, b) => b.collectedAt.localeCompare(a.collectedAt)).slice(0, 6), [db.payments]);
  const recentEvents = useMemo(() => [...db.events].sort((a, b) => b.seq - a.seq).slice(0, 6), [db.events]);
  const mtdDelta = sm.prevMonthToDate ? Math.round(((sm.monthRevenue - sm.prevMonthToDate) * 1000) / sm.prevMonthToDate) / 10 : 0;
  const late = rv ? rv.evaluation.routes.A.stops.filter((s) => s.late).length + rv.evaluation.routes.B.stops.filter((s) => s.late).length : 0;

  return (
    <div className="space-y-5">
      <Card className="grid grid-cols-2 gap-x-6 gap-y-5 px-6 py-5 md:grid-cols-3 xl:grid-cols-5">
        <Metric label="本月營收（未稅）" value={formatCompactTWD(sm.monthRevenue)} foot={<span className={mtdDelta >= 0 ? "text-ok" : "text-bad"}>較 9 月同期 {mtdDelta >= 0 ? "+" : ""}{mtdDelta}%</span>} />
        {showMargin ? (
          <Metric
            label="毛利率（初估）"
            value={sm.grossMarginBp === null ? "尚無成本資料" : `${(sm.grossMarginBp / 100).toFixed(1)}%`}
            foot={sm.uncostedRevenue > 0 ? <span title="素排骨尚無標準成本，未計入毛利">{formatTWD(sm.uncostedRevenue)} 營收缺成本</span> : "依標準成本"}
          />
        ) : (
          <Metric label="毛利率" value={<span className="text-[15px] text-faint">無權限</span>} foot="僅主任／會計可見" />
        )}
        <Metric label="應收未收" value={formatCompactTWD(ar.open)} foot={`${ar.rows.filter((r) => r.balance > 0).length} 位客戶`} />
        <Metric label="逾期未收" value={formatCompactTWD(ar.overdue)} tone={ar.overdue > 0 ? "bad" : undefined} foot={`${ar.rows.filter((r) => r.overdue > 0).length} 位客戶逾期`} />
        <Metric label="今日訂單" value={`${orders.length} 張`} foot={`${ready} 張待出車・${drafts} 則待審`} />
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <Card className="self-start">
          <CardHeader title={`今日任務（${today.total}）`} sub="AI 先試算並跑完規則驗證，按下核准才會寫入" />
          <div className="space-y-2.5 px-5 pb-5">
            {/* the AI 換車 proposal in the list already covers late stops; only flag them when nothing does */}
            {late > 0 && !today.pending.some((t) => t.kind === "route_reassign") && (
              <Link href="/dispatch" className="flex items-center justify-between rounded-[10px] border border-warn/30 bg-warn-soft/50 px-3.5 py-2.5 text-[12.5px] text-warn hover:border-warn/60">
                <span>今日路線 v{rv?.plan.version}：{late} 站預估超出客戶收貨時段</span>
                <ArrowUpRight size={14} />
              </Link>
            )}
            {today.total === 0 ? (
              <div className="rounded-[10px] bg-ok-soft px-3.5 py-2.5 text-[12.5px] text-ok">今天沒有等你決定的事</div>
            ) : (
              <button onClick={() => setShowTasks((v) => !v)} aria-expanded={showTasks} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-[10px] border border-line bg-sunk px-3.5 py-2.5 text-left text-[12.5px] text-ink-2 hover:border-amber">
                <span>
                  AI 建議待核准 <b className="num">{today.pending.length}</b>
                </span>
                <span>
                  規則轉給你 <b className="num">{today.escalated.length}</b>
                </span>
                {lowRisk > 0 && <span className="text-ai">其中 {lowRisk} 件低風險可直接核准</span>}
                <span className="ml-auto inline-flex items-center gap-1 text-muted">
                  {showTasks ? "收合" : "展開"}
                  <ChevronDown size={14} className={cn("transition-transform", !showTasks && "-rotate-90")} />
                </span>
              </button>
            )}
            {showTasks && <TodayTaskList />}
          </div>
        </Card>

        <Card>
          <CardHeader title="近 7 個營業日營收" sub="出貨認列・未稅" right={<Badge tone="mock">示範資料</Badge>} />
          <div className="h-[230px] px-2 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#efebe3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6f7782" }} />
                <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: "#9aa1aa" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip cursor={{ fill: "rgba(224,160,32,.08)" }} formatter={(v) => [`NT$${Number(v).toLocaleString()}`, "營收"]} contentStyle={{ borderRadius: 10, border: "1px solid #e8e4db", fontSize: 12 }} />
                <RBar dataKey="v" fill="#e0a020" radius={[5, 5, 0, 0]} maxBarSize={34} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="border-t border-line px-5 py-3 text-[12px] text-muted">
            營收依送達日認列（送貨單 ≠ 發票 ≠ 收款）；週日不出車。
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="應收帳齡" sub="依客戶結帳條件計算到期日" right={<Link href="/customers" className="text-[12px] text-muted hover:text-ink">全部 →</Link>} />
          <div className="space-y-3 px-5 pb-5">
            {(
              [
                ["current", "未到期", "ink"],
                ["1-30", "逾期 1–30 天", "amber"],
                ["31-60", "逾期 31–60 天", "bad"],
                ["61+", "逾期 61 天以上", "bad"],
              ] as const
            ).map(([k, label, tone]) => (
              <div key={k}>
                <div className="mb-1 flex justify-between text-[12.5px]">
                  <span className="text-ink-2">{label}</span>
                  <span className="num font-medium">{formatTWD(ar.buckets[k])}</span>
                </div>
                <Bar value={ar.buckets[k]} max={ar.open} tone={tone} />
              </div>
            ))}
            <div className="pt-1 text-[12px] text-muted">
              逾期最多：
              {ar.rows
                .filter((r) => r.overdue > 0)
                .sort((a, b) => b.overdue - a.overdue)
                .slice(0, 2)
                .map((r) => (
                  <Link key={r.customerId} href={`/customers?id=${r.customerId}`} className="ml-1 text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink">
                    {m.customers.get(r.customerId)?.name}
                  </Link>
                ))}
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="最近收款" sub="司機收現 ≠ 銀行入帳" />
          <div className="px-2 pb-3">
            {recentPayments.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-[8px] px-3 py-2 hover:bg-sunk">
                <div className="min-w-0">
                  <div className="truncate text-[13px] text-ink">{m.customers.get(p.customerId)?.name}</div>
                  <div className="text-[11.5px] text-faint">
                    {formatDateTime(p.collectedAt)}・{METHOD_LABEL[p.method]}・{p.custody === "collected" ? "司機持有" : p.custody === "received" ? "待核對" : p.custody === "handed_over" ? "已繳回" : "已入帳"}
                  </div>
                </div>
                <div className="num text-[13px] font-medium">{formatTWD(p.grossCents)}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="最新動態" right={<Link href="/activity" className="text-[12px] text-muted hover:text-ink">操作紀錄 →</Link>} />
          <div className="px-5 pb-4">
            {recentEvents.map((e) => (
              <div key={e.id} className="relative border-l border-line py-1.5 pl-4">
                <span className={`absolute top-3 -left-[4.5px] h-2 w-2 rounded-full ${e.actorType === "agent" ? "bg-ai" : e.actorType === "system" ? "bg-faint" : "bg-amber"}`} />
                <div className="text-[12.5px] leading-snug text-ink-2">{e.summary}</div>
                <div className="text-[11px] text-faint">
                  {formatDateTime(e.occurredAt)}・{e.actorName}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <DemoNote>所有金額為示範資料，非金吉利實際財務數字。毛利為依標準成本之初估。</DemoNote>
    </div>
  );
}
