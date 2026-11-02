import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deriveBusinessDay } from "@/lib/queries";
import type { BusinessDay } from "@/lib/types";
import { shiftDate, todayBizDate } from "@/lib/time";

/**
 * 今日から7日ぶんの営業時間（ログイン不要・読み取りのみ・2026-11-02）。
 *
 * ホームページ（shipporitei.jp）の一番上に「本日 24:00まで営業」「本日定休日」を出すため。
 * 臨時休業や営業時間の変更は予約システムの営業日設定が正なので、ここから配る。
 *
 * ★返すのは 休み・開店・閉店・イベント名 だけ。メモ（note）など店内向けの項目は返さない。
 * 別のドメイン（ホームページ）から読むので、許可する相手をCORSで決め打ちにする。
 */
const ALLOWED_ORIGINS = ["https://shipporitei.jp", "https://j11046rk-commits.github.io"];

const cors = (origin: string | null): Record<string, string> =>
  origin && ALLOWED_ORIGINS.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
    : {};

export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  const from = todayBizDate();
  const to = shiftDate(from, 6);
  try {
    const admin = createAdminClient();
    const [{ data: rows }, { data: settingRows }] = await Promise.all([
      admin.from("business_days").select("*").gte("biz_date", from).lte("biz_date", to).returns<BusinessDay[]>(),
      admin.from("settings").select("key, value"),
    ]);
    const settings = Object.fromEntries((settingRows ?? []).map((r) => [r.key as string, r.value]));
    const byDate = new Map((rows ?? []).map((r) => [r.biz_date, r]));
    const days = [];
    for (let d = from; d <= to; d = shiftDate(d, 1)) {
      const b = byDate.get(d) ?? deriveBusinessDay(d, settings);
      days.push({
        date: d,
        closed: b.is_closed,
        open_min: b.open_min,
        close_min: b.close_min,
        event: b.mode === "event" ? (b.event_name ?? "イベント営業") : null,
      });
    }
    return NextResponse.json(
      { today: from, days },
      { headers: { ...cors(origin), "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch {
    return NextResponse.json({ error: "取得できませんでした。" }, { status: 500, headers: cors(origin) });
  }
}
