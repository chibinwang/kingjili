# CLAUDE.md

@AGENTS.md

## 開工前必讀

- 涉及 AI／模型呼叫、路由、本機模型、Claude API、MCP 或客戶自建工具 → 先讀 `docs/AI_COMPUTE_SWITCH.md`，遵守第 1 節規則，完成前對照第 11 節檢查清單。
- 涉及電子發票、稅額、含稅／未稅報價 → 先讀 `docs/invoice_research.md`，資料庫參考 `docs/DB_preparation_list.md`。
- 目前唯一直接呼叫 Claude 的地方是 `src/app/api/insights/route.ts`；AI 閘道實作時要把它改成走閘道。
