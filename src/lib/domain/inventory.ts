import type { InventoryLot, Product, PurchaseOrder, SalesOrder } from "./types";

export interface Reservation {
  id: string;
  orderId: string;
  orderLineId: string;
  lotId: string;
  qtyBase: number;
}

export function isExpired(lot: InventoryLot, today: string): boolean {
  return lot.expiry < today;
}

export function daysToExpiry(lot: InventoryLot, today: string): number {
  return Math.round((Date.parse(lot.expiry) - Date.parse(today)) / 86400_000);
}

export function lotAvailable(lot: InventoryLot, today: string): number {
  return isExpired(lot, today) ? 0 : Math.max(0, lot.qtyOnHand - lot.qtyReserved);
}

/** FEFO: first-expiry-first-out among non-expired lots with free quantity. */
export function fefoAllocate(
  lots: InventoryLot[],
  productId: string,
  qtyBase: number,
  today: string,
): { allocations: { lotId: string; qtyBase: number }[]; shortBy: number } {
  const candidates = lots
    .filter((l) => l.productId === productId && lotAvailable(l, today) > 0)
    .sort((a, b) => (a.expiry === b.expiry ? a.receivedAt.localeCompare(b.receivedAt) : a.expiry.localeCompare(b.expiry)));
  let remaining = qtyBase;
  const allocations: { lotId: string; qtyBase: number }[] = [];
  for (const lot of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lotAvailable(lot, today));
    allocations.push({ lotId: lot.id, qtyBase: take });
    remaining -= take;
  }
  return { allocations, shortBy: Math.max(0, remaining) };
}

/** Reserve stock for an order; all-or-nothing — returns a shortage list instead of partial reservation. */
export function reserveOrder(
  order: SalesOrder,
  lots: InventoryLot[],
  today: string,
  nextId: () => string,
): { ok: true; lots: InventoryLot[]; reservations: Reservation[] } | { ok: false; shortages: { productId: string; shortBy: number }[] } {
  const working = lots.map((l) => ({ ...l }));
  const reservations: Reservation[] = [];
  const shortages: { productId: string; shortBy: number }[] = [];
  for (const line of order.lines) {
    const { allocations, shortBy } = fefoAllocate(working, line.productId, line.qtyBase, today);
    if (shortBy > 0) {
      shortages.push({ productId: line.productId, shortBy });
      continue;
    }
    for (const a of allocations) {
      const lot = working.find((l) => l.id === a.lotId)!;
      lot.qtyReserved += a.qtyBase;
      reservations.push({ id: nextId(), orderId: order.id, orderLineId: line.id, lotId: a.lotId, qtyBase: a.qtyBase });
    }
  }
  if (shortages.length) return { ok: false, shortages };
  return { ok: true, lots: working, reservations };
}

export function releaseReservations(lots: InventoryLot[], reservations: Reservation[]): InventoryLot[] {
  return lots.map((lot) => {
    const released = reservations.filter((r) => r.lotId === lot.id).reduce((a, r) => a + r.qtyBase, 0);
    return released ? { ...lot, qtyReserved: lot.qtyReserved - released } : lot;
  });
}

export interface StockPosition {
  productId: string;
  onHand: number;
  reserved: number;
  expired: number;
  inbound: number;
  /** projected available = on-hand (non-expired) − reserved + inbound */
  projected: number;
  available: number;
  belowReorder: boolean;
  suggestedQty: number;
  nearestExpiry?: string;
}

export function inboundQty(pos: PurchaseOrder[], productId: string): number {
  return pos
    .filter((po) => po.status === "approved" || po.status === "sent_mock")
    .flatMap((po) => po.lines)
    .filter((l) => l.productId === productId)
    .reduce((a, l) => a + l.qtyBase, 0);
}

export function stockPosition(product: Product, lots: InventoryLot[], pos: PurchaseOrder[], today: string): StockPosition {
  const mine = lots.filter((l) => l.productId === product.id);
  const expired = mine.filter((l) => isExpired(l, today)).reduce((a, l) => a + l.qtyOnHand, 0);
  const onHand = mine.reduce((a, l) => a + l.qtyOnHand, 0);
  const reserved = mine.reduce((a, l) => a + l.qtyReserved, 0);
  const inbound = inboundQty(pos, product.id);
  const available = onHand - expired - reserved;
  const projected = available + inbound;
  const belowReorder = projected < product.reorderPoint;
  // Order enough to get back above the reorder point, in whole packs, at least the standard reorder qty.
  const gap = product.reorderPoint - projected;
  const raw = belowReorder ? Math.max(product.reorderQty, gap + product.reorderQty / 2) : 0;
  const suggestedQty = raw > 0 ? Math.ceil(raw / product.packSize) * product.packSize : 0;
  const nearestExpiry = mine
    .filter((l) => !isExpired(l, today) && l.qtyOnHand > 0)
    .map((l) => l.expiry)
    .sort()[0];
  return { productId: product.id, onHand, reserved, expired, inbound, projected, available, belowReorder, suggestedQty, nearestExpiry };
}
