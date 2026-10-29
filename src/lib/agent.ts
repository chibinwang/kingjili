import { matchIntent, type AiTask } from "./domain/ai";
import { paymentUnapplied } from "./domain/ar";
import { CHECK_META } from "./domain/audit";
import { buildStatement } from "./domain/statements";
import { hhmm } from "./time";
import {
  addAiTask,
  allocateReceipt,
  applyRoutePlan,
  correctTax,
  draftPurchaseOrders,
  reversePayment,
  setReorderPoint,
  type ActCtx,
} from "./actions";
import type { Db } from "./db";
import { formatTWD } from "./money";
import { arSummary, auditFor, maps, routeView, stockPositions } from "./selectors";
import type { RouteStop } from "./domain/types";
import { DEMO_TODAY, formatPeriod, periodOf } from "./time";

/**
 * Scripted agent for the offline demo. It turns a command into a task:
 * read-only plan → dry-run diff → deterministic validations → (approval) → committed action.
 * There is no live LLM call; every number shown is computed from the local ledger.
 */
type TaskSpec = Omit<AiTask, "id" | "createdAt" | "correlationId">;

const PRODUCT_WORDS: Record<string, string> = { 薯條: "P003", 雞塊: "P001", 花枝丸: "P004", 雞排: "P002", 水餃: "P005", 洋蔥圈: "P008", 甜不辣: "P007", 素雞塊: "P006" };

export function routeTaskSpec(db: Db, command?: string): TaskSpec {
  const view = routeView(db);
  const m = maps(db);
  if (!view?.suggestion) {
    return {
      kind: "route_reassign",
      feature: "dispatch",
      title: "今日路線已無可改善的單站調整",
      summary: "所有單站換車方案都無法在滿足硬性限制下縮短距離。",
      command,
      requestedBy: "agent",
      status: "answered",
      risk: "low",
      plan: ["讀取今日路線", "嘗試逐站換車並檢查限制"],
      diff: [],
      validations: [],
      citations: [{ label: "今日配送", href: "/dispatch" }],
      approverRoles: ["owner"],
      payload: {},
    };
  }
  const s = view.suggestion;
  const c = m.customers.get(s.customerId)!;
  const late = view.evaluation.routes.B.stops.filter((x) => x.late).concat(view.evaluation.routes.A.stops.filter((x) => x.late));
  return {
    kind: "route_reassign",
    feature: "dispatch",
    title: `${c.name} 由 ${s.from} 車改至 ${s.to} 車第 ${s.position} 站`,
    summary: `${c.name} 與 ${m.customers.get(s.nearestNeighbor?.customerId ?? "")?.name ?? "A 車客戶"} 相距約 ${s.nearestNeighbor?.km.toFixed(1)} km；${s.from} 車目前需折返。${late.length ? `現行路線有 ${late.length} 站超出收貨時段，調整後全部準時。` : ""}`,
    command,
    requestedBy: "agent",
    status: "awaiting_approval",
    risk: "low",
    plan: ["讀取今日路線 v" + view.plan.version + " 與訂單重量／容積", "逐站嘗試換車（所有插入位置）", "過濾未通過硬性限制的方案", "取距離節省最大者"],
    diff: [
      { label: `${c.name} 車次`, before: `${s.from} 車`, after: `${s.to} 車第 ${s.position} 站` },
      { label: "兩車總里程（示意）", before: `${view.evaluation.totalKm.toFixed(1)} km`, after: `${s.after.totalKm.toFixed(1)} km` },
      { label: `${s.from} 車回倉`, before: hhmm(s.before.routes[s.from].returnMin), after: hhmm(s.after.routes[s.from].returnMin) },
      { label: `${s.to} 車回倉`, before: hhmm(s.before.routes[s.to].returnMin), after: hhmm(s.after.routes[s.to].returnMin) },
    ],
    validations: [...s.after.constraints.A.map((x) => ({ label: `A 車・${x.label}`, pass: x.pass, detail: x.detail })), ...s.after.constraints.B.map((x) => ({ label: `B 車・${x.label}`, pass: x.pass, detail: x.detail }))],
    citations: [{ label: `路線 v${view.plan.version}`, href: "/dispatch" }, { label: c.name, href: `/customers?id=${c.id}` }],
    approverRoles: ["owner"],
    payload: { expectedVersion: view.plan.version, stops: s.stops },
  };
}

