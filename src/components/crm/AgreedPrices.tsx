"use client";

import { History, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Field, Input, Modal, Segmented, Select } from "@/components/ui";
import { setAgreedPrice, setCustomerPriceBasis } from "@/lib/actions";
import { cn } from "@/lib/cn";
import type { AgreedPriceRowInput } from "@/lib/domain/forms";
import { agreementOn, formatBp, PRICE_TIER_LABEL, quoteToBaseExTax, tierPrice, type AgreementSummary } from "@/lib/domain/pricing";
import type { Customer, CustomerPrice, Product } from "@/lib/domain/types";
import { formatTWD, twd } from "@/lib/money";
import { can } from "@/lib/permissions";
import { agreedPrices, maps } from "@/lib/selectors";
import { useCurrentUser, useDb, useStore } from "@/lib/store";
import { addDays, DEMO_TODAY, formatDate } from "@/lib/time";

/* 合約價 (per-customer promised prices) — card/list summaries, the panel table, and the editor. */

const perBase = (p: Product, cents: number) => `${formatTWD(cents)}／${p.baseUnit}`;
const quotedLabel = (p: Product, q: CustomerPrice["quoted"]) => (q ? `${formatTWD(q.amountCents)}／${q.unit === "pack" ? p.packUnit : p.baseUnit}${q.taxIncluded ? "（含稅）" : "（未稅）"}` : "—");
const Discount = ({ bp, className }: { bp: number; className?: string }) => (
  <span className={cn("num", bp > 0 ? "text-ok" : bp < 0 ? "text-bad" : "text-muted", className)}>{bp > 0 ? `−${formatBp(bp)}` : bp < 0 ? `+${formatBp(-bp)}` : "同等級價"}</span>
);

function useSummary(customerId: string): AgreementSummary {
  return agreedPrices(useDb()).get(customerId)!;
}

/** Card view: one line of headline + the two biggest discounts. */
export function AgreedPriceCardLine({ c }: { c: Customer }) {
  const s = useSummary(c.id);
  const canMargin = can(useCurrentUser().role, "view.margin");
  if (!s.lines.length) {
    return (
      <div className="mx-4 mt-2 text-[11.5px] text-faint" data-testid="agreed-price-line">
        {PRICE_TIER_LABEL[c.priceTier]}・無合約價
      </div>
    );
  }
  return (
    <div className="mx-4 mt-2 rounded-lg border border-amber/25 bg-amber-wash px-3 py-2 text-[11.5px]" data-testid="agreed-price-line">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-amber-deep">
          合約價 {s.lines.length} 項・平均 <Discount bp={s.avgDiscountBp} className="font-medium" />
        </span>
        {canMargin && s.belowCostCount > 0 && (
          <Badge tone="bad">
            <TriangleAlert size={11} /> 低於成本 {s.belowCostCount}
          </Badge>
        )}
      </div>
      <div className="mt-0.5 truncate text-muted">
        {s.lines.slice(0, 2).map((l, i) => (
          <span key={l.product.id}>
            {i > 0 && "・"}
            {l.product.name} <span className="num text-ink-2">{perBase(l.product, l.cents)}</span>
          </span>
        ))}
        {s.lines.length > 2 && ` 等 ${s.lines.length} 項`}
      </div>
    </div>
  );
}

/** List view cell: count + average discount; the full list is in the native tooltip and the panel. */
export function AgreedPriceCell({ c }: { c: Customer }) {
  const s = useSummary(c.id);
  if (!s.lines.length) return <span className="text-[12px] text-faint">{PRICE_TIER_LABEL[c.priceTier]}</span>;
  const tip = s.lines.map((l) => `${l.product.name} ${perBase(l.product, l.cents)}（${PRICE_TIER_LABEL[c.priceTier]} ${formatTWD(l.tierCents)}）`).join("\n");
  return (
    <div title={tip} className="whitespace-nowrap text-[12.5px]">
      <div className="font-medium text-amber-deep">合約價 {s.lines.length} 項</div>
      <div className="text-[11.5px] text-muted">
        平均 <Discount bp={s.avgDiscountBp} />
      </div>
    </div>
  );
}

