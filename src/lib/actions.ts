import { appliedFrom, isReversed, paymentUnapplied, planAllocation, planReversal } from "./domain/ar";
import type { AiTask } from "./domain/ai";
import { releaseReservations, reserveOrder } from "./domain/inventory";
import { preflightInvoice } from "./domain/invoices";
import { billableLines, linesTotal } from "./domain/collections";
import { quoteToBaseExTax, resolvePrice } from "./domain/pricing";
import { parseLineOrder } from "./domain/lineParser";
import { canTransition, findDuplicate, findLikelyDuplicate, orderTotals, toBaseQty, unitLabel } from "./domain/orders";
import { bestInsertion, evaluatePlan, ROUTING, type RoutingContext } from "./domain/routing";
import { customerSchema, districtCentre, orderSchema, productSchema, splitAliases, supplierSchema, type CustomerInput, type OrderInput, type ProductInput, type SupplierInput } from "./domain/forms";
import { productAliases } from "./domain/lineParser";
import { buildStatement, snapshotHash } from "./domain/statements";
import { supplierMessage } from "./domain/procurement";
import type {
  ActionEvent,
  Customer,
  Supplier,
  VehicleId,
  AgentMemory,
  ArDocument,
  CustomerNote,
  Product,
  DemoUser,
  OrderLine,
  OrderState,
  Payment,
  PurchaseOrder,
  RouteStop,
  SalesOrder,
  Statement,
  TaxInvoice,
} from "./domain/types";
import { lineAmount, sum, taxOnExclusive, twd, type Cents } from "./money";
import { can, ROLE_LABEL, rolesFor, type Permission } from "./permissions";
import { addDays, at, DEMO_TODAY, periodOf, periodRange } from "./time";
import type { Db } from "./db";

/**
 * Every state change goes through an action: validate → mutate a copy → append an ActionEvent.
 * Actions are pure (db in, db out) so they are unit-testable and replaceable by API calls later.
 */
export class ActionError extends Error {}

export interface Actor {
  id: string;
  name: string;
  type: "user" | "agent";
  user?: DemoUser;
}

export interface ActCtx {
  actor: Actor;
  now: string;
  correlationId?: string;
  approvedBy?: string;
}

type ArrayKeys = { [K in keyof Db]: Db[K] extends { id: string }[] ? K : never }[keyof Db];
type Elem<K extends ArrayKeys> = Db[K] extends (infer T)[] ? T : never;

class Tx {
  db: Db;
  private touched = new Set<string>();
  correlationId: string;
  constructor(
    base: Db,
    public ctx: ActCtx,
  ) {
    this.db = { ...base };
    this.correlationId = ctx.correlationId ?? `cor-${this.nextNum("cor")}`;
  }
  private arr<K extends ArrayKeys>(k: K): Elem<K>[] {
    if (!this.touched.has(k)) {
      (this.db[k] as unknown as Elem<K>[]) = [...(this.db[k] as unknown as Elem<K>[])];
      this.touched.add(k);
    }
    return this.db[k] as unknown as Elem<K>[];
  }
  nextNum(key: string): number {
    if (!this.touched.has("counters")) {
      this.db.counters = { ...this.db.counters };
      this.touched.add("counters");
    }
    this.db.counters[key] = (this.db.counters[key] ?? 0) + 1;
    return this.db.counters[key];
  }
  insert<K extends ArrayKeys>(k: K, item: Elem<K>) {
    this.arr(k).push(item);
    return item;
  }
  get<K extends ArrayKeys>(k: K, id: string): Elem<K> {
    const found = (this.db[k] as unknown as { id: string }[]).find((x) => x.id === id);
    if (!found) throw new ActionError(`找不到 ${String(k)} ${id}`);
    return found as Elem<K>;
  }
  patch<K extends ArrayKeys>(k: K, id: string, patch: Partial<Elem<K>>): Elem<K> {
    const a = this.arr(k) as unknown as { id: string }[];
    const i = a.findIndex((x) => x.id === id);
    if (i < 0) throw new ActionError(`找不到 ${String(k)} ${id}`);
    a[i] = { ...a[i], ...patch };
    return a[i] as Elem<K>;
  }
  set<K extends keyof Db>(k: K, value: Db[K]) {
    this.db[k] = value;
    this.touched.add(k);
  }
  event(e: Omit<ActionEvent, "id" | "seq" | "occurredAt" | "actorType" | "actorId" | "actorName" | "correlationId" | "status"> & { status?: ActionEvent["status"]; actorOverride?: Actor }) {
    const actor = e.actorOverride ?? this.ctx.actor;
    const seq = this.db.events.length + 1;
    const { actorOverride: _o, ...rest } = e;
    this.insert("events", {
      ...rest,
      id: `ev-${seq}`,
      seq,
      occurredAt: this.ctx.now,
      actorType: actor.type,
      actorId: actor.id,
      actorName: actor.name,
      correlationId: this.correlationId,
      approvedBy: e.approvedBy ?? this.ctx.approvedBy,
      status: e.status ?? "committed",
    });
  }
}

function require(ctx: ActCtx, permission: Permission) {
  if (ctx.actor.type === "agent") throw new ActionError("AI 代理不可直接執行此動作，需由人員核准");
  const role = ctx.actor.user?.role;
  if (!role || !can(role, permission)) {
    throw new ActionError(`權限不足：此動作需 ${rolesFor(permission).map((r) => ROLE_LABEL[r]).join("／")} 角色`);
  }
}

const today = DEMO_TODAY;
const ymd = (d: string) => d.slice(2).replaceAll("-", "");

export function routingContext(db: Db): RoutingContext {
  return {
    customers: new Map(db.customers.map((c) => [c.id, c])),
    orders: new Map(db.orders.map((o) => [o.id, o])),
    products: new Map(db.products.map((p) => [p.id, p])),
    vehicles: new Map(db.vehicles.map((v) => [v.id, v])),
  };
}

export function activePlan(db: Db, date = today) {
  return db.routePlans.find((p) => p.date === date && p.status === "active");
}

// ───────────────────────── Orders ─────────────────────────

export function draftFromLine(db: Db, ctx: ActCtx, messageId: string, customerHint?: string): Db {
  const tx = new Tx(db, ctx);
  const msg = tx.get("inbox", messageId);
  if (msg.status !== "new") throw new ActionError("此訊息已處理");
  const dupe = db.orders.find((o) => o.externalId === `LINE-${msg.webhookEventId}`);
  if (dupe) throw new ActionError(`重複 webhook 事件，已存在訂單 ${dupe.no}`);
  const parsed = parseLineOrder(customerHint ? `${customerHint} ${msg.text}` : msg.text, db.products, db.customers, msg.lineUserId);
  const customer = db.customers.find((c) => c.id === parsed.customerId);
  const n = tx.nextNum(`so-${ymd(today)}`);
  const orderId = `o-line-${msg.id}`;
  const deliveryDate = addDays(today, parsed.deliveryOffsetDays);
  const lines: OrderLine[] = parsed.lines.map((l, i) => {
    const p = db.products.find((x) => x.id === l.productId)!;
    const unit = l.unit ?? "base";
    const qty = l.qty ?? 0;
    return {
      id: `${orderId}-L${i + 1}`,
      productId: p.id,
      qty,
      unit,
      qtyBase: toBaseQty(p, qty, unit),
      unitPriceExTaxCents: resolvePrice(db.customerPrices, customer, p, deliveryDate).cents,
      taxRateBp: 500,
    };
  });
  const order: SalesOrder = {
    id: orderId,
    no: `SO-${ymd(today)}-L${String(n).padStart(2, "0")}`,
    customerId: parsed.customerId ?? "",
    source: "LINE",
    externalId: `LINE-${msg.webhookEventId}`,
    orderAt: msg.receivedAt,
    deliveryDate,
    state: "Draft",
    lines,
    rawText: msg.text,
    aiExtracted: true,
    issues: parsed.issues,
    createdBy: "agent",
  };
  tx.insert("orders", order);
  tx.patch("inbox", msg.id, { status: "drafted", orderId });
  tx.event({
    actorOverride: { id: "agent", name: "Everyse AI", type: "agent" },
    feature: "orders",
    entityType: "SalesOrder",
    entityId: orderId,
    action: "draft_from_line",
    summary: `由 LINE 訊息建立草稿 ${order.no}（${parsed.lines.length} 品項，${parsed.issues.length} 項待確認）`,
    after: lines.map((l) => `${l.productId}×${l.qty}${l.unit === "pack" ? "箱" : "包"}`).join("、"),
    status: "proposed",
  });
  return tx.db;
}

