"use client";

import { Database, Download, FileText, MessageCircle, RotateCcw, Upload } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, CardHeader, Check, Modal, PageHeader } from "@/components/ui";
import { csvErpSync } from "@/lib/connectors";
import { can, ROLE_LABEL, type Permission } from "@/lib/permissions";
import type { Role } from "@/lib/domain/types";
import { useDb, useStore } from "@/lib/store";
import { DEMO_TODAY, addDays } from "@/lib/time";

const PERMS: [Permission, string][] = [
  ["order.validate", "確認訂單"],
  ["route.approve", "核准路線調整"],
  ["pick.confirm", "揀貨確認"],
  ["delivery.complete", "完成送達／收款"],
  ["payment.allocate", "沖帳"],
  ["payment.reverse", "收款沖回"],
  ["statement.review", "對帳單審查"],
  ["statement.release", "對帳單核准"],
  ["invoice.submit", "發票送出"],
  ["inventory.threshold", "補貨點"],
  ["po.approve", "叫貨核准"],
  ["view.margin", "查看毛利"],
];
const ROLES: Role[] = ["owner", "sales", "accounting", "warehouse", "procurement", "driver", "admin"];

const SAMPLE_CSV = `external_id,customer_code,delivery_date,sku,qty,unit
ECOUNT-1025-001,FJ01,2026-10-25,P001,16,包
ECOUNT-1025-001,FJ01,2026-10-25,P003,2,箱
ECOUNT-1025-002,SW02,2026-10-25,P002,1x,包`;

export default function SettingsPage() {
  const db = useDb();
  const reset = useStore((s) => s.reset);
  const [confirm, setConfirm] = useState(false);
  const [imp, setImp] = useState<ReturnType<typeof csvErpSync.importOrders> | null>(null);

  const exportCsv = () => {
    const recent = db.orders.filter((o) => o.deliveryDate >= addDays(DEMO_TODAY, -6));
    const blob = new Blob(["﻿" + csvErpSync.exportOrders(recent, db)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `orders_${DEMO_TODAY}.csv`;
    a.click();
  };

  return (
    <div className="animate-rise space-y-5">
      <PageHeader eyebrow="SETTINGS" title="設定" sub="角色權限、整合狀態與示範資料。所有外部整合皆為模擬，切換為正式環境前須完成憑證、合規與沙盒測試。" />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="整合" sub="合約介面已定義（LineStatementSender／EcpayInvoiceProvider／ErpSync），目前僅模擬實作" />
          <div className="divide-y divide-line">
            {[
              { icon: MessageCircle, name: "LINE 官方帳號 Messaging API", st: "模擬", d: "對帳單以「含安全 HTTPS 連結的訊息」推播；僅能推給已綁定官方帳號的客戶。需：OA 擁有權、帳號綁定流程、配額確認。" },
              { icon: FileText, name: "綠界 ECPay 電子發票", st: "模擬", d: "B2B／B2C、載具、統編檢查；區分綠界接收與財政部上傳。需：商店申請、憑證、會計師確認稅務規則、沙盒測試。" },
              { icon: Database, name: "ECOUNT（既有 ERP）", st: "CSV 模擬", d: "先前探訪 ECOUNT API 對此客戶不可用，需向原廠重新確認。PoC 期間 ECOUNT 仍為主帳，以 CSV 匯入匯出並行對帳。" },
            ].map((x) => (
              <div key={x.name} className="flex gap-3 px-5 py-3.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-sunk text-ink-2">
                  <x.icon size={17} />
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 font-semibold">
                    {x.name} <Badge tone="mock">{x.st}・外部發送未啟用</Badge>
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-muted">{x.d}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <Download size={14} /> 匯出近 7 天訂單 CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImp(csvErpSync.importOrders(SAMPLE_CSV))}>
              <Upload size={14} /> 試匯入 ECOUNT CSV（預覽）
            </Button>
          </div>
        </Card>
        <Card>
          <CardHeader title="角色權限" sub="右上角可切換示範身分；AI 代理不具任何寫入權限" />
          <div className="overflow-x-auto">
            <table className="tbl text-[12.5px]">
              <thead>
                <tr>
                  <th>權限</th>
                  {ROLES.map((r) => (
                    <th key={r} className="text-center">
                      {ROLE_LABEL[r]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMS.map(([p, label]) => (
                  <tr key={p}>
                    <td>{label}</td>
                    {ROLES.map((r) => (
                      <td key={r} className="text-center">
                        {can(r, p) ? <Check ok size={10} /> : <span className="text-line-strong">·</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="示範假設（非客戶事實）" sub="以下皆待金吉利確認" />
        <ul className="grid gap-x-8 gap-y-1.5 px-5 pb-5 text-[12.5px] text-ink-2 md:grid-cols-2">
          {[
            "凍庫 A–D 對應示意圖 1–4；各凍庫品項為假設",
            "品項、價格、地址、客戶名稱、統編皆為虛構",
            "A 車 1.5 噸／B 車 1.8 噸冷凍車、08:00 出車、14:00 回倉",
            "月結：次月 10 日前寄對帳單、25 日前付款",
            "營業稅 5%，每張單據四捨五入至元（需會計師確認）",
            "地圖座標為示意；距離＝直線 × 1.35，均速 28 km/h",
            "毛利依標準成本初估；素排骨尚無成本資料",
            "AI 為離線規則式代理，未呼叫外部模型",
          ].map((x) => (
            <li key={x} className="flex gap-2">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber" />
              {x}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <div className="font-semibold">重置示範資料</div>
          <div className="text-[12.5px] text-muted">回到 2026/10/24 07:05 的初始狀態（資料只存在此瀏覽器）</div>
        </div>
        <Button variant="danger" onClick={() => setConfirm(true)}>
          <RotateCcw size={14} /> 重置
        </Button>
      </Card>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        width={400}
        title="重置示範資料？"
        sub="所有操作、核准與紀錄都會清除"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                reset();
                setConfirm(false);
              }}
            >
              確認重置
            </Button>
          </>
        }
      >
        <div className="text-[13px] text-muted">適合在每次示範前執行。</div>
      </Modal>
      <Modal open={!!imp} onClose={() => setImp(null)} width={640} title="CSV 匯入預覽（未寫入）" sub="分段匯入：預覽 → 驗證 → 對帳 → 才寫入；示範只做到驗證">
        {imp && (
          <div>
            {imp.errors.length > 0 && (
              <div className="mb-3 rounded-[8px] bg-bad-soft px-3 py-2 text-[12.5px] text-bad">
                {imp.errors.map((e) => (
                  <div key={e}>{e}</div>
                ))}
              </div>
            )}
            <table className="tbl text-[12.5px]">
              <thead>
                <tr>
                  {Object.keys(imp.rows[0] ?? {}).map((k) => (
                    <th key={k}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {imp.rows.map((r, i) => (
                  <tr key={i}>
                    {Object.values(r).map((v, j) => (
                      <td key={j} className="num">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
