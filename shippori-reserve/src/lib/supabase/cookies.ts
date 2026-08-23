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
 * 期限は30日（最後に使ってから。使っている間は延び続ける）。店主判断 2026-08-12。
 *
 * はじめは12時間にしていた。1営業日で必ず切れる、という理屈だったが、
 * お店は夜に閉めて翌日の夕方に開くので、その空きが12時間を超える。
 * 結果、スタッフ9人が毎日パスワードを打つことになり、
 * それは「簡単なパスワードにする」「紙に書く」という別の穴を作る。
 *
 * 12時間が効くのは端末を失くした後だけで、営業中にレジ横の
 * タブレットを手に取られる場面は12時間でも守れない。そちらは
 * タブレット自体の画面ロックで守るほうが確実、という整理。
 */
export const AUTH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};
