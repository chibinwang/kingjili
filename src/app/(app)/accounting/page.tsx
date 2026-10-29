"use client";

import { AlertTriangle, ArrowRight, CalendarClock, FileDown, Lock, MessageCircle, Send, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { CheckList, ProcessBox, useAuditRun } from "@/components/review/AuditProcess";
import { TaskCard } from "@/components/TaskCard";
import { Badge, Button, Card, Check, Drawer, Modal, Money, PageHeader, Segmented, Select } from "@/components/ui";
import { addAiTask, lockStatements, releaseStatement, reviewStatement, sendStatementMock } from "@/lib/actions";
import { flagTaskSpec } from "@/lib/agent";
import { cn } from "@/lib/cn";
import { TERMS_LABEL } from "@/lib/domain/ar";
import type { AuditFlag } from "@/lib/domain/audit";
import { buildStatement, snapshotHash, STATEMENT_STATUS_LABEL } from "@/lib/domain/statements";
import type { Customer, Statement } from "@/lib/domain/types";
import { formatTWD } from "@/lib/money";
import { auditFor, maps } from "@/lib/selectors";
import { useDb, useStore } from "@/lib/store";
import { addDays, DEMO_TODAY, formatDate, formatDateTime, formatPeriod, periodOf, periodRange } from "@/lib/time";

const PERIODS = ["2026-10", "2026-09", "2026-08"];

export default function AccountingPage() {
  return (
    <Suspense>
      <Accounting />
    </Suspense>
  );
}

function deadlineOf(period: string) {
  const { end } = periodRange(period);
  return addDays(end, 10);
}

function currentStatement(statements: Statement[], customerId: string, period: string) {
  return statements.filter((s) => s.customerId === customerId && s.period === period && s.status !== "superseded").sort((a, b) => b.version - a.version)[0];
}

function Accounting() {
  const db = useDb();
  const params = useSearchParams();
  const router = useRouter();
  const [period, setPeriod] = useState(params.get("period") ?? periodOf(DEMO_TODAY));
  const [tab, setTab] = useState<"statements" | "review">(params.get("tab") === "review" ? "review" : "statements");
  const [scope, setScope] = useState<"billable" | "all">("billable");
  const [selected, setSelected] = useState<string[]>([]);
  const run = useStore((s) => s.run);
  const previewId = params.get("customer");
  const checks = auditFor(db, period);
  const flags = checks.flatMap((c) => c.flags);
  const acct = db.users.find((u) => u.role === "accounting")!;

  const customers = db.customers.filter((c) => scope === "all" || c.settlementTerms !== "daily");
  const rows = useMemo(
    () =>
      customers.map((c) => ({
        c,
        st: buildStatement(c, period, db.arDocs, db.payments, db.allocations, db.invoices),
        locked: currentStatement(db.statements, c.id, period),
        flags: flags.filter((f) => f.customerId === c.id),
      })),
    [customers, period, db, flags],
  );
  const statusCount = (s: Statement["status"]) => rows.filter((r) => r.locked?.status === s).length;
  const deadline = deadlineOf(period);
  const daysLeft = Math.round((Date.parse(deadline) - Date.parse(DEMO_TODAY)) / 86400000);

  return (
    <div className="animate-rise space-y-5">
      <PageHeader
        eyebrow="BILLING & ACCOUNTING"
        title="帳單與會計"
        sub="送貨單 ≠ 發票 ≠ 收款 ≠ 對帳單。對帳單＝期初＋出貨＋借項−貸項−收款＝期末，逐筆可追溯；判定對錯的是規則引擎，AI 只負責解釋與建議。"
        right={
          <>
            <Link href={`/accounting/statement?period=${period}`}>
              <Button variant="outline">
                <FileDown size={14} /> 對帳單預覽與下載
              </Button>
            </Link>
            <Select value={period} onChange={(e) => setPeriod(e.target.value)} className="w-[150px]">
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {formatPeriod(p)}
                </option>
              ))}
            </Select>
          </>
        }
      />

      <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className={cn("grid h-10 w-10 place-items-center rounded-[11px]", daysLeft < 0 ? "bg-ok-soft text-ok" : "bg-amber-soft text-amber-deep")}>
            <CalendarClock size={18} />
          </span>
          <div>
            <div className="text-[13.5px] font-semibold">
              {formatPeriod(period)}對帳單須於 {formatDate(deadline, { weekday: true })} 前寄出
            </div>
            <div className="text-[12px] text-muted">{daysLeft < 0 ? "本期已完成發送流程" : period === periodOf(DEMO_TODAY) ? `期間進行中（截至 ${formatDate(DEMO_TODAY)}）・可先預覽與跑審查，月底關帳後鎖定` : `剩 ${daysLeft} 天`}</div>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-[12px]">
          {[
            ["期末關帳", rows.length - rows.filter((r) => r.locked).length, "neutral"],
            ["鎖定快照", statusCount("locked"), "info"],
            ["會計審查", statusCount("reviewed"), "info"],
            ["主管核准", statusCount("released"), "warn"],
            ["已發送（模擬）", statusCount("sent_mock"), "ok"],
          ].map(([label, n], i) => (
            <span key={String(label)} className="flex items-center gap-1.5">
              {i > 0 && <ArrowRight size={12} className="text-line-strong" />}
              <span className="rounded-full border border-line bg-sunk px-2.5 py-1">
                {label} <b className="num ml-0.5">{n}</b>
              </span>
            </span>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "statements", label: "月結對帳單" },
            {
              value: "review",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  批次對帳審查 {flags.length > 0 && <span className="num rounded-full bg-bad px-1.5 text-[10.5px] leading-4 text-white">{flags.length}</span>}
                </span>
              ),
            },
          ]}
        />
        {tab === "statements" && (
          <div className="flex items-center gap-2">
            <Segmented
              size="sm"
              value={scope}
              onChange={setScope}
              options={[
                { value: "billable", label: "月結＋混合" },
                { value: "all", label: "全部客戶" },
              ]}
            />
            <Button variant="outline" size="sm" disabled={!selected.length} onClick={() => run((d, c) => lockStatements(d, c, period, selected), `已鎖定 ${selected.length} 份快照`, { asUserId: acct.id }) && setSelected([])}>
              <Lock size={13} /> 鎖定所選（{selected.length}）
            </Button>
          </div>
        )}
      </div>

      {tab === "statements" ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="tbl min-w-[1000px]">
              <thead>
                <tr>
                  <th className="w-8">
                    <input
                      type="checkbox"
                      checked={selected.length > 0 && selected.length === rows.filter((r) => !r.locked || r.locked.status === "locked").length}
                      onChange={(e) => setSelected(e.target.checked ? rows.filter((r) => !r.locked || r.locked.status === "locked").map((r) => r.c.id) : [])}
                    />
                  </th>
                  <th>客戶</th>
                  <th className="r">期初</th>
                  <th className="r">出貨（含稅）</th>
                  <th className="r">調整</th>
                  <th className="r">收款</th>
                  <th className="r">期末應收</th>
                  <th>對帳</th>
                  <th>審查旗標</th>
                  <th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, st, locked, flags: f }) => (
                  <tr key={c.id} className="row-hover cursor-pointer" onClick={() => router.push(`/accounting?customer=${c.id}&period=${period}${tab === "statements" ? "" : "&tab=review"}`, { scroll: false })}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" disabled={!!locked && locked.status !== "locked"} checked={selected.includes(c.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} />
                    </td>
                    <td>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-[11.5px] text-faint">
                        {TERMS_LABEL[c.settlementTerms]}・{st.deliveryCount} 張送貨單
                      </div>
                    </td>
                    <td className="r">
                      <Money cents={st.totals.openingCents} />
                    </td>
                    <td className="r">
                      <Money cents={st.totals.chargesCents} />
                    </td>
                    <td className="r text-muted">{st.totals.debitAdjCents - st.totals.creditAdjCents ? <Money cents={st.totals.debitAdjCents - st.totals.creditAdjCents} sign /> : "—"}</td>
                    <td className="r">
                      <Money cents={-st.totals.paymentsCents} />
                    </td>
                    <td className="r font-semibold">
                      <Money cents={st.totals.closingCents} />
                    </td>
                    <td>{st.reconciles ? <Badge tone="ok">一致</Badge> : <Badge tone="bad">不一致</Badge>}</td>
                    <td>{f.length ? <Badge tone={f.some((x) => x.severity === "high") ? "bad" : "warn"}>{f.length} 項</Badge> : <span className="text-[12px] text-faint">—</span>}</td>
                    <td>{locked ? <Badge tone={locked.status === "sent_mock" ? "ok" : locked.status === "released" ? "warn" : "info"}>v{locked.version}・{STATEMENT_STATUS_LABEL[locked.status]}</Badge> : <Badge tone="neutral">預覽中</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <ReviewPanel key={period} period={period} />
      )}

      {previewId && <StatementDrawer customer={maps(db).customers.get(previewId)!} period={period} setPeriod={setPeriod} onClose={() => router.push(`/accounting?period=${period}${tab === "review" ? "&tab=review" : ""}`, { scroll: false })} />}
    </div>
  );
}