/** 報價方式 of a customer: its default basis, or 混合 when some 合約價 are quoted the other way. */
export function customerBasis(c: Customer, s: AgreementSummary): "excluded" | "included" | "mixed" {
  const base = c.priceBasis ?? "excluded";
  return s.lines.some((l) => (l.agreement.quoted?.taxIncluded ? "included" : "excluded") !== base) ? "mixed" : base;
}

const BASIS_TEXT = { excluded: "未稅報價", included: "含稅報價", mixed: "混合報價" } as const;

/** Shows and (with price.manage) switches the customer's default 報價方式. */
export function PriceBasisControl({ c }: { c: Customer }) {
  const s = useSummary(c.id);
  const run = useStore((x) => x.run);
  const canEdit = can(useCurrentUser().role, "price.manage");
  const eff = customerBasis(c, s);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="price-basis">
      {canEdit ? (
        <Segmented
          size="sm"
          value={c.priceBasis ?? "excluded"}
          onChange={(b) => run((d, ctx) => setCustomerPriceBasis(d, ctx, c.id, b), `${c.name} 改為${BASIS_TEXT[b]}`)}
          options={[
            { value: "excluded", label: "未稅報價" },
            { value: "included", label: "含稅報價" },
          ]}
        />
      ) : (
        <span>{BASIS_TEXT[c.priceBasis ?? "excluded"]}</span>
      )}
      {eff === "mixed" && <Badge tone="amber">混合：部分合約價以另一種方式報價</Badge>}
    </div>
  );
}

/** Phone list: short suffix. */
export function agreedPriceShort(s: AgreementSummary): string | null {
  return s.lines.length ? `合約價 ${s.lines.length} 項` : null;
}

