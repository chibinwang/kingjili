"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { parseAmount, parseDate } from "@/lib/domain/statementCommands";
import { COMPANY, docTotals, type DocLine, type StatementDoc } from "@/lib/domain/statementDoc";
import { formatTWD, sum, type Cents } from "@/lib/money";
import { formatDate, periodRange } from "@/lib/time";

/** Fields changed from the ledger copy get a soft highlight on screen; it never prints. */
const CHANGED = "bg-amber-soft shadow-[0_0_0_2px_var(--color-amber-soft)] print:bg-transparent print:shadow-none";

interface EdProps {
  value: string;
  onCommit?: (text: string) => boolean | void;
  changed?: boolean;
  multiline?: boolean;
  label: string;
  className?: string;
}

/** Text that reads as part of the page; in edit mode it becomes editable in place. */
function Ed({ value, onCommit, changed, multiline, label, className }: EdProps) {
  const [nonce, setNonce] = useState(0);
  if (!onCommit) return <span className={cn("rounded-[3px]", changed && CHANGED, multiline && "whitespace-pre-line", className)}>{value}</span>;
  return (
    <span
      key={`${value}-${nonce}`}
      role="textbox"
      aria-label={label}
      aria-multiline={multiline || undefined}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && !multiline && !e.nativeEvent.isComposing)) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const text = e.currentTarget.innerText.trim();
        if (text === value) return;
        // a rejected value snaps back to the stored one
        if (onCommit(text) === false) setNonce((n) => n + 1);
      }}
      className={cn(
        "cursor-text rounded-[3px] outline-none hover:bg-info-soft focus:bg-white focus:shadow-[0_0_0_2px_var(--color-amber)]",
        multiline && "whitespace-pre-line",
        changed && CHANGED,
        className,
      )}
    >
      {value}
    </span>
  );
}

const money = (c: Cents) => formatTWD(c, { symbol: false });

