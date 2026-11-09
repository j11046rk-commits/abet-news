import { NextResponse } from "next/server";
import { syncLabor } from "@/lib/freee";
import { verifyApiToken } from "@/lib/api-token";
import { shiftDate, todayBizDate } from "@/lib/time";

/** 給与の設定も読むので時間がかかる（従業員×月ごとに数回呼ぶ） */
export const maxDuration = 60;

/**
 * 人時売上の材料（全員の労働時間）を freee人事労務 から取り込む（毎朝・Vercelの定期実行）。
 *
 * 直近40日を毎回取り直す。打刻の修正や、月末にまとめて直す運用でも
 * 1か月ちょっと前までは自動で追いつく。連携していなければ何もしない。
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const byCron = !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
  // Supabase の定期実行と同じ内部の合言葉（api_tokens の switchbot_cron・Vault にだけ平文）でも呼べる。取り直す日数を ?days= で（最大120日）
  const byKey = !byCron && (await verifyApiToken("switchbot_cron", request.headers.get("x-api-key")));
  if (!byCron && !byKey) {
    return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  }
  const daysParam = Number(new URL(request.url).searchParams.get("days"));
  const days = byKey && Number.isInteger(daysParam) && daysParam >= 1 && daysParam <= 120 ? daysParam : 40;
  const today = todayBizDate();
  try {
    const r = await syncLabor(shiftDate(today, -days), shiftDate(today, -1));
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("連携していません")) return NextResponse.json({ ok: true, skipped: "not-connected" });
    console.error("labor_sync_failed", msg);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