export function updateDraftLine(db: Db, ctx: ActCtx, orderId: string, index: number, patch: { qty?: number; unit?: "base" | "pack"; productId?: string }): Db {
  require(ctx, "order.validate");
  const tx = new Tx(db, ctx);
  const o = tx.get("orders", orderId);
  if (o.state !== "Draft") throw new ActionError("僅草稿可修改");
  const customer = db.customers.find((c) => c.id === o.customerId);
  const lines = o.lines.map((l, i) => {
    if (i !== index) return l;
    const productId = patch.productId ?? l.productId;
    const p = db.products.find((x) => x.id === productId)!;
    const qty = patch.qty ?? l.qty;
    const unit = patch.unit ?? l.unit;
    if (!Number.isInteger(qty) || qty < 0) throw new ActionError("數量需為正整數");
    return { ...l, productId, qty, unit, qtyBase: toBaseQty(p, qty, unit), unitPriceExTaxCents: resolvePrice(db.customerPrices, customer, p, o.deliveryDate).cents };
  });
  const issues = (o.issues ?? []).map((iss) =>
    iss.lineIndex === index && ((iss.field === "unit" && patch.unit) || (iss.field === "qty" && patch.qty !== undefined)) ? { ...iss, resolved: true } : iss,
  );
  tx.patch("orders", orderId, { lines, issues });
  return tx.db;
}

export function resolveDraftIssue(db: Db, ctx: ActCtx, orderId: string, issueIndex: number, patch?: { customerId?: string }): Db {
  require(ctx, "order.validate");
  const tx = new Tx(db, ctx);
  const o = tx.get("orders", orderId);
  const issues = (o.issues ?? []).map((iss, i) => (i === issueIndex ? { ...iss, resolved: true } : iss));
  const upd: Partial<SalesOrder> = { issues };
  if (patch?.customerId) {
    const c = db.customers.find((x) => x.id === patch.customerId)!;
    upd.customerId = c.id;
    upd.lines = o.lines.map((l) => ({ ...l, unitPriceExTaxCents: resolvePrice(db.customerPrices, c, db.products.find((p) => p.id === l.productId)!, o.deliveryDate).cents }));
  }
  tx.patch("orders", orderId, upd);
  return tx.db;
}

export function validateOrder(db: Db, ctx: ActCtx, orderId: string): Db {
  require(ctx, "order.validate");
  const tx = new Tx(db, ctx);
  const o = tx.get("orders", orderId);
  if (!canTransition(o.state, "Validated")) throw new ActionError(`訂單狀態 ${o.state} 不可確認`);
  const open = (o.issues ?? []).filter((i) => !i.resolved);
  if (open.length) throw new ActionError(`尚有 ${open.length} 項需人工確認：${open[0].message}`);
  if (!o.customerId) throw new ActionError("未指定客戶");
  if (o.lines.some((l) => l.qtyBase <= 0)) throw new ActionError("有品項數量為 0");
  const others = db.orders.filter((x) => x.id !== o.id);
  const dup = findDuplicate(others, o.source, o.externalId) ?? findLikelyDuplicate(others, o);
  if (dup) throw new ActionError(`疑似重複訂單：與 ${dup.no} 內容相同`);
  const res = reserveOrder(o, db.lots, today, () => `rs-${tx.nextNum("rs")}`);
  if (!res.ok) {
    const names = res.shortages.map((s) => `${db.products.find((p) => p.id === s.productId)?.name} 缺 ${s.shortBy}`).join("、");
    tx.patch("orders", orderId, { state: "Validated" });
    tx.event({ feature: "orders", entityType: "SalesOrder", entityId: orderId, action: "validate", summary: `確認 ${o.no}，但庫存不足：${names}`, before: "Draft", after: "Validated" });
    return tx.db;
  }
  tx.set("lots", res.lots);
  tx.set("reservations", [...db.reservations, ...res.reservations]);
  tx.patch("orders", orderId, { state: "Reserved" });
  const totals = orderTotals(o);
  tx.event({
    feature: "orders",
    entityType: "SalesOrder",
    entityId: orderId,
    action: "validate",
    summary: `確認 ${o.no} 並以 FEFO 保留庫存（含稅 NT$${(totals.total / 100).toLocaleString()}）`,
    before: o.state,
    after: "Reserved",
    approvedBy: ctx.actor.id,
  });
  return tx.db;
}

export function cancelOrder(db: Db, ctx: ActCtx, orderId: string, reason: string): Db {
  require(ctx, "order.cancel");
  if (!reason.trim()) throw new ActionError("取消需填寫原因");
  const tx = new Tx(db, ctx);
  const o = tx.get("orders", orderId);
  if (!canTransition(o.state, "Cancelled")) throw new ActionError("此狀態不可取消");
  const mine = db.reservations.filter((r) => r.orderId === orderId);
  tx.set("lots", releaseReservations(db.lots, mine));
  tx.set("reservations", db.reservations.filter((r) => r.orderId !== orderId));
  tx.patch("orders", orderId, { state: "Cancelled" });
  const plan = activePlan(db);
  if (plan?.stops.some((s) => s.orderId === orderId)) {
    const stops = plan.stops.filter((s) => s.orderId !== orderId);
    tx.patch("routePlans", plan.id, { status: "superseded" });
    tx.insert("routePlans", { ...plan, id: `rp-${today}-v${plan.version + 1}`, version: plan.version + 1, status: "active", stops: resequence(stops), createdAt: ctx.now, createdBy: ctx.actor.id, reason: `取消 ${o.no}` });
  }
  tx.event({ feature: "orders", entityType: "SalesOrder", entityId: orderId, action: "cancel", summary: `取消 ${o.no}，釋放保留庫存`, reason, before: o.state, after: "Cancelled" });
  return tx.db;
}

function resequence(stops: RouteStop[]): RouteStop[] {
  return (["A", "B"] as const).flatMap((v) =>
    stops
      .filter((s) => s.vehicleId === v)
      .sort((a, b) => a.sequence - b.sequence)
      .map((s, i) => ({ ...s, sequence: i + 1 })),
  );
}

// ───────────────────────── Dispatch ─────────────────────────

/** Apply a new assignment atomically: new route version, deliveries re-pointed, pick lists derive from it. */
export function applyRoutePlan(db: Db, ctx: ActCtx, expectedVersion: number, stops: RouteStop[], reason: string, taskId?: string): Db {
  require(ctx, "route.approve");
  const plan = activePlan(db);
  if (!plan) throw new ActionError("今日沒有路線");
  if (plan.version !== expectedVersion) throw new ActionError(`路線已被更新為 v${plan.version}，請重新預覽（樂觀鎖）`);
  const evaln = evaluatePlan(stops, routingContext(db));
  if (!evaln.feasible) throw new ActionError("新路線未通過硬性限制，無法套用");
  const tx = new Tx(db, ctx);
  tx.patch("routePlans", plan.id, { status: "superseded" });
  const version = plan.version + 1;
  tx.insert("routePlans", { id: `rp-${today}-v${version}`, date: today, version, status: "active", stops, createdAt: ctx.now, createdBy: ctx.actor.id, approvedBy: ctx.actor.id, reason });
  const moved: string[] = [];
  for (const s of stops) {
    const d = db.deliveries.find((x) => x.id === s.deliveryId)!;
    if (d.vehicleId !== s.vehicleId) {
      tx.patch("deliveries", d.id, { vehicleId: s.vehicleId });
      moved.push(`${db.customers.find((c) => c.id === s.customerId)?.name} ${d.vehicleId}→${s.vehicleId}`);
    }
  }
  if (taskId) tx.patch("aiTasks", taskId, { status: "committed", resolvedBy: ctx.actor.id, resolvedAt: ctx.now, resultNote: `路線 v${version} 已套用` });
  tx.event({
    feature: "dispatch",
    entityType: "RoutePlan",
    entityId: `rp-${today}-v${version}`,
    action: "approve_reassignment",
    summary: `核准路線 v${plan.version} → v${version}：${moved.join("、") || "調整站序"}；理貨單同步更新`,
    before: `v${plan.version}`,
    after: `v${version}`,
    reason,
    approvalId: taskId,
    approvedBy: ctx.actor.id,
  });
  return tx.db;
}

// ───────────────────────── Picking & delivery ─────────────────────────

export function confirmPick(db: Db, ctx: ActCtx, orderLineIds: string[], qtyOverride?: number, flag?: string): Db {
  require(ctx, "pick.confirm");
  const plan = activePlan(db);
  if (!plan) throw new ActionError("今日沒有路線");
  const tx = new Tx(db, ctx);
  const confs = { ...db.pickConfirmations };
  for (const lineId of orderLineIds) {
    const order = db.orders.find((o) => o.lines.some((l) => l.id === lineId))!;
    const line = order.lines.find((l) => l.id === lineId)!;
    const stop = plan.stops.find((s) => s.orderId === order.id)!;
    confs[lineId] = { qtyBase: qtyOverride ?? line.qtyBase, at: ctx.now, by: ctx.actor.id, routeVersion: plan.version, vehicleAtPick: stop.vehicleId, flagged: flag };
    if (order.state === "Reserved") tx.patch("orders", order.id, { state: "Picking" });
  }
  tx.set("pickConfirmations", confs);
  tx.event({
    feature: "picking",
    entityType: "PickLine",
    entityId: orderLineIds[0],
    action: flag ? "flag_discrepancy" : "confirm",
    summary: flag ? `揀貨差異：${flag}` : `確認揀貨 ${orderLineIds.length} 行`,
    after: qtyOverride !== undefined ? `實揀 ${qtyOverride}` : undefined,
  });
  return tx.db;
}

