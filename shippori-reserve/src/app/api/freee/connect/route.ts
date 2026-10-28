import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiProfile } from "@/lib/auth";
import { FREEE_REDIRECT_PATH, freeeAuthorizeUrl, freeeConfigured } from "@/lib/freee";

/**
 * 設定画面の「freeeと連携」から来る入口。freee のログイン・許可画面へ送る。
 * なりすましの戻り（他人が用意した認可コード）を弾くため、state を Cookie に置いて
 * callback で突き合わせる。連携を張れるのは設定の権限がある人（オーナー・店長）だけ。
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const auth = await apiProfile("settings.write");
  if (!auth.ok) return NextResponse.redirect(`${origin}/settings?freee=forbidden`, 303);
  if (!freeeConfigured()) return NextResponse.redirect(`${origin}/settings?freee=noconfig`, 303);

  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(freeeAuthorizeUrl(`${origin}${FREEE_REDIRECT_PATH}`, state), 303);
  res.cookies.set("freee_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/freee",
    maxAge: 600,
  });
  return res;
}
