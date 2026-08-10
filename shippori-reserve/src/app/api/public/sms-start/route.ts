import { NextResponse } from "next/server";
import { startSmsVerification } from "@/lib/public-booking";
import { RATE, clientIp, recordAttempt, sweepSometimes, withinLimit } from "@/lib/rate-limit";

/**
 * ネット予約のSMS認証コード送信（ログイン不要）。
 *
 * ★ここが店のお金に直結する。1通ごとにTwilioの課金が乗るので、
 *   番号を変えながら回されると請求が青天井に膨らむ（SMSポンピング）。
 *   Twilio側の制限は「同じ番号あたり」なので、番号を変える攻撃には効かない。
 *   だから宛先ごと・送信元ごと・全体の天井の3段で、送る前に止める。
 */
export async function POST(request: Request) {
  let body: { phone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "本文がJSONではありません。" }, { status: 400 });
  }

  const phone = (body.phone ?? "").trim();
  const ip = clientIp(request.headers);
  const busy = {
    ok: false,
    error:
      "お手続きが混み合っています。少し時間をおいてからお試しいただくか、お電話（0897-47-4494）でご予約ください。",
  };

  if (!phone) {
    return NextResponse.json(
      { ok: false, error: "電話番号を入力してください。" },
      { status: 400 },
    );
  }
  if (!(await withinLimit(RATE.sms, phone, ip))) {
    // 何に引っかかったかは返さない（どの上限に当たったかも手がかりになる）
    return NextResponse.json(busy, { status: 429 });
  }

  const result = await startSmsVerification(phone);
  // 成否にかかわらず1回として数える。失敗を数えないと、失敗させ続ければ無制限になる。
  await recordAttempt("sms", phone, ip, result.ok);
  void sweepSometimes();

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