/** Customer panel tab: the full agreement table, history and the editor. */
export function AgreedPriceTable({ c }: { c: Customer }) {
  const db = useDb();
  const user = useCurrentUser();
  const s = useSummary(c.id);
  const canMargin = can(user.role, "view.margin");
  const canEdit = can(user.role, "price.manage");
  const [edit, setEdit] = useState<{ productId?: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const history = db.customerPrices.filter((p) => p.customerId === c.id).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt));
  const m = maps(db);

  return (
    <div className="space-y-3" data-testid="agreed-price-table">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12.5px] text-muted">
          未列出的品項依 <b className="text-ink-2">{PRICE_TIER_LABEL[c.priceTier]}</b>、以<b className="text-ink-2">{c.priceBasis === "included" ? "含稅" : "未稅"}</b>計價。訂單建立時帶入當日有效的合約價，之後改價不影響既有訂單。
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setEdit({})}>
            <Plus size={13} /> 新增合約價
          </Button>
        )}
      </div>
      {s.lines.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-[12.5px] text-muted">尚無合約價</div>
      ) : (
        <div className="scroll-thin overflow-x-auto rounded-lg border border-line">
          <table className="tbl text-[12.5px]">
            <thead>
              <tr>
                <th>品項</th>
                <th className="r">合約價（未稅）</th>
                <th className="r">{PRICE_TIER_LABEL[c.priceTier]}</th>
                <th className="r">差異</th>
                {canMargin && <th className="r">毛利率</th>}
                <th>生效</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l) => (
                <tr key={l.product.id}>
                  <td>
                    <div className="font-medium">{l.product.name}</div>
                    {/* only worth showing when the quote differs from the stored ex-tax per-unit figure */}
                    {l.agreement.quoted && (l.agreement.quoted.unit === "pack" || l.agreement.quoted.taxIncluded) && (
                      <div className="text-[11px] whitespace-nowrap text-faint">報價 {quotedLabel(l.product, l.agreement.quoted)}</div>
                    )}
                  </td>
                  <td className="r whitespace-nowrap">
                    <div className="num font-medium">{perBase(l.product, l.cents)}</div>
                    <div className="num text-[11px] text-muted">
                      {formatTWD(l.cents * l.product.packSize)}／{l.product.packUnit}
                    </div>
                  </td>
                  <td className="r num whitespace-nowrap text-muted">{formatTWD(l.tierCents)}</td>
                  <td className="r whitespace-nowrap">
                    <Discount bp={l.discountBp} />
                  </td>
                  {canMargin && (
                    <td className="r whitespace-nowrap">
                      {l.marginBp === null ? (
                        <span className="text-[11.5px] text-faint">缺成本</span>
                      ) : (
                        <span className={cn("num", l.belowCost ? "font-semibold text-bad" : "")}>
                          {l.belowCost && <TriangleAlert size={11} className="mr-0.5 inline" />}
                          {formatBp(l.marginBp)}
                        </span>
                      )}
                    </td>
                  )}
                  <td className="num whitespace-nowrap text-[11.5px] text-muted" title={l.agreement.note}>
                    {formatDate(l.agreement.effectiveFrom, { year: true })}
                  </td>
                  {canEdit && (
                    <td className="r">
                      <Button size="icon" variant="ghost" onClick={() => setEdit({ productId: l.product.id })} aria-label={`調整 ${l.product.name} 合約價`}>
                        <Pencil size={13} />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canMargin && s.belowCostCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-bad/25 bg-bad-soft px-3 py-2 text-[12px] text-bad">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" /> {s.belowCostCount} 項合約價低於標準成本，每出貨一次都在虧損，建議重新議價。
        </div>
      )}
      {history.length > 0 && (
        <div>
          <button onClick={() => setShowHistory((v) => !v)} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink">
            <History size={12} /> {showHistory ? "收合" : "查看"}議價紀錄（{history.length}）
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-1 border-l border-line pl-3 text-[12px]">
              {history.map((h) => {
                const p = m.products.get(h.productId)!;
                return (
                  <li key={h.id} className="text-ink-2">
                    <span className="num text-muted">{formatDate(h.effectiveFrom, { year: true })}</span>　{p.name}：{h.priceExTaxCents === null ? "停用合約價" : perBase(p, h.priceExTaxCents)}
                    {h.note && <span className="text-faint">（{h.note}）</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {edit && <AgreedPriceEditor c={c} productId={edit.productId} onClose={() => setEdit(null)} />}
    </div>
  );
}

function AgreedPriceEditor({ c, productId, onClose }: { c: Customer; productId?: string; onClose: () => void }) {
  const db = useDb();
  const run = useStore((s) => s.run);
  const canMargin = can(useCurrentUser().role, "view.margin");
  const [pid, setPid] = useState(productId ?? "");
  const p = db.products.find((x) => x.id === pid);
  const current = p ? agreementOn(db.customerPrices, c.id, p.id, DEMO_TODAY) : undefined;
  const [amount, setAmount] = useState(current?.quoted ? String(current.quoted.amountCents / 100) : "");
  const [unit, setUnit] = useState<"base" | "pack">(current?.quoted?.unit ?? "base");
  const [taxIncluded, setTaxIncluded] = useState(current?.quoted?.taxIncluded ?? c.priceBasis === "included");
  const [from, setFrom] = useState(addDays(DEMO_TODAY, 1));
  const [note, setNote] = useState("");
  const n = Math.round(Number(amount));
  const cents = p && n > 0 ? quoteToBaseExTax({ amountCents: twd(n), unit, taxIncluded }, p) : null;
  const tier = p ? tierPrice(p, c) : 0;

  const save = (end = false) => {
    if (!p || (!end && !cents)) return;
    const ok = run(
      (d, ctx) => setAgreedPrice(d, ctx, { customerId: c.id, productId: p.id, quote: end ? null : { amountCents: twd(n), unit, taxIncluded }, effectiveFrom: from, note }),
      end ? `${p.name} 合約價已停用（${from} 起）` : `${c.name} ${p.name} 合約價已更新（${from} 起）`,
    );
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={480}
      title={current ? "調整合約價" : "新增合約價"}
      sub={`${c.name}・新價格自生效日起套用；已建立的訂單維持原價`}
      footer={
        <>
          {current && (
            <Button variant="ghost" className="mr-auto text-bad" onClick={() => save(true)}>
              <Trash2 size={13} /> 停用
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={!cents || !from} onClick={() => save()}>
            儲存
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="品項" required>
          <Select value={pid} onChange={(e) => setPid(e.target.value)} disabled={!!productId}>
            <option value="">選擇品項</option>
            {db.products.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}（{x.spec}・{x.packSize} {x.baseUnit}／{x.packUnit}）
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="報價金額（元）" required>
            <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className="num" />
          </Field>
          <Field group label="報價單位">
            <Segmented size="sm" value={unit} onChange={setUnit} options={[{ value: "base", label: `每${p?.baseUnit ?? "包"}` }, { value: "pack", label: `每${p?.packUnit ?? "箱"}` }]} />
          </Field>
          <Field group label="報價含稅？">
            <Segmented size="sm" value={taxIncluded ? "inc" : "ex"} onChange={(x) => setTaxIncluded(x === "inc")} options={[{ value: "ex", label: "未稅" }, { value: "inc", label: "含稅 5%" }]} />
          </Field>
          <Field label="生效日" required>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
        </div>
        <Field label="備註">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：年度議價、量增優惠" />
        </Field>
        {p && cents !== null && (
          <div className="rounded-lg bg-sunk px-3 py-2.5 text-[12.5px]">
            <div className="flex justify-between">
              <span className="text-muted">系統計價（未稅，取整數元）</span>
              <span className="num font-semibold">{perBase(p, cents)}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>{PRICE_TIER_LABEL[c.priceTier]}</span>
              <span>
                <span className="num">{formatTWD(tier)}</span>　<Discount bp={tier ? Math.round(((tier - cents) * 10000) / tier) : 0} />
              </span>
            </div>
            {canMargin && p.costCents !== null && cents < p.costCents && (
              <div className="mt-1 flex items-center gap-1 text-bad">
                <TriangleAlert size={12} /> 低於標準成本 {formatTWD(p.costCents)}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Onboarding form section: promised prices, effective from the onboarding date. */
export function AgreedPriceRowsInput({ rows, onChange, products, errors }: { rows: AgreedPriceRowInput[]; onChange: (rows: AgreedPriceRowInput[]) => void; products: Product[]; errors: Record<string, string> }) {
  const set = (i: number, patch: Partial<AgreedPriceRowInput>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const p = products.find((x) => x.id === r.productId);
        const cents = p && r.amount > 0 ? quoteToBaseExTax({ amountCents: twd(r.amount), unit: r.unit, taxIncluded: r.taxIncluded }, p) : null;
        const err = errors[`agreedPrices.${i}.productId`] ?? errors[`agreedPrices.${i}.amount`];
        return (
          <div key={i} className="rounded-lg border border-line p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={r.productId} onChange={(e) => set(i, { productId: e.target.value })} className="min-w-[140px] flex-1" aria-label={`合約價第 ${i + 1} 列品項`}>
                <option value="">選擇品項</option>
                {products.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
              <Input type="number" min={1} value={r.amount || ""} onChange={(e) => set(i, { amount: Number(e.target.value) })} className="num w-[96px]" placeholder="金額" aria-label={`合約價第 ${i + 1} 列金額`} />
              <Segmented size="sm" value={r.unit} onChange={(u) => set(i, { unit: u })} options={[{ value: "base", label: p?.baseUnit ?? "包" }, { value: "pack", label: "箱" }]} />
              <Segmented size="sm" value={r.taxIncluded ? "inc" : "ex"} onChange={(x) => set(i, { taxIncluded: x === "inc" })} options={[{ value: "ex", label: "未稅" }, { value: "inc", label: "含稅" }]} />
              <button onClick={() => onChange(rows.filter((_, j) => j !== i))} className="grid h-8 w-7 place-items-center text-faint hover:text-bad" aria-label={`刪除合約價第 ${i + 1} 列`}>
                <Trash2 size={14} />
              </button>
            </div>
            {err ? (
              <div className="mt-1 text-[11.5px] text-bad" role="alert">
                {err}
              </div>
            ) : (
              p && cents !== null && <div className="mt-1 text-[11.5px] text-muted">系統計價 {perBase(p, cents)}（未稅）</div>
            )}
          </div>
        );
      })}
      <Button size="sm" variant="outline" onClick={() => onChange([...rows, { productId: "", amount: 0, unit: "base", taxIncluded: false }])}>
        <Plus size={13} /> 加入合約價品項
      </Button>
    </div>
  );
}
