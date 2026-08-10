import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/constants";
import type { UserRole } from "@/lib/types";

const ROLES: UserRole[] = ["owner", "manager", "staff", "viewer"];

/** 表示名・ロール・有効/無効・オーナー直通の対象かどうかを変更する */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getProfile();
  if (!me || !can(me.role, "account.write")) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const patch: Record<string, unknown> = {};

  if (typeof body?.display_name === "string" && body.display_name.trim()) {
    patch.display_name = body.display_name.trim();
  }
  if (ROLES.includes(body?.role)) patch.role = body.role;
  if (typeof body?.is_active === "boolean") patch.is_active = body.is_active;
  if (typeof body?.is_owner_contact === "boolean") patch.is_owner_contact = body.is_owner_contact;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "変更する項目がありません。" }, { status: 400 });
  }

  // 自分自身を降格・無効化することは許さない（管理者が全員いなくなるのを防ぐ）
  if (id === me.id && (patch.role !== undefined || patch.is_active === false)) {
    return NextResponse.json(
      { error: "自分自身のロールと有効状態は変更できません。" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: "更新できませんでした。" }, { status: 400 });

  /*
   * ★「無効にする」を、ログインそのものが通らない状態にする。
   *
   * これまでは profiles.is_active を false にするだけで、Supabase Auth 側の
   * ユーザーとパスワードはそのまま生きていた。/api/auth/login は
   * サインインが成功したあとで is_active を見て signOut しているだけなので、
   * アプリを通さずに Supabase を直接叩けば、辞めた人が古いパスワードで
   * トークンを取れてしまう（席を全部埋めてネット予約を止める、等ができる）。
   *
   * 出勤停止と同時に、鍵そのものを止める。
   */
  if (patch.is_active === false) {
    await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" }); // 実質永久
  } else if (patch.is_active === true) {
    await admin.auth.admin.updateUserById(id, { ban_duration: "none" });
  }

  return NextResponse.json({ ok: true });
}
