import { NextResponse } from "next/server";
import { apiProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * HPのアクセス管理ダッシュボード（店主要望 2026-11-04）。
 * 店舗管理アプリにログインしている人なら誰でも見られる（合言葉は不要）。
 * 中身は HP のビルドが毎時送ってくる（/api/insights/hp-dashboard）。
 */
export async function GET(request: Request) {
  const me = await apiProfile("reservation.read");
  if (!me.ok) {
    return NextResponse.redirect(new URL(me.status === 401 ? "/login" : "/", request.url));
  }
  const admin = createAdminClient();
  const { data, error } = await admin.from("hp_dashboard").select("html").eq("id", 1).maybeSingle<{ html: string }>();
  if (error) console.error("hp_dashboard_read_failed", error.code ?? "?");
  const html =
    data?.html ??
    `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>アクセス管理ダッシュボード</title><body style="font-family:sans-serif;padding:2rem;background:#111726;color:#eef1f8"><p>ダッシュボードはまだ届いていません。ホームページの次の更新（1時間以内）で表示されます。</p><p><a style="color:#e6c391" href="/settings">設定へ戻る</a></p></body></html>`;
  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
