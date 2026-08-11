import { NextResponse } from "next/server";
import { deriveBusinessDay } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayBizDate } from "@/lib/time";
import type { BusinessDay } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 1日ぶんの営業設定を、ログイン無しで読む口。
 * しっぽり亭ストーリー告知リマインダー（Cloudflare Worker）が、
 * 17:45 のリマインドを送る前に「今日は営業日か」を確かめに来る。
 *
 *   GET /api/public/business-day?date=2026-08-11
 *   ヘッダー: x-api-key: <BUSINESS_DAY_TOKEN>
 *
 * date を省くと todayBizDate()（深夜0〜4時は前日扱い）。
 * 予約も客の情報も返さない。営業日そのものの設定だけ。
 *
 * 読み取り専用なので service role で読むが、返す列は下で明示的に組み立てる。
 * business_days の行を select * したものをそのまま流さない（updated_by は
 * スタッフの profile id なので外に出さない）。
 *
 * docs/04-api.md の GET /api/public/business-days?from=&to=（期間・レート制限）は
 * ホームページの予約フォーム向けで、そちらはまだ未実装。こちらは呼び手が
 * Worker 1つだけなので、レート制限ではなく合言葉で閉じている。
 */
export async function GET(request: Request) {
  const token = process.env.BUSINESS_DAY_TOKEN;
  if (!token || request.headers.get("x-api-key") !== token) {
    return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  }

  const date = new URL(request.url).searchParams.get("date") || todayBizDate();
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: `日付が不正です: ${date}` }, { status: 400 });
  }

  const admin = createAdminClient();

  // business_days に行が無い日は曜日から導出する（画面側と同じ deriveBusinessDay を通す）
  const [{ data: row, error: dayError }, { data: settingRows, error: settingsError }] =
    await Promise.all([
      admin.from("business_days").select("*").eq("biz_date", date).maybeSingle<BusinessDay>(),
      admin.from("settings").select("key, value"),
    ]);

  if (dayError || settingsError) {
    return NextResponse.json({ error: "読み込みに失敗しました。" }, { status: 500 });
  }

  const settings = Object.fromEntries(
    (settingRows ?? []).map((r) => [r.key as string, r.value]),
  );
  const day = row ?? deriveBusinessDay(date, settings);

  return NextResponse.json({
    biz_date: day.biz_date,
    is_closed: day.is_closed,
    mode: day.mode,
    is_busy: day.is_busy,
    event_name: day.event_name,
    open_min: day.open_min,
    close_min: day.close_min,
  });
}