export function reorderTaskSpec(db: Db, command?: string): TaskSpec {
  const pos = stockPositions(db);
  const m = maps(db);
  const low = db.products.filter((p) => pos.get(p.id)!.belowReorder);
  return {
    kind: "reorder_draft",
    feature: "procurement",
    title: low.length ? `${low.map((p) => p.name).join("、")} 建議補貨` : "目前沒有低於補貨點的品項",
    summary: "預估可用量 = 現有（排除過期） − 已保留 + 在途。只草擬叫貨單，核准後才可發送。",
    command,
    requestedBy: "agent",
    status: low.length ? "awaiting_approval" : "answered",
    risk: "medium",
    plan: ["計算各品項預估可用量", "比對補貨點", "依供應商分組並取整箱", "草擬叫貨訊息（不發送）"],
    diff: low.map((p) => {
      const s = pos.get(p.id)!;
      return { label: `${p.name}（${m.suppliers.get(p.supplierId)?.name}）`, before: `可用 ${s.projected} ${p.baseUnit}／補貨點 ${p.reorderPoint}`, after: `叫貨 ${s.suggestedQty / p.packSize} ${p.packUnit}` };
    }),
    validations: [
      { label: "供應商在核准名單", pass: low.every((p) => m.suppliers.get(p.supplierId)?.approved) },
      { label: "自動補貨未啟用 → 需人工核准", pass: true, detail: "預設關閉" },
      { label: "未直接發送訊息", pass: true },
    ],
    citations: low.map((p) => ({ label: `${p.sku} ${p.name}`, href: "/inventory" })),
    approverRoles: ["owner", "procurement"],
    payload: { lines: low.map((p) => ({ productId: p.id, qtyBase: pos.get(p.id)!.suggestedQty })) },
  };
}

function thresholdSpec(db: Db, productWord: string, qty: number, unit: string, command: string): TaskSpec {
  const pid = PRODUCT_WORDS[productWord] ?? "P003";
  const p = maps(db).products.get(pid)!;
  const qtyBase = unit === "箱" ? qty * p.packSize : qty;
  const pos = stockPositions(db).get(pid)!;
  const fmt = (q: number) => (q % p.packSize === 0 ? `${q / p.packSize} ${p.packUnit}（${q} ${p.baseUnit}）` : `${q} ${p.baseUnit}`);
  return {
    kind: "set_threshold",
    feature: "inventory",
    title: `${p.name} 補貨門檻設為 ${qty} ${unit}`,
    summary: `變更後預估可用 ${pos.projected} ${p.baseUnit} ${pos.projected < qtyBase ? "低於" : "高於"}新門檻，${pos.projected < qtyBase ? "將出現在補貨建議" : "暫不觸發補貨"}。只改門檻，不會自動叫貨。`,
    command,
    requestedBy: "agent",
    status: "awaiting_approval",
    risk: "low",
    plan: [`查詢 ${p.sku} ${p.name} 目前門檻`, "換算單位（箱→基本單位）", "預覽補貨觸發結果"],
    diff: [
      { label: "補貨點", before: fmt(p.reorderPoint), after: fmt(qtyBase) },
      { label: "低庫存通知", before: pos.belowReorder ? "已觸發" : "未觸發", after: pos.projected < qtyBase ? "觸發" : "未觸發" },
    ],
    validations: [
      { label: "單位換算", pass: true, detail: `1 ${p.packUnit} = ${p.packSize} ${p.baseUnit}` },
      { label: "門檻 ≥ 0 且為整數", pass: Number.isInteger(qtyBase) && qtyBase >= 0 },
      { label: "不觸發自動叫貨（自動補貨關閉）", pass: !db.settings.autoReorder.enabled },
    ],
    citations: [{ label: `${p.sku} ${p.name}`, href: "/inventory" }],
    approverRoles: ["owner", "procurement"],
    payload: { productId: pid, qtyBase },
  };
}

