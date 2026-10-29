"use client";

import { ArrowUp, BarChart3, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { proposeFromCommand } from "@/lib/agent";
import { logInsightsReport } from "@/lib/actions";
import { buildRequest } from "@/lib/insights/dataset";
import { httpDataSource, localDataSource } from "@/lib/insights/dataSource";
import { generateInsights, insightsConfig, remoteModel, rulesModel, type InsightsStep } from "@/lib/insights/engine";
import type { InsightsReport, InsightsTopic, RangePreset } from "@/lib/insights/types";
import { can } from "@/lib/permissions";
import { useCurrentUser, useDb, useStore } from "@/lib/store";
import { DEMO_TODAY } from "@/lib/time";
import { useIsClient } from "../ui";
import { InsightsLauncher, InsightsProgress, InsightsReportCard, InsightsReportModal } from "../insights/Insights";
import { TaskCard } from "../TaskCard";

export const SAMPLE_COMMANDS = ["幫我重新安排今天兩台車", "找出10月未收款客戶", "把冷凍薯條補貨門檻設為30箱", "替福記炸物店產出月結預覽", "檢查本月月結單", "有哪些品項需要補貨"];

interface Msg {
  role: "user" | "agent";
  text?: string;
  taskId?: string;
  /** Insights: the picker, a run in progress, or a finished report. */
  launcher?: boolean;
  progress?: { step: InsightsStep; detail?: string };
  report?: InsightsReport;
  error?: string;
}

export function AiDrawer() {
  const open = useStore((s) => s.aiOpen);
  const input = useStore((s) => s.aiDraft);
  const setInput = (v: string) => useStore.setState({ aiDraft: v });
  const setAiOpen = useStore((s) => s.setAiOpen);
  const runWith = useStore((s) => s.runWith);
  const db = useDb();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [thinking, setThinking] = useState(false);
  const [openReport, setOpenReport] = useState<InsightsReport | null>(null);
  const user = useCurrentUser();
  const client = useIsClient();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, thinking]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAiOpen(!useStore.getState().aiOpen);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [setAiOpen]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || thinking) return;
    setMsgs((m) => [...m, { role: "user", text: t }]);
    setInput("");
    setThinking(true);
    setTimeout(() => {
      const task = runWith((d, ctx) => proposeFromCommand(d, ctx, t));
      setThinking(false);
      if (task) setMsgs((m) => [...m, { role: "agent", taskId: task.id }]);
    }, 650);
  };

  const showLauncher = () => {
    if (thinking) return;
    // one picker at a time: reuse the last one if it is still the latest message
    setMsgs((m) => (m.at(-1)?.launcher ? m : [...m, { role: "agent", launcher: true }]));
  };

  /** Pull past data through the configured source, have the configured model write it up, validate every number. */
  const runInsights = async (topic: InsightsTopic, preset: RangePreset, question: string) => {
    if (thinking) return;
    const request = buildRequest(topic, preset, DEMO_TODAY, question);
    const cfg = insightsConfig();
    setThinking(true);
    setMsgs((m) => [...m.filter((x) => !x.launcher), { role: "user", text: `洞察報告：${request.range.label}${question.trim() ? `・${question.trim()}` : ""}` }, { role: "agent", progress: { step: "data" } }]);
    const setStep = (step: InsightsStep, detail?: string) => setMsgs((m) => m.map((x) => (x.progress ? { ...x, progress: { step, detail } } : x)));
    // short pauses so the steps are readable; the offline rules finish instantly
    const pause = () => new Promise((r) => setTimeout(r, 380));
    try {
      const st = useStore.getState();
      const report = await generateInsights({
        request,
        source: cfg.dataUrl ? httpDataSource(cfg.dataUrl) : localDataSource(st.db),
        model: cfg.model === "claude" ? remoteModel() : rulesModel,
        asOf: DEMO_TODAY,
        includesMargin: can(user.role, "view.margin"),
        generatedBy: user.name,
        now: st.now(),
        id: `ins-${st.tick + 1}`,
        onStep: (step, detail) => setStep(step, detail),
      });
      await pause();
      setStep("validate");
      await pause();
      runWith((d, ctx) => ({
        db: logInsightsReport(d, ctx, {
          id: report.id,
          title: report.draft.title,
          range: report.request.range.label,
          model: report.provenance.model.name,
          dataSource: report.provenance.data.label,
          facts: report.dataset.facts.length,
          issues: report.provenance.validation.issues.length,
          fellBack: report.provenance.model.fallbackReason,
        }),
        value: null,
      }));
      setMsgs((m) => m.map((x) => (x.progress ? { role: "agent", report } : x)));
    } catch (e) {
      setMsgs((m) => m.map((x) => (x.progress ? { role: "agent", error: `無法產生報告：${(e as Error).message}` } : x)));
    } finally {
      setThinking(false);
    }
  };

  if (!open || !client) return null;
  return createPortal(
    <div className="no-print fixed inset-y-0 right-0 z-40 flex w-full max-w-[460px] animate-slide-in flex-col border-l border-line bg-paper shadow-[var(--shadow-pop)]">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-ai text-white">
            <Sparkles size={16} />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="text-[14px] font-semibold">Everyse AI</div>
            <div className="truncate text-[11.5px] text-muted" title="提出建議・試算・驗證；寫入帳務前必須由人員核准">提出建議・試算・驗證；寫入帳務前必須由人員核准</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={showLauncher} disabled={thinking} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg whitespace-nowrap border border-ai/30 bg-ai-soft px-2.5 text-[12.5px] font-medium text-ai hover:border-ai/60 disabled:opacity-50">
            <BarChart3 size={14} /> 洞察報告
          </button>
          <button onClick={() => setAiOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5" aria-label="關閉">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {msgs.length === 0 && (
          <div className="rounded-[12px] border border-dashed border-line-strong bg-surface/60 p-4 text-[12.5px] leading-relaxed text-muted">
            用自然語言下指令。我會先產生<strong className="text-ink-2">唯讀計畫與試算差異</strong>，再跑規則驗證；涉及路線、庫存門檻或帳務的動作都需要有權限的人核准，並寫入操作紀錄。
            <div className="mt-2">
              想看過去的營收、毛利、客戶、進銷存或收款狀況，按右上角<strong className="text-ai">「洞察報告」</strong>，我會從帳本拉資料整理成報告。
            </div>
            <div className="mt-2 text-[11.5px] text-faint">示範版為離線規則式代理，未呼叫外部模型。快捷鍵 ⌘K</div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-[14px] rounded-br-[4px] bg-ink px-3.5 py-2 text-[13px] text-white">{m.text}</div>
            </div>
          ) : m.launcher ? (
            <div key={i} className="animate-rise">
              <InsightsLauncher onRun={runInsights} busy={thinking} />
            </div>
          ) : m.progress ? (
            <div key={i} className="animate-rise">
              <InsightsProgress step={m.progress.step} detail={m.progress.detail} />
            </div>
          ) : m.report ? (
            <div key={i} className="animate-rise">
              <InsightsReportCard report={m.report} onOpen={() => setOpenReport(m.report!)} />
            </div>
          ) : m.error ? (
            <div key={i} className="rounded-[12px] bg-bad-soft px-3.5 py-2.5 text-[12.5px] text-bad">
              {m.error}
            </div>
          ) : (
            <div key={i} className="animate-rise">
              {(() => {
                const t = db.aiTasks.find((x) => x.id === m.taskId);
                return t ? <TaskCard task={t} defaultOpen /> : null;
              })()}
            </div>
          ),
        )}
        {thinking && (
          <div className="flex items-center gap-2 px-1 text-[12.5px] text-ai">
            <Sparkles size={14} className="animate-pulse-soft" /> 讀取資料、試算中…
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="border-t border-line bg-surface px-4 pt-3 pb-4">
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          <button onClick={showLauncher} disabled={thinking} className="inline-flex items-center gap-1 rounded-full border border-ai/40 bg-ai-soft px-2.5 py-1 text-[11.5px] font-medium text-ai hover:border-ai disabled:opacity-50">
            <BarChart3 size={12} /> 洞察報告
          </button>
          {SAMPLE_COMMANDS.map((c) => (
            <button key={c} onClick={() => send(c)} className="rounded-full border border-line bg-sunk px-2.5 py-1 text-[11.5px] text-ink-2 hover:border-ai/40 hover:text-ai">
              {c}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2 rounded-[12px] border border-line-strong bg-surface p-1.5 focus-within:border-ai/50"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={2}
            placeholder="例如：找出10月未收款客戶"
            className="flex-1 resize-none bg-transparent px-2 py-1 text-[13px] placeholder:text-faint focus:outline-none"
          />
          <button type="submit" className="grid h-8 w-8 place-items-center rounded-[9px] bg-ai text-white disabled:opacity-40" disabled={!input.trim() || thinking} aria-label="送出">
            <ArrowUp size={16} />
          </button>
        </form>
      </div>
      {openReport && <InsightsReportModal report={openReport} onClose={() => setOpenReport(null)} />}
    </div>,
    document.body,
  );
}
