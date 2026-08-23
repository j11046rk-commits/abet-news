import { NextResponse } from "next/server";
import { apiProfile } from "@/lib/auth";
import { getDailySummary, getSeatUsage } from "@/lib/queries";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 予約登録画面が、日付を変えたときにその日の営業設定と席の埋まり具合を取りに来る。
 * exclude= に予約IDを渡すと、その予約自身のぶんは埋まりに数えない（編集用）。
 */
export async function GET(request: Request, ctx: { params: Promise<{ date: string }> }) {
  const gate = await apiProfile("reservation.read");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { date } = await ctx.params;
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "日付が不正です。" }, { status: 400 });
  }

  const exclude = new URL(request.url).searchParams.get("exclude") || undefined;
  const [summary, usage] = await Promise.all([getDailySummary(date), getSeatUsage(date, exclude)]);

  return NextResponse.json({ ...summary, usage });
}
