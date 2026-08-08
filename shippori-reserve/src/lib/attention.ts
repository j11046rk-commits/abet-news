import type { Reservation } from "@/lib/types";

/**
 * 日別画面で先頭に立てる要対応。
 *
 * 何を要対応とするかは運用そのものなので、1か所にまとめておく。
 * 増やすときはここに1行足す。
 * ※「状態」の概念は店主判断で廃止した（2026-08-08）。残っているのはキャンセルだけ。
 */
export function attentionReason(r: Reservation): string | null {
  if (r.status === "cancelled" || r.status === "no_show") return null;
  if (!r.phone) return "電話番号が未入力です。";
  return null;
}
