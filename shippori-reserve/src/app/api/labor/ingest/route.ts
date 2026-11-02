import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

type LaborDay = { date: string; work_min: number; headcount?: number };

/**
 * 人時売上の材料（その日の全員の労働時間の合計）の取り込み口（2026-11-02）。
 *
 *   POST /api/labor/ingest
 *   ヘッダー: x-api-key: <SALES_INGEST_TOKEN>
 *   本文: { "days": [ { "date": "2026-11-01", "work_min": 1260, "headcount": 4 }, ... ] }
 *
 * 店のMac（週次レポート）が freee人事労務 の勤怠から集計して送ってくる。
 * Mac は週次レポートのために freee とつながっているので、予約システム側で
 * freee との連携を別に張らずに済む。
 *
 * ★受け取るのは「日ごとの合計」だけ。人ごとの時間・時給・給与は受け取らない
 *   （店主指示：各スタッフの給与が他のスタッフに見えないこと）。
 *   余計な項目が付いてきても保存しない。
 */
export async function POST(request: Request) {
  const token = process.env.SALES_INGEST_TOKEN;
  if (!token || request.headers.get("x-api-key") !== token) {
    return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  }

  let body: { days?: LaborDay[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "本文がJSONではありません。" }, { status: 400 });
  }
  const days = Array.isArray(body.days) ? body.days : [];
  if (days.length === 0 || days.length > 400) {
    return NextResponse.json({ error: "days は 1〜400 件で送ってください。" }, { status: 400 });
  }

  const seen = new Set<string>();
  const rows: { biz_date: string; work_min: number; headcount: number; fetched_at: string }[] = [];
  const now = new Date().toISOString();
  for (const d of days) {
    if (!DATE_RE.test(d?.date ?? "") || !isRealDate(d.date) || seen.has(d.date)) continue;
    // 1日の全員の合計は 0〜24時間×30人 に収まるはず。外れた値は読み違いとして捨てる
    if (typeof d.work_min !== "number" || !Number.isFinite(d.work_min) || d.work_min < 0 || d.work_min > 43200) continue;
    const hc = typeof d.headcount === "number" && Number.isFinite(d.headcount) && d.headcount >= 0 ? Math.round(d.headcount) : 0;
    seen.add(d.date);
    rows.push({ biz_date: d.date, work_min: Math.round(d.work_min), headcount: hc, fetched_at: now });
  }
  if (rows.length === 0) return NextResponse.json({ ok: true, count: 0 });

  const admin = createAdminClient();
  const { error } = await admin.from("labor_daily").upsert(rows);
  if (error) {
    console.error("labor_ingest_failed", error.message);
    return NextResponse.json({ error: "保存できませんでした。" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: rows.length });
}
