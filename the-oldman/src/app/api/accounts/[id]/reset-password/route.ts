import { NextResponse } from "next/server";
import { generateInitialPassword, getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** 初期パスワードの再発行（owner のみ）。生成した値は一度だけ返す。 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getProfile();
  if (!me || me.role !== "owner") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const password = generateInitialPassword();
  const admin = createAdminClient();

  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) {
    return NextResponse.json({ error: "パスワードを再発行できませんでした。" }, { status: 400 });
  }

  await admin.from("profiles").update({ must_change_password: true }).eq("id", id);

  return NextResponse.json({ ok: true, password });
}
