import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * service role クライアント。RLS をバイパスする。
 * アカウント発行・パスワード再発行・初回パスワード変更の後始末でのみ使う。
 *
 * このモジュールは "server-only" のため、クライアントから import するとビルドが落ちる。
 * SUPABASE_SERVICE_ROLE_KEY がブラウザのバンドルに混ざることは構造的に起きない。
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY が未設定です");

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