export function undoPick(db: Db, ctx: ActCtx, orderLineId: string): Db {
  require(ctx, "pick.confirm");
  const tx = new Tx(db, ctx);
  const confs = { ...db.pickConfirmations };
  delete confs[orderLineId];
  tx.set("pickConfirmations", confs);
  tx.event({ feature: "picking", entityType: "PickLine", entityId: orderLineId, action: "undo", summary: "取消揀貨確認" });
  return tx.db;
}

export interface CollectionInput {
  method: Payment["method"];
  amountCents: Cents;
  proofRef?: string;
  note?: string;
}

/**
 * Driver completes a delivery: stock leaves, AR charge is created from the delivery note,
 * and (optionally) a collection is recorded. Collection ≠ bank-settled: cash stays "collected".
 */
export function completeDelivery(db: Db, ctx: ActCtx, deliveryId: string, collection?: CollectionInput): Db {
  require(ctx, "delivery.complete");
  const tx = new Tx(db, ctx);
  const d = tx.get("deliveries", deliveryId);
  if (d.status === "delivered") throw new ActionError("此站已完成");
  const order = tx.get("orders", d.orderId);
  const path: OrderState[] = ["Picking", "Shipped", "Delivered"];
  let state = order.state;
  for (const s of path) {
    if (state === s) continue;
    if (canTransition(state, s)) state = s;
  }
  if (state !== "Delivered") throw new ActionError(`訂單 ${order.no} 狀態 ${order.state} 無法送達`);
  // consume reservations
  const mine = db.reservations.filter((r) => r.orderId === order.id);
  tx.set(
    "lots",
    db.lots.map((lot) => {
      const q = mine.filter((r) => r.lotId === lot.id).reduce((a, r) => a + r.qtyBase, 0);
      return q ? { ...lot, qtyOnHand: lot.qtyOnHand - q, qtyReserved: lot.qtyReserved - q } : lot;
    }),
  );
  tx.set("reservations", db.reservations.filter((r) => r.orderId !== order.id));
  tx.patch("orders", order.id, { state: "Delivered" });
  tx.patch("deliveries", d.id, { status: "delivered", deliveredAt: ctx.now });
  const customer = db.customers.find((c) => c.id === d.customerId)!;
  // bill what was delivered: a confirmed short pick lowers the quantity on the charge
  const delivered = billableLines(order, db.pickConfirmations);
  const t = linesTotal(delivered);
  const docId = `ar-${d.date}-${customer.code}`;
  const doc: ArDocument = {
    id: docId,
    no: `AR-${ymd(d.date)}-${String(tx.nextNum(`ar-${d.date}`)).padStart(2, "0")}`,
    customerId: customer.id,
    type: "charge",
    sourceDeliveryId: d.id,
    sourceOrderId: order.id,
    issueDate: d.date,
    exTaxCents: t.exTax,
    taxCents: t.tax,
    totalCents: t.total,
    memo: `送貨單 ${d.noteNo}`,
    items: delivered.map((l) => {
      const p = db.products.find((x) => x.id === l.productId)!;
      return { productId: p.id, name: p.name, qty: l.qty, unitLabel: unitLabel(p, l.unit), unitPriceExTaxCents: l.unitPriceExTaxCents, exTaxCents: lineAmount(l.qtyBase, l.unitPriceExTaxCents) };
    }),
    createdAt: ctx.now,
    createdBy: ctx.actor.id,
  };
  tx.insert("arDocs", doc);
  if (customer.settlementTerms === "daily") {
    tx.insert("invoices", {
      id: `inv-${d.date}-${customer.code}`,
      provider: "ECPAY_MOCK",
      invoiceClass: customer.invoiceClass,
      customerId: customer.id,
      sourceArIds: [docId],
      buyerName: customer.name,
      buyerTaxId: customer.taxId,
      carrierType: customer.carrier?.type,
      carrierValue: customer.carrier?.value,
      period: periodOf(d.date),
      issueDate: d.date,
      exTaxCents: t.exTax,
      taxCents: t.tax,
      totalCents: t.total,
      providerStatus: "staged",
      govUploadStatus: "not_uploaded",
      createdAt: ctx.now,
    });
  }
  tx.event({
    feature: "dispatch",
    entityType: "Delivery",
    entityId: d.id,
    action: "delivered",
    summary: `${customer.name} 送達，建立應收 ${doc.no}（含稅 NT$${(t.total / 100).toLocaleString()}）`,
    scope: { customerId: customer.id, period: periodOf(d.date) },
  });
  let next = tx.db;
  if (collection && collection.amountCents > 0) {
    next = recordPayment(next, { ...ctx, correlationId: tx.correlationId }, {
      customerId: customer.id,
      amountCents: collection.amountCents,
      method: collection.method,
      deliveryId: d.id,
      proofRef: collection.proofRef,
      note: collection.note,
      collector: ctx.actor.name,
    });
  }
  return next;
}

// ───────────────────────── Receivables ─────────────────────────

export interface PaymentInput {
  customerId: string;
  amountCents: Cents;
  method: Payment["method"];
  deliveryId?: string;
  collectedAt?: string;
  proofRef?: string;
  note?: string;
  collector?: string;
}

export function recordPayment(db: Db, ctx: ActCtx, input: PaymentInput): Db {
  require(ctx, "payment.record");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new ActionError("收款金額需大於 0");
  const tx = new Tx(db, ctx);
  const at_ = input.collectedAt ?? ctx.now;
  const date = at_.slice(0, 10);
  assertPeriodOpen(db, input.customerId, date);
  const n = tx.nextNum(`pm-${date}`);
  const id = `pm-${ymd(date)}-x${String(n).padStart(2, "0")}`;
  const payment: Payment = {
    id,
    no: `PM-${ymd(date)}-${String(n + 40).padStart(2, "0")}`,
    customerId: input.customerId,
    collectedAt: at_,
    method: input.method,
    grossCents: input.amountCents,
    collector: input.collector ?? ctx.actor.name,
    proofRef: input.proofRef,
    deliveryId: input.deliveryId,
    custody: input.method === "cash" ? "collected" : "received",
    note: input.note,
    createdAt: ctx.now,
  };
  // idempotency guard: same delivery + amount + method within 30 minutes is treated as a duplicate entry
  const dup = db.payments.find(
    (p) => p.deliveryId && p.deliveryId === input.deliveryId && p.grossCents === input.amountCents && p.method === input.method && Math.abs(Date.parse(p.collectedAt) - Date.parse(at_)) < 30 * 60000,
  );
  if (dup) throw new ActionError(`與 ${dup.no} 重複（同送貨單、金額、方式），未建立`);
  tx.insert("payments", payment);
  const prefer = input.deliveryId ? db.arDocs.filter((d) => d.sourceDeliveryId === input.deliveryId).map((d) => d.id) : [];
  const planned = planAllocation(input.amountCents, input.customerId, tx.db.arDocs, db.allocations, prefer);
  planned.allocations.forEach((a, i) => tx.insert("allocations", { id: `${id}-a${i + 1}`, paymentId: id, arDocumentId: a.arDocumentId, appliedCents: a.appliedCents, at: ctx.now }));
  const c = db.customers.find((x) => x.id === input.customerId)!;
  tx.event({
    feature: "ar",
    entityType: "Payment",
    entityId: id,
    action: "record",
    summary: `${c.name} 收款 NT$${(input.amountCents / 100).toLocaleString()}（${input.method === "cash" ? "現金・司機持有" : "待核對入帳"}）${planned.unapplied > 0 ? `，未沖 NT$${(planned.unapplied / 100).toLocaleString()} 列為客戶溢收` : ""}`,
    after: planned.allocations.map((a) => `${db.arDocs.find((d) => d.id === a.arDocumentId)?.no ?? a.arDocumentId}:${a.appliedCents / 100}`).join("、"),
    scope: { customerId: c.id, period: periodOf(date) },
  });
  return tx.db;
}

