import { NextResponse } from "next/server";
import { apiProfile } from "@/lib/auth";
import { syncLabor } from "@/lib/freee";
import { shiftDate, todayBizDate } from "@/lib/time";

/** 設定画面の「今すぐ取り込む」。直近40日を取り直す */
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const auth = await apiProfile("settings.write");
  if (!auth.ok) return NextResponse.redirect(`${origin}/settings?freee=forbidden`, 303);
  try {
    const today = todayBizDate();
    await syncLabor(shiftDate(today, -40), today);
    return NextResponse.redirect(`${origin}/settings?freee=synced`, 303);
  } catch (e) {
    console.error("freee_sync_failed", e instanceof Error ? e.message : e);
    return NextResponse.redirect(`${origin}/settings?freee=error`, 303);
  }
}
