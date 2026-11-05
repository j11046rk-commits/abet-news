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
  // 一番上に「店舗管理アプリに戻る」の帯を差し込む（店主要望 2026-11-05）。
  // ダッシュボード本体（HP側で作るHTML）には手を入れず、ここで足す
  const back =
    `<a href="/" style="display:block;position:sticky;top:0;z-index:9999;` +
    `padding:calc(10px + env(safe-area-inset-top,0px)) 16px 10px;background:#111726;color:#e6c391;` +
    `border-bottom:1px solid #2d3850;font:600 14px/1.4 -apple-system,'Hiragino Sans','Noto Sans JP',sans-serif;` +
    `letter-spacing:.04em;text-decoration:none">‹ 店舗管理アプリに戻る</a>`;
  const page = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (m) => m + back) : back + html;

  return new NextResponse(page, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
