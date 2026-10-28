import { NextResponse } from "next/server";
import { syncLabor } from "@/lib/freee";
import { shiftDate, todayBizDate } from "@/lib/time";

/**
 * 人時売上の材料（全員の労働時間）を freee人事労務 から取り込む（毎朝・Vercelの定期実行）。
 *
 * 直近40日を毎回取り直す。打刻の修正や、月末にまとめて直す運用でも
 * 1か月ちょっと前までは自動で追いつく。連携していなければ何もしない。
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  }
  const today = todayBizDate();
  try {
    const r = await syncLabor(shiftDate(today, -40), shiftDate(today, -1));
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("連携していません")) return NextResponse.json({ ok: true, skipped: "not-connected" });
    console.error("labor_sync_failed", msg);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
