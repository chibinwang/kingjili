import { AGING_LABEL } from "./labels";
import { changeBp, marginBp, type PnlLine } from "../domain/reports";
import { formatTWD, type Cents } from "../money";
import { addDays, formatDate, periodOf, periodRange } from "../time";
import type { InsightsDataSource } from "./dataSource";
import type { DatasetCharts, DatasetTable, DateRange, Fact, InsightsDataset, InsightsRequest, InsightsTopic, QueryLog, RangePreset } from "./types";

/* ───────── ranges ───────── */

export const PRESET_LABEL: Record<RangePreset, string> = { mtd: "本月至今", last4w: "近 4 週", lastMonth: "上個月", last3m: "近 3 個月" };

const span = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400_000);
const rangeLabel = (from: string, to: string) => `${formatDate(from, { year: true })}–${formatDate(to)}`;

export function resolveRange(preset: RangePreset, today: string): { range: DateRange; compare: DateRange } {
  const month = periodOf(today);
  const prevMonth = periodOf(addDays(periodRange(month).start, -1));
  let from: string;
  let to = today;
  let cFrom: string;
  let cTo: string;
  if (preset === "mtd") {
    from = periodRange(month).start;
    cFrom = periodRange(prevMonth).start;
    // same number of days into the previous month
    cTo = addDays(cFrom, span(from, to));
  } else if (preset === "lastMonth") {
    ({ start: from, end: to } = periodRange(prevMonth));
    ({ start: cFrom, end: cTo } = periodRange(periodOf(addDays(from, -1))));
  } else {
    from = preset === "last4w" ? addDays(today, -27) : periodRange(periodOf(addDays(periodRange(prevMonth).start, -1))).start;
    cTo = addDays(from, -1);
    cFrom = addDays(cTo, -span(from, to));
  }
  return {
    range: { from, to, label: `${PRESET_LABEL[preset]}（${rangeLabel(from, to)}）` },
    compare: { from: cFrom, to: cTo, label: rangeLabel(cFrom, cTo) },
  };
}

export function buildRequest(topic: InsightsTopic, preset: RangePreset, today: string, question?: string): InsightsRequest {
  const { range, compare } = resolveRange(preset, today);
  return { topic, preset, range, compare, question: question?.trim() || undefined };
}

/* ───────── formatting ───────── */

const pct = (bp: number) => `${(bp / 100).toFixed(1)}%`;
const signedPct = (bp: number) => `${bp > 0 ? "+" : bp < 0 ? "−" : "±"}${(Math.abs(bp) / 100).toFixed(1)}%`;
const pp = (bp: number) => `${bp > 0 ? "+" : bp < 0 ? "−" : "±"}${(Math.abs(bp) / 100).toFixed(1)} 個百分點`;
const CATEGORY_KEY: Record<string, string> = { 冷凍炸物: "fried", 蔬食: "veg", 調理品: "prepared" };

class Facts {
  list: Fact[] = [];
  twd(id: string, label: string, cents: Cents) {
    this.list.push({ id, label, value: cents, unit: "twd", display: formatTWD(cents) });
  }
  pct(id: string, label: string, bp: number | null, kind: "level" | "change" | "pp" = "level") {
    if (bp === null) return;
    this.list.push({ id, label, value: bp / 100, unit: "pct", display: kind === "level" ? pct(bp) : kind === "change" ? signedPct(bp) : pp(bp) });
  }
  qty(id: string, label: string, qty: number, unit: string) {
    this.list.push({ id, label, value: qty, unit: "qty", display: `${qty.toLocaleString()} ${unit}` });
  }
  count(id: string, label: string, n: number, unit: string) {
    this.list.push({ id, label, value: n, unit: "count", display: `${n} ${unit}` });
  }
  days(id: string, label: string, d: number | null) {
    if (d === null) return;
    this.list.push({ id, label, value: d, unit: "days", display: `${d} 天` });
  }
}

/* ───────── dataset ───────── */

export interface BuildOptions {
  asOf: string;
  /** Whether the viewer may see cost, margin and below-cost data (view.margin). */
  includesMargin: boolean;
}

