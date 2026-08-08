import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth";
import { getDailySummary } from "@/lib/queries";
import { can } from "@/lib/constants";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 予約登録画面が、日付を変えたときにその日の営業設定を取りに来る。
 * イベント営業日なら席欄が消えて残定員の表示に変わるので、画面だけでは判断できない。
 */
export async function GET(_request: Request, ctx: { params: Promise<{ date: string }> }) {
  const me = await getProfile();
  if (!me || !can(me.role, "reservation.read")) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { date } = await ctx.params;
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "日付が不正です。" }, { status: 400 });
  }

  return NextResponse.json(await getDailySummary(date));
}
