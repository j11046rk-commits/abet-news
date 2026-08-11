import { NextResponse } from "next/server";
import { apiProfile, generateInitialPassword } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * パスワードの再発行。新しい初期パスワードを1度だけ返す。
 * 受け取った本人は次のログインで必ず変更させられる。
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await apiProfile("account.write");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { id } = await ctx.params;
  const password = generateInitialPassword();
  const admin = createAdminClient();

  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) {
    return NextResponse.json({ error: "パスワードを再発行できませんでした。" }, { status: 400 });
  }

  await admin.from("profiles").update({ must_change_password: true }).eq("id", id);

  return NextResponse.json({ ok: true, initial_password: password });
}