function overdueSpec(db: Db, command: string): TaskSpec {
  const ar = arSummary(db);
  const m = maps(db);
  const rows = ar.rows.filter((r) => r.overdue > 0).sort((a, b) => b.overdue - a.overdue);
  return {
    kind: "overdue_report",
    feature: "ar",
    title: `10 月逾期未收：${rows.length} 位客戶，共 ${formatTWD(ar.overdue)}`,
    summary: rows.map((r) => `${m.customers.get(r.customerId)?.name} ${formatTWD(r.overdue)}（最久逾期 ${Math.max(...r.openDocs.map((o) => o.daysLate))} 天）`).join("；") || "沒有逾期款項。",
    command,
    requestedBy: "agent",
    status: "answered",
    risk: "low",
    plan: ["依客戶結帳條件計算到期日", "比對沖帳後未收餘額", "依逾期天數分組"],
    diff: rows.map((r) => ({ label: m.customers.get(r.customerId)!.name, before: `未收 ${formatTWD(r.balance)}`, after: `逾期 ${formatTWD(r.overdue)}` })),
    validations: [{ label: "數字來自應收子帳（非 AI 記憶）", pass: true }],
    citations: rows.map((r) => ({ label: m.customers.get(r.customerId)!.name, href: `/customers?id=${r.customerId}` })),
    approverRoles: [],
    payload: {},
  };
}

function statementSpec(db: Db, word: string, command: string): TaskSpec {
  const c = db.customers.find((x) => x.name.includes(word) || word.includes(x.name.slice(0, 2)));
  if (!c) {
    return { kind: "statement_preview", feature: "statements", title: `找不到客戶「${word}」`, summary: "請輸入完整客戶名稱。", command, requestedBy: "agent", status: "answered", risk: "low", plan: [], diff: [], validations: [], citations: [], approverRoles: [], payload: {} };
  }
  const period = periodOf(DEMO_TODAY);
  const st = buildStatement(c, period, db.arDocs, db.payments, db.allocations, db.invoices);
  return {
    kind: "statement_preview",
    feature: "statements",
    title: `${c.name} ${formatPeriod(period)} 對帳預覽`,
    summary: `期初 ${formatTWD(st.totals.openingCents)} + 出貨 ${formatTWD(st.totals.chargesCents)} − 收款 ${formatTWD(st.totals.paymentsCents)} = 期末 ${formatTWD(st.totals.closingCents)}（${st.deliveryCount} 張送貨單，${st.reconciles ? "與子帳一致" : "與子帳不一致"}）。`,
    command,
    requestedBy: "agent",
    status: "answered",
    risk: "low",
    plan: ["讀取客戶結帳條件", "彙整期間送貨單、調整與收款", "逐筆累計並與子帳比對"],
    diff: [],
    validations: [{ label: "期末 = 應收子帳", pass: st.reconciles }],
    citations: [{ label: "開啟對帳預覽", href: `/accounting?customer=${c.id}&period=${period}` }],
    approverRoles: [],
    payload: { customerId: c.id, period },
  };
}

function reviewSpec(db: Db, command: string): TaskSpec {
  const period = periodOf(DEMO_TODAY);
  const checks = auditFor(db, period);
  const flags = checks.flatMap((c) => c.flags);
  return {
    kind: "month_end_review",
    feature: "statements",
    title: `${formatPeriod(period)} 全月審查：${flags.length} 個旗標`,
    summary: flags.length ? `${checks.filter((c) => c.flags.length).map((c) => `${c.label} ${c.flags.length}`).join("、")}。判定由規則引擎執行，AI 只解釋原因與建議下一步。` : "所有檢查通過。",
    command,
    requestedBy: "agent",
    status: "answered",
    risk: flags.length ? "medium" : "low",
    plan: Object.values(CHECK_META).map((m) => m.label),
    diff: [],
    validations: checks.map((c) => ({ label: c.label, pass: c.flags.length === 0, detail: c.flags.length ? `${c.flags.length} 筆` : undefined })),
    citations: [{ label: "開啟批次對帳審查", href: "/accounting?tab=review" }],
    approverRoles: [],
    payload: { period },
  };
}

