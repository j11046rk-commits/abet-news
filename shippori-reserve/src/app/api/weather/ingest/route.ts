import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { WEATHER_KINDS, type WeatherKind } from "@/lib/weather";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 2026-02-31 のような「形は正しいが存在しない日」を弾く（正規表現は通ってしまう） */
function isRealDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

type WeatherDay = {
  date: string;
  weather: WeatherKind;
  precip_mm?: number | null;
  temp_max_c?: number | null;
  temp_min_c?: number | null;
};

/**
 * 天気の取り込み口。しっぽり亭週次レポート（別リポジトリ）が気象庁の
 * 新居浜アメダスから取って3区分にした日毎の天気を、ここに POST して流し込む。
 * 売上の取り込みと同じ x-api-key で守る。
 *
 *   POST /api/weather/ingest
 *   ヘッダー: x-api-key: <SALES_INGEST_TOKEN>
 *   本文: { "days": [ { "date": "2026-08-27", "weather": "rainy",
 *                        "precip_mm": 12.5, "temp_max_c": 31.2, "temp_min_c": 26.0 } ] }
 *
 * 同じ日は後から来たもので上書きする（気象庁の値の確定し直しに追随）。
 */
export async function POST(request: Request) {
  const token = process.env.SALES_INGEST_TOKEN;
  if (!token || request.headers.get("x-api-key") !== token) {
    return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  }

  let body: { days?: WeatherDay[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "本文がJSONではありません。" }, { status: 400 });
  }

  const days = Array.isArray(body.days) ? body.days : [];
  if (days.length === 0 || days.length > 400) {
    return NextResponse.json({ error: "days は 1〜400 件で送ってください。" }, { status: 400 });
  }

  // 「読めなかった値」は null のまま置く。0 に化けさせない（降水0mmと未観測は別）
  const num = (v: unknown, min: number, max: number): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
      ? Math.round(v * 10) / 10
      : null;

  const seen = new Set<string>();
  const rows = [];
  for (const d of days) {
    if (!DATE_RE.test(d.date ?? "") || !isRealDate(d.date)) {
      return NextResponse.json({ error: `日付が不正です: ${d.date}` }, { status: 400 });
    }
    if (seen.has(d.date)) {
      return NextResponse.json({ error: `日付が重複しています: ${d.date}` }, { status: 400 });
    }
    seen.add(d.date);
    if (!WEATHER_KINDS.includes(d.weather)) {
      return NextResponse.json({ error: `weather が不正です: ${d.date}` }, { status: 400 });
    }
    rows.push({
      biz_date: d.date,
      weather: d.weather,
      precip_mm: num(d.precip_mm, 0, 2000),
      temp_max_c: num(d.temp_max_c, -50, 60),
      temp_min_c: num(d.temp_min_c, -50, 60),
      updated_at: new Date().toISOString(),
    });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("weather_daily").upsert(rows, { onConflict: "biz_date" });
  if (error) {
    console.error("weather_ingest_failed", error);
    return NextResponse.json({ error: "保存に失敗しました。" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
