import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 連絡先の保存期間の実行（1日1回・Vercelの定期実行から）。
 *
 * 来店日から13か月たった予約の「連絡先だけ」を消す。
 * 人数・時刻・流入元・席・状態は残るので、売上と集計は無傷。
 * 中身の判断は DB関数 purge_reservation_pii が持っている。ここは呼ぶだけ。
 *
 * ★関数を作っただけでは1件も消えない。
 *   0033 で関数は入れたが、動かす仕掛けを作っていなかったので、
 *   「13か月で消します」と言いながら開業以来の全件が残り続けていた。
 *   守る仕組みは、置いた時点ではなく動き始めた時点で効き始める。
 *
 * 誰が呼んだかは Vercel が付ける Authorization: Bearer <CRON_SECRET> で見る。
 * CRON_SECRET が未設定なら実行しない——「合言葉なしで誰でも呼べる消去API」は
 * 消される側から見れば攻撃そのものなので、開いたままにしない。
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "認証できません。" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("purge_reservation_pii", { p_months: 13 });
  if (error) {
    console.error("purge_reservation_pii_failed", error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  /*
   * お客様のトーク（line_messages・保持30日）もここで消す。
   * webhookが「次のメッセージのついで」にも消すが、トークが1か月以上
   * 途絶えるとそのついでが来ない——約束した保持期間は、毎日必ず走る
   * この場所で保証する。
   */
  const { error: msgErr } = await admin
    .from("line_messages")
    .delete()
    .lt("created_at", new Date(Date.now() - 30 * 86400_000).toISOString());
  if (msgErr) console.error("line_messages_purge_failed", msgErr.message);

  // 消した件数は audit_logs にも残る（reservations.purge）。
  return NextResponse.json({ ok: true, purged: data ?? 0 });
}
