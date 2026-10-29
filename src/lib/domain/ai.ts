import type { Cents } from "../money";
import type { Feature } from "./types";

/**
 * AI task lifecycle (PRD Flow F):
 * intent → read-only plan → dry-run diff → deterministic validations → approval → committed action → event.
 * The agent never writes ledger data directly; it produces a task that a permitted role approves.
 */
export type AiTaskKind =
  | "route_reassign"
  | "reorder_draft"
  | "allocate_receipt"
  | "reverse_payment"
  | "tax_correction"
  | "line_order_draft"
  | "set_threshold"
  | "statement_preview"
  | "overdue_report"
  | "month_end_review";

export type AiTaskStatus = "awaiting_approval" | "committed" | "rejected" | "answered" | "blocked";

export interface AiValidation {
  label: string;
  pass: boolean;
  detail?: string;
}

export interface AiDiffRow {
  label: string;
  before: string;
  after: string;
}

export interface AiTask {
  id: string;
  kind: AiTaskKind;
  feature: Feature;
  title: string;
  summary: string;
  command?: string;
  createdAt: string;
  requestedBy: string;
  status: AiTaskStatus;
  risk: "low" | "medium" | "high";
  amountCents?: Cents;
  plan: string[];
  diff: AiDiffRow[];
  validations: AiValidation[];
  citations: { label: string; href?: string }[];
  /** Roles allowed to approve; others see the task read-only. */
  approverRoles: ("owner" | "accounting" | "sales" | "procurement" | "warehouse")[];
  payload: Record<string, unknown>;
  correlationId: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resultNote?: string;
}

export interface LineInboxMessage {
  id: string;
  receivedAt: string;
  lineUserId?: string;
  displayName: string;
  text: string;
  status: "new" | "drafted" | "ignored";
  orderId?: string;
  webhookEventId: string;
}

export const RISK_LABEL = { low: "低風險", medium: "需留意", high: "高風險・財務" } as const;

export interface IntentMatch {
  kind: AiTaskKind;
  args: Record<string, string | number>;
}

/** Scripted intent recognition for the offline demo (no live LLM call). */
export function matchIntent(text: string): IntentMatch | null {
  const t = text.replace(/\s+/g, "");
  if (/(路線|配車|兩台車|A\/?B車|排車)/.test(t)) return { kind: "route_reassign", args: {} };
  const th = t.match(/(薯條|雞塊|花枝丸|雞排|水餃|洋蔥圈|甜不辣|素雞塊)[^\d一二三四五六七八九十]*(?:門檻|低庫存|安全庫存|補貨).*?(\d+)\s*(箱|包|袋)?/);
  if (th) return { kind: "set_threshold", args: { product: th[1], qty: Number(th[2]), unit: th[3] ?? "箱" } };
  if (/(薯條|雞塊|花枝丸).*(低庫存通知|低庫存|門檻)/.test(t)) {
    const p = t.match(/(薯條|雞塊|花枝丸)/)![1];
    return { kind: "set_threshold", args: { product: p, qty: 30, unit: "箱" } };
  }
  if (/(未收款|逾期|欠款|應收未收)/.test(t)) return { kind: "overdue_report", args: {} };
  const st = t.match(/(?:替|幫)?(.{2,6}?)(?:產出|做|出)?月結(?:單)?預覽/);
  if (st && !/本月|檢查/.test(st[1])) return { kind: "statement_preview", args: { customer: st[1] } };
  if (/(檢查|審查).*(月結|對帳)|月結.*(檢查|審查)/.test(t)) return { kind: "month_end_review", args: {} };
  if (/(補貨|叫貨|採購)/.test(t)) return { kind: "reorder_draft", args: {} };
  return null;
}
