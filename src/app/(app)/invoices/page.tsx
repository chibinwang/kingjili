"use client";

import { FileCheck2, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, Money, PageHeader, Segmented } from "@/components/ui";
import { fixInvoiceCarrier, preflightInvoices, stageMonthlyInvoice, submitInvoicesMock } from "@/lib/actions";
import { cn } from "@/lib/cn";
import { GOV_STATUS_LABEL, PROVIDER_STATUS_LABEL } from "@/lib/domain/invoices";
import type { TaxInvoice } from "@/lib/domain/types";
import { formatTWD } from "@/lib/money";
import { useDb, useStore } from "@/lib/store";
import { DEMO_TODAY, formatDate, periodOf } from "@/lib/time";

const TONE: Record<TaxInvoice["providerStatus"], "neutral" | "warn" | "bad" | "info" | "ok" | "amber"> = {
  staged: "neutral",
  preflight_failed: "bad",
  ready: "info",
  submitted: "amber",
  accepted: "ok",
  rejected: "bad",
  voided: "neutral",
  allowance: "warn",
};

export default function InvoicesPage() {
  const db = useDb();
  const run = useStore((s) => s.run);
  const acct = db.users.find((u) => u.role === "accounting")!;
  const [filter, setFilter] = useState<"todo" | "month" | "all">("todo");
  const [fixing, setFixing] = useState<TaxInvoice | null>(null);
  const [preview, setPreview] = useState<TaxInvoice | null>(null);
  const period = periodOf(DEMO_TODAY);
  const todo = (i: TaxInvoice) => ["staged", "preflight_failed", "ready", "rejected"].includes(i.providerStatus);
  const list = useMemo(
    () =>
      db.invoices
        .filter((i) => (filter === "todo" ? todo(i) : filter === "month" ? i.period === period : true))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || a.buyerName.localeCompare(b.buyerName)),
    [db.invoices, filter, period],
  );
  const staged = db.invoices.filter((i) => ["staged", "preflight_failed"].includes(i.providerStatus));
  const ready = db.invoices.filter((i) => i.providerStatus === "ready");
  const monthlyMissing = db.customers.filter((c) => c.settlementTerms !== "daily" && !db.invoices.some((i) => i.customerId === c.id && i.period === period));
  const month = db.invoices.filter((i) => i.period === period && i.providerStatus === "accepted");

  return (
    <div className="animate-rise space-y-5">
      <PageHeader
        eyebrow="E-INVOICE"
        title="電子發票"
        sub="日結客戶逐筆開立（B2C 可用載具），月結客戶月底彙開（B2B 需統編）。綠界接收 ≠ 已上傳財政部；示範環境沒有任何實際開立或申報。"
        right={
          <Badge tone="mock" className="px-3 py-1 text-[12px]">
            綠界 ECPay（Mock）・模擬綠界串接／尚未上傳財政部
          </Badge>
        }
      />
      <div className="grid gap-3 md:grid-cols-4">
        {[
          { l: "待預檢／需修正", v: staged.length, tone: staged.length ? "text-warn" : "" },
          { l: "可送出", v: ready.length, tone: "" },
          { l: `${Number(period.slice(5))} 月已接收（模擬）`, v: month.length, tone: "" },
          { l: `${Number(period.slice(5))} 月銷項稅額（模擬）`, v: formatTWD(month.reduce((a, i) => a + i.taxCents, 0)), tone: "" },
        ].map((k) => (
          <Card key={k.l} className="px-4 py-3">
            <div className="text-[12px] text-muted">{k.l}</div>
            <div className={cn("num mt-0.5 text-[20px] font-semibold", k.tone)}>{k.v}</div>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <Segmented
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "todo", label: "待處理" },
              { value: "month", label: "本月" },
              { value: "all", label: "全部" },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!staged.length} onClick={() => run((d, c) => preflightInvoices(d, c, staged.map((i) => i.id)), "預檢完成", { asUserId: acct.id })}>
              <FileCheck2 size={14} /> 預檢（{staged.length}）
            </Button>
            <Button size="sm" variant="primary" disabled={!ready.length} onClick={() => run((d, c) => submitInvoicesMock(d, c, ready.map((i) => i.id)), "模擬送出完成：綠界已接收（模擬），尚未上傳財政部", { asUserId: acct.id })}>
              確認並模擬送出（{ready.length}）
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl min-w-[1000px]">
            <thead>
              <tr>
                <th>開立日</th>
                <th>買受人</th>
                <th>類別</th>
                <th>統編／載具</th>
                <th className="r">未稅</th>
                <th className="r">稅額</th>
                <th className="r">含稅</th>
                <th>發票號碼</th>
                <th>綠界（模擬）</th>
                <th>財政部</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 120).map((i) => (
                <tr key={i.id} className="row-hover">
                  <td className="num">{formatDate(i.issueDate)}</td>
                  <td>
                    <div className="font-medium">{i.buyerName}</div>
                    <div className="text-[11px] text-faint">{i.sourceArIds.length} 張送貨單</div>
                  </td>
                  <td>
                    <Badge tone={i.invoiceClass === "B2B" ? "info" : "neutral"}>{i.invoiceClass}</Badge>
                  </td>
                  <td className="num text-[12.5px]">{i.buyerTaxId ?? (i.carrierType ? `${i.carrierType === "mobile" ? "手機" : i.carrierType === "member" ? "會員" : "自然人"} ${i.carrierValue}` : "紙本列印")}</td>
                  <td className="r">
                    <Money cents={i.exTaxCents} />
                  </td>
                  <td className="r">
                    <Money cents={i.taxCents} />
                  </td>
                  <td className="r font-medium">
                    <Money cents={i.totalCents} />
                  </td>
                  <td className="num">{i.invoiceNo ?? <span className="text-faint">—</span>}</td>
                  <td>
                    <Badge tone={TONE[i.providerStatus]} dot>
                      {PROVIDER_STATUS_LABEL[i.providerStatus]}
                    </Badge>
                    {i.rejectReason && <div className="mt-0.5 max-w-[220px] text-[11px] text-bad">{i.rejectReason}</div>}
                  </td>
                  <td className="text-[12px] text-muted">{GOV_STATUS_LABEL[i.govUploadStatus]}</td>
                  <td className="r">
                    <div className="flex justify-end gap-1">
                      {["preflight_failed", "rejected", "staged"].includes(i.providerStatus) && i.carrierType && (
                        <Button size="sm" variant="ghost" onClick={() => setFixing(i)}>
                          <Pencil size={12} /> 修正載具
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setPreview(i)}>
                        預覽
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title={`月結客戶 ${Number(period.slice(5))} 月彙開`} sub="月底關帳後建立草稿，經預檢與會計確認才送出" />
        <div className="flex flex-wrap gap-2 px-5 pb-5">
          {monthlyMissing.map((c) => (
            <Button key={c.id} size="sm" variant="outline" onClick={() => run((d, ctx) => stageMonthlyInvoice(d, ctx, c.id, period), `已建立 ${c.name} 彙開草稿`, { asUserId: acct.id })}>
              建立 {c.name} 彙開草稿
            </Button>
          ))}
          {monthlyMissing.length === 0 && <span className="text-[12.5px] text-muted">本月彙開草稿皆已建立</span>}
        </div>
        <div className="border-t border-line px-5 py-3 text-[11.5px] text-faint">
          上線前需由會計師確認：開立日期規則、字軌配號、免稅品項、二聯／三聯用語、折讓流程，並完成綠界商店申請與沙盒測試。
        </div>
      </Card>

      {fixing && <FixCarrier inv={fixing} onClose={() => setFixing(null)} />}
      <Modal open={!!preview} onClose={() => setPreview(null)} width={420} title="電子發票證明聯（示意）" sub="模擬資料，非實際發票">
        {preview && (
          <div className="mx-auto w-[300px] rounded-[10px] border border-line-strong p-4 text-center text-[12px]">
            <div className="text-[15px] font-bold">金吉利食品</div>
            <div className="text-[13px] font-semibold">電子發票證明聯</div>
            <div className="num mt-1 text-[18px] font-bold tracking-wider">{preview.invoiceNo ? `${preview.invoiceNo.slice(0, 2)}-${preview.invoiceNo.slice(2)}` : "尚未配號"}</div>
            <div className="num text-muted">{preview.issueDate}</div>
            <div className="mt-2 grid grid-cols-2 gap-1 text-left">
              <span className="text-muted">買方</span>
              <span>{preview.buyerTaxId ?? "—"}</span>
              <span className="text-muted">未稅</span>
              <span className="num">{formatTWD(preview.exTaxCents)}</span>
              <span className="text-muted">稅額</span>
              <span className="num">{formatTWD(preview.taxCents)}</span>
              <span className="text-muted">總計</span>
              <span className="num font-semibold">{formatTWD(preview.totalCents)}</span>
            </div>
            <div className="mt-3 rounded border border-dashed border-line-strong py-2 text-faint">條碼／QR 碼（模擬）</div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function FixCarrier({ inv, onClose }: { inv: TaxInvoice; onClose: () => void }) {
  const run = useStore((s) => s.run);
  const db = useDb();
  const acct = db.users.find((u) => u.role === "accounting")!;
  const [v, setV] = useState(inv.carrierValue ?? "");
  return (
    <Modal
      open
      onClose={onClose}
      width={420}
      title={`修正載具・${inv.buyerName}`}
      sub={inv.rejectReason}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => run((d, c) => fixInvoiceCarrier(d, c, inv.id, v.toUpperCase()), "已修正，請重新預檢", { asUserId: acct.id }) && onClose()}>
            儲存
          </Button>
        </>
      }
    >
      <Field label="手機條碼" hint="格式：/ 加 7 碼英數（示範可輸入 /LJ05M2X）">
        <Input value={v} onChange={(e) => setV(e.target.value)} className="num" />
      </Field>
    </Modal>
  );
}
