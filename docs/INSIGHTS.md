# 洞察報告（AI 對話 →「洞察報告」）

使用者在 AI 對話按「洞察報告」，選主題（整體經營／客戶獲利／品項與毛利／進銷存／應收與收款）與期間，系統從帳本拉資料、交給模型整理成報告。示範版**完整可用**，但模型與資料來源都是離線替身；接上正式 AI 與資料庫只需換兩個轉接器，畫面與報告格式不變。

## 流程

```
InsightsRequest（主題、期間、對照期間、選填問題）
  → InsightsDataSource      查詢帳本（7 個唯讀查詢，並記錄耗時與筆數）
  → buildDataset            轉成「可引用數據」facts（每個有 id 與格式化的 display）、表格、圖表資料
  → InsightsModel           撰寫草稿；數字只能以 [[fact.id]] 引用
  → validateDraft           核對每個引用；手打的數字或不存在的 id → 移除該則發現／建議，或在段落標示〔未驗證數字〕
  → InsightsReport          畫面呈現 + 寫入操作紀錄（ActionEvent: ai / InsightsReport / generate_insights）
```

| 檔案 | 內容 |
| --- | --- |
| `src/lib/insights/types.ts` | 請求、資料集、報告的型別；`reportDraftSchema`（zod）同時是模型的結構化輸出 schema |
| `src/lib/insights/dataSource.ts` | `InsightsDataSource` 介面、`localDataSource`（示範）、`httpDataSource`（正式版骨架） |
| `src/lib/insights/dataset.ts` | 期間換算、facts／表格／圖表；**依權限移除成本與毛利** |
| `src/lib/insights/rules.ts` | 離線規則引擎（示範預設，也是 AI 失敗時的備援） |
| `src/lib/insights/prompt.ts` | 系統提示詞（固定不變，利於快取）與使用者訊息 |
| `src/lib/insights/validate.ts` | 引用渲染與數字驗證 |
| `src/lib/insights/engine.ts` | 模型轉接器（`rulesModel`、`remoteModel`）、設定、`generateInsights` |
| `src/app/api/insights/route.ts` | 伺服器端呼叫 Claude（預設關閉） |
| `src/components/insights/Insights.tsx` | 選單、進度、報告卡、完整報告 |
| `src/lib/domain/reports.ts` | 損益、每週損益、進銷存的純函式（總覽與報告共用） |

## 護欄

- **數字只來自帳本。** 模型看得到的數字都是 facts；它只能引用 id，不能自己打數字或計算。驗證器擋下手打的數字與不存在的 id，報告底部顯示驗證結果與被移除的則數。圖表與表格由程式從資料集產生，不經模型。
- **權限在資料層執行。** 沒有 `view.margin` 的角色（業務、倉管、司機…）產生報告時，資料集在送出前就不含成本、毛利與低於成本的合約價；模型無從得知。
- **唯讀。** 報告不會寫入任何帳務資料；只在操作紀錄留下誰、何時、用哪個資料來源與模型產生了哪份報告。
- **可降級。** AI 無法使用（未設定、逾時、拒絕、格式不符）時自動改用規則引擎，並在報告上註明原因。
- **示範不外送。** 伺服器路由預設回 501；必須明確設定 `INSIGHTS_MODEL=claude` 才會呼叫外部服務。

## 接上 Claude

1. 伺服器環境變數：
   ```bash
   INSIGHTS_MODEL=claude                 # 啟用 /api/insights
   ANTHROPIC_API_KEY=sk-ant-...          # 或 SDK 支援的其他憑證來源
   INSIGHTS_CLAUDE_MODEL=claude-opus-5-5 # 選填，預設即此
   NEXT_PUBLIC_INSIGHTS_MODEL=claude     # 前端改用 remoteModel
   ```