export function allocateReceipt(db: Db, ctx: ActCtx, paymentId: string, taskId?: string): Db {
  require(ctx, "payment.allocate");
  const tx = new Tx(db, ctx);
  const p = tx.get("payments", paymentId);
  const un = paymentUnapplied(p, db.allocations);
  if (un <= 0) throw new ActionError("此收款已全數沖帳");
  const planned = planAllocation(un, p.customerId, db.arDocs, db.allocations);
  if (!planned.allocations.length) throw new ActionError("客戶沒有未沖應收可對應");
  const base = appliedFrom(p.id, db.allocations) ? db.allocations.filter((a) => a.paymentId === p.id).length : 0;
  planned.allocations.forEach((a, i) => tx.insert("allocations", { id: `${p.id}-a${base + i + 1}`, paymentId: p.id, arDocumentId: a.arDocumentId, appliedCents: a.appliedCents, at: ctx.now }));
  if (p.custody === "received") tx.patch("payments", p.id, { custody: "matched" });
  if (taskId) tx.patch("aiTasks", taskId, { status: "committed", resolvedBy: ctx.actor.id, resolvedAt: ctx.now });
  const c = db.customers.find((x) => x.id === p.customerId)!;
  tx.event({
    feature: "ar",
    entityType: "Payment",
    entityId: p.id,
    action: "allocate",
    summary: `${c.name} ${p.no} 沖帳 NT$${(sum(planned.allocations.map((a) => a.appliedCents)) / 100).toLocaleString()}（由舊到新）`,
    after: planned.allocations.map((a) => `${db.arDocs.find((d) => d.id === a.arDocumentId)?.no}:${a.appliedCents / 100}`).join("、"),
    approvalId: taskId,
    scope: { customerId: c.id, period: periodOf(p.collectedAt) },
  });
  return tx.db;
}

export function reversePayment(db: Db, ctx: ActCtx, paymentId: string, reason: string, taskId?: string): Db {
  require(ctx, "payment.reverse");
  if (!reason.trim()) throw new ActionError("沖回需填寫原因");
  const tx = new Tx(db, ctx);
  const p = tx.get("payments", paymentId);
  if (p.reversalOf) throw new ActionError("沖回分錄不可再沖回");
  if (isReversed(p, db.payments)) throw new ActionError("此收款已沖回");
  const plan = planReversal(p, db.allocations);
  const id = `${p.id}-rev`;
  tx.insert("payments", {
    ...p,
    id,
    no: `${p.no}-R`,
    grossCents: plan.grossCents,
    reversalOf: p.id,
    collectedAt: p.collectedAt,
    createdAt: ctx.now,
    note: `沖回 ${p.no}：${reason}`,
    proofRef: undefined,
  });
  plan.allocations.forEach((a, i) => tx.insert("allocations", { id: `${id}-a${i + 1}`, paymentId: id, arDocumentId: a.arDocumentId, appliedCents: a.appliedCents, at: ctx.now }));
  if (taskId) tx.patch("aiTasks", taskId, { status: "committed", resolvedBy: ctx.actor.id, resolvedAt: ctx.now });
  const c = db.customers.find((x) => x.id === p.customerId)!;
  tx.event({
    feature: "ar",
    entityType: "Payment",
    entityId: id,
    action: "reverse",
    summary: `${c.name} 收款 ${p.no} 以沖回分錄 ${p.no}-R 抵銷（原紀錄保留）`,
    reason,
    before: `${p.no} NT$${p.grossCents / 100}`,
    after: `${p.no}-R NT$${plan.grossCents / 100}`,
    approvalId: taskId,
    scope: { customerId: c.id, period: periodOf(p.collectedAt) },
  });
  return tx.db;
}

export function setCustody(db: Db, ctx: ActCtx, paymentIds: string[], custody: Payment["custody"]): Db {
  require(ctx, "payment.custody");
  const tx = new Tx(db, ctx);
  for (const id of paymentIds) tx.patch("payments", id, { custody });
  tx.event({ feature: "ar", entityType: "Payment", entityId: paymentIds[0], action: "custody", summary: `${paymentIds.length} 筆收款狀態更新為「${custody === "handed_over" ? "已繳回公司" : custody === "deposited" ? "已存入銀行" : custody === "matched" ? "已核對入帳" : custody}」` });
  return tx.db;
}

/** Tax correction: a debit/credit note for the tax difference only; the original document is never edited. */
export function correctTax(db: Db, ctx: ActCtx, docId: string, taskId?: string): Db {
  require(ctx, "ar.adjust");
  const tx = new Tx(db, ctx);
  const doc = tx.get("arDocs", docId);
  const expected = taxOnExclusive(doc.exTaxCents);
  const diff = doc.taxCents - expected;
  if (diff === 0) throw new ActionError("稅額正確，無需更正");
  assertPeriodOpen(db, doc.customerId, doc.issueDate);
  const type = diff > 0 ? "credit_note" : "debit_note";
  const n = tx.nextNum("adj");
  tx.insert("arDocs", {
    id: `adj-${n}-${doc.id}`,
    no: `${type === "credit_note" ? "CN" : "DB"}-${ymd(doc.issueDate)}-${String(n).padStart(2, "0")}`,
    customerId: doc.customerId,
    type,
    issueDate: doc.issueDate,
    exTaxCents: 0,
    taxCents: Math.abs(diff),
    totalCents: Math.abs(diff),
    memo: `更正 ${doc.no} 稅額（${doc.taxCents / 100} → ${expected / 100}）`,
    correctsDocId: doc.id,
    createdAt: ctx.now,
    createdBy: ctx.actor.id,
  });
  if (taskId) tx.patch("aiTasks", taskId, { status: "committed", resolvedBy: ctx.actor.id, resolvedAt: ctx.now });
  tx.event({
    feature: "ar",
    entityType: "ArDocument",
    entityId: doc.id,
    action: "tax_correction",
    summary: `開立${type === "credit_note" ? "貸項" : "借項"}更正 ${doc.no} 稅額差 NT$${Math.abs(diff) / 100}`,
    before: `稅額 ${doc.taxCents / 100}`,
    after: `稅額 ${expected / 100}`,
    approvalId: taskId,
    scope: { customerId: doc.customerId, period: periodOf(doc.issueDate) },
  });
  return tx.db;
}

function assertPeriodOpen(db: Db, customerId: string, date: string) {
  const period = periodOf(date);
  const locked = db.statements.find((s) => s.customerId === customerId && s.period === period && ["released", "queued", "sent_mock"].includes(s.status));
  if (locked) throw new ActionError(`${period} 對帳單已核准發送，期間已關帳，請改於當期開立調整`);
}

// ───────────────────────── Statements ─────────────────────────

export function lockStatements(db: Db, ctx: ActCtx, period: string, customerIds: string[]): Db {
  require(ctx, "statement.lock");
  const tx = new Tx(db, ctx);
  for (const cid of customerIds) {
    const c = db.customers.find((x) => x.id === cid)!;
    const prev = tx.db.statements.filter((s) => s.customerId === cid && s.period === period && s.status !== "superseded");
    if (prev.some((s) => ["released", "queued", "sent_mock"].includes(s.status))) throw new ActionError(`${c.name} ${period} 已核准，不可重新鎖定`);
    prev.forEach((s) => tx.patch("statements", s.id, { status: "superseded" }));
    const preview = buildStatement(c, period, db.arDocs, db.payments, db.allocations, db.invoices);
    if (!preview.reconciles) throw new ActionError(`${c.name} 對帳不平，無法鎖定`);
    const version = db.statements.filter((s) => s.customerId === cid && s.period === period).length + 1;
    const st: Statement = {
      id: `st-${period}-${c.code}-v${version}`,
      customerId: cid,
      period,
      version,
      status: "locked",
      totals: preview.totals,
      lines: preview.lines,
      snapshotHash: snapshotHash(preview.lines),
      lockedAt: ctx.now,
      lockedBy: ctx.actor.id,
      sendLog: [],
    };
    tx.insert("statements", st);
  }
  tx.event({ feature: "statements", entityType: "StatementBatch", entityId: period, action: "lock", summary: `鎖定 ${period} 對帳單快照 ${customerIds.length} 份` });
  return tx.db;
}

export function reviewStatement(db: Db, ctx: ActCtx, statementId: string, blockingFlags: number): Db {
  require(ctx, "statement.review");
  if (blockingFlags > 0) throw new ActionError(`此客戶尚有 ${blockingFlags} 項高風險稽核旗標，請先處理`);
  const tx = new Tx(db, ctx);
  const s = tx.get("statements", statementId);
  if (s.status !== "locked") throw new ActionError("僅「已鎖定」可審查");
  const c = db.customers.find((x) => x.id === s.customerId)!;
  const fresh = buildStatement(c, s.period, db.arDocs, db.payments, db.allocations, db.invoices);
  if (snapshotHash(fresh.lines) !== s.snapshotHash) throw new ActionError("鎖定後帳務有異動，快照已過期，請重新鎖定");
  tx.patch("statements", s.id, { status: "reviewed", reviewedBy: ctx.actor.id, reviewedAt: ctx.now });
  tx.event({ feature: "statements", entityType: "Statement", entityId: s.id, action: "review", summary: `會計審查通過 ${c.name} ${s.period} v${s.version}` });
  return tx.db;
}

