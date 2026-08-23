import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/constants";
import type { PermissionCode, Profile } from "@/lib/types";

/**
 * ログインID → Supabase Auth の email に変換する。
 * この規則はサーバー側にだけ置き、クライアントに露出させない（docs/02-screens.md S0）。
 */
export const loginIdToEmail = (loginId: string): string =>
  `${loginId.trim().toLowerCase()}@${process.env.AUTH_EMAIL_DOMAIN ?? "shipporitei.local"}`;

export const LOGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{1,30}$/;

export const isValidLoginId = (v: string) => LOGIN_ID_RE.test(v.trim().toLowerCase());

export const MIN_PASSWORD_LENGTH = 8;

/** ランダムな初期パスワード。口頭で読み上げて渡す前提なので紛らわしい文字を除く。 */
export function generateInitialPassword(length = 12): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/*
 * 1リクエストの中で「あなたは誰か」を1回しか聞かない。
 *
 * ここは画面を1枚出すたびに必ず通る道で、しかも (app) のレイアウトと
 * ページ本体の両方から呼ばれる。素のままだと1画面につき
 * Supabase Auth への往復が2回、profiles の取得も2回走っていた。
 * middleware のぶんと合わせて、データを1件も読む前に3往復していたことになる。
 * 起動と画面遷移の「もたつき」は、ほとんどがこの待ち時間だった。
 *
 * cache() は1リクエストの中だけで効く（次の要求には持ち越さない）ので、
 * 権限を落としたり停止したりした結果が古いまま残ることはない。
 */
const loadMe = cache(async function loadMe(): Promise<{
  hasUser: boolean;
  profile: Profile | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { hasUser: false, profile: null };

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  return { hasUser: true, profile: data ?? null };
});

/** 認証済みの profile を返す。未認証なら /login へ。 */
export async function requireProfile(): Promise<Profile> {
  const { hasUser, profile } = await loadMe();
  if (!hasUser) redirect("/login");
  if (!profile) redirect("/login?e=noprofile");
  if (!profile.is_active) redirect("/login?e=inactive");
  if (profile.must_change_password) redirect("/password");
  return profile;
}

/**
 * ルートハンドラ（/api/…）用の入口。
 *
 * ページ側の requireProfile は redirect() で弾けるが、APIは画面を持たないので
 * 同じ判定を JSON で返す。ここを通さずに素の profile を取れるようにしておくと、
 * 「在籍・有効・初期パスワードのまま」の3つのうちどれかを見落とした口が必ず生まれる。
 *
 * とくに3つめ——ログインした時点で Cookie はもう出ているので、
 * お店から渡された初期パスワードのまま画面を1枚も開かずに
 * アカウント発行APIを直接叩けてしまう状態だった。
 */
export async function apiProfile(
  perm: PermissionCode,
): Promise<{ ok: true; me: Profile } | { ok: false; status: number; error: string }> {
  const { profile } = await loadMe();
  const me = profile && profile.is_active ? profile : null;
  if (!me) return { ok: false, status: 401, error: "ログインが必要です。" };
  if (me.must_change_password) {
    return { ok: false, status: 403, error: "先にパスワードを変更してください。" };
  }
  if (!can(me.role, perm)) return { ok: false, status: 403, error: "権限がありません。" };
  return { ok: true, me };
}

/** 権限が要るページ用。足りなければトップへ戻す。 */
export async function requirePermission(perm: PermissionCode): Promise<Profile> {
  const profile = await requireProfile();
  if (!can(profile.role, perm)) redirect("/");
  return profile;
}
