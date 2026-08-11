import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * 未認証アクセスは全て /login へ。URLが漏れても中身が見えない状態にする。
 * セッション Cookie のリフレッシュもここで行う。
 *
 * ここで弾くのは1枚目の壁で、2枚目は DB の RLS。
 * ミドルウェアのバグだけで予約データが漏れることはない。
 */
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/manifest.webmanifest"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
   * 認証に用が無いパスは Supabase への往復より前に返す。
   * manifestはホーム画面登録時にブラウザが Cookie 無しで取りに来る。
   *
   * /api/public/* と /api/sales/ingest は docs/04-api.md の
   * 「公開・外部連携（認証不要／別の防御）」。
   * セッションを持たない相手（外部サービス・HPのフォーム）が叩くので、
   * ここでログインへ飛ばしてしまうと成立しない。
   * 代わりに各ルートが自前で守る（合言葉ヘッダー・Turnstile・レート制限）。
   *
   * 外部連携の口を足すときは /api/public/ の下に置けばこの分岐は触らなくていい。
   * sales/ingest だけ例外なのは、店のMacの取り込みスクリプト（shippori-report）が
   * 既にこのURLを叩いているため。パスを変えると向こうも直す必要がある。
   */
  if (
    pathname === "/api/ping" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/api/sales/ingest" ||
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