export function releaseStatement(db: Db, ctx: ActCtx, statementId: string): Db {
  require(ctx, "statement.release");
  const tx = new Tx(db, ctx);
  const s = tx.get("statements", statementId);
  if (s.status !== "reviewed") throw new ActionError("需先經會計審查");
  if (s.reviewedBy === ctx.actor.id) throw new ActionError("審查與核准需不同人員");
  const c = db.customers.find((x) => x.id === s.customerId)!;
  tx.patch("statements", s.id, { status: "released", releasedBy: ctx.actor.id, releasedAt: ctx.now });
  tx.event({ feature: "statements", entityType: "Statement", entityId: s.id, action: "release", summary: `主管核准 ${c.name} ${s.period} 對帳單`, approvedBy: ctx.actor.id });
  return tx.db;
}

export function sendStatementMock(db: Db, ctx: ActCtx, statementId: string): Db {
  require(ctx, "statement.send");
  const tx = new Tx(db, ctx);
  const s = tx.get("statements", statementId);
  if (s.status !== "released" && s.status !== "sent_mock") throw new ActionError("需主管核准後才能排入發送");
  const c = db.customers.find((x) => x.id === s.customerId)!;
  if (c.linkStatus !== "linked") throw new ActionError(`${c.name} 尚未完成 LINE 官方帳號綁定，不可推播；請改用安全連結人工分享`);
  const expires = at(addDays(ctx.now.slice(0, 10), 7), ctx.now.slice(11, 16));
  tx.patch("statements", s.id, {
    status: "sent_mock",
    sendLog: [...s.sendLog, { at: ctx.now, channel: "line_mock", status: "simulated_delivered", linkExpiresAt: expires }],
  });
  tx.event({
    feature: "statements",
    entityType: "Statement",
    entityId: s.id,
    action: "send_mock",
    summary: `${c.name} ${s.period} 對帳單：模擬 LINE 推播（含 7 日有效安全連結），未實際寄出`,
    externalReceipt: `MOCK-LINE-${s.id}`,
    status: "simulated",
  });
  return tx.db;
}

// ───────────────────────── Invoices ─────────────────────────

export function preflightInvoices(db: Db, ctx: ActCtx, ids: string[]): Db {
  require(ctx, "invoice.submit");
  const tx = new Tx(db, ctx);
  let ok = 0;
  for (const id of ids) {
    const inv = tx.get("invoices", id);
    if (!["staged", "preflight_failed", "ready"].includes(inv.providerStatus)) continue;
    const issues = preflightInvoice(inv);
    tx.patch("invoices", id, { providerStatus: issues.length ? "preflight_failed" : "ready", rejectReason: issues.map((i) => i.message).join("；") || undefined });
    if (!issues.length) ok++;
  }
  tx.event({ feature: "invoices", entityType: "TaxInvoice", entityId: ids[0], action: "preflight", summary: `發票預檢 ${ids.length} 張：${ok} 張可送出、${ids.length - ok} 張需修正` });
  return tx.db;
}

export function fixInvoiceCarrier(db: Db, ctx: ActCtx, id: string, value: string): Db {
  require(ctx, "invoice.submit");
  const tx = new Tx(db, ctx);
  const inv = tx.get("invoices", id);
  if (!["staged", "preflight_failed", "rejected"].includes(inv.providerStatus)) throw new ActionError("已送出的發票不可修改");
  tx.patch("invoices", id, { carrierValue: value, providerStatus: "staged", rejectReason: undefined });
  tx.event({ feature: "invoices", entityType: "TaxInvoice", entityId: id, action: "fix_carrier", summary: `修正 ${inv.buyerName} 載具號碼`, before: inv.carrierValue, after: value });
  return tx.db;
}

/** Simulated ECPay submission. Accepted by provider ≠ uploaded to 財政部. */
export function submitInvoicesMock(db: Db, ctx: ActCtx, ids: string[]): Db {
  require(ctx, "invoice.submit");
  const tx = new Tx(db, ctx);
  const done: string[] = [];
  for (const id of ids) {
    const inv = tx.get("invoices", id);
    if (inv.providerStatus !== "ready") continue;
    const n = tx.nextNum("invno");
    tx.patch("invoices", id, {
      providerStatus: "accepted",
      govUploadStatus: "pending_mock",
      invoiceNo: `ZZ${String(30240000 + n).padStart(8, "0")}`,
      providerRef: `MOCK-${Date.parse(ctx.now).toString(36).toUpperCase()}-${n}`,
    });
    done.push(id);
  }
  if (!done.length) throw new ActionError("沒有「可送出」的發票，請先預檢");
  tx.event({ feature: "invoices", entityType: "TaxInvoice", entityId: done[0], action: "submit_mock", summary: `模擬送出 ${done.length} 張發票至綠界（模擬接收；尚未上傳財政部）`, status: "simulated", externalReceipt: "MOCK-ECPAY" });
  return tx.db;
}

export function stageMonthlyInvoice(db: Db, ctx: ActCtx, customerId: string, period: string): Db {
  require(ctx, "invoice.submit");
  const tx = new Tx(db, ctx);
  const c = db.customers.find((x) => x.id === customerId)!;
  const { start, end } = periodRange(period);
  const docs = db.arDocs.filter((d) => d.customerId === customerId && d.type === "charge" && d.issueDate >= start && d.issueDate <= end);
  const already = db.invoices.find((i) => i.customerId === customerId && i.period === period && i.providerStatus !== "voided");
  if (already) throw new ActionError("本期已有發票");
  const exTax = sum(docs.map((d) => d.exTaxCents));
  const inv: TaxInvoice = {
    id: `inv-${period}-${c.code}`,
    provider: "ECPAY_MOCK",
    invoiceClass: "B2B",
    customerId,
    sourceArIds: docs.map((d) => d.id),
    buyerName: c.name,
    buyerTaxId: c.taxId,
    period,
    issueDate: end,
    exTaxCents: exTax,
    taxCents: taxOnExclusive(exTax),
    totalCents: exTax + taxOnExclusive(exTax),
    providerStatus: "staged",
    govUploadStatus: "not_uploaded",
    createdAt: ctx.now,
  };
  tx.insert("invoices", inv);
  tx.event({ feature: "invoices", entityType: "TaxInvoice", entityId: inv.id, action: "stage", summary: `建立 ${c.name} ${period} 彙開發票草稿（${docs.length} 張送貨單）` });
  return tx.db;
}

// ───────────────────────── Inventory & procurement ─────────────────────────

export function setReorderPoint(db: Db, ctx: ActCtx, productId: string, qtyBase: number, reason: string, taskId?: string): Db {
  require(ctx, "inventory.threshold");
  if (!Number.isInteger(qtyBase) || qtyBase < 0) throw new ActionError("門檻需為非負整數");
  const tx = new Tx(db, ctx);
  const p = tx.get("products", productId);
  tx.patch("products", productId, { reorderPoint: qtyBase });
  if (taskId) tx.patch("aiTasks", taskId, { status: "committed", resolvedBy: ctx.actor.id, resolvedAt: ctx.now });
  const fmt = (q: number) => (q % p.packSize === 0 ? `${q / p.packSize} ${p.packUnit}` : `${q} ${p.baseUnit}`);
  tx.event({ feature: "inventory", entityType: "Product", entityId: productId, action: "set_reorder_point", summary: `${p.name} 補貨點 ${fmt(p.reorderPoint)} → ${fmt(qtyBase)}`, before: fmt(p.reorderPoint), after: fmt(qtyBase), reason, approvalId: taskId });
  return tx.db;
}

export function adjustStock(db: Db, ctx: ActCtx, lotId: string, kind: "physical_count" | "ledger_adjustment", newQtyOrDelta: number, reason: string): Db {
  require(ctx, "inventory.adjust");
  if (!reason.trim()) throw new ActionError("庫存調整需填寫原因");
  const tx = new Tx(db, ctx);
  const lot = tx.get("lots", lotId);
  const delta = kind === "physical_count" ? newQtyOrDelta - lot.qtyOnHand : newQtyOrDelta;
  const after = lot.qtyOnHand + delta;
  if (after < lot.qtyReserved) throw new ActionError(`調整後 ${after} 低於已保留 ${lot.qtyReserved}，請先處理保留`);
  tx.patch("lots", lotId, { qtyOnHand: after });
  tx.insert("adjustments", { id: `adj-${tx.nextNum("stockadj")}`, lotId, kind, delta, reason, actorId: ctx.actor.id, at: ctx.now });
  const p = db.products.find((x) => x.id === lot.productId)!;
  tx.event({ feature: "inventory", entityType: "InventoryLot", entityId: lotId, action: kind, summary: `${p.name} 批號 ${lot.lot} ${kind === "physical_count" ? "盤點" : "帳面調整"} ${delta >= 0 ? "+" : ""}${delta}`, before: String(lot.qtyOnHand), after: String(after), reason });
  return tx.db;
}

