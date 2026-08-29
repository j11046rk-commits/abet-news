import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 2026-02-31 のような「形は正しいが存在しない日」を弾く（正規表現は通ってしまう） */
function isRealDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

type FollowerDay = {
  date: string;
  followers: number;
  targeted_reaches?: number | null;
  blocks?: number | null;
};

/**
 * LINE友だち数の取り込み口。しっぽり亭週次レポート（別リポジトリ）が
 * LINEのインサイトAPIから取った日毎の総数を、ここに POST して流し込む。
 * 売上・天気と同じ x-api-key で守る。数だけで個人は一切入らない。
 *
 *   POST /api/line/followers
 *   本文: { "days": [ { "date": "2026-08-27", "followers": 128,
 *                        "targeted_reaches": 95, "blocks": 3 } ] }
 */
export async function POST(request: Request) {
  const token = process.env.SALES_INGEST_TOKEN;
  if (!token || request.headers.get("x-api-key") !== token) {
    return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  }

  /*
   * 【一時停止 2026-08-29】Mac側で通知用ボットのトークンが公式アカウントの
   * トークンに化ける取り違えがあり、「友だち1人」を14日ぶん書き込んだ。
   * 正しい値は手で復元済み。Mac側の修正(LINE_OA_TOKENへの分離)が適用される
   * まで書き込みを受けず、復元した値を守る。適用を確認したら false に戻す。
   */
  const PAUSED = true;
  if (PAUSED) {
    return NextResponse.json({ ok: true, count: 0, paused: true });
  }

  let body: { days?: FollowerDay[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "本文がJSONではありません。" }, { status: 400 });
  }

  const days = Array.isArray(body.days) ? body.days : [];
  if (days.length === 0 || days.length > 400) {
    return NextResponse.json({ error: "days は 1〜400 件で送ってください。" }, { status: 400 });
  }

  const opt = (v: unknown): number | null =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000_000 ? v : null;

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
    if (!Number.isInteger(d.followers) || d.followers < 0 || d.followers > 10_000_000) {
      return NextResponse.json({ error: `followers が不正です: ${d.date}` }, { status: 400 });
    }
    rows.push({
      biz_date: d.date,
      followers: d.followers,
      targeted_reaches: opt(d.targeted_reaches),
      blocks: opt(d.blocks),
      updated_at: new Date().toISOString(),
    });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("line_followers_daily")
    .upsert(rows, { onConflict: "biz_date" });
  if (error) {
    console.error("line_followers_ingest_failed", error);
    return NextResponse.json({ error: "保存に失敗しました。" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
