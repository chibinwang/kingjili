"use client";

import { ArrowUpRight, Lightbulb, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { HoverMenu } from "@/components/HoverMenu";
import { Badge, Button, Card, CardHeader, Empty } from "@/components/ui";
import { describeRule, parseRule, RULE_EXAMPLES, RULE_KIND_LABEL, simulateRule, type AutomationRule, type RuleKind, type RuleOutcome, type RuleParams } from "@/lib/automation";
import { useAutomationRules } from "@/lib/automationRules";
import { cn } from "@/lib/cn";
import type { Db } from "@/lib/db";
import { useCurrentUser, useDb } from "@/lib/store";
import { formatDateTime } from "@/lib/time";

export function RulesPanel() {
  const db = useDb();
  const user = useCurrentUser();
  const rules = useAutomationRules((s) => s.rules);
  const { add } = useAutomationRules.getState();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<{ text: string; kind: RuleKind; params: RuleParams } | { error: string } | null>(null);

  const parse = () => {
    const r = parseRule(text, db);
    setDraft(r.ok ? { text: text.trim(), kind: r.kind, params: r.params } : { error: r.reply });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="新增自動化規則"
          sub="用一句話說明哪個流程、在什麼情況下可以自動處理；不符合條件或太特殊的情況會轉給你。"
          right={<HoverMenu size="sm" label={<><Lightbulb size={14} /> 範例</>} hint="點一下帶入輸入框" items={RULE_EXAMPLES} onPick={(c) => (setText(c), setDraft(null))} width={340} />}
        />
        <div className="px-5 pb-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              parse();
            }}
            className="flex items-end gap-2 rounded-[12px] border border-line-strong bg-surface p-1.5 focus-within:border-ai/50"
          >
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  parse();
                }
              }}
              rows={2}
              aria-label="規則描述"
              placeholder="例如：收款跟應收差 10 元以內就自動沖帳，其他交給我"
              className="flex-1 resize-none bg-transparent px-2 py-1 text-[13px] placeholder:text-faint focus:outline-none"
            />
            <Button type="submit" variant="ai" size="sm" disabled={!text.trim()}>
              <Wand2 size={14} /> 解析規則
            </Button>
          </form>

          {draft && "error" in draft && <div className="mt-3 rounded-[10px] bg-sunk px-3.5 py-2.5 text-[12.5px] text-ink-2">{draft.error}</div>}
          {draft && "kind" in draft && (
            <div className="mt-4 animate-rise rounded-[12px] border border-ai/30 bg-ai-soft/40 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge tone="ai" dot>
                  AI 解讀
                </Badge>
                <span className="text-[13px] font-semibold">{RULE_KIND_LABEL[draft.kind]}</span>
                <span className="text-[12px] text-muted">請確認解讀正確再啟用</span>
              </div>
              <RuleLines rule={draft} db={db} />
              <Simulation outcomes={simulateRule(draft, db)} />
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                  重寫
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    add({ text: draft.text, kind: draft.kind, params: draft.params, enabled: true, createdBy: user.name });
                    setText("");
                    setDraft(null);
                    toast.success("規則已啟用（模擬）");
                  }}
                >
                  啟用規則
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {rules.length === 0 ? (
        <Card>
          <Empty icon={<Wand2 size={26} />} title="還沒有自動化規則" sub="在上方用一句話新增第一條規則" />
        </Card>
      ) : (
        rules.map((r) => <RuleCard key={r.id} rule={r} />)
      )}
    </div>
  );
}

function RuleCard({ rule }: { rule: AutomationRule }) {
  const db = useDb();
  const { toggle, remove } = useAutomationRules.getState();
  const outcomes = useMemo(() => simulateRule(rule, db), [rule, db]);
  return (
    <Card className={cn("p-5", !rule.enabled && "opacity-70")} data-testid="rule-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold">{RULE_KIND_LABEL[rule.kind]}</span>
            {rule.enabled ? <Badge tone="ok" dot>啟用中</Badge> : <Badge tone="neutral">已停用</Badge>}
          </div>
          <div className="mt-1 text-[13px] text-ink-2">「{rule.text}」</div>
          <div className="mt-0.5 text-[11.5px] text-faint">
            {rule.createdBy}・{formatDateTime(rule.createdAt)}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button role="switch" aria-checked={rule.enabled} aria-label={`${rule.enabled ? "停用" : "啟用"}規則`} onClick={() => toggle(rule.id)} className={cn("relative h-6 w-11 rounded-full transition-colors", rule.enabled ? "bg-ok" : "bg-line-strong")}>
            <span className={cn("absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", rule.enabled && "translate-x-5")} />
          </button>
          <Button variant="ghost" size="icon" aria-label="刪除規則" onClick={() => remove(rule.id)}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
      <div className="mt-4">
        <RuleLines rule={rule} db={db} />
      </div>
      {rule.enabled && <Simulation outcomes={outcomes} />}
    </Card>
  );
}

function RuleLines({ rule, db }: { rule: Pick<AutomationRule, "kind" | "params">; db: Db }) {
  const d = describeRule(rule, db);
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-[72px_1fr]">
      {(
        [
          ["何時", d.when, "text-ink"],
          ["條件", d.condition, "text-ink"],
          ["自動處理", d.action, "text-ok"],
          ["轉給人員", d.escalate, "text-warn"],
        ] as const
      ).map(([l, v, cls]) => (
        <div key={l} className="contents">
          <dt className="text-muted">{l}</dt>
          <dd className={cn("font-medium", cls)}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Simulation({ outcomes }: { outcomes: RuleOutcome[] }) {
  const auto = outcomes.filter((o) => o.decision === "auto").length;
  return (
    <div className="mt-4 rounded-[10px] border border-line bg-sunk">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2 text-[12px]">
        <span className="font-semibold text-ink">用目前資料試跑</span>
        <span className="text-ok">自動處理 {auto} 件</span>
        <span className="text-faint">・</span>
        <span className="text-warn">轉給人員 {outcomes.length - auto} 件</span>
        <Badge tone="mock" className="ml-auto">
          模擬・不寫入帳務
        </Badge>
      </div>
      {outcomes.length === 0 ? (
        <div className="px-3.5 py-2.5 text-[12px] text-faint">目前沒有會觸發這條規則的事件</div>
      ) : (
        <ul className="divide-y divide-line">
          {outcomes.map((o, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3.5 py-2 text-[12.5px]">
              <Badge tone={o.decision === "auto" ? "ok" : "warn"}>{o.decision === "auto" ? "自動處理" : "轉給人員"}</Badge>
              <span className="font-medium text-ink">{o.subject}</span>
              <span className="min-w-0 flex-1 text-muted">{o.detail}</span>
              <Link href={o.href} className="inline-flex items-center gap-0.5 text-[12px] text-info hover:underline">
                查看 <ArrowUpRight size={12} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Items enabled rules would hand to a person right now, for the 待核准 queue. */
export function useEscalations() {
  const db = useDb();
  const rules = useAutomationRules((s) => s.rules);
  return useMemo(() => {
    const live = rules.filter((r) => r.enabled).map((r) => ({ rule: r, outcomes: simulateRule(r, db) }));
    const pick = (d: RuleOutcome["decision"]) => live.flatMap(({ rule, outcomes }) => outcomes.filter((o) => o.decision === d).map((o) => ({ rule, ...o })));
    const handled = pick("auto");
    return { escalated: pick("escalate"), handled, autoCount: handled.length };
  }, [rules, db]);
}
