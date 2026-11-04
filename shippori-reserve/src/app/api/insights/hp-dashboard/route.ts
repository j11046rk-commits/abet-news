import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * HPのアクセス管理ダッシュボードの受け取り口（店主要望 2026-11-04）。
 * HPのビルド（GitHub Actions・毎時）が、出来上がったダッシュボードのHTMLを送ってくる。
 *
 *   POST /api/insights/hp-dashboard
 *   ヘッダー: x-api-key: <INSIGHTS_TOKEN>（HP側は RESERVE_INSIGHTS_TOKEN として同じ値を持っている）
 *   本文: { "html": "<!doctype html>…", "built_at": "2026-11-04T10:00:00Z" }
 *
 * 見るのは /hp-dashboard（店舗管理アプリにログインしている人だけ）。
 */
const MAX = 3 * 1024 * 1024;

export async function POST(request: Request) {
  const token = process.env.INSIGHTS_TOKEN;
  if (!token || request.headers.get("x-api-key") !== token) {
    return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  }
  let body: { html?: unknown; built_at?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "本文がJSONではありません。" }, { status: 400 });
  }
  const html = typeof body.html === "string" ? body.html : "";
  if (!html.trim().toLowerCase().startsWith("<!doctype html") || html.length > MAX) {
    return NextResponse.json({ error: "html が正しくありません。" }, { status: 400 });
  }
  const builtAt = typeof body.built_at === "string" && !Number.isNaN(Date.parse(body.built_at)) ? body.built_at : null;
  const admin = createAdminClient();
  const { error } = await admin
    .from("hp_dashboard")
    .upsert({ id: 1, html, built_at: builtAt, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) {
    console.error("hp_dashboard_save_failed", error.code ?? "?");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true, bytes: html.length });
}
