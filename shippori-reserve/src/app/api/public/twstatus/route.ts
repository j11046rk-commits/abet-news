import { NextResponse } from "next/server";

/**
 * 【一時的な診断ページ】SMS認証トラブルの調査用。原因解決後に削除する。
 * 合言葉つき。秘密情報(トークン等)は一切返さない。
 *   ?key=...                       … アカウント種別(Trial/Full)を返す
 *   ?key=...&make_service=1        … 新しいVerifyサービスを作ってSIDを返す
 *   ?key=...&service=VA..&test=090.. … そのサービス経由で認証SMSを送ってみて生の結果を返す
 */
const B = (sid: string, token: string) =>
  "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== "shippori-8931") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return NextResponse.json({ error: "no credentials" }, { status: 500 });
  const auth = { authorization: B(sid, token) };

  if (url.searchParams.get("make_service") === "1") {
    const res = await fetch("https://verify.twilio.com/v2/Services", {
      method: "POST",
      headers: { ...auth, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ FriendlyName: "shippori2" }).toString(),
    });
    const body = (await res.json().catch(() => null)) as
      | { sid?: string; code?: number; message?: string }
      | null;
    return NextResponse.json({ ok: res.ok, new_service_sid: body?.sid ?? null, code: body?.code, message: body?.message });
  }

  const service = url.searchParams.get("service");
  const test = url.searchParams.get("test");
  if (service && test) {
    const digits = test.replace(/[^0-9]/g, "");
    const to = "+81" + digits.replace(/^0/, "");
    const res = await fetch(`https://verify.twilio.com/v2/Services/${service}/Verifications`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, Channel: "sms", Locale: "ja" }).toString(),
    });
    const body = (await res.json().catch(() => null)) as
      | { status?: string; code?: number; message?: string }
      | null;
    return NextResponse.json({ ok: res.ok, status: body?.status, code: body?.code, message: body?.message });
  }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
    headers: auth,
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as
    | { type?: string; status?: string; friendly_name?: string }
    | null;
  return NextResponse.json({
    ok: res.ok,
    account_type: body?.type ?? "?",
    account_status: body?.status ?? "?",
    name: body?.friendly_name ?? "?",
  });
}