2. 路由使用官方 SDK（`@anthropic-ai/sdk`，鎖定 0.135.0）的 `client.beta.messages.parse` 與 `betaZodOutputFormat(reportDraftSchema)`，回傳即為已驗證的草稿；`effort: "medium"`；啟用 `fallbacks: "default"`（安全分類拒絕時由伺服器改用建議模型重跑）。拒絕、截斷、格式不符、金鑰錯誤、限流、連線失敗各回對應狀態碼，前端據此降級。
3. 上線前要補：
   - **在伺服器端建資料集。** 示範版帳本在瀏覽器，所以由前端建好資料集再送到路由；正式版應改為路由只收 `{ topic, preset, question }`，在伺服器用資料庫查詢建資料集，避免客戶端操縱模型看到的數字。
   - 路由驗證登入身分與角色（決定 `includesMargin`），並設定速率限制。
   - 記錄 `usage`（輸入／輸出 token）以追蹤成本；系統提示詞固定，可加 `cache_control` 做提示詞快取。
   - 以真實資料建立評估集（常見問題 × 期間），確認發現的品質與驗證通過率後再開放。

## 接上資料庫

實作 `InsightsDataSource` 的 7 個方法即可（直接查資料庫，或用 `httpDataSource` 指向報表服務）。設定 `NEXT_PUBLIC_INSIGHTS_DATA_URL` 後前端改用 `httpDataSource`。金額一律整數「分」，日期 `YYYY-MM-DD`（Asia/Taipei）。

| 方法 | HTTP（`httpDataSource`） | 回傳 |
| --- | --- | --- |
| `directory()` | `GET /insights/directory` | `{ customers: [{id,name,segment,settlementTerms,priceTier}], products: [{id,name,category,baseUnit,costCents}] }` |
| `periodPnl(from,to)` | `GET /insights/pnl?from&to` | `PeriodPnl`（`domain/reports.ts`）：total、byCustomer、byProduct、byCategory |
| `weeklyPnl(to,weeks)` | `GET /insights/pnl/weekly?to&weeks` | `WeekPnl[]`，週一起算，最後一週到 `to` |
| `stockMovement(from,to)` | `GET /insights/stock-movement?from&to` | `StockMovement`：每品項期初／進／銷／調整／期末、可用天數 |
| `receivables(asOf)` | `GET /insights/receivables?asOf` | `[{customerId,balance,overdue,buckets,oldestDue}]` |
| `agreements(asOf)` | `GET /insights/agreements?asOf` | `[{customerId,count,avgDiscountBp,belowCost:[{productId,cents,costCents}]}]` |

參考 SQL（PostgreSQL，表名依 PRD §6）：

```sql
-- periodPnl：依出貨（應收 charge）認列，成本 = 出貨基本單位 × 標準成本
SELECT d.customer_id, i.product_id, p.category,
       SUM(i.ex_tax_cents)                                   AS revenue,
       SUM(i.qty_base * p.cost_cents) FILTER (WHERE p.cost_cents IS NOT NULL) AS cost,
       SUM(i.ex_tax_cents) FILTER (WHERE p.cost_cents IS NULL)               AS uncosted_revenue,
       COUNT(DISTINCT d.id)                                  AS deliveries
FROM ar_document d
JOIN ar_line_item i ON i.ar_document_id = d.id
JOIN product p      ON p.id = i.product_id
WHERE d.type = 'charge' AND d.issue_date BETWEEN $1 AND $2
GROUP BY GROUPING SETS ((d.customer_id), (i.product_id), (p.category), ());
-- 折讓／沖銷（credit_note、write_off）另以 SUM(ex_tax_cents) 扣減營收與毛利

-- stockMovement：正式版應有逐筆庫存異動表，期初直接取 period 開始前的結餘，而非由今日庫存倒推
SELECT product_id,
       SUM(qty_base) FILTER (WHERE kind = 'receipt')    AS in_qty,
       -SUM(qty_base) FILTER (WHERE kind = 'shipment')  AS out_qty,
       SUM(qty_base) FILTER (WHERE kind = 'adjustment') AS adjust_qty
FROM stock_movement
WHERE occurred_on BETWEEN $1 AND $2
GROUP BY product_id;
```

## 示範版的已知限制

- 進銷存：示範資料只保存各批現量，期初由今日庫存倒推；正式版需要逐筆庫存異動表（上面的 `stock_movement`）。
- 毛利為標準成本初估，不是實際進貨成本；缺成本的品項另列。
- 規則引擎只陳述資料中可驗證的事實與固定門檻（例如叫貨下滑 15%、可用天數少於 5 天），不推論原因。
