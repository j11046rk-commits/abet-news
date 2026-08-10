import { NextResponse } from "next/server";

/**
 * 【一時的な診断ページ】Twilioアカウントの種別(Trial/Full)を確認する。
 * SMS認証のトラブル解決用。原因が分かり次第このファイルは削除する。
 * 合言葉つきなので第三者は開けない。秘密情報(トークン等)は一切返さない。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== "shippori-8931") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return NextResponse.json({ error: "no credentials" }, { status: 500 });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
    headers: {
      authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
    },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as
    | { type?: string; status?: string; friendly_name?: string }
    | null;
  return NextResponse.json({
    ok: res.ok,
    account_type: body?.type ?? "?", // "Trial" or "Full"
    account_status: body?.status ?? "?",
    name: body?.friendly_name ?? "?",
  });
}