function ReviewPanel({ period }: { period: string }) {
  const db = useDb();
  const audit = useAuditRun(db, period);
  const live = auditFor(db, period).flatMap((c) => c.flags);
  // while the run plays, only show what it has found so far; afterwards the live list (resolved flags drop off)
  const flags = audit.done ? live : live.filter((f) => audit.found.has(f.id));
  return (
    <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
      <CheckList audit={audit} period={period} />
      <div className="min-w-0 space-y-3">
        <ProcessBox audit={audit} period={period} />
        {audit.done && flags.length === 0 && (
          <Card className="px-6 py-10 text-center">
            <ShieldCheck size={28} className="mx-auto text-ok" />
            <div className="mt-2 font-semibold">所有檢查通過</div>
            <div className="text-[12.5px] text-muted">可進行鎖定、會計審查與主管核准</div>
          </Card>
        )}
        {flags.map((f) => (
          <div key={f.id} className="animate-rise">
            <FlagCard flag={f} />
          </div>
        ))}
      </div>
    </div>
  );
}

function FlagCard({ flag }: { flag: AuditFlag }) {
  const db = useDb();
  const runWith = useStore((s) => s.runWith);
  const m = maps(db);
  const existing = db.aiTasks.find((t) => (t.payload as { flagId?: string }).flagId === flag.id && t.status !== "rejected");
  const [taskId, setTaskId] = useState<string | undefined>(existing?.id);
  const task = db.aiTasks.find((t) => t.id === taskId);
  const spec = useMemo(() => flagTaskSpec(db, flag.id), [db, flag.id]);
  const explain = () => {
    if (!spec) return;
    const t = runWith((d, c) => {
      const r = addAiTask(d, c, spec);
      return { db: r.db, value: r.task };
    });
    if (t) setTaskId(t.id);
  };
  return (
    <Card data-testid="flag-card" className={cn("p-4", flag.severity === "high" ? "border-bad/25" : "border-warn/30")}>
      <div className="flex flex-wrap items-start gap-3">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[9px]", flag.severity === "high" ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn")}>
          <AlertTriangle size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold">{flag.title}</span>
            <Badge tone={flag.severity === "high" ? "bad" : "warn"}>{flag.severity === "high" ? "高" : "中"}</Badge>
            <Badge tone="outline">規則判定</Badge>
          </div>
          <div className="mt-0.5 text-[12.5px] text-ink-2">{flag.detail}</div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11.5px]">
            {flag.refs.map((r) => (
              <Link key={r.id} href={`/customers?id=${flag.customerId}`} className="num rounded-md border border-line px-1.5 py-[1px] text-ink-2 hover:border-amber">
                {r.no}
              </Link>
            ))}
            <span className="text-faint">・{m.customers.get(flag.customerId)?.name}</span>
          </div>
        </div>
        {!task && (spec ? (
          <Button size="sm" variant="ai" onClick={explain}>
            <Sparkles size={13} /> AI 解釋與建議
          </Button>
        ) : (
          <span className="text-[11.5px] text-faint">需人工判斷</span>
        ))}
      </div>
      {task && (
        <div className="mt-3">
          <TaskCard task={task} defaultOpen />
        </div>
      )}
    </Card>
  );
}

