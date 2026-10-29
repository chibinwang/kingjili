"use client";

import { Bot, Cog, User } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Badge, Card, Drawer, Empty, PageHeader, Segmented, Select } from "@/components/ui";
import type { ActionEvent, Feature } from "@/lib/domain/types";
import { maps } from "@/lib/selectors";
import { useDb } from "@/lib/store";
import { formatDateTime } from "@/lib/time";

const FEATURE_LABEL: Record<Feature, string> = {
  crm: "客戶管理",
  orders: "訂單",
  dispatch: "配送",
  picking: "揀貨",
  inventory: "庫存",
  procurement: "採購",
  ar: "應收",
  statements: "對帳單",
  invoices: "發票",
  ai: "AI",
  memory: "記憶",
  settings: "設定",
};

const STATUS: Record<ActionEvent["status"], { t: string; tone: "ok" | "ai" | "bad" | "mock" | "warn" }> = {
  committed: { t: "已寫入", tone: "ok" },
  proposed: { t: "建議", tone: "ai" },
  rejected: { t: "退回", tone: "bad" },
  simulated: { t: "模擬", tone: "mock" },
  failed: { t: "失敗", tone: "warn" },
};

export default function ActivityPage() {
  return (
    <Suspense>
      <Activity />
    </Suspense>
  );
}

function ActorIcon({ t }: { t: ActionEvent["actorType"] }) {
  const Icon = t === "agent" ? Bot : t === "system" ? Cog : User;
  return (
    <span className={`grid h-7 w-7 place-items-center rounded-full ${t === "agent" ? "bg-ai-soft text-ai" : t === "system" ? "bg-sunk text-muted" : "bg-amber-soft text-amber-deep"}`}>
      <Icon size={14} />
    </span>
  );
}

function Activity() {
  const db = useDb();
  const params = useSearchParams();
  const [feature, setFeature] = useState<Feature | "all">((params.get("feature") as Feature) ?? "all");
  const [actor, setActor] = useState<"all" | "user" | "agent" | "system">("all");
  const [open, setOpen] = useState<ActionEvent | null>(null);
  const events = useMemo(() => [...db.events].filter((e) => (feature === "all" || e.feature === feature) && (actor === "all" || e.actorType === actor)).sort((a, b) => b.seq - a.seq), [db.events, feature, actor]);
  const m = maps(db);
  return (
    <div className="animate-rise space-y-5">
      <PageHeader eyebrow="AUDIT TRAIL" title="操作紀錄" sub="只增不改的事件帳：誰、何時、對哪筆資料做了什麼、誰核准、外部回執。人員、AI 代理與系統分開標示；同一關聯 ID 可追溯從建議到執行的全過程。" />
      <Card>
        <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
          <Segmented
            size="sm"
            value={actor}
            onChange={setActor}
            options={[
              { value: "all", label: "全部" },
              { value: "user", label: "人員" },
              { value: "agent", label: "AI 代理" },
              { value: "system", label: "系統" },
            ]}
          />
          <Select value={feature} onChange={(e) => setFeature(e.target.value as Feature | "all")} className="h-8 w-[150px] text-[12.5px]">
            <option value="all">全部功能</option>
            {Object.entries(FEATURE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <span className="ml-auto text-[12px] text-faint">{events.length} 筆・append-only</span>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl min-w-[900px]">
            <thead>
              <tr>
                <th className="w-14">#</th>
                <th>時間</th>
                <th>執行者</th>
                <th>功能</th>
                <th>內容</th>
                <th>核准</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="row-hover cursor-pointer" onClick={() => setOpen(e)}>
                  <td className="num text-faint">{e.seq}</td>
                  <td className="num whitespace-nowrap">{formatDateTime(e.occurredAt)}</td>
                  <td>
                    <span className="flex items-center gap-2">
                      <ActorIcon t={e.actorType} />
                      <span className="text-[12.5px]">{e.actorName}</span>
                    </span>
                  </td>
                  <td>
                    <Badge tone="outline">{FEATURE_LABEL[e.feature]}</Badge>
                  </td>
                  <td className="max-w-[460px] text-[12.5px]">{e.summary}</td>
                  <td className="text-[12px] text-muted">{e.approvedBy ? m.users.get(e.approvedBy)?.name : "—"}</td>
                  <td>
                    <Badge tone={STATUS[e.status].tone}>{STATUS[e.status].t}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.length === 0 && <Empty title="沒有符合的紀錄" />}
        </div>
      </Card>
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? `事件 #${open.seq}` : ""} sub={open?.summary} width={520}>
        {open && (
          <div className="space-y-4 text-[13px]">
            <dl className="grid grid-cols-[110px_1fr] gap-y-2">
              <dt className="text-muted">時間</dt>
              <dd className="num">{formatDateTime(open.occurredAt)}</dd>
              <dt className="text-muted">執行者</dt>
              <dd>
                {open.actorName}（{open.actorType === "agent" ? "AI 代理" : open.actorType === "system" ? "系統" : "人員"}）
              </dd>
              <dt className="text-muted">動作</dt>
              <dd className="num">
                {open.entityType}.{open.action}
              </dd>
              <dt className="text-muted">對象</dt>
              <dd className="num">{open.entityId}</dd>
              {open.before && (
                <>
                  <dt className="text-muted">變更前</dt>
                  <dd className="num rounded bg-bad-soft/50 px-2 py-0.5">{open.before}</dd>
                </>
              )}
              {open.after && (
                <>
                  <dt className="text-muted">變更後</dt>
                  <dd className="num rounded bg-ok-soft/60 px-2 py-0.5">{open.after}</dd>
                </>
              )}
              {open.reason && (
                <>
                  <dt className="text-muted">原因</dt>
                  <dd>{open.reason}</dd>
                </>
              )}
              <dt className="text-muted">核准</dt>
              <dd>{open.approvedBy ? m.users.get(open.approvedBy)?.name : "—"}</dd>
              {open.externalReceipt && (
                <>
                  <dt className="text-muted">外部回執</dt>
                  <dd className="num">{open.externalReceipt}（模擬）</dd>
                </>
              )}
              <dt className="text-muted">關聯 ID</dt>
              <dd className="num">{open.correlationId}</dd>
            </dl>
            <div>
              <div className="mb-2 text-[12.5px] font-semibold">同一關聯的事件</div>
              {db.events
                .filter((x) => x.correlationId === open.correlationId)
                .map((x) => (
                  <div key={x.id} className="flex items-start gap-2 border-l border-line py-1.5 pl-3">
                    <ActorIcon t={x.actorType} />
                    <div>
                      <div className="text-[12.5px]">{x.summary}</div>
                      <div className="text-[11px] text-faint">
                        #{x.seq}・{formatDateTime(x.occurredAt)}・{x.actorName}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
