import { formatTWD, type Cents } from "../money";
import { addDays, DEMO_TODAY, formatDate, periodRange } from "../time";
import type { DocLine, StatementDoc } from "./statementDoc";

/**
 * Rule-based editor for the statement document — the chat panel beside the preview.
 * Offline like the rest of the demo agent: no model call, every change is a deterministic rewrite of the document.
 */
export interface DocChange {
  label: string;
  before: string;
  after: string;
}

export type CommandResult = { ok: true; doc: StatementDoc; reply: string; changes: DocChange[] } | { ok: false; reply: string };

export const STATEMENT_COMMAND_EXAMPLES = [
  "付款期限延後 5 天",
  "新增一筆退貨折讓 500 元",
  "第 2 筆金額改成 3,000",
  "顯示品項明細",
  "備註加上：11 月起週日公休",
  "聯絡人改成 林德福先生",
];

const CN_DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 三千五百 → 3500, 十二 → 12, 兩萬 → 20000 */
export function parseChineseNumber(s: string): number | undefined {
  if (!/^[零〇一二兩三四五六七八九十百千萬]+$/.test(s)) return undefined;
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const ch of s) {
    if (ch in CN_DIGIT) digit = CN_DIGIT[ch];
    else if (ch in CN_UNIT) {
      section += (digit || 1) * CN_UNIT[ch];
      digit = 0;
    } else if (ch === "萬") {
      total += (section + digit) * 10000;
      section = 0;
      digit = 0;
    }
  }
  return total + section + digit;
}

/** Full-width digits and punctuation → ASCII, thousands separators removed. */
function normalize(input: string): string {
  return input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/／/g, "/")
    .replace(/－/g, "-")
    .replace(/(\d),(?=\d{3})/g, "$1")
    .trim();
}

const REF_RE = /\b[A-Z]{2,3}-\d{6}-[A-Z0-9]+(?:-R)?\b/i;
const DATE_RE = /(?:(\d{4})\s*[/年-]\s*)?(\d{1,2})\s*[/月-]\s*(\d{1,2})\s*[日號]?/;
const INDEX_RE = /第\s*([\d零〇一二兩三四五六七八九十]+)\s*[筆行項列]|最後一筆/;

/** Amount in cents. Arabic numbers may carry 萬／千; Chinese numerals need 元／塊 so ordinals like 第三筆 aren't read as money. */
export function parseAmount(text: string): Cents | undefined {
  const cleaned = normalize(text).replace(REF_RE, " ").replace(DATE_RE, " ").replace(INDEX_RE, " ").replace(/\d+\s*天/g, " ");
  const ar = cleaned.match(/(?:NT\$|\$)?\s*(\d+(?:\.\d+)?)\s*(萬|千)?\s*(?:元|塊)?/);
  if (ar) {
    const n = Number(ar[1]) * (ar[2] === "萬" ? 10000 : ar[2] === "千" ? 1000 : 1);
    return Math.round(n) * 100;
  }
  const cn = cleaned.match(/([零〇一二兩三四五六七八九十百千萬]+)\s*(?:元|塊)/);
  const n = cn ? parseChineseNumber(cn[1]) : undefined;
  return n === undefined ? undefined : n * 100;
}

