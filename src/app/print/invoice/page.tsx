"use client";

import { Printer } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { formatInvoicePeriod, invoicePeriodOf } from "@/lib/domain/invoices";
import { formatTWD } from "@/lib/money";
import { useDb } from "@/lib/store";
import { formatDate } from "@/lib/time";

/** 示範賣方 — the real 統編 and name come from the client's settings in production. */
const SELLER = { name: "金吉利食品（示範）", taxId: "00000000" };

export default function PrintInvoice() {
  return (
    <Suspense>
      <Slip />
    </Suspense>
  );
}

const money = (cents: number) => formatTWD(cents, { symbol: false });
const withCommas = (dec: string) => {
  const [w, f] = dec.split(".");
  return `${Number(w).toLocaleString("en-US")}${f ? `.${f}` : ""}`;
};
const stamp = (iso?: string) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 19)}` : "");

/**
 * 電子發票證明聯 (格式一, 5.7 cm thermal) with the 交易明細 printed below it — for a business buyer (統編) the detail
 * continues under the barcodes without cutting; for a consumer it is cut off. Laid out after the client's printed slips.
 */
function Slip() {
  const db = useDb();
  const id = useSearchParams().get("id");
  const inv = db.invoices.find((i) => i.id === id);
  if (!inv) return <div className="p-8 text-[13px]">找不到發票。</div>;
  const b2b = inv.invoiceClass === "B2B";
  const lines = inv.lines ?? [];
  const barcode = inv.invoiceNo ? `${Number(invoicePeriodOf(inv.issueDate).slice(0, 4)) - 1911}${String(Number(invoicePeriodOf(inv.issueDate).slice(5)) + 1).padStart(2, "0")}${inv.invoiceNo}${inv.randomNumber ?? ""}` : "";
  return (
    <div className="flex min-h-screen flex-col items-center gap-4 bg-sunk py-6 print:block print:bg-white print:py-0">
      <style>{`@media print { @page { size: 57mm auto; margin: 0; } body { -webkit-print-color-adjust: exact; } }`}</style>
      <div className="no-print flex items-center gap-3 text-[12.5px] text-muted">
        <span>5.7 公分熱感紙・證明聯 + 交易明細{b2b ? "（營業人：不裁切）" : "（消費者：明細裁切）"}</span>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-white">
          <Printer size={14} /> 列印
        </button>
      </div>
      {!inv.invoiceNo && <div className="no-print rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn">此發票尚未開立（未通過預檢或待配號），以下為預覽，不可交付客戶。</div>}

      <div className="w-[57mm] bg-white px-[2.5mm] py-[3mm] font-[system-ui] text-[9.5pt] leading-[1.35] text-black shadow-[var(--shadow-card)] print:shadow-none" data-testid="invoice-slip">
        {/* 證明聯 */}
        <div className="text-center">
          <div className="text-[11pt] font-bold">{SELLER.name}</div>
          <div className="mt-1 text-[14pt] font-bold tracking-wider">電子發票證明聯</div>
          <div className="text-[13pt] font-bold">{formatInvoicePeriod(invoicePeriodOf(inv.issueDate))}</div>
          <div className="text-[14pt] font-bold tracking-wide">{inv.invoiceNo ? `${inv.invoiceNo.slice(0, 2)}-${inv.invoiceNo.slice(2)}` : "（未開立）"}</div>
        </div>
        <div className="mt-1 flex justify-between">
          <span>{stamp(inv.issuedAt)}</span>
          {b2b && <span>格式 25</span>}
        </div>
        <div className="flex justify-between">
          <span>隨機碼 {inv.randomNumber ?? "----"}</span>
          <span>總計 {money(inv.totalCents)}</span>
        </div>
        <div className="flex justify-between">
          <span>賣方 {SELLER.taxId}</span>
          {b2b && <span>買方 {inv.buyerTaxId}</span>}
        </div>
        <div className="mt-1.5 border border-dashed border-black/60 px-1 py-1 text-center text-[7pt]">一維條碼 Code 39：{barcode || "—"}</div>
        <div className="mt-1 grid grid-cols-2 gap-1 text-center text-[7pt]">
          <div className="grid aspect-square place-items-center border border-dashed border-black/60">QR（左）</div>
          <div className="grid aspect-square place-items-center border border-dashed border-black/60">QR（右）</div>
        </div>
        <div className="mt-0.5 text-center text-[6.5pt] text-black/60">示範：條碼與 QR Code 需財政部核發之加密金鑰，正式版產生</div>

        {!b2b && <div className="my-2 border-t border-dashed border-black text-center text-[7pt]">✂ 以下交易明細自此裁切</div>}

        {/* 交易明細 */}
        <div className="mt-3 text-center text-[13pt] font-bold">交易明細</div>
        {b2b && (
          <>
            <div>買受人統編 {inv.buyerTaxId}</div>
            <div>買受人名稱 {inv.buyerName}</div>
          </>
        )}
        <div>{stamp(inv.issuedAt) || formatDate(inv.issueDate, { year: true })}</div>
        <div className="my-1 border-t border-dashed border-black" />
        <div className="flex justify-between">
          <span>品名</span>
          <span>單價*數量</span>
          <span>金額</span>
        </div>
        {lines.map((l) => (
          <div key={l.seq} className="mt-0.5">
            <div>
              {l.productId} {l.description}
            </div>
            {/* 證明聯 shows the ex-tax unit price to 7 decimals, as MIG 4.0 stores it */}
            <div className="pl-[8mm]">
              {withCommas(l.unitPriceEx)}*{l.qty}
            </div>
            <div className="text-right">
              {withCommas(l.amountEx)} {l.taxType}
            </div>
          </div>
        ))}
        <div className="my-1 border-t border-dashed border-black" />
        <div>合計 {lines.length} 項</div>
        {b2b ? (
          <>
            <div>銷售額(應稅) ${money(inv.exTaxCents)}</div>
            <div>稅額 ${money(inv.taxCents)}</div>
            <div>總計 ${money(inv.totalCents)}</div>
          </>
        ) : (
          <div>總計 ${money(inv.totalCents)}</div>
        )}
        <div className="mt-1 text-[8pt]">備註 {db.arDocs.find((d) => d.id === inv.sourceArIds[0])?.memo ?? ""}</div>
      </div>
    </div>
  );
}