export function planCommand(db: Db, text: string): TaskSpec {
  const intent = matchIntent(text);
  if (!intent) {
    return {
      kind: "overdue_report",
      feature: "ai",
      title: "我還不會處理這個指令",
      summary: "示範版支援：整理今天 A/B 車路線、找出逾期未收款、設定低庫存門檻、產出客戶月結預覽、檢查本月月結、補貨建議。",
      command: text,
      requestedBy: "agent",
      status: "answered",
      risk: "low",
      plan: [],
      diff: [],
      validations: [],
      citations: [],
      approverRoles: [],
      payload: {},
    };
  }
  switch (intent.kind) {
    case "route_reassign":
      return routeTaskSpec(db, text);
    case "set_threshold":
      return thresholdSpec(db, String(intent.args.product), Number(intent.args.qty), String(intent.args.unit), text);
    case "overdue_report":
      return overdueSpec(db, text);
    case "statement_preview":
      return statementSpec(db, String(intent.args.customer), text);
    case "month_end_review":
      return reviewSpec(db, text);
    case "reorder_draft":
      return reorderTaskSpec(db, text);
    default:
      return overdueSpec(db, text);
  }
}

export function proposeFromCommand(db: Db, ctx: ActCtx, text: string) {
  const spec = planCommand(db, text);
  const { db: next, task } = addAiTask(db, ctx, spec);
  return { db: next, value: task };
}

/** Proposal for an audit flag: the agent explains, a human approves the concrete correcting action. */
export function flagTaskSpec(db: Db, flagId: string): TaskSpec | null {
  const period = periodOf(DEMO_TODAY);
  const flag = auditFor(db, period).flatMap((c) => c.flags).find((f) => f.id === flagId);
  if (!flag) return null;
  const m = maps(db);
  const c = m.customers.get(flag.customerId)!;
  if (flag.check === "duplicate_payment") {
    const dupId = flag.refs[1].id;
    const p = m.payments.get(dupId)!;
    return {
      kind: "reverse_payment",
      feature: "ar",
      title: `沖回 ${c.name} 重複收款 ${p.no}`,
      summary: `${flag.refs[0].no} 已沖抵送貨單；${p.no} 同送貨單、同金額、相隔 3 分鐘，且未對應任何應收，造成客戶溢收。建議以沖回分錄抵銷（原紀錄保留）。若司機實際收了兩次，應改為退款或留作預收。`,
      requestedBy: "agent",
      status: "awaiting_approval",
      risk: "high",
      amountCents: p.grossCents,
      plan: ["比對同送貨單收款", "確認第二筆未沖帳", "產生沖回分錄草稿"],
      diff: [
        { label: `${p.no}`, before: `NT$${p.grossCents / 100} 未沖`, after: `由 ${p.no}-R 抵銷` },
        { label: `${c.name} 期末`, before: "溢收", after: "歸零" },
      ],
      validations: [
        { label: "原收款不刪除、不修改", pass: true },
        { label: "需會計核准", pass: true },
        { label: "期間未關帳", pass: !db.statements.some((s) => s.customerId === c.id && s.period === period && ["released", "sent_mock"].includes(s.status)) },
      ],
      citations: flag.refs.map((r) => ({ label: r.no, href: `/customers?id=${c.id}` })),
      approverRoles: ["accounting"],
      payload: { paymentId: dupId, flagId },
    };
  }
  if (flag.check === "unmatched_receipt") {
    const p = m.payments.get(flag.refs[0].id)!;
    const mem = db.memories.find((x) => x.subjectId === c.id && x.key === "匯款戶名");
    return {
      kind: "allocate_receipt",
      feature: "ar",
      title: `${c.name} ${p.no} 沖抵最舊未收`,
      summary: `匯款 ${formatTWD(paymentUnapplied(p, db.allocations))} 附言「${p.note ?? ""}」。${mem ? `工作記憶：${mem.valueText}（僅作為比對線索，金額以子帳為準）。` : ""}建議由舊到新沖抵 9 月未收送貨單。`,
      requestedBy: "agent",
      status: "awaiting_approval",
      risk: "high",
      amountCents: paymentUnapplied(p, db.allocations),
      plan: ["讀取未沖收款", "列出客戶未收應收（由舊到新）", "產生沖帳草稿"],
      diff: [{ label: p.no, before: `未沖 ${formatTWD(paymentUnapplied(p, db.allocations))}`, after: "沖抵 9 月送貨單" }],
      validations: [
        { label: "收款人與客戶一致（依附言＋記憶線索）", pass: !!mem, detail: mem ? "需會計確認" : "無記憶線索" },
        { label: "不超沖任何單據", pass: true },
      ],
      citations: [{ label: p.no, href: `/customers?id=${c.id}` }, ...(mem ? [{ label: `記憶：${mem.key}`, href: "/ai?tab=memory" }] : [])],
      approverRoles: ["accounting"],
      payload: { paymentId: p.id, flagId },
    };
  }
  if (flag.check === "tax_mismatch") {
    const d = m.arDocs.get(flag.refs[0].id)!;
    return {
      kind: "tax_correction",
      feature: "ar",
      title: `更正 ${d.no} 稅額`,
      summary: `${d.no} 稅額為手動輸入（建立者：${m.users.get(d.createdBy)?.name ?? d.createdBy}），比規則計算多 ${formatTWD(flag.amountCents ?? 0)}。建議開立貸項更正單，不修改原單據；同時確認是否已開出發票。`,
      requestedBy: "agent",
      status: "awaiting_approval",
      risk: "high",
      amountCents: Math.abs(flag.amountCents ?? 0),
      plan: ["重算 未稅 × 5% 四捨五入至元", "比對實際稅額", "草擬貸項更正單"],
      diff: [{ label: `${d.no} 稅額`, before: formatTWD(d.taxCents), after: formatTWD(d.taxCents - (flag.amountCents ?? 0)) }],
      validations: [{ label: "原單據不修改", pass: true }, { label: "需會計核准", pass: true }],
      citations: [{ label: d.no, href: `/customers?id=${c.id}` }],
      approverRoles: ["accounting"],
      payload: { docId: d.id, flagId },
    };
  }
  return null;
}

