import { planAllocation } from "../domain/ar";
import type { AiTask, LineInboxMessage } from "../domain/ai";
import { reserveOrder, type Reservation } from "../domain/inventory";
import { buildCharge, toBaseQty } from "../domain/orders";
import { invoicePeriodOf, PER_TRIP_FROM, perTripInvoice, randomCode, takeInvoiceNumber } from "../domain/invoices";
import { linePricing, quoteToBaseExTax, resolvePrice } from "../domain/pricing";
import { buildStatement, snapshotHash } from "../domain/statements";
import type {
  ActionEvent,
  AgentMemory,
  ArDocument,
  Customer,
  CustomerPrice,
  Delivery,
  InventoryLot,
  InvoiceNumberRange,
  OrderLine,
  Payment,
  PaymentAllocation,
  PurchaseOrder,
  RoutePlan,
  SalesOrder,
  Statement,
  StockLocation,
  TaxInvoice,
} from "../domain/types";
import { roundToUnit, sum, taxOnExclusive, twd } from "../money";
import { addDays, at, DEMO_TODAY, dayOfWeek, periodRange } from "../time";
import type { Db } from "../db";
import { AGENT, AGREED_PRICES, CRM_NOTES, CUSTOMERS, PRODUCTS, SUPPLIERS, TODAY_ORDERS, TODAY_SEQUENCE, USERS, VEHICLES_SEED, type CustomerSeed } from "./catalog";

export const SEED_VERSION = 9;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ymd = (d: string) => d.slice(2).replaceAll("-", "");
const stripSeed = ({ vehicle: _v, days: _d, basket: _b, ...c }: CustomerSeed): Customer => c;

