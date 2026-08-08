import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * 旧・月グリッド。ホーム（縦スクロールの月ビュー）に統合したのでそちらへ。
 * URLを踏んだ人が迷子にならないよう、ルートだけ残してある。
 */
export default function CalendarPage() {
  redirect("/");
}
