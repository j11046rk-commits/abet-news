import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** ロール変更 / 有効・無効 / 表示名 / 出資額（owner のみ） */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getProfile();
  if (!me || me.role !== "owner") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const patch: Record<string, unknown> = {};

  if (typeof body?.display_name === "string" && body.display_name.trim()) {
    patch.display_name = body.display_name.trim();
  }
  if (body?.role === "owner" || body?.role === "member") patch.role = body.role;
  if (typeof body?.is_active === "boolean") patch.is_active = body.is_active;
  if (body?.investment_yen !== undefined) {
    patch.investment_yen = Math.max(0, Math.trunc(Number(body.investment_yen) || 0));
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "変更する項目がありません。" }, { status: 400 });
  }

  // 自分自身を owner から降ろす / 無効にすることは許さない（締め出し防止）
  if (id === me.id && (patch.role === "member" || patch.is_active === false)) {
    return NextResponse.json(
      { error: "自分自身のロールと有効状態は変更できません。" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: "更新できませんでした。" }, { status: 400 });

  return NextResponse.json({ ok: true });
}
