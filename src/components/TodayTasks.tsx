"use client";

import { ArrowRight, ListTodo } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useEscalations } from "@/components/ai/RulesPanel";
import { RULE_KIND_LABEL } from "@/lib/automation";
import { cn } from "@/lib/cn";
import { RISK_LABEL, type AiTask } from "@/lib/domain/ai";
import type { Feature } from "@/lib/domain/types";
import { useDb } from "@/lib/store";
import { useLiveTask, useTaskApproval } from "./TaskCard";
import { Badge, Button } from "./ui";

const FEATURE_HREF: Partial<Record<Feature, string>> = {
  dispatch: "/dispatch",
  picking: "/dispatch",
  procurement: "/procurement",
  inventory: "/inventory",
  orders: "/orders",
  crm: "/customers",
  ar: "/customers",
  statements: "/accounting?tab=review",
  invoices: "/invoices",
};

/**
 * Everything waiting on a person today: AI proposals awaiting approval and cases automation rules handed back.
 * Low-risk proposals can be approved right here; everything else links to the page where it is reviewed in full.
 */
export function useTodayTasks() {
  const db = useDb();
  const { escalated } = useEscalations();
  const pending = db.aiTasks.filter((t) => t.status === "awaiting_approval").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const done = db.aiTasks.filter((t) => t.status === "committed" || t.status === "rejected").length;
  return { pending, escalated, done, total: pending.length + escalated.length, urgent: pending.some((t) => t.risk === "high") };
}

export function TodayTaskList({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const { pending, escalated } = useTodayTasks();
  if (!pending.length && !escalated.length) return <div className="rounded-[10px] bg-ok-soft px-4 py-6 text-center text-[13px] text-ok">今天沒有等你決定的事</div>;
  return (
    <div className={cn("space-y-3", className)}>
      {pending.length > 0 && (
        <section>
          <GroupTitle title="AI 建議待核准" n={pending.length} hint="低風險可直接核准，其他請到該頁看完整差異" />
          <ul className="divide-y divide-line rounded-[10px] border border-line">
            {pending.map((t) => (
              <TaskRow key={t.id} task={t} onNavigate={onNavigate} />
            ))}
          </ul>
        </section>
      )}
      {escalated.length > 0 && (
        <section>
          <GroupTitle title="自動化規則轉給你" n={escalated.length} hint="超出規則條件或太特殊，需要人判斷" />
          <ul className="divide-y divide-line rounded-[10px] border border-line">
            {escalated.map((e, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Badge tone="outline">{RULE_KIND_LABEL[e.rule.kind]}</Badge>
                    <span className="truncate text-[12.5px] font-medium text-ink">{e.subject}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[11.5px] text-muted">{e.detail}</div>
                </div>
                <GoReview href={e.href} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function GroupTitle({ title, n, hint }: { title: string; n: number; hint: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2 px-0.5">
      <span className="text-[12px] font-semibold text-ink-2">
        {title} <span className="num text-muted">{n}</span>
      </span>
      <span className="truncate text-[11px] text-faint">{hint}</span>
    </div>
  );
}

function GoReview({ href, onNavigate }: { href: string; onNavigate?: () => void }) {
  return (
    <Link href={href} onClick={onNavigate} className="inline-flex shrink-0 items-center gap-0.5 rounded-[8px] border border-line-strong px-2 py-1 text-[12px] font-medium text-ink-2 hover:border-amber hover:text-ink">
      前往審核 <ArrowRight size={12} />
    </Link>
  );
}

function TaskRow({ task: raw, onNavigate }: { task: AiTask; onNavigate?: () => void }) {
  const task = useLiveTask(raw);
  const { approve, label, blocked } = useTaskApproval(task);
  const href = task.citations.find((c) => c.href)?.href ?? FEATURE_HREF[task.feature] ?? "/ai";
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Badge tone={task.risk === "high" ? "bad" : task.risk === "medium" ? "warn" : "neutral"}>{RISK_LABEL[task.risk]}</Badge>
          <span className="truncate text-[12.5px] font-medium text-ink">{task.title}</span>
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-muted">{task.summary}</div>
      </div>
      {task.risk === "low" ? (
        <Button size="sm" variant="ai" onClick={approve} disabled={blocked} title={label}>
          核准
        </Button>
      ) : (
        <GoReview href={href} onNavigate={onNavigate} />
      )}
    </li>
  );
}

/** Top-bar entry beside the bell. */
export function TodayTasksButton() {
  const [open, setOpen] = useState(false);
  const { total, urgent, done } = useTodayTasks();
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`今日任務，${total} 件等你決定`} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] font-semibold text-ink-2 hover:bg-black/[.04]">
        <ListTodo size={16} />
        <span className="hidden sm:inline">今日任務</span>
        {total > 0 && <span className={cn("num grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10.5px] font-semibold", urgent ? "bg-bad text-white" : "bg-amber text-ink")}>{total}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-3 top-[60px] z-40 animate-rise overflow-hidden rounded-[12px] border border-line bg-surface shadow-[var(--shadow-pop)] sm:absolute sm:inset-x-auto sm:top-12 sm:right-0 sm:w-[440px]" role="dialog" aria-label="今日任務">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="text-[13px] font-semibold">今日任務・{total} 件等你決定</span>
              <span className="text-[11.5px] text-muted">已處理 {done} 件</span>
            </div>
            <div className="scroll-thin max-h-[min(70vh,560px)] overflow-y-auto p-3">
              <TodayTaskList onNavigate={() => setOpen(false)} />
            </div>
            <Link href="/ai" onClick={() => setOpen(false)} className="block border-t border-line bg-sunk px-4 py-2 text-center text-[12px] text-muted hover:text-ink">
              在 AI 工作台查看完整內容
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
