import { TOPIC_LABEL, type InsightsDataset } from "./types";

/**
 * Prompt for the live model. Kept free of dates, ids and other per-request values so it stays byte-identical
 * across requests (cache-friendly); everything that varies goes in the user message.
 */
export const INSIGHTS_SYSTEM_PROMPT = `你是金吉利（冷凍食品批發商）的經營分析助理，替主任與會計整理過去資料，協助做經營決策。

你會收到一份 JSON 資料集：
- facts：可以引用的數字，每個都有 id、說明與已格式化的 display。
- tables、charts：可放進報告段落的表格與圖表（以 id 指定，由系統繪製）。
- dataNotes：資料本身的限制。
- request：使用者要看的主題、期間與（可能有的）問題。

寫作規則：
1. 報告中的每一個數字（金額、百分比、數量、天數、家數）都必須以 [[fact_id]] 引用資料集裡的 fact，系統會替換成 display。不要自己打出任何阿拉伯數字，也不要自己計算或估計新的數字；資料集沒有的數字就不要提。
2. 只陳述資料能支持的事實。推測原因時要寫明「可能」，並說明需要人員確認。
3. 發現（findings）要具體：指出哪個客戶或品項、哪個數字、為什麼值得注意。依重要性排序，最重要的放最前面。customerId、productId 只能用資料集 entities 裡的 id。
4. 建議（recommendations）要是這週就能做的具體動作，說明誰該做什麼。
5. 依 request.topic 聚焦；若 request.question 有內容，優先回答它。
6. 使用繁體中文（台灣用語），語氣精簡、直接，像給老闆看的週報。
7. 若資料集不含成本與毛利（includesMargin 為 false），不要提及或推測毛利、成本。`;

export function insightsUserMessage(d: InsightsDataset): string {
  const payload = {
    request: {
      topic: d.request.topic,
      topicLabel: TOPIC_LABEL[d.request.topic],
      range: d.request.range,
      compare: d.request.compare,
      question: d.request.question ?? null,
    },
    asOf: d.asOf,
    includesMargin: d.includesMargin,
    facts: d.facts.map(({ id, label, display }) => ({ id, label, display })),
    tables: d.tables.map((t) => ({ id: t.id, title: t.title, columns: t.columns.map((c) => c.label), rows: t.rows.map((r) => t.columns.map((c) => r[c.key] ?? "")) })),
    charts: ["weekly_pnl", "customer_revenue", "category_mix", "stock_cover", "ar_aging"],
    entities: d.entities,
    dataNotes: d.dataNotes,
  };
  return `請依下列資料集撰寫洞察報告。\n\n${JSON.stringify(payload)}`;
}
