"use client";

import { Info, Plus, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Drawer, Field, Input, Money, Segmented, Select } from "@/components/ui";
import { activePlan, createManualOrder, pasteOrderText } from "@/lib/actions";
import { TERMS_LABEL } from "@/lib/domain/ar";
import { fieldErrors, orderSchema, type OrderInput } from "@/lib/domain/forms";
import { linePricing, PRICE_TIER_LABEL, quotedUnitPrice, resolvePrice } from "@/lib/domain/pricing";
import { linesTotals } from "@/lib/domain/orders";
import { BASIS_LABEL } from "@/lib/domain/taxcalc";
import type { Product } from "@/lib/domain/types";
import { formatTWD, lineAmount, twd } from "@/lib/money";
import { arSummary, crmRows, maps, stockPositions } from "@/lib/selectors";
import { useDb, useStore } from "@/lib/store";
import { addDays, DEMO_TODAY, formatDate } from "@/lib/time";

type Line = OrderInput["lines"][number];
const blank = (): Line => ({ productId: "", qty: 1, unit: "base", priceOverride: null, priceReason: "" });

export function OrderForm({ onClose, onCreated, initialCustomerId }: { onClose: () => void; onCreated: (orderId: string) => void; initialCustomerId?: string }) {
  const db = useDb();
  const runWith = useStore((s) => s.runWith);
  const m = maps(db);
  const pos = stockPositions(db);
  const plan = activePlan(db);
  const [v, setV] = useState<OrderInput>({ customerId: initialCustomerId ?? "", source: "PHONE", deliveryDate: addDays(DEMO_TODAY, 1), note: "", lines: [blank()] });
  const [tried, setTried] = useState(false);
  const c = v.customerId ? m.customers.get(v.customerId) : undefined;
  const ar = c ? arSummary(db).rows.find((r) => r.customerId === c.id) : undefined;
  const crm = c ? crmRows(db).find((r) => r.customerId === c.id) : undefined;

  const resolved = (p: Product) => resolvePrice(db.customerPrices, c, p, v.deliveryDate);
  // the price in the basis this customer is quoted (含稅 or 未稅); 改價 is typed in the same basis
  const listPrice = (p: Product) => quotedUnitPrice(resolved(p));
  const isContract = (p: Product) => resolved(p).source === "contract";
  const isIncluded = (p: Product) => resolved(p).basis === "included";
  const priceOf = (l: Line, p: Product) => (l.priceOverride === null ? listPrice(p) : twd(l.priceOverride));
  const baseQty = (l: Line, p: Product) => (l.unit === "pack" ? l.qty * p.packSize : l.qty);

  const totals = useMemo(() => {
    const lines = v.lines.flatMap((l) => {
      const p = m.products.get(l.productId);
      if (!p || !Number.isInteger(l.qty) || l.qty <= 0) return [];
      return [{ id: "", productId: p.id, qty: l.qty, unit: l.unit, qtyBase: baseQty(l, p), taxRateBp: 500, ...linePricing(resolved(p), l.priceOverride === null ? null : twd(l.priceOverride)) }];
    });
    const t = linesTotals(lines);
    return { ex: t.exTax, tax: t.tax, total: t.total, basis: t.basis };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.lines, v.deliveryDate, c, m.products, db.customerPrices]);

  const parsed = orderSchema.safeParse(v);
  const errs = tried && !parsed.success ? fieldErrors(parsed.error) : {};
  const overCredit = c && ar ? Math.max(0, ar.balance) + totals.total > c.creditLimitCents : false;
  const isToday = v.deliveryDate === DEMO_TODAY;

  const setLine = (i: number, patch: Partial<Line>) => setV((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const fillUsual = () => {
    if (!crm) return;
    const recent = db.orders.filter((o) => o.customerId === c!.id && o.state !== "Cancelled" && o.deliveryDate > addDays(DEMO_TODAY, -60)).length || 1;
    const lines = crm.topProducts.slice(0, 4).map((t) => {
      const p = m.products.get(t.productId)!;
      const avg = Math.max(1, Math.round(t.qtyBase / recent));
      return avg % p.packSize === 0 ? { ...blank(), productId: p.id, qty: avg / p.packSize, unit: "pack" as const } : { ...blank(), productId: p.id, qty: avg };
    });
    setV((x) => ({ ...x, lines: lines.length ? lines : x.lines }));
  };

  const submit = (confirm: boolean) => {
    setTried(true);
    if (!parsed.success) return;
    const id = runWith((d, ctx) => createManualOrder(d, ctx, v, confirm));
    if (id) {
      const o = useStore.getState().db.orders.find((x) => x.id === id)!;
      toast.success(confirm ? (o.state === "Reserved" ? `已建立 ${o.no} 並保留庫存${isToday ? "，待主任加入今日路線" : ""}` : `已建立 ${o.no}，但部分庫存不足`) : `已存為草稿 ${o.no}`);
      onCreated(id);
    }
  };

  const byCategory = useMemo(() => {
    const g = new Map<string, Product[]>();
    for (const p of db.products) g.set(p.category, [...(g.get(p.category) ?? []), p]);
    return [...g];
  }, [db.products]);

  return (
    <Drawer
      open
      onClose={onClose}
      width={760}
      title="手動建立訂單"
      sub="電話、現場或補登的訂單；價格依客戶價格等級自動帶入。"
      footer={
        <>
          <div className="mr-auto text-[12.5px] text-muted">
            含稅合計 <Money cents={totals.total} className="text-[15px] font-semibold text-ink" />
          </div>
          <Button variant="outline" onClick={() => submit(false)}>
            存為草稿
          </Button>
          <Button variant="primary" onClick={() => submit(true)}>
            確認並保留庫存
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="客戶" required error={errs.customerId} className="col-span-2 sm:col-span-1">
            <Select value={v.customerId} onChange={(e) => setV((x) => ({ ...x, customerId: e.target.value }))} autoFocus>
              <option value="">選擇客戶…</option>
              {(["炸物店", "餐廳"] as const).map((seg) => (
                <optgroup key={seg} label={seg}>
                  {db.customers
                    .filter((x) => x.segment === seg)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}（{x.code}）
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field group label="來源" className="col-span-2 sm:col-span-1">
            <Segmented
              value={v.source}
              onChange={(s) => setV((x) => ({ ...x, source: s }))}
              options={[
                { value: "PHONE", label: "電話／現場" },
                { value: "APP", label: "APP 補登" },
                { value: "LINE", label: "LINE 補登" },
              ]}
            />
          </Field>
          <Field group label="配送日" required error={errs.deliveryDate} className="col-span-2 sm:col-span-1">
            <div className="flex gap-1.5">
              <Input type="date" min={DEMO_TODAY} value={v.deliveryDate} onChange={(e) => setV((x) => ({ ...x, deliveryDate: e.target.value }))} />
              <Button variant={isToday ? "primary" : "outline"} size="sm" className="h-9" onClick={() => setV((x) => ({ ...x, deliveryDate: DEMO_TODAY }))}>
                今天
              </Button>
              <Button variant={v.deliveryDate === addDays(DEMO_TODAY, 1) ? "primary" : "outline"} size="sm" className="h-9" onClick={() => setV((x) => ({ ...x, deliveryDate: addDays(DEMO_TODAY, 1) }))}>
                明天
              </Button>
            </div>
          </Field>
          <Field label="備註" className="col-span-2 sm:col-span-1">
            <Input value={v.note} onChange={(e) => setV((x) => ({ ...x, note: e.target.value }))} placeholder="例：放後門冰箱" />
          </Field>
        </div>

        {c && ar && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-sunk px-3 py-2 text-[12px] text-muted">
            <span>
              {TERMS_LABEL[c.settlementTerms]}・{PRICE_TIER_LABEL[c.priceTier]}
            </span>
            <span>
              收貨 <span className="num">{c.window.start}–{c.window.end}</span>
            </span>
            <span>
              應收 <Money cents={ar.balance} /> ／額度 {formatTWD(c.creditLimitCents)}
            </span>
            {ar.overdue > 0 && <Badge tone="bad">逾期 {formatTWD(ar.overdue)}</Badge>}
          </div>
        )}
        {isToday && (
          <div className="flex items-start gap-2 rounded-lg border border-info/25 bg-info-soft px-3 py-2 text-[12.5px] text-info">
            <Info size={14} className="mt-0.5 shrink-0" />
            今日路線已排定（v{plan?.version ?? 1}）。確認後訂單列入「待排車」，需主任在「今日配送」加入 A 或 B 車，理貨單才會更新。
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[13px] font-semibold">品項</div>
            {crm && crm.topProducts.length > 0 && (
              <Button size="sm" variant="ghost" onClick={fillUsual}>
                <Sparkles size={14} /> 帶入常購品項
              </Button>
            )}
          </div>
          {errs.lines && <div className="mb-2 text-[11.5px] text-bad">{errs.lines}</div>}
          <div className="space-y-2">
            {v.lines.map((l, i) => {
              const p = m.products.get(l.productId);
              const sp = p ? pos.get(p.id) : undefined;
              const need = p ? baseQty(l, p) : 0;
              const short = sp ? need > sp.available : false;
              const changed = l.priceOverride !== null;
              return (
                <div key={i} className="rounded-lg border border-line p-2.5">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                      <Select value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value, priceOverride: null, priceReason: "" })} aria-label={`第 ${i + 1} 列品項`} className={errs[`lines.${i}.productId`] ? "border-bad" : ""}>
                        <option value="">選擇品項…</option>
                        {byCategory.map(([cat, ps]) => (
                          <optgroup key={cat} label={cat}>
                            {ps.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}・{x.spec}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </Select>
                      {p && sp && (
                        <div className={`mt-1 text-[11px] ${short ? "text-bad" : "text-muted"}`}>
                          可用 {sp.available} {p.baseUnit}
                          {short && `・不足 ${need - sp.available}，確認後將標示缺貨`}
                        </div>
                      )}
                    </div>
                    <Input type="number" min={1} value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} className={`num w-[72px] ${errs[`lines.${i}.qty`] ? "border-bad" : ""}`} aria-label={`第 ${i + 1} 列數量`} />
                    <div>
                      <Segmented size="sm" value={l.unit} onChange={(u) => setLine(i, { unit: u })} options={[{ value: "base", label: p?.baseUnit ?? "包" }, { value: "pack", label: p?.packUnit ?? "箱" }]} />
                    </div>
                    <div className="w-[100px]">
                      <Input
                        type="number"
                        min={0}
                        value={p ? (l.priceOverride ?? listPrice(p) / 100) : ""}
                        disabled={!p}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setLine(i, { priceOverride: p && twd(n) === listPrice(p) ? null : n });
                        }}
                        className={`num ${changed ? "border-warn" : ""}`}
                        aria-label={`第 ${i + 1} 列單價`}
                        title={p ? `每${p.baseUnit}${isIncluded(p) ? "含稅" : "未稅"}單價` : undefined}
                      />
                      {p && (
                        <div className="mt-1 text-right text-[11px] text-muted">
                          {isContract(p) && !changed && <span className="mr-1 text-amber-deep">合約價</span>}
                          {isIncluded(p) && <span className="mr-1">含稅</span>}
                          {formatTWD(lineAmount(need, priceOf(l, p)))}
                        </div>
                      )}
                    </div>
                    <button onClick={() => setV((x) => ({ ...x, lines: x.lines.length > 1 ? x.lines.filter((_, j) => j !== i) : [blank()] }))} className="ml-auto grid h-9 w-7 place-items-center text-faint hover:text-bad sm:ml-0" aria-label={`刪除第 ${i + 1} 列`}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                  {changed && p && (
                    <div className="mt-2 flex items-center gap-2">
                      <Badge tone="warn">改價 {isContract(p) ? "合約價 " : ""}{listPrice(p) / 100} → {l.priceOverride}</Badge>
                      <Input value={l.priceReason} onChange={(e) => setLine(i, { priceReason: e.target.value })} placeholder="改價原因（必填，主任可在操作紀錄看到）" className={`h-8 text-[12.5px] ${errs[`lines.${i}.priceReason`] ? "border-bad" : ""}`} aria-label={`第 ${i + 1} 列改價原因`} />
                    </div>
                  )}
                  {(errs[`lines.${i}.priceReason`] || errs[`lines.${i}.productId`] || errs[`lines.${i}.qty`]) && (
                    <div className="mt-1 text-[11.5px] text-bad" role="alert">
                      {errs[`lines.${i}.productId`] ?? errs[`lines.${i}.qty`] ?? errs[`lines.${i}.priceReason`]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setV((x) => ({ ...x, lines: [...x.lines, blank()] }))}>
            <Plus size={14} /> 新增一列
          </Button>
        </div>

        <div className="ml-auto max-w-[280px] space-y-1 text-[13px]">
          <div className="flex justify-between text-muted">
            <span>銷售額（未稅）・{BASIS_LABEL[totals.basis]}</span>
            <Money cents={totals.ex} />
          </div>
          <div className="flex justify-between text-muted">
            <span>營業稅 5%</span>
            <Money cents={totals.tax} />
          </div>
          <div className="flex justify-between border-t border-line pt-1 font-semibold">
            <span>含稅合計</span>
            <Money cents={totals.total} />
          </div>
        </div>
        {overCredit && c && (
          <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            此單加上目前應收將超過信用額度 {formatTWD(c.creditLimitCents)}。仍可建立，建議先與客戶確認付款。
          </div>
        )}
        <p className="text-[11.5px] text-muted">單價為每基本單位（包／袋），依客戶報價方式為含稅或未稅價，改價也用同一種；配送日 {formatDate(v.deliveryDate, { weekday: true })}。</p>
      </div>
    </Drawer>
  );
}

export function PasteOrderForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const run = useStore((s) => s.run);
  const [from, setFrom] = useState("");
  const [text, setText] = useState("");
  return (
    <Drawer
      open
      onClose={onClose}
      width={520}
      title="貼上 LINE／電話文字"
      sub="AI 只會轉成草稿；單位、數量、客戶有疑義時一律需要業務確認。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="ai" disabled={!text.trim()} onClick={() => run((d, ctx) => pasteOrderText(d, ctx, from, text), "已轉成草稿，請在「AI 草稿待確認」核對") && onDone()}>
            <Sparkles size={14} /> 轉成草稿
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="來源／客戶（選填）" hint="寫上店名可幫助比對客戶，例：金華小吃 金姐">
          <Input value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="訊息內容" required>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="明天要 雞塊2箱 薯條5 花枝丸10包" className="w-full rounded-[9px] border border-line-strong bg-surface px-3 py-2 text-[13px] outline-none focus:border-amber focus:ring-2 focus:ring-amber/20" aria-label="訊息內容" />
        </Field>
      </div>
    </Drawer>
  );
}
