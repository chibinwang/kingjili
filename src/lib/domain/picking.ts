import { displayQty } from "./orders";
import type { Reservation } from "./inventory";
import type { Customer, InventoryLot, Product, RoutePlan, SalesOrder, VehicleId, ZoneId } from "./types";
import { ZONES } from "./types";

/** One line per order line: what to pull, from which cold room, for which truck & customer. */
export interface PickLine {
  id: string;
  orderLineId: string;
  orderId: string;
  orderNo: string;
  zone: ZoneId;
  shelf: string;
  productId: string;
  sku: string;
  productName: string;
  qty: number;
  unit: string;
  qtyBase: number;
  vehicleId: VehicleId;
  stopSequence: number;
  customerId: string;
  customerName: string;
  source: SalesOrder["source"];
  lots: { lot: string; expiry: string; qtyBase: number }[];
  note?: string;
}

export interface PickContext {
  orders: SalesOrder[];
  products: Map<string, Product>;
  customers: Map<string, Customer>;
  lots: Map<string, InventoryLot>;
  reservations: Reservation[];
}

export function buildPickLines(plan: RoutePlan, ctx: PickContext): PickLine[] {
  const orderById = new Map(ctx.orders.map((o) => [o.id, o]));
  const lines: PickLine[] = [];
  for (const stop of plan.stops) {
    const order = orderById.get(stop.orderId);
    if (!order || order.state === "Cancelled") continue;
    const customer = ctx.customers.get(order.customerId)!;
    for (const l of order.lines) {
      const p = ctx.products.get(l.productId)!;
      const { qty, unit } = displayQty(l, p);
      const lots = ctx.reservations
        .filter((r) => r.orderLineId === l.id)
        .map((r) => {
          const lot = ctx.lots.get(r.lotId)!;
          return { lot: lot.lot, expiry: lot.expiry, qtyBase: r.qtyBase };
        });
      lines.push({
        id: `pk-${l.id}`,
        orderLineId: l.id,
        orderId: order.id,
        orderNo: order.no,
        zone: p.zone,
        shelf: p.shelf,
        productId: p.id,
        sku: p.sku,
        productName: p.name,
        qty,
        unit,
        qtyBase: l.qtyBase,
        vehicleId: stop.vehicleId,
        stopSequence: stop.sequence,
        customerId: customer.id,
        customerName: customer.name,
        source: order.source,
        lots,
        note: l.note,
      });
    }
  }
  return lines;
}

export interface ZoneGroup {
  zone: ZoneId;
  skus: {
    productId: string;
    sku: string;
    name: string;
    shelf: string;
    totalBase: number;
    totalLabel: string;
    lines: PickLine[];
  }[];
  lineCount: number;
}

/** Zone-first run: A → B → C → D, each SKU aggregated once so each freezer is opened once. */
export function groupByZone(lines: PickLine[], products: Map<string, Product>): ZoneGroup[] {
  return ZONES.map((zone) => {
    const inZone = lines.filter((l) => l.zone === zone);
    const bySku = new Map<string, PickLine[]>();
    for (const l of inZone) bySku.set(l.productId, [...(bySku.get(l.productId) ?? []), l]);
    const skus = [...bySku.entries()]
      .map(([productId, ls]) => {
        const p = products.get(productId)!;
        const totalBase = ls.reduce((a, l) => a + l.qtyBase, 0);
        const packs = Math.floor(totalBase / p.packSize);
        const loose = totalBase % p.packSize;
        const totalLabel = packs && loose ? `${packs} ${p.packUnit} + ${loose} ${p.baseUnit}` : packs ? `${packs} ${p.packUnit}` : `${loose} ${p.baseUnit}`;
        return {
          productId,
          sku: p.sku,
          name: p.name,
          shelf: p.shelf,
          totalBase,
          totalLabel,
          lines: [...ls].sort((a, b) => a.vehicleId.localeCompare(b.vehicleId) || a.stopSequence - b.stopSequence),
        };
      })
      .sort((a, b) => a.shelf.localeCompare(b.shelf) || a.sku.localeCompare(b.sku));
    return { zone, skus, lineCount: inZone.length };
  });
}

/** Truck view: grouped per stop in delivery order, each stop's lines in zone order. */
export function groupByVehicle(lines: PickLine[]): Record<VehicleId, { stopSequence: number; customerId: string; customerName: string; orderNo: string; lines: PickLine[] }[]> {
  const out = { A: [], B: [] } as Record<VehicleId, { stopSequence: number; customerId: string; customerName: string; orderNo: string; lines: PickLine[] }[]>;
  for (const v of ["A", "B"] as VehicleId[]) {
    const mine = lines.filter((l) => l.vehicleId === v);
    const stops = new Map<number, PickLine[]>();
    for (const l of mine) stops.set(l.stopSequence, [...(stops.get(l.stopSequence) ?? []), l]);
    out[v] = [...stops.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seq, ls]) => ({
        stopSequence: seq,
        customerId: ls[0].customerId,
        customerName: ls[0].customerName,
        orderNo: ls[0].orderNo,
        lines: [...ls].sort((a, b) => a.zone.localeCompare(b.zone) || a.sku.localeCompare(b.sku)),
      }));
  }
  return out;
}

export interface PickConfirmation {
  qtyBase: number;
  at: string;
  by: string;
  routeVersion: number;
  vehicleAtPick: VehicleId;
  flagged?: string;
}

export type PickStatus = "pending" | "ok" | "short" | "over" | "moved";

export function pickStatus(line: PickLine, conf: PickConfirmation | undefined): PickStatus {
  if (!conf) return "pending";
  if (conf.vehicleAtPick !== line.vehicleId) return "moved";
  if (conf.qtyBase < line.qtyBase) return "short";
  if (conf.qtyBase > line.qtyBase) return "over";
  return "ok";
}
