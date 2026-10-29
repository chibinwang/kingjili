import type { AiTask, LineInboxMessage } from "./domain/ai";
import type { Reservation } from "./domain/inventory";
import type { PickConfirmation } from "./domain/picking";
import type {
  ActionEvent,
  AgentMemory,
  ArDocument,
  Customer,
  CustomerNote,
  Delivery,
  DemoUser,
  InventoryLot,
  Payment,
  PaymentAllocation,
  Product,
  PurchaseOrder,
  RoutePlan,
  SalesOrder,
  Setting,
  Statement,
  StockAdjustment,
  StockLocation,
  Supplier,
  TaxInvoice,
  Vehicle,
} from "./domain/types";

/** The whole demo dataset. A real deployment swaps this in-memory store for repositories over an API. */
export interface Db {
  seedVersion: number;
  users: DemoUser[];
  customers: Customer[];
  crmNotes: CustomerNote[];
  products: Product[];
  locations: StockLocation[];
  lots: InventoryLot[];
  adjustments: StockAdjustment[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  vehicles: Vehicle[];
  orders: SalesOrder[];
  reservations: Reservation[];
  deliveries: Delivery[];
  routePlans: RoutePlan[];
  pickConfirmations: Record<string, PickConfirmation>;
  arDocs: ArDocument[];
  payments: Payment[];
  allocations: PaymentAllocation[];
  invoices: TaxInvoice[];
  statements: Statement[];
  events: ActionEvent[];
  memories: AgentMemory[];
  aiTasks: AiTask[];
  inbox: LineInboxMessage[];
  settings: Setting;
  counters: Record<string, number>;
}
