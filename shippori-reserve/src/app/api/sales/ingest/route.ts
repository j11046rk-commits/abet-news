import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type IngestDay = { date: string; actual_yen?: number; target_yen?: number };

/**
 * 売上の取り込み口。しっぽり亭週次レポート（別リポジトリ）が
 * エアレジから取った日毎の実績を、ここに POST して流し込む。
 *
 *   POST /api/sales/ingest
 *   ヘッダー: x-api-key: <SALES_INGEST_TOKEN>
 *   本文: { "days": [ { "date": "2026-08-08", "actual_yen": 58000 }, ... ] }
 *
 * target_yen も渡せば目標の一括投入にも使える。
 * 渡さなかった項目は既存の値を保つ（上書きしない）。
 */
export async function POST(request: Request) {
  const token = process.env.SALES_INGEST_TOKEN;
  if (!token || request.headers.get("x-api-key") !== token) {
    return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  }

  let body: { days?: IngestDay[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "本文がJSONではありません。" }, { status: 400 });
  }

  const days = Array.isArray(body.days) ? body.days : [];
  if (days.length === 0 || days.length > 400) {
    return NextResponse.json({ error: "days は 1〜400 件で送ってください。" }, { status: 400 });
  }
  for (const d of days) {
    if (!DATE_RE.test(d.date ?? "")) {
      return NextResponse.json({ error: `日付が不正です: ${d.date}` }, { status: 400 });
    }
    for (const v of [d.actual_yen, d.target_yen]) {
      if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > 100_000_000)) {
        return NextResponse.json({ error: `金額が不正です: ${d.date}` }, { status: 400 });
      }
    }
  }

  const admin = createAdminClient();

  // 渡されなかった項目は保つため、既存行を読んでからまとめて upsert する
  const dates = days.map((d) => d.date);
  const { data: existing, error: readError } = await admin
    .from("sales_daily")
    .select("biz_date, target_yen, actual_yen")
    .in("biz_date", dates);
  if (readError) {
    return NextResponse.json({ error: "読み込みに失敗しました。" }, { status: 500 });
  }

  const current = new Map(
    (existing ?? []).map((r) => [r.biz_date as string, r as { target_yen: number | null; actual_yen: number | null }]),
  );
  const rows = days.map((d) => ({
    biz_date: d.date,
    target_yen: d.target_yen ?? current.get(d.date)?.target_yen ?? null,
    actual_yen: d.actual_yen ?? current.get(d.date)?.actual_yen ?? null,
  }));

  const { error } = await admin.from("sales_daily").upsert(rows, { onConflict: "biz_date" });
  if (error) {
    return NextResponse.json({ error: "保存に失敗しました。" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
