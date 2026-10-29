import type { Cents } from "../money";

/** Canonical demo data model — follows PRD §6, with small, documented extensions. */

export type ZoneId = "A" | "B" | "C" | "D";
export const ZONES: ZoneId[] = ["A", "B", "C", "D"];
export type VehicleId = "A" | "B";
export const VEHICLES: VehicleId[] = ["A", "B"];

export type Role = "owner" | "sales" | "driver" | "warehouse" | "procurement" | "accounting" | "admin";

export interface DemoUser {
  id: string;
  name: string;
  role: Role;
  title: string;
  vehicleId?: VehicleId;
}

export type SettlementTerms = "daily" | "monthly" | "mixed";
export type PriceTier = "standard" | "volume" | "vip";

export interface GeoPoint {
  /** WGS84 latitude / longitude. Demo customers sit on plausible Taichung streets, not real shops. */
  lat: number;
  lng: number;
}

export type CustomerSegment = "餐廳" | "炸物店";

export interface Customer {
  id: string;
  code: string;
  name: string;
  segment: CustomerSegment;
  /** 細分類，例如 便當、自助餐、鹹酥雞。 */
  subType: string;
  /** 負責人（老闆），不一定是收貨聯絡窗口。 */
  ownerName: string;
  /** 往來起始日 YYYY-MM-DD。 */
  onboardedAt: string;
  accountManagerId: string;
  contactName: string;
  phone: string;
  address: string;
  district: string;
  lineUserId?: string;
  linkStatus: "linked" | "pending" | "unlinked";
  settlementTerms: SettlementTerms;
  /** For mixed terms: share collected at delivery, in basis points. */
  sameDayShareBp?: number;
  invoiceClass: "B2B" | "B2C";
  taxId?: string;
  carrier?: { type: "mobile" | "citizen" | "member"; value: string };
  billingContact: string;
  priceTier: PriceTier;
  geo: GeoPoint;
  /** Map position was estimated from the district and still needs confirming. */
  geoPending?: boolean;
  window: { start: string; end: string };
  creditLimitCents: Cents;
}

/**
 * 合約價 — the price a customer was promised for one product, effective from a date.
 * Rows are never edited: a change is a new row with a later effectiveFrom; null price = back to the tier price.
 */
export interface CustomerPrice {
  id: string;
  customerId: string;
  productId: string;
  effectiveFrom: string;
  /** Ex-tax price per base unit (包／袋) — the only figure used for order lines. Null ends the agreement. */
  priceExTaxCents: Cents | null;
  /** The price as it was quoted to the customer, kept for display and audit. */
  quoted?: { amountCents: Cents; unit: "base" | "pack"; taxIncluded: boolean };
  note?: string;
  createdAt: string;
  createdBy: string;
}

export type ProductCategory = "冷凍炸物" | "蔬食" | "調理品";

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: ProductCategory;
  baseUnit: "包" | "袋";
  packUnit: "箱";
  /** Base units per pack (e.g. 10 包 per 箱). */
  packSize: number;
  spec: string;
  weightGramPerBase: number;
  volumeMlPerBase: number;
  zone: ZoneId;
  shelf: string;
  /** Standard cost per base unit; null = 尚無成本資料. */
  costCents: Cents | null;
  price: Record<PriceTier, Cents>;
  taxClass: "taxable" | "exempt";
  supplierId: string;
  reorderPoint: number;
  reorderQty: number;
  tempC: -18 | -25;
  /** Extra names customers use in LINE messages (e.g. 薯條 for 香脆薯條). */
  aliases?: string[];
}

export interface StockLocation {
  id: string;
  zone: ZoneId;
  shelf: string;
}

export interface InventoryLot {
  id: string;
  productId: string;
  locationId: string;
  zone: ZoneId;
  lot: string;
  expiry: string;
  receivedAt: string;
  qtyOnHand: number;
  qtyReserved: number;
}

export interface StockAdjustment {
  id: string;
  lotId: string;
  kind: "physical_count" | "ledger_adjustment";
  delta: number;
  reason: string;
  actorId: string;
  at: string;
}

