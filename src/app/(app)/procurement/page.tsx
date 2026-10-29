"use client";

import { Building2, FilePlus2, MessageCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { AddMenu } from "@/components/AddMenu";
import { PurchaseOrderForm, SupplierForm } from "@/components/forms/SupplierForms";
import { Badge, Button, Card, CardHeader, Check, Drawer, Field, Input, Modal, Money, PageHeader } from "@/components/ui";
import { approveSupplier, approvePurchaseOrder, draftPurchaseOrders, receivePurchaseOrder, sendPurchaseOrderMock, setAutoReorder } from "@/lib/actions";
import { checkAutoReorder, poTotal, reorderSuggestions } from "@/lib/domain/procurement";
import type { PoStatus, PurchaseOrder } from "@/lib/domain/types";
import { formatTWD } from "@/lib/money";
import { maps, stockPositions } from "@/lib/selectors";
import { useDb, useStore } from "@/lib/store";
import { addDays, DEMO_TODAY, formatDate, formatDateTime } from "@/lib/time";

const PO_LABEL: Record<PoStatus, { t: string; tone: "warn" | "info" | "ok" | "neutral" | "bad" | "amber" }> = {
  draft: { t: "草稿", tone: "neutral" },
  pending_approval: { t: "待主管核准", tone: "warn" },
  approved: { t: "已核准・未發送", tone: "info" },
  sent_mock: { t: "已發送（模擬）", tone: "amber" },
  received: { t: "已收貨", tone: "ok" },
  cancelled: { t: "已取消", tone: "bad" },
};

export default function ProcurementPage() {
  const db = useDb();
  const run = useStore((s) => s.run);
  const m = maps(db);
  const pos = stockPositions(db);
  const suggestions = reorderSuggestions(db.products, pos);
  const [preview, setPreview] = useState<PurchaseOrder | null>(null);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [adding, setAdding] = useState<"supplier" | "po" | null>(null);
  const pendingTask = db.aiTasks.find((t) => t.kind === "reorder_draft" && t.status === "awaiting_approval");
  const owner = db.users.find((u) => u.role === "owner")!;
  const proc = db.users.find((u) => u.role === "procurement")!;
  const pos_ = [...db.purchaseOrders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="animate-rise space-y-5">
      <PageHeader
        eyebrow="PROCUREMENT"
        title="採購"
        sub="補貨建議依「預估可用量」而非現有量計算。叫貨單先草擬、經主管核准，才可透過已驗證的供應商管道（模擬）發送。"
        right={
          <AddMenu
            items={[
              { key: "po", label: "手動建立採購單", desc: "選供應商與叫貨量", icon: <FilePlus2 size={16} />, perm: "po.draft", onSelect: () => setAdding("po") },
              { key: "supplier", label: "新增供應商", desc: "建檔後需主管核准", icon: <Building2 size={16} />, perm: "supplier.manage", onSelect: () => setAdding("supplier") },
            ]}
          />
        }
      />
      {adding === "supplier" && <SupplierForm onClose={() => setAdding(null)} />}
      {adding === "po" && <PurchaseOrderForm onClose={() => setAdding(null)} />}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader
            title="補貨建議"
            sub="可用 = 現有 − 過期 − 已保留；預估 = 可用 + 在途"
            right={
              suggestions.length > 0 && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => run((d, c) => draftPurchaseOrders(d, c, suggestions.map((s) => ({ productId: s.productId, qtyBase: s.qtyBase })), pendingTask ? "ai_suggestion" : "manual", pendingTask?.id), "已草擬叫貨單，待主管核准", { asUserId: proc.id })}
                >
                  一鍵草擬叫貨單
                </Button>
              )
            }
          />
          <div className="overflow-x-auto">
            <table className="tbl min-w-[700px]">
              <thead>
                <tr>
                  <th>品項</th>
                  <th>供應商</th>
                  <th className="r">現有</th>
                  <th className="r">保留</th>
                  <th className="r">在途</th>
                  <th className="r">預估可用</th>
                  <th className="r">補貨點</th>
                  <th className="r">建議叫貨</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted">
                      所有品項都在補貨點以上
                    </td>
                  </tr>
                )}
                {suggestions.map((s) => {
                  const p = m.products.get(s.productId)!;
                  const sup = m.suppliers.get(s.supplierId)!;
                  return (
                    <tr key={s.productId} className="row-hover">
                      <td>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-[11.5px] text-faint">
                          {p.sku}・{p.spec}
                        </div>
                      </td>
                      <td className="text-[12.5px]">{sup.name}</td>
                      <td className="r num">{s.position.onHand}</td>
                      <td className="r num text-muted">{s.position.reserved}</td>
                      <td className="r num text-muted">{s.position.inbound || "—"}</td>
                      <td className="r num font-semibold text-warn">{s.position.projected}</td>
                      <td className="r num">{p.reorderPoint}</td>
                      <td className="r num font-semibold">
                        {s.qtyBase / p.packSize} {p.packUnit}
                        <div className="text-[11px] font-normal text-faint">{formatTWD(s.qtyBase * (p.costCents ?? 0))}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <AutoReorderCard />
      </div>

      <Card>
        <CardHeader title="叫貨單" sub="核准後計入在途量；收貨時登錄批號與效期" />
        <div className="overflow-x-auto">
          <table className="tbl min-w-[880px]">
            <thead>
              <tr>
                <th>單號</th>
                <th>供應商</th>
                <th>品項</th>
                <th className="r">金額（成本）</th>
                <th>預計到貨</th>
                <th>來源</th>
                <th>狀態</th>
                <th className="r">動作</th>
              </tr>
            </thead>
            <tbody>
              {pos_.map((po) => {
                const sup = m.suppliers.get(po.supplierId)!;
                return (
                  <tr key={po.id} className="row-hover">
                    <td className="num font-medium">{po.no}</td>
                    <td>
                      {sup.name}
                      <div className="text-[11px] text-faint">
                        {sup.channel === "line_group" ? (sup.lineGroupVerified ? "LINE 群組・已驗證" : "LINE 群組・未驗證") : "電話"}
                      </div>
                    </td>
                    <td className="text-[12.5px]">{po.lines.map((l) => `${m.products.get(l.productId)?.name} ${l.qtyBase / m.products.get(l.productId)!.packSize}箱`).join("、")}</td>
                    <td className="r">
                      <Money cents={poTotal(po)} />
                    </td>
                    <td className="num">{formatDate(po.expectedAt, { weekday: true })}</td>
                    <td>{po.source === "ai_suggestion" ? <Badge tone="ai">AI 建議</Badge> : po.source === "auto_rule" ? <Badge tone="amber">自動規則</Badge> : <Badge tone="neutral">人工</Badge>}</td>
                    <td>
                      <Badge tone={PO_LABEL[po.status].tone} dot>
                        {PO_LABEL[po.status].t}
                      </Badge>
                    </td>
                    <td className="r">
                      <div className="flex justify-end gap-1.5">
                        {po.messagePreview && (
                          <Button size="sm" variant="ghost" onClick={() => setPreview(po)}>
                            訊息預覽
                          </Button>
                        )}
                        {po.status === "pending_approval" && (
                          <Button size="sm" variant="primary" onClick={() => run((d, c) => approvePurchaseOrder(d, c, po.id), "已核准", { asUserId: owner.id })}>
                            以主任核准
                          </Button>
                        )}
                        {po.status === "approved" && (
                          <Button size="sm" variant="outline" onClick={() => run((d, c) => sendPurchaseOrderMock(d, c, po.id), "已模擬發送（未實際送出）", { asUserId: proc.id })}>
                            模擬發送
                          </Button>
                        )}
                        {(po.status === "sent_mock" || po.status === "approved") && (
                          <Button size="sm" variant="outline" onClick={() => setReceiving(po)}>
                            收貨
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="供應商" sub="LINE 群組需有成員權限與 group ID 事件才可發送；未驗證者改電話" />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-4">
          {db.suppliers.map((s) => (
            <div key={s.id} className="rounded-[12px] border border-line p-3.5">
              <div className="font-semibold">{s.name}</div>
              <div className="mt-0.5 text-[12px] text-muted">
                {s.contactName}
                {s.phone && `・${s.phone}`}・交期 {s.leadTimeDays} 天
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.channel === "line_group" ? <Badge tone={s.lineGroupVerified ? "ok" : "warn"}>{s.lineGroupVerified ? "LINE 群組已驗證" : "LINE 群組未驗證"}</Badge> : <Badge tone="neutral">{s.channel === "email" ? "Email 叫貨" : "電話叫貨"}</Badge>}
                {s.approved ? <Badge tone="outline">核准供應商</Badge> : <Badge tone="warn">待主管核准</Badge>}
              </div>
              {!s.approved && (
                <Button size="sm" variant="outline" className="mt-2.5 w-full" onClick={() => run((d, c) => approveSupplier(d, c, s.id), `已核准 ${s.name}`, { asUserId: owner.id })}>
                  <ShieldCheck size={14} /> 以主任 {owner.name} 核准
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Drawer open={!!preview} onClose={() => setPreview(null)} title="LINE 叫貨訊息預覽" sub={preview ? `${preview.no}・${m.suppliers.get(preview.supplierId)?.name}` : ""} width={440}>
        {preview && (
          <div>
            <div className="mb-3 flex items-center gap-2 text-[12px] text-muted">
              <MessageCircle size={14} className="text-ok" /> 金吉利食品 → {m.suppliers.get(preview.supplierId)?.name} 群組
            </div>
            <div className="rounded-[14px] rounded-tr-[4px] bg-[#e9f7ee] px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap">{preview.messagePreview}</div>
            <div className="mt-4 rounded-[10px] border border-dashed border-line-strong px-3 py-2.5 text-[12px] text-muted">外部發送未啟用：示範版只產生訊息，核准後按「模擬發送」也不會連到 LINE。</div>
          </div>
        )}
      </Drawer>
      {receiving && <ReceiveModal po={receiving} onClose={() => setReceiving(null)} />}
    </div>
  );
}

function AutoReorderCard() {
  const db = useDb();
  const run = useStore((s) => s.run);
  const owner = db.users.find((u) => u.role === "owner")!;
  const s1 = db.suppliers[0];
  const check = checkAutoReorder(db.settings, s1, 1_500_000, 0);
  const st = db.settings.autoReorder;
  return (
    <Card>
      <CardHeader title="自動補貨" sub="預設關閉；啟用後仍受上限與核准供應商限制" right={<Badge tone={st.enabled ? "ok" : "neutral"}>{st.enabled ? "已啟用" : "關閉"}</Badge>} />
      <div className="space-y-3 px-5 pb-5 text-[12.5px]">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-[10px] bg-sunk px-3 py-2">
            <div className="text-muted">單筆上限</div>
            <div className="num font-semibold">{formatTWD(st.ceilingCents)}</div>
          </div>
          <div className="rounded-[10px] bg-sunk px-3 py-2">
            <div className="text-muted">每日上限</div>
            <div className="num font-semibold">{st.maxPerDay} 筆</div>
          </div>
        </div>
        <div>
          <div className="mb-1.5 font-medium text-ink-2">範例：向 {s1.name} 自動叫 NT$15,000</div>
          {[
            { l: "自動補貨已啟用", ok: st.enabled },
            { l: "供應商在核准名單", ok: s1.approved },
            { l: "LINE 群組已驗證", ok: s1.lineGroupVerified },
            { l: "金額未超過單筆上限", ok: 1_500_000 <= st.ceilingCents },
          ].map((x) => (
            <div key={x.l} className="flex items-center gap-2 py-0.5">
              <Check ok={x.ok} size={11} /> {x.l}
            </div>
          ))}
          <div className={`mt-1.5 text-[12px] ${check.allowed ? "text-ok" : "text-muted"}`}>{check.allowed ? "會自動建立叫貨單（仍記錄於操作紀錄）" : `不會自動叫貨：${check.reasons[0]}`}</div>
        </div>
        <Button variant="outline" size="sm" className="w-full" onClick={() => run((d, c) => setAutoReorder(d, c, !st.enabled), st.enabled ? "已關閉自動補貨" : "已啟用自動補貨（受上限保護）", { asUserId: owner.id })}>
          <ShieldCheck size={14} /> {st.enabled ? "關閉自動補貨" : "以主任身分啟用"}
        </Button>
      </div>
    </Card>
  );
}

function ReceiveModal({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const run = useStore((s) => s.run);
  const db = useDb();
  const wh = db.users.find((u) => u.role === "warehouse")!;
  const [lot, setLot] = useState(`L${DEMO_TODAY.slice(2).replaceAll("-", "")}`);
  const [expiry, setExpiry] = useState(addDays(DEMO_TODAY, 180));
  return (
    <Modal
      open
      onClose={onClose}
      width={440}
      title={`冷凍收貨・${po.no}`}
      sub={`由倉管 ${wh.name} 登錄；入庫即可供 FEFO 分配`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => run((d, c) => receivePurchaseOrder(d, c, po.id, lot, expiry), "已入庫", { asUserId: wh.id }) && onClose()}>
            確認入庫
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="批號">
          <Input value={lot} onChange={(e) => setLot(e.target.value)} />
        </Field>
        <Field label="效期">
          <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 text-[11.5px] text-faint">建立時間 {formatDateTime(po.createdAt)}；收貨溫度請以實際量測為準（示範未接感測器）。</div>
    </Modal>
  );
}
