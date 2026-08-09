import { NextResponse } from "next/server";
import { dayAvailability, monthAvailability, NET } from "@/lib/public-booking";

/**
 * ネット予約の空席照会（ログイン不要・読み取りのみ）。
 *
 *   GET /api/public/availability?ym=2026-08&party=4   … 月カレンダー用
 *   GET /api/public/availability?date=2026-08-15&party=4 … 時間選択用
 *
 * 予約の中身（お名前など）は一切返さない。返すのは ◯／△／× と時間枠だけ。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const party = Math.trunc(Number(url.searchParams.get("party") ?? "2"));
  if (!Number.isInteger(party) || party < 1 || party > NET.maxParty) {
    return NextResponse.json({ error: "人数が不正です。" }, { status: 400 });
  }

  const ym = url.searchParams.get("ym");
  const date = url.searchParams.get("date");

  try {
    if (ym && /^\d{4}-\d{2}$/.test(ym)) {
      return NextResponse.json({ ym, party, days: await monthAvailability(ym, party) });
    }
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ party, ...(await dayAvailability(date, party)) });
    }
  } catch {
    return NextResponse.json({ error: "空席情報を取得できませんでした。" }, { status: 500 });
  }
  return NextResponse.json({ error: "ym か date を指定してください。" }, { status: 400 });
}