export type OrderState = "Draft" | "Validated" | "Reserved" | "Picking" | "Shipped" | "Delivered" | "Closed" | "Cancelled" | "Returned";
export type OrderSource = "APP" | "LINE" | "PHONE";

export interface OrderLine {
  id: string;
  productId: string;
  qty: number;
  unit: "base" | "pack";
  /** Quantity in base units — the only quantity used for stock & money. */
  qtyBase: number;
  unitPriceExTaxCents: Cents;
  taxRateBp: number;
  note?: string;
}

export interface DraftIssue {
  field: "customer" | "product" | "qty" | "unit" | "price";
  lineIndex?: number;
  message: string;
  resolved: boolean;
}

export interface SalesOrder {
  id: string;
  no: string;
  customerId: string;
  source: OrderSource;
  externalId: string;
  orderAt: string;
  deliveryDate: string;
  state: OrderState;
  lines: OrderLine[];
  note?: string;
  rawText?: string;
  aiExtracted?: boolean;
  issues?: DraftIssue[];
  createdBy: string;
}

export interface Vehicle {
  id: VehicleId;
  name: string;
  plate: string;
  driverId: string;
  driverName: string;
  capacityKg: number;
  capacityL: number;
  maxShiftMin: number;
  departAt: string;
  color: string;
  frozen: boolean;
}

export interface RouteStop {
  deliveryId: string;
  orderId: string;
  customerId: string;
  vehicleId: VehicleId;
  sequence: number;
}

export interface RoutePlan {
  id: string;
  date: string;
  version: number;
  status: "active" | "superseded";
  stops: RouteStop[];
  createdAt: string;
  createdBy: string;
  approvedBy?: string;
  reason: string;
}

export type DeliveryStatus = "planned" | "loaded" | "en_route" | "delivered" | "failed";

export interface Delivery {
  id: string;
  orderId: string;
  customerId: string;
  date: string;
  vehicleId: VehicleId;
  status: DeliveryStatus;
  deliveredAt?: string;
  /** Delivery note number (送貨單 / 日結單), not a tax invoice. */
  noteNo: string;
}

export type ArDocType = "charge" | "debit_note" | "credit_note" | "write_off";

export interface ArLineItem {
  productId: string;
  name: string;
  qty: number;
  unitLabel: string;
  unitPriceExTaxCents: Cents;
  exTaxCents: Cents;
}

export interface ArDocument {
  id: string;
  no: string;
  customerId: string;
  type: ArDocType;
  sourceDeliveryId?: string;
  sourceOrderId?: string;
  issueDate: string;
  exTaxCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
  memo?: string;
  items?: ArLineItem[];
  /** Set when a reversal/credit fully offsets it; documents are never deleted. */
  voidedBy?: string;
  /** A correction document points at the document it corrects (e.g. tax correction). */
  correctsDocId?: string;
  createdAt: string;
  createdBy: string;
}

export type PaymentMethod = "cash" | "transfer" | "check" | "linepay";

export interface Payment {
  id: string;
  no: string;
  customerId: string;
  collectedAt: string;
  method: PaymentMethod;
  grossCents: Cents;
  collector: string;
  proofRef?: string;
  deliveryId?: string;
  /** cash: collected → handed_over → deposited; transfer: received → matched. */
  custody: "collected" | "handed_over" | "deposited" | "received" | "matched";
  /** A reversal is a new negative payment pointing at the original. */
  reversalOf?: string;
  note?: string;
  createdAt: string;
}

export interface PaymentAllocation {
  id: string;
  paymentId: string;
  arDocumentId: string;
  appliedCents: Cents;
  at: string;
}

export type StatementStatus = "locked" | "reviewed" | "released" | "queued" | "sent_mock" | "superseded";

export interface StatementLine {
  date: string;
  refType: "opening" | "charge" | "debit_note" | "credit_note" | "write_off" | "payment";
  refId: string;
  refNo: string;
  description: string;
  exTaxCents: Cents;
  taxCents: Cents;
  debitCents: Cents;
  creditCents: Cents;
  balanceCents: Cents;
  invoiceNo?: string;
  paidCents?: Cents;
  remainingCents?: Cents;
}