/** M/D with an optional year; a month before the statement period rolls into the next year (12 月的單 → 1/10 付款). */
export function parseDate(text: string, period: string): string | undefined {
  const m = text.match(DATE_RE);
  if (!m) return undefined;
  const [py, pm] = period.split("-").map(Number);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const year = m[1] ? Number(m[1]) : month < pm ? py + 1 : py;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The new value in "X 改成 Y" style commands: whatever follows the verb, without quotes or a trailing 。 */
function targetText(text: string): string | undefined {
  const m = text.match(/(?:改成|改為|換成|設為|設成|寫成|變成|更正為|更新為|[:：])\s*(.+)$/);
  const quoted = text.match(/[「『"“]([^」』"”]+)[」』"”]/);
  const v = (quoted?.[1] ?? m?.[1])?.replace(/^[「『"“]|[」』"”。.]$/g, "").trim();
  return v || undefined;
}

type LineRef = { line: DocLine; index: number } | { error: string } | undefined;

function findLine(doc: StatementDoc, text: string, period: string, allowDate: boolean): LineRef {
  const ref = text.match(REF_RE)?.[0];
  if (ref) {
    const index = doc.lines.findIndex((l) => l.refNo.toLowerCase() === ref.toLowerCase());
    return index >= 0 ? { line: doc.lines[index], index } : { error: `對帳單上找不到單號 ${ref.toUpperCase()}。` };
  }
  const idx = text.match(INDEX_RE);
  if (idx) {
    const n = idx[0] === "最後一筆" ? doc.lines.length : /^\d+$/.test(idx[1]) ? Number(idx[1]) : parseChineseNumber(idx[1]);
    if (!n || n < 1 || n > doc.lines.length) return { error: `明細只有 ${doc.lines.length} 筆，找不到第 ${idx[1]} 筆。` };
    return { line: doc.lines[n - 1], index: n - 1 };
  }
  if (allowDate) {
    const date = parseDate(text, period);
    if (date) {
      const hits = doc.lines.map((line, index) => ({ line, index })).filter((x) => x.line.date === date);
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) return { error: `${formatDate(date)} 有 ${hits.length} 筆（${hits.map((h) => h.line.refNo).join("、")}），請指定單號或「第幾筆」。` };
      return { error: `${formatDate(date)} 沒有明細。` };
    }
  }
  return undefined;
}

const lineName = (l: DocLine, i: number) => `第 ${i + 1} 筆（${l.refNo === "—" ? l.description : l.refNo}）`;
const money = (c: Cents) => formatTWD(c);
const done = (doc: StatementDoc, reply: string, changes: DocChange[]): CommandResult => ({ ok: true, doc, reply, changes });
const fail = (reply: string): CommandResult => ({ ok: false, reply });

export function applyStatementCommand(doc: StatementDoc, base: StatementDoc, input: string, period: string): CommandResult {
  const text = normalize(input);
  if (!text) return fail("請輸入要修改的內容。");
  // 單號或「第 N 筆」; a bare date only counts as a line reference at the end, since 地址、備註 may contain dates
  const explicitRef = findLine(doc, text, period, false);

  // 還原
  if (/還原|復原|恢復原|重置|改回/.test(text)) {
    if (!explicitRef) return done(structuredClone(base), "已將整份對帳單還原為帳務系統的資料。", [{ label: "整份對帳單", before: "已修改", after: "系統資料" }]);
    const refNo = text.match(REF_RE)?.[0];
    const key = refNo ? base.lines.find((l) => l.refNo.toLowerCase() === refNo.toLowerCase())?.key : "line" in explicitRef ? explicitRef.line.key : undefined;
    if (!key && "error" in explicitRef) return fail(explicitRef.error);
    const original = base.lines.find((l) => l.key === key);
    if (!original) return fail("這筆是手動新增的，系統資料中沒有原始內容；要移除請說「刪除第 N 筆」。");
    const lines = doc.lines.some((l) => l.key === key) ? doc.lines.map((l) => (l.key === key ? structuredClone(original) : l)) : [...doc.lines, structuredClone(original)].sort((a, b) => a.date.localeCompare(b.date));
    return done({ ...doc, lines }, `已還原 ${original.refNo}。`, [{ label: original.refNo, before: "已修改", after: "系統資料" }]);
  }

  // 備註 goes first: its text may itself mention 期限、發票、品項
  if (/備註|附註|加註|注意事項/.test(text)) {
    const append = /加註|加上|補充|新增|追加|再加/.test(text) && !/改成|改為|換成/.test(text);
    const v = targetText(text) ?? text.replace(/^.*?(?:備註|附註|加註|注意事項)\s*(?:加上|補充|新增|追加)?/, "").trim();
    if (!v) return fail("備註要寫什麼？例如「備註加上：11 月起週日公休」。");
    const next = append ? `${doc.note}\n${v}` : v;
    return done({ ...doc, note: next }, append ? "已在備註最後加上一行。" : "已更新備註。", [{ label: "備註", before: doc.note, after: next }]);
  }

  // 顯示／隱藏欄位
  const hide = /隱藏|不要顯示|不顯示|拿掉|關閉|移除|去掉|不要/.test(text);
  const show = /顯示|加上|打開|開啟|列出|附上/.test(text);
  if (/品項|商品明細/.test(text) && (hide || show)) {
    const on = !hide;
    return done({ ...doc, showItems: on }, on ? "已在每張送貨單下列出品項、數量與單價。" : "已隱藏品項明細，只列送貨單合計。", [{ label: "品項明細", before: doc.showItems ? "顯示" : "隱藏", after: on ? "顯示" : "隱藏" }]);
  }
  if (/發票/.test(text) && /欄|號碼/.test(text) && (hide || show)) {
    const on = !hide;
    return done({ ...doc, showInvoice: on }, on ? "已顯示發票號碼欄。" : "已隱藏發票號碼欄。", [{ label: "發票號碼欄", before: doc.showInvoice ? "顯示" : "隱藏", after: on ? "顯示" : "隱藏" }]);
  }

  // 日期
  if (/付款期限|繳款期限|付款日|到期日|繳費期限|期限/.test(text)) {
    const rel = text.match(/(延後|延長|順延|提前|提早)\s*([\d一二兩三四五六七八九十]+)\s*天/);
    let next: string | undefined;
    if (rel) {
      const n = /^\d+$/.test(rel[2]) ? Number(rel[2]) : parseChineseNumber(rel[2])!;
      next = addDays(doc.dueDate, /提前|提早/.test(rel[1]) ? -n : n);
    } else next = parseDate(text, period);
    if (!next) return fail("要改成哪一天？例如「付款期限改成 11/30」或「付款期限延後 5 天」。");
    return done({ ...doc, dueDate: next }, `付款期限已改為 ${formatDate(next, { year: true })}。`, [{ label: "付款期限", before: formatDate(doc.dueDate, { year: true }), after: formatDate(next, { year: true }) }]);
  }
  if (/開立日期|製表日期|開單日期/.test(text)) {
    const next = parseDate(text, period);
    if (!next) return fail("要改成哪一天？例如「開立日期改成 11/1」。");
    return done({ ...doc, issueDate: next }, `開立日期已改為 ${formatDate(next, { year: true })}。`, [{ label: "開立日期", before: formatDate(doc.issueDate, { year: true }), after: formatDate(next, { year: true }) }]);
  }

  // 文字欄位
  if (!explicitRef) {
    for (const [re, label, get, set] of TEXT_FIELDS) {
      if (!re.test(text)) continue;
      const v = targetText(text);
      if (!v) return fail(`${label}要改成什麼？例如「${label}改成 …」。`);
      return done(set(doc, v), `${label}已改為「${v}」。`, [{ label, before: get(doc) || "（空白）", after: v }]);
    }
  }

  if (/期初|上期結轉|上期餘額/.test(text)) {
    const amt = parseAmount(text);
    if (amt === undefined) return fail("上期結轉要改成多少？");
    return done({ ...doc, openingCents: amt }, `上期結轉已改為 ${money(amt)}。`, [{ label: "上期結轉", before: money(doc.openingCents), after: money(amt) }]);
  }

  // 新增一筆
  const isCredit = /折讓|折扣|退貨|退款|優惠|扣除|扣抵|減免|沖銷/.test(text);
  const isDebit = /運費|補收|加收|手續費/.test(text);
  if (!explicitRef && (/新增|加一筆|加入|增加|補一筆|再加|多一筆/.test(text) || isCredit || isDebit)) {
    const amt = parseAmount(text);
    if (amt === undefined || amt === 0) return fail("這筆金額是多少？例如「新增一筆退貨折讓 500 元」。");
    if (!isCredit && !isDebit) return fail("這筆是要從應付扣除（折讓／退貨）還是加收（運費／補收）？");
    const desc =
      text.match(/[「『"“]([^」』"”]+)[」』"”]/)?.[1] ??
      (/退貨/.test(text) ? "退貨折讓" : /折讓/.test(text) ? "折讓" : /折扣|優惠/.test(text) ? "折扣優惠" : /運費/.test(text) ? "運費" : /手續費/.test(text) ? "手續費" : isCredit ? "扣抵" : "補收款項");
    const { end } = periodRange(period);
    const date = parseDate(text, period) ?? (end < DEMO_TODAY ? end : DEMO_TODAY);
    const line: DocLine = { key: `m-${Date.now().toString(36)}-${doc.lines.length}`, kind: "manual", date, refNo: "—", description: desc, debitCents: isCredit ? 0 : amt, creditCents: isCredit ? amt : 0 };
    const lines = [...doc.lines, line].sort((a, b) => a.date.localeCompare(b.date));
    return done({ ...doc, lines }, `已新增「${desc}」${isCredit ? "扣除" : "加收"} ${money(amt)}（${formatDate(date)}）。`, [{ label: desc, before: "—", after: `${isCredit ? "−" : "+"}${money(amt)}` }]);
  }

  // 單筆明細
  const lineRef = explicitRef ?? findLine(doc, text, period, true);
  if (lineRef && "error" in lineRef) return fail(lineRef.error);
  if (lineRef) {
    const { line, index } = lineRef;
    const name = lineName(line, index);
    const replace = (patch: Partial<DocLine>) => ({ ...doc, lines: doc.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) });
    if (/刪除|移除|刪掉|拿掉|去掉|不要列|隱藏/.test(text)) {
      return done({ ...doc, lines: doc.lines.filter((_, i) => i !== index) }, `已從對帳單移除${name}。`, [{ label: name, before: money(line.debitCents || line.creditCents), after: "已移除" }]);
    }
    if (/摘要|說明|描述|名稱/.test(text)) {
      const v = targetText(text);
      if (!v) return fail("摘要要改成什麼？");
      return done(replace({ description: v }), `${name}摘要已改為「${v}」。`, [{ label: `${name}摘要`, before: line.description, after: v }]);
    }
    const amt = parseAmount(text);
    if (amt !== undefined) {
      const credit = line.creditCents > 0 || line.kind === "payment" || line.kind === "credit_note" || line.kind === "write_off";
      const before = credit ? line.creditCents : line.debitCents;
      return done(replace(credit ? { creditCents: amt, debitCents: 0 } : { debitCents: amt, creditCents: 0 }), `${name}金額已由 ${money(before)} 改為 ${money(amt)}。`, [{ label: `${name}金額`, before: money(before), after: money(amt) }]);
    }
    return fail(`要對${name}做什麼？可以改金額、改摘要或刪除。`);
  }

  return fail("這句我還看不懂。可以試試：\n・" + STATEMENT_COMMAND_EXAMPLES.join("\n・"));
}

const TEXT_FIELDS: [RegExp, string, (d: StatementDoc) => string, (d: StatementDoc, v: string) => StatementDoc][] = [
  [/標題/, "標題", (d) => d.title, (d, v) => ({ ...d, title: v })],
  [/帳號/, "匯款帳號", (d) => d.bank.accountNo, (d, v) => ({ ...d, bank: { ...d.bank, accountNo: v } })],
  [/戶名/, "戶名", (d) => d.bank.accountName, (d, v) => ({ ...d, bank: { ...d.bank, accountName: v } })],
  [/銀行|分行/, "匯款銀行", (d) => d.bank.bankName, (d, v) => ({ ...d, bank: { ...d.bank, bankName: v } })],
  [/聯絡人|收件人|窗口/, "聯絡人", (d) => d.customer.contactName, (d, v) => ({ ...d, customer: { ...d.customer, contactName: v } })],
  [/電話/, "電話", (d) => d.customer.phone, (d, v) => ({ ...d, customer: { ...d.customer, phone: v } })],
  [/地址/, "地址", (d) => d.customer.address, (d, v) => ({ ...d, customer: { ...d.customer, address: v } })],
  [/統編|統一編號/, "統一編號", (d) => d.customer.taxId, (d, v) => ({ ...d, customer: { ...d.customer, taxId: v } })],
  [/客戶名稱|抬頭|店名/, "客戶名稱", (d) => d.customer.name, (d, v) => ({ ...d, customer: { ...d.customer, name: v } })],
  [/製表/, "製表", (d) => d.preparedBy, (d, v) => ({ ...d, preparedBy: v })],
  [/核准/, "核准", (d) => d.approvedBy, (d, v) => ({ ...d, approvedBy: v })],
];
