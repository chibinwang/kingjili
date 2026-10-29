"use client";

import { AlertCircle, CheckCircle2, ClipboardPlus, MessageCircle, MessageSquareText, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { AddMenu } from "@/components/AddMenu";
import { OrderForm, PasteOrderForm } from "@/components/forms/OrderForm";
import { Badge, Button, Card, CardHeader, Drawer, Empty, Input, Money, PageHeader, Segmented, Select, Truth } from "@/components/ui";
import { cancelOrder, draftFromLine, resolveDraftIssue, updateDraftLine, validateOrder } from "@/lib/actions";
import { cn } from "@/lib/cn";
import { displayQty, ORDER_STATE_LABEL, orderTotals } from "@/lib/domain/orders";
import type { OrderState, SalesOrder } from "@/lib/domain/types";
import { formatTWD } from "@/lib/money";
import { maps } from "@/lib/selectors";
import { useDb, useStore } from "@/lib/store";
import { addDays, DEMO_TODAY, formatDate, formatDateTime } from "@/lib/time";

const STATE_TONE: Record<OrderState, "neutral" | "ok" | "warn" | "bad" | "info" | "amber"> = {
  Draft: "warn",
  Validated: "info",
  Reserved: "info",
  Picking: "amber",
  Shipped: "amber",
  Delivered: "ok",
  Closed: "neutral",
  Cancelled: "bad",
  Returned: "bad",
};

export default function OrdersPage() {
  return (
    <Suspense>
      <Orders />
    </Suspense>
  );
}

function Orders() {
  const db = useDb();
  const params = useSearchParams();
  const router = useRouter();
  const m = maps(db);
  const [range, setRange] = useState<"today" | "tomorrow" | "week" | "all">("today");
  const [source, setSource] = useState<"all" | "APP" | "LINE" | "PHONE">("all");
  const [adding, setAdding] = useState<"order" | "paste" | null>(null);
  const openId = params.get("id");
  const inbox = db.inbox.filter((x) => x.status === "new");
  const drafts = db.orders.filter((o) => o.state === "Draft");

  const rows = useMemo(() => {
    return db.orders
      .filter((o) => o.state !== "Draft")
      .filter((o) => {
        if (range === "today") return o.deliveryDate === DEMO_TODAY;
        if (range === "tomorrow") return o.deliveryDate === addDays(DEMO_TODAY, 1);
        if (range === "week") return o.deliveryDate >= addDays(DEMO_TODAY, -6);
        return true;
      })
      .filter((o) => source === "all" || o.source === source)
      .sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate) || a.no.localeCompare(b.no));
  }, [db.orders, range, source]);

  return (
    <div className="animate-rise space-y-5">
      <PageHeader
        eyebrow="ORDERS"
        title="訂單"
        sub="APP 與 LINE 訂單同一個入口。LINE 文字由 AI 轉成草稿，單位、數量、價格有疑義時必須由業務確認後才會保留庫存。"
        right={
          <AddMenu
            items={[
              { key: "order", label: "手動建立訂單", desc: "電話、現場或補登", icon: <ClipboardPlus size={16} />, perm: "order.validate", onSelect: () => setAdding("order") },
              { key: "paste", label: "貼上 LINE／電話文字", desc: "AI 轉成草稿，由你確認", icon: <MessageSquareText size={16} />, perm: "order.validate", onSelect: () => setAdding("paste") },
            ]}
          />
        }
      />
      {adding === "order" && (
        <OrderForm
          onClose={() => setAdding(null)}
          onCreated={(id) => {
            setAdding(null);
            setRange("all");
            router.push(`/orders?id=${id}`, { scroll: false });
          }}
        />
      )}
      {adding === "paste" && <PasteOrderForm onClose={() => setAdding(null)} onDone={() => setAdding(null)} />}

      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader title="LINE 收件匣" sub="Webhook 事件 ID 去重；模擬資料" right={<Badge tone="mock">模擬 LINE OA</Badge>} />
          <div className="space-y-3 px-5 pb-5">
            {inbox.length === 0 && <div className="rounded-[10px] bg-sunk px-4 py-5 text-center text-[12.5px] text-muted">沒有新的 LINE 訊息</div>}
            {inbox.map((msg) => (
              <div key={msg.id} className="rounded-[12px] border border-line p-3">
                <div className="mb-1.5 flex items-center justify-between text-[12px]">
                  <span className="flex items-center gap-1.5 font-semibold text-ink">
                    <MessageCircle size={14} className="text-ok" /> {msg.displayName}
                  </span>
                  <span className="text-faint">{formatDateTime(msg.receivedAt)}</span>
                </div>
                <div className="rounded-[12px] rounded-tl-[4px] bg-[#e9f7ee] px-3 py-2 text-[13px] text-ink">{msg.text}</div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-faint">{msg.lineUserId ? "已綁定客戶" : "未綁定：需人工指定客戶"}</span>
                  <DraftButton id={msg.id} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="AI 草稿待確認" sub="草稿不保留庫存、不排車；確認後才進入今日或隔日配送" right={drafts.length ? <Badge tone="warn">{drafts.length} 張待確認</Badge> : null} />
          <div className="space-y-4 px-5 pb-5">
            {drafts.length === 0 && <Empty icon={<CheckCircle2 size={28} />} title="沒有待確認的草稿" sub="點左側「AI 解析成草稿」試試看" />}
            {drafts.map((o) => (
              <DraftCard key={o.id} order={o} />
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <div className="text-[14px] font-semibold">訂單列表</div>
          <div className="flex flex-wrap gap-2">
            <Segmented
              size="sm"
              value={range}
              onChange={setRange}
              options={[
                { value: "today", label: "今日配送" },
                { value: "tomorrow", label: "明日" },
                { value: "week", label: "近 7 天" },
                { value: "all", label: "全部" },
              ]}
            />
            <Segmented
              size="sm"
              value={source}
              onChange={setSource}
              options={[
                { value: "all", label: "全部來源" },
                { value: "APP", label: "APP" },
                { value: "LINE", label: "LINE" },
                { value: "PHONE", label: "電話" },
              ]}
            />
          </div>
        </div>
        <div className="scroll-thin max-h-[560px] overflow-auto">
          <table className="tbl min-w-[820px]">
            <thead>
              <tr>
                <th>訂單</th>
                <th>客戶</th>
                <th>來源</th>
                <th>配送日</th>
                <th>品項</th>
                <th className="r">含稅金額</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="row-hover cursor-pointer" onClick={() => router.push(`/orders?id=${o.id}`, { scroll: false })}>
                  <td className="num font-medium">{o.no}</td>
                  <td>{m.customers.get(o.customerId)?.name}</td>
                  <td>
                    <Badge tone={o.source === "LINE" ? "ok" : o.source === "APP" ? "info" : "neutral"}>{o.source === "PHONE" ? "電話" : o.source}</Badge>
                    {o.aiExtracted && <Badge tone="ai" className="ml-1">AI 擷取</Badge>}
                  </td>
                  <td className="num">{formatDate(o.deliveryDate, { weekday: true })}</td>
                  <td className="max-w-[260px] truncate text-[12.5px] text-muted">
                    {o.lines
                      .map((l) => {
                        const p = m.products.get(l.productId)!;
                        const d = displayQty(l, p);
                        return `${p.name} ${d.qty}${d.unit}`;
                      })
                      .join("、")}
                  </td>
                  <td className="r">
                    <Money cents={orderTotals(o).total} />
                  </td>
                  <td>
                    <Badge tone={STATE_TONE[o.state]} dot>
                      {ORDER_STATE_LABEL[o.state]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty title="沒有符合條件的訂單" />}
        </div>
      </Card>

      {openId && <OrderDrawer id={openId} onClose={() => router.push("/orders", { scroll: false })} />}
    </div>
  );
}

function DraftButton({ id }: { id: string }) {
  const run = useStore((s) => s.run);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ai"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        setTimeout(() => {
          run((d, c) => draftFromLine(d, c, id), "AI 已建立草稿，請確認標示的欄位");
          setBusy(false);
        }, 550);
      }}
    >
      <Sparkles size={13} /> {busy ? "解析中…" : "AI 解析成草稿"}
    </Button>
  );
}

