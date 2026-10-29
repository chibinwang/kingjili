"use client";

import { Banknote, Link2, Receipt, Search, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { AddMenu, type AddItem } from "@/components/AddMenu";
import { CrmBoard } from "@/components/crm/CrmBoard";
import { CustomerForm } from "@/components/forms/CustomerForm";
import { Badge, Button, Card, Field, Input, Modal, Money, PageHeader, Segmented, Select } from "@/components/ui";
import { allocateReceipt, recordPayment, reversePayment, setCustody } from "@/lib/actions";
import { cn } from "@/lib/cn";
import { appliedTo, CUSTODY_LABEL, TERMS_LABEL, DOC_LABEL, docStatus, isReversed, METHOD_LABEL, paymentUnapplied } from "@/lib/domain/ar";
import type { Customer, Payment } from "@/lib/domain/types";
import { formatTWD, twd } from "@/lib/money";
import { arSummary, maps } from "@/lib/selectors";
import { useDb, useStore } from "@/lib/store";
import { at, DEMO_TODAY, formatDate, formatDateTime } from "@/lib/time";

export default function CustomersPage() {
  return (
    <Suspense>
      <Customers />
    </Suspense>
  );
}

type Tab = "crm" | "ar";

function Customers() {
  const router = useRouter();
  const params = useSearchParams();
  // Links from elsewhere (`/customers?id=…`) are about money, so they land on 應收帳款.
  const tab: Tab = (params.get("tab") as Tab) ?? (params.get("id") ? "ar" : "crm");
  const db = useDb();
  const [adding, setAdding] = useState<"customer" | "payment" | null>(null);
  const addItems: AddItem[] = [
    { key: "customer", label: "新增客戶", desc: "餐廳／炸物店建檔", icon: <UserPlus size={16} />, perm: "crm.edit", onSelect: () => setAdding("customer") },
    { key: "payment", label: "登錄收款", desc: "匯款、現金、支票", icon: <Banknote size={16} />, perm: "payment.record", onSelect: () => setAdding("payment") },
  ];
  const setTab = (t: Tab) => {
    const id = params.get("id");
    router.replace(t === "ar" ? `/customers?tab=ar${id ? `&id=${id}` : ""}` : "/customers?tab=crm", { scroll: false });
  };
  return (
    <div className="animate-rise space-y-5">
      <PageHeader
        eyebrow="CUSTOMERS & AR"
        title="客戶與應收"
        right={<AddMenu items={tab === "crm" ? addItems : [...addItems].reverse()} />}
        sub={tab === "crm" ? "所有餐廳與炸物店客戶：負責人、聯絡電話、合作多久、叫貨狀況與往來紀錄。可切換卡片或列表檢視。" : "結帳條件寫在客戶檔，不由發票推斷。司機收現只代表「司機持有」，繳回、存入、核對後才算入帳；更正一律用沖回或調整單，不修改原紀錄。"}
      />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "crm", label: <span className="inline-flex items-center gap-1.5"><Users size={14} /> 客戶名冊</span> },
          { value: "ar", label: <span className="inline-flex items-center gap-1.5"><Receipt size={14} /> 應收帳款</span> },
        ]}
      />
      {tab === "crm" ? <CrmBoard /> : <ArView />}
      {adding === "customer" && (
        <CustomerForm
          onClose={() => setAdding(null)}
          onCreated={(id) => {
            setAdding(null);
            router.replace(`/customers?tab=crm&open=${id}`, { scroll: false });
          }}
        />
      )}
      {adding === "payment" && <PaymentModal c={tab === "ar" && params.get("id") ? maps(db).customers.get(params.get("id")!) : undefined} onClose={() => setAdding(null)} />}
    </div>
  );
}

