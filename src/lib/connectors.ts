import { buildStatement } from "./domain/statements";
import { preflightInvoice, type PreflightIssue } from "./domain/invoices";
import type { Customer, SalesOrder, Statement, TaxInvoice } from "./domain/types";
import type { Db } from "./db";
import { formatTWD } from "./money";
import { formatPeriod } from "./time";

/**
 * Integration contracts. Only mock adapters exist in this demo — none of them make network calls.
 * Production adapters must implement the same interfaces behind server-side credentials (see docs/INTEGRATIONS.md).
 */

export interface LineStatementSender {
  readonly mode: "mock" | "live";
  preview(customer: Customer, statement: Statement): { text: string; linkExpiresInDays: number; eligible: boolean; reason?: string };
  send(customer: Customer, statement: Statement): Promise<{ status: "simulated_delivered" | "queued" | "failed"; receipt: string }>;
}

export interface EcpayInvoiceProvider {
  readonly mode: "mock" | "sandbox" | "live";
  preview(inv: TaxInvoice): { issues: PreflightIssue[] };
  submit(inv: TaxInvoice): Promise<{ accepted: boolean; providerRef: string; reason?: string }>;
  status(providerRef: string): Promise<{ provider: "accepted" | "rejected" | "pending"; government: "not_uploaded" | "pending" | "uploaded" }>;
}

export interface ErpSync {
  readonly mode: "csv_mock" | "api";
  exportOrders(orders: SalesOrder[], db: Db): string;
  importOrders(csv: string): { rows: Record<string, string>[]; errors: string[] };
}

export const mockLine: LineStatementSender = {
  mode: "mock",
  preview(customer, statement) {
    const eligible = customer.linkStatus === "linked";
    return {
      text: `${customer.contactName} 您好，${formatPeriod(statement.period)}對帳單已備妥，期末應收 ${formatTWD(statement.totals.closingCents)}。請點安全連結查看（7 日內有效）。`,
      linkExpiresInDays: 7,
      eligible,
      reason: eligible ? undefined : "客戶未綁定官方帳號，不可推播",
    };
  },
  async send(customer) {
    if (customer.linkStatus !== "linked") return { status: "failed", receipt: "NOT_LINKED" };
    return { status: "simulated_delivered", receipt: `MOCK-LINE-${customer.code}` };
  },
};

export const mockEcpay: EcpayInvoiceProvider = {
  mode: "mock",
  preview: (inv) => ({ issues: preflightInvoice(inv) }),
  async submit(inv) {
    const issues = preflightInvoice(inv);
    return issues.length ? { accepted: false, providerRef: "", reason: issues[0].message } : { accepted: true, providerRef: `MOCK-${inv.id}` };
  },
  async status() {
    return { provider: "accepted", government: "not_uploaded" };
  },
};

const CSV_HEADER = ["order_no", "external_id", "source", "customer_code", "delivery_date", "sku", "qty", "unit", "qty_base", "unit_price_ex_tax", "state"];

export const csvErpSync: ErpSync = {
  mode: "csv_mock",
  exportOrders(orders, db) {
    const cust = new Map(db.customers.map((c) => [c.id, c]));
    const prod = new Map(db.products.map((p) => [p.id, p]));
    const rows = orders.flatMap((o) =>
      o.lines.map((l) => [o.no, o.externalId, o.source, cust.get(o.customerId)?.code ?? "", o.deliveryDate, prod.get(l.productId)?.sku ?? "", l.qty, l.unit === "pack" ? "箱" : prod.get(l.productId)?.baseUnit ?? "", l.qtyBase, l.unitPriceExTaxCents / 100, o.state]),
    );
    return [CSV_HEADER, ...rows].map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
  },
  importOrders(csv) {
    const [head, ...lines] = csv.trim().split(/\r?\n/);
    const cols = head.split(",").map((c) => c.replaceAll('"', "").trim());
    const errors: string[] = [];
    const missing = ["external_id", "customer_code", "sku", "qty"].filter((c) => !cols.includes(c));
    if (missing.length) errors.push(`缺少欄位：${missing.join("、")}`);
    const rows = lines.map((line, i) => {
      const vals = line.split(",").map((v) => v.replaceAll('"', "").trim());
      const row = Object.fromEntries(cols.map((c, j) => [c, vals[j] ?? ""]));
      if (row.qty && !/^\d+$/.test(row.qty)) errors.push(`第 ${i + 2} 行數量不是整數`);
      return row;
    });
    return { rows, errors };
  },
};

export function statementPreviewText(db: Db, customerId: string, period: string) {
  const c = db.customers.find((x) => x.id === customerId)!;
  return buildStatement(c, period, db.arDocs, db.payments, db.allocations, db.invoices);
}