export async function buildDataset(source: InsightsDataSource, request: InsightsRequest, opts: BuildOptions): Promise<InsightsDataset> {
  const queries: QueryLog[] = [];
  const timed = async <T,>(name: string, run: () => Promise<T>, rows: (v: T) => number): Promise<T> => {
    const t0 = performance.now();
    const v = await run();
    queries.push({ name, source: source.label, ms: Math.round(performance.now() - t0), rows: rows(v) });
    return v;
  };
  const { range } = request;
  const stockFrom = range.from;
  const [dir, now, prevRaw, weekly, stock, ar, agreements] = await Promise.all([
    timed("客戶與品項目錄", () => source.directory(), (v) => v.customers.length + v.products.length),
    timed(`損益 ${range.label}`, () => source.periodPnl(range.from, range.to), (v) => v.byProduct.length + v.byCustomer.length),
    request.compare ? timed(`損益 對照 ${request.compare.label}`, () => source.periodPnl(request.compare!.from, request.compare!.to), (v) => v.byProduct.length + v.byCustomer.length) : Promise.resolve(null),
    timed("每週損益（12 週）", () => source.weeklyPnl(opts.asOf, 12), (v) => v.length),
    timed("進銷存", () => source.stockMovement(stockFrom, opts.asOf), (v) => v.rows.length),
    timed("應收帳齡", () => source.receivables(opts.asOf), (v) => v.length),
    timed("合約價", () => source.agreements(opts.asOf), (v) => v.length),
  ]);
  // no revenue in the comparison window = no history to compare against (e.g. before the data starts)
  const prev = prevRaw && prevRaw.total.revenue > 0 ? prevRaw : null;
  const m = opts.includesMargin;
  const cName = new Map(dir.customers.map((c) => [c.id, c.name]));
  const prod = new Map(dir.products.map((p) => [p.id, p]));
  const f = new Facts();
  const dataNotes = ["營收依送達日認列、未稅；送貨單、發票、收款是三件不同的事。"];
  if (!prev) dataNotes.push(request.compare ? `對照期間（${request.compare.label}）沒有資料，本報告不做期間比較。` : "本報告不做期間比較。");

  /* totals */
  const T = now.total;
  const deliveries = now.byCustomer.reduce((a, c) => a + c.deliveries, 0);
  f.twd("rev.now", "期間營收（未稅）", T.revenue);
  if (prev) {
    f.twd("rev.prev", "對照期間營收", prev.total.revenue);
    f.pct("rev.change", "營收變化", changeBp(T.revenue, prev.total.revenue), "change");
  }
  f.count("deliveries.now", "出貨趟數", deliveries, "趟");
  if (deliveries) f.twd("ticket.avg", "平均每趟營收", Math.round(T.revenue / deliveries / 100) * 100);
  f.count("customers.active", "有出貨的客戶數", now.byCustomer.length, "家");
  if (T.uncostedRevenue) f.twd("uncosted.now", "缺成本品項營收", T.uncostedRevenue);
  if (T.credits) f.twd("credits.now", "折讓／沖銷", T.credits);
  if (m) {
    f.twd("gp.now", "期間毛利（初估）", T.profit);
    f.pct("gm.now", "毛利率（初估）", marginBp(T));
    if (prev) {
      f.twd("gp.prev", "對照期間毛利", prev.total.profit);
      const a = marginBp(T);
      const b = marginBp(prev.total);
      if (a !== null && b !== null) f.pct("gm.change", "毛利率變化", a - b, "pp");
    }
    dataNotes.push("毛利依標準成本初估；尚無成本的品項不計入毛利率，另列「缺成本品項營收」。");
  } else {
    dataNotes.push("依你的權限，本報告不含成本、毛利與低於成本的合約價。");
  }

  /* customers */
  const sorted = [...now.byCustomer].sort((a, b) => b.revenue - a.revenue);
  if (T.revenue > 0 && sorted.length) {
    f.pct("share.top1", `最大客戶（${cName.get(sorted[0].customerId)}）營收占比`, Math.round((sorted[0].revenue * 10000) / T.revenue));
    f.pct("share.top3", "前三大客戶營收占比", Math.round((sorted.slice(0, 3).reduce((a, c) => a + c.revenue, 0) * 10000) / T.revenue));
  }
  const prevCust = new Map(prev?.byCustomer.map((c) => [c.customerId, c]) ?? []);
  const agr = new Map(agreements.map((a) => [a.customerId, a]));
  const arMap = new Map(ar.map((r) => [r.customerId, r]));
  for (const c of sorted) {
    const n = cName.get(c.customerId) ?? c.customerId;
    const k = `cust.${c.customerId}`;
    f.twd(`${k}.rev`, `${n} 營收`, c.revenue);
    if (T.revenue) f.pct(`${k}.share`, `${n} 營收占比`, Math.round((c.revenue * 10000) / T.revenue));
    const p = prevCust.get(c.customerId);
    if (p) f.pct(`${k}.change`, `${n} 營收變化`, changeBp(c.revenue, p.revenue), "change");
    f.count(`${k}.deliveries`, `${n} 出貨趟數`, c.deliveries, "趟");
    if (m) {
      f.twd(`${k}.gp`, `${n} 毛利`, c.profit);
      f.pct(`${k}.gm`, `${n} 毛利率`, marginBp(c));
    }
  }
  // customers who bought in the comparison window but not now
  for (const p of prev?.byCustomer ?? []) {
    if (now.byCustomer.some((c) => c.customerId === p.customerId)) continue;
    f.twd(`cust.${p.customerId}.rev_prev_only`, `${cName.get(p.customerId)} 對照期間營收（本期無出貨）`, p.revenue);
  }

  /* agreements (合約價) */
  for (const a of agreements) {
    if (!a.count) continue;
    const n = cName.get(a.customerId);
    f.count(`price.${a.customerId}.count`, `${n} 合約價品項數`, a.count, "項");
    f.pct(`price.${a.customerId}.discount`, `${n} 合約價平均折扣（相對等級價）`, a.avgDiscountBp);
    if (m)
      for (const b of a.belowCost) {
        const p = prod.get(b.productId)!;
        f.twd(`price.${a.customerId}.${b.productId}.price`, `${n} ${p.name} 合約價（每${p.baseUnit}）`, b.cents);
        f.twd(`price.${a.customerId}.${b.productId}.cost`, `${p.name} 標準成本（每${p.baseUnit}）`, b.costCents);
      }
  }

  /* products & categories */
  const prevProd = new Map(prev?.byProduct.map((p) => [p.productId, p]) ?? []);
  for (const p of now.byProduct) {
    const info = prod.get(p.productId)!;
    const k = `prod.${p.productId}`;
    f.twd(`${k}.rev`, `${info.name} 營收`, p.revenue);
    f.qty(`${k}.qty`, `${info.name} 銷量`, p.qtyBase, info.baseUnit);
    const q = prevProd.get(p.productId);
    if (q) f.pct(`${k}.change`, `${info.name} 營收變化`, changeBp(p.revenue, q.revenue), "change");
    if (m) f.pct(`${k}.gm`, `${info.name} 毛利率`, marginBp(p));
  }
  for (const c of now.byCategory) {
    const k = `cat.${CATEGORY_KEY[c.category] ?? c.category}`;
    f.twd(`${k}.rev`, `${c.category} 營收`, c.revenue);
    if (T.revenue) f.pct(`${k}.share`, `${c.category} 營收占比`, Math.round((c.revenue * 10000) / (T.revenue + T.credits)));
    if (m) f.pct(`${k}.gm`, `${c.category} 毛利率`, marginBp(c));
  }

  /* stock (進銷存) */
  for (const r of stock.rows) {
    const info = prod.get(r.productId)!;
    const k = `stock.${r.productId}`;
    f.qty(`${k}.closing`, `${info.name} 目前庫存`, r.closingQty, info.baseUnit);
    f.qty(`${k}.out`, `${info.name} 期間出貨量`, r.outQty, info.baseUnit);
    if (r.inQty) f.qty(`${k}.in`, `${info.name} 期間進貨量`, r.inQty, info.baseUnit);
    f.days(`${k}.cover`, `${info.name} 可用天數（依期間日均出貨）`, r.daysOfCover);
  }
  if (m) {
    f.twd("stock.closing_value", "目前庫存成本", stock.closingValue);
    f.twd("stock.in_value", "期間進貨成本", stock.inValue);
    f.twd("stock.out_value", "期間出貨成本", stock.outValue);
  }
  dataNotes.push(`進銷存期間為 ${rangeLabel(stockFrom, opts.asOf)}；示範資料只保存各批現量，期初由今日庫存倒推，不是逐筆庫存帳。`);
  if (stock.inconsistent.length) {
    f.count("stock.inconsistent", "期初倒推為負的品項數（帳實不符）", stock.inconsistent.length, "項");
    dataNotes.push(`${stock.inconsistent.map((id) => prod.get(id)?.name).join("、")} 的期初倒推為負，帳面與實際庫存不一致，相關數字僅供參考。`);
  }

  /* receivables */
  const sumAr = (fn: (r: (typeof ar)[number]) => number) => ar.reduce((a, r) => a + fn(r), 0);
  f.twd("ar.open", "應收未收", sumAr((r) => Math.max(0, r.balance)));
  f.twd("ar.overdue", "逾期未收", sumAr((r) => r.overdue));
  f.count("ar.overdue_customers", "逾期客戶數", ar.filter((r) => r.overdue > 0).length, "家");
  for (const b of ["1-30", "31-60", "61+"] as const) f.twd(`ar.bucket.${b}`, `逾期 ${b} 天`, sumAr((r) => r.buckets[b]));
  for (const r of ar) {
    if (r.overdue > 0) f.twd(`ar.${r.customerId}.overdue`, `${cName.get(r.customerId)} 逾期`, r.overdue);
    if (r.balance > 0) f.twd(`ar.${r.customerId}.balance`, `${cName.get(r.customerId)} 應收餘額`, r.balance);
    if (r.balance < 0) f.twd(`ar.${r.customerId}.credit`, `${cName.get(r.customerId)} 溢收／預收`, -r.balance);
  }

  /* tables (display strings only; rendered as-is) */
  const rows = (o: Record<string, string | undefined | false>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== false)) as Record<string, string>;
  const marginText = (l: PnlLine) => {
    const bp = marginBp(l);
    return bp === null ? "缺成本" : pct(bp);
  };
  const tables: DatasetTable[] = [
    {
      id: "customers",
      title: "客戶營收與獲利",
      columns: [{ key: "name", label: "客戶" }, { key: "rev", label: "營收", align: "right" }, { key: "change", label: "變化", align: "right" }, ...(m ? [{ key: "gm", label: "毛利率", align: "right" as const }] : []), { key: "price", label: "合約價" }, { key: "overdue", label: "逾期", align: "right" }],
      rows: sorted.map((c) => {
        const p = prevCust.get(c.customerId);
        const a = agr.get(c.customerId);
        const bp = p ? changeBp(c.revenue, p.revenue) : null;
        return rows({ name: cName.get(c.customerId), rev: formatTWD(c.revenue), change: bp === null ? "—" : signedPct(bp), gm: m && marginText(c), price: a?.count ? `${a.count} 項・平均 −${pct(a.avgDiscountBp)}` : "—", overdue: arMap.get(c.customerId)?.overdue ? formatTWD(arMap.get(c.customerId)!.overdue) : "—" });
      }),
    },
    {
      id: "products",
      title: "品項銷售與毛利",
      columns: [{ key: "name", label: "品項" }, { key: "qty", label: "銷量", align: "right" }, { key: "rev", label: "營收", align: "right" }, { key: "change", label: "變化", align: "right" }, ...(m ? [{ key: "gm", label: "毛利率", align: "right" as const }] : [])],
      rows: now.byProduct.map((p) => {
        const info = prod.get(p.productId)!;
        const q = prevProd.get(p.productId);
        const bp = q ? changeBp(p.revenue, q.revenue) : null;
        return rows({ name: info.name, qty: `${p.qtyBase.toLocaleString()} ${info.baseUnit}`, rev: formatTWD(p.revenue), change: bp === null ? "—" : signedPct(bp), gm: m && marginText(p) });
      }),
    },
    {
      id: "stock",
      title: `進銷存（${rangeLabel(stockFrom, opts.asOf)}）`,
      columns: [{ key: "name", label: "品項" }, { key: "open", label: "期初", align: "right" }, { key: "in", label: "進", align: "right" }, { key: "out", label: "銷", align: "right" }, { key: "adj", label: "調整", align: "right" }, { key: "close", label: "期末", align: "right" }, { key: "cover", label: "可用天數", align: "right" }],
      rows: stock.rows.map((r) => {
        const u = prod.get(r.productId)!.baseUnit;
        return rows({ name: prod.get(r.productId)!.name, open: `${r.openingQty} ${u}`, in: r.inQty ? `${r.inQty}` : "—", out: `${r.outQty}`, adj: r.adjustQty ? `${r.adjustQty > 0 ? "+" : ""}${r.adjustQty}` : "—", close: `${r.closingQty} ${u}`, cover: r.daysOfCover === null ? "—" : `${r.daysOfCover} 天` });
      }),
    },
    {
      id: "receivables",
      title: "應收帳款",
      columns: [{ key: "name", label: "客戶" }, { key: "balance", label: "餘額", align: "right" }, { key: "overdue", label: "逾期", align: "right" }, { key: "oldest", label: "最早到期" }],
      rows: [...ar]
        .filter((r) => r.balance !== 0)
        .sort((a, b) => b.overdue - a.overdue || b.balance - a.balance)
        .map((r) => rows({ name: cName.get(r.customerId), balance: formatTWD(r.balance), overdue: r.overdue ? formatTWD(r.overdue) : "—", oldest: r.oldestDue ? formatDate(r.oldestDue, { year: true }) : "—" })),
    },
    {
      id: "agreements",
      title: "合約價",
      columns: [{ key: "name", label: "客戶" }, { key: "count", label: "品項數", align: "right" }, { key: "discount", label: "平均折扣", align: "right" }, ...(m ? [{ key: "below", label: "低於成本" }] : [])],
      rows: agreements
        .filter((a) => a.count)
        .map((a) => rows({ name: cName.get(a.customerId), count: `${a.count}`, discount: `−${pct(a.avgDiscountBp)}`, below: m && (a.belowCost.length ? a.belowCost.map((b) => `${prod.get(b.productId)!.name} ${formatTWD(b.cents)}（成本 ${formatTWD(b.costCents)}）`).join("、") : "—") })),
    },
  ];

  const charts: DatasetCharts = {
    weekly: weekly.map((w) => ({ weekStart: w.weekStart, weekEnd: w.weekEnd, partial: w.partial, revenue: w.revenue, cost: m ? w.cost : 0, profit: m ? w.profit : 0, uncosted: m ? w.uncostedRevenue : 0 })),
    customerRevenue: sorted.slice(0, 8).map((c) => ({ id: c.customerId, name: cName.get(c.customerId) ?? c.customerId, revenue: c.revenue, marginBp: m ? marginBp(c) : null, contract: !!agr.get(c.customerId)?.count })),
    categoryMix: now.byCategory.map((c) => ({ category: c.category, revenue: c.revenue })),
    stockCover: stock.rows
      .map((r) => ({ id: r.productId, name: prod.get(r.productId)!.name, days: r.daysOfCover, closingQty: r.closingQty, unit: prod.get(r.productId)!.baseUnit }))
      .sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9)),
    arAging: (["1-30", "31-60", "61+"] as const).map((b) => ({ bucket: AGING_LABEL[b], cents: sumAr((r) => r.buckets[b]) })),
  };

  return {
    request,
    asOf: opts.asOf,
    includesMargin: m,
    facts: f.list,
    tables,
    charts,
    entities: { customers: dir.customers.map(({ id, name }) => ({ id, name })), products: dir.products.map(({ id, name }) => ({ id, name })) },
    dataNotes,
    queries,
  };
}

export const factMap = (d: InsightsDataset) => new Map(d.facts.map((x) => [x.id, x]));
