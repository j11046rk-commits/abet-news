import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { AUTH_COOKIE_OPTIONS } from "./cookies";

/**
 * Server Component / Route Handler / Server Action から使う anon クライアント（RLS が効く）。
 *
 * cache() で1リクエストにつき1つにまとめる。画面によっては問い合わせが10本近くあり、
 * その都度クライアントを作り直して Cookie を読み直していた。
 * 中身は同じ（同じ要求の同じ Cookie）なので、作り直す意味がない。
 */
export const createClient = cache(async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, { ...options, ...AUTH_COOKIE_OPTIONS }),
            );
          } catch {
            // Server Component からは書けない。middleware 側でリフレッシュされる。
          }
        },
      },
    },
  );
});