export function StatementTemplate({ doc, period, changed, editable, onChange }: { doc: StatementDoc; period: string; changed: Set<string>; editable: boolean; onChange: (doc: StatementDoc, label: string) => void }) {
  const t = docTotals(doc);
  const { start, end } = periodRange(period);
  const isChanged = (k: string) => changed.has(k);

  /** Bind a commit handler only in edit mode. */
  const edit = <T,>(parse: (s: string) => T | undefined, apply: (v: T) => StatementDoc, label: string, hint: string) =>
    editable
      ? (s: string) => {
          const v = parse(s);
          if (v === undefined) {
            toast.error(`${label}格式不正確：${hint}`);
            return false;
          }
          onChange(apply(v), label);
        }
      : undefined;
  const text = (apply: (v: string) => StatementDoc, label: string) => edit((s) => s, apply, label, "");
  const amount = (apply: (v: Cents) => StatementDoc, label: string) => edit((s) => (s === "" ? 0 : parseAmount(s)), apply, label, "請輸入數字，例如 1,200");
  const date = (apply: (v: string) => StatementDoc, label: string) => edit((s) => parseDate(s, period), apply, label, "請輸入日期，例如 2026/11/25");
  const setLine = (key: string, patch: Partial<DocLine>) => ({ ...doc, lines: doc.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  const cols = doc.showInvoice ? 7 : 6;

  return (
    <article className="statement-doc relative mx-auto flex min-h-[1123px] w-[794px] flex-col bg-white px-[52px] pt-[44px] pb-[36px] text-[11.5px] leading-[1.6] text-ink shadow-[var(--shadow-pop)] print:min-h-0 print:w-auto print:p-0 print:shadow-none">
      <div className="absolute inset-x-0 top-0 h-[5px] bg-amber print:hidden" />

      {/* 抬頭 */}
      <header className="flex items-start justify-between gap-6 border-b border-ink pb-4">
        <div className="flex items-start gap-3">
          <div className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[10px] bg-amber text-[24px] leading-none font-bold text-ink">金</div>
          <div>
            <div className="text-[17px] leading-tight font-bold tracking-[.06em]">{COMPANY.name}</div>
            <div className="mt-0.5 text-[10.5px] text-muted">{COMPANY.tagline}</div>
            <div className="text-[10.5px] text-muted">
              {COMPANY.address}・{COMPANY.phone}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[24px] leading-tight font-bold tracking-[.14em]">
            <Ed value={doc.title} label="標題" changed={isChanged("title")} onCommit={text((v) => ({ ...doc, title: v }), "標題")} />
          </div>
          <div className="text-[9.5px] font-semibold tracking-[.32em] text-faint">MONTHLY STATEMENT</div>
          <div className="num mt-1 text-[10.5px] text-muted">No. {doc.docNo}</div>
        </div>
      </header>

      {/* 客戶與帳單資訊 */}
      <section className="mt-5 grid grid-cols-[1fr_230px] gap-8">
        <div>
          <div className="text-[10px] font-semibold tracking-[.2em] text-faint">致</div>
          <div className="mt-0.5 text-[16px] leading-snug font-bold">
            <Ed value={doc.customer.name} label="客戶名稱" changed={isChanged("customer.name")} onCommit={text((v) => ({ ...doc, customer: { ...doc.customer, name: v } }), "客戶名稱")} />
            <span className="ml-1.5 text-[12px] font-normal text-muted">台照</span>
          </div>
          <dl className="mt-1.5 grid grid-cols-[64px_1fr] gap-y-0.5 text-ink-2">
            {doc.customer.taxId || editable ? (
              <>
                <dt className="text-muted">統一編號</dt>
                <dd className="num">
                  <Ed value={doc.customer.taxId} label="統一編號" changed={isChanged("customer.taxId")} onCommit={text((v) => ({ ...doc, customer: { ...doc.customer, taxId: v } }), "統一編號")} />
                </dd>
              </>
            ) : null}
            <dt className="text-muted">聯絡人</dt>
            <dd>
              <Ed value={doc.customer.contactName} label="聯絡人" changed={isChanged("customer.contactName")} onCommit={text((v) => ({ ...doc, customer: { ...doc.customer, contactName: v } }), "聯絡人")} />
              <span className="mx-1 text-faint">・</span>
              <Ed value={doc.customer.phone} label="電話" className="num" changed={isChanged("customer.phone")} onCommit={text((v) => ({ ...doc, customer: { ...doc.customer, phone: v } }), "電話")} />
            </dd>
            <dt className="text-muted">地址</dt>
            <dd>
              <Ed value={doc.customer.address} label="地址" changed={isChanged("customer.address")} onCommit={text((v) => ({ ...doc, customer: { ...doc.customer, address: v } }), "地址")} />
            </dd>
          </dl>
        </div>
        <dl className="grid grid-cols-[64px_1fr] content-start gap-y-0.5 border-l border-line pl-5 text-ink-2">
          <dt className="text-muted">對帳期間</dt>
          <dd className="num">
            {formatDate(start, { year: true })}–{formatDate(end, { year: true })}
          </dd>
          <dt className="text-muted">開立日期</dt>
          <dd className="num">
            <Ed value={formatDate(doc.issueDate, { year: true })} label="開立日期" changed={isChanged("issueDate")} onCommit={date((v) => ({ ...doc, issueDate: v }), "開立日期")} />
          </dd>
          <dt className="text-muted">結帳條件</dt>
          <dd>{doc.terms}</dd>
          <dt className="text-muted">付款期限</dt>
          <dd className="num font-semibold text-ink">
            <Ed value={formatDate(doc.dueDate, { year: true })} label="付款期限" changed={isChanged("dueDate")} onCommit={date((v) => ({ ...doc, dueDate: v }), "付款期限")} />
          </dd>
        </dl>
      </section>

      {/* 本期應付 */}
      <section className="mt-5 flex items-center justify-between rounded-[10px] border border-amber/45 bg-amber-wash px-5 py-3.5 [print-color-adjust:exact]">
        <div>
          <div className="text-[11px] font-semibold tracking-[.12em] text-amber-deep">本期應付金額</div>
          <div className="num text-[28px] leading-tight font-bold tracking-[-0.01em]" data-testid="amount-due">
            {formatTWD(t.closingCents)}
          </div>
        </div>
        <div className="text-right text-[11px] text-ink-2">
          請於 <b className="num text-ink">{formatDate(doc.dueDate, { year: true })}</b> 前付款
          <div className="text-muted">金額含 5% 營業稅・新臺幣計價</div>
        </div>
      </section>

      {/* 摘要算式 */}
      <section className="mt-3 grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] items-center text-center">
        {(
          [
            ["上期結轉", t.openingCents, "opening"],
            ["＋"],
            ["本期出貨", t.chargesCents],
            [t.adjustmentsCents < 0 ? "−" : "＋"],
            ["折讓／調整", Math.abs(t.adjustmentsCents)],
            ["−"],
            ["本期收款", t.paymentsCents],
            ["＝"],
            ["本期應付", t.closingCents, "closing"],
          ] as [string, Cents?, string?][]
        ).map(([label, v, kind], i) =>
          v === undefined ? (
            <span key={i} className="px-1 text-[13px] text-faint">
              {label}
            </span>
          ) : (
            <div key={i} className={cn("rounded-[8px] px-2 py-1.5", kind === "closing" && "bg-sunk [print-color-adjust:exact]")}>
              <div className="text-[10px] text-muted">{label}</div>
              <div className={cn("num text-[13px]", kind === "closing" ? "font-bold" : "font-semibold")}>
                {kind === "opening" ? <Ed value={money(v)} label="上期結轉" changed={isChanged("openingCents")} onCommit={amount((c) => ({ ...doc, openingCents: c }), "上期結轉")} /> : money(v)}
              </div>
            </div>
          ),
        )}
      </section>

      {/* 明細 */}
      <section className="mt-5">
        <div className="mb-1.5 flex items-end justify-between">
          <div className="text-[12px] font-bold tracking-[.08em]">交易明細</div>
          <div className="text-[10px] text-faint">單位：新臺幣元（含稅）</div>
        </div>
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-y border-ink bg-sunk text-left text-[10.5px] text-ink-2 [print-color-adjust:exact]">
              <th className="w-[46px] py-1.5 pl-2 font-semibold">日期</th>
              <th className="w-[112px] font-semibold">單號</th>
              <th className="font-semibold">摘要</th>
              {doc.showInvoice && <th className="w-[84px] font-semibold">發票號碼</th>}
              <th className="w-[72px] text-right font-semibold">應收</th>
              <th className="w-[72px] text-right font-semibold">收款／折讓</th>
              <th className="w-[80px] pr-2 text-right font-semibold">餘額</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line text-ink-2 [&>td]:py-1.5">
              <td className="num pl-2">{formatDate(start)}</td>
              <td className="text-faint">—</td>
              <td colSpan={cols - 5}>上期結轉</td>
              <td />
              <td />
              <td className="num pr-2 text-right font-medium">{money(doc.openingCents)}</td>
            </tr>
            {doc.lines.map((l, i) => {
              const k = `line:${l.key}`;
              const isNew = isChanged(k);
              return (
                <tr key={l.key} className={cn("group border-b border-line [&>td]:py-1.5 [&>td]:align-top", isNew && "bg-amber-wash print:bg-transparent")}>
                  <td className="num pl-2">{formatDate(l.date)}</td>
                  <td className="num text-ink-2">{l.refNo === "—" ? <span className="text-faint">人工調整</span> : l.refNo}</td>
                  <td>
                    <Ed value={l.description} label={`第 ${i + 1} 筆摘要`} changed={isNew || isChanged(`${k}:description`)} onCommit={text((v) => setLine(l.key, { description: v }), `第 ${i + 1} 筆摘要`)} />
                    {doc.showItems && l.items && l.items.length > 0 && (
                      <ul className="mt-0.5 mb-0.5 space-y-px text-[10px] text-muted">
                        {l.items.map((it) => (
                          <li key={it.productId} className="flex justify-between gap-3">
                            <span>
                              {it.name} {it.qty} {it.unitLabel} × {money(it.unitPriceExTaxCents)}
                            </span>
                            <span className="num">{money(it.exTaxCents)}</span>
                          </li>
                        ))}
                        <li className="text-right text-faint">以上未稅，另加 5% 營業稅</li>
                      </ul>
                    )}
                  </td>
                  {doc.showInvoice && <td className="num text-ink-2">{l.invoiceNo ?? (l.kind === "charge" ? <span className="text-faint">未開立</span> : "")}</td>}
                  <td className="num text-right">
                    {l.debitCents || editable ? <Ed value={l.debitCents ? money(l.debitCents) : ""} label={`第 ${i + 1} 筆應收`} className="inline-block min-w-[3ch]" changed={isNew || isChanged(`${k}:debitCents`)} onCommit={amount((c) => setLine(l.key, { debitCents: c }), `第 ${i + 1} 筆應收`)} /> : null}
                  </td>
                  <td className="num text-right text-ok">
                    {l.creditCents || editable ? <Ed value={l.creditCents ? money(l.creditCents) : ""} label={`第 ${i + 1} 筆收款／折讓`} className="inline-block min-w-[3ch]" changed={isNew || isChanged(`${k}:creditCents`)} onCommit={amount((c) => setLine(l.key, { creditCents: c }), `第 ${i + 1} 筆收款／折讓`)} /> : null}
                  </td>
                  <td className="num relative pr-2 text-right font-medium">
                    {money(t.balances[i])}
                    {editable && (
                      <button
                        type="button"
                        onClick={() => onChange({ ...doc, lines: doc.lines.filter((x) => x.key !== l.key) }, `移除 ${l.refNo === "—" ? l.description : l.refNo}`)}
                        aria-label={`移除第 ${i + 1} 筆`}
                        className="no-print absolute top-1 -right-7 grid h-5 w-5 place-items-center rounded-full text-faint opacity-0 group-hover:opacity-100 hover:bg-bad-soft hover:text-bad focus:opacity-100"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {/* totals stay a body row: a <tfoot> would repeat on every printed page */}
            <tr className="break-inside-avoid border-t border-ink font-semibold">
              <td colSpan={cols - 3} className="py-1.5 pl-2">
                本期合計
                {editable && (
                  <button
                    type="button"
                    onClick={() => {
                      const date = end < doc.issueDate ? end : doc.issueDate;
                      const line: DocLine = { key: `m-${Date.now().toString(36)}`, kind: "manual", date, refNo: "—", description: "折讓", debitCents: 0, creditCents: 0 };
                      onChange({ ...doc, lines: [...doc.lines, line] }, "新增一列");
                    }}
                    className="no-print ml-3 inline-flex items-center gap-1 rounded-[6px] border border-dashed border-line-strong px-1.5 py-px text-[10.5px] font-medium text-muted hover:border-amber hover:text-ink"
                  >
                    <Plus size={11} /> 新增一列
                  </button>
                )}
              </td>
              <td className="num text-right">{money(sum(doc.lines.map((l) => l.debitCents)))}</td>
              <td className="num text-right">{money(sum(doc.lines.map((l) => l.creditCents)))}</td>
              <td className="num pr-2 text-right">{money(t.closingCents)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* 匯款與備註 */}
      <section className="mt-6 grid grid-cols-2 gap-5">
        <div className="rounded-[10px] border border-line px-4 py-3">
          <div className="mb-1 text-[11px] font-bold tracking-[.08em]">匯款資訊</div>
          <dl className="grid grid-cols-[40px_1fr] gap-y-0.5 text-ink-2">
            <dt className="text-muted">銀行</dt>
            <dd>
              <Ed value={doc.bank.bankName} label="匯款銀行" changed={isChanged("bank.bankName")} onCommit={text((v) => ({ ...doc, bank: { ...doc.bank, bankName: v } }), "匯款銀行")} />
            </dd>
            <dt className="text-muted">戶名</dt>
            <dd>
              <Ed value={doc.bank.accountName} label="戶名" changed={isChanged("bank.accountName")} onCommit={text((v) => ({ ...doc, bank: { ...doc.bank, accountName: v } }), "戶名")} />
            </dd>
            <dt className="text-muted">帳號</dt>
            <dd className="num font-semibold text-ink">
              <Ed value={doc.bank.accountNo} label="匯款帳號" changed={isChanged("bank.accountNo")} onCommit={text((v) => ({ ...doc, bank: { ...doc.bank, accountNo: v } }), "匯款帳號")} />
            </dd>
          </dl>
          <div className="mt-1.5 text-[10px] text-muted">匯款後請告知帳號末五碼以利入帳；現金或支票可交送貨司機並索取收據。</div>
        </div>
        <div className="rounded-[10px] border border-line px-4 py-3">
          <div className="mb-1 text-[11px] font-bold tracking-[.08em]">備註</div>
          <div className="text-ink-2">
            <Ed value={doc.note} label="備註" multiline changed={isChanged("note")} onCommit={text((v) => ({ ...doc, note: v }), "備註")} />
          </div>
        </div>
      </section>

      {/* 簽核 */}
      <section className="mt-auto grid grid-cols-[1fr_1fr_1.6fr] gap-5 pt-8 text-[10.5px]">
        {(
          [
            ["製表", doc.preparedBy, "preparedBy"],
            ["核准", doc.approvedBy, "approvedBy"],
          ] as const
        ).map(([label, v, k]) => (
          <div key={k} className="border-t border-ink-2 pt-1.5">
            <span className="text-muted">{label}</span>
            <span className="ml-2 text-ink">
              <Ed value={v} label={label} changed={isChanged(k)} onCommit={text((x) => ({ ...doc, [k]: x }), label)} />
            </span>
          </div>
        ))}
        <div className="border-t border-ink-2 pt-1.5">
          <span className="text-muted">客戶確認簽章</span>
          <span className="ml-16 text-muted">日期</span>
          <div className="mt-1 text-[9.5px] text-faint">核對無誤請簽章回傳；如有差異請註明並與我們聯繫。</div>
        </div>
      </section>

      <footer className="mt-5 flex justify-between border-t border-line pt-2 text-[9.5px] text-faint">
        <span>
          {COMPANY.name}・{doc.docNo}
        </span>
        <span>本對帳單非統一發票・示範資料，非實際帳款</span>
      </footer>
    </article>
  );
}
