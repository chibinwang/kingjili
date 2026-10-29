"use client";

import { Printer } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { TERMS_LABEL } from "@/lib/domain/ar";
import { buildStatement } from "@/lib/domain/statements";
import { formatTWD } from "@/lib/money";
import { maps } from "@/lib/selectors";
import { useDb } from "@/lib/store";
import { addDays, formatDate, formatPeriod, periodRange } from "@/lib/time";

export default function PrintStatement() {
  return (
    <Suspense>
      <Doc />
    </Suspense>
  );
}

function Doc() {
  const db = useDb();
  const params = useSearchParams();
  const c = maps(db).customers.get(params.get("customer") ?? "C01")!;
  const period = params.get("period") ?? "2026-10";
  const locked = db.statements.filter((s) => s.customerId === c.id && s.period === period && s.status !== "superseded").sort((a, b) => b.version - a.version)[0];
  const live = buildStatement(c, period, db.arDocs, db.payments, db.allocations, db.invoices);
  const lines = locked?.lines ?? live.lines;
  const t = locked?.totals ?? live.totals;
  const { start, end } = periodRange(period);
  return (
    <div className="mx-auto max-w-[860px] p-8 text-[12px] text-ink">
      <div className="no-print mb-6 flex items-center justify-between rounded-xl border border-line bg-sunk px-4 py-3 text-[13px]">
        <span>對帳單 PDF 預覽（{locked ? `v${locked.version} 鎖定快照` : "即時預覽・未鎖定"}）</span>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-white">
          <Printer size={14} /> 列印／存成 PDF
        </button>
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[72px] font-bold text-black/[.04]">示範資料</div>
        <div className="flex items-start justify-between border-b-2 border-ink pb-3">
          <div>
            <div className="text-[22px] font-bold tracking-[.1em]">金吉利食品</div>
            <div className="text-muted">冷凍食品批發・示範地址・02-0000-0000</div>
          </div>
          <div className="text-right">
            <div className="text-[18px] font-bold">客戶對帳單</div>
            <div className="text-muted">{formatPeriod(period)}（{formatDate(start)}–{formatDate(end)}）</div>
            <div className="num text-muted">{locked ? `ST-${period}-${c.code}-v${locked.version}・${locked.snapshotHash}` : "未鎖定預覽"}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <div className="font-semibold">{c.name}</div>
            <div className="text-muted">{c.address}</div>
            <div className="text-muted">
              {c.contactName}・{c.phone}
            </div>
            {c.taxId && <div className="text-muted">統一編號 {c.taxId}</div>}
          </div>
          <div className="text-right text-muted">
            <div>結帳條件：{TERMS_LABEL[c.settlementTerms]}</div>
            <div>付款期限：{formatDate(addDays(end, 25), { year: true })}</div>
            <div>本對帳單非統一發票，發票另行開立</div>
          </div>
        </div>
        <table className="mt-4 w-full border-collapse">
          <tbody>
            <tr className="border-y border-ink text-center">
              {[
                ["上期結轉", t.openingCents],
                ["本期出貨", t.chargesCents],
                ["調整", t.debitAdjCents - t.creditAdjCents],
                ["本期收款", t.paymentsCents],
                ["本期應付", t.closingCents],
              ].map(([l, v]) => (
                <td key={String(l)} className="py-2">
                  <div className="text-muted">{l}</div>
                  <div className="num text-[14px] font-semibold">{formatTWD(Number(v))}</div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="border-b border-ink text-left">
              {["日期", "單號", "摘要", "發票號碼", "未稅", "稅額", "含稅應收", "收款", "餘額"].map((h, i) => (
                <th key={h} className={`py-1 ${i >= 4 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-line">
                <td className="num py-1">{formatDate(l.date)}</td>
                <td className="num">{l.refNo}</td>
                <td>{l.description}</td>
                <td className="num">{l.invoiceNo ?? ""}</td>
                <td className="num text-right">{l.exTaxCents ? formatTWD(l.exTaxCents, { symbol: false }) : ""}</td>
                <td className="num text-right">{l.taxCents ? formatTWD(l.taxCents, { symbol: false }) : ""}</td>
                <td className="num text-right">{l.debitCents ? formatTWD(l.debitCents, { symbol: false }) : ""}</td>
                <td className="num text-right">{l.creditCents ? formatTWD(l.creditCents, { symbol: false }) : ""}</td>
                <td className="num text-right font-medium">{formatTWD(l.balanceCents, { symbol: false })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 text-right">
          出貨 未稅 {formatTWD(t.chargesExTaxCents)}＋稅額 {formatTWD(t.chargesTaxCents)}＝含稅 {formatTWD(t.chargesCents)}
        </div>
        <div className="mt-6 text-[11px] text-muted">如有疑問請於收到後 7 日內與業務聯繫。本文件為示範資料，非實際帳款。</div>
      </div>
    </div>
  );
}
