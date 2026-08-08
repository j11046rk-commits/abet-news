import type { BusinessMode, Reservation } from "@/lib/types";
import { todayBizDate } from "@/lib/time";

/**
 * 「今日」画面で先頭に立てる要対応。
 *
 * 何を要対応とするかは運用そのものなので、1か所にまとめておく。
 * 増やすときはここに1行足す。
 */
export function attentionReason(r: Reservation, mode: BusinessMode): string | null {
  if (r.status === "cancelled" || r.status === "no_show" || r.status === "completed") return null;

  if (r.status === "tentative" && r.biz_date <= todayBizDate()) {
    return "仮予約のままです。お客様に確認してください。";
  }
  if (!r.phone) return "電話番号が未入力です。";
  if (mode === "normal" && !r.seat_note) return "席が未定です。";
  return null;
}
