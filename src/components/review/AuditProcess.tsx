"use client";

import { ChevronDown, FastForward, Loader2, PlayCircle, Sparkles } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, CardHeader, Check } from "@/components/ui";
import { cn } from "@/lib/cn";
import { CHECK_META, type CheckId, type CheckResult } from "@/lib/domain/audit";
import { buildAuditTrace, type AuditTrace, type TraceStep } from "@/lib/domain/auditTrace";
import type { Db } from "@/lib/db";
import { auditFor } from "@/lib/selectors";
import { formatPeriod } from "@/lib/time";

/** Real timestamps (ms from start) of runs already watched this session; coming back shows the finished run instead of replaying it. */
const reviewed = new Map<string, number[]>();

interface Run {
  trace: AuditTrace;
  checks: CheckResult[];
  /** planned pause before each step */
  delays: number[];
}

function makeRun(db: Db, period: string): Run {
  const checks = auditFor(db, period);
  const trace = buildAuditTrace({ period, customers: db.customers, docs: db.arDocs, payments: db.payments, allocations: db.allocations, invoices: db.invoices, orders: db.orders, statements: db.statements, events: db.events }, checks);
  // linger on loading, on the start of each check and on anything found, so a reader can follow along
  const delays = trace.steps.map((s, i) => {
    const prev = trace.steps[i - 1];
    return (s.phase === "load" ? 350 : s.phase === "summary" ? 450 : prev?.check !== s.check ? 200 : 25) + (prev?.tone === "warn" ? 450 : 0);
  });
  return { trace, checks, delays };
}

export type AuditRun = ReturnType<typeof useAuditRun>;

/** Plays the audit trace back one step at a time. Mount with `key={period}` so a new period starts fresh. */
export function useAuditRun(db: Db, period: string) {
  const [run, setRun] = useState(() => makeRun(db, period));
  const steps = run.trace.steps;
  const [stamps, setStamps] = useState<number[]>(() => {
    const prev = reviewed.get(period);
    return prev?.length === steps.length ? prev : [];
  });
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const pos = stamps.length;
  const done = pos >= steps.length;

  useEffect(() => {
    if (done) {
      reviewed.set(period, stamps);
      return;
    }
    const id = setTimeout(() => setStamps((s) => [...s, Date.now() - startedAt]), run.delays[pos]);
    return () => clearTimeout(id);
  }, [done, pos, run, period, stamps, startedAt]);

  const played = useMemo(() => steps.slice(0, pos), [steps, pos]);
  const found = useMemo(() => new Set(played.flatMap((s) => s.flagIds)), [played]);
  return {
    run,
    pos,
    done,
    played,
    stamps,
    found,
    current: played.at(-1),
    compared: played.reduce((n, s) => n + s.examined, 0),
    elapsedMs: stamps.at(-1) ?? 0,
    restart: () => {
      setRun(makeRun(db, period));
      setStartedAt(Date.now());
      setStamps([]);
    },
    skip: () => setStamps((s) => [...s, ...Array(steps.length - s.length).fill(Date.now() - startedAt)]),
    /** played / total customer steps for one check */
    progressOf: (id: CheckId) => {
      const all = steps.filter((s) => s.check === id);
      const seen = played.filter((s) => s.check === id);
      return { played: seen.length, total: all.length, flags: seen.reduce((n, s) => n + s.flagIds.length, 0) };
    },
  };
}

