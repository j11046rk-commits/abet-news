import { NextResponse } from "next/server";
import { startSmsVerification } from "@/lib/public-booking";

/**
 * ネット予約のSMS認証コード送信（ログイン不要）。
 * コードの管理・再送間隔・試行回数の制限はTwilio Verify側が行う。
 */
export async function POST(request: Request) {
  let body: { phone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "本文がJSONではありません。" }, { status: 400 });
  }
  const result = await startSmsVerification(body.phone ?? "");
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