export function draftPurchaseOrders(db: Db, ctx: ActCtx, lines: { productId: string; qtyBase: number }[], source: PurchaseOrder["source"], taskId?: string): Db {
  require(ctx, "po.draft");
  const tx = new Tx(db, ctx);
  const bySupplier = new Map<string, { productId: string; qtyBase: number }[]>();
  for (const l of lines) {
    const p = db.products.find((x) => x.id === l.productId)!;
    bySupplier.set(p.supplierId, [...(bySupplier.get(p.supplierId) ?? []), l]);
  }
  const created: string[] = [];
  for (const [sid, ls] of bySupplier) {
    const s = db.suppliers.find((x) => x.id === sid)!;
    if (!s.approved) throw new ActionError(`${s.name} 尚未核准，不可叫貨`);
    const n = tx.nextNum(`po-${today}`);
    const expectedAt = addDays(today, s.leadTimeDays);
    const po: PurchaseOrder = {
      id: `po-${ymd(today)}-${n}`,
      no: `PO-${ymd(today)}-${String(n).padStart(2, "0")}`,
      supplierId: sid,
      status: "pending_approval",
      lines: ls.map((l) => ({ ...l, unitCostCents: db.products.find((p) => p.id === l.productId)!.costCents ?? 0 })),
      createdAt: ctx.now,
      expectedAt,
      createdBy: ctx.actor.id,
      source,
      messagePreview: supplierMessage(s, ls.map((l) => ({ product: db.products.find((p) => p.id === l.productId)!, qtyBase: l.qtyBase })), expectedAt),
    };
    tx.insert("purchaseOrders", po);
    created.push(po.no);
  }
  if (taskId) tx.patch("aiTasks", taskId, { status: "committed", resolvedBy: ctx.actor.id, resolvedAt: ctx.now, resultNote: `已建立 ${created.join("、")}（待主管核准）` });
  tx.event({ feature: "procurement", entityType: "PurchaseOrder", entityId: created[0], action: "draft", summary: `草擬叫貨單 ${created.join("、")}，待核准後才會發送`, approvalId: taskId });
  return tx.db;
}

export function approvePurchaseOrder(db: Db, ctx: ActCtx, poId: string): Db {
  require(ctx, "po.approve");
  const tx = new Tx(db, ctx);
  const po = tx.get("purchaseOrders", poId);
  if (po.status !== "pending_approval" && po.status !== "draft") throw new ActionError("此叫貨單不在待核准狀態");
  tx.patch("purchaseOrders", poId, { status: "approved" });
  tx.event({ feature: "procurement", entityType: "PurchaseOrder", entityId: poId, action: "approve", summary: `核准叫貨單 ${po.no}（列入在途量）`, approvedBy: ctx.actor.id });
  return tx.db;
}

export function sendPurchaseOrderMock(db: Db, ctx: ActCtx, poId: string): Db {
  require(ctx, "po.draft");
  const tx = new Tx(db, ctx);
  const po = tx.get("purchaseOrders", poId);
  if (po.status !== "approved") throw new ActionError("需核准後才能發送");
  const s = db.suppliers.find((x) => x.id === po.supplierId)!;
  if (s.channel === "line_group" && !s.lineGroupVerified) throw new ActionError(`${s.name} LINE 群組尚未驗證（需群組成員權限與 group ID 事件），請改電話叫貨`);
  tx.patch("purchaseOrders", poId, { status: "sent_mock" });
  tx.event({ feature: "procurement", entityType: "PurchaseOrder", entityId: poId, action: "send_mock", summary: `叫貨單 ${po.no} 模擬發送至 ${s.name}（未實際發送）`, status: "simulated" });
  return tx.db;
}

export function receivePurchaseOrder(db: Db, ctx: ActCtx, poId: string, lotCode: string, expiry: string): Db {
  require(ctx, "inventory.adjust");
  const tx = new Tx(db, ctx);
  const po = tx.get("purchaseOrders", poId);
  if (po.status !== "sent_mock" && po.status !== "approved") throw new ActionError("此叫貨單不可收貨");
  if (expiry <= today) throw new ActionError("效期已過或當日到期，不可入庫");
  for (const l of po.lines) {
    const p = db.products.find((x) => x.id === l.productId)!;
    tx.insert("lots", { id: `lot-${p.id}-${lotCode}`, productId: p.id, locationId: `loc-${p.shelf}`, zone: p.zone, lot: lotCode, expiry, receivedAt: today, qtyOnHand: l.qtyBase, qtyReserved: 0 });
  }
  tx.patch("purchaseOrders", poId, { status: "received", receivedAt: today });
  tx.event({ feature: "inventory", entityType: "PurchaseOrder", entityId: poId, action: "receive", summary: `${po.no} 冷凍收貨入庫，批號 ${lotCode}，效期 ${expiry}` });
  return tx.db;
}

export function setAutoReorder(db: Db, ctx: ActCtx, enabled: boolean): Db {
  require(ctx, "settings.manage");
  const tx = new Tx(db, ctx);
  tx.set("settings", { ...db.settings, autoReorder: { ...db.settings.autoReorder, enabled } });
  tx.event({ feature: "settings", entityType: "Setting", entityId: "autoReorder", action: "toggle", summary: `自動補貨 ${enabled ? "啟用（上限與核准供應商規則生效）" : "關閉"}`, before: String(!enabled), after: String(enabled) });
  return tx.db;
}

// ───────────────────────── AI tasks & memory ─────────────────────────

export function addAiTask(db: Db, ctx: ActCtx, task: Omit<AiTask, "id" | "createdAt" | "correlationId">): { db: Db; task: AiTask } {
  const tx = new Tx(db, ctx);
  const t: AiTask = { ...task, id: `task-${tx.nextNum("task")}`, createdAt: ctx.now, correlationId: tx.correlationId };
  tx.insert("aiTasks", t);
  tx.event({
    actorOverride: { id: "agent", name: "Everyse AI", type: "agent" },
    feature: "ai",
    entityType: "AiTask",
    entityId: t.id,
    action: t.status === "answered" ? "answer" : "propose",
    summary: `${t.status === "answered" ? "回覆" : "提出建議"}：${t.title}`,
    reason: task.command ? `指令「${task.command}」由 ${ctx.actor.name} 下達` : undefined,
    status: t.status === "answered" ? "committed" : "proposed",
  });
  return { db: tx.db, task: t };
}

export function rejectAiTask(db: Db, ctx: ActCtx, taskId: string, reason: string): Db {
  const tx = new Tx(db, ctx);
  const t = tx.get("aiTasks", taskId);
  if (t.status !== "awaiting_approval") throw new ActionError("此任務已處理");
  tx.patch("aiTasks", taskId, { status: "rejected", resolvedBy: ctx.actor.id, resolvedAt: ctx.now, resultNote: reason });
  tx.correlationId = t.correlationId;
  tx.event({ feature: "ai", entityType: "AiTask", entityId: taskId, action: "reject", summary: `退回 AI 建議：${t.title}`, reason, status: "rejected" });
  return tx.db;
}

export function markTaskCommitted(db: Db, ctx: ActCtx, taskId: string, note: string): Db {
  const tx = new Tx(db, ctx);
  tx.patch("aiTasks", taskId, { status: "committed", resolvedBy: ctx.actor.id, resolvedAt: ctx.now, resultNote: note });
  return tx.db;
}

export function saveMemory(db: Db, ctx: ActCtx, mem: Omit<AgentMemory, "id" | "approvedBy" | "lastConfirmedAt" | "provenanceEventId">): Db {
  require(ctx, "memory.approve");
  if (!mem.evidence.trim()) throw new ActionError("記憶需附上依據");
  const tx = new Tx(db, ctx);
  const id = `mem-${tx.nextNum("mem") + 10}`;
  tx.event({ feature: "memory", entityType: "AgentMemory", entityId: id, action: "approve", summary: `核准工作記憶：${mem.key}`, after: mem.valueText });
  tx.insert("memories", { ...mem, id, approvedBy: ctx.actor.id, lastConfirmedAt: ctx.now, provenanceEventId: `ev-${tx.db.events.length}` });
  return tx.db;
}

export function deleteMemory(db: Db, ctx: ActCtx, id: string, reason: string): Db {
  require(ctx, "memory.approve");
  const tx = new Tx(db, ctx);
  const m = tx.get("memories", id);
  tx.set("memories", db.memories.filter((x) => x.id !== id));
  tx.event({ feature: "memory", entityType: "AgentMemory", entityId: id, action: "delete", summary: `移除工作記憶：${m.key}`, before: m.valueText, reason });
  return tx.db;
}

