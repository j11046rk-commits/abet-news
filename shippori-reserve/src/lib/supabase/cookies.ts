import type { CookieOptions } from "@supabase/ssr";

/**
 * セッションCookieの条件。
 *
 * @supabase/ssr の既定は httpOnly なし・有効期限400日。
 * それだと、
 *   ・ブラウザのJSから document.cookie でトークンを丸ごと読める
 *   ・席ボードのタブレットを触り続ける限り、期限が永久に伸びる
 * という状態になる。レジ横に置きっぱなしの端末が、そのまま
 * 予約者全員の氏名と電話番号の閲覧端末になってしまう。
 *
 * ブラウザ側から Supabase を直接叩いているコードは無い
 * （src/lib/supabase/client.ts はどこからも import されていない）ので、
 * httpOnly を付けても画面は壊れない。
 *
 * 期限は12時間。1営業日で必ず切れる。
 */
export const AUTH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 12,
};
