"use client";

import { ArrowRight, ArrowUp, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { STATEMENT_COMMAND_EXAMPLES } from "@/lib/domain/statementCommands";
import type { DraftMsg } from "@/lib/statementDrafts";

/** Chat beside the statement preview: each message is one edit instruction. */
export function StatementChat({ customerName, messages, onSend }: { customerName: string; messages: DraftMsg[]; onSend: (text: string) => void }) {
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // scroll the message list only, never the page
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, thinking]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || thinking) return;
    setInput("");
    setThinking(true);
    // a short beat so the reply reads as a response, not a flicker
    setTimeout(() => {
      onSend(t);
      setThinking(false);
    }, 350);
  };

  return (
    <aside className="no-print flex h-[560px] xl:h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-ai text-white">
          <Sparkles size={15} />
        </span>
        <div className="leading-tight">
          <div className="text-[13.5px] font-semibold">對帳單助理</div>
          <div className="text-[11.5px] text-muted">用一句話修改這份對帳單</div>
        </div>
      </div>

      <div ref={listRef} className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        <div className="rounded-[12px] border border-dashed border-line-strong bg-sunk px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-2">
          正在編輯 <b>{customerName}</b> 的對帳單。可以改金額、加折讓、改付款期限、備註或聯絡資料，也能顯示品項明細。
          <div className="mt-1.5 text-[11.5px] text-faint">修改只影響寄給客戶的這份文件，不會改動帳務。示範版為規則式助理，未呼叫外部模型。</div>
        </div>
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-[14px] rounded-br-[4px] bg-ink px-3.5 py-2 text-[13px] text-white">{m.text}</div>
            </div>
          ) : (
            <div key={i} className="animate-rise">
              <div className={cn("max-w-[92%] rounded-[14px] rounded-bl-[4px] px-3.5 py-2.5 text-[13px] whitespace-pre-line", m.ok ? "bg-ai-soft text-ink" : "bg-sunk text-ink-2")}>{m.text}</div>
              {m.changes && m.changes.length > 0 && (
                <div className="mt-1.5 max-w-[92%] space-y-1 rounded-[10px] border border-line px-3 py-2 text-[11.5px]">
                  {m.changes.map((c, j) => (
                    <div key={j} className="flex flex-wrap items-center gap-x-1.5">
                      <span className="font-medium text-ink-2">{c.label}</span>
                      <span className="max-w-[140px] truncate text-faint line-through">{c.before}</span>
                      <ArrowRight size={11} className="text-faint" />
                      <span className="max-w-[160px] truncate font-medium text-ink">{c.after}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {thinking && (
          <div className="flex items-center gap-2 px-1 text-[12.5px] text-ai">
            <Sparkles size={14} className="animate-pulse-soft" /> 修改中…
          </div>
        )}
      </div>

      <div className="border-t border-line px-3 pt-2.5 pb-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {STATEMENT_COMMAND_EXAMPLES.map((c) => (
            <button key={c} type="button" onClick={() => send(c)} className="rounded-full border border-line bg-sunk px-2.5 py-1 text-[11.5px] text-ink-2 hover:border-ai/40 hover:text-ai">
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
            aria-label="修改指令"
            placeholder="例如：第 3 筆金額改成 2,800"
            className="flex-1 resize-none bg-transparent px-2 py-1 text-[13px] placeholder:text-faint focus:outline-none"
          />
          <button type="submit" className="grid h-8 w-8 place-items-center rounded-[9px] bg-ai text-white disabled:opacity-40" disabled={!input.trim() || thinking} aria-label="送出">
            <ArrowUp size={16} />
          </button>
        </form>
      </div>
    </aside>
  );
}
