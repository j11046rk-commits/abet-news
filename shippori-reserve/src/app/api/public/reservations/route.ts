import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNetReservation, type NetBookingInput } from "@/lib/public-booking";

/**
 * ネット予約の受付口（ログイン不要）。
 * 中身の検査・空席の再確認は lib/public-booking、最後の砦は DB 関数 net_reserve。
 * ここでは「窓口全体が短時間に異常な数を受けていないか」だけを追加で見る。
 */
export async function POST(request: Request) {
  let body: NetBookingInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "本文がJSONではありません。" }, { status: 400 });
  }

  // 窓口全体のしきい値：直近10分のネット予約が異常に多いときは一旦止める
  const admin = createAdminClient();
  const { count } = await admin
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("source", "web_form")
    .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
  if ((count ?? 0) >= 20) {
    return NextResponse.json(
      { ok: false, error: "ただいま混み合っています。少し時間をおくか、お電話でお願いします。" },
      { status: 429 },
    );
  }

  const result = await createNetReservation(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