/** Execute an approved task through the same permission-checked actions a human would use. */
export function executeTask(db: Db, ctx: ActCtx, task: AiTask): Db {
  const c = { ...ctx, correlationId: task.correlationId, approvedBy: ctx.actor.id };
  switch (task.kind) {
    case "route_reassign": {
      const p = task.payload as { expectedVersion: number; stops: RouteStop[] };
      if (!p.stops) {
        const spec = routeTaskSpec(db);
        const sp = spec.payload as { expectedVersion: number; stops: RouteStop[] };
        if (!sp.stops) throw new Error("目前沒有可套用的路線建議");
        return applyRoutePlan(db, c, sp.expectedVersion, sp.stops, "核准 AI 路線建議", task.id);
      }
      return applyRoutePlan(db, c, p.expectedVersion, p.stops, "核准 AI 路線建議", task.id);
    }
    case "reorder_draft": {
      let lines = (task.payload as { lines?: { productId: string; qtyBase: number }[] }).lines;
      if (!lines) lines = (reorderTaskSpec(db).payload as { lines: { productId: string; qtyBase: number }[] }).lines;
      return draftPurchaseOrders(db, c, lines, "ai_suggestion", task.id);
    }
    case "set_threshold": {
      const p = task.payload as { productId: string; qtyBase: number };
      return setReorderPoint(db, c, p.productId, p.qtyBase, task.command ?? "AI 指令", task.id);
    }
    case "reverse_payment":
      return reversePayment(db, c, String(task.payload.paymentId), "全月審查：同送貨單重複登錄", task.id);
    case "allocate_receipt":
      return allocateReceipt(db, c, String(task.payload.paymentId), task.id);
    case "tax_correction":
      return correctTax(db, c, String(task.payload.docId), task.id);
    default:
      throw new Error("此任務不需執行");
  }
}