function ArView() {
  const db = useDb();
  const router = useRouter();
  const params = useSearchParams();
  const ar = arSummary(db);
  const [q, setQ] = useState("");
  const selectedId = params.get("id") ?? db.customers[0].id;
  const list = db.customers.filter((c) => !q || c.name.includes(q) || c.code.includes(q.toUpperCase()));

  return (
    <div className="space-y-5">
      <CashPanel />
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <Card className="self-start overflow-hidden">
          <div className="border-b border-line p-3">
            <div className="relative">
              <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋客戶" className="pl-8" />
            </div>
          </div>
          <div className="scroll-thin max-h-[720px] overflow-y-auto">
            {list.map((c) => {
              const r = ar.rows.find((x) => x.customerId === c.id)!;
              return (
                <button key={c.id} onClick={() => router.push(`/customers?tab=ar&id=${c.id}`, { scroll: false })} className={cn("flex w-full items-center justify-between border-b border-[#f1eee8] px-4 py-2.5 text-left hover:bg-amber-wash", selectedId === c.id && "bg-amber-soft/50")}>
                  <div>
                    <div className="text-[13.5px] font-medium">{c.name}</div>
                    <div className="mt-0.5 flex gap-1">
                      <Badge tone={c.settlementTerms === "daily" ? "neutral" : c.settlementTerms === "monthly" ? "info" : "amber"}>{TERMS_LABEL[c.settlementTerms]}</Badge>
                      {r.overdue > 0 && <Badge tone="bad">逾期</Badge>}
                      {r.balance < 0 && <Badge tone="warn">溢收</Badge>}
                    </div>
                  </div>
                  <Money cents={r.balance} className="text-[13px] font-medium" />
                </button>
              );
            })}
          </div>
        </Card>
        <CustomerDetail key={selectedId} c={maps(db).customers.get(selectedId)!} />
      </div>
    </div>
  );
}

function CashPanel() {
  const db = useDb();
  const run = useStore((s) => s.run);
  const acct = db.users.find((u) => u.role === "accounting")!;
  const collected = db.payments.filter((p) => p.custody === "collected" && !p.reversalOf);
  const handed = db.payments.filter((p) => p.custody === "handed_over" && !p.reversalOf);
  const received = db.payments.filter((p) => p.custody === "received" && !p.reversalOf);
  const sum = (ps: Payment[]) => ps.reduce((a, p) => a + p.grossCents, 0);
  return (
    <Card className="grid gap-0 divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
      {[
        { label: "司機持有現金（未繳回）", ps: collected, next: "handed_over" as const, btn: "確認已繳回" },
        { label: "已繳回公司（待存入銀行）", ps: handed, next: "deposited" as const, btn: "確認已存入" },
        { label: "銀行入帳待核對", ps: received, next: null, btn: "前往沖帳" },
      ].map((k) => (
        <div key={k.label} className="flex items-center justify-between gap-3 px-5 py-4">
          <div>
            <div className="text-[12px] text-muted">{k.label}</div>
            <div className="num mt-0.5 text-[19px] font-semibold">{formatTWD(sum(k.ps))}</div>
            <div className="text-[11.5px] text-faint">{k.ps.length} 筆</div>
          </div>
          {k.ps.length > 0 &&
            (k.next ? (
              <Button size="sm" variant="outline" onClick={() => run((d, c) => setCustody(d, c, k.ps.map((p) => p.id), k.next!), "已更新收款狀態", { asUserId: acct.id })}>
                <Banknote size={14} /> {k.btn}
              </Button>
            ) : (
              <Link href={`/customers?tab=ar&id=${k.ps[0].customerId}`}>
                <Button size="sm" variant="outline">
                  {k.btn}
                </Button>
              </Link>
            ))}
        </div>
      ))}
    </Card>
  );
}

