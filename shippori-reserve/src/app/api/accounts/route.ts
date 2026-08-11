import { NextResponse } from "next/server";
import { apiProfile, generateInitialPassword, isValidLoginId, loginIdToEmail } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types";

const ROLES: UserRole[] = ["owner", "manager", "staff", "viewer"];

/**
 * スタッフアカウントの発行。
 * 初期パスワードは**この応答で1度だけ返す**。DBにも平文では残らない。
 * 口頭で本人に渡し、本人が初回ログイン時に変更する。
 */
export async function POST(request: Request) {
  const gate = await apiProfile("account.write");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await request.json().catch(() => null);
  const loginId = String(body?.login_id ?? "")
    .trim()
    .toLowerCase();
  const displayName = String(body?.display_name ?? "").trim();
  const role: UserRole = ROLES.includes(body?.role) ? body.role : "staff";
  const isOwnerContact = body?.is_owner_contact === true;

  if (!isValidLoginId(loginId)) {
    return NextResponse.json(
      { error: "ログインIDは半角英数字（と . _ -）の2〜31文字にしてください。" },
      { status: 400 },
    );
  }
  if (!displayName) {
    return NextResponse.json({ error: "表示名を入力してください。" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("login_id", loginId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "このログインIDは既に使われています。" }, { status: 409 });
  }

  const password = generateInitialPassword();
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: loginIdToEmail(loginId),
    password,
    email_confirm: true,
  });

  if (authError || !created.user) {
    return NextResponse.json({ error: "アカウントを作成できませんでした。" }, { status: 400 });
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    login_id: loginId,
    display_name: displayName,
    role,
    is_owner_contact: isOwnerContact,
    must_change_password: true,
  });

  if (profileError) {
    // auth 側だけ残ると次回の発行で衝突するので、必ず巻き戻す
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: "アカウント情報を保存できませんでした。" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, login_id: loginId, initial_password: password });
}
