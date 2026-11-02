import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushLineUser } from "@/lib/line";
import { customerQuota, RESERVED_FOR_BOOKINGS } from "@/lib/line-quota";
import {
  isReviewUrl,
  pickReviewTargets,
  REVIEW_COOLDOWN_DAYS,
  reviewMessage,
  type ReviewCandidate,
} from "@/lib/review-request";
import { shiftDate, todayBizDate } from "@/lib/time";

/**
 * 来店の翌日、Googleマップの口コミのお願いをLINEで送る（毎日11:00・店主要望 2026-11-02）。
 *
 * 誰に送るかは lib/review-request.ts（会計済の人だけ・180日に1回・ブロックした人は除く）。
 * 口コミ用のリンク（settings.review_url）が入るまでは何もしない。
 * 予約の控え・リマインドのための通数（RESERVED_FOR_BOOKINGS）は残す。
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: setting } = await admin.from("settings").select("value").eq("key", "review_url").maybeSingle();
  const url = setting?.value;
  if (!isReviewUrl(url)) return NextResponse.json({ ok: true, skipped: "no-review-url" });

  const yesterday = shiftDate(todayBizDate(), -1);
  const { data: rows, error } = await admin
    .from("reservations")
    .select("id, status, line_user_id")
    .eq("biz_date", yesterday)
    .eq("status", "completed")
    .not("line_user_id", "is", null)
    .returns<ReviewCandidate[]>();
  if (error) {
    console.error("review_request_query_failed", error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if (!rows || rows.length === 0) return NextResponse.json({ ok: true, sent: 0 });

  const ids = [...new Set(rows.map((r) => r.line_user_id!).filter(Boolean))];
  const since = new Date(Date.now() - REVIEW_COOLDOWN_DAYS * 86400_000).toISOString();
  const [{ data: sent }, { data: friends }] = await Promise.all([
    admin.from("review_requests").select("line_user_id").in("line_user_id", ids).gte("sent_at", since),
    admin.from("line_friends").select("line_user_id, unfollowed_at").in("line_user_id", ids),
  ]);
  const recentlySent = new Set((sent ?? []).map((r) => r.line_user_id as string));
  const unfollowed = new Set(
    (friends ?? []).filter((f) => f.unfollowed_at != null).map((f) => f.line_user_id as string),
  );
  const targets = pickReviewTargets(rows, recentlySent, unfollowed);
  if (targets.length === 0) return NextResponse.json({ ok: true, sent: 0 });

  const quota = await customerQuota();
  if (quota?.remaining != null && quota.remaining - targets.length < RESERVED_FOR_BOOKINGS) {
    return NextResponse.json({ ok: true, skipped: "quota" });
  }

  let count = 0;
  for (const t of targets) {
    const ok = await pushLineUser(t.lineUserId, reviewMessage(String(url).trim()));
    if (!ok) continue;
    count++;
    await admin
      .from("review_requests")
      .upsert({ line_user_id: t.lineUserId, reservation_id: t.reservationId, sent_at: new Date().toISOString() });
  }
  return NextResponse.json({ ok: true, sent: count });
}
