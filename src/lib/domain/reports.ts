import { sum, type Cents } from "../money";
import { addDays, dayOfWeek } from "../time";
import { DOC_SIGN } from "./ar";
import type { ArDocument, Customer, InventoryLot, Product, ProductCategory, PurchaseOrder, StockAdjustment } from "./types";

/**
 * Business reporting over the ledger: revenue, cost and gross profit; stock movement (進銷存).
 * Pure functions over plain arrays so the same code can run against the demo store or rows from a database.
 * Revenue is recognised on delivery (AR charge issue date), ex-tax. Cost is standard cost × delivered base units;
 * revenue from products without a cost is reported separately, never guessed.
 */

export interface PnlLine {
  revenue: Cents;
  /** Revenue whose cost is known — the margin base. */
  costedRevenue: Cents;
  cost: Cents;
  /** costedRevenue − cost. */
  profit: Cents;
  /** Revenue from products without a standard cost. */
  uncostedRevenue: Cents;
  /** Credit notes and write-offs in the window (reduce revenue). */
  credits: Cents;
}

const empty = (): PnlLine => ({ revenue: 0, costedRevenue: 0, cost: 0, profit: 0, uncostedRevenue: 0, credits: 0 });

export function marginBp(l: Pick<PnlLine, "profit" | "costedRevenue">): number | null {
  return l.costedRevenue > 0 ? Math.round((l.profit * 10000) / l.costedRevenue) : null;
}

function itemBaseQty(p: Product, qty: number, unitLabel: string): number {
  return unitLabel === p.packUnit ? qty * p.packSize : qty;
}

interface ItemFact {
  doc: ArDocument;
  product: Product;
  qtyBase: number;
  revenue: Cents;
  cost: Cents | null;
}

/** Every delivered line in [from, to], with its revenue and cost. */
function itemFacts(docs: readonly ArDocument[], products: Map<string, Product>, from: string, to: string): ItemFact[] {
  const out: ItemFact[] = [];
  for (const d of docs) {
    if (d.type !== "charge" || d.issueDate < from || d.issueDate > to) continue;
    for (const it of d.items ?? []) {
      const product = products.get(it.productId);
      if (!product) continue;
      const qtyBase = itemBaseQty(product, it.qty, it.unitLabel);
      out.push({ doc: d, product, qtyBase, revenue: it.exTaxCents, cost: product.costCents === null ? null : qtyBase * product.costCents });
    }
  }
  return out;
}

function add(line: PnlLine, f: ItemFact) {
  line.revenue += f.revenue;
  if (f.cost === null) line.uncostedRevenue += f.revenue;
  else {
    line.costedRevenue += f.revenue;
    line.cost += f.cost;
    line.profit += f.revenue - f.cost;
  }
}

function credits(docs: readonly ArDocument[], from: string, to: string, customerId?: string): Cents {
  return sum(docs.filter((d) => DOC_SIGN[d.type] < 0 && d.issueDate >= from && d.issueDate <= to && (!customerId || d.customerId === customerId)).map((d) => d.exTaxCents));
}

function withCredits(line: PnlLine, c: Cents): PnlLine {
  // credits reduce revenue and, having no cost, profit too
  return { ...line, credits: c, revenue: line.revenue - c, costedRevenue: line.costedRevenue - c, profit: line.profit - c };
}

export interface PeriodPnl {
  from: string;
  to: string;
  total: PnlLine;
  byCustomer: (PnlLine & { customerId: string; deliveries: number })[];
  byProduct: (PnlLine & { productId: string; qtyBase: number })[];
  byCategory: (PnlLine & { category: ProductCategory })[];
}

export function periodPnl(docs: readonly ArDocument[], products: readonly Product[], from: string, to: string): PeriodPnl {
  const pm = new Map(products.map((p) => [p.id, p]));
  const facts = itemFacts(docs, pm, from, to);
  const total = empty();
  const cust = new Map<string, PnlLine & { customerId: string; deliveries: Set<string> }>();
  const prod = new Map<string, PnlLine & { productId: string; qtyBase: number }>();
  const cat = new Map<ProductCategory, PnlLine & { category: ProductCategory }>();
  for (const f of facts) {
    add(total, f);
    const c = cust.get(f.doc.customerId) ?? { ...empty(), customerId: f.doc.customerId, deliveries: new Set<string>() };
    add(c, f);
    c.deliveries.add(f.doc.id);
    cust.set(c.customerId, c);
    const p = prod.get(f.product.id) ?? { ...empty(), productId: f.product.id, qtyBase: 0 };
    add(p, f);
    p.qtyBase += f.qtyBase;
    prod.set(p.productId, p);
    const k = cat.get(f.product.category) ?? { ...empty(), category: f.product.category };
    add(k, f);
    cat.set(k.category, k);
  }
  const byRevenue = (a: PnlLine, b: PnlLine) => b.revenue - a.revenue;
  return {
    from,
    to,
    total: withCredits(total, credits(docs, from, to)),
    byCustomer: [...cust.values()].map(({ deliveries, ...c }) => ({ ...withCredits(c, credits(docs, from, to, c.customerId)), customerId: c.customerId, deliveries: deliveries.size })).sort(byRevenue),
    byProduct: [...prod.values()].sort(byRevenue),
    byCategory: [...cat.values()].sort(byRevenue),
  };
}