function CustomerDetail({ c }: { c: Customer }) {
  const db = useDb();
  const run = useStore((s) => s.run);
  const ar = arSummary(db).rows.find((r) => r.customerId === c.id)!;
  const [tab, setTab] = useState<"open" | "payments" | "ledger">("open");
  const [paying, setPaying] = useState(false);
  const acct = db.users.find((u) => u.role === "accounting")!;
  const payments = useMemo(() => db.payments.filter((p) => p.customerId === c.id).sort((a, b) => b.collectedAt.localeCompare(a.collectedAt)), [db.payments, c.id]);
  const docs = useMemo(() => db.arDocs.filter((d) => d.customerId === c.id).sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.no.localeCompare(a.no)), [db.arDocs, c.id]);
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-6 py-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[19px] font-semibold">{c.name}</h2>
            <Badge tone={c.settlementTerms === "monthly" ? "info" : c.settlementTerms === "mixed" ? "amber" : "neutral"}>
              {TERMS_LABEL[c.settlementTerms]}
              {c.settlementTerms === "mixed" && `・當日收 ${(c.sameDayShareBp ?? 0) / 100}%`}
            </Badge>
          </div>
          <div className="mt-1 text-[12.5px] text-muted">
            {c.code}・{c.contactName}・{c.phone}・{c.address}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11.5px]">
            <Badge tone={c.linkStatus === "linked" ? "ok" : c.linkStatus === "pending" ? "warn" : "neutral"}>
              <Link2 size={11} /> LINE {c.linkStatus === "linked" ? "已綁定官方帳號" : c.linkStatus === "pending" ? "綁定中" : "未綁定"}
            </Badge>
            <Badge tone="outline">{c.invoiceClass === "B2B" ? `B2B・統編 ${c.taxId}` : `B2C${c.carrier ? `・${c.carrier.type === "mobile" ? "手機條碼" : c.carrier.type === "member" ? "會員載具" : "自然人憑證"}` : "・紙本"}`}</Badge>
            <Badge tone="outline">信用額度 {formatTWD(c.creditLimitCents)}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/accounting?customer=${c.id}`}>
            <Button variant="outline">月結預覽</Button>
          </Link>
          <Button variant="primary" onClick={() => setPaying(true)}>
            登錄收款
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 border-b border-line px-6 py-4 md:grid-cols-4">
        <div>
          <div className="text-[12px] text-muted">應收餘額</div>
          <Money cents={ar.balance} className="text-[19px] font-semibold" />
        </div>
        <div>
          <div className="text-[12px] text-muted">逾期</div>
          <Money cents={ar.overdue} className={cn("text-[19px] font-semibold", ar.overdue > 0 && "text-bad")} />
        </div>
        <div>
          <div className="text-[12px] text-muted">未沖收款／溢收</div>
          <Money cents={ar.unappliedCredit} className={cn("text-[19px] font-semibold", ar.unappliedCredit > 0 && "text-warn")} />
        </div>
        <div>
          <div className="text-[12px] text-muted">最久逾期到期日</div>
          <div className="num text-[19px] font-semibold">{ar.oldestDue ? formatDate(ar.oldestDue) : "—"}</div>
        </div>
      </div>
      <div className="px-6 pt-4">
        <Segmented
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: "open", label: `未收單據（${ar.openDocs.length}）` },
            { value: "payments", label: `收款（${payments.length}）` },
            { value: "ledger", label: "全部單據" },
          ]}
        />
      </div>
      <div className="scroll-thin max-h-[560px] overflow-auto px-2 pt-3 pb-4">
        {tab === "open" && (
          <table className="tbl">
            <thead>
              <tr>
                <th>單據</th>
                <th>出貨日</th>
                <th>到期日</th>
                <th className="r">含稅</th>
                <th className="r">已收</th>
                <th className="r">未收</th>
                <th>帳齡</th>
              </tr>
            </thead>
            <tbody>
              {ar.openDocs.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted">
                    沒有未收單據
                  </td>
                </tr>
              )}
              {ar.openDocs.map((o) => (
                <tr key={o.doc.id} className="row-hover">
                  <td className="num">
                    {o.doc.no}
                    <div className="text-[11px] text-faint">{o.doc.memo}</div>
                  </td>
                  <td className="num">{formatDate(o.doc.issueDate)}</td>
                  <td className="num">{formatDate(o.due)}</td>
                  <td className="r">
                    <Money cents={o.doc.totalCents} />
                  </td>
                  <td className="r text-muted">
                    <Money cents={o.doc.totalCents - o.remaining} />
                  </td>
                  <td className="r font-semibold">
                    <Money cents={o.remaining} />
                  </td>
                  <td>{o.daysLate > 0 ? <Badge tone="bad">逾期 {o.daysLate} 天</Badge> : <Badge tone="neutral">未到期</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "payments" && (
          <table className="tbl">
            <thead>
              <tr>
                <th>收款</th>
                <th>時間</th>
                <th>方式・收款人</th>
                <th className="r">金額</th>
                <th className="r">未沖</th>
                <th>狀態</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const un = paymentUnapplied(p, db.allocations);
                const reversed = isReversed(p, db.payments);
                return (
                  <tr key={p.id} className={cn("row-hover", (reversed || p.reversalOf) && "text-faint")}>
                    <td className="num">
                      {p.no}
                      {p.note && <div className="max-w-[220px] truncate text-[11px] text-faint">{p.note}</div>}
                    </td>
                    <td className="num">{formatDateTime(p.collectedAt)}</td>
                    <td className="text-[12.5px]">
                      {METHOD_LABEL[p.method]}・{p.collector}
                    </td>
                    <td className="r">
                      <Money cents={p.grossCents} muted={!!p.reversalOf} />
                    </td>
                    <td className="r">{un !== 0 && !p.reversalOf && !reversed ? <Money cents={un} className="font-semibold text-warn" /> : <span className="text-faint">—</span>}</td>
                    <td>{p.reversalOf ? <Badge tone="outline">沖回分錄</Badge> : reversed ? <Badge tone="outline">已沖回</Badge> : <Badge tone={p.custody === "deposited" || p.custody === "matched" ? "ok" : "warn"}>{CUSTODY_LABEL[p.custody]}</Badge>}</td>
                    <td className="r">
                      {!p.reversalOf && !reversed && (
                        <div className="flex justify-end gap-1">
                          {un > 0 && (
                            <Button size="sm" variant="outline" onClick={() => run((d, ctx) => allocateReceipt(d, ctx, p.id), "已沖帳", { asUserId: acct.id })}>
                              沖帳
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => run((d, ctx) => reversePayment(d, ctx, p.id, "會計更正"), "已建立沖回分錄", { asUserId: acct.id })}>
                            沖回
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {tab === "ledger" && (
          <table className="tbl">
            <thead>
              <tr>
                <th>單據</th>
                <th>類型</th>
                <th>日期</th>
                <th className="r">未稅</th>
                <th className="r">稅額</th>
                <th className="r">含稅</th>
                <th>發票</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const inv = db.invoices.find((i) => i.sourceArIds.includes(d.id));
                const st = docStatus(d, db.allocations);
                return (
                  <tr key={d.id} className="row-hover">
                    <td className="num">{d.no}</td>
                    <td className="text-[12.5px]">{DOC_LABEL[d.type]}</td>
                    <td className="num">{formatDate(d.issueDate)}</td>
                    <td className="r">
                      <Money cents={d.exTaxCents} />
                    </td>
                    <td className="r">
                      <Money cents={d.taxCents} />
                    </td>
                    <td className="r">
                      <Money cents={d.totalCents} />
                    </td>
                    <td className="num text-[12px] text-muted">{inv?.invoiceNo ?? (inv ? "待開立" : "—")}</td>
                    <td>
                      {st === "paid" && <Badge tone="ok">已收</Badge>}
                      {st === "partial" && <Badge tone="warn">部分 {formatTWD(appliedTo(d.id, db.allocations))}</Badge>}
                      {st === "open" && <Badge tone="neutral">未收</Badge>}
                      {st === "credit" && <Badge tone="info">貸項</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {paying && <PaymentModal c={c} onClose={() => setPaying(false)} />}
    </Card>
  );
}

function PaymentModal({ c: fixed, onClose }: { c?: Customer; onClose: () => void }) {
  const db = useDb();
  const [customerId, setCustomerId] = useState(fixed?.id ?? "");
  const c = fixed ?? db.customers.find((x) => x.id === customerId);
  const run = useStore((s) => s.run);
  const acct = db.users.find((u) => u.role === "accounting")!;
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Payment["method"]>("transfer");
  const [date, setDate] = useState(DEMO_TODAY);
  const [note, setNote] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      width={460}
      title={c ? `登錄收款・${c.name}` : "登錄收款"}
      sub="系統由舊到新自動沖帳；超過未收的部分列為客戶溢收"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={!c || !(Number(amount) > 0)}
            onClick={() => c && run((d, ctx) => recordPayment(d, ctx, { customerId: c.id, amountCents: twd(Math.round(Number(amount || 0))), method, collectedAt: at(date, "11:00"), note, collector: acct.name }), "已登錄收款並沖帳", { asUserId: acct.id }) && onClose()}
          >
            登錄
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {!fixed && (
          <Field label="客戶" required className="col-span-2">
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} autoFocus>
              <option value="">選擇客戶…</option>
              {db.customers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}（{x.code}）
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="金額（元）">
          <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="num" />
        </Field>
        <Field label="方式">
          <Select value={method} onChange={(e) => setMethod(e.target.value as Payment["method"])}>
            <option value="transfer">匯款</option>
            <option value="cash">現金</option>
            <option value="check">支票</option>
            <option value="linepay">LINE Pay</option>
          </Select>
        </Field>
        <Field label="收款日">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="備註">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
