import { NextResponse } from "next/server";
import {
  generateInitialPassword,
  getProfile,
  isValidLoginId,
  loginIdToEmail,
} from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * アカウント発行（owner のみ）。
 * 初期パスワードを生成してレスポンスに一度だけ返す。DB には保存しない。
 */
export async function POST(request: Request) {
  const me = await getProfile();
  if (!me || me.role !== "owner") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const loginId = String(body?.login_id ?? "").trim().toLowerCase();
  const displayName = String(body?.display_name ?? "").trim();
  const role = body?.role === "owner" ? "owner" : "member";
  const investment = Math.max(0, Math.trunc(Number(body?.investment_yen ?? 0)) || 0);

  if (!isValidLoginId(loginId)) {
    return NextResponse.json(
      { error: "ログインIDは半角英小文字・数字・. _ - で2〜31文字にしてください。" },
      { status: 400 },
    );
  }
  if (!displayName) {
    return NextResponse.json({ error: "表示名を入力してください。" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: dup } = await admin
    .from("profiles")
    .select("id")
    .eq("login_id", loginId)
    .maybeSingle();
  if (dup) {
    return NextResponse.json({ error: "このログインIDは既に使われています。" }, { status: 409 });
  }

  const password = generateInitialPassword();

  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email: loginIdToEmail(loginId),
    password,
    email_confirm: true,
  });

  if (authErr || !created.user) {
    return NextResponse.json({ error: "アカウントを作成できませんでした。" }, { status: 400 });
  }

  const { error: profErr } = await admin.from("profiles").insert({
    id: created.user.id,
    login_id: loginId,
    display_name: displayName,
    role,
    investment_yen: investment,
    must_change_password: true,
    is_active: true,
  });

  if (profErr) {
    // プロフィールを作れなかったら auth 側も戻す
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: "プロフィールを作成できませんでした。" }, { status: 400 });
  }


  return NextResponse.json({ ok: true, login_id: loginId, password });
}