export interface WeekPnl extends PnlLine {
  weekStart: string;
  weekEnd: string;
  /** The last bucket ends today and is not a full week. */
  partial: boolean;
}

/** Monday-started weeks, oldest first, the last one ending at `today`. */
export function weeklyPnl(docs: readonly ArDocument[], products: readonly Product[], today: string, weeks: number): WeekPnl[] {
  const monday = addDays(today, -((dayOfWeek(today) + 6) % 7));
  return Array.from({ length: weeks }, (_, i) => {
    const weekStart = addDays(monday, -7 * (weeks - 1 - i));
    const fullEnd = addDays(weekStart, 6);
    const weekEnd = fullEnd > today ? today : fullEnd;
    return { ...periodPnl(docs, products, weekStart, weekEnd).total, weekStart, weekEnd, partial: fullEnd > today };
  });
}

export interface StockMovementRow {
  productId: string;
  /** Derived: closing − in + out − adjustments. Negative means the books and the shelf disagree. */
  openingQty: number;
  inQty: number;
  outQty: number;
  adjustQty: number;
  closingQty: number;
  /** Closing stock at standard cost; null when the product has no cost. */
  closingValue: Cents | null;
  /** Days of stock left at the period's average daily sales; null when nothing sold. */
  daysOfCover: number | null;
}

export interface StockMovement {
  from: string;
  to: string;
  rows: StockMovementRow[];
  inValue: Cents;
  outValue: Cents;
  closingValue: Cents;
  /** Products whose derived opening is negative — the stock ledger does not explain the shelf. */
  inconsistent: string[];
}

/**
 * 進銷存 for a window ending today. The demo keeps current on-hand per lot (no movement ledger),
 * so opening is derived backwards from today's stock; it is only meaningful for a window that ends today.
 */
export function stockMovement(input: { products: readonly Product[]; lots: readonly InventoryLot[]; purchaseOrders: readonly PurchaseOrder[]; adjustments: readonly StockAdjustment[]; docs: readonly ArDocument[]; from: string; to: string }): StockMovement {
  const { from, to } = input;
  const pm = new Map(input.products.map((p) => [p.id, p]));
  const out = new Map<string, number>();
  for (const f of itemFacts(input.docs, pm, from, to)) out.set(f.product.id, (out.get(f.product.id) ?? 0) + f.qtyBase);
  const inQ = new Map<string, number>();
  for (const po of input.purchaseOrders) {
    if (po.status !== "received" || !po.receivedAt || po.receivedAt < from || po.receivedAt > to) continue;
    for (const l of po.lines) inQ.set(l.productId, (inQ.get(l.productId) ?? 0) + l.qtyBase);
  }
  const lotProduct = new Map(input.lots.map((l) => [l.id, l.productId]));
  const adj = new Map<string, number>();
  for (const a of input.adjustments) {
    const d = a.at.slice(0, 10);
    if (d < from || d > to) continue;
    const pid = lotProduct.get(a.lotId);
    if (pid) adj.set(pid, (adj.get(pid) ?? 0) + a.delta);
  }
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400_000) + 1);
  const rows = input.products.map((p): StockMovementRow => {
    const closingQty = sum(input.lots.filter((l) => l.productId === p.id).map((l) => l.qtyOnHand));
    const inQty = inQ.get(p.id) ?? 0;
    const outQty = out.get(p.id) ?? 0;
    const adjustQty = adj.get(p.id) ?? 0;
    return {
      productId: p.id,
      openingQty: closingQty - inQty + outQty - adjustQty,
      inQty,
      outQty,
      adjustQty,
      closingQty,
      closingValue: p.costCents === null ? null : closingQty * p.costCents,
      daysOfCover: outQty > 0 ? Math.round((closingQty * days * 10) / outQty) / 10 : null,
    };
  });
  const value = (pid: string, q: number) => q * (pm.get(pid)?.costCents ?? 0);
  return {
    from,
    to,
    rows,
    inValue: sum(rows.map((r) => value(r.productId, r.inQty))),
    outValue: sum(rows.map((r) => value(r.productId, r.outQty))),
    closingValue: sum(rows.map((r) => r.closingValue ?? 0)),
    inconsistent: rows.filter((r) => r.openingQty < 0).map((r) => r.productId),
  };
}

/** Revenue change of one customer between two windows, in basis points; null when the earlier window is empty. */
export function changeBp(now: Cents, before: Cents): number | null {
  return before > 0 ? Math.round(((now - before) * 10000) / before) : null;
}

export type CustomerLike = Pick<Customer, "id" | "name">;