export interface StatementTotals {
  openingCents: Cents;
  chargesCents: Cents;
  debitAdjCents: Cents;
  creditAdjCents: Cents;
  paymentsCents: Cents;
  closingCents: Cents;
  chargesExTaxCents: Cents;
  chargesTaxCents: Cents;
}

export interface Statement {
  id: string;
  customerId: string;
  period: string;
  version: number;
  status: StatementStatus;
  totals: StatementTotals;
  lines: StatementLine[];
  snapshotHash: string;
  lockedAt: string;
  lockedBy: string;
  reviewedBy?: string;
  reviewedAt?: string;
  releasedBy?: string;
  releasedAt?: string;
  sendLog: { at: string; channel: "line_mock" | "email_mock"; status: "queued" | "simulated_delivered" | "failed_retry"; linkExpiresAt?: string }[];
}

export type InvoiceProviderStatus = "staged" | "preflight_failed" | "ready" | "submitted" | "accepted" | "rejected" | "voided" | "allowance";

export interface TaxInvoice {
  id: string;
  provider: "ECPAY_MOCK";
  invoiceClass: "B2B" | "B2C";
  customerId: string;
  sourceArIds: string[];
  buyerName: string;
  buyerTaxId?: string;
  carrierType?: "mobile" | "citizen" | "member";
  carrierValue?: string;
  period: string;
  issueDate: string;
  exTaxCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
  providerStatus: InvoiceProviderStatus;
  govUploadStatus: "not_uploaded" | "pending_mock" | "uploaded_mock";
  invoiceNo?: string;
  providerRef?: string;
  rejectReason?: string;
  allowanceCents?: Cents;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string;
  phone?: string;
  email?: string;
  channel: "line_group" | "phone" | "email";
  lineGroupVerified: boolean;
  leadTimeDays: number;
  approved: boolean;
}

export type PoStatus = "draft" | "pending_approval" | "approved" | "sent_mock" | "received" | "cancelled";

export interface PurchaseOrder {
  id: string;
  no: string;
  supplierId: string;
  status: PoStatus;
  lines: { productId: string; qtyBase: number; unitCostCents: Cents }[];
  createdAt: string;
  expectedAt: string;
  /** Date goods were received (進). */
  receivedAt?: string;
  createdBy: string;
  source: "manual" | "ai_suggestion" | "auto_rule";
  messagePreview?: string;
}

export type ActorType = "user" | "agent" | "system";

export type Feature = "crm" | "orders" | "dispatch" | "picking" | "inventory" | "procurement" | "ar" | "statements" | "invoices" | "ai" | "memory" | "settings";

export interface CustomerNote {
  id: string;
  customerId: string;
  at: string;
  authorId: string;
  authorName: string;
  kind: "call" | "visit" | "line" | "note";
  text: string;
  /** 下次追蹤日 YYYY-MM-DD。 */
  followUpOn?: string;
}

export interface ActionEvent {
  id: string;
  seq: number;
  occurredAt: string;
  actorType: ActorType;
  actorId: string;
  actorName: string;
  feature: Feature;
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  before?: string;
  after?: string;
  reason?: string;
  correlationId: string;
  approvalId?: string;
  approvedBy?: string;
  externalReceipt?: string;
  /** Ledger scope touched by this event — used by the locked-period check. */
  scope?: { customerId?: string; period?: string };
  status: "committed" | "proposed" | "rejected" | "simulated" | "failed";
}

export interface AgentMemory {
  id: string;
  scope: "customer" | "product" | "company" | "supplier";
  subjectId: string;
  key: string;
  valueText: string;
  provenanceEventId: string;
  evidence: string;
  approvedBy: string;
  lastConfirmedAt: string;
  expiresAt?: string;
}

export interface Setting {
  autoReorder: { enabled: boolean; ceilingCents: Cents; maxPerDay: number };
  statementDueDay: number;
}