/* ───────────────────────── CRM ───────────────────────── */

export interface NoteInput {
  customerId: string;
  kind: CustomerNote["kind"];
  text: string;
  followUpOn?: string;
}

export function addCustomerNote(db: Db, ctx: ActCtx, input: NoteInput): Db {
  require(ctx, "crm.edit");
  const text = input.text.trim();
  if (!text) throw new ActionError("請輸入往來內容");
  if (input.followUpOn && input.followUpOn < ctx.now.slice(0, 10)) throw new ActionError("追蹤日不可早於今天");
  const tx = new Tx(db, ctx);
  const c = tx.get("customers", input.customerId);
  const note = tx.insert("crmNotes", { id: `note-${tx.nextNum("note") + 100}`, customerId: c.id, at: ctx.now, authorId: ctx.actor.id, authorName: ctx.actor.name, kind: input.kind, text, followUpOn: input.followUpOn || undefined });
  tx.event({ feature: "crm", entityType: "Customer", entityId: c.id, action: "add_note", summary: `${c.name} 新增往來紀錄${note.followUpOn ? `（追蹤 ${note.followUpOn}）` : ""}`, after: text });
  return tx.db;
}

export interface AgreedPriceInput {
  customerId: string;
  productId: string;
  /** null ends the agreement (back to the tier price). */
  quote: { amountCents: Cents; unit: "base" | "pack"; taxIncluded: boolean } | null;
  effectiveFrom: string;
  note?: string;
}

/** Record a 合約價. Never edits an older row — a new row with a later effectiveFrom supersedes it, so past orders keep their price. */
export function setAgreedPrice(db: Db, ctx: ActCtx, input: AgreedPriceInput): Db {
  require(ctx, "price.manage");
  const tx = new Tx(db, ctx);
  const c = tx.get("customers", input.customerId);
  const p = tx.get("products", input.productId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new ActionError("生效日格式需為 YYYY-MM-DD");
  if (input.quote && (!Number.isSafeInteger(input.quote.amountCents) || input.quote.amountCents <= 0)) throw new ActionError("合約價需大於 0");
  const before = resolvePrice(db.customerPrices, c, p, input.effectiveFrom);
  const cents = input.quote ? quoteToBaseExTax(input.quote, p) : null;
  if (cents !== null && cents <= 0) throw new ActionError("換算後單價需大於 0");
  const row = tx.insert("customerPrices", {
    id: `cp-${tx.nextNum("customerPrice") + 1000}`,
    customerId: c.id,
    productId: p.id,
    effectiveFrom: input.effectiveFrom,
    priceExTaxCents: cents,
    quoted: input.quote ?? undefined,
    note: input.note?.trim() || undefined,
    createdAt: ctx.now,
    createdBy: ctx.actor.id,
  });
  const fmt = (x: number) => `NT$${(x / 100).toLocaleString()}／${p.baseUnit}（未稅）`;
  tx.event({
    feature: "crm",
    entityType: "CustomerPrice",
    entityId: row.id,
    action: cents === null ? "end_agreed_price" : "set_agreed_price",
    summary: cents === null ? `${c.name} 的 ${p.name} 合約價停用，${input.effectiveFrom} 起回到等級價` : `${c.name} 的 ${p.name} 合約價 ${fmt(cents)}，${input.effectiveFrom} 起生效`,
    before: `${before.source === "contract" ? "合約價" : "等級價"} ${fmt(before.cents)}`,
    after: cents === null ? `等級價 ${fmt(before.tierCents)}` : fmt(cents),
    reason: row.note,
  });
  return tx.db;
}

/* ───────────────────────── Manual creation (＋) ───────────────────────── */

function parseOrThrow<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new ActionError(r.error.issues[0].message);
  return r.data;
}

export function createCustomer(db: Db, ctx: ActCtx, input: CustomerInput): { db: Db; value: string } {
  require(ctx, "crm.edit");
  const v = parseOrThrow(customerSchema, input);
  if (db.customers.some((c) => c.code === v.code)) throw new ActionError(`代號 ${v.code} 已被使用`);
  const tx = new Tx(db, ctx);
  const id = `C${String(db.customers.length + tx.nextNum("customer")).padStart(2, "0")}`;
  const c: Customer = {
    id,
    code: v.code,
    name: v.name,
    segment: v.segment,
    subType: v.subType,
    ownerName: v.ownerName,
    onboardedAt: v.onboardedAt,
    accountManagerId: v.accountManagerId,
    contactName: v.contactName || v.ownerName,
    phone: v.phone,
    address: v.address,
    district: v.district,
    linkStatus: "unlinked",
    settlementTerms: v.settlementTerms,
    sameDayShareBp: v.settlementTerms === "mixed" ? v.sameDaySharePct * 100 : undefined,
    invoiceClass: v.invoiceClass,
    taxId: v.invoiceClass === "B2B" ? v.taxId : undefined,
    carrier: v.invoiceClass === "B2C" && v.carrierType !== "none" ? { type: v.carrierType, value: v.carrierValue } : undefined,
    billingContact: v.contactName || v.ownerName,
    priceTier: v.priceTier,
    geo: districtCentre(db.customers, v.district, ROUTING.depot),
    geoPending: true,
    window: { start: v.windowStart, end: v.windowEnd },
    creditLimitCents: twd(v.creditLimit),
  };
  tx.insert("customers", c);
  tx.event({ feature: "crm", entityType: "Customer", entityId: id, action: "create", summary: `新增客戶 ${c.name}（${c.segment}・${TERMS[c.settlementTerms]}）`, after: `${c.ownerName}・${c.phone}` });
  let out = tx.db;
  // promised at onboarding → effective from the onboarding date; each row is its own audited event
  for (const row of v.agreedPrices) {
    out = setAgreedPrice(out, { ...ctx, correlationId: tx.correlationId }, { customerId: id, productId: row.productId, quote: { amountCents: twd(row.amount), unit: row.unit, taxIncluded: row.taxIncluded }, effectiveFrom: v.onboardedAt, note: "建檔時約定" });
  }
  return { db: out, value: id };
}
const TERMS = { daily: "日結", monthly: "月結", mixed: "混合" } as const;

/** Phone / walk-in order keyed in by sales. Optionally confirmed (validate + FEFO reserve) in the same step. */
export function createManualOrder(db: Db, ctx: ActCtx, input: OrderInput, confirm: boolean): { db: Db; value: string } {
  require(ctx, "order.validate");
  const v = parseOrThrow(orderSchema, input);
  if (v.deliveryDate < today) throw new ActionError("配送日不可早於今天");
  const customer = db.customers.find((c) => c.id === v.customerId);
  if (!customer) throw new ActionError("找不到客戶");
  const tx = new Tx(db, ctx);
  const n = tx.nextNum(`so-m-${ymd(today)}`);
  const orderId = `o-man-${ymd(today)}-${n}`;
  const overrides: string[] = [];
  const lines: OrderLine[] = v.lines.map((l, i) => {
    const p = db.products.find((x) => x.id === l.productId);
    if (!p) throw new ActionError("找不到品項");
    // the agreed (合約) price, or the tier price when there is none — 改價 is measured against this
    const list = resolvePrice(db.customerPrices, customer, p, v.deliveryDate).cents;
    const price = l.priceOverride === null ? list : twd(l.priceOverride);
    if (price !== list) overrides.push(`${p.name} ${list / 100}→${price / 100}（${l.priceReason}）`);
    return { id: `${orderId}-L${i + 1}`, productId: p.id, qty: l.qty, unit: l.unit, qtyBase: toBaseQty(p, l.qty, l.unit), unitPriceExTaxCents: price, taxRateBp: 500, note: price !== list ? `改價：${l.priceReason}` : undefined };
  });
  const order: SalesOrder = {
    id: orderId,
    no: `SO-${ymd(today)}-M${String(n).padStart(2, "0")}`,
    customerId: customer.id,
    source: v.source,
    externalId: `MANUAL-${ymd(today)}-${n}`,
    orderAt: ctx.now,
    deliveryDate: v.deliveryDate,
    state: "Draft",
    lines,
    note: v.note || undefined,
    createdBy: ctx.actor.id,
  };
  tx.insert("orders", order);
  tx.event({
    feature: "orders",
    entityType: "SalesOrder",
    entityId: orderId,
    action: "create_manual",
    summary: `手動建立 ${order.no}・${customer.name}（${lines.length} 品項，配送 ${v.deliveryDate}）${overrides.length ? "・含改價" : ""}`,
    after: overrides.join("；") || undefined,
  });
  return { db: confirm ? validateOrder(tx.db, ctx, orderId) : tx.db, value: orderId };
}

