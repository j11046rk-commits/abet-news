import { NextResponse } from "next/server";
import { apiProfile, generateInitialPassword } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManage } from "@/lib/account-scope";
import type { UserRole } from "@/lib/types";

/**
 * パスワードの再発行。新しい初期パスワードを1度だけ返す。
 * 受け取った本人は次のログインで必ず変更させられる。
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await apiProfile("account.write");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { id } = await ctx.params;
  const admin = createAdminClient();
  // 店長が再発行できるのはスタッフ・事務・閲覧のみの人だけ（オーナー・店長の鍵を奪えないように）
  const { data: target } = await admin.from("profiles").select("role").eq("id", id).maybeSingle();
  if (!target) return NextResponse.json({ error: "アカウントが見つかりません。" }, { status: 404 });
  if (!canManage(gate.me.role, target.role as UserRole)) {
    return NextResponse.json({ error: "オーナー・店長のパスワードはオーナーだけが再発行できます。" }, { status: 403 });
  }
  const password = generateInitialPassword();

  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) {
    return NextResponse.json({ error: "パスワードを再発行できませんでした。" }, { status: 400 });
  }

  await admin.from("profiles").update({ must_change_password: true }).eq("id", id);

  return NextResponse.json({ ok: true, initial_password: password });
}
