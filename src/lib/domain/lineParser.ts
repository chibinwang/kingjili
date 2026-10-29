import type { Customer, DraftIssue, Product } from "./types";

/**
 * Deterministic LINE free-text extraction used by the demo "AI" draft.
 * It never commits: anything ambiguous becomes an issue that a person must resolve.
 */
export const PRODUCT_ALIASES: Record<string, string[]> = {
  P001: ["冷凍雞塊", "雞塊"],
  P002: ["酥炸雞排", "雞排"],
  P003: ["香脆薯條", "冷凍薯條", "薯條"],
  P004: ["炸花枝丸", "花枝丸"],
  P005: ["蔬食水餃", "素水餃", "水餃"],
  P006: ["素雞塊"],
  P007: ["甜不辣"],
  P008: ["洋蔥圈"],
  P009: ["雞米花"],
  P010: ["地瓜薯條", "地瓜條"],
  P011: ["蔬菜春捲", "春捲"],
  P012: ["黃金魚排", "魚排"],
  P013: ["起司條"],
  P014: ["素排骨"],
};

/** Every name the parser recognises per product: built-in aliases, or the product name, plus any added aliases. */
export function productAliases(products: Product[]): [string, string[]][] {
  return products.map((p) => [p.id, [...new Set([...(PRODUCT_ALIASES[p.id] ?? [p.name]), ...(p.aliases ?? [])])]]);
}

const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function parseNumber(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  if (token === "十") return 10;
  if (/^十[一二三四五六七八九]$/.test(token)) return 10 + CN_DIGITS[token[1]];
  if (/^[一二兩三四五六七八九]十[一二三四五六七八九]?$/.test(token)) return CN_DIGITS[token[0]] * 10 + (token[2] ? CN_DIGITS[token[2]] : 0);
  if (token.length === 1 && CN_DIGITS[token]) return CN_DIGITS[token];
  return null;
}

export interface ParsedLine {
  productId: string;
  matchedText: string;
  qty: number | null;
  unit: "base" | "pack" | null;
  rawUnit?: string;
}

export interface ParseResult {
  customerId?: string;
  deliveryOffsetDays: number;
  lines: ParsedLine[];
  issues: DraftIssue[];
  confidence: number;
}

export function parseLineOrder(text: string, products: Product[], customers: Customer[], senderLineUserId?: string): ParseResult {
  const issues: DraftIssue[] = [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const customer = customers.find((c) => senderLineUserId && c.lineUserId === senderLineUserId) ?? customers.find((c) => text.includes(c.name) || text.includes(c.name.slice(0, 2)));
  if (!customer) issues.push({ field: "customer", message: "無法辨識下單客戶，請手動指定", resolved: false });

  const offset = /後天/.test(text) ? 2 : /今天|今日/.test(text) ? 0 : 1;

  // Longest aliases first so 素雞塊 doesn't match 雞塊, 地瓜薯條 doesn't match 薯條.
  const aliasList = productAliases(products)
    .flatMap(([id, names]) => names.map((n) => ({ id, n })))
    .sort((a, b) => b.n.length - a.n.length);
  let rest = text;
  const found: { id: string; n: string; idx: number }[] = [];
  for (const a of aliasList) {
    let idx = rest.indexOf(a.n);
    while (idx >= 0) {
      found.push({ ...a, idx });
      rest = rest.slice(0, idx) + "＿".repeat(a.n.length) + rest.slice(idx + a.n.length);
      idx = rest.indexOf(a.n);
    }
  }
  found.sort((a, b) => a.idx - b.idx);

  const lines: ParsedLine[] = [];
  found.forEach((f, i) => {
    const after = text.slice(f.idx + f.n.length, found[i + 1]?.idx ?? text.length);
    const m = after.match(/^\s*[x×*]?\s*(\d+|[一二兩三四五六七八九十]+)\s*(箱|包|袋|件|盒|斤|公斤)?/);
    const p = byId.get(f.id)!;
    const qty = m ? parseNumber(m[1]) : null;
    const rawUnit = m?.[2];
    let unit: ParsedLine["unit"] = null;
    if (rawUnit === "箱") unit = "pack";
    else if (rawUnit === p.baseUnit || rawUnit === "包" || rawUnit === "袋") unit = "base";
    const li = lines.length;
    if (qty === null) issues.push({ field: "qty", lineIndex: li, message: `「${f.n}」未寫數量`, resolved: false });
    if (qty !== null && !rawUnit) issues.push({ field: "unit", lineIndex: li, message: `「${f.n}${m?.[1]}」未寫單位：${p.packUnit}（${p.packSize}${p.baseUnit}）或 ${p.baseUnit}？`, resolved: false });
    if (rawUnit && unit === null) issues.push({ field: "unit", lineIndex: li, message: `「${rawUnit}」不是 ${p.name} 的銷售單位`, resolved: false });
    lines.push({ productId: f.id, matchedText: f.n + (m?.[0] ?? ""), qty, unit, rawUnit });
  });

  if (/\$|元|算便宜|特價|價格/.test(text)) issues.push({ field: "price", message: "訊息提到價格，需業務確認是否適用客戶牌價", resolved: false });
  if (/跟上次一樣|照舊|老樣子/.test(text)) issues.push({ field: "product", message: "「跟上次一樣」需人工比對上次訂單", resolved: false });
  if (!lines.length) issues.push({ field: "product", message: "未辨識到任何品項", resolved: false });

  const blocking = issues.length;
  const confidence = Math.max(0.35, Math.min(0.98, 0.96 - blocking * 0.12));
  return { customerId: customer?.id, deliveryOffsetDays: offset, lines, issues, confidence };
}
