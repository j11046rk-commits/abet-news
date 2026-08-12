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
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/sales/ingest",
  "/api/insights",
  "/manifest.webmanifest",
  "/yoyaku",
  "/api/public",
];

/*
 * 「この端末はスタッフが使っている」という目印。中身は "1" だけで、
 * 誰なのかは入っていない（入れる必要が無いし、入れれば守るものが増える）。
 *
 * 以前はログインのCookie（sb-…auth-token）が残っているかで見ていた。
 * それが12時間で消えるようにした途端、朝いちばんにブックマークから開いた
 * スタッフが、全員お客様の予約ページへ送られるようになった。
 * 判定に使っていいのは「消えても困らないもの」だけ。
 */
const STAFF_HINT = "shippori_staff";
const STAFF_HINT_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 400,
};

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

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    // 素のドメイン（yoyaku.shipporitei.jp）を開くのは、ふつうお客様。
    // 短いURLだけを刷り物に載せられるよう、予約ページへ送る。
    //
    // ただし一度でもログインした端末には目印が残る。
    // 目印があるのに user が取れない＝スタッフの期限切れなので、
    // 予約ページで行き止まりにせずログイン画面へ送る。
    const staffDevice =
      request.cookies.has(STAFF_HINT) ||
      request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
    const toBooking = pathname === "/" && !staffDevice;
    url.pathname = toBooking ? "/yoyaku" : "/login";
    url.search = toBooking || pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    const redirected = NextResponse.redirect(url);
    redirected.cookies.set(STAFF_HINT, "1", STAFF_HINT_OPTIONS);
    return redirected;
  }

  // ログインが通っている間に目印を置く。次の朝、期限が切れていても
  // ブックマークとホーム画面のアプリはログイン画面に着く。
  if (user && !request.cookies.has(STAFF_HINT)) {
    response.cookies.set(STAFF_HINT, "1", STAFF_HINT_OPTIONS);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
