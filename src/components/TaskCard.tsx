"use client";

import { ArrowRight, Check as CheckIcon, ChevronDown, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { executeTask, reorderTaskSpec, routeTaskSpec } from "@/lib/agent";
import { rejectAiTask } from "@/lib/actions";
import { RISK_LABEL, type AiTask } from "@/lib/domain/ai";
import { cn } from "@/lib/cn";
import { formatTWD } from "@/lib/money";
import { ROLE_LABEL } from "@/lib/permissions";
import { useCurrentUser, useDb, useStore } from "@/lib/store";
import { formatDateTime } from "@/lib/time";
import { Badge, Button, Check } from "./ui";

const STEPS = ["意圖", "唯讀計畫", "試算差異", "規則驗證", "人員核准", "執行", "紀錄"];

function stepIndex(task: AiTask): number {
  if (task.status === "committed") return 7;
  if (task.status === "rejected") return 4;
  if (task.status === "answered") return 4;
  return 4;
}

export function Pipeline({ task }: { task: AiTask }) {
  const idx = stepIndex(task);
  const answered = task.status === "answered";
  return (
    <div className="flex flex-wrap items-center gap-y-1 text-[11px]">
      {STEPS.map((s, i) => {
        if (answered && i >= 4) return null;
        const done = i < idx;
        const current = i === idx && task.status === "awaiting_approval";
        return (
          <span key={s} className="flex items-center">
            <span className={cn("rounded-full px-1.5 py-[1px]", done ? "text-ok" : current ? "bg-warn-soft font-semibold text-warn" : task.status === "rejected" && i === 4 ? "bg-bad-soft text-bad" : "text-faint")}>
              {done && "✓ "}
              {s}
            </span>
            {i < (answered ? 3 : STEPS.length - 1) && <span className="mx-0.5 text-line-strong">›</span>}
          </span>
        );
      })}
    </div>
  );
}

/** Live view: seeded tasks without a stored diff are recomputed from current data. */
export function useLiveTask(task: AiTask): AiTask {
  const db = useDb();
  return useMemo(() => {
    if (task.status !== "awaiting_approval" || task.diff.length) return task;
    const spec = task.kind === "route_reassign" ? routeTaskSpec(db) : task.kind === "reorder_draft" ? reorderTaskSpec(db) : null;
    if (!spec) return task;
    return { ...task, diff: spec.diff, validations: spec.validations, title: spec.title, summary: spec.summary };
  }, [db, task]);
}

/** Approve / reject an AI task as the current user, or as the right role on their behalf in the demo. */
export function useTaskApproval(task: AiTask) {
  const user = useCurrentUser();
  const db = useDb();
  const run = useStore((s) => s.run);
  const canApprove = task.approverRoles.includes(user.role as never);
  const proxy = !canApprove && task.approverRoles.length ? db.users.find((u) => u.role === task.approverRoles[0]) : undefined;
  return {
    approve: () => run((d, ctx) => executeTask(d, ctx, task), "已核准並執行，結果已寫入操作紀錄", proxy ? { asUserId: proxy.id } : undefined),
    reject: () => run((d, ctx) => rejectAiTask(d, ctx, task.id, "人員退回"), "已退回此建議"),
    label: proxy ? `以${ROLE_LABEL[proxy.role]} ${proxy.name} 核准` : "核准並執行",
    blocked: task.validations.some((v) => !v.pass && !v.label.includes("記憶")),
  };
}

export function TaskCard({ task: raw, compact, defaultOpen }: { task: AiTask; compact?: boolean; defaultOpen?: boolean }) {
  const task = useLiveTask(raw);
  const [open, setOpen] = useState(defaultOpen ?? !compact);
  const { approve, reject, label, blocked } = useTaskApproval(task);

  return (
    <div className={cn("rounded-[12px] border bg-surface", task.status === "awaiting_approval" ? "border-ai/25" : "border-line")}>
      <button className="flex w-full items-start gap-3 px-4 pt-3.5 pb-3 text-left" onClick={() => setOpen((o) => !o)}>
        <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[8px]", task.status === "committed" ? "bg-ok-soft text-ok" : "bg-ai-soft text-ai")}>
          {task.status === "committed" ? <CheckIcon size={15} /> : <Sparkles size={15} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13.5px] font-semibold text-ink">{task.title}</span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {task.status === "awaiting_approval" && <Badge tone="ai" dot>AI 建議・待核准</Badge>}
            {task.status === "committed" && <Badge tone="ok" dot>已核准執行</Badge>}
            {task.status === "rejected" && <Badge tone="bad">已退回</Badge>}
            {task.status === "answered" && <Badge tone="info">唯讀回覆</Badge>}
            {task.status !== "answered" && <Badge tone={task.risk === "high" ? "bad" : task.risk === "medium" ? "warn" : "neutral"}>{RISK_LABEL[task.risk]}</Badge>}
            {task.amountCents ? <Badge tone="outline">{formatTWD(task.amountCents)}</Badge> : null}
            <span className="text-[11.5px] text-faint">{formatDateTime(task.createdAt)}</span>
          </span>
        </span>
        <ChevronDown size={16} className={cn("mt-1 shrink-0 text-faint transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="animate-fade space-y-3 border-t border-line px-4 pt-3 pb-4">
          {task.command && (
            <div className="text-[12px] text-muted">
              指令：<span className="text-ink-2">「{task.command}」</span>
            </div>
          )}
          <p className="text-[13px] leading-relaxed text-ink-2">{task.summary}</p>
          <Pipeline task={task} />
          {task.diff.length > 0 && (
            <div className="overflow-hidden rounded-[10px] border border-line">
              <table className="tbl text-[12.5px]">
                <thead>
                  <tr>
                    <th>試算差異（dry-run）</th>
                    <th>目前</th>
                    <th>核准後</th>
                  </tr>
                </thead>
                <tbody>
                  {task.diff.map((d, i) => (
                    <tr key={i}>
                      <td className="text-ink-2">{d.label}</td>
                      <td className="num text-muted">{d.before}</td>
                      <td className="num font-medium text-ink">
                        <span className="inline-flex items-center gap-1">
                          <ArrowRight size={12} className="text-faint" /> {d.after}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {task.validations.length > 0 && (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {task.validations.map((v, i) => (
                <div key={i} className="flex items-start gap-2 text-[12px]">
                  <Check ok={v.pass} size={12} />
                  <span className="text-ink-2">
                    {v.label}
                    {v.detail && <span className="text-faint">・{v.detail}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
          {task.citations.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
              引用紀錄：
              {task.citations.map((c, i) =>
                c.href ? (
                  <Link key={i} href={c.href} className="rounded-md border border-line px-1.5 py-[1px] text-ink-2 hover:border-amber">
                    {c.label}
                  </Link>
                ) : (
                  <span key={i}>{c.label}</span>
                ),
              )}
            </div>
          )}
          {task.resultNote && <div className="rounded-[8px] bg-ok-soft px-3 py-2 text-[12px] text-ok">{task.resultNote}</div>}
          {task.status === "awaiting_approval" && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-line pt-3">
              <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
                <ShieldCheck size={13} />
                需 {task.approverRoles.map((r) => ROLE_LABEL[r]).join("／")} 核准；AI 不會自行寫入帳務
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={reject}>
                  退回
                </Button>
                <Button size="sm" variant="ai" onClick={approve} disabled={blocked}>
                  {label}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