function DraftCard({ order }: { order: SalesOrder }) {
  const db = useDb();
  const run = useStore((s) => s.run);
  const m = maps(db);
  const issues = order.issues ?? [];
  const open = issues.filter((i) => !i.resolved);
  const t = orderTotals(order);
  return (
    <div className="grid gap-4 rounded-[12px] border border-warn/25 bg-amber-wash/40 p-4 lg:grid-cols-[1fr_1.5fr]">
      <div>
        <div className="mb-1.5 flex items-center gap-2 text-[12px] text-muted">
          <Truth state="ai" /> 原始訊息
        </div>
        <div className="rounded-[12px] rounded-tl-[4px] bg-[#e9f7ee] px-3 py-2 text-[13px]">{order.rawText}</div>
        <div className="mt-3 text-[12px] text-muted">
          客戶：
          {order.customerId ? (
            <span className="font-medium text-ink">{m.customers.get(order.customerId)?.name}</span>
          ) : (
            <Select className="mt-1 h-8 text-[12.5px]" defaultValue="" onChange={(e) => run((d, c) => resolveDraftIssue(d, c, order.id, issues.findIndex((i) => i.field === "customer"), { customerId: e.target.value }))}>
              <option value="" disabled>
                請選擇客戶
              </option>
              {db.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="mt-1 text-[12px] text-muted">
          配送日：<span className="text-ink">{formatDate(order.deliveryDate, { weekday: true })}</span>・外部 ID <span className="num">{order.externalId}</span>
        </div>
      </div>
      <div>
        <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
          <table className="tbl text-[12.5px]">
            <thead>
              <tr>
                <th>品項</th>
                <th className="w-[90px]">數量</th>
                <th className="w-[110px]">單位</th>
                <th className="r">小計（未稅）</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((l, i) => {
                const p = m.products.get(l.productId)!;
                const bad = open.some((x) => x.lineIndex === i);
                return (
                  <tr key={l.id} className={bad ? "bg-warn-soft/40" : ""}>
                    <td>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-[11px] text-faint">{p.spec}・1 箱 = {p.packSize} {p.baseUnit}</div>
                    </td>
                    <td>
                      <Input type="number" min={0} value={l.qty} className="h-8 w-[72px]" onChange={(e) => run((d, c) => updateDraftLine(d, c, order.id, i, { qty: Number(e.target.value) }))} />
                    </td>
                    <td>
                      <Select value={l.unit} className="h-8" onChange={(e) => run((d, c) => updateDraftLine(d, c, order.id, i, { unit: e.target.value as "base" | "pack" }))}>
                        <option value="base">{p.baseUnit}</option>
                        <option value="pack">箱（{p.packSize}）</option>
                      </Select>
                    </td>
                    <td className="r">
                      <Money cents={l.qtyBase * l.unitPriceExTaxCents} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {issues.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {issues.map((iss, i) => (
              <div key={i} className={cn("flex items-center justify-between gap-2 rounded-[8px] px-2.5 py-1.5 text-[12px]", iss.resolved ? "bg-ok-soft/60 text-ok" : "bg-warn-soft text-warn")}>
                <span className="flex items-center gap-1.5">
                  {iss.resolved ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                  {iss.message}
                </span>
                {!iss.resolved && iss.field !== "customer" && (
                  <button className="shrink-0 font-medium underline underline-offset-2" onClick={() => run((d, c) => resolveDraftIssue(d, c, order.id, i))}>
                    已確認
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between">
          <div className="text-[12px] text-muted">
            未稅 {formatTWD(t.exTax)}・稅 {formatTWD(t.tax)}・含稅 <span className="font-semibold text-ink">{formatTWD(t.total)}</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => run((d, c) => cancelOrder(d, c, order.id, "草稿作廢"), "草稿已作廢")}>
              作廢
            </Button>
            <Button size="sm" variant="primary" disabled={open.length > 0} onClick={() => run((d, c) => validateOrder(d, c, order.id), "訂單已確認並保留庫存")}>
              {open.length ? `尚有 ${open.length} 項待確認` : "確認訂單並保留庫存"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const db = useDb();
  const run = useStore((s) => s.run);
  const m = maps(db);
  const o = m.orders.get(id);
  const [reason, setReason] = useState("");
  if (!o) return null;
  const c = m.customers.get(o.customerId);
  const t = orderTotals(o);
  const d = db.deliveries.find((x) => x.orderId === o.id);
  const ar = db.arDocs.find((x) => x.sourceOrderId === o.id);
  const steps: OrderState[] = ["Draft", "Validated", "Reserved", "Picking", "Shipped", "Delivered", "Closed"];
  const at = steps.indexOf(o.state);
  return (
    <Drawer
      open
      onClose={onClose}
      title={o.no}
      sub={`${c?.name ?? "未指定客戶"}・${formatDate(o.deliveryDate, { year: true, weekday: true })} 配送`}
      footer={
        ["Validated", "Reserved"].includes(o.state) ? (
          <>
            <Input placeholder="取消原因（必填）" value={reason} onChange={(e) => setReason(e.target.value)} className="max-w-[220px]" />
            <Button variant="danger" onClick={() => run((x, ctx) => cancelOrder(x, ctx, o.id, reason), "訂單已取消，庫存已釋放") && onClose()}>
              取消訂單
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="mb-5 flex flex-wrap gap-1">
        {steps.map((s, i) => (
          <span key={s} className={cn("rounded-full px-2 py-0.5 text-[11.5px]", o.state === "Cancelled" ? "bg-sunk text-faint" : i < at ? "bg-ok-soft text-ok" : i === at ? "bg-ink font-semibold text-white" : "bg-sunk text-faint")}>
            {ORDER_STATE_LABEL[s]}
          </span>
        ))}
        {o.state === "Cancelled" && <Badge tone="bad">已取消</Badge>}
      </div>
      <dl className="mb-5 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
        <dt className="text-muted">來源</dt>
        <dd>
          {o.source}
          {o.aiExtracted && <Badge tone="ai" className="ml-1.5">AI 擷取・人員確認</Badge>}
        </dd>
        <dt className="text-muted">外部單號（去重鍵）</dt>
        <dd className="num">{o.externalId}</dd>
        <dt className="text-muted">下單時間</dt>
        <dd className="num">{formatDateTime(o.orderAt)}</dd>
        <dt className="text-muted">客戶價格等級</dt>
        <dd>{c?.priceTier === "vip" ? "VIP 價" : c?.priceTier === "volume" ? "量販價" : "標準價"}</dd>
        <dt className="text-muted">送貨單</dt>
        <dd className="num">{d ? `${d.noteNo}（${d.vehicleId} 車）` : "—"}</dd>
        <dt className="text-muted">應收文件</dt>
        <dd className="num">{ar?.no ?? "送達後建立"}</dd>
      </dl>
      {o.rawText && <div className="mb-5 rounded-[12px] rounded-tl-[4px] bg-[#e9f7ee] px-3 py-2 text-[13px]">{o.rawText}</div>}
      <table className="tbl text-[13px]">
        <thead>
          <tr>
            <th>品項</th>
            <th className="r">數量</th>
            <th className="r">單價（未稅）</th>
            <th className="r">小計</th>
          </tr>
        </thead>
        <tbody>
          {o.lines.map((l) => {
            const p = m.products.get(l.productId)!;
            const dq = displayQty(l, p);
            return (
              <tr key={l.id}>
                <td>
                  {p.name}
                  <div className="text-[11px] text-faint">
                    {p.sku}・凍庫 {p.zone}
                  </div>
                </td>
                <td className="r num">
                  {dq.qty} {dq.unit}
                  {l.unit === "pack" && <div className="text-[11px] text-faint">= {l.qtyBase} {p.baseUnit}</div>}
                </td>
                <td className="r">
                  <Money cents={l.unitPriceExTaxCents} />
                  <div className="text-[11px] text-faint">/ {p.baseUnit}</div>
                </td>
                <td className="r">
                  <Money cents={l.qtyBase * l.unitPriceExTaxCents} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-4 ml-auto w-[240px] space-y-1 text-[13px]">
        <div className="flex justify-between text-muted">
          <span>未稅</span>
          <Money cents={t.exTax} />
        </div>
        <div className="flex justify-between text-muted">
          <span>營業稅 5%</span>
          <Money cents={t.tax} />
        </div>
        <div className="flex justify-between border-t border-line pt-1 font-semibold">
          <span>含稅</span>
          <Money cents={t.total} />
        </div>
      </div>
    </Drawer>
  );
}
