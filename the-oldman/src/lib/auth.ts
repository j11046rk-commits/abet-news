import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * ログインID → Supabase Auth の email に変換する。
 * この規則はサーバー側にだけ置き、クライアントに露出させない（SPEC §2-1）。
 */
export const loginIdToEmail = (loginId: string): string =>
  `${loginId.trim().toLowerCase()}@${process.env.AUTH_EMAIL_DOMAIN ?? "theoldman.local"}`;

export const LOGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{1,30}$/;

export const isValidLoginId = (v: string) => LOGIN_ID_RE.test(v.trim().toLowerCase());

export const MIN_PASSWORD_LENGTH = 8;

/** ランダムな初期パスワード。読み上げて手渡す前提なので紛らわしい文字を除く。 */
export function generateInitialPassword(length = 12): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** 認証済みの profile を返す。未認証なら /login へ。 */
export async function requireProfile(): Promise<Profile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile) redirect("/login?e=noprofile");
  if (!profile.is_active) redirect("/login?e=inactive");
  return profile;
}

/** owner 限定ページ用 */
export async function requireOwner(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "owner") redirect("/");
  return profile;
}

/** Route Handler 用。リダイレクトせず null を返す。 */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  return data && data.is_active ? data : null;
}