export function buildSeed(): Db {
  const rng = mulberry32(20261024);
  const rint = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
  const products = PRODUCTS;
  const pById = new Map(products.map((p) => [p.id, p]));
  const customers = CUSTOMERS.map(stripSeed);
  const counters: Record<string, number> = {};
  const next = (key: string) => (counters[key] = (counters[key] ?? 0) + 1);

  const orders: SalesOrder[] = [];
  const deliveries: Delivery[] = [];
  const arDocs: ArDocument[] = [];
  const invoices: TaxInvoice[] = [];
  // 字軌號段 (mock): one per bimonthly period the history covers
  let invoiceRanges: InvoiceNumberRange[] = [
    { id: "rng-2026-07", period: "2026-07", track: "ZW", start: 10240001, end: 10269999, next: 10240001, status: "active" },
    { id: "rng-2026-09", period: "2026-09", track: "ZX", start: 10240001, end: 10269999, next: 10240001, status: "active" },
    { id: "rng-2026-11", period: "2026-11", track: "ZY", start: 10240001, end: 10269999, next: 10240001, status: "active" },
  ];

  type PayIntent = { at: string; customerId: string; amount: number; method: Payment["method"]; deliveryDocId?: string; deliveryId?: string; collector: string; note?: string; custody?: Payment["custody"]; noAllocate?: boolean };
  const payIntents: PayIntent[] = [];

  const driverName = (v: "A" | "B") => VEHICLES_SEED.find((x) => x.id === v)!.driverName;

  const customerPrices: CustomerPrice[] = AGREED_PRICES.map(([customerId, productId, amount, unit, taxIncluded, from, note], i) => {
    const c = customers.find((x) => x.id === customerId)!;
    const quoted = { amountCents: twd(amount), unit, taxIncluded };
    const effectiveFrom = from ?? c.onboardedAt;
    return { id: `cp-${i + 1}`, customerId, productId, effectiveFrom, priceExTaxCents: quoteToBaseExTax(quoted, pById.get(productId)!), quoted, note, createdAt: at(effectiveFrom, "10:00"), createdBy: c.accountManagerId };
  });

  const makeLines = (orderId: string, c: CustomerSeed, items: [string, "base" | "pack", number][], date: string): OrderLine[] =>
    items.map(([pid, unit, qty], i) => {
      const p = pById.get(pid)!;
      return {
        id: `${orderId}-L${i + 1}`,
        productId: pid,
        qty,
        unit,
        qtyBase: toBaseQty(p, qty, unit),
        ...linePricing(resolvePrice(customerPrices, c, p, date)),
        taxRateBp: 500,
      };
    });

  // ---------- history: 2026-08-01 → yesterday ----------
  const start = "2026-08-01";
  for (let d = start; d < DEMO_TODAY; d = addDays(d, 1)) {
    const dow = dayOfWeek(d);
    if (dow === 0) continue;
    let dayIdx = 0;
    for (const c of CUSTOMERS) {
      if (!c.days.includes(dow)) continue;
      dayIdx += 1;
      const items = c.basket.filter((_, i) => i === 0 || rng() < 0.75).map(([pid, unit, min, max]) => [pid, unit, rint(min, max)] as [string, "base" | "pack", number]);
      const orderId = `o-${d}-${c.code}`;
      const source: SalesOrder["source"] = c.linkStatus === "linked" ? (rng() < 0.3 ? "LINE" : "APP") : "PHONE";
      const orderNo = `SO-${ymd(d)}-${String(dayIdx).padStart(2, "0")}`;
      const lines = makeLines(orderId, c, items, d);
      orders.push({
        id: orderId,
        no: orderNo,
        customerId: c.id,
        source,
        externalId: `${source}-${ymd(d)}-${c.code}`,
        orderAt: at(addDays(d, -1), `${String(17 + (dayIdx % 4)).padStart(2, "0")}:${String((dayIdx * 7) % 60).padStart(2, "0")}`),
        deliveryDate: d,
        state: "Closed",
        lines,
        createdBy: source === "PHONE" ? "u-sales" : "system",
      });
      const deliveryId = `d-${d}-${c.code}`;
      const deliveredAt = at(d, `${c.window.start.slice(0, 2)}:${String(rint(5, 50)).padStart(2, "0")}`);
      deliveries.push({ id: deliveryId, orderId, customerId: c.id, date: d, vehicleId: c.vehicle, status: "delivered", deliveredAt, noteNo: `DN-${ymd(d)}-${String(dayIdx).padStart(2, "0")}` });

      const charge = buildCharge(lines, pById);
      const exTax = charge.exTaxCents;
      let tax = charge.taxCents;
      // Planted anomaly #2: a manually keyed tax amount on 三味食堂 10/15 (off by NT$1).
      const manualTax = c.id === "C02" && d === "2026-10-15";
      if (manualTax) tax += 100;
      const docId = `ar-${d}-${c.code}`;
      arDocs.push({
        id: docId,
        no: `AR-${ymd(d)}-${String(dayIdx).padStart(2, "0")}`,
        customerId: c.id,
        type: "charge",
        sourceDeliveryId: deliveryId,
        sourceOrderId: orderId,
        issueDate: d,
        exTaxCents: exTax,
        taxCents: tax,
        totalCents: exTax + tax,
        memo: `送貨單 DN-${ymd(d)}-${String(dayIdx).padStart(2, "0")}`,
        items: charge.items,
        priceBasis: charge.priceBasis,
        createdAt: deliveredAt,
        createdBy: manualTax ? "u-sales" : "system",
      });
      const total = exTax + tax;

      // same-day collections
      if (c.settlementTerms === "daily") {
        let amount = total;
        let note: string | undefined;
        if (c.id === "C07" && d === "2026-10-22") {
          amount = total - twd(800);
          note = "客戶表示餘額月底一起付";
        }
        const method: Payment["method"] = c.id === "C11" ? "transfer" : "cash";
        payIntents.push({ at: deliveredAt, customerId: c.id, amount, method, deliveryDocId: docId, deliveryId, collector: method === "cash" ? driverName(c.vehicle) : "銀行入帳", note });
        // Planted anomaly #1: the driver's collection for 阿宏鹹酥雞 on 10/17 was keyed twice.
        if (c.id === "C03" && d === "2026-10-17") {
          const dup = new Date(Date.parse(deliveredAt) + 3 * 60000);
          const dupAt = at(d, `${String(dup.getUTCHours() + 8).padStart(2, "0")}:${String(dup.getUTCMinutes()).padStart(2, "0")}`);
          payIntents.push({ at: dupAt, customerId: c.id, amount, method: "cash", deliveryId, collector: driverName(c.vehicle), noAllocate: true });
        }
      } else if (c.settlementTerms === "mixed") {
        const share = roundToUnit(Math.floor((total * (c.sameDayShareBp ?? 0)) / 10000), 10000);
        payIntents.push({ at: deliveredAt, customerId: c.id, amount: share, method: "cash", deliveryDocId: docId, deliveryId, collector: driverName(c.vehicle), note: "混合結：當日收部分" });
      }

      // 單趟開立: daily customers always; every customer from PER_TRIP_FROM (before that, monthly customers were 月結彙開)
      if (c.settlementTerms === "daily" || d >= PER_TRIP_FROM) {
        const age = (Date.parse(DEMO_TODAY) - Date.parse(d)) / 86400000;
        const inv: TaxInvoice = { ...perTripInvoice(arDocs[arDocs.length - 1], customers.find((x) => x.id === c.id)!, deliveredAt), issuedAt: deliveredAt, providerStatus: "accepted", govUploadStatus: age > (c.invoiceClass === "B2B" ? 7 : 2) ? "uploaded_mock" : "pending_mock", providerRef: `MOCK-${ymd(d)}-${c.code}` };
        if (c.id === "C07" && d === "2026-10-20") {
          inv.providerStatus = "rejected";
          inv.govUploadStatus = "not_uploaded";
          inv.rejectReason = "手機條碼不存在於載具資料（模擬回應）";
        }
        if (d === "2026-10-22") {
          inv.providerStatus = "staged";
          inv.govUploadStatus = "not_uploaded";
          inv.providerRef = undefined;
          if (c.id === "C05") inv.carrierValue = "/LJ05M2";
        }
        // numbers are taken when the invoice is issued; the staged ones get theirs at preflight
        if (inv.providerStatus !== "staged") {
          const t = takeInvoiceNumber(invoiceRanges, d);
          invoiceRanges = invoiceRanges.map((r) => (r.id === t.range.id ? t.range : r));
          Object.assign(inv, { invoiceNo: t.invoiceNo, randomNumber: randomCode(inv.id) });
        }
        invoices.push(inv);
      }
    }
  }

  // ---------- monthly / mixed settlements for Aug & Sep ----------
  const settle = (customerId: string, period: string, payDate: string, amount: number, note?: string) =>
    payIntents.push({ at: at(payDate, "10:30"), customerId, amount, method: "transfer", collector: "銀行入帳", note, custody: "matched" });

  for (const c of CUSTOMERS.filter((x) => x.settlementTerms !== "daily")) {
    for (const period of ["2026-08", "2026-09"]) {
      const { start: ps, end: pe } = periodRange(period);
      const docs = arDocs.filter((d) => d.customerId === c.id && d.issueDate >= ps && d.issueDate <= pe);
      const charged = sum(docs.map((d) => d.totalCents));
      const sameDay = sum(payIntents.filter((p) => p.customerId === c.id && p.at.slice(0, 10) >= ps && p.at.slice(0, 10) <= pe).map((p) => p.amount));
      const due = charged - sameDay;
      const nextMonth = addDays(pe, 1);
      if (c.id === "C10") continue; // 好味便當: Aug & Sep unpaid → overdue
      if (c.id === "C06" && period === "2026-09") {
        settle(c.id, period, "2026-10-20", twd(20000), "9月貨款部分");
        continue;
      }
      settle(c.id, period, addDays(nextMonth, 14 + (Number(c.code.slice(2)) % 6)), due, `${Number(period.slice(5))}月貨款`);
    }
    // monthly invoices for Aug & Sep (B2B, consolidated)
    for (const period of ["2026-08", "2026-09"]) {
      const { start: ps, end: pe } = periodRange(period);
      const docs = arDocs.filter((d) => d.customerId === c.id && d.issueDate >= ps && d.issueDate <= pe && d.type === "charge");
      const exTax = sum(docs.map((d) => d.exTaxCents));
      const tax = taxOnExclusive(exTax);
      invoices.push({
        id: `inv-${period}-${c.code}`,
        provider: "ECPAY_MOCK",
        invoiceClass: "B2B",
        customerId: c.id,
        sourceArIds: docs.map((d) => d.id),
        buyerName: c.name,
        buyerTaxId: c.taxId,
        period,
        issueDate: pe,
        exTaxCents: exTax,
        taxCents: tax,
        totalCents: exTax + tax,
        providerStatus: "accepted",
        govUploadStatus: "uploaded_mock",
        invoiceNo: `ZZ${String(20240000 + invoices.length + 1).padStart(8, "0")}`,
        providerRef: `MOCK-${period}-${c.code}`,
        createdAt: at(pe, "18:00"),
      });
    }
  }
  // Planted anomaly #3: a transfer from 長青自助餐's owner, not yet matched to any receivable.
  payIntents.push({ at: at("2026-10-21", "14:12"), customerId: "C06", amount: twd(8600), method: "transfer", collector: "銀行入帳", note: "匯款人：陳美玉／附言：9月餘款", custody: "received", noAllocate: true });

  // ---------- post payments chronologically with deterministic allocation ----------
  payIntents.sort((a, b) => a.at.localeCompare(b.at) || a.customerId.localeCompare(b.customerId));
  const payments: Payment[] = [];
  const allocations: PaymentAllocation[] = [];
  for (const pi of payIntents) {
    const date = pi.at.slice(0, 10);
    const no = `PM-${ymd(date)}-${String(next(`pm-${date}`)).padStart(2, "0")}`;
    const id = `pm-${ymd(date)}-${String(counters[`pm-${date}`]).padStart(2, "0")}`;
    const ageDays = (Date.parse(DEMO_TODAY) - Date.parse(date)) / 86400000;
    const custody: Payment["custody"] = pi.custody ?? (pi.method === "cash" ? (ageDays > 1 ? "deposited" : "handed_over") : "matched");
    payments.push({
      id,
      no,
      customerId: pi.customerId,
      collectedAt: pi.at,
      method: pi.method,
      grossCents: pi.amount,
      collector: pi.collector,
      deliveryId: pi.deliveryId,
      custody,
      note: pi.note,
      proofRef: pi.method === "cash" ? `簽收聯 ${pi.deliveryId?.slice(-4) ?? ""}` : `網銀 ${ymd(date)}`,
      createdAt: pi.at,
    });
    if (pi.noAllocate) continue;
    const planned = planAllocation(pi.amount, pi.customerId, arDocs.filter((d) => d.issueDate <= date), allocations, pi.deliveryDocId ? [pi.deliveryDocId] : []);
    planned.allocations.forEach((a, i) => allocations.push({ id: `${id}-a${i + 1}`, paymentId: id, arDocumentId: a.arDocumentId, appliedCents: a.appliedCents, at: pi.at }));
  }

  // ---------- inventory ----------
  const locations: StockLocation[] = products.map((p) => ({ id: `loc-${p.shelf}`, zone: p.zone, shelf: p.shelf }));
  const lotPlan: Record<string, [lot: string, expiry: string, received: string, qty: number][]> = {
    P001: [["L260915", "2027-03-15", "2026-09-15", 90], ["L261012", "2027-04-12", "2026-10-12", 150]],
    P002: [["L260920", "2027-03-20", "2026-09-20", 80], ["L261016", "2027-04-16", "2026-10-16", 100]],
    P003: [["L260928", "2027-02-28", "2026-09-28", 60], ["L261015", "2027-04-15", "2026-10-15", 90]],
    P004: [["L260910", "2027-01-10", "2026-09-10", 30], ["L261008", "2027-02-08", "2026-10-08", 40]],
    P005: [["L260502", "2026-11-02", "2026-05-02", 24], ["L260930", "2027-03-30", "2026-09-30", 116]],
    P006: [["L261001", "2027-04-01", "2026-10-01", 90]],
    P007: [["L260420", "2026-10-20", "2026-04-20", 8], ["L260925", "2027-03-25", "2026-09-25", 60]],
    P008: [["L260918", "2027-03-18", "2026-09-18", 50]],
    P009: [["L261005", "2027-04-05", "2026-10-05", 110]],
    P010: [["L260921", "2027-03-21", "2026-09-21", 80]],
    P011: [["L261003", "2027-01-03", "2026-10-03", 70]],
    P012: [["L260912", "2027-03-12", "2026-09-12", 55]],
    P013: [["L260929", "2027-02-28", "2026-09-29", 40]],
    P014: [["L261009", "2027-04-09", "2026-10-09", 30]],
  };
  let lots: InventoryLot[] = products.flatMap((p) =>
    (lotPlan[p.id] ?? []).map(([lot, expiry, receivedAt, qty]) => ({
      id: `lot-${p.id}-${lot}`,
      productId: p.id,
      locationId: `loc-${p.shelf}`,
      zone: p.zone,
      lot,
      expiry,
      receivedAt,
      qtyOnHand: qty,
      qtyReserved: 0,
    })),
  );

  // ---------- today's orders, reservations, deliveries, route v1 ----------
  const reservations: Reservation[] = [];
  const todayStops: RoutePlan["stops"] = [];
  let todayIdx = 0;
  for (const v of ["A", "B"] as const) {
    TODAY_SEQUENCE[v].forEach((cid, i) => {
      const c = CUSTOMERS.find((x) => x.id === cid)!;
      todayIdx += 1;
      const orderId = `o-${DEMO_TODAY}-${c.code}`;
      const isLine = c.id === "C03" || c.id === "C04";
      const source: SalesOrder["source"] = isLine ? "LINE" : c.linkStatus === "linked" ? "APP" : "PHONE";
      const order: SalesOrder = {
        id: orderId,
        no: `SO-${ymd(DEMO_TODAY)}-${String(todayIdx).padStart(2, "0")}`,
        customerId: c.id,
        source,
        externalId: `${source}-${ymd(DEMO_TODAY)}-${c.code}`,
        orderAt: at(DEMO_TODAY, `0${5 + (todayIdx % 2)}:${String(10 + todayIdx * 3).padStart(2, "0")}`),
        deliveryDate: DEMO_TODAY,
        state: "Reserved",
        lines: makeLines(orderId, c, TODAY_ORDERS[c.id], DEMO_TODAY),
        createdBy: source === "PHONE" ? "u-sales" : "system",
        aiExtracted: isLine,
        rawText: c.id === "C03" ? "老闆早 今天花枝丸12包 甜不辣6包 薯條4袋 一樣下午前到就好 謝謝" : c.id === "C04" ? "綠田 今天要 薯條6箱、素雞塊8包、素排骨3包 麻煩了🙏" : undefined,
      };
      const res = reserveOrder(order, lots, DEMO_TODAY, () => `rs-${reservations.length + 1}-${order.id}`);
      if (!res.ok) throw new Error(`seed shortage for ${order.no}: ${JSON.stringify(res.shortages)}`);
      lots = res.lots;
      reservations.push(...res.reservations.map((r, k) => ({ ...r, id: `rs-${order.id}-${k + 1}` })));
      orders.push(order);
      const deliveryId = `d-${DEMO_TODAY}-${c.code}`;
      deliveries.push({ id: deliveryId, orderId, customerId: c.id, date: DEMO_TODAY, vehicleId: v, status: "planned", noteNo: `DN-${ymd(DEMO_TODAY)}-${String(todayIdx).padStart(2, "0")}` });
      todayStops.push({ deliveryId, orderId, customerId: c.id, vehicleId: v, sequence: i + 1 });
    });
  }
  const routePlans: RoutePlan[] = [
    { id: `rp-${DEMO_TODAY}-v1`, date: DEMO_TODAY, version: 1, status: "active", stops: todayStops, createdAt: at(DEMO_TODAY, "06:55"), createdBy: "system", reason: "依客戶慣用車次自動排入" },
  ];

  const purchaseOrders: PurchaseOrder[] = [
    { id: "po-1", no: "PO-261020-01", supplierId: "S01", status: "sent_mock", lines: [{ productId: "P001", qtyBase: 100, unitCostCents: twd(118) }], createdAt: at("2026-10-22", "15:20"), expectedAt: "2026-10-26", createdBy: "u-proc", source: "manual" },
    { id: "po-0", no: "PO-261012-01", supplierId: "S01", status: "received", lines: [{ productId: "P001", qtyBase: 150, unitCostCents: twd(118) }, { productId: "P003", qtyBase: 90, unitCostCents: twd(95) }], createdAt: at("2026-10-10", "11:02"), expectedAt: "2026-10-12", receivedAt: "2026-10-12", createdBy: "u-proc", source: "manual" },
  ];

  // ---------- statements for Aug & Sep (locked snapshots, simulated send) ----------
  const statements: Statement[] = [];
  for (const c of customers.filter((x) => x.settlementTerms !== "daily")) {
    for (const period of ["2026-08", "2026-09"]) {
      const { end } = periodRange(period);
      const n1 = addDays(end, 1);
      const lockedAt = at(addDays(n1, 2), "17:00");
      const preview = buildStatement(c, period, arDocs, payments, allocations.filter((a) => a.at <= lockedAt), invoices);
      statements.push({
        id: `st-${period}-${c.code}-v1`,
        customerId: c.id,
        period,
        version: 1,
        status: "sent_mock",
        totals: preview.totals,
        lines: preview.lines,
        snapshotHash: snapshotHash(preview.lines),
        lockedAt,
        lockedBy: "u-acct",
        reviewedBy: "u-acct",
        reviewedAt: at(addDays(n1, 4), "15:00"),
        releasedBy: "u-owner",
        releasedAt: at(addDays(n1, 7), "10:00"),
        sendLog: [{ at: at(addDays(n1, 7), "10:05"), channel: "line_mock", status: "simulated_delivered", linkExpiresAt: at(addDays(n1, 14), "10:05") }],
      });
    }
  }

  // ---------- event log ----------
  const events: ActionEvent[] = [];
  const ev = (e: Omit<ActionEvent, "id" | "seq" | "correlationId"> & { correlationId?: string }) =>
    events.push({ ...e, id: `ev-${events.length + 1}`, seq: events.length + 1, correlationId: e.correlationId ?? `cor-seed-${events.length + 1}` });
  const user = (id: string) => USERS.find((u) => u.id === id)!;
  ev({ occurredAt: at("2026-10-07", "17:00"), actorType: "user", actorId: "u-acct", actorName: user("u-acct").name, feature: "statements", entityType: "StatementBatch", entityId: "2026-09", action: "lock", summary: "鎖定 9 月對帳單批次（7 位月結／混合客戶）", status: "committed" });
  ev({ occurredAt: at("2026-10-08", "10:00"), actorType: "user", actorId: "u-owner", actorName: user("u-owner").name, feature: "statements", entityType: "StatementBatch", entityId: "2026-09", action: "release", summary: "主管核准 9 月對帳單發送", approvedBy: "u-owner", status: "committed" });
  ev({ occurredAt: at("2026-10-08", "10:05"), actorType: "system", actorId: "line-mock", actorName: "LINE 發送（模擬）", feature: "statements", entityType: "StatementBatch", entityId: "2026-09", action: "send_mock", summary: "9 月對帳單 7 份：模擬發送完成，未實際寄出", externalReceipt: "MOCK-LINE-0908", status: "simulated" });
  ev({ occurredAt: at("2026-10-22", "15:20"), actorType: "user", actorId: "u-proc", actorName: user("u-proc").name, feature: "procurement", entityType: "PurchaseOrder", entityId: "po-1", action: "send_mock", summary: "向北辰冷凍食品叫貨：冷凍雞塊 10 箱（模擬發送）", status: "simulated" });
  ev({ occurredAt: at("2026-10-23", "18:10"), actorType: "user", actorId: "u-acct", actorName: user("u-acct").name, feature: "ar", entityType: "CashHandover", entityId: "2026-10-23", action: "confirm_handover", summary: "確認 10/22 司機現金繳回並存入銀行", status: "committed" });
  ev({ occurredAt: at(DEMO_TODAY, "05:46"), actorType: "system", actorId: "line-webhook", actorName: "LINE Webhook（模擬）", feature: "orders", entityType: "LineMessage", entityId: "msg-ahong", action: "ingest", summary: "收到 阿宏鹹酥雞 LINE 訂貨訊息（事件 ID 去重通過）", status: "committed" });
  ev({ occurredAt: at(DEMO_TODAY, "05:46"), actorType: "agent", actorId: AGENT.id, actorName: AGENT.name, feature: "orders", entityType: "SalesOrder", entityId: `o-${DEMO_TODAY}-AH03`, action: "draft_from_line", summary: "由 LINE 訊息建立訂單草稿：花枝丸 12 包、甜不辣 6 包、薯條 4 袋", status: "proposed", correlationId: "cor-line-ahong" });
  ev({ occurredAt: at(DEMO_TODAY, "06:31"), actorType: "user", actorId: "u-sales", actorName: user("u-sales").name, feature: "orders", entityType: "SalesOrder", entityId: `o-${DEMO_TODAY}-AH03`, action: "validate", summary: "業務確認 阿宏鹹酥雞 LINE 訂單草稿", approvedBy: "u-sales", status: "committed", correlationId: "cor-line-ahong" });
  ev({ occurredAt: at(DEMO_TODAY, "06:50"), actorType: "system", actorId: "reserve", actorName: "庫存保留", feature: "inventory", entityType: "Reservation", entityId: DEMO_TODAY, action: "reserve", summary: "12 張今日訂單完成 FEFO 庫存保留（排除 1 批過期甜不辣）", status: "committed" });
  ev({ occurredAt: at(DEMO_TODAY, "06:55"), actorType: "system", actorId: "route", actorName: "排車", feature: "dispatch", entityType: "RoutePlan", entityId: `rp-${DEMO_TODAY}-v1`, action: "create", summary: "依客戶慣用車次建立今日路線 v1（A 車 5 站／B 車 7 站）", status: "committed" });
  ev({ occurredAt: at(DEMO_TODAY, "06:58"), actorType: "agent", actorId: AGENT.id, actorName: AGENT.name, feature: "dispatch", entityType: "RoutePlan", entityId: `rp-${DEMO_TODAY}-v1`, action: "suggest", summary: "建議將 巷口炸物 由 B 車移至 A 車（待主管確認）", status: "proposed", correlationId: "cor-route-1" });

  const memories: AgentMemory[] = [
    { id: "mem-1", scope: "customer", subjectId: "C06", key: "匯款戶名", valueText: "長青自助餐常以負責人「陳美玉」個人帳戶匯款", provenanceEventId: "ev-5", evidence: "2026-08、2026-09 兩次匯款人工核對紀錄", approvedBy: "u-acct", lastConfirmedAt: at("2026-09-21", "11:00"), expiresAt: "2027-03-31" },
    { id: "mem-2", scope: "customer", subjectId: "C01", key: "對帳單收件", valueText: "福記炸物店對帳單寄給林小姐（LINE 已綁定），偏好每月 5 日前收到", provenanceEventId: "ev-3", evidence: "2026-09 客戶 LINE 回覆", approvedBy: "u-owner", lastConfirmedAt: at("2026-10-08", "10:05") },
    { id: "mem-3", scope: "company", subjectId: "dispatch", key: "週六回倉", valueText: "週六兩車需於 14:00 前回倉，以便下午進貨卸櫃", provenanceEventId: "ev-10", evidence: "主任口頭指示，2026-10-17 確認", approvedBy: "u-owner", lastConfirmedAt: at("2026-10-17", "08:00"), expiresAt: "2026-12-31" },
    { id: "mem-4", scope: "customer", subjectId: "C03", key: "收貨時間", valueText: "阿宏鹹酥雞下午才營業，10:00 前送達無人收貨", provenanceEventId: "ev-8", evidence: "司機回報 2 次（2026-09）", approvedBy: "u-sales", lastConfirmedAt: at("2026-10-03", "16:00") },
  ];

  const aiTasks: AiTask[] = [
    {
      id: "task-route",
      kind: "route_reassign",
      feature: "dispatch",
      title: "巷口炸物 改由 A 車配送",
      summary: "巷口炸物 位於 A 車路線（老街食堂、大樹早餐店）之間，B 車需折返西區。移站後所有硬性限制通過。",
      createdAt: at(DEMO_TODAY, "06:58"),
      requestedBy: AGENT.id,
      status: "awaiting_approval",
      risk: "low",
      plan: ["讀取今日路線 v1 與 12 張訂單", "逐站嘗試換車並檢查限制", "產生前後比較（示意距離）"],
      diff: [],
      validations: [],
      citations: [{ label: "路線 v1", href: "/dispatch" }],
      approverRoles: ["owner"],
      payload: {},
      correlationId: "cor-route-1",
    },
    {
      id: "task-reorder",
      kind: "reorder_draft",
      feature: "procurement",
      title: "香脆薯條、炸花枝丸 低於補貨點",
      summary: "以「現有 − 保留 + 在途」計算，兩品項預估可用量低於補貨點；建議草擬叫貨單給北辰冷凍、海旭水產。",
      createdAt: at(DEMO_TODAY, "06:52"),
      requestedBy: AGENT.id,
      status: "awaiting_approval",
      risk: "medium",
      plan: ["計算預估可用量", "依供應商分組", "草擬 LINE 叫貨訊息（不發送）"],
      diff: [],
      validations: [],
      citations: [{ label: "庫存與凍庫", href: "/inventory" }, { label: "採購", href: "/procurement" }],
      approverRoles: ["owner", "procurement"],
      payload: {},
      correlationId: "cor-reorder-1",
    },
  ];

  const inbox: LineInboxMessage[] = [
    { id: "msg-jinhua", receivedAt: at(DEMO_TODAY, "06:48"), lineUserId: "U-demo-jinhua", displayName: "金華小吃 金姐", text: "早安～明天要 雞塊2箱 薯條5 花枝丸10包，謝謝老闆", status: "new", webhookEventId: "wh-demo-0001" },
    { id: "msg-dashu", receivedAt: at(DEMO_TODAY, "06:59"), displayName: "大樹早餐 蔡", text: "明天跟上次一樣，起司條多2包", status: "new", webhookEventId: "wh-demo-0002" },
  ];

  return {
    seedVersion: SEED_VERSION,
    users: USERS,
    customers,
    crmNotes: CRM_NOTES,
    customerPrices,
    products,
    locations,
    lots,
    adjustments: [],
    suppliers: SUPPLIERS,
    purchaseOrders,
    vehicles: VEHICLES_SEED,
    orders,
    reservations,
    deliveries,
    routePlans,
    pickConfirmations: {},
    arDocs,
    payments,
    allocations,
    invoices,
    // periods that have ended are closed once the history is built
    invoiceRanges: invoiceRanges.map((r) => (r.period < invoicePeriodOf(DEMO_TODAY) ? { ...r, status: "closed" as const } : r)),
    statements,
    events,
    memories,
    aiTasks,
    inbox,
    settings: { autoReorder: { enabled: false, ceilingCents: twd(20000), maxPerDay: 2 }, statementDueDay: 10 },
    counters,
  };
}
