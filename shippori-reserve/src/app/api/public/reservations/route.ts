import { NextResponse } from "next/server";
import { createNetReservation, type NetBookingInput } from "@/lib/public-booking";
import { RATE, clientIp, recordAttempt, sweepSometimes, withinLimit } from "@/lib/rate-limit";

/**
 * ネット予約の受付口（ログイン不要）。
 * 中身の検査・空席の再確認は lib/public-booking、最後の砦は DB 関数 net_reserve。
 * ここで見るのは回数だけ。
 *
 * ★止める相手を間違えないこと。
 *   以前はここで「直近10分に入ったネット予約が20件を超えたら全員に429」を
 *   返していた。店全体で1つの数え方なので、攻撃者と本物のお客様を区別しない。
 *   しかも数えていたのは成功した予約なので、入れてすぐ消せば件数は減り、
 *   20件入れて消すのを繰り返すだけでネット予約を永久に止められた。
 *   お客様にも店にも「混み合っています」としか見えないので、
 *   止まっていることに誰も気づけない——予約が丸ごと失われる形で。
 */
export async function POST(request: Request) {
  let body: NetBookingInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "本文がJSONではありません。" }, { status: 400 });
  }

  const ip = clientIp(request.headers);
  const phone = (body?.phone ?? "").trim();

  // 電話番号ごと・送信元ごと・全体の3段。当たるのはほぼ攻撃者だけになる。
  if (!(await withinLimit(RATE.booking, phone, ip))) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "お手続きが混み合っています。少し時間をおいてからお試しいただくか、お電話（0897-47-4494）でご予約ください。",
      },
      { status: 429 },
    );
  }

  const result = await createNetReservation(body);
  // 成否にかかわらず1回として数える。失敗を数えないと、失敗させ続ければ無制限になる。
  await recordAttempt("booking", phone, ip, result.ok);
  void sweepSometimes();

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
