import { NextResponse } from "next/server";
import { BOT_REFERENCE, createNetReservation, normalizePhone, type NetBookingInput } from "@/lib/public-booking";
import { pushLine, pushLineUser } from "@/lib/line";
import { RATE, clientIp, recordAttempt, sweepSometimes, withinLimit } from "@/lib/rate-limit";
import { surname } from "@/lib/staff";
import { fmtDateJa, minutesToLabel } from "@/lib/time";

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
  // 回数の相手は正規化した番号で数える（表記ゆれで上限を掛け算させない）。
  // 正規化できない入力は生のまま数える——中身の検査はこの先で正しく弾かれる
  const rawPhone = (body?.phone ?? "").trim();
  const phone = normalizePhone(rawPhone) ?? rawPhone;

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

  // ハニーポットに引っかかったボットには「成功したふり」を返している。
  // それを本物と同じに扱うと、ボットが来るたびにLINEが鳴る。
  let lineNotified = false;
  if (result.ok && result.reference !== BOT_REFERENCE) {
    await notifyLine(body, result.seat_note);
    // LINEで予約されたお客様には、ご本人にも控えを送る
    lineNotified = await notifyCustomer(result.line_user_id, body, result.reference);
  }

  // LINEのIDは画面に返さない。ご本人のIDとはいえ、要らないものを外に出さない。
  // 代わりに「LINEの予約として通ったか」「控えが実際に送れたか」だけを返す——
  // 画面はこれを見て文言を選ぶ。送れていないのに「お送りしました」と出さないため。
  if (result.ok) {
    const { line_user_id: _omit, ...safe } = result;
    return NextResponse.json(
      { ...safe, via_line: !!result.line_user_id, line_notified: lineNotified },
      { status: 200 },
    );
  }
  return NextResponse.json(result, { status: 400 });
}

/**
 * ご予約の控えを、お客様ご本人のLINEへ送る。
 *
 * これが「LINEで予約する意味」の半分。予約番号を控えなくても、
 * トークを遡れば自分の予約が分かる。変更・キャンセルもそのまま書ける。
 *
 * 席は書かない——「T1」と送られてもお客様には意味が分からないし、
 * 当日の運びで変わることもある。日時と人数と番号があれば足りる。
 */
async function notifyCustomer(
  lineUserId: string | undefined,
  body: NetBookingInput,
  reference: string,
): Promise<boolean> {
  if (!lineUserId) return false;
  try {
    const date = String(body?.date ?? "");
    const min = Number(body?.start_min);
    const when = /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? `${fmtDateJa(`${date}T12:00:00+09:00`)} ${Number.isFinite(min) ? minutesToLabel(min) : ""}`.trim()
      : "";

    return await pushLineUser(
      lineUserId,
      [
        "ご予約ありがとうございます。しっぽり亭です。",
        "",
        when,
        `${Number(body?.party) || "?"}名様`,
        `予約番号 ${reference}`,
        "",
        "ご変更・キャンセルは、このトークにそのままご連絡ください。",
        "お急ぎの場合は 0897-47-4494 までお電話ください。",
      ].join("\n"),
    );
  } catch {
    // 控えが届かなくても予約は成立している
    return false;
  }
}

/**
 * ネット予約が入ったことを、週次レポートと同じLINEグループへ知らせる（店主指示 2026-08-17）。
 *
 * ネット予約は誰も電話を受けていないので、アプリを開くまで誰も気づかない。
 * 席ボードのタブレットは音で知らせるが、それは店に居る人にしか届かない。
 *
 * 送るのは姓・日時・人数・席と、その日を開くリンクだけ。
 * 電話番号は送らない——気づくのに要らないし、LINEのトーク履歴は
 * 端末にもクラウドにも残って、こちらでは消せないので。
 *
 * 通知が失敗しても予約は成立させる。await するのは、返事を返した後だと
 * Vercelの関数が途中で止められて送信が消えるため。上限3秒で必ず抜ける。
 */
async function notifyLine(body: NetBookingInput, seatNote: string): Promise<void> {
  try {
    const date = String(body?.date ?? "");
    const min = Number(body?.start_min);
    const when = /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? `${fmtDateJa(`${date}T12:00:00+09:00`)} ${Number.isFinite(min) ? minutesToLabel(min) : ""}`.trim()
      : "日時未確認";
    const app = process.env.NEXT_PUBLIC_APP_URL ?? "https://yoyaku.shipporitei.jp";

    await pushLine(
      [
        "🔔 ネット予約が入りました",
        "",
        when,
        `${surname(String(body?.name ?? "お客様"))}様 ${Number(body?.party) || "?"}名`,
        seatNote && seatNote !== "指定なし" ? seatNote : "",
        "",
        `${app}/day/${date}`,
      ]
        .filter((l) => l !== "")
        .join("\n"),
    );
  } catch {
    // 通知は落ちても予約に影響させない
  }
}
