import type { Fact, InsightsDataset, ReportDraft, ValidationIssue } from "./types";

/**
 * The model may only state numbers by citing facts as [[fact.id]]. This module renders citations
 * and rejects anything that slips a figure in by hand — the guard against invented numbers.
 */

const TOKEN = /\[\[([^\]]+)\]\]/g;
/** Digits outside citations. Month names ("10 月") and short dates ("10/24") are allowed. */
const RAW_NUMBER = /(?<![\d/])(?!\d{1,2}\s*月)(?!\d{1,2}\/\d{1,2})\d[\d,.]*/g;
export const UNVERIFIED = "〔未驗證數字〕";

export type Segment = { text: string } | { fact: Fact } | { missing: string };

export function segments(text: string, facts: Map<string, Fact>): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    const f = facts.get(m[1].trim());
    out.push(f ? { fact: f } : { missing: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Plain-text rendering (for logs, exports and tests). */
export function renderText(text: string, facts: Map<string, Fact>): string {
  return segments(text, facts)
    .map((s) => ("text" in s ? s.text : "fact" in s ? s.fact.display : UNVERIFIED))
    .join("");
}

function check(text: string, facts: Map<string, Fact>, where: string, issues: ValidationIssue[]): boolean {
  let ok = true;
  for (const m of text.matchAll(TOKEN)) {
    if (!facts.has(m[1].trim())) {
      issues.push({ where, message: `引用了不存在的數據「${m[1]}」` });
      ok = false;
    }
  }
  const outside = text.replace(TOKEN, "");
  const raw = outside.match(RAW_NUMBER);
  if (raw) {
    issues.push({ where, message: `出現未引用資料的數字：${raw.slice(0, 3).join("、")}` });
    ok = false;
  }
  return ok;
}

/** Replace hand-typed numbers with a visible marker (used where dropping the text would lose the structure). */
function mask(text: string): string {
  const parts = text.split(TOKEN);
  // split with a capture group alternates [text, id, text, id, ...]
  return parts.map((p, i) => (i % 2 ? `[[${p}]]` : p.replace(RAW_NUMBER, UNVERIFIED))).join("");
}

export interface ValidationResult {
  draft: ReportDraft;
  issues: ValidationIssue[];
  /** Findings and recommendations removed because they cited something unverifiable. */
  dropped: number;
}

export function validateDraft(draft: ReportDraft, dataset: InsightsDataset): ValidationResult {
  const facts = new Map(dataset.facts.map((f) => [f.id, f]));
  const customers = new Set(dataset.entities.customers.map((c) => c.id));
  const products = new Set(dataset.entities.products.map((p) => p.id));
  const issues: ValidationIssue[] = [];
  let dropped = 0;

  const headlineOk = check(draft.headline, facts, "摘要", issues);
  const sections = draft.sections.map((s, i) => (check(s.body, facts, `第 ${i + 1} 段「${s.title}」`, issues) ? s : { ...s, body: mask(s.body) }));

  const findings = draft.findings.filter((f, i) => {
    const where = `發現 ${i + 1}「${f.title}」`;
    let ok = check(f.detail, facts, where, issues) && check(f.title, facts, where, issues);
    const reject = (message: string) => {
      issues.push({ where, message });
      ok = false;
    };
    for (const id of f.factIds) if (!facts.has(id)) reject(`依據不存在的數據「${id}」`);
    if (f.customerId && !customers.has(f.customerId)) reject(`客戶代號 ${f.customerId} 不存在`);
    if (f.productId && !products.has(f.productId)) reject(`品項代號 ${f.productId} 不存在`);
    if (!ok) dropped += 1;
    return ok;
  });

  const recommendations = draft.recommendations.filter((r, i) => {
    const where = `建議 ${i + 1}`;
    let ok = check(r.text, facts, where, issues);
    for (const id of r.factIds)
      if (!facts.has(id)) {
        issues.push({ where, message: `依據不存在的數據「${id}」` });
        ok = false;
      }
    if (!ok) dropped += 1;
    return ok;
  });

  const kpiFactIds = draft.kpiFactIds.filter((id) => {
    if (facts.has(id)) return true;
    issues.push({ where: "重點數字", message: `數據「${id}」不存在，已略過` });
    return false;
  });

  return {
    draft: { ...draft, headline: headlineOk ? draft.headline : mask(draft.headline), sections, findings, recommendations, kpiFactIds, caveats: draft.caveats.map(mask) },
    issues,
    dropped,
  };
}
