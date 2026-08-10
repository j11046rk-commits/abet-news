import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * 未認証アクセスは全て /login へ。URLが漏れても中身が見えない状態にする。
 * セッション Cookie のリフレッシュもここで行う。
 *
 * ここで弾くのは1枚目の壁で、2枚目は DB の RLS。
 * ミドルウェアのバグだけで予約データが漏れることはない。
 */
// /api/sales/ingest はセッションではなく x-api-key（SALES_INGEST_TOKEN）で守る。
// ここに入れないと未ログインのPOSTが /login へ転送され、送信元は200(HTML)を成功と誤認する。
// /yoyaku と /api/public はお客様向けのネット予約（ログイン不要が仕様）。
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/sales/ingest",
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
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    // 素のドメイン（yoyaku.shipporitei.jp）を開くのは、ふつうお客様。
    // チラシに短いURLだけを載せられるよう、予約ページへ送る。
    //
    // ただし一度ログインした端末には Supabase のCookieが残る。
    // それが残っているのに user が取れない＝スタッフの期限切れなので、
    // 予約ページで行き止まりにせずログイン画面へ送る（ホーム画面のアプリはここを通る）。
    const staffDevice = request.cookies
      .getAll()
      .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
    const toBooking = pathname === "/" && !staffDevice;
    url.pathname = toBooking ? "/yoyaku" : "/login";
    url.search = toBooking || pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
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
