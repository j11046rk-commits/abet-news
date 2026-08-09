"use client";
import { createBrowserClient } from "@supabase/ssr";

/** ブラウザ側の anon クライアント。RLS が効く。 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