function StatementDrawer({ customer, period, setPeriod, onClose }: { customer: Customer; period: string; setPeriod: (p: string) => void; onClose: () => void }) {
  const db = useDb();
  const run = useStore((s) => s.run);
  const st = buildStatement(customer, period, db.arDocs, db.payments, db.allocations, db.invoices);
  const locked = currentStatement(db.statements, customer.id, period);
  const flags = auditFor(db, period).flatMap((c) => c.flags).filter((f) => f.customerId === customer.id);
  const high = flags.filter((f) => f.severity === "high").length;
  const stale = locked && locked.status !== "sent_mock" && snapshotHash(st.lines) !== locked.snapshotHash;
  const acct = db.users.find((u) => u.role === "accounting")!;
  const owner = db.users.find((u) => u.role === "owner")!;
  const [linePreview, setLinePreview] = useState(false);
  const lines = locked && !stale ? locked.lines : st.lines;
  const totals = locked && !stale ? locked.totals : st.totals;

  const actions = (() => {
    if (!locked || stale)
      return (
        <Button variant="primary" onClick={() => run((d, c) => lockStatements(d, c, period, [customer.id]), "已鎖定快照", { asUserId: acct.id })}>
          <Lock size={14} /> {stale ? "資料已變動・重新鎖定" : "鎖定快照"}（{acct.name}）
        </Button>
      );
    if (locked.status === "locked")
      return (
        <Button variant="primary" onClick={() => run((d, c) => reviewStatement(d, c, locked.id, high), "會計審查通過", { asUserId: acct.id })}>
          <ShieldCheck size={14} /> 會計審查（{acct.name}）
        </Button>
      );
    if (locked.status === "reviewed")
      return (
        <Button variant="accent" onClick={() => run((d, c) => releaseStatement(d, c, locked.id), "主管已核准", { asUserId: owner.id })}>
          主管核准（{owner.name}）
        </Button>
      );
    if (locked.status === "released")
      return (
        <Button variant="primary" onClick={() => setLinePreview(true)}>
          <Send size={14} /> 排入 LINE 發送（模擬）
        </Button>
      );
    return <Badge tone="ok">v{locked.version} 已模擬發送・{locked.sendLog.at(-1) && formatDateTime(locked.sendLog.at(-1)!.at)}</Badge>;
  })();

  return (
    <Drawer
      open
      onClose={onClose}
      width={980}
      title={`${customer.name}・${formatPeriod(period)}對帳單`}
      sub={`${TERMS_LABEL[customer.settlementTerms]}・${customer.invoiceClass === "B2B" ? `統編 ${customer.taxId}` : "個人"}・${locked ? `v${locked.version} ${STATEMENT_STATUS_LABEL[locked.status]}` : "即時預覽（未鎖定）"}`}
      footer={
        <>
          <Link href={`/accounting/statement?customer=${customer.id}&period=${period}`} className="mr-auto">
            <Button variant="outline">
              <FileDown size={14} /> 預覽／編輯對帳單・下載 PDF
            </Button>
          </Link>
          <Button variant="outline" onClick={() => setLinePreview(true)}>
            <MessageCircle size={14} /> 預覽 LINE 發送
          </Button>
          {actions}
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented size="sm" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p, label: formatPeriod(p) }))} />
        {stale && <Badge tone="warn">鎖定後帳務有變動，快照已過期</Badge>}
      </div>
      <div className="mb-5 grid grid-cols-2 items-stretch gap-2 rounded-[14px] border border-line bg-sunk p-3 sm:grid-cols-6">
        {[
          ["期初", totals.openingCents, ""],
          ["＋ 出貨", totals.chargesCents, ""],
          ["＋ 借項", totals.debitAdjCents, ""],
          ["− 貸項", totals.creditAdjCents, ""],
          ["− 收款", totals.paymentsCents, ""],
          ["＝ 期末應收", totals.closingCents, "font-semibold text-ink"],
        ].map(([l, v, cls]) => (
          <div key={String(l)} className={cn("rounded-[10px] px-3 py-2", l === "＝ 期末應收" ? "bg-surface shadow-[var(--shadow-card)]" : "")}>
            <div className="text-[11.5px] text-muted">{l}</div>
            <Money cents={Number(v)} className={cn("text-[16px]", String(cls))} />
          </div>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-[12.5px]">
        <span className="flex items-center gap-1.5">
          <Check ok={st.reconciles} size={11} /> 期末 {formatTWD(st.totals.closingCents)} {st.reconciles ? "＝" : "≠"} 應收子帳 {formatTWD(st.ledgerClosingCents)}
        </span>
        <span className="text-muted">
          出貨未稅 {formatTWD(totals.chargesExTaxCents)}・稅額 {formatTWD(totals.chargesTaxCents)}・含稅 {formatTWD(totals.chargesCents)}
        </span>
      </div>
      {flags.length > 0 && (
        <div className="mb-4 space-y-1.5">
          {flags.map((f) => (
            <div key={f.id} className={cn("flex items-center justify-between rounded-[8px] px-3 py-2 text-[12.5px]", f.severity === "high" ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn")}>
              <span className="flex items-center gap-1.5">
                <AlertTriangle size={13} /> {f.title}：{f.detail}
              </span>
              <Link href={`/accounting?tab=review&period=${period}`} className="shrink-0 underline underline-offset-2">
                處理
              </Link>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-x-auto rounded-[12px] border border-line">
        <table className="tbl min-w-[860px] text-[12.5px]">
          <thead>
            <tr>
              <th>日期</th>
              <th>單號</th>
              <th>摘要</th>
              <th>發票</th>
              <th className="r">未稅</th>
              <th className="r">稅額</th>
              <th className="r">應收（借）</th>
              <th className="r">收款（貸）</th>
              <th className="r">已收／未收</th>
              <th className="r">累計餘額</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className={cn(l.refType === "opening" && "bg-sunk/60 font-medium", l.refType === "payment" && "text-ok")}>
                <td className="num">{formatDate(l.date)}</td>
                <td className="num">{l.refNo}</td>
                <td>{l.description}</td>
                <td className="num text-muted">{l.invoiceNo ?? (l.refType === "charge" ? (customer.settlementTerms === "daily" ? "—" : "月底彙開") : "")}</td>
                <td className="r">{l.exTaxCents ? <Money cents={l.exTaxCents} /> : ""}</td>
                <td className="r">{l.taxCents ? <Money cents={l.taxCents} /> : ""}</td>
                <td className="r">{l.debitCents ? <Money cents={l.debitCents} /> : ""}</td>
                <td className="r">{l.creditCents ? <Money cents={l.creditCents} /> : ""}</td>
                <td className="r text-[11.5px]">
                  {l.remainingCents !== undefined && (l.remainingCents === 0 ? <span className="text-ok">已收</span> : l.paidCents ? <span className="text-warn">已收 {formatTWD(l.paidCents)}／未收 {formatTWD(l.remainingCents)}</span> : <span className="text-muted">未收</span>)}
                </td>
                <td className="r font-medium">
                  <Money cents={l.balanceCents} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {linePreview && <LinePreview customer={customer} period={period} closing={totals.closingCents} statement={locked} onClose={() => setLinePreview(false)} onSend={() => locked && run((d, c) => sendStatementMock(d, c, locked.id), "已排入模擬發送佇列（未實際寄出）", { asUserId: owner.id }) && setLinePreview(false)} />}
    </Drawer>
  );
}

function LinePreview({ customer, period, closing, statement, onClose, onSend }: { customer: Customer; period: string; closing: number; statement?: Statement; onClose: () => void; onSend: () => void }) {
  const canSend = statement?.status === "released" || statement?.status === "sent_mock";
  const linked = customer.linkStatus === "linked";
  const token = (statement?.snapshotHash ?? "preview").slice(0, 6);
  return (
    <Modal
      open
      onClose={onClose}
      width={720}
      title="預覽 LINE 發送"
      sub="LINE 官方帳號只能傳送「含 HTTPS 連結的訊息」，不能直接附 PDF；客戶需先綁定官方帳號才可推播"
      footer={
        <>
          <span className="mr-auto text-[12px] text-muted">狀態：{canSend ? "可排入模擬佇列" : "需先完成鎖定 → 會計審查 → 主管核准"}・外部發送未啟用</span>
          <Button variant="ghost" onClick={onClose}>
            關閉
          </Button>
          <Button variant="primary" disabled={!canSend || !linked} onClick={onSend}>
            <Send size={14} /> 排入發送（模擬）
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[300px_1fr]">
        <div className="mx-auto w-[280px] rounded-[30px] border-[8px] border-ink bg-[#8cabd9] p-3 shadow-[var(--shadow-pop)]">
          <div className="mb-3 text-center text-[11.5px] font-semibold text-white">金吉利食品（官方帳號・示範）</div>
          <div className="rounded-[16px] rounded-tl-[4px] bg-white p-3 text-[12.5px] leading-relaxed text-ink">
            {customer.contactName} 您好，
            <br />
            {formatPeriod(period)}對帳單已備妥：
            <br />
            期末應收 <b>{formatTWD(closing)}</b>
            <div className="mt-2 rounded-[10px] border border-line bg-sunk p-2">
              <div className="text-[11px] text-muted">安全連結・7 日內有效</div>
              <div className="num truncate text-[11.5px] text-info underline">https://portal.example/s/{token}…</div>
            </div>
            <div className="mt-2 text-[11px] text-faint">需以綁定的 LINE 帳號開啟；可下載 PDF</div>
          </div>
          <div className="mt-2 text-right text-[10px] text-white/80">{statement?.status === "sent_mock" ? "模擬：已送達（非已讀）" : "尚未送出"}</div>
        </div>
        <div className="space-y-2.5 text-[12.5px]">
          <div className="font-semibold">發送前檢查</div>
          {[
            { l: "客戶已綁定 LINE 官方帳號", ok: linked, d: linked ? customer.lineUserId : "未綁定：改用安全入口人工分享，不可只憑客戶編號開啟" },
            { l: "對帳單已鎖定快照", ok: !!statement },
            { l: "會計審查完成", ok: !!statement?.reviewedBy },
            { l: "主管核准（與審查者不同人）", ok: !!statement?.releasedBy },
            { l: "連結需驗證身分、7 日到期、可撤銷重發", ok: true },
            { l: "僅追蹤「送達」，不宣稱「已讀」", ok: true },
          ].map((x) => (
            <div key={x.l} className="flex items-start gap-2">
              <Check ok={x.ok} size={11} />
              <span>
                {x.l}
                {x.d && <div className="text-[11.5px] text-faint">{x.d}</div>}
              </span>
            </div>
          ))}
          <div className="rounded-[10px] border border-dashed border-line-strong px-3 py-2 text-[11.5px] text-muted">
            狀態保持「模擬／待連結」：示範環境沒有 LINE Channel 憑證，不會實際推播。
          </div>
        </div>
      </div>
    </Modal>
  );
}
