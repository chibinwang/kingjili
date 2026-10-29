"use client";

import { Brain, Lightbulb, Sparkles, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Link from "next/link";
import { RulesPanel, useEscalations } from "@/components/ai/RulesPanel";
import { HoverMenu } from "@/components/HoverMenu";
import { SAMPLE_COMMANDS } from "@/components/shell/AiDrawer";
import { TaskCard } from "@/components/TaskCard";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Modal, PageHeader, Segmented, Select } from "@/components/ui";
import { deleteMemory, saveMemory } from "@/lib/actions";
import { RULE_KIND_LABEL } from "@/lib/automation";
import { useAutomationRules } from "@/lib/automationRules";
import type { AgentMemory } from "@/lib/domain/types";
import { maps } from "@/lib/selectors";
import { useDb, useStore } from "@/lib/store";
import { formatDate, formatDateTime } from "@/lib/time";

export default function AiPage() {
  return (
    <Suspense>
      <Ai />
    </Suspense>
  );
}

function Ai() {
  const db = useDb();
  const params = useSearchParams();
  const setAiOpen = useStore((s) => s.setAiOpen);
  const initialTab = params.get("tab");
  const [tab, setTab] = useState<"queue" | "rules" | "history" | "memory">(initialTab === "memory" || initialTab === "rules" ? initialTab : "queue");
  const rules = useAutomationRules((s) => s.rules);
  const { escalated, autoCount } = useEscalations();
  const pending = db.aiTasks.filter((t) => t.status === "awaiting_approval").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const history = db.aiTasks.filter((t) => t.status !== "awaiting_approval").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const committed = history.filter((t) => t.status === "committed").length;

  return (
    <div className="animate-rise space-y-5">
      <PageHeader
        eyebrow="AI WORKSPACE"
        title="AI 工作台"
        sub="AI 的每個動作都走同一條路：意圖 → 唯讀計畫 → 試算差異 → 規則驗證 → 有權限的人核准 → 執行 → 寫入操作紀錄。工作記憶只存經核准的作業偏好，不作為帳務數字來源。"
        right={<HoverMenu label={<><Lightbulb size={15} /> 試試看</>} hint="點一下，指令會帶入 AI 對話；隨時也可按上方「問 AI」" items={SAMPLE_COMMANDS} onPick={(c) => setAiOpen(true, c)} />}
      />
      <div className="flex items-center justify-between">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "queue", label: `待核准（${pending.length + escalated.length}）` },
            { value: "rules", label: `自動化規則（${rules.filter((r) => r.enabled).length}）` },
            { value: "history", label: `歷史（${committed} 已執行）` },
            { value: "memory", label: `工作記憶（${db.memories.length}）` },
          ]}
        />
      </div>
      {tab === "queue" && escalated.length > 0 && (
        <Card data-testid="rule-escalations">
          <CardHeader
            title={`自動化規則轉給你（${escalated.length}）`}
            sub={`其餘 ${autoCount} 件符合規則條件，由規則自動處理（模擬）。以下太特殊或超出條件，需要你決定。`}
          />
          <ul className="divide-y divide-line border-t border-line">
            {escalated.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-5 py-2.5 text-[12.5px]">
                <Badge tone="outline">{RULE_KIND_LABEL[e.rule.kind]}</Badge>
                <span className="font-medium text-ink">{e.subject}</span>
                <span className="min-w-0 flex-1 text-muted">{e.detail}</span>
                <Link href={e.href} className="text-[12px] text-info hover:underline">
                  前往處理
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {tab === "rules" && <RulesPanel />}
      {tab === "queue" && (
        <div className="grid gap-3 lg:grid-cols-2">
          {pending.length === 0 && (
            <Card className="lg:col-span-2">
              <Empty icon={<Sparkles size={26} />} title="沒有待核准的建議" sub="AI 建議經核准或退回後會移到歷史" />
            </Card>
          )}
          {pending.map((t) => (
            <TaskCard key={t.id} task={t} defaultOpen />
          ))}
        </div>
      )}
      {tab === "history" && (
        <div className="space-y-2.5">
          {history.length === 0 && (
            <Card>
              <Empty title="尚無歷史" />
            </Card>
          )}
          {history.map((t) => (
            <TaskCard key={t.id} task={t} compact />
          ))}
        </div>
      )}
      {tab === "memory" && <Memory />}
    </div>
  );
}

const SCOPE_LABEL: Record<AgentMemory["scope"], string> = { customer: "客戶", product: "品項", company: "公司", supplier: "供應商" };

function Memory() {
  const db = useDb();
  const run = useStore((s) => s.run);
  const m = maps(db);
  const [adding, setAdding] = useState(false);
  const owner = db.users.find((u) => u.role === "owner")!;
  return (
    <Card>
      <CardHeader
        title="工作記憶"
        sub="每筆記憶都附依據、來源事件、核准人與到期日；餘額、發票金額永遠從帳本即時計算，不從記憶推導。"
        right={
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Brain size={14} /> 新增記憶
          </Button>
        }
      />
      <div className="overflow-x-auto">
        <table className="tbl min-w-[900px]">
          <thead>
            <tr>
              <th>範圍</th>
              <th>內容</th>
              <th>依據</th>
              <th>來源事件</th>
              <th>核准</th>
              <th>到期</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {db.memories.map((mem) => (
              <tr key={mem.id} className="row-hover">
                <td>
                  <Badge tone="outline">{SCOPE_LABEL[mem.scope]}</Badge>
                  <div className="mt-0.5 text-[11.5px] text-muted">{m.customers.get(mem.subjectId)?.name ?? m.products.get(mem.subjectId)?.name ?? mem.subjectId}</div>
                </td>
                <td>
                  <div className="font-medium">{mem.key}</div>
                  <div className="text-[12.5px] text-ink-2">{mem.valueText}</div>
                </td>
                <td className="text-[12px] text-muted">{mem.evidence}</td>
                <td className="num text-[12px]">{mem.provenanceEventId}</td>
                <td className="text-[12px]">
                  {m.users.get(mem.approvedBy)?.name}
                  <div className="text-faint">{formatDateTime(mem.lastConfirmedAt)}</div>
                </td>
                <td className="num text-[12px]">{mem.expiresAt ? formatDate(mem.expiresAt, { year: true }) : "—"}</td>
                <td className="r">
                  <Button size="sm" variant="ghost" onClick={() => run((d, c) => deleteMemory(d, c, mem.id, "人工移除"), "已移除記憶", { asUserId: owner.id })} aria-label="移除">
                    <Trash2 size={13} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <AddMemory onClose={() => setAdding(false)} />}
    </Card>
  );
}

function AddMemory({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const run = useStore((s) => s.run);
  const owner = db.users.find((u) => u.role === "owner")!;
  const [subjectId, setSubject] = useState(db.customers[0].id);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [evidence, setEvidence] = useState("");
  const [expires, setExpires] = useState("2027-04-30");
  return (
    <Modal
      open
      onClose={onClose}
      width={520}
      title="新增工作記憶"
      sub="需附依據；核准後 AI 才會引用"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => run((d, c) => saveMemory(d, c, { scope: "customer", subjectId, key, valueText: value, evidence, expiresAt: expires }), "已核准並儲存記憶", { asUserId: owner.id }) && onClose()}>
            核准並儲存
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="客戶">
          <Select value={subjectId} onChange={(e) => setSubject(e.target.value)}>
            {db.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="項目">
          <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="例如：收貨時間" />
        </Field>
        <Field label="內容" className="col-span-2">
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="例如：週三公休，不收貨" />
        </Field>
        <Field label="依據（必填）">
          <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="例如：客戶 LINE 10/20" />
        </Field>
        <Field label="到期日">
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
