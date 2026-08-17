import { NextResponse } from "next/server";
import { cancelNetReservation, cancelNetReservationByToken } from "@/lib/public-booking";
import { RATE, clientIp, recordAttempt, sweepSometimes, withinLimit } from "@/lib/rate-limit";

/**
 * ネット予約のWebキャンセル（ログイン不要）。
 * 予約番号＋電話番号の一致で本人確認する。開始2時間前を過ぎたら電話のみ。
 *
 * ★予約番号 R-YYMM-NNNN は月ごとの連番で、秘密として機能しない。
 *   電話番号を1つ知っていれば 0001 から順に投げるだけで当たりを探せてしまうので、
 *   (1) 失敗時の文言を1本に統一して当たり外れを分からなくし、
 *   (2) ここで回数を絞って、そもそも総当たりが成立しないようにする。
 */
export async function POST(request: Request) {
  let body: { reference?: string; phone?: string; token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "本文がJSONではありません。" }, { status: 400 });
  }

  const phone = (body.phone ?? "").trim();
  const reference = (body.reference ?? "").trim();
  const token = (body.token ?? "").trim();
  const ip = clientIp(request.headers);

  // 数える相手は電話番号にする。予約番号を変えながら回す攻撃を止めたいので、
  // 番号ごとに数えると素通りしてしまう。
  // 合言葉での来訪は、数える相手を合言葉そのものにする（電話番号を持たないため）。
  const subject = token || phone || (ip ?? "-");
  if (!(await withinLimit(RATE.cancel, subject, ip))) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "お手続きが混み合っています。少し時間をおいてからお試しいただくか、お電話（0897-47-4494）でご連絡ください。",
      },
      { status: 429 },
    );
  }

  const result = token
    ? await cancelNetReservationByToken(token)
    : await cancelNetReservation(reference, phone);
  await recordAttempt("cancel", subject, ip, result.ok);
  void sweepSometimes();

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