/** Orders for today that were confirmed after the route was planned. */
export function unroutedToday(db: Db): SalesOrder[] {
  const plan = activePlan(db);
  const routed = new Set(plan?.stops.map((s) => s.orderId) ?? []);
  return db.orders.filter((o) => o.deliveryDate === today && (o.state === "Reserved" || o.state === "Validated") && !routed.has(o.id));
}

export function insertionOptions(db: Db, orderId: string) {
  const plan = activePlan(db);
  const o = db.orders.find((x) => x.id === orderId);
  if (!plan || !o) return [];
  const ctx = routingContext(db);
  return (["A", "B"] as VehicleId[]).map((v) => bestInsertion(plan.stops, { deliveryId: `pending-${o.id}`, orderId: o.id, customerId: o.customerId }, v, ctx));
}

/** Manager adds a late order to today's route: new route version, delivery created, pick lists follow. */
export function addOrderToRoute(db: Db, ctx: ActCtx, orderId: string, vehicleId: VehicleId, expectedVersion: number): Db {
  require(ctx, "route.approve");
  const plan = activePlan(db);
  if (!plan) throw new ActionError("今日沒有路線");
  if (plan.version !== expectedVersion) throw new ActionError(`路線已被更新為 v${plan.version}，請重新確認（樂觀鎖）`);
  const o = db.orders.find((x) => x.id === orderId);
  if (!o || !unroutedToday(db).some((x) => x.id === orderId)) throw new ActionError("此訂單不在待排車清單");
  const opt = insertionOptions(db, orderId).find((x) => x.vehicleId === vehicleId)!;
  if (!opt.feasible) throw new ActionError(`${vehicleId} 車無法加入：${opt.failed.join("、")}未通過`);
  const tx = new Tx(db, ctx);
  const deliveryId = `d-${today}-${o.id}`;
  const idx = db.deliveries.filter((d) => d.date === today).length + 1;
  tx.insert("deliveries", { id: deliveryId, orderId: o.id, customerId: o.customerId, date: today, vehicleId, status: "planned", noteNo: `DN-${ymd(today)}-${String(idx).padStart(2, "0")}` });
  const stops = opt.stops.map((s) => (s.orderId === o.id ? { ...s, deliveryId } : s));
  tx.patch("routePlans", plan.id, { status: "superseded" });
  const version = plan.version + 1;
  tx.insert("routePlans", { id: `rp-${today}-v${version}`, date: today, version, status: "active", stops, createdAt: ctx.now, createdBy: ctx.actor.id, approvedBy: ctx.actor.id, reason: "加入今日新增訂單" });
  const c = db.customers.find((x) => x.id === o.customerId)!;
  const seq = stops.find((s) => s.orderId === o.id)!.sequence;
  tx.event({ feature: "dispatch", entityType: "RoutePlan", entityId: `rp-${today}-v${version}`, action: "add_stop", summary: `${o.no}・${c.name} 加入 ${vehicleId} 車第 ${seq} 站（路線 v${plan.version} → v${version}，+${opt.addedKm.toFixed(1)} km）；理貨單同步更新`, before: `v${plan.version}`, after: `v${version}`, approvedBy: ctx.actor.id });
  return tx.db;
}

/** Text pasted from a LINE chat or phone memo becomes an inbox item and goes through the same AI draft path. */
export function pasteOrderText(db: Db, ctx: ActCtx, displayName: string, text: string): Db {
  require(ctx, "order.validate");
  if (!text.trim()) throw new ActionError("請貼上訊息內容");
  const tx = new Tx(db, ctx);
  const n = tx.nextNum("paste");
  const id = `msg-paste-${n}`;
  tx.insert("inbox", { id, receivedAt: ctx.now, displayName: displayName.trim() || "手動貼上", text: text.trim(), status: "new", webhookEventId: `paste-${n}` });
  tx.event({ feature: "orders", entityType: "LineInboxMessage", entityId: id, action: "paste_text", summary: `手動貼上訊息（${displayName.trim() || "未指定來源"}），交由 AI 轉草稿` });
  return draftFromLine(tx.db, ctx, id, displayName.trim() || undefined);
}

export function createSupplier(db: Db, ctx: ActCtx, input: SupplierInput): { db: Db; value: string } {
  require(ctx, "supplier.manage");
  const v = parseOrThrow(supplierSchema, input);
  const tx = new Tx(db, ctx);
  const id = `S${String(db.suppliers.length + tx.nextNum("supplier")).padStart(2, "0")}`;
  const s: Supplier = { id, name: v.name, contactName: v.contactName, phone: v.phone, email: v.email || undefined, channel: v.channel, lineGroupVerified: false, leadTimeDays: v.leadTimeDays, approved: false };
  tx.insert("suppliers", s);
  tx.event({ feature: "procurement", entityType: "Supplier", entityId: id, action: "create", summary: `新增供應商 ${s.name}（待主管核准）`, after: `${s.contactName}・${s.phone}` });
  return { db: tx.db, value: id };
}

export function approveSupplier(db: Db, ctx: ActCtx, supplierId: string): Db {
  require(ctx, "supplier.approve");
  const tx = new Tx(db, ctx);
  const s = tx.get("suppliers", supplierId);
  if (s.approved) throw new ActionError("此供應商已核准");
  tx.patch("suppliers", supplierId, { approved: true });
  tx.event({ feature: "procurement", entityType: "Supplier", entityId: supplierId, action: "approve", summary: `核准供應商 ${s.name}`, approvedBy: ctx.actor.id });
  return tx.db;
}

export function createProduct(db: Db, ctx: ActCtx, input: ProductInput): { db: Db; value: string } {
  require(ctx, "product.manage");
  const v = parseOrThrow(productSchema, input);
  if (db.products.some((p) => p.name === v.name)) throw new ActionError(`已有品項「${v.name}」`);
  if (db.products.some((p) => p.shelf === v.shelf)) throw new ActionError(`架位 ${v.shelf} 已被使用`);
  if (!db.suppliers.some((s) => s.id === v.supplierId)) throw new ActionError("找不到供應商");
  const aliases = splitAliases(v.aliases).filter((a) => a !== v.name);
  const taken = new Map(productAliases(db.products).flatMap(([id, ns]) => ns.map((n) => [n, id] as const)));
  for (const a of [v.name, ...aliases]) {
    const other = taken.get(a);
    if (other) throw new ActionError(`LINE 別名「${a}」已對應 ${db.products.find((p) => p.id === other)?.name}，會造成解析混淆`);
  }
  const tx = new Tx(db, ctx);
  const id = `P${String(db.products.length + tx.nextNum("product")).padStart(3, "0")}`;
  const p: Product = {
    id,
    sku: id,
    name: v.name,
    category: v.category,
    baseUnit: v.baseUnit,
    packUnit: "箱",
    packSize: v.packSize,
    spec: v.spec,
    weightGramPerBase: v.weightGram,
    volumeMlPerBase: Math.round(v.weightGram * 2.1),
    zone: v.zone,
    shelf: v.shelf,
    costCents: v.cost === null ? null : twd(v.cost),
    price: { standard: twd(v.priceStandard), volume: twd(v.priceVolume), vip: twd(v.priceVip) },
    taxClass: "taxable",
    supplierId: v.supplierId,
    reorderPoint: v.reorderPointPacks * v.packSize,
    reorderQty: v.reorderQtyPacks * v.packSize,
    tempC: v.tempC,
    aliases: aliases.length ? aliases : undefined,
  };
  tx.insert("products", p);
  tx.insert("locations", { id: `loc-${p.shelf}`, zone: p.zone, shelf: p.shelf });
  tx.event({ feature: "inventory", entityType: "Product", entityId: id, action: "create", summary: `新增品項 ${p.name}（${p.spec}・凍庫 ${p.zone} 架位 ${p.shelf}）${p.costCents === null ? "・尚無成本資料" : ""}`, after: `一般價 ${v.priceStandard}／量販 ${v.priceVolume}／VIP ${v.priceVip}` });
  return { db: tx.db, value: id };
}

/* ───────────────────────── Insights ───────────────────────── */

/** Read-only, but recorded: who asked for which report, from which data and model, and whether it validated. */
export function logInsightsReport(db: Db, ctx: ActCtx, r: { id: string; title: string; range: string; model: string; dataSource: string; facts: number; issues: number; fellBack?: string }): Db {
  if (ctx.actor.type !== "user") throw new ActionError("洞察報告需由人員產生");
  const tx = new Tx(db, ctx);
  tx.event({
    feature: "ai",
    entityType: "InsightsReport",
    entityId: r.id,
    action: "generate_insights",
    summary: `產生洞察報告「${r.title}」（${r.range}）`,
    after: `${r.model}・${r.dataSource}・引用 ${r.facts} 筆數據・${r.issues ? `驗證發現 ${r.issues} 項問題` : "數字全數通過驗證"}${r.fellBack ? `・AI 無法使用，已改用規則引擎（${r.fellBack}）` : ""}`,
  });
  return tx.db;
}