export function CheckList({ audit, period }: { audit: AuditRun; period: string }) {
  const { run, done, pos } = audit;
  return (
    <Card className="self-start">
      <CardHeader title="全月審查項目" sub={`${formatPeriod(period)}・${run.trace.totals.customers} 位客戶・${run.checks.length} 項檢查`} />
      <div className="px-5 pb-5">
        <Button variant="primary" className="mb-4 w-full" onClick={audit.restart} disabled={!done}>
          {done ? <PlayCircle size={15} /> : <Loader2 size={15} className="animate-spin" />}
          {done ? "重新執行審查" : `審查中…（${run.checks.filter((c) => audit.progressOf(c.id).played === audit.progressOf(c.id).total).length}/${run.checks.length}）`}
        </Button>
        <ol className="space-y-1">
          {run.checks.map((c) => {
            const p = audit.progressOf(c.id);
            const state = p.played === p.total && pos > 0 ? "done" : p.played > 0 ? "running" : "pending";
            return (
              <li key={c.id} className={cn("flex items-start gap-2.5 rounded-[8px] px-2 py-1.5 text-[12.5px] transition-colors", state === "running" && "bg-ai-soft")}>
                <span className="mt-0.5 grid w-[18px] shrink-0 place-items-center">
                  {state === "done" ? <Check ok={p.flags === 0} size={11} /> : state === "running" ? <Loader2 size={14} className="animate-spin text-ai" /> : <span className="h-3 w-3 rounded-full border-[1.5px] border-line-strong" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2">
                    <span className={cn("font-medium", state === "pending" ? "text-faint" : "text-ink")}>{c.label}</span>
                    {state === "running" && <span className="num text-[11.5px] text-ai">{p.played}/{p.total}</span>}
                    {state === "done" && p.flags > 0 && <span className="num font-semibold text-bad">{p.flags}</span>}
                  </div>
                  <div className="text-[11.5px] text-faint">{c.description}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </Card>
  );
}

export function ProcessBox({ audit, period }: { audit: AuditRun; period: string }) {
  const { run, done, played, current, pos } = audit;
  const [open, setOpen] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const steps = run.trace.steps;
  const checksDone = run.checks.filter((c) => audit.progressOf(c.id).played === audit.progressOf(c.id).total && pos > 0).length;
  const pct = Math.round((pos / steps.length) * 100);
  const cur = current?.check ? audit.progressOf(current.check) : undefined;

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [pos, open]);

  return (
    <Card className={cn("overflow-hidden", done ? "border-line" : "border-ai/35 shadow-[0_0_0_3px_var(--color-ai-soft)]")} data-testid="audit-process">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <span className={cn("grid h-9 w-9 place-items-center rounded-[10px] text-white", done ? "bg-ink" : "bg-ai")}>
            <Sparkles size={16} className={cn(!done && "animate-pulse-soft")} />
          </span>
          <div>
            <div role="status" className="text-[14.5px] font-semibold">
              {done ? "審查完成" : "AI 審查進行中"}
            </div>
            <div className="text-[12px] text-muted">{formatPeriod(period)}・AI 代理逐位客戶執行 {run.checks.length} 項規則檢查；通過與否由規則判定，不由 AI 決定</div>
          </div>
        </div>
        {done ? (
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <ChevronDown size={14} className={cn("transition-transform", !open && "-rotate-90")} /> {open ? "收合工作紀錄" : `展開工作紀錄（${steps.length} 筆）`}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={audit.skip}>
            <FastForward size={14} /> 直接看結果
          </Button>
        )}
      </div>

      <div className="px-5">
        <div className="h-1.5 overflow-hidden rounded-full bg-black/[.06]">
          <div className={cn("h-full rounded-full transition-[width] duration-200", done ? "bg-ok" : "bg-ai")} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
          {[
            ["已完成檢查", `${checksDone} / ${run.checks.length} 項`],
            ["已比對紀錄", `${audit.compared} 筆`],
            ["發現問題", `${audit.found.size} 項`],
            ["用時", `${(audit.elapsedMs / 1000).toFixed(1)} 秒`],
          ].map(([l, v]) => (
            <div key={l}>
              <div className="text-muted">{l}</div>
              <div className={cn("num text-[15px] font-semibold", l === "發現問題" && audit.found.size > 0 && "text-bad")}>{v}</div>
            </div>
          ))}
        </div>
        {done ? (
          <div className={cn("mt-3 rounded-[9px] px-3 py-2 text-[12.5px] font-medium", audit.found.size ? "bg-bad-soft text-bad" : "bg-ok-soft text-ok")}>
            {audit.found.size ? `發現 ${audit.found.size} 個需要人員確認的問題，已列在下方；每一項都可請 AI 解釋並由有權限的人核准處理。` : "全部檢查通過，可進行鎖定、會計審查與主管核准。"}
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-[9px] bg-ai-soft px-3 py-2 text-[12.5px] text-ai">
            <Loader2 size={14} className="shrink-0 animate-spin" />
            {current?.phase === "check" && cur ? (
              <span className="truncate">
                正在檢查「{CHECK_META[current.check!].label}」：{current.subject}（{cur.played}/{cur.total}）
              </span>
            ) : (
              <span>{pos === 0 ? "準備資料中…" : current?.text}</span>
            )}
          </div>
        )}
      </div>

      {open && (
        <div ref={logRef} className="scroll-thin mt-3 max-h-[280px] overflow-y-auto border-t border-line bg-sunk px-5 py-2.5 text-[12px]" aria-label="工作紀錄">
          {pos === 0 && <div className="py-1 text-faint">等待開始…</div>}
          {played.map((s, i) => (
            <LogLine key={i} step={s} at={audit.stamps[i]} first={s.check !== played[i - 1]?.check} />
          ))}
        </div>
      )}
    </Card>
  );
}

const LogLine = memo(function LogLine({ step, at, first }: { step: TraceStep; at: number; first: boolean }) {
  const time = <span className="num w-[44px] shrink-0 text-faint">+{(at / 1000).toFixed(1)}s</span>;
  if (step.phase !== "check")
    return (
      <div className={cn("flex gap-2 py-[3px] font-medium", step.tone === "warn" ? "text-bad" : step.tone === "ok" ? "text-ok" : "text-ink-2")}>
        {time}
        <span>{step.text}</span>
      </div>
    );
  return (
    <>
      {first && (
        <div className="mt-1.5 flex gap-2 py-[3px] font-semibold text-ink">
          {time}
          <span>
            {CHECK_META[step.check!].label}
            <span className="ml-2 font-normal text-faint">{CHECK_META[step.check!].description}</span>
          </span>
        </div>
      )}
      <div className={cn("flex gap-2 py-[2px] pl-[52px]", step.tone === "warn" && "animate-rise rounded-[6px] bg-bad-soft text-bad")}>
        <span className="w-3 shrink-0">{step.tone === "warn" ? "!" : step.tone === "skip" ? "–" : "✓"}</span>
        <span className={cn("w-[84px] shrink-0 truncate", step.tone === "skip" ? "text-faint" : "text-ink-2")}>{step.subject}</span>
        <span className={cn("min-w-0", step.tone === "skip" ? "text-faint" : step.tone === "ok" ? "text-muted" : "font-medium")}>{step.text}</span>
      </div>
    </>
  );
});
