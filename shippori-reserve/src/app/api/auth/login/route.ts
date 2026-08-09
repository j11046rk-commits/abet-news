import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValidLoginId, loginIdToEmail } from "@/lib/auth";
import type { Profile } from "@/lib/types";

/**
 * ログインID + パスワードでのサインイン。
 * ID → email の変換規則はここ（サーバー側）にだけ存在する。
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const loginId = String(body?.login_id ?? "")
    .trim()
    .toLowerCase();
  const password = String(body?.password ?? "");

  // 失敗メッセージは常に同一。IDの存在有無を推測させない。
  const deny = () =>
    NextResponse.json({ error: "ログインIDまたはパスワードが違います。" }, { status: 401 });

  if (!loginId || !password || !isValidLoginId(loginId)) return deny();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: loginIdToEmail(loginId),
    password,
  });

  if (error || !data.user) return deny();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .maybeSingle<Profile>();

  if (!profile) {
    await supabase.auth.signOut();
    return NextResponse.json(
      { error: "このアカウントは登録されていません。オーナーにお問い合わせください。" },
      { status: 403 },
    );
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    return NextResponse.json(
      { error: "このアカウントは現在無効です。オーナーにお問い合わせください。" },
      { status: 403 },
    );
  }

  return NextResponse.json({
    ok: true,
    must_change_password: profile.must_change_password,
  });
}
