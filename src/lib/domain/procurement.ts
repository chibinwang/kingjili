import { formatTWD } from "../money";
import { addDays } from "../time";
import type { StockPosition } from "./inventory";
import type { Product, PurchaseOrder, Setting, Supplier } from "./types";

export interface ReorderSuggestion {
  productId: string;
  supplierId: string;
  qtyBase: number;
  position: StockPosition;
}

export function reorderSuggestions(products: Product[], positions: Map<string, StockPosition>): ReorderSuggestion[] {
  return products
    .map((p) => ({ p, pos: positions.get(p.id)! }))
    .filter(({ pos }) => pos.belowReorder)
    .map(({ p, pos }) => ({ productId: p.id, supplierId: p.supplierId, qtyBase: pos.suggestedQty, position: pos }));
}

export function poTotal(po: PurchaseOrder): number {
  return po.lines.reduce((a, l) => a + l.qtyBase * l.unitCostCents, 0);
}

/** Draft supplier message. Sent only after approval, and only to a verified, approved supplier channel. */
export function supplierMessage(supplier: Supplier, lines: { product: Product; qtyBase: number }[], deliveryDate: string): string {
  const items = lines
    .map(({ product, qtyBase }) => {
      const packs = qtyBase / product.packSize;
      return `・${product.name}（${product.spec}）${Number.isInteger(packs) ? `${packs} ${product.packUnit}` : `${qtyBase} ${product.baseUnit}`}`;
    })
    .join("\n");
  return `${supplier.contactName} 您好，金吉利食品叫貨：\n${items}\n希望 ${deliveryDate.slice(5).replace("-", "/")} 前送達，送貨時請附批號與效期。謝謝！\n（示範訊息，未實際發送）`;
}

export interface AutoReorderCheck {
  allowed: boolean;
  reasons: string[];
}

/** Guardrails for opt-in auto reorder — off by default; ceiling, rate limit and approved-supplier rules. */
export function checkAutoReorder(setting: Setting, supplier: Supplier, amountCents: number, autoPosToday: number): AutoReorderCheck {
  const reasons: string[] = [];
  if (!setting.autoReorder.enabled) reasons.push("自動補貨未啟用（預設關閉）");
  if (!supplier.approved) reasons.push("供應商未在核准名單");
  if (supplier.channel === "line_group" && !supplier.lineGroupVerified) reasons.push("供應商 LINE 群組未驗證");
  if (amountCents > setting.autoReorder.ceilingCents) reasons.push(`金額 ${formatTWD(amountCents)} 超過單筆上限 ${formatTWD(setting.autoReorder.ceilingCents)}`);
  if (autoPosToday >= setting.autoReorder.maxPerDay) reasons.push(`今日自動叫貨已達 ${setting.autoReorder.maxPerDay} 筆上限`);
  return { allowed: reasons.length === 0, reasons };
}

export function expectedArrival(today: string, supplier: Supplier): string {
  return addDays(today, supplier.leadTimeDays);
}
