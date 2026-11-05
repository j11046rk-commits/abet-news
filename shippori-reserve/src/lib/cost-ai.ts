import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AiDoc } from "@/lib/cost";

/**
 * 納品書・請求書・レシートの写真を Claude に読ませる。
 *
 * - 読むだけ。保存は必ず人が確認してから（画面の「保存」）。
 * - 鍵（ANTHROPIC_API_KEY）が無い・読めなかったときは null を返し、画面は手入力に切り替わる。
 *   AIが止まっても仕入の記録は止めない。
 */

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["doc_kind", "vendor", "date", "period_from", "period_to", "total_in", "lines", "note"],
  properties: {
    doc_kind: {
      type: "string",
      enum: ["slip", "invoice", "receipt"],
      description: "slip=納品書, invoice=請求書（月締め・期間の合計）, receipt=店頭のレシート",
    },
    vendor: { type: "string", description: "発行した業者・店の名前（読めなければ空文字）" },
    date: { anyOf: [{ type: "string" }, { type: "null" }], description: "書類の日付 YYYY-MM-DD（納品日・購入日・請求書の発行日）" },
    period_from: { anyOf: [{ type: "string" }, { type: "null" }], description: "請求書の対象期間の初日 YYYY-MM-DD。無ければ null" },
    period_to: { anyOf: [{ type: "string" }, { type: "null" }], description: "請求書の対象期間の末日（締め日）YYYY-MM-DD。無ければ null" },
    total_in: { anyOf: [{ type: "integer" }, { type: "null" }], description: "今回の請求・支払いの合計額（税込・円）。前回繰越は含めない" },
    lines: {
      type: "array",
      description: "区分ごとの小計。1つの区分に複数の品があれば足し合わせて1行にする",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "amount", "tax_included", "tax_rate"],
        properties: {
          category: {
            type: "string",
            enum: ["food", "drink", "supplies", "other"],
            description:
              "food=料理に使う食材・調味料, drink=酒・ソフトドリンク・氷, supplies=洗剤・ラップ・割り箸・おしぼり・容器など, other=それ以外",
          },
          amount: { type: "integer", description: "その区分の金額（円）" },
          tax_included: { type: "boolean", description: "amount が税込なら true、税抜なら false" },
          tax_rate: { anyOf: [{ type: "number" }, { type: "null" }], description: "0.08 か 0.1。分からなければ null" },
        },
      },
    },
    note: { type: "string", description: "読みにくかった箇所や確認してほしい点（日本語・短く）。無ければ空文字" },
  },
} as const;

const PROMPT = `飲食店（和食の居酒屋）の仕入書類の写真です。原価の記録に使うので、次を読み取ってください。

- 書類の種類：納品書／請求書（月締めで期間の合計を請求するもの）／店頭のレシート
- 業者・店の名前、日付、請求書なら対象期間
- 今回分の合計（税込）。請求書の「前回請求額」「繰越」「入金」は含めない
- 品目を「食材・酒飲料・消耗品・その他」に分け、区分ごとの小計。軽減税率（8%）の印（※・★など）があれば食材か飲料
- 値引き・返品はマイナスで、その区分に含める

読めない数字は推測で埋めず、note に書いてください。`;

export const aiReady = (): boolean => !!process.env.ANTHROPIC_API_KEY;

export type AiReadResult = { ok: true; doc: AiDoc } | { ok: false; reason: "nokey" | "unreadable" | "error"; detail?: string };

export async function readCostDocument(image: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }): Promise<AiReadResult> {
  if (!aiReady()) return { ok: false, reason: "nokey" };
  const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
  try {
    const res = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
      return { ok: false, reason: "unreadable", detail: res.stop_reason };
    }
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const doc = JSON.parse(text) as AiDoc;
    if (!doc || !Array.isArray(doc.lines)) return { ok: false, reason: "unreadable" };
    return { ok: true, doc };
  } catch (e) {
    if (e instanceof SyntaxError) return { ok: false, reason: "unreadable" };
    if (e instanceof Anthropic.APIError) {
      console.error("[cost-ai]", e.status, e.message);
      return { ok: false, reason: "error", detail: String(e.status ?? "") };
    }
    console.error("[cost-ai]", e);
    return { ok: false, reason: "error" };
  }
}
