import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 外から来る機械（定期実行のClaudeなど）の合言葉。
 * DB にはハッシュだけを置く。平文は発行した瞬間に1回だけ画面に出す（あとから読み出せない）。
 * 発行し直すと前の合言葉は効かなくなる。
 */

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function issueApiToken(name: string, by: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const { error } = await createAdminClient()
    .from("api_tokens")
    .upsert({ name, token_hash: sha(token), created_by: by, created_at: new Date().toISOString(), last_used_at: null });
  if (error) throw new Error(error.message);
  return token;
}

export async function apiTokenInfo(name: string): Promise<{ created_at: string; last_used_at: string | null } | null> {
  const { data } = await createAdminClient().from("api_tokens").select("created_at, last_used_at").eq("name", name).maybeSingle();
  return (data as { created_at: string; last_used_at: string | null } | null) ?? null;
}

export async function verifyApiToken(name: string, presented: string | null): Promise<boolean> {
  if (!presented || presented.length < 20 || presented.length > 200) return false;
  const admin = createAdminClient();
  const { data } = await admin.from("api_tokens").select("token_hash").eq("name", name).maybeSingle();
  if (!data) return false;
  const a = Buffer.from(sha(presented), "hex");
  const b = Buffer.from(data.token_hash as string, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  await admin.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("name", name);
  return true;
}
