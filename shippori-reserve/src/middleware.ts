import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookies";

/**
 * 未認証アクセスは全て /login へ。URLが漏れても中身が見えない状態にする。
 * セッション Cookie のリフレッシュもここで行う。
 *
 * ここで弾くのは1枚目の壁で、2枚目は DB の RLS。
 * ミドルウェアのバグだけで予約データが漏れることはない。
 */
// /api/sales/ingest と /api/insights はセッションではなく x-api-key で守る
// （SALES_INGEST_TOKEN / INSIGHTS_TOKEN）。
// ここに入れないと未ログインの要求が /login へ転送され、送信元は200(HTML)を成功と誤認する。
// insights は集計しか返さない（氏名・電話番号は取得すらしない）。
// /yoyaku と /api/public はお客様向けのネット予約（ログイン不要が仕様）。
// /api/cron は Vercel の定期実行が呼ぶ。セッションを持たないので
// ここで弾くと毎回ログイン画面へ転送され、掃除が一度も走らないまま
// 「動いているつもり」になる。守りは CRON_SECRET（合言葉）側で見る。
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/sales/ingest",
  "/api/insights",
  "/api/cron",
  "/manifest.webmanifest",
  "/yoyaku",
  "/api/public",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
   * 認証に用が無いパスは Supabase への往復より前に返す。
   * manifest はホーム画面登録時にブラウザが Cookie 無しで取りに来る。
   * ネット予約（/yoyaku・/api/public）はお客様向けで、セッションを一切使わない。
   */
  if (
    pathname === "/api/ping" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/yoyaku" ||
    pathname.startsWith("/yoyaku/") ||
    pathname.startsWith("/api/public/")
  ) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // httpOnly と12時間の期限をここでも効かせる（既定は httpOnly なし・400日）
      cookieOptions: AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, { ...options, ...AUTH_COOKIE_OPTIONS }),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  /*
   * 未ログインは行き先を1つに決める——必ずログイン画面。
   *
   * かつては素のドメイン（yoyaku.shipporitei.jp）を開いた人を
   * 「たぶんお客様」と見て予約ページへ送っていた。刷り物に短いURLだけを
   * 載せられるように、という理由で。スタッフかどうかは端末に残る何かで
   * 見分けるつもりだったが、その「何か」は必ず消える——
   * セッションを12時間にすれば朝には消え、ホーム画面のアプリは
   * ブラウザとは別の入れ物を持ち、履歴を消せばまとめて消える。
   * 消えるたびに、スタッフが黙ってお客様の画面に着く。
   *
   * 見分けるのをやめた。スタッフは必ずログイン画面に着き、
   * お客様は（万一こちらに来ても）そこから1タップで予約ページへ行ける。
   * 当てにいって外すより、決め打って迷わせないほうがいい。
   */
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
