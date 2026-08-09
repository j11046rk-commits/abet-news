import { NextResponse } from "next/server";
import { cancelNetReservation } from "@/lib/public-booking";

/**
 * ネット予約のWebキャンセル（ログイン不要）。
 * 予約番号＋電話番号の一致で本人確認する。開始2時間前を過ぎたら電話のみ。
 */
export async function POST(request: Request) {
  let body: { reference?: string; phone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "本文がJSONではありません。" }, { status: 400 });
  }

  const result = await cancelNetReservation(body.reference ?? "", body.phone ?? "");
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
