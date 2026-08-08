import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth";
import { getDailySummary, getSeatOccupancies, getSeatUsage } from "@/lib/queries";
import { can } from "@/lib/constants";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 予約登録画面が、日付を変えたときにその日の営業設定と席の埋まり具合を取りに来る。
 * exclude= に予約IDを渡すと、その予約自身のぶんは埋まりに数えない（編集用）。
 */
export async function GET(request: Request, ctx: { params: Promise<{ date: string }> }) {
  const me = await getProfile();
  if (!me || !can(me.role, "reservation.read")) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { date } = await ctx.params;
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "日付が不正です。" }, { status: 400 });
  }

  const exclude = new URL(request.url).searchParams.get("exclude") || undefined;
  const [summary, usage, occupancies] = await Promise.all([
    getDailySummary(date),
    getSeatUsage(date, exclude),
    getSeatOccupancies(date, exclude),
  ]);

  return NextResponse.json({ ...summary, usage, occupancies });
}
