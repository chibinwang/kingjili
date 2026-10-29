import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { INSIGHTS_SYSTEM_PROMPT, insightsUserMessage } from "@/lib/insights/prompt";
import { reportDraftSchema, type InsightsDataset } from "@/lib/insights/types";

/**
 * POST /api/insights  { dataset } → { draft, model, usage }
 *
 * Server-side bridge to Claude. Off by default: it answers 501 unless INSIGHTS_MODEL=claude is set on the server,
 * so the offline demo never sends business data anywhere. Credentials come from the standard Anthropic environment
 * (ANTHROPIC_API_KEY, or another credential source the SDK resolves) and never reach the browser.
 *
 * In this demo the browser builds the dataset (the ledger lives in localStorage). In production, build it here from the
 * database (see docs/INSIGHTS.md) and accept only the request ({ topic, preset, question }), so the client cannot
 * shape the numbers the model sees.
 */

const MAX_BODY_BYTES = 600_000;
const MODEL = process.env.INSIGHTS_CLAUDE_MODEL || "claude-opus-5-5";

const fail = (status: number, error: string, message: string) => Response.json({ error, message }, { status });

function looksLikeDataset(x: unknown): x is InsightsDataset {
  const d = x as InsightsDataset;
  return !!d && typeof d === "object" && Array.isArray(d.facts) && Array.isArray(d.tables) && !!d.request && typeof d.includesMargin === "boolean";
}

export async function POST(req: Request) {
  if (process.env.INSIGHTS_MODEL !== "claude") return fail(501, "not_configured", "伺服器尚未啟用 AI 洞察（INSIGHTS_MODEL=claude），已改用離線規則引擎。");

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, "too_large", "資料集過大");
  let body: { dataset?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "bad_json", "請求格式錯誤");
  }
  if (!looksLikeDataset(body.dataset)) return fail(400, "bad_dataset", "缺少資料集");
  const dataset = body.dataset;

  const client = new Anthropic();
  try {
    const msg = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // on a safety decline, re-run on Anthropic's recommended fallback model instead of failing
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(reportDraftSchema) },
      system: INSIGHTS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: insightsUserMessage(dataset) }],
    });
    if (msg.stop_reason === "refusal") return fail(422, "refusal", "AI 拒絕產生此報告");
    if (msg.stop_reason === "max_tokens") return fail(502, "truncated", "AI 回覆過長被截斷");
    if (!msg.parsed_output) return fail(502, "bad_shape", "AI 回傳格式不符");
    return Response.json({ draft: msg.parsed_output, model: msg.model, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens } });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return fail(500, "auth", "AI 服務金鑰無效或未設定");
    if (e instanceof Anthropic.RateLimitError) return fail(429, "rate_limited", "AI 服務忙碌，請稍後再試");
    if (e instanceof Anthropic.BadRequestError) return fail(502, "bad_request", `AI 服務拒絕請求：${e.message}`);
    if (e instanceof Anthropic.APIConnectionError) return fail(503, "unreachable", "無法連線到 AI 服務");
    if (e instanceof Anthropic.APIError) return fail(502, "upstream", `AI 服務錯誤 ${e.status ?? ""}`.trim());
    throw e;
  }
}
